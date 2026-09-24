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
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- The store
--
-- Material could leave the shelf before these — issue_material_offline is what the shop tablet calls —
-- but nothing could put an item on the shelf in the first place, or record steel arriving. So a
-- workshop could issue material it had no way of telling the system it had.
--
-- receive_stock is not receive_goods. That one takes a purchase-order line and derives the order's
-- status from what has arrived against it. This one is the storeman entering steel from a delivery note
-- with no order behind it, which is how a small workshop buys most of what it uses.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION save_stock_item(
  p_id bigint,
  p_code text,
  p_description text,
  p_unit text,
  p_group_id bigint DEFAULT NULL,
  p_subgroup_id bigint DEFAULT NULL,
  p_location_id bigint DEFAULT NULL,
  p_sublocation_id bigint DEFAULT NULL,
  p_bin_code text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_grade text DEFAULT NULL,
  p_dimensions text DEFAULT NULL,
  p_base_unit text DEFAULT NULL,
  p_size_per_unit numeric DEFAULT NULL,
  p_weight_per_base numeric DEFAULT NULL,
  p_unit_weight numeric DEFAULT NULL,
  p_min_stock numeric DEFAULT 0,
  p_reorder_quantity numeric DEFAULT NULL,
  p_heat_no text DEFAULT NULL,
  p_material_cert_ref text DEFAULT NULL,
  p_avg_cost numeric DEFAULT NULL,
  p_last_price numeric DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  saved bigint;
  existing text;
  who text;
BEGIN
  PERFORM require_session('saving a store item');
  who := current_app_name();
  p_min_stock := coalesce(p_min_stock, 0);

  IF coalesce(btrim(p_code), '') = '' THEN
    RAISE EXCEPTION 'a store item needs a code — it is what the label says';
  END IF;
  IF coalesce(btrim(p_description), '') = '' THEN
    RAISE EXCEPTION 'a store item needs a description';
  END IF;
  IF coalesce(btrim(p_unit), '') = '' THEN
    RAISE EXCEPTION 'a store item needs a unit — a number with no unit is not a quantity';
  END IF;

  -- Two rows with one code is two items to the system and one item to whoever is holding the label.
  SELECT description INTO existing FROM stock_item
   WHERE upper(btrim(code)) = upper(btrim(p_code)) AND (p_id IS NULL OR id <> p_id) LIMIT 1;
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'there is already an item coded % — it is %', upper(btrim(p_code)), existing;
  END IF;

  -- `stock` is not a parameter, and that is the whole point of the store. A figure typed straight into
  -- the stock column is a figure with no movement behind it, and the shelf then disagrees with the
  -- record of why. Steel arrives through receive_stock, leaves through issue_material, and is corrected
  -- through record_stocktake — each of which writes the movement that explains itself.
  IF p_id IS NULL THEN
    INSERT INTO stock_item (code, description, unit, group_id, subgroup_id, location_id,
                            sublocation_id, bin_code, category, grade, dimensions, base_unit,
                            size_per_unit, weight_per_base, unit_weight, min_stock, reorder_quantity,
                            heat_no, material_cert_ref, avg_cost, last_price)
    VALUES (upper(btrim(p_code)), btrim(p_description), btrim(p_unit), p_group_id, p_subgroup_id,
            p_location_id, p_sublocation_id, p_bin_code, p_category, p_grade, p_dimensions,
            p_base_unit, p_size_per_unit, p_weight_per_base, p_unit_weight, p_min_stock,
            p_reorder_quantity, p_heat_no, p_material_cert_ref, p_avg_cost, p_last_price)
    RETURNING id INTO saved;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    VALUES ('stock_item', saved, 'created', who, upper(btrim(p_code)) || ' ' || btrim(p_description));
  ELSE
    UPDATE stock_item SET
      code = upper(btrim(p_code)), description = btrim(p_description), unit = btrim(p_unit),
      group_id = p_group_id, subgroup_id = p_subgroup_id, location_id = p_location_id,
      sublocation_id = p_sublocation_id, bin_code = p_bin_code, category = p_category,
      grade = p_grade, dimensions = p_dimensions, base_unit = p_base_unit,
      size_per_unit = p_size_per_unit, weight_per_base = p_weight_per_base,
      unit_weight = p_unit_weight, min_stock = p_min_stock, reorder_quantity = p_reorder_quantity,
      heat_no = p_heat_no, material_cert_ref = p_material_cert_ref,
      avg_cost = p_avg_cost, last_price = p_last_price
     WHERE id = p_id
    RETURNING id INTO saved;
    IF saved IS NULL THEN
      RAISE EXCEPTION 'no such store item, or it is not yours to change'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    VALUES ('stock_item', saved, 'updated', who, upper(btrim(p_code)));
  END IF;
  RETURN saved;
END;
$$;

-- Steel arriving, from a delivery note rather than against an order.
--
-- The average cost is recomputed rather than overwritten, which is the difference between a store that
-- can cost a job and one that can only tell you what the last load cost. Weighted by what was on the
-- shelf and what arrived: fifty kilos at 14.00 plus fifty at 16.00 is a hundred at 15.00, not a hundred
-- at 16.00.
CREATE FUNCTION receive_stock(
  p_item_id bigint,
  p_quantity numeric,
  p_unit_price numeric DEFAULT NULL,
  p_supplier text DEFAULT NULL,
  p_delivery_note text DEFAULT NULL,
  p_heat_no text DEFAULT NULL,
  p_material_cert_ref text DEFAULT NULL,
  p_bin_code text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  item stock_item%ROWTYPE;
  movement_id bigint;
  who text;
BEGIN
  -- The session, read here rather than through require_session(), because this function is owned by
  -- varmak_engine and that role holds no EXECUTE on the helper the three app roles do. Same shape as
  -- issue_material, which is the other engine-owned door onto the store.
  SELECT display_name INTO who FROM app_user WHERE id = current_app_user() AND is_active;
  IF who IS NULL THEN
    RAISE EXCEPTION 'sign in before entering stock' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'a receipt must be for more than nothing';
  END IF;
  -- Locked for the same reason issue_stock locks: two deliveries of the same item entered at the same
  -- moment must not each recompute the average cost from the figure the other started with.
  SELECT * INTO item FROM stock_item WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such store item' USING ERRCODE = 'foreign_key_violation';
  END IF;

  UPDATE stock_item SET
    stock = stock + p_quantity,
    -- Weighted average, and only when a price came with the delivery. A receipt with no price on it
    -- must not drag the average to zero.
    avg_cost = CASE
      WHEN p_unit_price IS NULL THEN item.avg_cost
      WHEN coalesce(item.avg_cost, 0) = 0 OR item.stock <= 0 THEN p_unit_price
      ELSE round(((item.stock * item.avg_cost) + (p_quantity * p_unit_price))
                 / (item.stock + p_quantity), 2)
    END,
    last_price = coalesce(p_unit_price, item.last_price),
    heat_no = coalesce(nullif(btrim(coalesce(p_heat_no, '')), ''), item.heat_no),
    material_cert_ref = coalesce(nullif(btrim(coalesce(p_material_cert_ref, '')), ''),
                                 item.material_cert_ref),
    bin_code = coalesce(nullif(btrim(coalesce(p_bin_code, '')), ''), item.bin_code)
   WHERE id = p_item_id;

  -- The name on the movement is the session's, never the caller's. Same rule as issuing: a record of
  -- who put the steel on the shelf that anybody could sign is not a record.
  INSERT INTO stock_movement (stock_item_id, kind, quantity, moved_by, moved_from, moved_to, unit, note)
  VALUES (p_item_id, 'receipt', p_quantity, who,
          nullif(btrim(coalesce(p_supplier, '')), ''),
          coalesce(nullif(btrim(coalesce(p_bin_code, '')), ''), item.bin_code),
          item.unit,
          nullif(btrim(concat_ws(' · ', nullif(btrim(coalesce(p_delivery_note, '')), ''),
                                 nullif(btrim(coalesce(p_note, '')), ''))), ''))
  RETURNING id INTO movement_id;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('stock_item', p_item_id, 'received', who,
          trim_scale(p_quantity) || ' ' || item.unit || ' of ' || item.code);
  RETURN movement_id;
END;
$$;

-- A stocktake. The counted figure becomes the stock, and the difference becomes a movement that says
-- so — because a shelf corrected without a record is a shelf nobody can reconcile afterwards.
CREATE FUNCTION record_stocktake(p_item_id bigint, p_counted numeric, p_note text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  item stock_item%ROWTYPE;
  movement_id bigint;
  difference numeric;
  who text;
BEGIN
  SELECT display_name INTO who FROM app_user WHERE id = current_app_user() AND is_active;
  IF who IS NULL THEN
    RAISE EXCEPTION 'sign in before recording a count' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_counted IS NULL OR p_counted < 0 THEN
    RAISE EXCEPTION 'a count cannot be less than nothing';
  END IF;
  SELECT * INTO item FROM stock_item WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such store item' USING ERRCODE = 'foreign_key_violation';
  END IF;
  difference := p_counted - item.stock;
  IF difference = 0 THEN
    -- Counted and found right. Nothing to correct, and a movement of nothing would be noise in the
    -- one place a storeman goes to find out why a figure changed.
    RETURN NULL;
  END IF;

  UPDATE stock_item SET stock = p_counted WHERE id = p_item_id;

  INSERT INTO stock_movement (stock_item_id, kind, quantity, moved_by, unit, note)
  VALUES (p_item_id, 'adjustment', abs(difference), who, item.unit,
          concat_ws(' · ', 'counted ' || trim_scale(p_counted) || ', was ' || trim_scale(item.stock),
                    nullif(btrim(coalesce(p_note, '')), '')))
  RETURNING id INTO movement_id;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('stock_item', p_item_id, 'counted', who,
          item.code || ': ' || trim_scale(item.stock) || ' → ' || trim_scale(p_counted));
  RETURN movement_id;
END;
$$;

-- Owned by the engine for the same reason issue_material is: they write a stock movement, and the name
-- on it has to be the session's rather than anything the caller could pass. SECURITY DEFINER is what
-- lets them insert the movement while the caller's own role holds no INSERT on that table directly.
ALTER FUNCTION receive_stock(bigint, numeric, numeric, text, text, text, text, text, text) OWNER TO varmak_engine;
ALTER FUNCTION record_stocktake(bigint, numeric, text) OWNER TO varmak_engine;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Work: the project, the jobcards on it, and the steps on those
--
-- Nothing could get onto the shop floor before these. accept_estimate makes a project out of a
-- quotation that was won, which is the path the estimating screen takes — but a workshop also puts
-- work on the bench that never had a quotation, and there was no way to do that except an INSERT.
--
-- Three functions, and the third is the shape that needed thinking about: a jobcard's steps are a
-- list, like the customer's contacts, but unlike contacts they have hours booked against them. So it
-- cannot be delete-and-rebuild — that would detach every hour ever booked from the step it was booked
-- on, silently, because hours_entry.operation_id is ON DELETE SET NULL. It matches on the id the
-- snapshot handed out instead, and refuses to remove a step somebody has already worked on.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION save_project(
  p_id bigint,
  p_name text,
  p_customer_id bigint,
  p_status text DEFAULT 'quotation',
  p_planned_hours numeric DEFAULT 0,
  p_progress int DEFAULT 0,
  p_deadline date DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_phase text DEFAULT NULL,
  p_work_types text DEFAULT NULL,
  p_po_number text DEFAULT NULL,
  p_workshop text DEFAULT NULL,
  p_responsible text DEFAULT NULL,
  p_material_status text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_planned_start date DEFAULT NULL,
  p_planned_completion date DEFAULT NULL,
  p_expected_completion date DEFAULT NULL,
  p_deliver_on date DEFAULT NULL,
  p_hold_reason text DEFAULT NULL,
  p_hold_comment text DEFAULT NULL,
  p_expected_resume date DEFAULT NULL,
  p_cancel_reason text DEFAULT NULL,
  p_quoted_value numeric DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  saved bigint;
  was project_status;
  who text;
BEGIN
  PERFORM require_session('saving a project');
  p_status := coalesce(p_status, 'quotation');
  -- The frontend carries two names for one state — 'active' in the estimating screen's vocabulary and
  -- 'production' from the estimate-conversion path, aliased to each other in project-rules.js — and
  -- 'draft' as a retired alias of 'quotation'. schema.sql fixed one canonical spelling and said the API
  -- would translate on the way in; this is that. It is the opposite decision from the jobcard priority,
  -- and for a reason: there the screen had one word and the schema had invented another, so the screen
  -- won. Here the screen has two words for the same state, so it cannot be followed — a database that
  -- accepted both would mean every query had to know the aliases.
  p_status := CASE lower(btrim(p_status))
                WHEN 'active' THEN 'production'
                WHEN 'in production' THEN 'production'
                WHEN 'draft' THEN 'quotation'
                ELSE lower(btrim(p_status))
              END;
  p_planned_hours := coalesce(p_planned_hours, 0);
  p_progress := coalesce(p_progress, 0);
  who := current_app_name();

  IF coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'a project needs a name';
  END IF;
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'a project belongs to a customer — say which one';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customer WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'no such customer, or it is not yours to read'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- used_hours is not a parameter and must never become one. It is a running total the hours entries
  -- maintain by trigger, and a screen that could set it could make a project claim work nobody did.
  IF p_id IS NULL THEN
    INSERT INTO project (name, customer_id, status, planned_hours, progress, deadline, description,
                         phase, work_types, po_number, workshop, responsible, material_status, notes,
                         planned_start, planned_completion, expected_completion, actual_completion,
                         hold_reason, hold_comment, expected_resume, cancel_reason, quoted_value)
    VALUES (btrim(p_name), p_customer_id, p_status::project_status, p_planned_hours, p_progress,
            p_deadline, p_description, p_phase, p_work_types, p_po_number, p_workshop, p_responsible,
            p_material_status, p_notes, p_planned_start, p_planned_completion, p_expected_completion,
            p_deliver_on, p_hold_reason, p_hold_comment, p_expected_resume, p_cancel_reason,
            p_quoted_value)
    RETURNING id INTO saved;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    VALUES ('project', saved, 'created', who, btrim(p_name));
  ELSE
    SELECT status INTO was FROM project WHERE id = p_id;
    IF was IS NULL THEN
      RAISE EXCEPTION 'no such project, or it is not yours to change'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- The status is assigned like any other field and the transition trigger has the last word on
    -- whether this one was allowed. Checking it here as well would be a second copy of the rulebook,
    -- and the rulebook is a table precisely so there is only one.
    UPDATE project SET
      name = btrim(p_name), customer_id = p_customer_id, status = p_status::project_status,
      planned_hours = p_planned_hours, progress = p_progress, deadline = p_deadline,
      description = p_description, phase = p_phase, work_types = p_work_types,
      po_number = p_po_number, workshop = p_workshop, responsible = p_responsible,
      material_status = p_material_status, notes = p_notes, planned_start = p_planned_start,
      planned_completion = p_planned_completion, expected_completion = p_expected_completion,
      actual_completion = p_deliver_on, hold_reason = p_hold_reason, hold_comment = p_hold_comment,
      expected_resume = p_expected_resume, cancel_reason = p_cancel_reason,
      quoted_value = p_quoted_value
     WHERE id = p_id
    RETURNING id INTO saved;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    VALUES ('project', saved, CASE WHEN was::text = p_status THEN 'updated' ELSE p_status END,
            who, btrim(p_name));
  END IF;
  RETURN saved;
END;
$$;

CREATE FUNCTION save_jobcard(
  p_id bigint,
  p_project_id bigint,
  p_title text,
  p_status text DEFAULT 'draft',
  p_item text DEFAULT NULL,
  p_quantity int DEFAULT 1,
  p_drawing_no text DEFAULT NULL,
  p_revision int DEFAULT 0,
  p_planned_hours numeric DEFAULT 0,
  p_planned_start date DEFAULT NULL,
  p_planned_completion date DEFAULT NULL,
  p_delivery_target date DEFAULT NULL,
  p_work_type text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_responsible text DEFAULT NULL,
  p_material_readiness text DEFAULT NULL,
  p_heat_no text DEFAULT NULL,
  p_material_cert_ref text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_progress int DEFAULT 0,
  p_inspection_required boolean DEFAULT false
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  saved bigint;
  owner bigint;
  project_name text;
  who text;
BEGIN
  PERFORM require_session('saving a jobcard');
  p_status := coalesce(p_status, 'draft');
  p_quantity := coalesce(p_quantity, 1);
  p_revision := coalesce(p_revision, 0);
  p_planned_hours := coalesce(p_planned_hours, 0);
  p_progress := coalesce(p_progress, 0);
  who := current_app_name();

  IF coalesce(btrim(p_title), '') = '' THEN
    RAISE EXCEPTION 'a jobcard needs a title — it is what the person at the bench reads first';
  END IF;
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'a jobcard belongs to a project — say which one';
  END IF;
  -- The customer comes from the project, and there is no parameter for it. A jobcard carrying a
  -- different customer from its project is a record that makes every report disagree with itself, and
  -- nobody would ever look at the two columns side by side to notice.
  SELECT customer_id, name INTO owner, project_name FROM project WHERE id = p_project_id;
  IF owner IS NULL THEN
    RAISE EXCEPTION 'no such project, or it is not yours to read'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO jobcard (project_id, customer_id, title, status, item, quantity, drawing_no,
                         revision, planned_hours, planned_start, planned_completion, delivery_target,
                         work_type, location, priority, responsible, material_readiness, heat_no,
                         material_cert_ref, notes, progress, inspection_required, created_by)
    VALUES (p_project_id, owner, btrim(p_title), p_status::jobcard_status, p_item, p_quantity,
            p_drawing_no, p_revision, p_planned_hours, p_planned_start, p_planned_completion,
            p_delivery_target, p_work_type, p_location, p_priority, p_responsible,
            p_material_readiness, p_heat_no, p_material_cert_ref, p_notes, p_progress,
            coalesce(p_inspection_required, false), who)
    RETURNING id INTO saved;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    VALUES ('jobcard', saved, 'created', who, project_name || ' — ' || btrim(p_title));
  ELSE
    UPDATE jobcard SET
      project_id = p_project_id, customer_id = owner, title = btrim(p_title),
      status = p_status::jobcard_status, item = p_item, quantity = p_quantity,
      drawing_no = p_drawing_no, revision = p_revision, planned_hours = p_planned_hours,
      planned_start = p_planned_start, planned_completion = p_planned_completion,
      delivery_target = p_delivery_target, work_type = p_work_type, location = p_location,
      priority = p_priority, responsible = p_responsible, material_readiness = p_material_readiness,
      heat_no = p_heat_no, material_cert_ref = p_material_cert_ref, notes = p_notes,
      progress = p_progress, inspection_required = coalesce(p_inspection_required, false)
     WHERE id = p_id
    RETURNING id INTO saved;
    IF saved IS NULL THEN
      RAISE EXCEPTION 'no such jobcard, or it is not yours to change'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    VALUES ('jobcard', saved, 'updated', who, btrim(p_title));
  END IF;
  RETURN saved;
END;
$$;

-- The steps on a jobcard. Matched on the id the snapshot handed out rather than rebuilt, for one
-- reason: hours are booked against a step, and hours_entry.operation_id is ON DELETE SET NULL — so
-- deleting and reinserting the list would leave every hour ever booked pointing at nothing, with no
-- error and nothing on screen to say it had happened. What the workshop would lose is the answer to
-- "how long did the weld-out actually take", which is the only number that makes the next estimate
-- better than a guess.
CREATE FUNCTION set_jobcard_operations(p_jobcard_id bigint, p_operations jsonb) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  row_in jsonb;
  at int := 0;
  keeping bigint[] := ARRAY[]::bigint[];
  doomed record;
  title text;
BEGIN
  PERFORM require_session('saving the steps on a jobcard');
  SELECT j.title INTO title FROM jobcard j WHERE j.id = p_jobcard_id;
  IF title IS NULL THEN
    RAISE EXCEPTION 'no such jobcard, or it is not yours to change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  p_operations := coalesce(p_operations, '[]'::jsonb);
  IF jsonb_typeof(p_operations) <> 'array' THEN
    RAISE EXCEPTION 'the steps have to arrive as a list';
  END IF;

  FOR row_in IN SELECT * FROM jsonb_array_elements(p_operations) LOOP
    IF coalesce(btrim(row_in->>'desc'), '') = '' THEN
      RAISE EXCEPTION 'every step needs a description — step % has none', at + 1;
    END IF;
    IF (row_in->>'id') IS NOT NULL AND (row_in->>'id') <> '' THEN
      keeping := keeping || (row_in->>'id')::bigint;
    END IF;
    at := at + 1;
  END LOOP;

  -- Refused before anything is written, and named. A step somebody has booked hours on, or has
  -- started, is a record of what happened rather than a line on a plan.
  FOR doomed IN
    SELECT o.seq, o.description, o.logged_hours, o.status FROM operation o
     WHERE o.jobcard_id = p_jobcard_id AND NOT (o.id = ANY (keeping))
     ORDER BY o.seq
  LOOP
    IF doomed.logged_hours > 0 THEN
      RAISE EXCEPTION 'step % (%) has % hours booked on it and cannot be taken off the jobcard',
        doomed.seq, doomed.description, doomed.logged_hours;
    END IF;
    IF doomed.status <> 'pending' THEN
      RAISE EXCEPTION 'step % (%) is % and cannot be taken off the jobcard',
        doomed.seq, doomed.description, doomed.status;
    END IF;
  END LOOP;

  DELETE FROM operation o WHERE o.jobcard_id = p_jobcard_id AND NOT (o.id = ANY (keeping));

  -- Checked at the end of this transaction rather than statement by statement, because writing seq 1
  -- where seq 2 was while 1 is still 1 collides halfway through a re-order that is perfectly fine by
  -- the time it finishes. The constraint is not relaxed — it is checked once, on the finished list.
  SET CONSTRAINTS operation_one_step_per_place DEFERRED;

  at := 0;
  FOR row_in IN SELECT * FROM jsonb_array_elements(p_operations) LOOP
    at := at + 1;
    IF (row_in->>'id') IS NOT NULL AND (row_in->>'id') <> '' THEN
      -- The sequence is the position in the list the screen sent, so it cannot arrive with a gap or
      -- with two steps claiming to be the third. The caller does not get to choose it.
      UPDATE operation SET
        description = btrim(row_in->>'desc'),
        instructions = nullif(btrim(coalesce(row_in->>'instructions', '')), ''),
        planned_hours = coalesce((row_in->>'plannedHours')::numeric, 0),
        planned_start = (row_in->>'plannedStart')::date,
        inspection_checkpoint = coalesce((row_in->>'inspectionCheckpoint')::boolean, false),
        notes = nullif(btrim(coalesce(row_in->>'notes', '')), ''),
        seq = at
       WHERE id = (row_in->>'id')::bigint AND jobcard_id = p_jobcard_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'step % is not on this jobcard', row_in->>'id';
      END IF;
    ELSE
      INSERT INTO operation (jobcard_id, seq, description, instructions, planned_hours,
                             planned_start, inspection_checkpoint, notes)
      VALUES (p_jobcard_id, at, btrim(row_in->>'desc'),
              nullif(btrim(coalesce(row_in->>'instructions', '')), ''),
              coalesce((row_in->>'plannedHours')::numeric, 0),
              (row_in->>'plannedStart')::date,
              coalesce((row_in->>'inspectionCheckpoint')::boolean, false),
              nullif(btrim(coalesce(row_in->>'notes', '')), ''));
    END IF;
  END LOOP;
  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('jobcard', p_jobcard_id, 'steps changed', current_app_name(),
          at::text || ' step' || CASE WHEN at = 1 THEN '' ELSE 's' END);
  RETURN at;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Customers
--
-- The first record a workshop starting from nothing has to be able to make, and until now there was
-- no way to make one except an INSERT. Two functions, because the customer and the people at the
-- customer are two different shapes: one row, and a list.
--
-- save_customer REPLACES the record rather than patching it. That is a decision and it is the
-- screen's shape: the customer page holds the whole record in the browser and hands all of it back,
-- so a function that treated a missing field as "leave it alone" would be answering a question the
-- caller never asks, while quietly making it impossible to clear a field. Passing NULL clears it,
-- which is what the person did when they emptied the box.
--
-- The commercial half — the credit limit, the terms, the price list, the discount agreement, the
-- billing address — is in the same function rather than a second one, because the policy on customer
-- already says only may_see_money() may write the table at all. A welder does not reach this.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION save_customer(
  p_id bigint,
  p_name text,
  p_status text DEFAULT 'active',
  p_city text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_org_no text DEFAULT NULL,
  p_vat_no text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_customer_since date DEFAULT NULL,
  p_customer_type text DEFAULT NULL,
  p_is_preferred boolean DEFAULT false,
  p_preferred_contact text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_credit_limit numeric DEFAULT NULL,
  p_currency text DEFAULT 'SEK',
  p_payment_terms_days int DEFAULT NULL,
  p_price_list text DEFAULT NULL,
  p_delivery_terms text DEFAULT NULL,
  p_discount_agreement text DEFAULT NULL,
  p_billing_address text DEFAULT NULL,
  p_shipping_address text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  saved bigint;
  existing text;
BEGIN
  PERFORM require_session('saving a customer');
  -- Every defaulted parameter is coalesced, because a JSON null on the wire arrives as a SQL NULL
  -- and overrides the DEFAULT rather than falling back to it. That has caught this project before.
  p_status := coalesce(p_status, 'active');
  p_currency := upper(coalesce(nullif(btrim(p_currency), ''), 'SEK'));
  p_is_preferred := coalesce(p_is_preferred, false);

  IF coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'a customer needs a name';
  END IF;

  -- The name, not the reference. Two rows called Skåne Verkstad AB is two customers as far as every
  -- report is concerned and one customer as far as anybody in the building is concerned, and the
  -- second one is made by somebody who searched, did not find it, and typed it again.
  SELECT ref INTO existing FROM customer
   WHERE lower(btrim(name)) = lower(btrim(p_name))
     AND (p_id IS NULL OR id <> p_id)
   LIMIT 1;
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'there is already a customer called % — it is %', btrim(p_name), existing;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO customer (name, status, city, country, org_no, vat_no, email, phone, website,
                          industry, customer_since, customer_type, is_preferred, preferred_contact,
                          notes, credit_limit, currency, payment_terms_days, price_list,
                          delivery_terms, discount_agreement, billing_address, shipping_address)
    VALUES (btrim(p_name), p_status, p_city, p_country, p_org_no, p_vat_no, p_email, p_phone,
            p_website, p_industry, p_customer_since, p_customer_type, p_is_preferred,
            p_preferred_contact, p_notes, p_credit_limit, p_currency, p_payment_terms_days,
            p_price_list, p_delivery_terms, p_discount_agreement, p_billing_address,
            p_shipping_address)
    RETURNING id INTO saved;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    VALUES ('customer', saved, 'created', current_app_name(), btrim(p_name));
  ELSE
    UPDATE customer SET
      name = btrim(p_name), status = p_status, city = p_city, country = p_country,
      org_no = p_org_no, vat_no = p_vat_no, email = p_email, phone = p_phone, website = p_website,
      industry = p_industry, customer_since = p_customer_since, customer_type = p_customer_type,
      is_preferred = p_is_preferred, preferred_contact = p_preferred_contact, notes = p_notes,
      credit_limit = p_credit_limit,
      currency = p_currency, payment_terms_days = p_payment_terms_days, price_list = p_price_list,
      delivery_terms = p_delivery_terms, discount_agreement = p_discount_agreement,
      billing_address = p_billing_address, shipping_address = p_shipping_address
     WHERE id = p_id
    RETURNING id INTO saved;
    -- Row-level security filters rather than refuses, so an UPDATE nobody is allowed to make simply
    -- changes nothing and reports success. NOT FOUND is the only thing that tells the difference.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no such customer, or it is not yours to change'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    VALUES ('customer', saved, 'updated', current_app_name(), btrim(p_name));
  END IF;
  RETURN saved;
END;
$$;

-- The whole list at once, because that is how the screen holds it: it hands back the contacts as
-- they now stand rather than telling anybody which one changed. Replacing them inside one
-- transaction is therefore the honest translation, and it is atomic — a refused list leaves the old
-- one exactly as it was rather than half of it.
CREATE FUNCTION set_customer_contacts(p_customer_id bigint, p_contacts jsonb) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  row_in jsonb;
  mains int := 0;
  kept int := 0;
  owner text;
BEGIN
  PERFORM require_session('saving contacts');
  SELECT name INTO owner FROM customer WHERE id = p_customer_id;
  IF owner IS NULL THEN
    RAISE EXCEPTION 'no such customer, or it is not yours to change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  p_contacts := coalesce(p_contacts, '[]'::jsonb);
  IF jsonb_typeof(p_contacts) <> 'array' THEN
    RAISE EXCEPTION 'the contacts have to arrive as a list';
  END IF;

  -- Counted before anything is written, so the refusal is a sentence rather than the name of a
  -- unique index. The index behind it is what makes the rule true; this is what makes it readable.
  FOR row_in IN SELECT * FROM jsonb_array_elements(p_contacts) LOOP
    IF coalesce(btrim(row_in->>'name'), '') = '' THEN
      RAISE EXCEPTION 'a contact needs a name';
    END IF;
    IF coalesce(btrim(row_in->>'email'), '') = '' AND coalesce(btrim(row_in->>'phone'), '') = '' THEN
      RAISE EXCEPTION 'give % an email or a telephone number — a contact nobody can reach is not one',
        btrim(row_in->>'name');
    END IF;
    IF coalesce((row_in->>'primary')::boolean, false) THEN
      mains := mains + 1;
    END IF;
  END LOOP;
  IF mains > 1 THEN
    RAISE EXCEPTION '% has one main contact, and this list has %', owner, mains;
  END IF;

  DELETE FROM customer_contact WHERE customer_id = p_customer_id;
  FOR row_in IN SELECT * FROM jsonb_array_elements(p_contacts) LOOP
    INSERT INTO customer_contact (customer_id, name, role, email, phone, is_primary)
    VALUES (p_customer_id, btrim(row_in->>'name'), nullif(btrim(coalesce(row_in->>'role', '')), ''),
            nullif(btrim(coalesce(row_in->>'email', '')), ''),
            nullif(btrim(coalesce(row_in->>'phone', '')), ''),
            coalesce((row_in->>'primary')::boolean, false));
    kept := kept + 1;
  END LOOP;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('customer', p_customer_id, 'contacts changed', current_app_name(),
          kept::text || ' contact' || CASE WHEN kept = 1 THEN '' ELSE 's' END);
  RETURN kept;
END;
$$;

REVOKE ALL ON FUNCTION save_customer(bigint, text, text, text, text, text, text, text, text, text,
  text, date, text, boolean, text, text, numeric, text, int, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_project(bigint, text, bigint, text, numeric, int, date, text, text, text, text, text,
                text, text, text, date, date, date, date, text, text, date, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_jobcard(bigint, bigint, text, text, text, int, text, int, numeric, date, date, date,
                text, text, text, text, text, text, text, text, int, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_jobcard_operations(bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_stock_item(bigint, text, text, text, bigint, bigint, bigint, bigint, text, text, text,
                  text, text, numeric, numeric, numeric, numeric, numeric, text, text, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION receive_stock(bigint, numeric, numeric, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_stocktake(bigint, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_customer_contacts(bigint, jsonb) FROM PUBLIC;
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
  receive_goods(bigint, numeric, text), convert_lead(bigint, text, text),
  save_customer(bigint, text, text, text, text, text, text, text, text, text, text, date, text,
                boolean, text, text, numeric, text, int, text, text, text, text, text),
  set_customer_contacts(bigint, jsonb),
  save_project(bigint, text, bigint, text, numeric, int, date, text, text, text, text, text,
                text, text, text, date, date, date, date, text, text, date, text, numeric),
  save_jobcard(bigint, bigint, text, text, text, int, text, int, numeric, date, date, date,
                text, text, text, text, text, text, text, text, int, boolean),
  set_jobcard_operations(bigint, jsonb),
  save_stock_item(bigint, text, text, text, bigint, bigint, bigint, bigint, text, text, text,
                  text, text, numeric, numeric, numeric, numeric, numeric, text, text, numeric, numeric),
  receive_stock(bigint, numeric, numeric, text, text, text, text, text, text),
  record_stocktake(bigint, numeric, text)
TO varmak_admin, varmak_office;

GRANT EXECUTE ON FUNCTION book_hours(bigint, bigint, numeric, date, text, text),
  record_operation(bigint, operation_status, text),
  issue_material_offline(bigint, numeric, bigint, text, text)
TO varmak_admin, varmak_office, varmak_workshop;

COMMIT;
