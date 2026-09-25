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

-- The same grant-and-revoke as auth.sql does around its ownership changes, and for the same reason:
-- Postgres requires the incoming owner to hold CREATE on the schema, and on PostgreSQL 15 and later
-- `public` does not grant that to everybody. See the long note there.
GRANT CREATE ON SCHEMA public TO varmak_engine;

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

-- CREATE on the schema stays granted through the equipment section below, which has the last
-- ownership change in the file; it is revoked at the end of that section.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- The machines, and what has been done to them
--
-- The equipment register was the strangest gap in this system: every safety gate in the app reads it,
-- the jobcard screen refuses to attach a machine that may not be run, the shop-floor hours screen
-- refuses to book time against one — and nothing could put a machine in the register, mark it serviced,
-- or sign a check before use. The gates were real and had nothing to read. `equipment-gates.js` has
-- looked for a passed pre-use check since it was written, and the answer was always "there isn't one".
--
-- Two functions, and the split is the authorisation. Editing the register is the office's job — what a
-- machine is, what it cost, when its certificate runs out. Signing a check before running it is the
-- welder's, and it is the one thing on this screen the floor may write: a check nobody on the floor can
-- record is a check the office signs for machines it is not standing in front of.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION save_equipment(
  p_id bigint,
  p_ref text,
  p_name text,
  p_category text,
  p_status equipment_status DEFAULT 'Available',
  p_manufacturer text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_serial_no text DEFAULT NULL,
  p_asset_no text DEFAULT NULL,
  p_year_of_manufacture int DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_current_location text DEFAULT NULL,
  p_home_location text DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_responsible_person text DEFAULT NULL,
  p_operator text DEFAULT NULL,
  p_condition text DEFAULT NULL,
  p_criticality text DEFAULT NULL,
  p_safety_warnings text DEFAULT NULL,
  p_certification_expiry date DEFAULT NULL,
  p_purchase_date date DEFAULT NULL,
  p_purchase_supplier text DEFAULT NULL,
  p_purchase_price numeric DEFAULT NULL,
  p_warranty_expiry date DEFAULT NULL,
  p_operating_hours numeric DEFAULT NULL,
  p_service_interval_hours int DEFAULT NULL,
  p_qr_code text DEFAULT NULL,
  p_pre_use_check_required boolean DEFAULT false,
  p_notes text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  saved bigint;
  existing text;
  who text;
BEGIN
  PERFORM require_session('saving a machine');
  who := current_app_name();

  IF coalesce(btrim(p_ref), '') = '' THEN
    RAISE EXCEPTION 'a machine needs a reference — it is what is written on the machine itself';
  END IF;
  IF coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'a machine needs a name';
  END IF;
  IF coalesce(btrim(p_category), '') = '' THEN
    RAISE EXCEPTION 'a machine needs a category — it is what the safety rules are grouped by';
  END IF;

  -- Two rows under one reference is two machines to the system and one machine to whoever is standing
  -- in front of it, which is how a service record ends up on the wrong press.
  SELECT name INTO existing FROM equipment
   WHERE upper(btrim(ref)) = upper(btrim(p_ref)) AND (p_id IS NULL OR id <> p_id) LIMIT 1;
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'there is already a machine referenced % — it is %', upper(btrim(p_ref)), existing;
  END IF;

  -- The three dates a machine is judged by are not touched here, and that is deliberate: the date of
  -- the last service, inspection and calibration are what record_equipment_event writes, from the event
  -- that actually happened. A form that could type them in is a form that can claim a service nobody
  -- performed, which is exactly the claim a certificate is supposed to make impossible.
  IF p_id IS NULL THEN
    INSERT INTO equipment (ref, name, category, status, manufacturer, model, serial_no, asset_no,
                           year_of_manufacture, description, current_location, home_location,
                           department, responsible_person, operator, condition, criticality,
                           safety_warnings, certification_expiry, purchase_date, purchase_supplier,
                           purchase_price, warranty_expiry, operating_hours, service_interval_hours,
                           qr_code, pre_use_check_required, notes)
    VALUES (upper(btrim(p_ref)), btrim(p_name), btrim(p_category), p_status, p_manufacturer, p_model,
            p_serial_no, p_asset_no, p_year_of_manufacture, p_description, p_current_location,
            p_home_location, p_department, p_responsible_person, p_operator, p_condition,
            p_criticality, p_safety_warnings, p_certification_expiry, p_purchase_date,
            p_purchase_supplier, p_purchase_price, p_warranty_expiry, coalesce(p_operating_hours, 0),
            p_service_interval_hours, p_qr_code, coalesce(p_pre_use_check_required, false), p_notes)
    RETURNING id INTO saved;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    VALUES ('equipment', saved, 'created', who, upper(btrim(p_ref)) || ' ' || btrim(p_name));
  ELSE
    UPDATE equipment SET
      ref = upper(btrim(p_ref)), name = btrim(p_name), category = btrim(p_category),
      status = p_status, manufacturer = p_manufacturer, model = p_model, serial_no = p_serial_no,
      asset_no = p_asset_no, year_of_manufacture = p_year_of_manufacture, description = p_description,
      current_location = p_current_location, home_location = p_home_location,
      department = p_department, responsible_person = p_responsible_person, operator = p_operator,
      condition = p_condition, criticality = p_criticality, safety_warnings = p_safety_warnings,
      certification_expiry = p_certification_expiry, purchase_date = p_purchase_date,
      purchase_supplier = p_purchase_supplier, purchase_price = p_purchase_price,
      warranty_expiry = p_warranty_expiry,
      operating_hours = coalesce(p_operating_hours, operating_hours),
      service_interval_hours = p_service_interval_hours, qr_code = p_qr_code,
      pre_use_check_required = coalesce(p_pre_use_check_required, false), notes = p_notes
     WHERE id = p_id
    RETURNING id INTO saved;
    IF saved IS NULL THEN
      RAISE EXCEPTION 'no such machine, or it is not yours to change'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    VALUES ('equipment', saved, 'updated', who, upper(btrim(p_ref)));
  END IF;
  RETURN saved;
END;
$$;

-- Something happened to a machine: it was serviced, calibrated, inspected, repaired, it broke down, or
-- somebody signed a check before running it.
--
-- One function for all six because they are one fact — a dated record of who did what to which machine
-- and how it came out — and six functions would be six places for the date of the last service to be
-- written differently. The kind decides which of the three "last done" dates moves, which is the only
-- branch in here.
--
-- Who performed it is the session, never a parameter. A service record somebody else's name can be put
-- on is not a service record, and a pre-use check signed in another welder's name is worse than none.
-- What an event does to the machine, and the only function in the system allowed to write it.
--
-- Two columns, both of which have to move and neither of which any of the three roles should hold
-- directly: the date a machine was last serviced, and its status when it breaks down. A welder with
-- UPDATE on equipment.status could bring a quarantined machine back into service; a welder with UPDATE
-- on last_service_date could claim a service nobody performed. So this runs as varmak_engine, does
-- exactly these two things, and every other route to those columns stays shut.
--
-- Split out rather than making record_equipment_event itself SECURITY DEFINER, which is the shape
-- issue_material_offline already uses: the replay protection stays in the caller's own role — where the
-- grants on device_event are — and only the write nobody should hold runs as the engine.
CREATE FUNCTION equipment_state_after_event(
  p_equipment_id bigint,
  p_kind equipment_event_kind,
  p_result text,
  p_day date
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Keyed on the kind as well as the result, and not only for tidiness: written on the result alone, a
  -- pre-use check that passed ran an UPDATE changing all three dates to their own current values — a
  -- no-op that still needs the privilege to write them.
  IF p_result IN ('pass', 'done') AND p_kind IN ('service', 'repair', 'inspection', 'calibration') THEN
    UPDATE equipment SET
      last_service_date = CASE WHEN p_kind IN ('service', 'repair') THEN p_day ELSE last_service_date END,
      last_inspection_date = CASE WHEN p_kind = 'inspection' THEN p_day ELSE last_inspection_date END,
      last_calibration_date = CASE WHEN p_kind = 'calibration' THEN p_day ELSE last_calibration_date END
     WHERE id = p_equipment_id;
  END IF;

  -- A breakdown takes the machine out of service by itself. Nobody has to remember to, which is the
  -- point: the record of the breakdown and the machine being stopped are the same event, and a shop
  -- where they are two actions is a shop where one of them gets missed.
  IF p_kind = 'breakdown' THEN
    UPDATE equipment SET status = 'Out of Service' WHERE id = p_equipment_id;
  END IF;
END;
$$;

CREATE FUNCTION record_equipment_event(
  p_equipment_id bigint,
  p_kind equipment_event_kind,
  p_result text,
  p_happened_on date DEFAULT NULL,
  p_next_due_on date DEFAULT NULL,
  p_cost numeric DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_jobcard_id bigint DEFAULT NULL,
  p_resolves_event_id bigint DEFAULT NULL,
  p_event_id text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('recording what happened to a machine');
  seen text := already_done(p_event_id, 'record_equipment_event');
  machine text;
  made bigint;
  on_day date := coalesce(p_happened_on, current_date);
BEGIN
  -- Replay protection, for the same reason booking hours has it: a pre-use check is signed at the
  -- machine, which is where the signal dies, and a second check for the same press is a second record
  -- of a thing that happened once.
  IF seen IS NOT NULL THEN
    RETURN seen;
  END IF;

  SELECT name INTO machine FROM equipment WHERE id = p_equipment_id;
  IF machine IS NULL THEN
    RAISE EXCEPTION 'no such machine' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF on_day > current_date THEN
    RAISE EXCEPTION 'a service or a check cannot be recorded for a date that has not happened yet'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO equipment_event (equipment_id, kind, happened_on, performed_by, result, next_due_on,
                               cost, note, jobcard_id, resolves_event_id)
  VALUES (p_equipment_id, p_kind, on_day, who, p_result, p_next_due_on, p_cost, p_note,
          p_jobcard_id, p_resolves_event_id)
  RETURNING id INTO made;

  -- An event that answers an earlier failure marks that failure answered. Done here rather than left
  -- to the caller, because a resolution recorded without it is a machine that stays stopped for a
  -- reason somebody has already dealt with — and the gate reads the flag, not the link.
  IF p_resolves_event_id IS NOT NULL THEN
    UPDATE equipment_event SET resolved = true
     WHERE id = p_resolves_event_id AND equipment_id = p_equipment_id;
  END IF;

  -- The date a machine is judged by moves only when the thing that sets it actually happened and
  -- passed. A failed inspection is not an inspection date; it is a reason the machine is stopped.
  -- What the event does to the machine itself, through the one function allowed to write those columns.
  PERFORM equipment_state_after_event(p_equipment_id, p_kind, p_result, on_day);

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('equipment', p_equipment_id, p_kind::text, who,
          machine || ': ' || p_result || coalesce(' — ' || p_note, ''));

  PERFORM record_result(p_event_id, 'E-' || made);
  RETURN 'E-' || made;
END;
$$;

-- A machine taken to a bench, and brought back.
--
-- One row per period a machine spends on a jobcard, and a partial unique index that refuses the second
-- live one — so "which jobcard is the plasma cutter on" has exactly one answer and the database is what
-- makes that true, not the screen that happens to ask.
--
-- Nothing here changes the machine's status, and that is deliberate. A machine on a bench is still
-- available in the sense the safety gates mean: `available` versus `out-of-service` is about whether it
-- may be run at all, and overwriting it with something about where it is would make the gate read the
-- wrong question. Where it is, is the assignment — which the snapshot carries as `assignedJobcard`.
CREATE FUNCTION assign_equipment(
  p_equipment_id bigint,
  p_jobcard_id bigint,
  p_event_id text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('assigning a machine');
  seen text := already_done(p_event_id, 'assign_equipment');
  machine text;
  card text;
  held text;
  made bigint;
BEGIN
  IF seen IS NOT NULL THEN
    RETURN seen;
  END IF;

  SELECT name INTO machine FROM equipment WHERE id = p_equipment_id;
  IF machine IS NULL THEN
    RAISE EXCEPTION 'no such machine' USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT ref INTO card FROM jobcard WHERE id = p_jobcard_id;
  IF card IS NULL THEN
    RAISE EXCEPTION 'no such jobcard' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Named before the index refuses it, because "duplicate key value violates unique constraint
  -- equipment_one_live_assignment" tells a welder nothing and the answer they need is which jobcard has
  -- it. The index is still what makes this true under two requests arriving together.
  SELECT j.ref INTO held FROM equipment_assignment a JOIN jobcard j ON j.id = a.jobcard_id
   WHERE a.equipment_id = p_equipment_id AND a.released_at IS NULL LIMIT 1;
  IF held IS NOT NULL THEN
    IF held = card THEN
      -- Already where it is being sent. Not an error: two people pressing the same button is not a
      -- mistake, and a refusal here would read as one.
      PERFORM record_result(p_event_id, card);
      RETURN card;
    END IF;
    RAISE EXCEPTION '% is on % — return it from there first', machine, held
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO equipment_assignment (equipment_id, jobcard_id) VALUES (p_equipment_id, p_jobcard_id)
  RETURNING id INTO made;
  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('equipment', p_equipment_id, 'assigned', who, machine || ' to ' || card);

  PERFORM record_result(p_event_id, card);
  RETURN card;
END;
$$;

CREATE FUNCTION return_equipment(
  p_equipment_id bigint,
  p_note text DEFAULT NULL,
  p_event_id text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('returning a machine');
  seen text := already_done(p_event_id, 'return_equipment');
  machine text;
  card text;
BEGIN
  IF seen IS NOT NULL THEN
    RETURN seen;
  END IF;

  SELECT e.name, j.ref INTO machine, card
    FROM equipment e
    LEFT JOIN equipment_assignment a ON a.equipment_id = e.id AND a.released_at IS NULL
    LEFT JOIN jobcard j ON j.id = a.jobcard_id
   WHERE e.id = p_equipment_id;
  IF machine IS NULL THEN
    RAISE EXCEPTION 'no such machine' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF card IS NULL THEN
    -- Nothing to return it from. Said plainly rather than refused, for the same reason as above: this is
    -- the state somebody pressing the button twice arrives at.
    PERFORM record_result(p_event_id, 'already returned');
    RETURN 'already returned';
  END IF;

  UPDATE equipment_assignment SET released_at = now()
   WHERE equipment_id = p_equipment_id AND released_at IS NULL;
  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('equipment', p_equipment_id, 'returned', who,
          machine || ' from ' || card || coalesce(' — ' || p_note, ''));

  PERFORM record_result(p_event_id, card);
  RETURN card;
END;
$$;

ALTER FUNCTION equipment_state_after_event(bigint, equipment_event_kind, text, date)
  OWNER TO varmak_engine;
REVOKE ALL ON FUNCTION equipment_state_after_event(bigint, equipment_event_kind, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION assign_equipment(bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION return_equipment(bigint, text, text) FROM PUBLIC;
-- Taking a machine to a bench and bringing it back is floor work: the welder who needs the plasma
-- cutter is the one who fetches it, and a shop where that needs the office is a shop where the
-- assignment record stops matching where the machines actually are.
GRANT EXECUTE ON FUNCTION assign_equipment(bigint, bigint, text), return_equipment(bigint, text, text)
TO varmak_admin, varmak_office, varmak_workshop;
GRANT EXECUTE ON FUNCTION equipment_state_after_event(bigint, equipment_event_kind, text, date)
TO varmak_admin, varmak_office, varmak_workshop;

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

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Suppliers
--
-- The merchants a workshop buys from. Thin on purpose: what a supplier costs this workshop is on the
-- orders and the price list, not here — and the one figure here that is a commercial term, the payment
-- terms, is withheld from the floor the same way a customer's price list is.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION save_supplier(
  p_id bigint,
  p_name text,
  p_category text DEFAULT NULL,
  p_status text DEFAULT 'active',
  p_org_no text DEFAULT NULL,
  p_vat_no text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_supplier_type text DEFAULT NULL,
  p_established text DEFAULT NULL,
  p_delivery_terms text DEFAULT NULL,
  p_minimum_order text DEFAULT NULL,
  p_currency text DEFAULT 'SEK',
  p_rating numeric DEFAULT NULL,
  p_payment_terms_days int DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('saving a supplier');
  saved bigint;
  existing text;
BEGIN
  IF coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'a supplier needs a name — it is what every order and certificate points back to';
  END IF;

  -- Two rows under one name is two merchants to the system and one to whoever is ringing them, which is
  -- how half a supplier's orders end up invisible on the register that is supposed to show them. Asked
  -- case-insensitively because 'Stål & Metall AB' and 'STÅL & METALL AB' are one company.
  SELECT ref INTO existing FROM supplier
   WHERE upper(btrim(name)) = upper(btrim(p_name)) AND (p_id IS NULL OR id <> p_id) LIMIT 1;
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'there is already a supplier called % — it is %', btrim(p_name), existing;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO supplier (name, category, status, org_no, vat_no, email, phone, website, address,
                          city, country, supplier_type, established, delivery_terms, minimum_order,
                          currency, rating, payment_terms_days, notes)
    VALUES (btrim(p_name), p_category, coalesce(p_status, 'active'), p_org_no, p_vat_no, p_email,
            p_phone, p_website, p_address, p_city, p_country, p_supplier_type, p_established,
            p_delivery_terms, p_minimum_order, upper(coalesce(nullif(btrim(coalesce(p_currency,'')), ''), 'SEK')),
            p_rating, p_payment_terms_days, p_notes)
    RETURNING id INTO saved;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    SELECT 'supplier', s.id, 'added', who, s.ref || ' ' || s.name FROM supplier s WHERE s.id = saved;
  ELSE
    UPDATE supplier SET
      name = btrim(p_name), category = p_category, status = coalesce(p_status, status),
      org_no = p_org_no, vat_no = p_vat_no, email = p_email, phone = p_phone, website = p_website,
      address = p_address, city = p_city, country = p_country, supplier_type = p_supplier_type,
      established = p_established, delivery_terms = p_delivery_terms,
      minimum_order = p_minimum_order,
      currency = upper(coalesce(nullif(btrim(coalesce(p_currency,'')), ''), currency)),
      -- The rating goes where it is put, NULL included. Nobody having rated a merchant is a real state
      -- and it has to be settable back: a coalesce here would mean a rating could be given and never
      -- taken away, which for a judgement about somebody's company is the wrong direction.
      rating = p_rating, payment_terms_days = p_payment_terms_days, notes = p_notes
     WHERE id = p_id
    RETURNING id INTO saved;
    IF saved IS NULL THEN
      RAISE EXCEPTION 'no such supplier, or it is not yours to change'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    SELECT 'supplier', s.id, 'updated', who, s.ref FROM supplier s WHERE s.id = saved;
  END IF;
  RETURN saved;
END;
$$;

-- The people at the merchant, replaced wholesale — the same shape as set_customer_contacts and for the
-- same reason: the screen holds a list and a patch-by-row API turns one edit into three calls, any of
-- which can be the one that does not arrive.
CREATE FUNCTION set_supplier_contacts(p_supplier_id bigint, p_contacts jsonb) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  row_in jsonb;
  mains int := 0;
  kept int := 0;
  merchant text;
BEGIN
  PERFORM require_session('saving supplier contacts');
  SELECT name INTO merchant FROM supplier WHERE id = p_supplier_id;
  IF merchant IS NULL THEN
    RAISE EXCEPTION 'no such supplier, or it is not yours to change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  p_contacts := coalesce(p_contacts, '[]'::jsonb);
  IF jsonb_typeof(p_contacts) <> 'array' THEN
    RAISE EXCEPTION 'the contacts have to arrive as a list';
  END IF;

  -- Checked before anything is written, so the refusal is a sentence rather than the name of a unique
  -- index. The index is what makes the rule true; this is what makes it readable.
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
    RAISE EXCEPTION '% has one main contact, and this list has %', merchant, mains;
  END IF;

  DELETE FROM supplier_contact WHERE supplier_id = p_supplier_id;
  FOR row_in IN SELECT * FROM jsonb_array_elements(p_contacts) LOOP
    INSERT INTO supplier_contact (supplier_id, name, role, email, phone, is_primary)
    VALUES (p_supplier_id, btrim(row_in->>'name'), nullif(btrim(coalesce(row_in->>'role', '')), ''),
            nullif(btrim(coalesce(row_in->>'email', '')), ''),
            nullif(btrim(coalesce(row_in->>'phone', '')), ''),
            coalesce((row_in->>'primary')::boolean, false));
    kept := kept + 1;
  END LOOP;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('supplier', p_supplier_id, 'contacts changed', current_app_name(),
          kept::text || ' contact' || CASE WHEN kept = 1 THEN '' ELSE 's' END);
  RETURN kept;
END;
$$;

-- A note against a merchant, into the audit trail rather than a notes column, for the reason a quality
-- note goes there: a note somebody can quietly edit afterwards is worth less than no note at all, and
-- that table is append-only by trigger. The `notes` column on supplier is a different thing — it is the
-- standing description of the merchant, not a dated entry.
CREATE FUNCTION add_supplier_note(p_supplier_id bigint, p_text text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('adding a supplier note');
  said text := btrim(coalesce(p_text, ''));
  made bigint;
BEGIN
  IF said = '' THEN
    RAISE EXCEPTION 'an empty note is not a note' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supplier WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'no such supplier' USING ERRCODE = 'foreign_key_violation';
  END IF;
  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('supplier', p_supplier_id, 'note', who, said)
  RETURNING id INTO made;
  RETURN made;
END;
$$;

-- What a merchant sells, and at what price. One row per item per supplier, which is what makes "who do
-- we buy this from and what did they quote" answerable for a plate two merchants both stock.
--
-- The price is here rather than on the item for exactly that reason, and it is why this function is the
-- office's: a price list is a price.
CREATE FUNCTION save_supplier_item(
  p_supplier_id bigint,
  p_stock_item_id bigint,
  p_price numeric,
  p_article_no text DEFAULT NULL,
  p_currency text DEFAULT 'SEK',
  p_pack_size numeric DEFAULT 1,
  p_lead_time_days int DEFAULT NULL,
  -- NULL means "leave it as it is", which is not the same as false.
  --
  -- It used to default to false, and a mutation found what that meant: correcting a merchant's price —
  -- `save_supplier_item(them, item, 14.10, 'ST-10-S355')`, with no flag because the price is what
  -- changed — silently stopped them being the merchant this workshop buys that item from. Nothing said
  -- so. The next person to ask "who do we buy this from" got no answer at all.
  p_is_preferred boolean DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('saving a supplier price');
  saved bigint;
BEGIN
  IF p_price IS NULL OR p_price < 0 THEN
    RAISE EXCEPTION 'a price list line needs a price' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supplier WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'no such supplier' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_item WHERE id = p_stock_item_id) THEN
    RAISE EXCEPTION 'no such item' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Preferred is one merchant per item, and the partial unique index refuses the second. Cleared here
  -- rather than left to fail, because "we buy this from them now" is the whole point of the flag and a
  -- refusal would make changing your mind impossible.
  IF coalesce(p_is_preferred, false) THEN
    UPDATE supplier_item SET is_preferred = false
     WHERE stock_item_id = p_stock_item_id AND supplier_id <> p_supplier_id AND is_preferred;
  END IF;

  INSERT INTO supplier_item (supplier_id, stock_item_id, article_no, price, currency, pack_size,
                             lead_time_days, is_preferred, updated_at)
  VALUES (p_supplier_id, p_stock_item_id, p_article_no, p_price,
          upper(coalesce(nullif(btrim(coalesce(p_currency,'')), ''), 'SEK')),
          coalesce(p_pack_size, 1), p_lead_time_days, coalesce(p_is_preferred, false), now())
  ON CONFLICT (supplier_id, stock_item_id) DO UPDATE SET
    article_no = excluded.article_no, price = excluded.price, currency = excluded.currency,
    pack_size = excluded.pack_size, lead_time_days = excluded.lead_time_days,
    -- Read off the parameter rather than `excluded`, because excluded already holds the coalesced value
    -- and cannot tell "not preferred" from "nobody said". Who this workshop buys an item from is a
    -- decision, and a price correction is not one.
    is_preferred = CASE WHEN p_is_preferred IS NULL THEN supplier_item.is_preferred
                        ELSE p_is_preferred END,
    updated_at = now()
  RETURNING id INTO saved;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  SELECT 'supplier', p_supplier_id, 'price list', who,
         (SELECT code FROM stock_item WHERE id = p_stock_item_id) || ' at ' || p_price::text
    FROM supplier WHERE id = p_supplier_id;
  RETURN saved;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Quality
--
-- A hold is the only thing in this system that physically stops work leaving the building, so the
-- rules about putting one on and taking one off are in here rather than in the page that happens to
-- be showing the button.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- Put a hold on.
--
-- Which of project or jobcard it names is worked out from what it is given rather than taken as a
-- scope word, because the two have to agree — `hold_names_one_thing` refuses a hold whose scope says
-- project and whose only reference is a jobcard, and a caller that can get that wrong will.
--
-- A hold naming nothing is refused outright. The application's own hold code had a third scope,
-- 'other', for exactly that case; a hold scoped to 'other' cannot appear in any gate, so it stops
-- nothing while looking on the screen exactly like one that does. The honest answer is to say so at
-- the point somebody tries to place it.
--
-- An identical active hold is reused rather than duplicated: same thing held, same reason. Automatic
-- holds fire from a failed inspection and again from the NCR raised about it, and two rows saying one
-- thing means releasing the hold leaves the work still held by its twin. A hold on the same jobcard
-- for a genuinely different reason is a different hold and still gets its own row.
CREATE FUNCTION place_hold(
  p_project_id bigint,
  p_jobcard_id bigint,
  p_reason text,
  p_severity severity DEFAULT 'major',
  p_required_action text DEFAULT NULL,
  p_related_ref text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('placing a quality hold');
  -- Named `why` rather than `reason`: inside the SELECT below, a variable called `reason` and the
  -- column called `reason` are the same word, and Postgres refuses the statement as ambiguous.
  why text := btrim(coalesce(p_reason, ''));
  on_project bigint := p_project_id;
  on_jobcard bigint := p_jobcard_id;
  existing text;
  made text;
BEGIN
  IF why = '' THEN
    RAISE EXCEPTION 'a hold has to say what it is for — it is the only thing the person it stops can read'
      USING ERRCODE = 'check_violation';
  END IF;
  -- A jobcard is the narrower thing, so a hold given both holds the jobcard.
  IF on_jobcard IS NOT NULL THEN
    on_project := NULL;
  ELSIF on_project IS NULL THEN
    RAISE EXCEPTION 'a hold has to name a project or a jobcard — one that names nothing stops nothing'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT ref INTO existing FROM quality_hold
   WHERE status = 'active' AND btrim(reason) = why
     AND jobcard_id IS NOT DISTINCT FROM on_jobcard
     AND project_id IS NOT DISTINCT FROM on_project
   LIMIT 1;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  INSERT INTO quality_hold (scope, project_id, jobcard_id, reason, severity, applied_by,
                            required_action, related_ref)
  VALUES (CASE WHEN on_jobcard IS NOT NULL THEN 'jobcard' ELSE 'project' END::hold_scope,
          on_project, on_jobcard, why, p_severity, who, p_required_action, p_related_ref)
  RETURNING ref INTO made;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  SELECT 'quality_hold', h.id, 'applied', who, made || ' — ' || why
    FROM quality_hold h WHERE h.ref = made;
  RETURN made;
END;
$$;

-- Take a hold off. The one decision in this system that lets work leave the building.
--
-- Requires a named authority and written evidence, and the database requires them too
-- (`release_needs_evidence`) — this raises the readable version of that refusal first. It releases
-- exactly the one hold it is given and touches nothing else: not the jobcard, not the project, not
-- another hold on the same work. After a release somebody retries the move that was blocked, and if
-- a second hold is still on it, it is still blocked, which is the point.
CREATE FUNCTION release_hold(p_hold_id bigint, p_authority text, p_reason text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('releasing a quality hold');
  authority text := btrim(coalesce(p_authority, ''));
  -- `why` rather than `reason`, for the reason place_hold gives: a variable sharing a name with a
  -- column of the table being written is ambiguous and the statement is refused.
  why text := btrim(coalesce(p_reason, ''));
  held record;
BEGIN
  SELECT id, ref, status INTO held FROM quality_hold WHERE id = p_hold_id;
  IF held.id IS NULL THEN
    RAISE EXCEPTION 'no such hold' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF authority = '' OR why = '' THEN
    RAISE EXCEPTION 'releasing a hold takes an authorised approval and written evidence of what was resolved'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Releasing an already-released hold is not harmless. It would restamp the authority and the date,
  -- so the record would say the second person released it and the first release would be gone.
  IF held.status = 'released' THEN
    RAISE EXCEPTION 'hold % has already been released', held.ref USING ERRCODE = 'check_violation';
  END IF;

  UPDATE quality_hold SET status = 'released', release_authority = authority,
         release_reason = why, released_at = now()
   WHERE id = held.id;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('quality_hold', held.id, 'released', who, held.ref || ' — ' || authority || ': ' || why);
  RETURN held.ref;
END;
$$;

-- An inspection is asked for: what is to be checked, against which drawing, to what criteria, by when.
--
-- The result is not here, and that is the whole shape of the thing. An inspection request that could
-- arrive already passed is a form for passing work without looking at it.
CREATE FUNCTION save_inspection(
  p_id bigint,
  p_project_id bigint,
  p_jobcard_id bigint,
  p_kind text,
  p_operation text DEFAULT NULL,
  p_component text DEFAULT NULL,
  p_drawing_no text DEFAULT NULL,
  p_drawing_rev text DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_acceptance_criteria text DEFAULT NULL,
  p_customer_witness boolean DEFAULT false,
  p_material_traceability_ok boolean DEFAULT false,
  p_planned_date date DEFAULT NULL,
  p_inspector text DEFAULT NULL,
  p_status text DEFAULT 'requested',
  p_notes text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('raising an inspection');
  saved bigint;
  locked text;
BEGIN
  IF coalesce(btrim(p_kind), '') = '' THEN
    RAISE EXCEPTION 'an inspection has to say what kind of check it is';
  END IF;
  IF p_project_id IS NULL AND p_jobcard_id IS NULL THEN
    RAISE EXCEPTION 'an inspection has to be of something — a project or a jobcard'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_planned_date IS NULL THEN
    RAISE EXCEPTION 'an inspection needs a date it is planned for, or it is a note rather than a plan'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO inspection (project_id, jobcard_id, kind, operation, component, drawing_no,
                            drawing_rev, method, acceptance_criteria, customer_witness,
                            material_traceability_ok, planned_date, inspector, status, notes)
    VALUES (p_project_id, p_jobcard_id, btrim(p_kind), p_operation, p_component, p_drawing_no,
            p_drawing_rev, p_method, p_acceptance_criteria, coalesce(p_customer_witness, false),
            coalesce(p_material_traceability_ok, false), p_planned_date, p_inspector,
            coalesce(p_status, 'requested'), p_notes)
    RETURNING id INTO saved;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    SELECT 'inspection', i.id, 'raised', who, i.ref || ' — ' || i.kind
      FROM inspection i WHERE i.id = saved;
  ELSE
    -- What was found is not editable through the form that asks for the check. Re-opening a decided
    -- inspection to change its drawing number would leave the result standing against a different
    -- drawing, which is the one way a passed inspection can become evidence of nothing.
    SELECT ref INTO locked FROM inspection WHERE id = p_id AND result <> 'pending';
    IF locked IS NOT NULL THEN
      RAISE EXCEPTION 'inspection % already has a result — raise a re-inspection rather than editing it',
        locked USING ERRCODE = 'check_violation';
    END IF;
    UPDATE inspection SET
      project_id = p_project_id, jobcard_id = p_jobcard_id, kind = btrim(p_kind),
      operation = p_operation, component = p_component, drawing_no = p_drawing_no,
      drawing_rev = p_drawing_rev, method = p_method, acceptance_criteria = p_acceptance_criteria,
      customer_witness = coalesce(p_customer_witness, false),
      material_traceability_ok = coalesce(p_material_traceability_ok, false),
      planned_date = p_planned_date, inspector = p_inspector,
      status = coalesce(p_status, status), notes = p_notes
     WHERE id = p_id
    RETURNING id INTO saved;
    IF saved IS NULL THEN
      RAISE EXCEPTION 'no such inspection, or it is not yours to change'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    SELECT 'inspection', i.id, 'updated', who, i.ref FROM inspection i WHERE i.id = saved;
  END IF;
  RETURN saved;
END;
$$;

-- The checklist, replaced wholesale. Shared by completing an inspection and by raising the
-- re-inspection that repeats it.
--
-- An empty string for the verdict arrives as NULL, because '' and "nobody has answered this line" are
-- the same fact and two spellings of it is how a blank line gets counted as a pass.
CREATE FUNCTION replace_inspection_checks(p_inspection_id bigint, p_lines jsonb) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  written int := 0;
BEGIN
  DELETE FROM inspection_check WHERE inspection_id = p_inspection_id;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RETURN 0;
  END IF;
  INSERT INTO inspection_check (inspection_id, line_no, item, result, nominal, tol_lower, tol_upper,
                                actual, note)
  SELECT p_inspection_id, ordinality,
         btrim(line->>'item'),
         nullif(btrim(coalesce(line->>'result', '')), ''),
         (line->>'nominal')::numeric, (line->>'lower')::numeric, (line->>'upper')::numeric,
         (line->>'actual')::numeric, line->>'note'
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(line, ordinality)
   WHERE btrim(coalesce(line->>'item', '')) <> '';
  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN written;
END;
$$;

-- What the inspector found, and what follows from it.
--
-- Three things happen here and they belong together in one transaction: the result and its evidence
-- are written, and a critical failure puts a hold on the work. Leaving the hold to the caller is how
-- a failed inspection gets recorded and the work ships anyway, because the second call was the one
-- that did not arrive.
--
-- `inspector` is taken from the session and overwrites whoever the request was planned for. On a
-- completed inspection that column is the person answerable for the result, and that can only be
-- whoever was signed in when it was recorded — the same rule a service record already follows. Until
-- it is completed the column holds who it is planned for, which is a different question.
CREATE FUNCTION complete_inspection(
  p_id bigint,
  p_result inspection_result,
  p_findings text DEFAULT NULL,
  p_critical boolean DEFAULT false,
  p_checks jsonb DEFAULT NULL,
  p_actual_date date DEFAULT NULL,
  p_event_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('recording an inspection result');
  seen text := already_done(p_event_id, 'complete_inspection');
  found record;
  on_day date := coalesce(p_actual_date, current_date);
  held text := NULL;
  answer jsonb;
BEGIN
  IF seen IS NOT NULL THEN
    RETURN seen::jsonb;
  END IF;

  SELECT id, ref, result, project_id, jobcard_id INTO found FROM inspection WHERE id = p_id;
  IF found.id IS NULL THEN
    RAISE EXCEPTION 'no such inspection' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF p_result = 'pending' THEN
    RAISE EXCEPTION 'completing an inspection takes a result — pending is what it already says'
      USING ERRCODE = 'check_violation';
  END IF;
  IF found.result <> 'pending' THEN
    RAISE EXCEPTION 'inspection % was already decided as %; a second look is a re-inspection',
      found.ref, found.result USING ERRCODE = 'check_violation';
  END IF;
  IF p_result = 'passed-observations' AND coalesce(btrim(p_findings), '') = '' THEN
    RAISE EXCEPTION 'passed with observations is the result that says there is something to say'
      USING ERRCODE = 'check_violation';
  END IF;
  IF on_day > current_date THEN
    RAISE EXCEPTION 'an inspection cannot have happened on a date that has not arrived'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The evidence goes in before the verdict, and the order is load-bearing rather than tidy: the
  -- floor's policy on the checklist lets a line be written only while its inspection is still
  -- undecided. Written the other way round, a welder's own checklist would be refused by the row
  -- security a statement earlier in the same transaction had just made apply to it.
  PERFORM replace_inspection_checks(found.id, p_checks);

  UPDATE inspection SET
    result = p_result, findings = p_findings, critical = coalesce(p_critical, false),
    actual_date = CASE WHEN p_result = 'not-applicable' THEN NULL ELSE on_day END,
    inspector = who,
    status = CASE WHEN p_result = 'not-applicable' THEN 'cancelled' ELSE 'completed' END
   WHERE id = found.id;

  -- Read back off the row rather than from the parameters, so the hold quotes what was actually
  -- recorded. Returns NULL for anything that is not a critical failure, including the ordinary case.
  held := hold_after_failed_inspection(found.id);

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('inspection', found.id, p_result::text, who,
          found.ref || coalesce(' — ' || nullif(btrim(coalesce(p_findings, '')), ''), '') ||
          coalesce(' — held under ' || held, ''));

  answer := jsonb_build_object('inspection', found.ref, 'hold', held);
  PERFORM record_result(p_event_id, answer::text);
  RETURN answer;
END;
$$;

-- The weld was ground out and re-run. This is the second look.
--
-- A copy of the original with the result cleared and a link back to it, so the history of a rejected
-- weld reads as one story rather than two unrelated checks. The checklist comes across with every
-- verdict blanked: a re-inspection that arrives pre-passed on the first inspection's answers is the
-- exact failure this whole record exists to prevent.
CREATE FUNCTION create_reinspection(p_id bigint) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('raising a re-inspection');
  original record;
  made bigint;
BEGIN
  SELECT * INTO original FROM inspection WHERE id = p_id;
  IF original.id IS NULL THEN
    RAISE EXCEPTION 'no such inspection' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF original.result = 'pending' THEN
    RAISE EXCEPTION 'inspection % has not been decided yet — there is nothing to repeat', original.ref
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO inspection (project_id, jobcard_id, kind, operation, component, drawing_no, drawing_rev,
                          method, acceptance_criteria, customer_witness, material_traceability_ok,
                          planned_date, inspector, status, reinspection_of, notes)
  VALUES (original.project_id, original.jobcard_id, original.kind, original.operation,
          original.component, original.drawing_no, original.drawing_rev, original.method,
          original.acceptance_criteria, original.customer_witness, original.material_traceability_ok,
          current_date, original.inspector, 'planned', original.id, original.notes)
  RETURNING id INTO made;

  INSERT INTO inspection_check (inspection_id, line_no, item, nominal, tol_lower, tol_upper)
  SELECT made, line_no, item, nominal, tol_lower, tol_upper
    FROM inspection_check WHERE inspection_id = original.id ORDER BY line_no;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  SELECT 'inspection', made, 'raised as a re-inspection', who, i.ref || ' repeats ' || original.ref
    FROM inspection i WHERE i.id = made;
  RETURN made;
END;
$$;

-- The hold that follows a critical failed inspection, and the only route by which the floor ever
-- places one.
--
-- Split out and run as varmak_engine for the same reason equipment_state_after_event is: a welder
-- recording what they found must not be able to put an arbitrary hold on arbitrary work — releasing a
-- hold is the office's decision and placing one is most of the way there — but the hold that follows
-- automatically from a critical failure they have just recorded is the system's decision, not theirs.
--
-- Without this split the welder's transaction fails at the hold: no INSERT grant on quality_hold for
-- the floor, and `only_the_office_holds` behind it. The whole transaction rolls back, so the failed
-- inspection is not recorded either — the shop ends up with neither the hold nor the finding, which is
-- worse than either one alone. That is the "a GRANT with no policy behind it fails closed, which is
-- safe and still the wrong answer" shape, met a second time.
--
-- It reads the inspection rather than taking a reason, so there is nothing to pass: it can only place
-- a hold that quotes an inspection which is, right now, failed and marked critical. Called with
-- anything else it does nothing and says so by returning NULL.
CREATE FUNCTION hold_after_failed_inspection(p_inspection_id bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  found record;
  existing text;
  why text;
  held bigint;
  made text;
BEGIN
  SELECT id, ref, result, critical, project_id, jobcard_id, findings, inspector
    INTO found FROM inspection WHERE id = p_inspection_id;
  IF found.id IS NULL OR found.result <> 'failed' OR NOT found.critical THEN
    RETURN NULL;
  END IF;
  IF found.project_id IS NULL AND found.jobcard_id IS NULL THEN
    RETURN NULL;
  END IF;

  why := 'Critical failed inspection ' || found.ref || ' — ' ||
         coalesce(nullif(btrim(coalesce(found.findings, '')), ''), 'see the inspection record');

  SELECT ref INTO existing FROM quality_hold
   WHERE status = 'active' AND btrim(reason) = why
     AND jobcard_id IS NOT DISTINCT FROM CASE WHEN found.jobcard_id IS NOT NULL
                                              THEN found.jobcard_id END
     AND project_id IS NOT DISTINCT FROM CASE WHEN found.jobcard_id IS NULL
                                              THEN found.project_id END
   LIMIT 1;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  INSERT INTO quality_hold (scope, project_id, jobcard_id, reason, severity, applied_by,
                            required_action, related_ref)
  VALUES (CASE WHEN found.jobcard_id IS NOT NULL THEN 'jobcard' ELSE 'project' END::hold_scope,
          CASE WHEN found.jobcard_id IS NULL THEN found.project_id END,
          found.jobcard_id, why, 'critical', coalesce(found.inspector, 'system'),
          'Corrective action and re-inspection required.', found.ref)
  RETURNING id, ref INTO held, made;

  -- The hold's own history, the same entry place_hold writes. Without it the holds with the least
  -- explanation on the screen would be exactly the ones that matter most: an office hold shows who
  -- applied it and why, and an automatic one would show an empty panel.
  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('quality_hold', held, 'applied', coalesce(found.inspector, 'system'), made || ' — ' || why);
  RETURN made;
END;
$$;

-- A non-conformance, raised.
--
-- Who found it comes from the session, never from the form. The screen it is typed on had the name
-- written into the page — every NCR raised on that machine would have been found by the same person,
-- whoever was actually standing there.
--
-- A critical one puts a hold on by itself, in this transaction. Same reason completing a failed
-- inspection does: the hold that depends on a second call is the hold that is missing when the lorry
-- is loaded.
CREATE FUNCTION save_ncr(
  p_id bigint,
  p_title text,
  p_project_id bigint,
  p_jobcard_id bigint,
  p_category text,
  p_severity severity,
  p_description text,
  p_responsible text,
  p_due_on date DEFAULT NULL,
  p_operation text DEFAULT NULL,
  p_component text DEFAULT NULL,
  p_material text DEFAULT NULL,
  p_supplier_id bigint DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('raising a non-conformance');
  saved bigint;
  raised text;
  held text := NULL;
BEGIN
  IF coalesce(btrim(p_title), '') = '' THEN
    RAISE EXCEPTION 'a non-conformance needs a title — it is what the register is read by';
  END IF;
  IF coalesce(btrim(p_description), '') = '' THEN
    RAISE EXCEPTION 'a non-conformance needs a description of what is wrong';
  END IF;
  IF coalesce(btrim(p_responsible), '') = '' THEN
    RAISE EXCEPTION 'a non-conformance needs somebody answerable for it';
  END IF;
  IF p_severity <> 'minor' AND p_due_on IS NULL THEN
    RAISE EXCEPTION 'a % non-conformance needs a date by which it is answered', p_severity
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO ncr (title, project_id, jobcard_id, category, severity, description, responsible,
                     detected_by, due_on, operation, component, material, supplier_id, notes)
    VALUES (btrim(p_title), p_project_id, p_jobcard_id, btrim(p_category), p_severity,
            btrim(p_description), btrim(p_responsible), who, p_due_on, p_operation, p_component,
            p_material, p_supplier_id, p_notes)
    RETURNING id, ref INTO saved, raised;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    VALUES ('ncr', saved, 'raised', who, raised || ' — ' || btrim(p_title));

    IF p_severity = 'critical' THEN
      held := place_hold(p_project_id, p_jobcard_id,
        'Critical NCR ' || raised || ' — ' || btrim(p_title), 'critical',
        'Resolve the NCR and verify the corrective action before release.', raised);
    END IF;
  ELSE
    UPDATE ncr SET title = btrim(p_title), project_id = p_project_id, jobcard_id = p_jobcard_id,
           category = btrim(p_category), severity = p_severity, description = btrim(p_description),
           responsible = btrim(p_responsible), due_on = p_due_on, operation = p_operation,
           component = p_component, material = p_material, supplier_id = p_supplier_id,
           notes = p_notes
     WHERE id = p_id AND status <> 'closed'
    RETURNING id, ref INTO saved, raised;
    IF saved IS NULL THEN
      -- Two different refusals, and the difference matters to whoever is looking at the screen.
      IF EXISTS (SELECT 1 FROM ncr WHERE id = p_id) THEN
        RAISE EXCEPTION 'that non-conformance is closed — reopen it before changing it'
          USING ERRCODE = 'check_violation';
      END IF;
      RAISE EXCEPTION 'no such non-conformance' USING ERRCODE = 'foreign_key_violation';
    END IF;
    INSERT INTO activity_log (entity, entity_id, action, actor, detail)
    VALUES ('ncr', saved, 'updated', who, raised);
  END IF;

  RETURN jsonb_build_object('ncr', raised, 'id', saved::text, 'hold', held);
END;
$$;

-- The life of a non-conformance after it is raised: contained, dispositioned, answered by a corrective
-- action, verified, closed — or reopened when it comes back.
--
-- One function rather than six, because it is one state machine. Six functions would be six places
-- deciding what 'corrective-action' follows, and they would disagree within a year.
CREATE FUNCTION record_ncr_step(
  p_id bigint,
  p_step text,
  p_text text DEFAULT NULL,
  p_ref text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('moving a non-conformance on');
  it record;
  said text := btrim(coalesce(p_text, ''));
  reference text := nullif(btrim(coalesce(p_ref, '')), '');
  moved_to ncr_status;
BEGIN
  SELECT id, ref, status, verification_result INTO it FROM ncr WHERE id = p_id;
  IF it.id IS NULL THEN
    RAISE EXCEPTION 'no such non-conformance' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF it.status = 'closed' AND p_step <> 'reopen' THEN
    RAISE EXCEPTION 'non-conformance % is closed — reopen it first', it.ref
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_step = 'containment' THEN
    IF said = '' THEN
      RAISE EXCEPTION 'containment is what was done about it straight away — it cannot be blank'
        USING ERRCODE = 'check_violation';
    END IF;
    moved_to := CASE WHEN it.status IN ('draft', 'open', 'containment-required')
                     THEN 'under-investigation'::ncr_status ELSE it.status END;
    UPDATE ncr SET containment = said, status = moved_to WHERE id = it.id;

  ELSIF p_step = 'disposition' THEN
    IF said = '' THEN
      RAISE EXCEPTION 'a disposition says what happens to the parts' USING ERRCODE = 'check_violation';
    END IF;
    -- The database refuses this too. Raised here first because the constraint's name is not a
    -- sentence anybody standing at the screen can act on.
    IF said = 'use-as-is' AND reference IS NULL THEN
      RAISE EXCEPTION 'using a non-conforming part as it is has to be signed for — record the concession'
        USING ERRCODE = 'check_violation';
    END IF;
    moved_to := CASE WHEN it.status IN ('under-investigation', 'disposition-required')
                     THEN 'corrective-action'::ncr_status ELSE it.status END;
    UPDATE ncr SET disposition = said, disposition_approval_ref = reference, status = moved_to
     WHERE id = it.id;

  ELSIF p_step = 'corrective-action' THEN
    IF said = '' THEN
      RAISE EXCEPTION 'name the corrective action this is answered by' USING ERRCODE = 'check_violation';
    END IF;
    moved_to := 'corrective-action';
    UPDATE ncr SET corrective_action_ref = said, status = moved_to WHERE id = it.id;

  ELSIF p_step = 'verify' THEN
    IF said = '' THEN
      RAISE EXCEPTION 'verification records what was checked and how it came out'
        USING ERRCODE = 'check_violation';
    END IF;
    moved_to := 'waiting-verification';
    UPDATE ncr SET verification_result = said, verified_by = coalesce(reference, who),
           status = moved_to WHERE id = it.id;

  ELSIF p_step = 'close' THEN
    IF said = '' THEN
      RAISE EXCEPTION 'closing a non-conformance takes a closure approval reference'
        USING ERRCODE = 'check_violation';
    END IF;
    IF coalesce(btrim(it.verification_result), '') = '' THEN
      RAISE EXCEPTION 'non-conformance % has nothing verified — closing it would record that the fix worked without anybody checking',
        it.ref USING ERRCODE = 'check_violation';
    END IF;
    moved_to := 'closed';
    UPDATE ncr SET closure_approval = said, closed_on = current_date, status = moved_to
     WHERE id = it.id;

  ELSIF p_step = 'reopen' THEN
    IF said = '' THEN
      RAISE EXCEPTION 'reopening a non-conformance takes a reason — it is the record of why it came back'
        USING ERRCODE = 'check_violation';
    END IF;
    moved_to := 'reopened';
    -- The closure comes off with it. A reopened NCR still carrying its closure approval reads as
    -- approved and open at once, and the next close would leave the first approval standing behind
    -- the second one's evidence.
    UPDATE ncr SET status = moved_to, closure_approval = NULL, closed_on = NULL WHERE id = it.id;

  ELSE
    RAISE EXCEPTION 'there is no such step as %', p_step USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('ncr', it.id, p_step, who, it.ref || ' — ' || said || coalesce(' (' || reference || ')', ''));
  RETURN moved_to::text;
END;
$$;

-- A note against a quality record. Written into the audit trail rather than a notes column, because a
-- quality note somebody can quietly edit afterwards is worth less than no note at all — and the
-- activity log is append-only by trigger.
CREATE FUNCTION add_quality_note(p_entity text, p_entity_id bigint, p_text text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  who text := require_session('adding a quality note');
  said text := btrim(coalesce(p_text, ''));
  exists_here boolean;
  made bigint;
BEGIN
  IF said = '' THEN
    RAISE EXCEPTION 'an empty note is not a note' USING ERRCODE = 'check_violation';
  END IF;
  -- The entity/id pair is not a foreign key and cannot be one, so the three tables it may name are
  -- listed and the row is checked to exist. A note against a record that is not there is a note
  -- nothing will ever show.
  IF p_entity = 'inspection' THEN
    SELECT true INTO exists_here FROM inspection WHERE id = p_entity_id;
  ELSIF p_entity = 'ncr' THEN
    SELECT true INTO exists_here FROM ncr WHERE id = p_entity_id;
  ELSIF p_entity = 'quality_hold' THEN
    SELECT true INTO exists_here FROM quality_hold WHERE id = p_entity_id;
  ELSE
    RAISE EXCEPTION 'a quality note goes on an inspection, an NCR or a hold, not on %', p_entity
      USING ERRCODE = 'check_violation';
  END IF;
  IF exists_here IS NOT TRUE THEN
    RAISE EXCEPTION 'no such %', p_entity USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES (p_entity, p_entity_id, 'note', who, said)
  RETURNING id INTO made;
  RETURN made;
END;
$$;

REVOKE ALL ON FUNCTION save_customer(bigint, text, text, text, text, text, text, text, text, text,
  text, date, text, boolean, text, text, numeric, text, int, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_project(bigint, text, bigint, text, numeric, int, date, text, text, text, text, text,
                text, text, text, date, date, date, date, text, text, date, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_jobcard(bigint, bigint, text, text, text, int, text, int, numeric, date, date, date,
                text, text, text, text, text, text, text, text, int, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_jobcard_operations(bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_equipment(bigint, text, text, text, equipment_status, text, text, text, text, int, text,
                 text, text, text, text, text, text, text, text, date, date, text, numeric,
                 date, numeric, int, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_equipment_event(bigint, equipment_event_kind, text, date, date, numeric, text, bigint, bigint, text) FROM PUBLIC;
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
REVOKE ALL ON FUNCTION place_hold(bigint, bigint, text, severity, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_hold(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_inspection(bigint, bigint, bigint, text, text, text, text, text, text,
                 text, boolean, boolean, date, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION replace_inspection_checks(bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_inspection(bigint, inspection_result, text, boolean, jsonb, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_reinspection(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_ncr(bigint, text, bigint, bigint, text, severity, text, text, date,
                 text, text, text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_ncr_step(bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION add_quality_note(text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_supplier(bigint, text, text, text, text, text, text, text, text, text,
                 text, text, text, text, text, text, text, numeric, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_supplier_contacts(bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION add_supplier_note(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_supplier_item(bigint, bigint, numeric, text, text, numeric, int, boolean) FROM PUBLIC;
ALTER FUNCTION hold_after_failed_inspection(bigint) OWNER TO varmak_engine;
REVOKE ALL ON FUNCTION hold_after_failed_inspection(bigint) FROM PUBLIC;

-- The last ownership change in the system, so the privilege goes back now.
REVOKE CREATE ON SCHEMA public FROM varmak_engine;

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
  record_stocktake(bigint, numeric, text),
  -- The register itself is the office's: what a machine is, what it cost, when its certificate runs
  -- out. The floor reads it through every safety gate in the app and does not edit it.
  save_equipment(bigint, text, text, text, equipment_status, text, text, text, text, int, text,
                 text, text, text, text, text, text, text, text, date, date, text, numeric,
                 date, numeric, int, text, boolean, text),
  -- Quality. Putting a hold on and taking one off are both the office's, and taking one off is the
  -- decision that lets work leave the building — §1b gives the floor no part in it. The floor's own
  -- part in quality is recording what it found, which is the inspection route below.
  place_hold(bigint, bigint, text, severity, text, text),
  release_hold(bigint, text, text),
  save_ncr(bigint, text, bigint, bigint, text, severity, text, text, date, text, text, text, bigint, text),
  record_ncr_step(bigint, text, text, text),
  save_inspection(bigint, bigint, bigint, text, text, text, text, text, text, text, boolean,
                  boolean, date, text, text, text),
  -- The merchants. The register is the office's, and the price list especially: what a supplier charges
  -- is a price, which is the one thing §1b keeps off the shop floor.
  save_supplier(bigint, text, text, text, text, text, text, text, text, text, text, text, text, text,
                text, text, text, numeric, int, text),
  set_supplier_contacts(bigint, jsonb),
  add_supplier_note(bigint, text),
  save_supplier_item(bigint, bigint, numeric, text, text, numeric, int, boolean)
TO varmak_admin, varmak_office;

GRANT EXECUTE ON FUNCTION book_hours(bigint, bigint, numeric, date, text, text),
  record_operation(bigint, operation_status, text),
  issue_material_offline(bigint, numeric, bigint, text, text),
  -- The floor as well, and this one deliberately: a check signed before running a machine is signed by
  -- whoever is standing in front of it. Granted to the office too, because a service is recorded the
  -- same way and that is theirs — the function takes the name from the session either way, so a record
  -- can only ever carry the name of whoever actually made it.
  record_equipment_event(bigint, equipment_event_kind, text, date, date, numeric, text, bigint, bigint, text),
  -- A welder records what they found, and a critical failure puts the hold on from inside that same
  -- transaction — which is why place_hold is not in this list and does not need to be: the function
  -- doing the holding runs in the caller's own role, and only reaches quality_hold through the route
  -- a failed inspection takes. Releasing is not here at all, and that is the whole §1b line.
  complete_inspection(bigint, inspection_result, text, boolean, jsonb, date, text),
  hold_after_failed_inspection(bigint),
  create_reinspection(bigint),
  replace_inspection_checks(bigint, jsonb),
  add_quality_note(text, bigint, text)
TO varmak_admin, varmak_office, varmak_workshop;

COMMIT;
