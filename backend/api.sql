-- Varmak Workshop — the workflows.
--
-- Step 4 of BACKEND.md: the API for the workflows in §4, one at a time. Run after auth.sql.
--
-- §4 divides the system into three layers and says what belongs in each. These are the middle one:
--
--     "workflows that span several tables in one transaction: accepting an estimate and creating
--      its project, receiving goods against a purchase order, issuing material to a jobcard,
--      converting a lead into a customer. Each is several writes that must all succeed or all fail."
--
-- They are written as database functions rather than as code in the HTTP server, for the same
-- reason the safety rules are triggers: a workflow in the server holds until somebody adds a second
-- caller. A function is one transaction by construction, is subject to the same row-level security
-- as everything else, and cannot be gone around. The HTTP layer in server.js carries requests to
-- these and does nothing else — it holds no business logic at all, and there is a test that says so.
--
-- Two of the four were already built where they belonged: issuing material is issue_material() in
-- auth.sql, because it had to be the only door through which stock moves, and per-group item
-- numbering is next_item_number() in schema.sql.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Doing a thing once, even when the tablet sends it twice
--
-- §3 scoped offline to three append-only actions — booking hours, starting or pausing an operation,
-- issuing material — because they happen at the machine and cannot wait for a signal. The tablet
-- queues them with an id it generates itself and replays them when the signal returns.
--
-- Replay is not "did this fail? then send it again": the tablet does not know whether the first
-- attempt reached the server before the connection died. So every one of those calls takes an id,
-- and asking twice with the same id gives the same answer and changes nothing the second time.
-- That is what makes the queue safe to flush blindly.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE device_event (
  id          text PRIMARY KEY CHECK (btrim(id) <> ''),
  kind        text NOT NULL CHECK (btrim(kind) <> ''),
  user_id     bigint NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL DEFAULT now(),
  -- What the first attempt produced, handed back verbatim to a replay.
  result      text
);

CREATE INDEX device_event_user_idx ON device_event(user_id, received_at DESC);

ALTER TABLE device_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_event FORCE ROW LEVEL SECURITY;
CREATE POLICY your_own_device_events ON device_event FOR ALL
  USING (user_id = current_app_user() OR may_see_money())
  WITH CHECK (user_id = current_app_user());
GRANT SELECT, INSERT, UPDATE ON device_event TO varmak_admin, varmak_office, varmak_workshop;

-- Returns the earlier answer if this id has been seen, or NULL if it is new and has just been
-- claimed. The claim and the check are one statement, so two replays arriving together cannot both
-- decide they are first.
CREATE FUNCTION already_done(p_event_id text, p_kind text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  earlier text;
BEGIN
  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RETURN NULL;
  END IF;
  INSERT INTO device_event (id, kind, user_id)
  VALUES (p_event_id, p_kind, current_app_user())
  ON CONFLICT (id) DO NOTHING;
  IF FOUND THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(result, 'accepted') INTO earlier FROM device_event WHERE id = p_event_id;
  RETURN earlier;
END;
$$;

CREATE FUNCTION record_result(p_event_id text, p_result text) RETURNS void
LANGUAGE sql AS $$
  UPDATE device_event SET result = p_result WHERE id = p_event_id AND result IS NULL;
$$;

-- Asked first, before anything else, in each of the three. already_done() records the event against
-- current_app_user(), so a request with no session used to die on a not-null violation deep inside
-- it — leaving somebody at a tablet that had quietly lost its session reading "null value in column
-- user_id" instead of being told to sign in. The order of two lines, and the whole difference
-- between a message that helps and one that does not.
CREATE FUNCTION require_session(p_doing text) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  who text := current_app_name();
BEGIN
  IF who IS NULL THEN
    RAISE EXCEPTION 'sign in before %', p_doing USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN who;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- A quotation goes out
--
-- Sending is what locks the lines. Until then a price is just a price; afterwards changing it needs
-- a reason and a name, which the trigger in schema.sql enforces. Nothing set `locked` before this
-- existed, which made that whole rule unreachable.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION send_estimate(p_estimate_id bigint, p_valid_days int DEFAULT 30) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  est estimate%ROWTYPE;
  lines int;
BEGIN
  SELECT * INTO est FROM estimate WHERE id = p_estimate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such estimate' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF est.status <> 'draft' THEN
    RAISE EXCEPTION 'estimate % has already been sent (it is %)', est.ref, est.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO lines FROM estimate_line WHERE estimate_id = p_estimate_id;
  IF lines = 0 THEN
    RAISE EXCEPTION 'estimate % has no lines — there is no price to send', est.ref
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE estimate_line SET locked = true WHERE estimate_id = p_estimate_id;
  -- coalesce on the parameter as well as the column: a JSON client that leaves a field out sends
  -- null, and an explicit null overrides a SQL DEFAULT rather than falling back to it. Every
  -- parameter here with a default has to survive being passed null, or the API can only call these
  -- functions by naming every argument every time.
  UPDATE estimate
     SET status = 'sent',
         valid_until = coalesce(valid_until, current_date + coalesce(p_valid_days, 30))
   WHERE id = p_estimate_id;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('estimate', p_estimate_id, 'sent', coalesce(current_app_name(), 'system'),
          est.ref || ' at ' || (SELECT total FROM estimate WHERE id = p_estimate_id) || ' ' || est.currency);

  RETURN est.ref;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- The customer says yes
--
-- Several writes that must all succeed or all fail: the estimate becomes accepted, a project comes
-- into being or moves forward, and the hours that were quoted become the hours that were planned.
-- The last one is the point of doing this in one place — a project whose planned hours were never
-- filled in from the estimate is a project every capacity figure downstream is wrong about.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION accept_estimate(p_estimate_id bigint) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  est estimate%ROWTYPE;
  proj project%ROWTYPE;
  quoted_hours numeric;
BEGIN
  SELECT * INTO est FROM estimate WHERE id = p_estimate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such estimate' USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- A draft cannot be accepted: nobody outside the building has seen it.
  IF est.status <> 'sent' THEN
    RAISE EXCEPTION 'estimate % cannot be accepted from %', est.ref, est.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF est.valid_until IS NOT NULL AND est.valid_until < current_date THEN
    RAISE EXCEPTION 'estimate % expired on % — requote it rather than accepting it', est.ref, est.valid_until
      USING ERRCODE = 'check_violation';
  END IF;

  -- Labour is quoted in hours, so that is what becomes the plan. Material lines are quantities of
  -- steel and have nothing to say about how long the job takes.
  SELECT coalesce(sum(quantity), 0) INTO quoted_hours
    FROM estimate_line WHERE estimate_id = p_estimate_id AND kind = 'labour';

  IF est.project_id IS NULL THEN
    INSERT INTO project (name, customer_id, status, planned_hours)
    VALUES (est.title, est.customer_id, 'approved', quoted_hours)
    RETURNING * INTO proj;
    UPDATE estimate SET project_id = proj.id WHERE id = p_estimate_id;
  ELSE
    SELECT * INTO proj FROM project WHERE id = est.project_id FOR UPDATE;
    -- Only moved if the sequence allows it. A project already in production does not go back to
    -- approved because a second estimate on it was accepted.
    IF proj.status = 'quotation' THEN
      UPDATE project SET status = 'approved' WHERE id = proj.id;
    END IF;
    UPDATE project SET planned_hours = planned_hours + quoted_hours WHERE id = proj.id;
  END IF;

  UPDATE estimate SET status = 'accepted' WHERE id = p_estimate_id;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('estimate', p_estimate_id, 'accepted', coalesce(current_app_name(), 'system'),
          est.ref || ' → project ' || (SELECT ref FROM project WHERE id = proj.id)
          || ', ' || trim_scale(quoted_hours) || ' h planned');

  RETURN (SELECT ref FROM project WHERE id = proj.id);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Steel arrives
--
-- Four writes in one transaction: the line records what came, the item's stock goes up, a movement
-- explains why it went up, and the order's own status follows from its lines. Doing any of those
-- without the others leaves the store unable to explain itself.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION receive_goods(p_line_id bigint, p_quantity numeric, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  line purchase_order_line%ROWTYPE;
  order_row purchase_order%ROWTYPE;
  who text := coalesce(current_app_name(), 'system');
  outstanding numeric;
  movement_ref text;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'a receipt must be for more than nothing' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO line FROM purchase_order_line WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such order line' USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT * INTO order_row FROM purchase_order WHERE id = line.purchase_order_id FOR UPDATE;

  IF order_row.status = 'cancelled' THEN
    RAISE EXCEPTION 'order % was cancelled — receiving against it needs it reopened first', order_row.ref
      USING ERRCODE = 'check_violation';
  END IF;

  -- Named before the constraint fires, so the storeman is told how much is actually outstanding
  -- rather than which CHECK they broke.
  outstanding := line.quantity - line.received_quantity;
  IF p_quantity > outstanding THEN
    RAISE EXCEPTION 'order % has only % of % outstanding on "%" — % is more than was ordered',
      order_row.ref, trim_scale(outstanding), trim_scale(line.quantity), line.description,
      trim_scale(p_quantity)
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE purchase_order_line SET received_quantity = received_quantity + p_quantity
   WHERE id = p_line_id;

  -- A line can be for something that is not a stock item — a service, a carriage charge — and then
  -- there is nothing to put on a shelf.
  IF line.stock_item_id IS NOT NULL THEN
    UPDATE stock_item SET stock = stock + p_quantity WHERE id = line.stock_item_id;
    INSERT INTO stock_movement (stock_item_id, kind, quantity, jobcard_id, moved_by, note)
    VALUES (line.stock_item_id, 'receipt', p_quantity, NULL, who,
            coalesce(p_note, 'Received against ' || order_row.ref))
    RETURNING ref INTO movement_ref;
  END IF;

  -- The order's status is a statement about its lines, so it is derived from them rather than set
  -- by whoever happened to be on the receiving bay.
  UPDATE purchase_order SET status = (CASE
      WHEN NOT EXISTS (SELECT 1 FROM purchase_order_line
                        WHERE purchase_order_id = order_row.id AND received_quantity < quantity)
        THEN 'received'
      ELSE 'part-received'
    END)::purchase_order_status
   WHERE id = order_row.id;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('purchase_order', order_row.id, 'received', who,
          trim_scale(p_quantity) || ' of "' || line.description || '" on ' || order_row.ref);

  RETURN coalesce(movement_ref, order_row.ref);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- An enquiry becomes somebody we work for
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION convert_lead(p_lead_id bigint, p_org_no text DEFAULT NULL, p_vat_no text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  the_lead lead%ROWTYPE;
  made customer%ROWTYPE;
BEGIN
  SELECT * INTO the_lead FROM lead WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such lead' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF the_lead.status = 'converted' THEN
    RAISE EXCEPTION 'lead % is already customer %', the_lead.ref,
      (SELECT ref FROM customer WHERE id = the_lead.customer_id) USING ERRCODE = 'check_violation';
  END IF;
  IF the_lead.status = 'lost' THEN
    RAISE EXCEPTION 'lead % was marked lost', the_lead.ref USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO customer (name, org_no, vat_no, email, phone, city, status)
  VALUES (the_lead.company, p_org_no, p_vat_no, the_lead.email, the_lead.phone, the_lead.city, 'active')
  RETURNING * INTO made;

  UPDATE lead SET status = 'converted', customer_id = made.id WHERE id = p_lead_id;

  -- Anything already quoted to the lead now belongs to the customer, or the history of where the
  -- work came from stops joining up the moment they become real.
  UPDATE opportunity SET customer_id = made.id WHERE lead_id = p_lead_id AND customer_id IS NULL;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('lead', p_lead_id, 'converted', coalesce(current_app_name(), 'system'),
          the_lead.ref || ' → ' || made.ref || ' (' || made.name || ')');

  RETURN made.ref;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- The three things the tablet may do with no signal
--
-- Each takes an event id from the device. Replaying gives the same answer and changes nothing.
--
-- And the gates still hold on replay. An operation queued offline against a machine that turned out
-- to be out of service is refused when it reaches the server, and the person is told. Offline delays
-- the check; it does not skip it. This is exactly why the rules are in the database — the tablet
-- cannot be the thing that decides.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION book_hours(p_jobcard_id bigint, p_operation_id bigint, p_hours numeric,
                           p_worked_on date DEFAULT current_date, p_note text DEFAULT NULL,
                           p_event_id text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('booking hours');
  seen text := already_done(p_event_id, 'book_hours');
  entry_id bigint;
BEGIN
  IF seen IS NOT NULL THEN
    RETURN seen;
  END IF;

  -- The worker is the session, never a parameter. An hours entry somebody else's name can be put
  -- on is not a timesheet.
  -- Same as above: null means "not given", so today.
  INSERT INTO hours_entry (jobcard_id, operation_id, worker, hours, worked_on, note)
  VALUES (p_jobcard_id, p_operation_id, who, p_hours, coalesce(p_worked_on, current_date), p_note)
  RETURNING id INTO entry_id;

  PERFORM record_result(p_event_id, 'H-' || entry_id);
  RETURN 'H-' || entry_id;
END;
$$;

CREATE FUNCTION record_operation(p_operation_id bigint, p_status operation_status,
                                 p_event_id text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('starting work');
  seen text := already_done(p_event_id, 'record_operation');
  op operation%ROWTYPE;
BEGIN
  IF seen IS NOT NULL THEN
    RETURN seen;
  END IF;

  -- The equipment gate and the dependency gate are triggers on this UPDATE, so a start queued
  -- offline against a machine that has since gone out of service is refused here, on replay.
  UPDATE operation SET status = p_status,
         actual_completion = CASE WHEN p_status = 'completed' THEN current_date ELSE actual_completion END
   WHERE id = p_operation_id
  RETURNING * INTO op;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such operation, or it is not yours to change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('operation', p_operation_id, p_status::text, who, op.description);

  PERFORM record_result(p_event_id, p_status::text);
  RETURN p_status::text;
END;
$$;

-- Issuing material is issue_material() in auth.sql, because it had to be the only door stock moves
-- through. This wraps it with the same replay protection as the other two.
CREATE FUNCTION issue_material_offline(p_item_id bigint, p_quantity numeric, p_jobcard_id bigint,
                                       p_note text DEFAULT NULL, p_event_id text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('taking material off the shelf');
  seen text := already_done(p_event_id, 'issue_material');
  movement bigint;
BEGIN
  IF seen IS NOT NULL THEN
    RETURN seen;
  END IF;
  movement := issue_material(p_item_id, p_quantity, p_jobcard_id, p_note);
  PERFORM record_result(p_event_id, (SELECT ref FROM stock_movement WHERE id = movement));
  RETURN (SELECT ref FROM stock_movement WHERE id = movement);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- People
--
-- Until this existed, adding somebody to the system meant opening psql. A workshop cannot start
-- using a thing it has no way to give anybody access to, so these are the workflows behind an admin
-- screen: make a person, give them a way in, take it away again.
--
-- The awkward one is the first admin. There is no admin to create them, and every rule below is
-- written for a system that already has one. The answer is a function that works exactly once and
-- refuses forever after — not a default password, not a hardcoded account, not a flag somebody has
-- to remember to turn off. It checks whether the table is empty, which is a condition that becomes
-- false the moment it succeeds and cannot become true again without deleting everybody.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION bootstrap_first_admin(p_email text, p_display_name text, p_password text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  made bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM app_user) THEN
    -- Not insufficient_privilege, and the difference is not pedantry. server.js replaces the text of
    -- every 42501 with "that is not yours to do", because Postgres writes its own privilege errors
    -- as "permission denied for table stock_item" and that names the inside of the database to
    -- whoever asked. This refusal is not about who is asking — nobody is signed in, and nobody can
    -- be — it is about the state the system is in, and it was written to be read. Raised as 42501 it
    -- reached the first-run screen as "that is not yours to do", which is both wrong and useless to
    -- the person standing in front of it. A plain RAISE carries its own words through.
    RAISE EXCEPTION 'this system already has people in it — an admin adds the next one';
  END IF;
  INSERT INTO app_user (email, display_name, role)
  VALUES (lower(btrim(p_email)), btrim(p_display_name), 'admin')
  RETURNING id INTO made;
  PERFORM set_password(made, p_password);
  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('app_user', made, 'first admin created', lower(btrim(p_email)), 'system had no people in it');
  RETURN lower(btrim(p_email));
END;
$$;

CREATE FUNCTION add_person(p_email text, p_display_name text, p_role user_role)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  made bigint;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'only an admin adds people' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- No secret here on purpose. A person is created with no way in at all, and an admin then gives
  -- them one — which means there is never a moment where an account exists with a password somebody
  -- chose for them and never changed.
  INSERT INTO app_user (email, display_name, role)
  VALUES (lower(btrim(p_email)), btrim(p_display_name), p_role)
  RETURNING id INTO made;
  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('app_user', made, 'created', current_app_name(), p_role::text || ' ' || lower(btrim(p_email)));
  RETURN made;
END;
$$;

CREATE FUNCTION set_person_pin(p_user_id bigint, p_pin text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'a PIN is set by an admin, in person' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_pin(p_user_id, p_pin);
  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('app_user', p_user_id, 'PIN set', current_app_name(), 'by an admin');
END;
$$;

CREATE FUNCTION set_person_password(p_user_id bigint, p_password text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'only an admin resets somebody else''s password' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_password(p_user_id, p_password);
  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('app_user', p_user_id, 'password reset', current_app_name(), 'by an admin');
END;
$$;

-- Your own password, and you have to prove you know the current one. Without that, anybody who
-- walks past an unlocked tablet owns the account from then on.
CREATE FUNCTION change_my_password(p_current text, p_new text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  me bigint := current_app_user();
  stored text;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'sign in first' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT password_hash INTO stored FROM app_user WHERE id = me;
  IF stored IS NULL OR crypt(p_current, stored) <> stored THEN
    PERFORM pg_sleep(0.1);
    -- Raised plainly, which makes it P0001, which is what server.js carries through with its words
    -- intact. It was invalid_password (28P01) — a code the server does not recognise as a refusal at
    -- all, so the one refusal in this whole flow that an ordinary person meets weekly came back as
    -- "something went wrong at our end". That sends somebody looking for a server fault that is not
    -- there, and leaves the person who mistyped their password with no idea what to do next.
    RAISE EXCEPTION 'that is not your current password';
  END IF;
  PERFORM set_password(me, p_new);
  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('app_user', me, 'password changed', current_app_name(), 'by themselves');
END;
$$;

CREATE FUNCTION set_person_active(p_user_id bigint, p_active boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'only an admin switches somebody off' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- The invariant this protects is "the system always has at least one active admin", and locking
  -- everybody out is easy to do by accident on a Friday afternoon and not recoverable without a
  -- database console.
  --
  -- One line does it, which took writing the second to notice. A "that is the last admin" check
  -- beside this one is unreachable: only an admin gets here, an admin is active, and if they are not
  -- the person being switched off then another active admin exists by definition. The only path to
  -- zero is switching yourself off, and that is what this refuses. A second check that can never
  -- fire is worse than none, because the next person to read it assumes it is doing something.
  IF NOT p_active AND p_user_id = current_app_user() THEN
    RAISE EXCEPTION 'you cannot switch yourself off' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE app_user SET is_active = p_active WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such person' USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- Switching somebody off ends the sessions they are holding, not just the next one they try to
  -- start. A tablet already signed in as them is the thing being taken away.
  IF NOT p_active THEN
    UPDATE app_session SET ended_at = now() WHERE user_id = p_user_id AND ended_at IS NULL;
  END IF;
  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('app_user', p_user_id, CASE WHEN p_active THEN 'switched on' ELSE 'switched off' END,
          current_app_name(), 'by an admin');
END;
$$;

CREATE FUNCTION set_person_role(p_user_id bigint, p_role user_role) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'only an admin changes what somebody may do' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Same invariant, same single line, and the same reason the obvious second check is not here.
  IF p_user_id = current_app_user() AND p_role <> 'admin' THEN
    RAISE EXCEPTION 'you cannot take away your own admin' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE app_user SET role = p_role WHERE id = p_user_id;
  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('app_user', p_user_id, 'role changed', current_app_name(), p_role::text);
END;
$$;

-- The staff list for the admin screen. No hashes — those are not readable by anybody, which is
-- checked in test-auth.js — and the row-level policy already narrows this to what the caller may
-- see, so a welder calling it gets their own row and nothing else.
CREATE FUNCTION people() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id::text, 'email', u.email, 'name', u.display_name, 'role', u.role,
    'active', u.is_active, 'pinSet', u.pin_set_at IS NOT NULL,
    'passwordSet', u.password_set_at IS NOT NULL,
    -- Which of these rows is the caller. The screen needs it to know what it is allowed to offer:
    -- an admin who could switch themselves off, or demote themselves, would be locking the building
    -- from the inside. The database refuses both anyway — this is so the button is never there to
    -- press, which is a different thing from a refusal and both are wanted.
    'isMe', u.id = current_app_user(),
    'lockedUntil', u.locked_until, 'failedAttempts', u.failed_attempts,
    'lastSeen', u.last_seen_at, 'created', u.created_at
  ) ORDER BY u.display_name), '[]'::jsonb) FROM app_user u;
$$;

ALTER FUNCTION bootstrap_first_admin(text, text, text) OWNER TO varmak_engine;
ALTER FUNCTION change_my_password(text, text) OWNER TO varmak_engine;

REVOKE ALL ON FUNCTION bootstrap_first_admin(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION add_person(text, text, user_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_person_pin(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_person_password(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION change_my_password(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_person_active(bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_person_role(bigint, user_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION people() FROM PUBLIC;

-- The bootstrap is callable without a session, because there is nobody to sign in as yet. It is the
-- only function in the system like that, and it refuses the moment the table has anybody in it.
GRANT EXECUTE ON FUNCTION bootstrap_first_admin(text, text, text) TO varmak_api;
GRANT EXECUTE ON FUNCTION add_person(text, text, user_role), set_person_pin(bigint, text),
  set_person_password(bigint, text), set_person_active(bigint, boolean), set_person_role(bigint, user_role)
TO varmak_admin;
GRANT EXECUTE ON FUNCTION change_my_password(text, text), people()
TO varmak_admin, varmak_office, varmak_workshop;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- What the HTTP layer needs to know about a token
--
-- The pool connects as varmak_api, which can read nothing at all — so it cannot look up who a token
-- belongs to, and that is deliberate. This is the one thing it may ask, and the answer is exactly
-- enough to set the session up: who you are, what role to become, and the name to record against
-- whatever you do. Nothing else, and never from anything the client sent.
CREATE FUNCTION session_identity(p_token text)
RETURNS TABLE (user_id bigint, user_role user_role, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id, u.role, u.display_name
    FROM app_session s JOIN app_user u ON u.id = s.user_id
   WHERE s.token = p_token AND s.ended_at IS NULL AND s.expires_at > now() AND u.is_active;
$$;

ALTER FUNCTION session_identity(text) OWNER TO varmak_engine;
REVOKE ALL ON FUNCTION session_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION session_identity(text) TO varmak_api;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Who may call what
--
-- The workflows are granted to the roles whose job they are. The floor books hours, records
-- operations and issues material; the office quotes, accepts, receives and converts.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION already_done(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION require_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_result(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION send_estimate(bigint, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION accept_estimate(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION receive_goods(bigint, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION convert_lead(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION book_hours(bigint, bigint, numeric, date, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_operation(bigint, operation_status, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION issue_material_offline(bigint, numeric, bigint, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION already_done(text, text), record_result(text, text), require_session(text)
TO varmak_admin, varmak_office, varmak_workshop;

GRANT EXECUTE ON FUNCTION send_estimate(bigint, int), accept_estimate(bigint),
  receive_goods(bigint, numeric, text), convert_lead(bigint, text, text)
TO varmak_admin, varmak_office;

GRANT EXECUTE ON FUNCTION book_hours(bigint, bigint, numeric, date, text, text),
  record_operation(bigint, operation_status, text),
  issue_material_offline(bigint, numeric, bigint, text, text)
TO varmak_admin, varmak_office, varmak_workshop;

COMMIT;
