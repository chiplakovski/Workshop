-- Varmak Workshop — who is asking, and what that lets them see.
--
-- Step 3 of BACKEND.md: auth and the two roles, with row-level security written alongside the
-- tables. Run after schema.sql.
--
-- The sentence this file exists to make true is in BACKEND.md §1b:
--
--     "A welder's session must be unable to read the customer's agreed price even by asking the
--      API directly."
--
-- Hiding a button does not do that. Checking a role in application code does not do that either —
-- it holds until somebody adds a second caller, an export, a report, a debugging endpoint. The
-- only place it holds against every one of those is the database, which is why the limit is a
-- GRANT and a policy here rather than an `if` somewhere in the API.
--
-- Two doors, as decided, because they guard different things:
--
--   • Office and site — email and password. Anything touching prices, approvals or deletion.
--   • Shop floor — a shared tablet and a personal PIN. A welder in gloves will not type a password
--     forty times a day; if you make them, they share one login and the hours data becomes
--     worthless. A PIN answers "who booked these hours", and the cost of a wrong answer there is a
--     corrected timesheet. So a PIN opens a `workshop` session and nothing more, and the limit is
--     enforced here — it holds even if somebody works out the PIN.
--
-- On Supabase this is the same shape: the JWT's role claim selects the Postgres role, and the
-- verified user id is put into a session setting. `app.user_id` is that setting. Nothing in this
-- file trusts anything the client sends; the API sets it only after verifying a credential.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Who the database thinks is asking
--
-- Fails closed. A connection that has not said who it is gets NULL, and every policy below treats
-- NULL as "no". The failure mode of a mistake here must be that nobody can see anything, never
-- that everybody can.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION current_app_user() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::bigint;
$$;

-- SECURITY DEFINER, and owned further down by the one role that may step around row security.
-- Not for convenience: app_user has a policy of its own, and that policy asks what role you are,
-- which asks app_user, which evaluates the policy. Postgres answers that with "stack depth limit
-- exceeded" on the first query any welder runs — found exactly that way. A function that reads one
-- row to answer "who am I" cannot be subject to a policy that needs the answer first.
CREATE FUNCTION current_app_role() RETURNS user_role
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  claimed text := NULLIF(current_setting('app.user_role', true), '');
  actual  user_role;
BEGIN
  -- The role is read from the row, not from the setting. The setting is a convenience for the API
  -- and a client could put anything in it; the row is the record. If the two disagree the row wins,
  -- which is the whole reason this is a function and not a `current_setting` call inline.
  SELECT role INTO actual FROM app_user WHERE id = current_app_user() AND is_active;
  IF actual IS NULL THEN
    RETURN NULL;
  END IF;
  IF claimed IS NOT NULL AND claimed <> actual::text THEN
    RAISE EXCEPTION 'session claims the role % but % is %',
      claimed, (SELECT email FROM app_user WHERE id = current_app_user()), actual
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN actual;
END;
$$;

-- Your own name, for the policies that record who did something. Same reasoning as above: a policy
-- on hours_entry that reads app_user directly drags app_user's policy into every insert.
CREATE FUNCTION current_app_name() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT display_name FROM app_user WHERE id = current_app_user() AND is_active;
$$;

-- coalesce, and it is not tidiness. current_app_role() is NULL when nobody is signed in, so
-- `current_app_role() = 'admin'` is NULL rather than false — and `IF NOT is_admin() THEN RAISE` in
-- plpgsql does nothing at all when the condition is NULL. Every authorisation guard written that
-- way was therefore skipped entirely for exactly the case it exists to refuse: no session.
--
-- Row-level policies were never affected, because RLS treats NULL as "not true" — which is why this
-- survived until a workflow with a plpgsql guard was written and a test called it with no session.
CREATE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT coalesce(current_app_role() = 'admin', false); $$;

-- "Can see money" rather than "is office": the question asked at every price column, named for what
-- it decides rather than for who happens to satisfy it today.
CREATE FUNCTION may_see_money() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT coalesce(current_app_role() IN ('admin', 'office'), false); $$;

CREATE FUNCTION is_signed_in() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT current_app_role() IS NOT NULL; $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Passwords and PINs
--
-- Neither is ever stored. Both are hashed with bcrypt through pgcrypto, and the hashing happens
-- here rather than in the API so that there is exactly one implementation of it — an API that
-- hashes passwords itself is an API that can be given a second one that does not.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE app_user
  ADD COLUMN pin_hash text CONSTRAINT pin_is_hashed
             CHECK (pin_hash IS NULL OR pin_hash ~ '^\$2[aby]\$\d{2}\$'),
  ADD COLUMN pin_set_at timestamptz,
  -- Beside pin_set_at, and for the same reason. add_person deliberately creates somebody with no
  -- way in at all, so the screen that adds people has to be able to say so — and a screen that
  -- cannot tell "password set" from "no password yet" tells an admin they have given somebody
  -- access when they have not. The hash stays unreadable to everybody; this column says only that
  -- one exists, which is the part anybody needs.
  ADD COLUMN password_set_at timestamptz,
  -- A four-digit PIN is ten thousand guesses. Without a lockout that is not a credential, it is a
  -- formality, and the lockout has to live where the checking lives or it can be skipped.
  ADD COLUMN failed_attempts int NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN last_seen_at timestamptz;

-- The PINs people actually choose when nobody stops them. A PIN guards whose name goes on a
-- timesheet, so it may be short — it may not be guessable on the first try.
CREATE FUNCTION pin_is_too_obvious(p_pin text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_pin IN ('0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
                   '1234','4321','0123','2580','1212','6969','1004','2000','1010','1122')
      OR p_pin ~ '^(.)\1+$';
$$;

CREATE FUNCTION set_pin(p_user_id bigint, p_pin text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_pin !~ '^\d{4,8}$' THEN
    RAISE EXCEPTION 'a PIN is four to eight digits' USING ERRCODE = 'check_violation';
  END IF;
  IF pin_is_too_obvious(p_pin) THEN
    RAISE EXCEPTION 'that PIN is one of the first a stranger would try' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE app_user
     SET pin_hash = crypt(p_pin, gen_salt('bf', 8)), pin_set_at = now(),
         failed_attempts = 0, locked_until = NULL
   WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such person' USING ERRCODE = 'foreign_key_violation';
  END IF;
END;
$$;

CREATE FUNCTION set_password(p_user_id bigint, p_password text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Length rather than a character-class rule. A rule demanding a capital and a symbol produces
  -- Passw0rd! on every account in the building; length is the thing that actually costs a guesser.
  IF p_password IS NULL OR length(p_password) < 12 THEN
    RAISE EXCEPTION 'a password needs at least twelve characters' USING ERRCODE = 'check_violation';
  END IF;
  IF lower(p_password) IN ('password1234','varmakvarmak','123456789012','qwertyuiopas') THEN
    RAISE EXCEPTION 'that password is on every list a guesser starts from' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE app_user
     SET password_hash = crypt(p_password, gen_salt('bf', 10)), password_set_at = now(),
         failed_attempts = 0, locked_until = NULL
   WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such person' USING ERRCODE = 'foreign_key_violation';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Sessions
--
-- A row per session, so one can be ended from the office when a tablet goes missing — which is the
-- thing a stateless token cannot do. Shop-floor sessions end with the shift rather than in thirty
-- days: a tablet left logged in overnight is the whole hall logged in as one welder.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TYPE session_door AS ENUM ('password', 'pin');

CREATE TABLE app_session (
  token       text PRIMARY KEY DEFAULT encode(gen_random_bytes(32), 'hex'),
  user_id     bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  door        session_door NOT NULL,
  device      text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  CHECK (expires_at > started_at)
);

CREATE INDEX session_user_idx ON app_session(user_id) WHERE ended_at IS NULL;

-- End of shift, not thirty days. 18:00 local if that is still ahead, otherwise 18:00 tomorrow —
-- a late shift starting at 22:00 gets the following evening rather than four minutes.
CREATE FUNCTION end_of_shift() RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN now() < date_trunc('day', now()) + interval '18 hours'
              THEN date_trunc('day', now()) + interval '18 hours'
              ELSE date_trunc('day', now()) + interval '42 hours'
         END;
$$;

-- One place that decides whether a credential was right, so that "too many tries" cannot be
-- true at one door and false at the other.
CREATE FUNCTION register_failure(p_user_id bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  attempts int;
BEGIN
  UPDATE app_user SET failed_attempts = failed_attempts + 1 WHERE id = p_user_id
  RETURNING failed_attempts INTO attempts;
  -- Five tries, then fifteen minutes. Long enough to make ten thousand guesses take weeks, short
  -- enough that a welder who fumbled it is not sent home.
  IF attempts >= 5 THEN
    UPDATE app_user SET locked_until = now() + interval '15 minutes', failed_attempts = 0
     WHERE id = p_user_id;
  END IF;
END;
$$;

-- Returns a result rather than raising, and that is not a style preference — it is the only way
-- this can work.
--
-- The first version raised an exception on a wrong secret, after calling register_failure to count
-- it. The RAISE aborted the transaction and rolled back the count, so failed_attempts never moved,
-- locked_until was never set, and the lockout did nothing whatsoever. A four-digit PIN with no
-- working lockout is ten thousand free guesses, which is to say it is not a credential at all. The
-- tests caught it on the sixth guess.
--
-- So: a function that has to record something cannot also abort. Refusals come back as text in the
-- `refused` field, the transaction commits, and the count sticks. The API turns a non-null
-- `refused` into a 401 and shows the text.
CREATE TYPE sign_in_result AS (token text, refused text);

CREATE FUNCTION sign_in(p_email text, p_secret text, p_door session_door, p_device text DEFAULT NULL)
RETURNS sign_in_result
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  person app_user%ROWTYPE;
  stored text;
  result sign_in_result;
BEGIN
  SELECT * INTO person FROM app_user WHERE email = lower(btrim(p_email));

  -- The same words whether the address is unknown, the account is switched off, or the secret is
  -- wrong. Three different answers would tell a stranger which addresses are real, and the sleep
  -- keeps an unknown address from being the fast one to ask about.
  IF person.id IS NULL OR NOT person.is_active THEN
    PERFORM pg_sleep(0.1);
    RETURN (NULL, 'that is not a login we recognise')::sign_in_result;
  END IF;

  IF person.locked_until IS NOT NULL AND person.locked_until > now() THEN
    -- No further counting while locked: the lock is already doing its job, and extending it on
    -- every attempt would let a stranger keep a colleague locked out indefinitely.
    RETURN (NULL, 'too many tries — this login is locked until '
                  || to_char(person.locked_until, 'HH24:MI'))::sign_in_result;
  END IF;

  -- The PIN door only ever opens a workshop session. An admin standing at the shared tablet gets
  -- the tablet's authority, not their own — otherwise the strength of the door stops matching what
  -- is behind it, which is the entire argument for having two doors.
  IF p_door = 'pin' AND person.role <> 'workshop' THEN
    RETURN (NULL, 'the shop tablet opens a workshop session; ' || person.email
                  || ' needs the office door for their own')::sign_in_result;
  END IF;

  stored := CASE p_door WHEN 'pin' THEN person.pin_hash ELSE person.password_hash END;
  IF stored IS NULL OR crypt(p_secret, stored) <> stored THEN
    PERFORM register_failure(person.id);
    RETURN (NULL, 'that is not a login we recognise')::sign_in_result;
  END IF;

  UPDATE app_user SET failed_attempts = 0, locked_until = NULL, last_seen_at = now()
   WHERE id = person.id;

  INSERT INTO app_session (user_id, door, device, expires_at)
  VALUES (person.id, p_door, p_device,
          CASE p_door WHEN 'pin' THEN end_of_shift() ELSE now() + interval '12 hours' END)
  RETURNING token INTO result.token;

  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('app_user', person.id, 'signed in', person.email, p_door::text);

  RETURN result;
END;
$$;

-- Hands back the person a token belongs to, or nothing. The API calls this and then sets
-- app.user_id from the answer; it never takes a user id from the client.
CREATE FUNCTION session_owner(p_token text) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT user_id FROM app_session
   WHERE token = p_token AND ended_at IS NULL AND expires_at > now();
$$;

CREATE FUNCTION sign_out(p_token text) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE app_session SET ended_at = now() WHERE token = p_token AND ended_at IS NULL;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- The roles, as real database roles
--
-- Not strings in a column that application code compares. A GRANT is checked by the server on
-- every statement, including the ones nobody has written yet: an export, a report, a console
-- somebody opens at midnight to "just check something".
--
-- varmak_api is what the connection pool logs in as. It can become any of the three and can do
-- nothing itself, so a bug that forgets to pick a role ends with a session that cannot read a
-- single row — which is the direction a mistake here has to fail.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'varmak_admin') THEN
    CREATE ROLE varmak_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'varmak_office') THEN
    CREATE ROLE varmak_office NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'varmak_workshop') THEN
    CREATE ROLE varmak_workshop NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'varmak_api') THEN
    -- LOGIN, because this is the one role that actually connects. NOINHERIT is the important half:
    -- it holds membership of the three roles but none of their privileges until it explicitly
    -- becomes one, so a connection that has not chosen a role can do nothing at all.
    --
    -- No password is set here. On this machine the server trusts a local socket; anywhere else the
    -- password is set outside this file and kept out of the repository, which is why there is no
    -- line here to forget to change.
    CREATE ROLE varmak_api LOGIN NOINHERIT;
  END IF;
END;
$$;

-- Roles live in the cluster, not in the database, so they survive dropping and rebuilding this one
-- and the guards above skip them on the second run. That means a role created with the wrong
-- attributes once stays wrong forever, which is exactly what happened: varmak_api was created
-- without LOGIN, and creating it correctly afterwards changed nothing because it already existed.
-- Setting the attributes unconditionally is the only version of this that is safe to run twice.
ALTER ROLE varmak_api LOGIN NOINHERIT;
ALTER ROLE varmak_admin NOLOGIN NOBYPASSRLS NOSUPERUSER;
ALTER ROLE varmak_office NOLOGIN NOBYPASSRLS NOSUPERUSER;
ALTER ROLE varmak_workshop NOLOGIN NOBYPASSRLS NOSUPERUSER;
ALTER ROLE varmak_api NOBYPASSRLS NOSUPERUSER;

GRANT varmak_admin, varmak_office, varmak_workshop TO varmak_api;
GRANT USAGE ON SCHEMA public TO varmak_admin, varmak_office, varmak_workshop, varmak_api;

-- Sequences are needed by anyone who may insert; without this an insert fails on the id.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO varmak_admin, varmak_office, varmak_workshop;

-- ── What each role may touch at all ───────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO varmak_admin;

-- Office runs the commercial side. No deleting: a quote that was sent and a job that was run are
-- the record of what happened, and removing one is not a correction, it is a different past.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO varmak_office;

-- The workshop. Everything it is listed as being able to do in BACKEND.md §1b, and nothing else:
-- book hours, start and pause operations, issue material, record an inspection result.
-- Whole tables, because none of these holds a figure in kronor — and that sentence has now been
-- wrong four times. stock_item, equipment_event, equipment and project each sat in this list and
-- each quietly acquired a money column later, at which point every welder could read it. A
-- table-wide GRANT SELECT includes every column, and a narrower column grant written afterwards
-- adds nothing to it, so auth.sql looked like it said otherwise while a welder read avg_cost
-- straight out of the store. The privilege check in test-auth.js asserts the privilege tables
-- directly rather than trusting this list, and caught all four — but the pattern is the point: a
-- table in this list is one bet that it will never hold money, and that bet keeps losing.
--
-- So the rule to apply when adding to this list: if the table could ever carry a price, a cost, a
-- value or a rate, it does not go here. It is granted column by column below, where adding a money
-- column later is safe by default because new columns are not granted at all.
GRANT SELECT ON
  jobcard, operation, equipment_assignment,
  item_group, location, offcut, barcode, allowed_transition,
  quality_hold, inspection, ncr, hours_entry, stock_movement, document
TO varmak_workshop;

-- project holds what the job was quoted at.
GRANT SELECT (id, ref, name, customer_id, status, planned_hours, progress, deadline, description,
              phase, work_types, po_number, workshop, responsible, material_status, notes,
              planned_start, actual_start, planned_completion, expected_completion,
              actual_completion, closed_on, used_hours, hold_reason, hold_comment, expected_resume,
              cancel_reason, created_at)
ON project TO varmak_workshop;

GRANT INSERT ON hours_entry, stock_movement, equipment_event, inspection, equipment_assignment
TO varmak_workshop;
GRANT UPDATE ON operation, jobcard, hours_entry, equipment_assignment TO varmak_workshop;

-- The customer is visible because a welder needs to know whose job is on the bench: who they are,
-- where they are, how to reach them if a drawing is wrong.
--
-- What is withheld is not just the credit limit. price_list, discount_agreement and
-- payment_terms_days are pricing information even though none of them is a number in kronor — they
-- say what this customer is charged — and billing_address and currency belong to invoicing rather
-- than to the bench. §1b says the floor sees no prices; a price list is a price.
GRANT SELECT (id, ref, name, org_no, vat_no, email, phone, city, country, status, website,
              industry, customer_since, customer_type, is_preferred, notes, created_at)
ON customer TO varmak_workshop;

-- ── Money, column by column ───────────────────────────────────────────────────────────────
--
-- This is the sentence from §1b, made literal. The workshop has no SELECT privilege on these
-- columns at all, so `SELECT avg_cost FROM stock_item` is refused by the server — not filtered,
-- not blanked, refused. It cannot be reached through a view the workshop is granted either,
-- because the view would have to be owned by somebody who can read the column and that is exactly
-- the mistake this makes visible.
--
-- The cost of this is real and worth stating: the workshop's queries must name their columns.
-- `SELECT *` on stock_item fails for them. That is the right trade — a SELECT * that silently
-- started returning a price column would be the failure this file exists to prevent.

GRANT SELECT (id, code, description, unit, stock, reserved, min_stock, group_id, location_id,
              subgroup_id, sublocation_id, heat_no, unit_weight, base_unit, size_per_unit,
              weight_per_base, category, grade, dimensions, material_cert_ref, status,
              reorder_quantity, created_at)
ON stock_item TO varmak_workshop;

-- equipment was in the whole-table list above until it gained a purchase price in step 5, at which
-- point a welder could read what every machine in the building cost. The privilege check in
-- test-auth.js caught it the same minute the column was added, which is the third time that exact
-- pattern has appeared in this file: a table in a broad grant quietly acquiring a column that does
-- not belong in it. A table with money in it is granted column by column, always.
GRANT SELECT (id, ref, name, category, status, certification_expiry, manufacturer, model, serial_no,
              asset_no, year_of_manufacture, description, current_location, home_location,
              department, responsible_person, operator, condition, criticality, safety_warnings,
              warranty_expiry, operating_hours, service_interval_hours, last_service_date,
              last_inspection_date, last_calibration_date, qr_code, assigned_project_id, notes,
              created_at)
ON equipment TO varmak_workshop;

GRANT SELECT (id, equipment_id, kind, happened_on, performed_by, result, next_due_on, note, created_at)
ON equipment_event TO varmak_workshop;
GRANT INSERT (equipment_id, kind, happened_on, performed_by, result, next_due_on, note)
ON equipment_event TO varmak_workshop;

-- The commercial tables are not granted to the workshop at all, so there is nothing to revoke a
-- column from: estimate, estimate_line, supplier, supplier_item, purchase_order,
-- purchase_order_line, lead, prospect_finding, opportunity, tender. A welder asking any of them
-- gets "permission denied for table", which is the honest answer.

-- app_user, taken back and given out again column by column.
--
-- The REVOKE is the important line. GRANT ... ON ALL TABLES above included app_user, which handed
-- admin and office every column of it — the password hash and the PIN hash among them. A narrower
-- GRANT written afterwards would have added nothing, exactly as it did not for stock_item. So the
-- table-wide privilege is removed first and then only the columns anybody has a reason to see are
-- given back.
--
-- Nobody gets password_hash or pin_hash. Not office, not admin. There is no operation in this
-- system that needs to read them: signing in compares inside the database, and setting a new one
-- overwrites. A hash that cannot be selected cannot be carried out of the building in a CSV.
REVOKE ALL ON app_user FROM varmak_admin, varmak_office, varmak_workshop;
GRANT SELECT (id, email, display_name, role, is_active, last_seen_at, pin_set_at,
              password_set_at, failed_attempts, locked_until, created_at)
ON app_user TO varmak_admin, varmak_office, varmak_workshop;

-- Only an admin creates or changes people — no self-registration, and nobody promotes themselves.
GRANT INSERT, UPDATE, DELETE ON app_user TO varmak_admin;
GRANT SELECT, INSERT, UPDATE ON app_session TO varmak_admin, varmak_office, varmak_workshop;

-- The log is written by triggers and functions and read by people. Nobody updates or deletes it —
-- the trigger in schema.sql refuses that anyway, but a privilege is cheaper than a refusal.
GRANT SELECT, INSERT ON activity_log TO varmak_admin, varmak_office, varmak_workshop;
REVOKE UPDATE, DELETE ON activity_log FROM varmak_admin, varmak_office, varmak_workshop;

-- A stock movement is append-only for the same reason, and it took a test to notice: admin and
-- office held UPDATE and DELETE on it from the broad grant, with no policy behind either, so the
-- privilege did nothing and looked as though it did something.
--
-- Asked properly, the answer is not "add a policy" — it is that a movement is the record explaining
-- why a stock figure changed, and editing one leaves the store unable to explain itself. Getting a
-- movement wrong is corrected by an adjustment movement, which is also what a real store does: you
-- do not rub out the goods-in book, you write the correction underneath.
REVOKE UPDATE, DELETE ON stock_movement FROM varmak_admin, varmak_office, varmak_workshop;

GRANT EXECUTE ON FUNCTION current_app_user(), current_app_role(), current_app_name(),
  is_admin(), may_see_money(), is_signed_in()
TO varmak_admin, varmak_office, varmak_workshop, varmak_api;

GRANT EXECUTE ON FUNCTION sign_in(text, text, session_door, text) TO varmak_api;
GRANT EXECUTE ON FUNCTION session_owner(text) TO varmak_api;
GRANT EXECUTE ON FUNCTION sign_out(text) TO varmak_api, varmak_admin, varmak_office, varmak_workshop;
GRANT EXECUTE ON FUNCTION next_item_number(bigint) TO varmak_admin, varmak_office;

-- issue_stock is deliberately NOT granted here. It takes the name to record against the movement,
-- which means anybody who can call it can sign a movement in somebody else's name. The door is
-- issue_material further down, which takes the name from the session instead.

-- set_password and set_pin are deliberately not granted to anyone but admin. No self-registration,
-- and a PIN reset happens in person — both decided in §3, both true here rather than only written
-- down. A person changing their own password goes through the API, which does it as admin after
-- checking the old one.
REVOKE ALL ON FUNCTION set_password(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_pin(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_password(bigint, text), set_pin(bigint, text) TO varmak_admin;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Row-level security
--
-- Privileges above decide which tables and columns exist for you. Policies here decide which rows.
-- Both are needed: a grant cannot say "your own row", and a policy cannot hide a column.
--
-- Every table gets RLS enabled, including the ones whose policy is simply "signed in". A table
-- with RLS off is a table that is readable by anyone holding the grant, and the list of tables
-- with RLS off is not something anybody will re-check in a year.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- Forced, so that the owner is held to the same rules. Otherwise the one role that does all
    -- the migrations is the one role none of this applies to, and it is the role most likely to be
    -- left connected in a console.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY signed_in_can_read ON %I FOR SELECT USING (is_signed_in())$p$, t);
  END LOOP;
END;
$$;

-- Writing is not the same question as reading, so it is answered table by table below.
--
-- First, though, the commercial and store tables, where the answer is the same for all of them: the
-- office runs that side of the business and the floor has no business writing any of it. Written as
-- a loop precisely because the rule is uniform — sixteen hand-copied policies is sixteen chances to
-- leave one out, and leaving one out is invisible. It was: the first version of this file had no
-- write policy on estimate, supplier, purchase_order, lead or eleven others, so the office could not
-- create an estimate or even lock one for update. Nothing caught it, because the tests up to then
-- had asked what the FLOOR could not do and taken the office for granted.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'estimate', 'estimate_line', 'supplier', 'supplier_item', 'purchase_order',
    'purchase_order_line', 'lead', 'prospect_finding', 'opportunity', 'tender',
    'item_group', 'location', 'offcut', 'barcode', 'document', 'equipment', 'equipment_event'
  ]
  LOOP
    EXECUTE format($p$CREATE POLICY the_office_runs_this ON %I FOR ALL
                      USING (may_see_money()) WITH CHECK (may_see_money())$p$, t);
  END LOOP;
END;
$$;

-- The transition rulebook is reference data. Changing which status may follow which is a decision
-- about how the workshop runs, not a day's work.
CREATE POLICY admin_edits_the_rulebook ON allowed_transition FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- And now the tables where the two roles have different answers.

CREATE POLICY admin_writes_anything ON customer FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY office_writes_customers ON customer FOR INSERT WITH CHECK (may_see_money());
CREATE POLICY office_edits_customers ON customer FOR UPDATE USING (may_see_money()) WITH CHECK (may_see_money());

CREATE POLICY commercial_writes_projects ON project FOR ALL USING (may_see_money()) WITH CHECK (may_see_money());

-- A jobcard may be moved along by the floor — that is the work — but created and deleted by the
-- office, because a jobcard is a commitment to do something for a customer.
CREATE POLICY commercial_writes_jobcards ON jobcard FOR ALL USING (may_see_money()) WITH CHECK (may_see_money());
CREATE POLICY floor_moves_jobcards ON jobcard FOR UPDATE USING (is_signed_in()) WITH CHECK (is_signed_in());

CREATE POLICY floor_runs_operations ON operation FOR UPDATE USING (is_signed_in()) WITH CHECK (is_signed_in());
CREATE POLICY commercial_writes_operations ON operation FOR ALL USING (may_see_money()) WITH CHECK (may_see_money());

-- Hours: you book your own. Correcting somebody else's timesheet is an office job, and a welder
-- being able to edit another welder's hours is how a time system stops being evidence of anything.
CREATE POLICY book_your_own_hours ON hours_entry FOR INSERT
  WITH CHECK (worker = current_app_name());
CREATE POLICY correct_your_own_hours ON hours_entry FOR UPDATE
  USING (worker = current_app_name() OR may_see_money())
  WITH CHECK (worker = current_app_name() OR may_see_money());
CREATE POLICY office_removes_hours ON hours_entry FOR DELETE USING (may_see_money());

CREATE POLICY anyone_signed_in_moves_stock ON stock_movement FOR INSERT WITH CHECK (is_signed_in());
CREATE POLICY commercial_writes_stock ON stock_item FOR ALL USING (may_see_money()) WITH CHECK (may_see_money());

CREATE POLICY floor_records_equipment_events ON equipment_event FOR INSERT WITH CHECK (is_signed_in());
CREATE POLICY floor_assigns_equipment ON equipment_assignment FOR ALL USING (is_signed_in()) WITH CHECK (is_signed_in());

-- Quality: a welder records what they found. Only the office releases a hold, which is the
-- decision that lets work leave the building.
CREATE POLICY floor_records_inspections ON inspection FOR INSERT WITH CHECK (is_signed_in());
CREATE POLICY commercial_writes_inspections ON inspection FOR ALL USING (may_see_money()) WITH CHECK (may_see_money());
CREATE POLICY only_the_office_holds ON quality_hold FOR ALL USING (may_see_money()) WITH CHECK (may_see_money());
CREATE POLICY commercial_writes_ncrs ON ncr FOR ALL USING (may_see_money()) WITH CHECK (may_see_money());

CREATE POLICY anyone_signed_in_logs ON activity_log FOR INSERT WITH CHECK (is_signed_in());

-- Your own session, and your own row. Reading the whole session table would be a list of who is
-- logged in and on which device, which is nobody's business but an admin's.
CREATE POLICY your_own_session ON app_session FOR ALL
  USING (user_id = current_app_user() OR is_admin())
  WITH CHECK (user_id = current_app_user() OR is_admin());

DROP POLICY signed_in_can_read ON app_user;
CREATE POLICY your_own_row ON app_user FOR SELECT
  USING (id = current_app_user() OR may_see_money());
CREATE POLICY admin_manages_people ON app_user FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- The four doors that have to work before anybody is signed in
--
-- FORCE ROW LEVEL SECURITY above holds the owner to the same policies as everybody else, which is
-- the point of it — but it also means sign_in cannot write a session row, because at the moment it
-- runs nobody is signed in yet and every policy says no. That is not a flaw in the policies; it is
-- the bootstrap problem every auth system has.
--
-- The answer is one role that may step around row security, owning exactly the functions that have
-- to: signing in, checking a token, signing out, and issuing material. Four functions, listed here,
-- each doing one thing and checking for itself who is asking. Everything else in the system is
-- subject to the policies with no exception, and this list is short enough to read.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'varmak_engine') THEN
    CREATE ROLE varmak_engine NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

-- Same reason as the roles above: set unconditionally, because the role may already exist from an
-- earlier build of a different database in this cluster.
ALTER ROLE varmak_engine NOLOGIN BYPASSRLS NOSUPERUSER;

GRANT USAGE ON SCHEMA public TO varmak_engine;
GRANT SELECT, INSERT, UPDATE ON app_user, app_session, stock_item, project TO varmak_engine;
-- Read-only, and only what the roll-up above walks: an hours entry names a jobcard, and the jobcard
-- names the project whose figure is being recomputed.
GRANT SELECT ON jobcard, hours_entry TO varmak_engine;
-- Insert only on the two that are append-only, even for the role that may step around row security.
GRANT SELECT, INSERT ON activity_log, stock_movement TO varmak_engine;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO varmak_engine;

ALTER FUNCTION sign_in(text, text, session_door, text) OWNER TO varmak_engine;
ALTER FUNCTION session_owner(text) OWNER TO varmak_engine;
ALTER FUNCTION sign_out(text) OWNER TO varmak_engine;
ALTER FUNCTION register_failure(bigint) OWNER TO varmak_engine;
ALTER FUNCTION current_app_role() OWNER TO varmak_engine;

-- The project's used hours are recomputed whenever anybody books time, and the person booking it is
-- usually a welder who has no business writing to project at all. The roll-up is the system keeping
-- its own figure straight, not the welder editing a project, so it runs as the engine.
--
-- Narrow on purpose: it recomputes one sum from hours_entry and writes it to one column. A
-- SECURITY DEFINER trigger that did anything broader would be a hole on every write to the table it
-- hangs off.
ALTER FUNCTION project_hours_roll_up() OWNER TO varmak_engine;
ALTER FUNCTION project_hours_roll_up() SECURITY DEFINER;
ALTER FUNCTION current_app_name() OWNER TO varmak_engine;
ALTER FUNCTION set_password(bigint, text) OWNER TO varmak_engine;
ALTER FUNCTION set_pin(bigint, text) OWNER TO varmak_engine;
ALTER FUNCTION set_password(bigint, text) SECURITY DEFINER;
ALTER FUNCTION set_pin(bigint, text) SECURITY DEFINER;

-- ── Material leaves the shelf through one door ────────────────────────────────────────────
--
-- §1b says the workshop may issue material. Doing that changes stock_item, and the obvious way to
-- allow it — granting UPDATE on the quantity columns — would also let a welder set the stock to
-- whatever they liked with no movement written against it. Then the store's figures and the
-- movements that are supposed to explain them drift apart, silently, which is the failure the
-- movement table exists to prevent.
--
-- So the workshop gets no UPDATE on stock_item at all. It gets this function, which is the door.
-- Note what it does NOT take: who is doing it. That comes from the session, so the movement
-- records the person who actually issued the steel rather than whichever name the caller passed.
CREATE FUNCTION issue_material(p_item_id bigint, p_quantity numeric, p_jobcard_id bigint,
                               p_note text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  who text;
BEGIN
  SELECT display_name INTO who FROM app_user WHERE id = current_app_user() AND is_active;
  IF who IS NULL THEN
    RAISE EXCEPTION 'sign in before taking material off the shelf' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN issue_stock(p_item_id, p_quantity, p_jobcard_id, who, p_note);
END;
$$;

ALTER FUNCTION issue_material(bigint, numeric, bigint, text) OWNER TO varmak_engine;
ALTER FUNCTION issue_stock(bigint, numeric, bigint, text, text) OWNER TO varmak_engine;
-- Named roles as well as PUBLIC. REVOKE ... FROM PUBLIC does not remove a privilege granted
-- explicitly to a role, and an earlier version of this file granted EXECUTE on issue_stock to all
-- three roles a hundred lines above. The revoke below looked like it closed that and did not: the
-- office kept the privilege, and being the one role that also holds UPDATE on stock_item, it could
-- sign a stock movement in any name it liked. Third time the same shape of mistake appeared in this
-- file — a broad or early GRANT, and a narrower line further down that reads as though it undoes it.
--
-- Naming the roles is defensive rather than load-bearing: with that early GRANT gone, revoking from
-- PUBLIC alone is enough, because EXECUTE is granted to PUBLIC by default and to no role
-- explicitly. It stays because the next person to add a GRANT above this line should find it
-- already closed.
REVOKE ALL ON FUNCTION issue_stock(bigint, numeric, bigint, text, text)
FROM PUBLIC, varmak_admin, varmak_office, varmak_workshop;
REVOKE ALL ON FUNCTION issue_material(bigint, numeric, bigint, text)
FROM PUBLIC, varmak_admin, varmak_office, varmak_workshop;
GRANT EXECUTE ON FUNCTION issue_material(bigint, numeric, bigint, text)
TO varmak_admin, varmak_office, varmak_workshop;

-- ── Two tables where "signed in" is not enough ────────────────────────────────────────────
--
-- The loop above gave every table a permissive "signed in may read" policy, and permissive
-- policies are OR'd together. On these two that would defeat the narrower policy sitting beside
-- it: any signed-in person could read the whole session table — a list of who is logged in, on
-- which device — or every row of app_user.
DROP POLICY signed_in_can_read ON app_session;

COMMIT;
