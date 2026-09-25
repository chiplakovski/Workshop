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

-- And then: where did it actually go?
--
-- A managed Postgres — Supabase among them — installs extensions into a schema of their own rather
-- than into `public`, and then two different things break. The first breaks the install, three tables
-- below: `app_session.token` has `DEFAULT encode(gen_random_bytes(32), 'hex')`, a column default is
-- parsed while the table is being created, and the install stops dead on "function
-- gen_random_bytes(integer) does not exist". The second breaks later and much more quietly: every PIN
-- and every password in this system is hashed by `crypt()` inside a function body, which is resolved
-- when it runs rather than when it was written — so a deployment that installed perfectly can still
-- be one where nobody can sign in, discovered by a workshop on the morning it meant to start.
--
-- Three paths therefore have to be right, and they are set in three places: this session's, for the
-- rest of this file; the database's, for every session opened afterwards; and the connecting role's,
-- further down, which is the one the server's own sessions get.
DO $$
DECLARE
  home text := (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
                 WHERE e.extname = 'pgcrypto');
BEGIN
  IF home IS NULL THEN
    RAISE EXCEPTION 'pgcrypto is not installed in this database, and every password in this system needs it';
  END IF;
  IF home = 'public' THEN
    RETURN;
  END IF;
  PERFORM set_config('search_path', format('public, %I', home), false);
  BEGIN
    EXECUTE format('ALTER DATABASE %I SET search_path = public, %I', current_database(), home);
  EXCEPTION WHEN insufficient_privilege THEN
    -- Not fatal: the role-level path below is what the server's sessions use. Said out loud, because
    -- it means a psql session opened by hand will not find crypt() and that is confusing on its own.
    RAISE NOTICE 'not the owner of this database, so its search_path is unchanged — the role''s is still set';
  END;
  RAISE NOTICE 'pgcrypto is in schema %, so the search_path includes it', home;
END;
$$;

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
ALTER ROLE varmak_admin NOLOGIN NOBYPASSRLS;
ALTER ROLE varmak_office NOLOGIN NOBYPASSRLS;
ALTER ROLE varmak_workshop NOLOGIN NOBYPASSRLS;
ALTER ROLE varmak_api NOBYPASSRLS;

-- NOSUPERUSER was on those four lines and cannot be. Postgres refuses any mention of the SUPERUSER
-- attribute from a role that is not a superuser itself — even when the mention changes nothing — and
-- on a managed database the most privileged role you are given is never a superuser. So the install
-- stopped here, four lines into the roles, on every hosted Postgres there is.
--
-- The intent was worth keeping, so it is asserted rather than set: a superuser among these roles would
-- sit outside every policy in this file, and the system would look exactly as it does when it works.
-- Asserting it is also strictly better than setting it, because it catches the case where somebody
-- granted it by hand afterwards.
DO $$
DECLARE
  wrong text := (SELECT string_agg(rolname, ', ' ORDER BY rolname) FROM pg_roles
                  WHERE rolname IN ('varmak_admin', 'varmak_office', 'varmak_workshop', 'varmak_api')
                    AND rolsuper);
BEGIN
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION '% is a superuser, which puts it outside every row-level policy in this file', wrong;
  END IF;
END;
$$;

GRANT varmak_admin, varmak_office, varmak_workshop TO varmak_api;
GRANT USAGE ON SCHEMA public TO varmak_admin, varmak_office, varmak_workshop, varmak_api;

-- Where pgcrypto actually is, which on a managed database is not where this file assumes.
--
-- Every PIN and every password in this system is hashed by crypt() and gen_salt(), and both come from
-- pgcrypto. On a machine where this was developed the extension goes into `public` and is found
-- without anybody thinking about it. A hosted Postgres — Supabase among them — installs its
-- extensions into a schema of their own, and then the connecting role's search_path cannot see those
-- two functions: `sign_in` raises "function crypt(text, text) does not exist" and NOBODY CAN GET IN.
--
-- That failure arrives at the first sign-in on a new deployment, which is the worst possible place to
-- find it — the install said nothing, every table is there, and the only symptom is a workshop locked
-- out of its own system on the morning it was meant to start using it.
--
-- So the path is set here from where this database actually put the extension, rather than assumed.
-- Only varmak_api needs it: a role's settings are applied when it logs in, and SET LOCAL ROLE does
-- not re-apply them, so the one role that connects is the one that carries the path for the three it
-- becomes. The functions that hash are SECURITY DEFINER but do not set a path of their own, so they
-- run with the session's — which is this one.
DO $$
DECLARE
  home text := (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
                 WHERE e.extname = 'pgcrypto');
BEGIN
  IF home IS NULL THEN
    RAISE EXCEPTION 'pgcrypto is not installed in this database, and every password in this system needs it';
  END IF;
  IF home <> 'public' THEN
    EXECUTE format('ALTER ROLE varmak_api SET search_path = public, %I', home);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO varmak_api', home);
    RAISE NOTICE 'pgcrypto is in schema %, so varmak_api searches there too', home;
  END IF;
END;
$$;

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
  quality_hold, inspection, ncr, hours_entry, stock_movement, document,
  -- A name, a role, an email and a telephone number. Nothing on this table could ever be a price,
  -- which is the test the comment above sets for being in this list — and a welder holding a drawing
  -- that is wrong needs to be able to ring somebody.
  customer_contact
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

-- What a welder writes when they record an inspection result, column by column. Everything that says
-- what was asked for — the drawing, the revision, the acceptance criteria, whether the customer is
-- coming to witness it — stays out of this list, because a result recorded alongside a quietly
-- changed acceptance criterion is a pass against a standard nobody agreed to.
GRANT UPDATE (result, findings, critical, actual_date, inspector, status)
ON inspection TO varmak_workshop;
-- The checklist is the evidence, so the floor writes it and can clear it while the inspection is
-- still open — complete_inspection replaces the lines wholesale rather than patching them.
GRANT SELECT, INSERT, DELETE ON inspection_check TO varmak_workshop;

-- The merchant a non-conforming plate came from, by name. payment_terms_days is what this supplier is
-- paid on, which is a commercial term and stays out by the same §1b line that withholds a customer's
-- price list — so this is a column grant and not the table. The name is in because a welder who has
-- just rejected a batch of steel needs to be able to say whose steel it was, and the NCR register
-- shows exactly that column.
-- payment_terms_days is what this workshop is paid on, and supplier_item holds what each merchant
-- charges — both are prices in the sense §1b means, so both stay with the money. Everything else about
-- a merchant is here: what they sell, where they are, who to ring, and what this workshop thinks of
-- them, because a welder who has just rejected a batch of steel needs to say whose steel it was.
GRANT SELECT (id, ref, name, org_no, vat_no, email, phone, website, address, city, country,
              category, supplier_type, established, delivery_terms, minimum_order, currency,
              rating, status, notes, created_at)
ON supplier TO varmak_workshop;
GRANT SELECT ON supplier_contact TO varmak_workshop;

-- The customer is visible because a welder needs to know whose job is on the bench: who they are,
-- where they are, how to reach them if a drawing is wrong.
--
-- What is withheld is not just the credit limit. price_list, discount_agreement and
-- payment_terms_days are pricing information even though none of them is a number in kronor — they
-- say what this customer is charged — and billing_address and currency belong to invoicing rather
-- than to the bench. §1b says the floor sees no prices; a price list is a price.
GRANT SELECT (id, ref, name, org_no, vat_no, email, phone, city, country, status, website,
              industry, customer_since, customer_type, is_preferred, preferred_contact, notes,
              created_at)
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
              subgroup_id, sublocation_id, bin_code, heat_no, unit_weight, base_unit, size_per_unit,
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
              warranty_expiry,
              -- When it was bought and from whom, which the register shows and neither of which is a
              -- figure in kronor. purchase_price is, and is deliberately not here — the whole reason
              -- this grant is written column by column.
              purchase_date, purchase_supplier,
              operating_hours, service_interval_hours, last_service_date,
              last_inspection_date, last_calibration_date, qr_code, assigned_project_id, notes,
              -- Whether this machine needs a check before it is run. The floor is the only place that
              -- can answer it, so the floor has to be able to see that it is being asked.
              pre_use_check_required,
              created_at)
ON equipment TO varmak_workshop;

-- The three added with the pre-use check are here rather than left out, and each is needed by name:
-- `jobcard_id` because a check is signed for a particular job and the gate matches on that, `resolved`
-- because it is the flag the gate reads to decide whether a failure still stops the machine, and
-- `resolves_event_id` because a passing check has to be able to say which failure it answers. `cost`
-- stays out: what a repair cost is money, and this list is column by column for exactly that reason.
--
-- Left out, the gate in schema.sql read `resolved` on the welder's behalf and Postgres answered
-- "permission denied for table equipment_event" — so every welder starting a job got a privilege error
-- instead of a safety check. That is the fifth time a new column has done this, and it is the column
-- grant working: a column nobody has thought about is a column nobody can read.
GRANT SELECT (id, equipment_id, kind, happened_on, performed_by, result, next_due_on, note,
              jobcard_id, resolved, resolves_event_id, created_at)
ON equipment_event TO varmak_workshop;
GRANT INSERT (equipment_id, kind, happened_on, performed_by, result, next_due_on, note,
              jobcard_id, resolves_event_id)
ON equipment_event TO varmak_workshop;
-- And UPDATE on the one flag, because record_equipment_event marks a failure answered when the check
-- that answers it is signed — by the welder standing in front of the machine. Only that column: a
-- floor that could rewrite the result of a check it made yesterday is not a record.
GRANT UPDATE (resolved) ON equipment_event TO varmak_workshop;

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

-- The one place the office may delete, and it is a considered exception to the rule above rather
-- than an oversight. That rule is about the record of what happened: a quote that was sent and a job
-- that was run cannot be removed, because removing one is not a correction, it is a different past.
-- A contact at a customer is not that. Somebody who has left the company is not a record of
-- anything, and taking their name off the list is exactly a correction — while leaving it there
-- means somebody rings a number that has been reassigned and believes what they are told.
-- Both contact lists are replaced wholesale by their save functions, which delete and re-insert, so the
-- office needs DELETE on them. It is the one place in the system where deleting a row is the right shape
-- for an edit: a contact who has left the company is not history, they are a mistake in a list.
GRANT DELETE ON customer_contact, supplier_contact TO varmak_office;

-- And on the steps of a jobcard, for the same reason and with the same test applied: editing a plan
-- means taking a line off it, and a line nobody has worked on is not a record of anything. What makes
-- this safe is not this grant being narrow — it is the trigger in schema.sql that refuses to delete a
-- step with hours booked on it or one that has been started, whoever asks and however they ask.
GRANT DELETE ON operation TO varmak_office;

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
    'item_group', 'location', 'offcut', 'barcode', 'document', 'equipment', 'equipment_event',
    'customer_contact', 'supplier_contact'
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
-- And answers a failed check. Narrow on both ends: the policy allows the floor to touch only a row that
-- is a failed pre-use check, and the column grant above allows it to touch only `resolved` on that row.
-- Together that is one sentence — a welder may mark a failed check answered — and nothing else.
--
-- Needed because the ALL policy above is the office's and asks may_see_money(), so a welder's UPDATE
-- matched no policy and quietly affected nothing: record_equipment_event would insert the check that
-- answers the failure and leave the failure standing, so the machine stayed stopped for a reason
-- somebody had already dealt with. A GRANT with no policy behind it fails closed, which is the safe
-- direction and still the wrong answer.
CREATE POLICY floor_answers_a_failed_check ON equipment_event FOR UPDATE
  USING (is_signed_in() AND kind = 'pre-use-check' AND result = 'fail')
  WITH CHECK (is_signed_in() AND kind = 'pre-use-check' AND result = 'fail');
CREATE POLICY floor_assigns_equipment ON equipment_assignment FOR ALL USING (is_signed_in()) WITH CHECK (is_signed_in());

-- Quality: a welder records what they found. Only the office releases a hold, which is the
-- decision that lets work leave the building.
CREATE POLICY floor_records_inspections ON inspection FOR INSERT WITH CHECK (is_signed_in());
-- And records what they found on one that is still open. The USING clause is read against the row as
-- it stands, so this permits a verdict on an undecided inspection and nothing else: a welder cannot
-- come back a week later and turn a failure into a pass, because by then the row it is matched
-- against no longer says pending.
CREATE POLICY floor_records_a_result ON inspection FOR UPDATE
  USING (is_signed_in() AND result = 'pending') WITH CHECK (is_signed_in());
-- The checklist, while its inspection is still undecided. Tied to the parent rather than to the
-- signed-in person, because an inspection is not owned by whoever happens to write a line on it —
-- what makes a line writable is that nobody has yet signed for the result it is evidence for.
CREATE POLICY floor_writes_the_checklist ON inspection_check FOR INSERT
  WITH CHECK (is_signed_in() AND EXISTS (
    SELECT 1 FROM inspection i WHERE i.id = inspection_id AND i.result = 'pending'));
CREATE POLICY floor_clears_the_checklist ON inspection_check FOR DELETE
  USING (is_signed_in() AND EXISTS (
    SELECT 1 FROM inspection i WHERE i.id = inspection_id AND i.result = 'pending'));
CREATE POLICY commercial_writes_the_checklist ON inspection_check FOR ALL
  USING (may_see_money()) WITH CHECK (may_see_money());
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
ALTER ROLE varmak_engine NOLOGIN BYPASSRLS;

-- Whoever is installing has to be able to SET ROLE to this one, or every `ALTER FUNCTION ... OWNER TO
-- varmak_engine` below is refused — and those lines are what make the four functions allowed to step
-- around row security belong to a role that may. A superuser can always become any role. A CREATEROLE
-- role, which is the most a managed database gives you, gets ADMIN OPTION on the roles it creates and
-- **not** the right to become one, so the install stopped dead at the first of those ALTERs.
--
-- Two things about the shape of this are the result of finding out the hard way. `pg_has_role(...,
-- 'MEMBER')` answers true on the strength of that admin option alone, so a guard written with it skips
-- the grant that is needed — which is exactly what happened here, and the error message was identical
-- to having no guard at all. And it is a plain GRANT rather than PostgreSQL 16's `WITH SET TRUE`,
-- because the hosted databases this installs onto are still on 15 where that is a parse error; the
-- plain form adds a membership that carries SET on both versions.
DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('GRANT varmak_engine TO %I', current_user);
  END IF;
END;
$$;
-- NOSUPERUSER omitted here for the reason given at the other four: naming the attribute at all needs
-- to be a superuser. This one is checked below instead, where it matters more than the others — this
-- is the role that owns the functions allowed to step around row security.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'varmak_engine' AND rolsuper) THEN
    RAISE EXCEPTION 'varmak_engine is a superuser: it owns the functions that bypass row security, '
      'and as a superuser it would bypass everything else as well';
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO varmak_engine;
-- And on whichever schema pgcrypto is in, for the same reason varmak_api was given it above. This one
-- is not about a search_path: a SECURITY DEFINER function runs as its owner, so the body of sign_in
-- resolves crypt() with this role's privileges, and USAGE on the schema is what lets it.
DO $$
DECLARE
  home text := (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
                 WHERE e.extname = 'pgcrypto');
BEGIN
  IF home IS NULL OR home = 'public' THEN
    RETURN;
  END IF;
  -- Attempted, then checked. On a managed database the extension schema often belongs to a role you
  -- are not, so this GRANT can come back as "no privileges were granted" — a WARNING, which an install
  -- scrolls straight past, and then nobody can sign in. Checking turns that into a refusal here, with
  -- the one line somebody has to run. Nothing in this file matters more: crypt() resolves as this role.
  BEGIN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO varmak_engine', home);
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF NOT has_schema_privilege('varmak_engine', home, 'USAGE') THEN
    -- quote_ident and a plain %, because RAISE does not take format()'s %I: written that way, the line
    -- somebody is meant to copy out of this message came out as `GRANT USAGE ON SCHEMA extensionsI`.
    -- A refusal whose instruction does not work is worse than no instruction.
    RAISE EXCEPTION 'varmak_engine cannot use schema %, where pgcrypto lives, so no password in this '
      'system can be hashed or checked. Ask whoever owns that schema to run: GRANT USAGE ON SCHEMA % '
      'TO varmak_engine;', home, quote_ident(home);
  END IF;
END;
$$;
GRANT SELECT, INSERT, UPDATE ON app_user, app_session, stock_item, project TO varmak_engine;
-- And four columns on equipment, for equipment_state_after_event and nothing else: the date a machine
-- was last serviced, inspected or calibrated, and its status when it breaks down. Column by column
-- rather than the table, because this role bypasses row security and the whole point of the function is
-- that it can do exactly two things — a table-wide UPDATE here would make it able to rewrite the
-- register, the certificate expiry and the purchase price of every machine in the shop.
-- SELECT on the three dates as well as the id, because the UPDATE below reads them: each is set to
-- `CASE WHEN ... THEN p_day ELSE last_service_date END`, and reading a column in a SET expression needs
-- SELECT on it. Granted UPDATE and not SELECT, the statement came back as "permission denied for table
-- equipment" with nothing to say which column it meant.
GRANT SELECT (id, status, last_service_date, last_inspection_date, last_calibration_date)
ON equipment TO varmak_engine;
GRANT UPDATE (status, last_service_date, last_inspection_date, last_calibration_date)
ON equipment TO varmak_engine;
-- And the one route by which the floor places a hold: hold_after_failed_inspection reads the
-- inspection it is holding work for and writes the hold. SELECT on inspection and no UPDATE, because
-- that function must not be able to change what was found — only to act on it. INSERT on quality_hold
-- and no UPDATE either: releasing a hold is the office's decision and this role has no part in it.
GRANT SELECT ON inspection TO varmak_engine;
GRANT SELECT, INSERT ON quality_hold TO varmak_engine;
-- Read-only, and only what the roll-up above walks: an hours entry names a jobcard, and the jobcard
-- names the project whose figure is being recomputed.
GRANT SELECT ON jobcard, hours_entry TO varmak_engine;
-- Insert only on the two that are append-only, even for the role that may step around row security.
GRANT SELECT, INSERT ON activity_log, stock_movement TO varmak_engine;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO varmak_engine;

-- CREATE on the schema, for the length of the ownership changes and no longer.
--
-- Postgres requires the incoming owner to hold CREATE on the schema a function lives in. On this
-- machine the install runs as a superuser and the question never comes up; on PostgreSQL 15 and later
-- `public` no longer grants CREATE to everybody, so on a hosted database every ALTER below was refused
-- with "permission denied for schema public" — after the tables, the policies and the grants had all
-- gone in, which is the worst place for an install to stop.
--
-- Granted and then taken away again, in the same transaction, because nothing this role does afterwards
-- creates anything: varmak_engine cannot log in, and the only code that runs as it is the handful of
-- functions listed here. A standing CREATE would be a privilege that serves nobody.
GRANT CREATE ON SCHEMA public TO varmak_engine;

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

-- And taken back, as promised above. api.sql grants it again for its own ownership changes and takes
-- it away the same way, so the privilege exists only while it is being used.
REVOKE CREATE ON SCHEMA public FROM varmak_engine;
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

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- The welding registers: who may read and who may write
--
-- All five tables are granted SELECT to the floor, and that is not a concession — a welder needs to read
-- the procedure they are welding to and the qualification they hold. Nothing in any of them could ever be
-- a price, which is the test §1b sets for this list.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
GRANT SELECT ON wps, welder_qual, weld, weld_repair, ndt_report
TO varmak_admin, varmak_office, varmak_workshop;

-- A welder LOGS THEIR OWN WELD. This is the same rule as booking hours, for the same reason and with more
-- at stake: a weld log filled in by somebody in the office is a document saying what should have happened.
-- The INSERT policy is `welder_id = current_app_user()`, so a weld cannot be entered in another welder's
-- name by anybody — including the office, including an admin. Correcting one afterwards is an office job,
-- like correcting a timesheet.
GRANT INSERT, UPDATE ON weld TO varmak_admin, varmak_office, varmak_workshop;
GRANT INSERT ON weld_repair TO varmak_admin, varmak_office, varmak_workshop;
GRANT INSERT, UPDATE ON ndt_report TO varmak_admin, varmak_office, varmak_workshop;

-- A procedure and a qualification are decisions about who may weld what, not records of what happened.
-- A welder cannot qualify themselves, and the floor holds no write on either.
GRANT INSERT, UPDATE, DELETE ON wps, welder_qual TO varmak_admin, varmak_office;

CREATE POLICY log_your_own_weld ON weld FOR INSERT
  WITH CHECK (welder_id = current_app_user());
CREATE POLICY correct_a_weld ON weld FOR UPDATE
  USING (welder_id = current_app_user() OR may_see_money())
  WITH CHECK (welder_id = current_app_user() OR may_see_money());

-- A repair may be done by somebody other than whoever made the weld, and an NDT report may be signed by a
-- firm outside — so neither is tied to the session's own id. Both record who entered them either way.
CREATE POLICY anyone_signed_in_records_a_repair ON weld_repair FOR INSERT
  WITH CHECK (is_signed_in());
CREATE POLICY anyone_signed_in_records_ndt ON ndt_report FOR INSERT
  WITH CHECK (is_signed_in());
CREATE POLICY ndt_is_corrected_by_whoever_signed_it ON ndt_report FOR UPDATE
  USING (recorded_by = current_app_name() OR may_see_money())
  WITH CHECK (recorded_by = current_app_name() OR may_see_money());

CREATE POLICY the_office_runs_the_procedures ON wps FOR ALL
  USING (may_see_money()) WITH CHECK (may_see_money());
CREATE POLICY the_office_runs_the_qualifications ON welder_qual FOR ALL
  USING (may_see_money()) WITH CHECK (may_see_money());

-- Nobody deletes a weld, a repair or an NDT report. A weld that was made was made, and a register you can
-- delete from is not a register — the same rule as the stock movements and the activity log.
REVOKE DELETE ON weld, weld_repair, ndt_report FROM varmak_admin, varmak_office, varmak_workshop;

-- And nobody edits a repair. It is a row saying a joint was ground out and re-welded on a day, which is
-- either true or it is not; correcting one is not a correction, it is a different past. Revoked explicitly
-- because `GRANT SELECT, INSERT, UPDATE ... ON ALL TABLES` two hundred lines above hands admin and office
-- a write on every table in the schema, including every table added afterwards — so a table that should
-- not be writable has to say so. test-auth.js caught this within a minute of the tables existing: it asks
-- which roles hold a write privilege that no policy permits, and weld_repair had UPDATE with an INSERT
-- policy and nothing else. Fails closed, so it was safe and still wrong, which is the third time that
-- exact sentence has been written in this project.
REVOKE UPDATE ON weld_repair FROM varmak_admin, varmak_office, varmak_workshop;

COMMIT;
