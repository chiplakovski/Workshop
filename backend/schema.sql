-- Varmak Workshop — the database.
--
-- This is step 1 and 2 of the order agreed in BACKEND.md: the schema and its constraints, with
-- the safety rules as triggers from the start, and numbering as sequences before two people ever
-- use it. "Add the constraints later" was ruled out on purpose — later never comes, and by then
-- there is data that violates them.
--
-- The principle that decides what lives here: anything that must be true no matter who is asking.
-- The browser checks the same things to save a round trip and to grey a button out before it is
-- pressed, but the browser is convenience. This file is the floor nothing falls through.
--
-- Written for PostgreSQL 16 and run against it. Every constraint and every trigger in here has a
-- test in backend/test-schema.js that hands it the thing it exists to refuse and asserts both the
-- refusal and its wording: 110 refusals across 68 checks, plus 58 things the schema must still
-- allow — because a gate that says no to everything passes every refusal test and is useless.
-- Three of the checks start a second session, because the failures that matter most (two people
-- taking one document number, two people adding to one item group, two people issuing the last of
-- something) cannot be reproduced with one.
--
-- backend/mutation-check.js then asks the question passing tests cannot: it puts each rule's bug
-- back, one at a time, and fails if the suite sleeps through it. Four of the bugs it now guards
-- against were really in this file, and three of those survived a careful reading of it:
--
--   • The hold gates only ran on UPDATE, so a jobcard created already 'completed' walked straight
--     past them — the status never transitioned, so the trigger never looked.
--   • The hours roll-up only recomputed the operation named on the row it was handed, so an entry
--     booked to the wrong operation and corrected left the hours on both. The same three hours,
--     counted twice, in a figure work is priced from.
--   • Nothing stopped an hours entry naming one jobcard and an operation belonging to another.
--   • The expired-certification refusal read "Fixture MIG 400s certification expired": %s in a
--     RAISE is the placeholder followed by a literal s, not a possessive.
--
-- And one thing the mutation check found that reading could not: the test for "stock can never go
-- below zero" was standing on the wrong constraint, and passed with its own rule deleted.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Numbering
--
-- Document numbers came from a counter in the browser. Two people creating a customer at the same
-- moment both got C-001, and neither knew. Measured, not supposed. A sequence is the one place
-- that cannot happen: Postgres hands out each value once, even to concurrent transactions, and
-- even if the transaction that took it rolls back — a gap in the numbering is not a problem, two
-- documents with one number is.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE seq_customer;
CREATE SEQUENCE seq_project;
CREATE SEQUENCE seq_jobcard;
CREATE SEQUENCE seq_hold;
CREATE SEQUENCE seq_inspection;
CREATE SEQUENCE seq_movement;
CREATE SEQUENCE seq_supplier;
CREATE SEQUENCE seq_lead;
CREATE SEQUENCE seq_opportunity;
CREATE SEQUENCE seq_tender;
CREATE SEQUENCE seq_estimate;
CREATE SEQUENCE seq_purchase_order;
CREATE SEQUENCE seq_ncr;
CREATE SEQUENCE seq_offcut;
CREATE SEQUENCE seq_document;

-- Human-readable references, built from the sequence rather than from a count of existing rows.
-- Counting rows is what breaks the moment anything is deleted or two writers race.
CREATE FUNCTION next_ref(prefix text, seq regclass, digits int DEFAULT 4) RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT prefix || lpad(nextval(seq)::text, digits, '0');
$$;

CREATE FUNCTION next_dated_ref(prefix text, seq regclass, digits int DEFAULT 4) RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(nextval(seq)::text, digits, '0');
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Who is asking
--
-- Two roles are in use, as decided in BACKEND.md §1b for a workshop of two to four people: an
-- admin who runs the place, and the workshop, who book hours, start and pause operations, issue
-- material and record inspection results, and see no prices at all. `office` is in the enum from the start
-- but nobody holds it — the day somebody is hired to do the quoting it is a role change, not a
-- migration. The role lives on the row rather than in application code, because the API is not
-- the only thing that will ever connect to this database.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('admin', 'office', 'workshop');

CREATE TABLE app_user (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND email <> ''),
  display_name  text NOT NULL CHECK (btrim(display_name) <> ''),
  role          user_role NOT NULL DEFAULT 'workshop',
  -- The password is never stored, only what it hashes to.
  --
  -- The first version of this table had password_hash beside a password_salt column, with a
  -- constraint that the two were set together. That was wrong: bcrypt's output already carries its
  -- algorithm, cost and salt, so a separate salt column is at best redundant and at worst a place
  -- to put a salt that is not the one the hash was made with. What the constraint was reaching for
  -- is written directly instead — the column has to LOOK like a bcrypt hash, which is what makes
  -- storing a plain-text password impossible rather than merely discouraged.
  password_hash text CONSTRAINT password_is_hashed
                CHECK (password_hash IS NULL OR password_hash ~ '^\$2[aby]\$\d{2}\$'),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Customers, projects, jobcards
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE customer (
  id          bigserial PRIMARY KEY,
  ref         text NOT NULL UNIQUE DEFAULT next_ref('C-', 'seq_customer'::regclass, 3),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  org_no      text,
  vat_no      text,
  email       text,
  phone       text,
  city        text,
  country     text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','prospect')),
  credit_limit numeric(12,2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
  -- Everything below was added in step 5, from backend/coverage.js: these are fields the customer
  -- screens already read and the first version of this table could not hold. The schema was built
  -- from the twenty-five-table plan in BACKEND.md §2, which trimmed the collections but not the
  -- fields inside them, so pointing the frontend at it would have left these blank.
  website     text,
  industry    text,
  customer_since date,
  payment_terms_days int CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0),
  currency    char(3) NOT NULL DEFAULT 'SEK' CHECK (currency = upper(currency)),
  customer_type text CHECK (customer_type IS NULL OR customer_type IN ('direct','reseller','oem','public')),
  is_preferred boolean NOT NULL DEFAULT false,
  -- How this customer wants to be contacted — 'Email', 'Phone', 'Post'. A different fact from
  -- is_preferred above, and the two were conflated: the customer screen's field is called
  -- `preferred` and means the contact method, the snapshot was handing it is_preferred, and the page
  -- would have shown "true" where it says Preferred Contact. Two facts, two columns, and the names
  -- are now far enough apart to stop happening again.
  preferred_contact text,
  price_list  text,
  delivery_terms text,
  discount_agreement text,
  billing_address text,
  -- Where the steel goes, which is not always where the invoice goes. The customer screen has always
  -- shown the two addresses side by side and had one column between them, so the shipping card was
  -- showing the billing address under a heading that said otherwise.
  shipping_address text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The people at the customer, which the customer screen has always held as a list on the record and
-- which therefore has never been able to have a rule about it. Two of them matter.
--
-- One main contact, not several. The screen marks the first in its array as primary, so a list with
-- two of them is not something the page can even show — and "ring the main contact" is an instruction
-- somebody follows at four in the afternoon when a drawing is wrong. The partial unique index is the
-- guarantee; set_customer_contacts() refuses first so the person reads a sentence rather than the
-- name of an index.
CREATE TABLE customer_contact (
  id          bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  role        text,
  email       text,
  phone       text,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX customer_has_one_main_contact
  ON customer_contact (customer_id) WHERE is_primary;

-- And a contact anybody is expected to reach has to be reachable. A row with a name and no way to
-- get hold of them is a row that looks like a contact and is not one.
ALTER TABLE customer_contact ADD CONSTRAINT contact_can_be_reached
  CHECK (coalesce(btrim(email), '') <> '' OR coalesce(btrim(phone), '') <> '');

-- One spelling per state. The frontend carries two names for one of them — `active` in the
-- Estimations page's vocabulary, `production` from the estimate-conversion path, aliased to each
-- other in project-rules.js — and `draft` as a retired alias of `quotation`. A database that
-- accepted all of them would mean every query had to know the aliases, so the canonical spelling
-- is fixed here and the API translates on the way in. `approved` is a real step in the quoting
-- chain and is included; it was missing from the first draft of this file.
CREATE TYPE project_status AS ENUM
  ('quotation','approved','planned','production','hold','completed','closed','cancelled');

CREATE TABLE project (
  id            bigserial PRIMARY KEY,
  ref           text NOT NULL UNIQUE DEFAULT next_dated_ref('P', 'seq_project'::regclass, 3),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  -- A project cannot belong to a customer who does not exist. Restricting the delete rather than
  -- cascading is deliberate: losing a customer must never silently take their jobs with them.
  customer_id   bigint NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  status        project_status NOT NULL DEFAULT 'quotation',
  planned_hours numeric(10,2) NOT NULL DEFAULT 0 CHECK (planned_hours >= 0),
  progress      int NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  deadline      date,
  -- Where the job came from and what it is. estimate_id is the quotation this became; the trail
  -- back to the tender and the enquiry hangs off that.
  description   text,
  phase         text,
  work_types    text,
  po_number     text,
  workshop      text,
  responsible   text,
  material_status text CHECK (material_status IS NULL OR
                  material_status IN ('not-ordered','ordered','part-arrived','arrived','issued')),
  notes         text,
  -- Planned against actual. Four dates rather than two, because "when did it really start" is the
  -- question every late job is argued about and it cannot be recovered from a status.
  planned_start date,
  actual_start  date,
  planned_completion date,
  expected_completion date,
  actual_completion date,
  closed_on     date,
  -- Hours actually worked, maintained from the entries by trigger below — never typed, for the
  -- same reason an operation's logged hours are not.
  used_hours    numeric(10,2) NOT NULL DEFAULT 0 CHECK (used_hours >= 0),
  quoted_value  numeric(12,2) CHECK (quoted_value IS NULL OR quoted_value >= 0),
  -- Why it stopped, and why it was cancelled. A project on hold with no reason written down is a
  -- project nobody can restart without asking three people.
  hold_reason   text,
  hold_comment  text,
  expected_resume date,
  cancel_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (actual_completion IS NULL OR actual_start IS NULL OR actual_completion >= actual_start),
  -- A project cannot be on hold for no reason, or cancelled for none. Both statuses are decisions
  -- somebody made, and the record has to say what the decision was.
  CONSTRAINT held_project_says_why CHECK (status <> 'hold' OR btrim(coalesce(hold_reason,'')) <> ''),
  CONSTRAINT cancelled_project_says_why
    CHECK (status <> 'cancelled' OR btrim(coalesce(cancel_reason,'')) <> '')
);

CREATE TYPE jobcard_status AS ENUM
  ('draft','released','ready','in-progress','inspection','completed','closed',
   'paused','blocked','cancelled');

CREATE TABLE jobcard (
  id            bigserial PRIMARY KEY,
  ref           text NOT NULL UNIQUE DEFAULT next_dated_ref('JC', 'seq_jobcard'::regclass, 4),
  project_id    bigint NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
  title         text NOT NULL CHECK (btrim(title) <> ''),
  item          text,
  quantity      int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  drawing_no    text,
  status        jobcard_status NOT NULL DEFAULT 'draft',
  planned_hours numeric(10,2) NOT NULL DEFAULT 0 CHECK (planned_hours >= 0),
  planned_start date,
  planned_completion date,
  archived      boolean NOT NULL DEFAULT false,
  -- Kept from day one on the decision in BACKEND.md §2: no certification subsystem is being
  -- built, but which material went into which job is a fact that cannot be recovered later.
  heat_no       text,
  material_cert_ref text,
  -- Which customer, kept beside the project rather than only reached through it: a jobcard is what
  -- the floor holds, and whose job it is is the first thing anybody asks about one.
  customer_id   bigint REFERENCES customer(id) ON DELETE RESTRICT,
  revision      text,
  work_type     text,
  location      text,
  -- low, medium, high — the three the jobcard screen offers in its dropdown. 'normal' and 'urgent'
  -- came from the table plan and are in nobody's vocabulary: the screen has never written either, and
  -- the value it does write for the middle one, 'medium', this column refused. One spelling per state,
  -- and the spelling is the screen's.
  priority      text CHECK (priority IS NULL OR priority IN ('low','medium','high')),
  responsible   text,
  created_by    text,
  notes         text,
  -- Is the steel there yet. A job released to the floor without its material is the most common
  -- reason work stops after it has started.
  -- The four words the jobcard screen actually uses, rather than the three this column was invented
  -- with. BACKEND.md's rule is one spelling per state, and when the two disagree the screen wins:
  -- 'not-checked', 'shortage', 'partial' and 'available' are what somebody picks from a dropdown and
  -- what the whole page is written around. 'none'/'partial'/'ready' came from the table plan and were
  -- never anybody's words — and translating between them would have had to fold 'shortage' and
  -- 'partial' onto one value, losing the difference between "some is missing" and "some is here".
  material_readiness text CHECK (material_readiness IS NULL OR
                       material_readiness IN ('not-checked','shortage','partial','available')),
  -- Whether this job needs signing off before it leaves. Read by the jobcard screen, the quality
  -- screen and equipment-gates.js, and it had nowhere to live: coverage.js reported it as width
  -- nobody misses, because the test for "is this field read anywhere" missed every read written as
  -- `j.inspectionRequired ? a : b`. Distinct from operation.inspection_checkpoint, which marks one
  -- step; this is the job as a whole.
  inspection_required boolean NOT NULL DEFAULT false,
  delivery_target date,
  actual_start  date,
  actual_completion date,
  progress      int NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (planned_completion IS NULL OR planned_start IS NULL OR planned_completion >= planned_start),
  CHECK (actual_completion IS NULL OR actual_start IS NULL OR actual_completion >= actual_start)
);

CREATE INDEX jobcard_project_idx ON jobcard(project_id);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Which status may follow which
--
-- A table rather than a CASE statement, because this is the part of the workflow most likely to be
-- argued about and changed, and a row is something the argument can be settled by editing. The
-- pairs below are lifted from ALLOWED_TRANSITIONS in jobcard-desktop.html and from the can* rules
-- in project-rules.js — the existing suite is the specification, so the database agrees with it
-- rather than with a graph invented here.
--
-- Two things the frontend map does implicitly are written out: a job resumes from paused or blocked
-- to one of the four statuses it could have been paused from (VALID_RESUME_TARGETS in
-- jobcard-rules.js), and a status may always be set to itself, so an update that touches other
-- columns is not refused for a status it never changed.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE allowed_transition (
  entity      text NOT NULL CHECK (entity IN ('jobcard','project')),
  from_status text NOT NULL,
  to_status   text NOT NULL,
  PRIMARY KEY (entity, from_status, to_status),
  CHECK (from_status <> to_status),
  -- The statuses are held as text because two different enums share this table, which leaves room
  -- for a typo — and a typo here is not an error, it is a rule that quietly does nothing, or a
  -- missing rule that quietly refuses real work. The cast is what closes that: an enum cast on a
  -- label that does not exist raises, so the bad row never lands.
  CONSTRAINT statuses_are_real CHECK (
    CASE entity
      WHEN 'jobcard' THEN from_status::jobcard_status IS NOT NULL AND to_status::jobcard_status IS NOT NULL
      WHEN 'project' THEN from_status::project_status IS NOT NULL AND to_status::project_status IS NOT NULL
    END
  )
);

INSERT INTO allowed_transition (entity, from_status, to_status) VALUES
  ('jobcard','draft','released'),        ('jobcard','draft','cancelled'),
  ('jobcard','released','ready'),        ('jobcard','released','draft'),
  ('jobcard','released','paused'),       ('jobcard','released','blocked'),
  ('jobcard','released','cancelled'),
  ('jobcard','ready','in-progress'),     ('jobcard','ready','released'),
  ('jobcard','ready','paused'),          ('jobcard','ready','blocked'),
  ('jobcard','ready','cancelled'),
  ('jobcard','in-progress','inspection'),('jobcard','in-progress','paused'),
  ('jobcard','in-progress','blocked'),
  ('jobcard','inspection','completed'),  ('jobcard','inspection','in-progress'),
  ('jobcard','inspection','paused'),     ('jobcard','inspection','blocked'),
  ('jobcard','completed','closed'),
  -- Resuming: back to whichever of these it was paused from.
  ('jobcard','paused','released'),       ('jobcard','paused','ready'),
  ('jobcard','paused','in-progress'),    ('jobcard','paused','inspection'),
  ('jobcard','blocked','released'),      ('jobcard','blocked','ready'),
  ('jobcard','blocked','in-progress'),   ('jobcard','blocked','inspection'),

  ('project','quotation','approved'),    ('project','quotation','cancelled'),
  ('project','approved','planned'),      ('project','approved','cancelled'),
  ('project','planned','production'),    ('project','planned','hold'),
  ('project','planned','cancelled'),
  ('project','production','hold'),       ('project','production','completed'),
  ('project','production','cancelled'),
  ('project','hold','production'),       ('project','hold','planned'),
  ('project','hold','cancelled'),
  ('project','completed','closed'),
  -- Reopening a closed project, to either of the two states the screen offers.
  ('project','closed','production'),     ('project','closed','completed');

-- `closed` on a jobcard and `cancelled` on both are deliberately absent as a from_status: they are
-- the end. Anything else is a new document, which is the point — a cancelled job that can be
-- quietly un-cancelled is a job whose history says something that did not happen.

CREATE FUNCTION status_flow_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entity_name text := TG_ARGV[0];
BEGIN
  IF NEW.status::text = OLD.status::text THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM allowed_transition
     WHERE entity = entity_name
       AND from_status = OLD.status::text
       AND to_status = NEW.status::text
  ) THEN
    RAISE EXCEPTION '% % cannot go from % to %; from % it may only become %',
      entity_name, NEW.ref, OLD.status, NEW.status, OLD.status,
      COALESCE((SELECT string_agg(to_status, ', ' ORDER BY to_status) FROM allowed_transition
                 WHERE entity = entity_name AND from_status = OLD.status::text), 'nothing — it is finished')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Equipment
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- The words the screen uses, and they look like screen labels because they are.
--
-- This is the rule from `material_readiness` and the jobcard priority applied a third time: one spelling
-- per state, and when the schema and the screen disagree the screen wins, because those are the words
-- somebody picks from a dropdown. Here it was not a preference. The equipment screen compares
-- `item.status === 'Out of Service'` exactly, in seven places, and equipment-gates.js holds its
-- vocabulary as 'out of service' — with spaces — and **fails closed on a status it does not recognise**.
-- So a hyphenated 'out-of-service' arriving from the snapshot was not merely ugly: it was unrecognised,
-- which the gate treats as unsafe. 'in-use' was worse, because a machine on a bench is perfectly
-- runnable and the gate had no way to know it.
--
-- That was live. `equipment` has been in the snapshot since step 5 and the jobcard screen is wired, so
-- attaching any machine to a jobcard there was refused by a gate that could not read the status of any
-- machine in the workshop. Nothing threw; the gate did exactly what it says it does.
--
-- 'Inspection Required' is new here as well: the screen offers it, the gate blocks on it, and the enum
-- did not have it at all, so the one state a workshop uses for "fine, but it must be looked at first"
-- could not be recorded.
CREATE TYPE equipment_status AS ENUM
  ('Available', 'In Use', 'Maintenance Due', 'Under Maintenance', 'Inspection Required',
   'Out of Service', 'Quarantined', 'Retired');

CREATE TABLE equipment (
  id          bigserial PRIMARY KEY,
  ref         text NOT NULL UNIQUE,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  category    text NOT NULL,
  status      equipment_status NOT NULL DEFAULT 'Available',
  certification_expiry date,
  -- What the machine is. A serial number and an asset number are how a machine is identified to an
  -- insurer and to an auditor, and neither can be recovered later from a name.
  manufacturer text,
  model       text,
  serial_no   text,
  asset_no    text UNIQUE,
  year_of_manufacture int CHECK (year_of_manufacture IS NULL OR year_of_manufacture BETWEEN 1900 AND 2100),
  description text,
  -- Where it is and whose it is. current_location is where it is now, home_location where it lives.
  current_location text,
  home_location text,
  department  text,
  responsible_person text,
  operator    text,
  -- How much it matters and what state it is in, which is what decides whether a breakdown stops
  -- the shop or is dealt with next week.
  -- The same rule as the status above, two columns further down: these are the words the register
  -- offers, and the register is where somebody picks them. The criticality dropdown has offered
  -- 'Low'/'Medium'/'High'/'Critical' since it was written, so a lower-case check refused every value the
  -- screen could send — which is how the first machine saved from that form was turned away.
  condition   text CHECK (condition IS NULL OR condition IN ('New', 'Good', 'Fair', 'Poor', 'Unserviceable')),
  criticality text CHECK (criticality IS NULL OR criticality IN ('Low', 'Medium', 'High', 'Critical')),
  safety_warnings text,
  -- What it cost and what is still covered.
  purchase_date date,
  purchase_supplier text,
  purchase_price numeric(12,2) CHECK (purchase_price IS NULL OR purchase_price >= 0),
  warranty_expiry date,
  -- Servicing. The meter is what interval-based maintenance is counted against, so it is a number
  -- rather than a note.
  operating_hours numeric(10,1) NOT NULL DEFAULT 0 CHECK (operating_hours >= 0),
  service_interval_hours int CHECK (service_interval_hours IS NULL OR service_interval_hours > 0),
  last_service_date date,
  last_inspection_date date,
  last_calibration_date date,
  qr_code     text UNIQUE,
  -- Whether a welder has to sign a check before running this machine. A flag rather than a rule
  -- applied to everything, because it is true of a crane and a press and false of a bench grinder, and
  -- a system that demanded a signed check for the grinder would teach people to sign without looking.
  -- equipment-gates.js has read this through a `requirements` object since it was written; nothing has
  -- ever been able to set it, so the answer was always "not required".
  pre_use_check_required boolean NOT NULL DEFAULT false,
  -- What it is on right now. Restricted rather than cascading: losing a project must not quietly
  -- detach every machine that was working on it.
  assigned_project_id bigint REFERENCES project(id) ON DELETE SET NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (warranty_expiry IS NULL OR purchase_date IS NULL OR warranty_expiry >= purchase_date)
);

-- A machine assigned to one jobcard cannot be assigned to another at the same time. Expressed as
-- a partial unique index rather than checked in code: the database refuses the second assignment
-- even if two requests arrive together, which application code cannot promise.
CREATE TABLE equipment_assignment (
  id            bigserial PRIMARY KEY,
  equipment_id  bigint NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
  jobcard_id    bigint NOT NULL REFERENCES jobcard(id) ON DELETE CASCADE,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  released_at   timestamptz,
  CHECK (released_at IS NULL OR released_at >= assigned_at)
);

CREATE UNIQUE INDEX equipment_one_live_assignment
  ON equipment_assignment(equipment_id) WHERE released_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Operations
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TYPE operation_status AS ENUM
  ('pending','in-progress','paused','completed','skipped');

CREATE TABLE operation (
  id            bigserial PRIMARY KEY,
  jobcard_id    bigint NOT NULL REFERENCES jobcard(id) ON DELETE CASCADE,
  seq           int NOT NULL CHECK (seq > 0),
  description   text NOT NULL CHECK (btrim(description) <> ''),
  instructions  text,
  -- The welder's name and the filler used. Same reason as the heat number above: if certification
  -- is pursued in two years this history is the difference between starting from a record and
  -- starting from nothing, and it cannot be back-filled then.
  worker        text,
  filler        text,
  equipment_id  bigint REFERENCES equipment(id) ON DELETE SET NULL,
  planned_hours numeric(8,2) NOT NULL DEFAULT 0 CHECK (planned_hours >= 0),
  -- Logged hours are a running total written by the hours entries below, never typed in directly.
  logged_hours  numeric(8,2) NOT NULL DEFAULT 0 CHECK (logged_hours >= 0),
  status        operation_status NOT NULL DEFAULT 'pending',
  depends_on    bigint REFERENCES operation(id) ON DELETE SET NULL,
  planned_start date,
  actual_start  date,
  actual_completion date,
  -- A step that has to be signed off before the next one may begin. Distinct from an inspection
  -- record: this is the flag on the plan that says one is required here.
  inspection_checkpoint boolean NOT NULL DEFAULT false,
  notes         text,
  CHECK (actual_completion IS NULL OR actual_start IS NULL OR actual_completion >= actual_start),
  -- Deferrable, and that is the whole reason it is named. Re-ordering the steps on a jobcard means
  -- writing seq 1 where seq 2 was while 1 is still 1, and an immediately-checked unique index refuses
  -- the halfway state even though the finished list is fine. Deferred, it is checked once at the end
  -- of the transaction — the rule is identical, the intermediate collision is not. The alternative was
  -- renumbering through negative numbers, which CHECK (seq > 0) refuses and rightly.
  CONSTRAINT operation_one_step_per_place UNIQUE (jobcard_id, seq) DEFERRABLE INITIALLY IMMEDIATE,
  -- An operation cannot depend on itself. A longer cycle is caught by the trigger below.
  CHECK (depends_on IS DISTINCT FROM id)
);

CREATE INDEX operation_jobcard_idx ON operation(jobcard_id);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Hours
--
-- One row per entry, per person, per day. The operation's running total is maintained by trigger
-- rather than by whoever happens to be writing, so the total and the entries can never disagree.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE hours_entry (
  id            bigserial PRIMARY KEY,
  jobcard_id    bigint NOT NULL REFERENCES jobcard(id) ON DELETE RESTRICT,
  operation_id  bigint REFERENCES operation(id) ON DELETE SET NULL,
  worker        text NOT NULL CHECK (btrim(worker) <> ''),
  hours         numeric(6,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  worked_on     date NOT NULL DEFAULT current_date,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hours_jobcard_idx ON hours_entry(jobcard_id);
CREATE INDEX hours_worked_on_idx ON hours_entry(worked_on);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Store
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- Groups and locations are both trees exactly one level deep in practice (a group with subgroups,
-- a warehouse with sublocations) but modelled as a self-reference, because "one level" is the kind
-- of assumption that gets expensive. A group cannot be its own parent.
CREATE TABLE item_group (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  parent_id   bigint REFERENCES item_group(id) ON DELETE RESTRICT,
  -- Item numbering runs per group — every group starts at 1 — so a global sequence cannot do it
  -- and the counter has to live on the row. That is the same shape as the browser counter that
  -- handed two people one number, and it is only safe if it is incremented the way
  -- next_item_number() below does it. Nothing else may read this column to decide a number.
  next_number int NOT NULL DEFAULT 1 CHECK (next_number > 0),
  CHECK (parent_id IS DISTINCT FROM id)
);

-- Per-group item numbers, taken safely. The UPDATE ... RETURNING is one statement, so it takes the
-- row lock and hands back the number it wrote: two callers arriving together are serialised by the
-- lock and get different numbers. Reading the counter and writing it back separately is what
-- cannot be done, and is why this exists as a function rather than as a note in a document.
CREATE FUNCTION next_item_number(p_group_id bigint) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  taken int;
  prefix text;
BEGIN
  UPDATE item_group SET next_number = next_number + 1
   WHERE id = p_group_id
   RETURNING next_number - 1, code INTO taken, prefix;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such item group' USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN prefix || '-' || lpad(taken::text, 4, '0');
END;
$$;

CREATE TABLE location (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  parent_id   bigint REFERENCES location(id) ON DELETE RESTRICT,
  CHECK (parent_id IS DISTINCT FROM id)
);

CREATE TABLE stock_item (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  description text NOT NULL CHECK (btrim(description) <> ''),
  unit        text NOT NULL DEFAULT 'EA',
  -- Stock can never go below zero. Enforced here as well as in the issue function, because a
  -- CHECK holds against every path in and the function only holds against the one that calls it.
  --
  -- This one is deliberately redundant: reserved >= 0 together with reserved <= stock below
  -- already makes a negative stock impossible, so a refusal will normally name that pair instead.
  -- It stays as the floor, because "reserved may exceed stock" is a rule somebody could plausibly
  -- relax one day for backorders, and the day that happens this is what still holds.
  stock       numeric(12,3) NOT NULL DEFAULT 0 CONSTRAINT stock_never_negative CHECK (stock >= 0),
  reserved    numeric(12,3) NOT NULL DEFAULT 0 CONSTRAINT reserved_never_negative CHECK (reserved >= 0),
  min_stock   numeric(12,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  avg_cost    numeric(12,2) CHECK (avg_cost IS NULL OR avg_cost >= 0),
  group_id    bigint REFERENCES item_group(id) ON DELETE RESTRICT,
  -- Restricted, not set to null. A rack cannot be removed from the system while steel is sitting
  -- on it: the alternative is physical material whose location the record has quietly forgotten,
  -- which is worse than being told to move it first.
  location_id bigint REFERENCES location(id) ON DELETE RESTRICT,
  heat_no     text,
  -- Weight is computed from the material reference and the dimensions, never typed in. Stored
  -- because it is read far more often than it changes; the API is the only thing that writes it.
  unit_weight numeric(12,3) CHECK (unit_weight IS NULL OR unit_weight >= 0),
  -- How the store actually counts this item. A plate is bought by the sheet and issued by the
  -- kilo, so the base unit and the size of one unit are both needed or every issue is a guess.
  base_unit   text,
  size_per_unit numeric(12,3) CHECK (size_per_unit IS NULL OR size_per_unit > 0),
  weight_per_base numeric(12,3) CHECK (weight_per_base IS NULL OR weight_per_base >= 0),
  -- What it is made of and what shape it is in. Grade and dimensions are what a welder matches a
  -- drawing against, and the certificate is what an auditor asks for.
  category    text,
  grade       text,
  dimensions  text,
  material_cert_ref text,
  -- The bin the steel is actually in — 'A1-01-02'. A different thing from location_id (the warehouse)
  -- and sublocation_id (the rack): those say which building and which shelf unit, this says which
  -- pigeonhole, and the store screen has always shown all three. It had no column, so the one the
  -- storeman reads off the label was the one that could not be stored.
  bin_code    text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','obsolete','blocked')),
  -- Buying. reorder_quantity is how much to order when it drops below min_stock, which is not the
  -- same number and was being conflated.
  reorder_quantity numeric(12,3) CHECK (reorder_quantity IS NULL OR reorder_quantity > 0),
  last_price  numeric(12,2) CHECK (last_price IS NULL OR last_price >= 0),
  -- The group and the shelf as the store writes them. group_id and location_id above are the real
  -- links; these are the sub-level within each, which the tree in item_group and location already
  -- models — so they are the id of the child, not a second copy of its name.
  subgroup_id bigint REFERENCES item_group(id) ON DELETE RESTRICT,
  sublocation_id bigint REFERENCES location(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- More reserved than exists is not a state a store can be in.
  CONSTRAINT reserved_within_stock CHECK (reserved <= stock)
);

CREATE TYPE movement_kind AS ENUM ('receipt','issue','return','scrap','adjustment');

CREATE TABLE stock_movement (
  id            bigserial PRIMARY KEY,
  ref           text NOT NULL UNIQUE DEFAULT next_dated_ref('MV', 'seq_movement'::regclass, 5),
  stock_item_id bigint NOT NULL REFERENCES stock_item(id) ON DELETE RESTRICT,
  kind          movement_kind NOT NULL,
  quantity      numeric(12,3) NOT NULL CHECK (quantity > 0),
  jobcard_id    bigint REFERENCES jobcard(id) ON DELETE SET NULL,
  moved_by      text NOT NULL CHECK (btrim(moved_by) <> ''),
  moved_at      timestamptz NOT NULL DEFAULT now(),
  -- Where it came from and where it went. Free text rather than a location id on purpose: half the
  -- movements in a workshop are to or from somewhere that is not a shelf — a supplier's lorry, a
  -- subcontractor, a skip — and a foreign key to `location` cannot say any of those.
  moved_from    text,
  moved_to      text,
  unit          text,
  note          text
);

CREATE INDEX movement_item_idx ON stock_movement(stock_item_id);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Quality
--
-- A hold is the only thing in this system that physically stops work leaving the building.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TYPE hold_scope AS ENUM ('project','jobcard');
CREATE TYPE hold_status AS ENUM ('active','released');
CREATE TYPE severity AS ENUM ('minor','major','critical');

CREATE TABLE quality_hold (
  id            bigserial PRIMARY KEY,
  ref           text NOT NULL UNIQUE DEFAULT next_dated_ref('HOLD', 'seq_hold'::regclass, 3),
  scope         hold_scope NOT NULL,
  project_id    bigint REFERENCES project(id) ON DELETE CASCADE,
  jobcard_id    bigint REFERENCES jobcard(id) ON DELETE CASCADE,
  reason        text NOT NULL CHECK (btrim(reason) <> ''),
  severity      severity NOT NULL DEFAULT 'major',
  applied_by    text NOT NULL CHECK (btrim(applied_by) <> ''),
  applied_at    timestamptz NOT NULL DEFAULT now(),
  -- What has to happen before this hold can come off, written when it goes on. A hold whose reason is
  -- recorded but whose remedy is not is a hold nobody can clear without asking the person who applied
  -- it, and that person is on holiday.
  required_action text,
  -- The inspection or NCR this hold came out of. A reference rather than a foreign key because it is
  -- one column naming a row in either of two tables, and the screen looks a hold up by it: the NCR
  -- detail panel finds its own hold this way. Held as the ref people read, not an id.
  related_ref   text,
  status        hold_status NOT NULL DEFAULT 'active',
  -- Releasing a hold demands a named authority and written evidence. Not a convention somebody
  -- can forget: the columns are required the moment the status says released.
  release_authority text,
  release_reason    text,
  released_at       timestamptz,
  -- A hold names exactly one thing, and it names the thing its scope says it does.
  CONSTRAINT hold_names_one_thing CHECK (
    (scope = 'project' AND project_id IS NOT NULL AND jobcard_id IS NULL) OR
    (scope = 'jobcard' AND jobcard_id IS NOT NULL AND project_id IS NULL)
  ),
  CONSTRAINT release_needs_evidence CHECK (
    status = 'active' OR (
      btrim(coalesce(release_authority,'')) <> '' AND
      btrim(coalesce(release_reason,'')) <> '' AND
      released_at IS NOT NULL
    )
  )
);

CREATE INDEX hold_active_jobcard_idx ON quality_hold(jobcard_id) WHERE status = 'active';
CREATE INDEX hold_active_project_idx ON quality_hold(project_id) WHERE status = 'active';

-- 'not-applicable' is the fifth answer and it is a real one: an inspection is raised, and then the
-- thing it was raised against is cancelled, re-scoped or absorbed into another check. Without it the
-- inspector's only options are to leave it pending forever or to pass something nobody looked at.
CREATE TYPE inspection_result AS ENUM
  ('pending','passed','passed-observations','failed','not-applicable');

CREATE TABLE inspection (
  id            bigserial PRIMARY KEY,
  ref           text NOT NULL UNIQUE DEFAULT next_dated_ref('INS', 'seq_inspection'::regclass, 3),
  jobcard_id    bigint REFERENCES jobcard(id) ON DELETE CASCADE,
  project_id    bigint REFERENCES project(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (btrim(kind) <> ''),
  component     text,
  inspector     text,
  result        inspection_result NOT NULL DEFAULT 'pending',
  findings      text,
  planned_date  date,
  actual_date   date,
  -- What was inspected, and against which drawing at which revision. An inspection that does not name
  -- the drawing it was measured against is not evidence of anything, and one that names the drawing
  -- but not the revision is evidence against the wrong drawing.
  --
  -- `operation` is free text, and it replaced a foreign key to `operation` that nothing ever wrote.
  -- The reason is the one stock_movement.moved_from already gives: half the inspections in a workshop
  -- are of something that is not a routing step — a weld seam, a batch of incoming plate, a painted
  -- surface, a pressure test — and a foreign key to the routing cannot say any of those. The screen's
  -- field is a text box, so the column is text.
  operation     text,
  drawing_no    text,
  drawing_rev   text,
  method        text,
  -- What the inspection is measured against. Recorded when it is requested, because an acceptance
  -- criterion agreed after the measurement is not a criterion.
  acceptance_criteria text,
  -- Two facts about the check itself rather than its result. A witnessed inspection cannot be done
  -- without telling the customer; material traceability confirmed says the heat numbers were checked
  -- against the certificates before anybody measured anything.
  customer_witness boolean NOT NULL DEFAULT false,
  material_traceability_ok boolean NOT NULL DEFAULT false,
  -- A critical failure is the one that puts a hold on. Kept on the inspection rather than inferred
  -- from the hold, because the hold can be released and the inspection stays the record of how bad it
  -- was.
  critical      boolean NOT NULL DEFAULT false,
  -- The screen's six, in the screen's spelling. The four this CHECK used to allow — requested,
  -- scheduled, done, cancelled — were not what any screen writes: a request opens at 'requested', an
  -- inspector moves it to 'in-progress', a reinspection is created 'planned', and a finished one is
  -- 'completed'. Three of the six would have been refused on arrival.
  status        text NOT NULL DEFAULT 'requested'
                CHECK (status IN ('draft','planned','requested','in-progress','completed','cancelled')),
  -- A re-inspection after a failure points back at the one it is repeating, so the history of a
  -- weld that was rejected and re-run reads as one story.
  reinspection_of bigint REFERENCES inspection(id) ON DELETE SET NULL,
  notes         text,
  CHECK (reinspection_of IS DISTINCT FROM id),
  -- A decided inspection has a date it happened on; one still pending, or one written off as not
  -- applicable, does not pretend to. Adding 'not-applicable' to the result enum without adding it here
  -- would have demanded a date for an inspection that never took place.
  CONSTRAINT decided_inspection_has_a_date
    CHECK (result IN ('pending','not-applicable') OR actual_date IS NOT NULL),
  -- Passed with observations means there is something to say. An empty findings box with that result
  -- is the observation nobody wrote down, which is the whole value of the category.
  CONSTRAINT observations_say_what_was_observed CHECK (
    result <> 'passed-observations' OR btrim(coalesce(findings,'')) <> ''
  ),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspection_names_something CHECK (jobcard_id IS NOT NULL OR project_id IS NOT NULL)
);

-- What was actually checked, line by line, and what each line measured.
--
-- This is the evidence. The inspection row says an inspection passed; these rows say what was looked
-- at and what the tape read, and without them a passed final inspection on a pressure vessel is one
-- word in a database. The screen renders exactly this: a text line with pass/fail/na, or a measured
-- line with a nominal, a tolerance band and an actual, where it works the verdict out itself.
--
-- A NULL result is a line nobody has answered yet, not a line that passed. The screen sends an empty
-- string for that and it arrives here as NULL, because '' and 'unanswered' are the same fact and two
-- spellings of it is how a blank line gets counted as a pass.
CREATE TABLE inspection_check (
  id            bigserial PRIMARY KEY,
  inspection_id bigint NOT NULL REFERENCES inspection(id) ON DELETE CASCADE,
  line_no       int NOT NULL CHECK (line_no > 0),
  item          text NOT NULL CHECK (btrim(item) <> ''),
  result        text CHECK (result IS NULL OR result IN ('pass','fail','na')),
  nominal       numeric(12,3),
  tol_lower     numeric(12,3),
  tol_upper     numeric(12,3),
  actual        numeric(12,3),
  note          text,
  -- A nominal with no tolerance band is not a measurement anybody can judge. The screen prints "N/A"
  -- in the verdict column for such a line, which looks like a considered answer and is not one.
  CONSTRAINT a_nominal_needs_a_tolerance CHECK (
    nominal IS NULL OR (tol_lower IS NOT NULL AND tol_upper IS NOT NULL)
  ),
  -- Upper below lower is a band nothing can fall inside, so every measurement against it fails and
  -- the failure is the typist's.
  CONSTRAINT tolerance_band_is_the_right_way_up CHECK (
    tol_lower IS NULL OR tol_upper IS NULL OR tol_upper >= tol_lower
  ),
  UNIQUE (inspection_id, line_no)
);

CREATE INDEX inspection_check_idx ON inspection_check(inspection_id, line_no);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Suppliers, and what they sell
--
-- supplier_item closes a real gap: today an item holds one price, so buying the same plate from
-- two merchants loses one of them. Item ↔ supplier ↔ their article number ↔ price ↔ pack size ↔
-- lead time, one row each, and the pair is unique so the same item cannot be listed twice against
-- one supplier. This is also where a supplier catalogue import lands later.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE supplier (
  id          bigserial PRIMARY KEY,
  ref         text NOT NULL UNIQUE DEFAULT next_ref('S-', 'seq_supplier'::regclass, 3),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  org_no      text,
  vat_no      text,
  email       text,
  phone       text,
  website     text,
  -- The whole address, not only the town. A supplier's address is where a lorry goes and where a
  -- complaint is posted; the town alone is neither.
  address     text,
  city        text,
  country     text,
  -- What they sell, which is what the register is read and filtered by. Free text rather than an enum:
  -- a workshop's suppliers are steel merchants, gas suppliers, platers, hauliers, calibration houses
  -- and the man who sharpens the blades, and a fixed list gets a sixth one wrong.
  category    text,
  -- A company, a sole trader, a subcontractor. Affects who is invoiced and how, and it is on the screen.
  supplier_type text,
  established text,
  payment_terms_days int CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0),
  -- Incoterms, and the smallest order they will take. Both are commitments with the merchant and both
  -- sat on the screen with nowhere to go, so they were being made up at the moment somebody typed a
  -- name: every supplier the form created got 30 days and DAP written onto them.
  delivery_terms text,
  minimum_order text,
  currency    char(3) NOT NULL DEFAULT 'SEK' CHECK (currency = upper(currency)),
  -- What this workshop thinks of them, out of five, when somebody has actually decided. NULL is "nobody
  -- has rated them", and it has to stay distinguishable from a rating of zero — the screen showed four
  -- stars beside every supplier's name because absence was being filled in with 4.
  rating      numeric(2,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  -- 'preferred' is the third state the screen offers and the column refused: the merchant this workshop
  -- buys from first. Fifth time a screen's vocabulary and a column's disagreed.
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','preferred','inactive')),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Who to ring at the supplier. The same shape as customer_contact, and for the same reasons: one main
-- contact rather than two, and a contact nobody can reach is not a contact.
--
-- A separate table rather than a column on supplier, because a merchant has an order desk, somebody in
-- accounts and a technical contact, and the one you need depends on why you are ringing.
CREATE TABLE supplier_contact (
  id          bigserial PRIMARY KEY,
  supplier_id bigint NOT NULL REFERENCES supplier(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  role        text,
  email       text,
  phone       text,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_contact_can_be_reached
    CHECK (coalesce(btrim(email), '') <> '' OR coalesce(btrim(phone), '') <> '')
);

CREATE UNIQUE INDEX supplier_has_one_main_contact
  ON supplier_contact (supplier_id) WHERE is_primary;

CREATE TABLE supplier_item (
  id            bigserial PRIMARY KEY,
  supplier_id   bigint NOT NULL REFERENCES supplier(id) ON DELETE CASCADE,
  stock_item_id bigint NOT NULL REFERENCES stock_item(id) ON DELETE CASCADE,
  article_no    text,
  price         numeric(12,2) NOT NULL CHECK (price >= 0),
  currency      char(3) NOT NULL DEFAULT 'SEK' CHECK (currency = upper(currency)),
  pack_size     numeric(12,3) NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  lead_time_days int CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  is_preferred  boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, stock_item_id)
);

-- One preferred supplier per item, not two. Without this the question "who do we buy this from"
-- has more than one answer and whichever the screen happens to show wins.
CREATE UNIQUE INDEX supplier_item_one_preferred
  ON supplier_item(stock_item_id) WHERE is_preferred;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Buying
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TYPE purchase_order_status AS ENUM
  ('draft','sent','confirmed','part-received','received','cancelled');

CREATE TABLE purchase_order (
  id            bigserial PRIMARY KEY,
  ref           text NOT NULL UNIQUE DEFAULT next_dated_ref('PO', 'seq_purchase_order'::regclass, 4),
  supplier_id   bigint NOT NULL REFERENCES supplier(id) ON DELETE RESTRICT,
  project_id    bigint REFERENCES project(id) ON DELETE SET NULL,
  status        purchase_order_status NOT NULL DEFAULT 'draft',
  ordered_by    text NOT NULL CHECK (btrim(ordered_by) <> ''),
  ordered_on    date NOT NULL DEFAULT current_date,
  expected_on   date,
  currency      char(3) NOT NULL DEFAULT 'SEK' CHECK (currency = upper(currency)),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (expected_on IS NULL OR expected_on >= ordered_on)
);

CREATE TABLE purchase_order_line (
  id                bigserial PRIMARY KEY,
  purchase_order_id bigint NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  stock_item_id     bigint REFERENCES stock_item(id) ON DELETE RESTRICT,
  description       text NOT NULL CHECK (btrim(description) <> ''),
  quantity          numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_price        numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  received_quantity numeric(12,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  -- More received than was ordered is a real event, but it is a decision somebody has to make
  -- rather than something that quietly happens, so the API raises the ordered quantity first.
  CONSTRAINT not_more_received_than_ordered CHECK (received_quantity <= quantity),
  UNIQUE (purchase_order_id, id)
);

CREATE INDEX po_line_order_idx ON purchase_order_line(purchase_order_id);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Offcuts and barcodes
--
-- An offcut is what is left of a length after a job. Tracking them is the difference between
-- buying a new plate and using the half of one already on the rack.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE offcut (
  id            bigserial PRIMARY KEY,
  ref           text NOT NULL UNIQUE DEFAULT next_ref('OFF-', 'seq_offcut'::regclass, 4),
  stock_item_id bigint NOT NULL REFERENCES stock_item(id) ON DELETE RESTRICT,
  location_id   bigint REFERENCES location(id) ON DELETE RESTRICT,
  length_mm     numeric(10,1) CHECK (length_mm IS NULL OR length_mm > 0),
  width_mm      numeric(10,1) CHECK (width_mm IS NULL OR width_mm > 0),
  thickness_mm  numeric(10,1) CHECK (thickness_mm IS NULL OR thickness_mm > 0),
  quantity      numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit          text,
  -- Its own code and description, because an offcut is looked for by what it is rather than by
  -- which item it was cut from: somebody wants a piece of 10mm S355 about a metre long.
  code          text,
  description   text,
  grade         text,
  status        text NOT NULL DEFAULT 'available'
                CHECK (status IN ('available','reserved','consumed','scrapped')),
  heat_no       text,
  from_jobcard_id bigint REFERENCES jobcard(id) ON DELETE SET NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- An offcut with no size is not an offcut, it is a note.
  CONSTRAINT offcut_has_a_size CHECK (length_mm IS NOT NULL OR width_mm IS NOT NULL),
  -- A piece marked consumed with no date, or dated but still listed as available, is a rack that
  -- says two things at once — and the one thing an offcut register has to get right is whether the
  -- piece is still there.
  CONSTRAINT consumed_offcut_says_when CHECK ((status = 'consumed') = (consumed_at IS NOT NULL))
);

CREATE INDEX offcut_available_idx ON offcut(stock_item_id) WHERE consumed_at IS NULL;

CREATE TABLE barcode (
  id            bigserial PRIMARY KEY,
  -- A barcode scans to exactly one thing. This is the whole point of the table.
  code          text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  stock_item_id bigint REFERENCES stock_item(id) ON DELETE CASCADE,
  offcut_id     bigint REFERENCES offcut(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT barcode_names_one_thing CHECK (
    (stock_item_id IS NOT NULL AND offcut_id IS NULL) OR
    (stock_item_id IS NULL AND offcut_id IS NOT NULL)
  )
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Before it is a project
--
-- A lead becomes an opportunity becomes a tender becomes a project. Each step keeps a link back,
-- so "where did this job come from" is answerable two years later.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- The screen's five. `lost` was the schema's word and `disqualified` is the screen's, and they are not
-- quite the same thing either: a lead is disqualified because it was never going to be work — wrong
-- trade, wrong country, no budget — whereas an opportunity is lost, to somebody. Both are here, with
-- `disqualified` added because the filter offers it and the column refused it. Sixth time a screen's
-- vocabulary and a column's were found disagreeing.
CREATE TYPE lead_status AS ENUM
  ('new','contacted','qualified','disqualified','converted','lost');

CREATE TABLE lead (
  id          bigserial PRIMARY KEY,
  ref         text NOT NULL UNIQUE DEFAULT next_ref('L-', 'seq_lead'::regclass, 4),
  company     text NOT NULL CHECK (btrim(company) <> ''),
  contact     text,
  email       text,
  phone       text,
  city        text,
  source      text,
  country     text,
  industry    text,
  company_size text,
  service_wanted text,
  estimated_value numeric(12,2) CHECK (estimated_value IS NULL OR estimated_value >= 0),
  priority    text CHECK (priority IS NULL OR priority IN ('low','normal','high')),
  owner       text,
  notes       text,
  -- When somebody last spoke to them and when they are due to be spoken to again. A lead with no
  -- next step is a lead nobody is working, which is the thing a pipeline exists to make visible.
  last_contact_on date,
  next_follow_up_on date,
  -- How they may be contacted, and whether they have asked not to be. Do-not-contact is a legal
  -- obligation in Sweden as everywhere else, so it is a column the system cannot forget rather than
  -- a note somebody might not read.
  -- Capitalised, because that is what the dropdown offers and what the customer register already stores
  -- ('Email' in `customer.preferred_contact`). Lower case here meant every lead the form saved was
  -- refused outright: `lead_contact_preference_check`, on a field nobody typed. Eighth time a screen's
  -- vocabulary and a column's were found disagreeing, and the eighth time the screen won.
  contact_preference text CHECK (contact_preference IS NULL OR
                       contact_preference IN ('Email','Phone','Post','None')),
  do_not_contact boolean NOT NULL DEFAULT false,
  status      lead_status NOT NULL DEFAULT 'new',
  -- Set when the lead becomes a customer. A converted lead that names nobody is a dead end in the
  -- record, so the two are tied together.
  customer_id bigint REFERENCES customer(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT converted_lead_names_the_customer CHECK (status <> 'converted' OR customer_id IS NOT NULL),
  -- Somebody who has asked not to be contacted cannot have a follow-up booked. Written here rather
  -- than left to whoever builds the screen, because the screen is not the only thing that will ever
  -- write to this table and the obligation does not depend on which one did.
  CONSTRAINT do_not_contact_means_no_follow_up
    CHECK (NOT do_not_contact OR next_follow_up_on IS NULL)
);

CREATE TABLE prospect_finding (
  id          bigserial PRIMARY KEY,
  lead_id     bigint NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  finding     text NOT NULL CHECK (btrim(finding) <> ''),
  source      text,
  found_by    text NOT NULL DEFAULT 'system',
  found_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX prospect_finding_lead_idx ON prospect_finding(lead_id);

-- The screen's eight, which is the pipeline board's own set of columns: a card is dragged between them.
-- The six here before were a different shape of the same idea — 'enquiry' where the board says
-- 'discovery', 'estimating' where it says 'preparing', 'quoted' where it says 'quotesent' — and two of
-- the board's columns, 'rfq' and 'qualified', had no value at all. So dragging a card into either of them
-- would have been refused, which on a board is the one action there is.
CREATE TYPE opportunity_stage AS ENUM
  ('discovery','qualified','rfq','preparing','quotesent','negotiation','won','lost');

CREATE TABLE opportunity (
  id          bigserial PRIMARY KEY,
  ref         text NOT NULL UNIQUE DEFAULT next_dated_ref('OPP', 'seq_opportunity'::regclass, 3),
  title       text NOT NULL CHECK (btrim(title) <> ''),
  customer_id bigint REFERENCES customer(id) ON DELETE RESTRICT,
  lead_id     bigint REFERENCES lead(id) ON DELETE SET NULL,
  stage       opportunity_stage NOT NULL DEFAULT 'discovery',
  value       numeric(12,2) CHECK (value IS NULL OR value >= 0),
  currency    char(3) NOT NULL DEFAULT 'SEK' CHECK (currency = upper(currency)),
  probability int CHECK (probability IS NULL OR probability BETWEEN 0 AND 100),
  expected_close date,
  contact     text,
  industry    text,
  services    text,
  scope       text,
  owner       text,
  expected_decision_on date,
  required_delivery_on date,
  competitor  text,
  -- Why it was won or lost. The most useful field in the whole pipeline and the one most often left
  -- empty, so the constraint below asks for it once the answer is known.
  decision_reason text,
  next_action text,
  follow_up_on date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- An opportunity belongs to somebody, whether they are a customer yet or not.
  CONSTRAINT opportunity_names_somebody CHECK (customer_id IS NOT NULL OR lead_id IS NOT NULL),
  -- A lost enquiry with no reason recorded teaches the workshop nothing, and the reason cannot be
  -- reconstructed six months later. Asked for at the moment it is known.
  CONSTRAINT lost_opportunity_says_why
    CHECK (stage <> 'lost' OR btrim(coalesce(decision_reason,'')) <> '')
  -- A do-not-contact lead cannot have a follow-up booked against its opportunity either, and that is NOT
  -- written here: a CHECK constraint that reads another table is only evaluated when this row changes, so
  -- it would hold until the moment somebody set do_not_contact on the lead and then quietly stop being
  -- true. The obligation lives on `lead`, where the flag is, and save_opportunity asks the question at the
  -- point somebody books the follow-up. A half-checked legal obligation is worse than an unchecked one,
  -- because it reads as enforced.
);

-- The screen's five. 'awarded' and 'declined' are what a tender actually comes back as — the customer
-- awards it or declines it, which is not the same voice as winning or losing — and 'in-progress' and
-- 'reviewing' are the two states a tender sits in while it is being put together. Seventh vocabulary
-- mismatch, and the same resolution as the other six.
CREATE TYPE tender_status AS ENUM
  ('in-progress','reviewing','submitted','awarded','declined');

CREATE TABLE tender (
  id             bigserial PRIMARY KEY,
  ref            text NOT NULL UNIQUE DEFAULT next_dated_ref('T', 'seq_tender'::regclass, 3),
  title          text NOT NULL CHECK (btrim(title) <> ''),
  opportunity_id bigint REFERENCES opportunity(id) ON DELETE SET NULL,
  customer_id    bigint REFERENCES customer(id) ON DELETE RESTRICT,
  -- Who is asking, and under what number. A tender arrives from a company this workshop may have no
  -- customer record for — that is the point of tendering — so the name is a column rather than only a
  -- foreign key, and `customer_ref` is THEIR reference for it, which is what every email about it will
  -- quote. Neither is our own `ref`, which the database allocates.
  company        text,
  customer_ref   text,
  source         text,
  industry       text,
  description    text,
  requirements   text,
  responsible    text,
  -- Whether this workshop is going to bid at all. The decision that comes before any of the work, and
  -- the screen has had a control for it since it was written.
  bid_decision   text NOT NULL DEFAULT 'pending'
                 CHECK (bid_decision IN ('bid', 'pending', 'no-bid')),
  -- When to be reminded, which is not the same date as when it is due: a tender due on the 30th needs
  -- somebody looking at it on the 20th.
  reminder_on    date,
  status         tender_status NOT NULL DEFAULT 'in-progress',
  submitted_on   date,
  due_on         date,
  value          numeric(12,2) CHECK (value IS NULL OR value >= 0),
  -- Set when the tender is won and the work starts. This is the link that answers "where did this
  -- project come from".
  project_id     bigint REFERENCES project(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- A tender that has gone in has a date it went in on. It is the date every chase and every deadline is
  -- counted from, and it cannot be reconstructed afterwards. Awarded and declined both imply it went in,
  -- so they are held to it too — the first version asked only of 'submitted', which meant a tender could
  -- be recorded as awarded having apparently never been sent.
  CONSTRAINT submitted_tender_has_a_date
    CHECK (status NOT IN ('submitted', 'awarded', 'declined') OR submitted_on IS NOT NULL),
  -- A tender has to be from somebody: a customer, an enquiry, or a company named outright. One that
  -- names nobody is a row nobody can act on and nobody can find again.
  CONSTRAINT tender_is_from_somebody CHECK (
    customer_id IS NOT NULL OR opportunity_id IS NOT NULL OR btrim(coalesce(company,'')) <> ''
  ),
  -- Deciding not to bid is a decision; submitting one anyway is a contradiction the register should not
  -- be able to hold.
  CONSTRAINT no_bid_means_no_tender CHECK (
    bid_decision <> 'no-bid' OR status NOT IN ('submitted', 'awarded')
  )
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Estimating
--
-- An estimate is lines. The total is the sum of the lines and is computed, never typed — the same
-- rule as logged hours, for the same reason: a figure somebody can type is a figure that can
-- disagree with what it is made of, and this is the figure the job is priced from.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TYPE estimate_status AS ENUM ('draft','sent','accepted','rejected','expired');

CREATE TABLE estimate (
  id          bigserial PRIMARY KEY,
  ref         text NOT NULL UNIQUE DEFAULT next_dated_ref('EST', 'seq_estimate'::regclass, 4),
  title       text NOT NULL CHECK (btrim(title) <> ''),
  customer_id bigint NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  opportunity_id bigint REFERENCES opportunity(id) ON DELETE SET NULL,
  project_id  bigint REFERENCES project(id) ON DELETE SET NULL,
  status      estimate_status NOT NULL DEFAULT 'draft',
  currency    char(3) NOT NULL DEFAULT 'SEK' CHECK (currency = upper(currency)),
  margin_pct  numeric(5,2) NOT NULL DEFAULT 0 CHECK (margin_pct > -100 AND margin_pct <= 1000),
  -- Maintained by trigger from the lines below.
  total       numeric(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  valid_until date,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE estimate_line_kind AS ENUM ('material','labour','subcontract','other');

CREATE TABLE estimate_line (
  id            bigserial PRIMARY KEY,
  estimate_id   bigint NOT NULL REFERENCES estimate(id) ON DELETE CASCADE,
  kind          estimate_line_kind NOT NULL,
  description   text NOT NULL CHECK (btrim(description) <> ''),
  stock_item_id bigint REFERENCES stock_item(id) ON DELETE SET NULL,
  quantity      numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit          text NOT NULL DEFAULT 'EA',
  unit_price    numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  -- A generated column rather than a trigger: the line total is arithmetic on its own row, and a
  -- stored generated column cannot be written to at all, by anybody.
  line_total    numeric(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  -- A line is locked when the estimate has gone to the customer. After that the price can still be
  -- changed — a mistake is a mistake — but not silently: the reason and the name are columns, not
  -- a convention somebody remembers. The trigger below is what makes them required.
  locked        boolean NOT NULL DEFAULT false,
  reprice_reason text,
  repriced_by   text,
  repriced_at   timestamptz,
  sort_order    int NOT NULL DEFAULT 0
);

CREATE INDEX estimate_line_estimate_idx ON estimate_line(estimate_id);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- What happened to a machine
--
-- One event table replaces twelve tabs. An inspection, a service, a calibration, a breakdown and a
-- pre-use check are the same shape: a thing that happened to a machine on a date, with a result.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TYPE equipment_event_kind AS ENUM
  ('service','calibration','inspection','breakdown','pre-use-check','repair');

CREATE TABLE equipment_event (
  id            bigserial PRIMARY KEY,
  equipment_id  bigint NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  kind          equipment_event_kind NOT NULL,
  happened_on   date NOT NULL DEFAULT current_date,
  performed_by  text NOT NULL CHECK (btrim(performed_by) <> ''),
  result        text NOT NULL CHECK (result IN ('pass','fail','done','observations')),
  next_due_on   date,
  cost          numeric(12,2) CHECK (cost IS NULL OR cost >= 0),
  note          text,
  -- Which job the check was signed for. A pre-use check is signed for a particular piece of work on a
  -- particular day, and equipment-gates.js matches on exactly that: a check passed this morning for
  -- another jobcard is not a check for this one. Without the link the gate can only ask "was anything
  -- checked today", which is the question that lets a machine onto the wrong job.
  jobcard_id    bigint REFERENCES jobcard(id) ON DELETE SET NULL,
  -- A failed check stops the machine until somebody deals with it, and "dealt with" has to be a record
  -- rather than a flag somebody flips: `resolves_event_id` is the later event that answers this one.
  -- Setting `resolved` on the failure itself is what that later event does, so both exist — one is the
  -- state the gate reads, the other is the evidence for it.
  resolved      boolean NOT NULL DEFAULT false,
  resolves_event_id bigint REFERENCES equipment_event(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (next_due_on IS NULL OR next_due_on >= happened_on),
  -- A failed check cannot resolve anything: the thing that clears a failure is a later check that
  -- passed, or a repair. Allowing it would let one broken machine clear another's failure.
  CHECK (resolves_event_id IS NULL OR result <> 'fail')
);

-- An event cannot resolve itself, which a self-reference makes expressible and therefore worth
-- refusing. It would make a failed check its own answer.
CREATE FUNCTION equipment_event_cannot_answer_itself() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.resolves_event_id IS NOT NULL AND NEW.resolves_event_id = NEW.id THEN
    RAISE EXCEPTION 'an equipment event cannot resolve itself' USING ERRCODE = 'check_violation';
  END IF;
  -- And it can only answer an event about the same machine. A pre-use check on the plasma cutter
  -- clearing a failure on the press is the kind of thing that is obvious when written down and
  -- invisible in a list of ids.
  IF NEW.resolves_event_id IS NOT NULL
     AND (SELECT equipment_id FROM equipment_event WHERE id = NEW.resolves_event_id)
         IS DISTINCT FROM NEW.equipment_id THEN
    RAISE EXCEPTION 'an equipment event can only resolve one about the same machine'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipment_event_answers_itself_trg BEFORE INSERT OR UPDATE ON equipment_event
  FOR EACH ROW EXECUTE FUNCTION equipment_event_cannot_answer_itself();

CREATE INDEX equipment_event_machine_idx ON equipment_event(equipment_id, happened_on DESC);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Non-conformances
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- The screen's ten, in the screen's spelling. The six this enum used to hold were a different set of
-- words for the same machine — 'investigating' where the screen says 'under-investigation',
-- 'verification' where it says 'waiting-verification' — and four of the screen's states had no value
-- here at all, so a containment recorded on the floor and an NCR reopened after closure would both
-- have been refused. Third time in this project that the schema and a screen were found to be naming
-- one state two ways, and the third time the screen won: it is what somebody is looking at.
CREATE TYPE ncr_status AS ENUM
  ('draft','open','containment-required','under-investigation','disposition-required',
   'corrective-action','waiting-verification','closed','rejected','reopened');

CREATE TABLE ncr (
  id            bigserial PRIMARY KEY,
  ref           text NOT NULL UNIQUE DEFAULT next_dated_ref('NCR', 'seq_ncr'::regclass, 3),
  title         text NOT NULL CHECK (btrim(title) <> ''),
  project_id    bigint REFERENCES project(id) ON DELETE CASCADE,
  jobcard_id    bigint REFERENCES jobcard(id) ON DELETE CASCADE,
  category      text NOT NULL CHECK (btrim(category) <> ''),
  severity      severity NOT NULL DEFAULT 'major',
  description   text NOT NULL CHECK (btrim(description) <> ''),
  responsible   text NOT NULL CHECK (btrim(responsible) <> ''),
  status        ncr_status NOT NULL DEFAULT 'open',
  due_on        date,
  -- Who found it and when, which is not the same as who is responsible for fixing it and not the same
  -- as when the record was typed. An NCR raised on Friday and entered on Monday is dated Friday, or
  -- the interval between finding a fault and recording it can never be measured.
  detected_by   text NOT NULL CHECK (btrim(detected_by) <> ''),
  detected_on   date NOT NULL DEFAULT current_date,
  -- Free text, for the reason inspection.operation gives: what a non-conformance is against is often
  -- not a routing step. This replaced a foreign key to `operation` that nothing ever wrote.
  operation     text,
  component     text,
  material      text,
  supplier_id   bigint REFERENCES supplier(id) ON DELETE SET NULL,
  -- Containment is what was done about it immediately — the parts quarantined, the machine stopped —
  -- as distinct from the corrective action that stops it happening again. Conflating the two is how
  -- an NCR gets closed on the containment alone.
  containment   text,
  -- The screen's eight. 'replace', 'reclassify' and 'pending' were missing, and 'pending' is the one
  -- that matters: it is what the screen offers while the decision is still being argued about, so
  -- without it the only way to save the record was to decide.
  disposition   text CHECK (disposition IS NULL OR
                  disposition IN ('rework','repair','use-as-is','return-to-supplier','scrap',
                                  'replace','reclassify','pending')),
  -- Who approved the disposition, and what was verified afterwards by whom. Three separate facts that
  -- were all being written into `notes` because there was nowhere else: the approval that let a part
  -- be used as-is, the evidence that the fix worked, and the name against that evidence.
  disposition_approval_ref text,
  verification_result text,
  verified_by   text,
  -- The corrective action this NCR was answered by, as a CAPA reference. The root-cause analysis lives
  -- on the CAPA — five whys, fishbone — not here; this column is the pointer to it.
  corrective_action_ref text,
  closure_approval text,
  notes         text,
  root_cause    text,
  corrective_action text,
  closed_on     date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ncr_names_something CHECK (project_id IS NOT NULL OR jobcard_id IS NOT NULL),
  -- A non-conformance closed with nothing written down is a record of nothing; the point of the
  -- register is that the same fault does not come back. What "written down" means, though, had to
  -- change, and the change is worth explaining because the old version could not have been satisfied.
  --
  -- This constraint used to demand root_cause and corrective_action. No screen in the system can fill
  -- either: in this application the root-cause analysis belongs to the CAPA record — where the five
  -- whys and the fishbone actually live — and the NCR points at it. What the closure screen collects
  -- is the verification evidence, the name against it, and the closure approval reference. So the
  -- constraint demanded two columns nothing writes and ignored the three that are, which means every
  -- close from the Quality screen would have been refused with a message about a root cause the
  -- screen has no box for. A rule that cannot be obeyed is not enforcement, it is a locked door.
  --
  -- Both columns stay, for an NCR closed without a full CAPA, and root_cause is no longer the gate.
  CONSTRAINT closed_ncr_says_what_was_done CHECK (
    status <> 'closed' OR (
      btrim(coalesce(verification_result,'')) <> '' AND
      btrim(coalesce(closure_approval,'')) <> '' AND
      closed_on IS NOT NULL
    )
  ),
  -- Using a non-conforming part as it is, is a decision somebody signs for. It is the one disposition
  -- that leaves the fault in the delivered work, so the approval reference is a condition of recording
  -- it rather than a field somebody means to come back and fill in.
  CONSTRAINT use_as_is_is_signed_for CHECK (
    disposition IS DISTINCT FROM 'use-as-is' OR
    btrim(coalesce(disposition_approval_ref,'')) <> ''
  ),
  -- Major and critical get a date by which they are answered. A minor may sit on the list; a critical
  -- with no due date is how one sits there for eight months.
  CONSTRAINT serious_ncrs_have_a_date CHECK (severity = 'minor' OR due_on IS NOT NULL)
);

CREATE INDEX ncr_open_idx ON ncr(status) WHERE status NOT IN ('closed','rejected');

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Documents
--
-- The register of what the workshop holds on paper: certificates, drawings, reports, templates. A
-- certificate that has run out is the single most common document problem in a metal shop, which is why
-- the expiry date is a column and not a line in the notes.
--
-- Two halves of this are optional, and both were NOT NULL in the first version, which is what kept this
-- table unused for four passes:
--
--   * The FILE. There is no object storage yet, so `storage_key` had nothing to hold and a register entry
--     could not be made at all. But a workshop knows it holds a material certificate expiring on the 12th
--     long before anybody scans it, and that expiry is the part worth tracking. So the file half —
--     filename, storage_key, mime_type, size_bytes — is either all there or none of it, and a record with
--     none of it is a register entry waiting for its scan.
--   * The LINK. The screen has an explicit "Unlinked" state and a "Link to Record" action, so a document
--     that belongs to nothing yet is a state somebody chose, not a mistake. entity and entity_id are
--     either both set or both null; half a link points nowhere and reads as though it points somewhere.
--
-- The entity/entity_id pair cannot be a foreign key, so the entity name is restricted to the tables it may
-- actually refer to — a spelling mistake there is a document nothing can find. save_document() resolves
-- the screen's word for a module into one of these and looks the reference up, so a link to a record that
-- does not exist is refused rather than stored.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- The states somebody sets. 'Review Soon' and 'Expired' are NOT here and that is the point: both are
-- answers to "what is the date today", and a status column holding either is a fact that was true when it
-- was written and silently stops being true. The Documents screen offers "Review Soon" in its status
-- dropdown, which is the one place its vocabulary is not just a different spelling but a different kind of
-- thing. The view computes both from expires_on, so they cannot go stale.
CREATE TYPE document_status AS ENUM ('draft', 'valid', 'approved', 'superseded');

CREATE TABLE document (
  id          bigserial PRIMARY KEY,
  ref         text NOT NULL UNIQUE DEFAULT next_ref('DOC-', 'seq_document'::regclass, 5),
  -- What people call it. The screen has one name field and this is it; `filename` below is what the file
  -- was actually saved under, which is a different string and often an uglier one.
  title       text NOT NULL CHECK (btrim(title) <> ''),
  kind        text NOT NULL CHECK (kind IN
                ('Document', 'Certificate', 'Drawing', 'Report', 'Template', 'Image')),
  category    text,
  revision    text,
  status      document_status NOT NULL DEFAULT 'draft',
  expires_on  date,

  -- The record it belongs to, or nothing yet.
  entity      text CHECK (entity IS NULL OR entity IN
                ('customer','project','jobcard','operation','equipment','stock_item',
                 'quality_hold','inspection','ncr','supplier','purchase_order','estimate','tender')),
  entity_id   bigint,

  -- The file, when there is one.
  filename    text CHECK (filename IS NULL OR btrim(filename) <> ''),
  storage_key text UNIQUE CHECK (storage_key IS NULL OR btrim(storage_key) <> ''),
  mime_type   text,
  size_bytes  bigint CHECK (size_bytes IS NULL OR size_bytes > 0),

  author      text,
  notes       text,
  uploaded_by text NOT NULL CHECK (btrim(uploaded_by) <> ''),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT a_link_names_both_halves CHECK ((entity IS NULL) = (entity_id IS NULL)),
  -- A stored file needs somewhere to be stored and a name to be found by. Either both or neither: a
  -- storage key with no filename is a file nobody can offer to download, and a filename with no key is a
  -- download button that leads nowhere.
  CONSTRAINT a_stored_file_has_a_key CHECK ((storage_key IS NULL) = (filename IS NULL)),
  -- Only a certificate, a drawing or a report has a life. A template does not expire.
  CONSTRAINT only_a_dated_document_expires CHECK (
    expires_on IS NULL OR kind IN ('Certificate', 'Drawing', 'Report', 'Document'))
);

CREATE INDEX document_entity_idx ON document(entity, entity_id);
-- The question the register is opened to answer: what is running out.
CREATE INDEX document_expiry_idx ON document(expires_on) WHERE expires_on IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- The welding registers
--
-- BACKEND.md argued for four passes that these were "paperwork for nobody": build them before there is an
-- auditor and you have built paperwork nobody reads. That argument was right and its premise has changed —
-- the firm is certified or on the way, so there is an auditor. What was kept against exactly this day is
-- what these are built on: the heat number and the material certificate reference on the jobcard, which
-- could not have been back-filled.
--
-- Everything here is a register except one sentence, and that sentence is why it is in a database:
--
--     A weld is made by a welder qualified for that process, to a procedure that was valid on the day.
--
-- That is what an auditor checks and what a delivery is signed off against. It is four triggers below, and
-- each refuses in words a welder can read with the date in the message — the same shape as the equipment
-- certification gate, which has refused to start a job on an out-of-certification machine since step 2.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE seq_weld;
CREATE SEQUENCE seq_ndt;
CREATE SEQUENCE seq_wps;

-- The two statuses somebody sets on a procedure, and on a qualification. `expiring-soon` and `expired`
-- are in NEITHER list, and that is deliberate: both are answers to what the date is today, and a column
-- holding either is a fact that was true the morning somebody typed it. The demonstration records carry
-- `expiring-soon` as a stored status on a welder qualification, which is the register whose whole job is
-- to say who may weld — so it is computed in workspace_snapshot() on every read, beside the settable
-- value, exactly as `document` does since yesterday.
CREATE TYPE wps_status AS ENUM ('draft', 'awaiting-approval', 'approved', 'withdrawn');
CREATE TYPE welder_qual_status AS ENUM ('valid', 'suspended', 'withdrawn');
CREATE TYPE weld_status AS ENUM
  ('planned', 'welded', 'repair-required', 'repaired', 'accepted', 'rejected');
CREATE TYPE weld_result AS ENUM ('pending', 'accepted', 'rejected');
CREATE TYPE ndt_result AS ENUM ('pending', 'accepted', 'rejected');

-- ── The procedure a weld is made to ──────────────────────────────────────────────────────────
CREATE TABLE wps (
  id                bigserial PRIMARY KEY,
  ref               text NOT NULL UNIQUE CHECK (btrim(ref) <> ''),
  revision          int NOT NULL DEFAULT 1 CHECK (revision >= 0),
  process           text NOT NULL CHECK (btrim(process) <> ''),
  material_group    text,
  thickness_range   text,
  diameter_range    text,
  joint_type        text,
  position          text,
  filler_material   text,
  shielding_gas     text,
  preheat_interpass text,
  -- The qualification record the procedure rests on. A WPS with no WPQR behind it is a procedure nobody
  -- has proved, which an auditor asks for first.
  supporting_wpqr   text,
  status            wps_status NOT NULL DEFAULT 'draft',
  -- The document itself lives in the register that holds documents, wired yesterday. A filename here
  -- would be a second place for the same file to go stale.
  document_id       bigint REFERENCES document(id) ON DELETE SET NULL,
  approved_on       date,
  approved_by       text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- An approved procedure says who approved it and when. Approval is the whole difference between a draft
  -- and something a weld may be made to, so it cannot be a status somebody sets and nothing else.
  CONSTRAINT an_approved_wps_says_who CHECK (
    status <> 'approved' OR (approved_on IS NOT NULL AND btrim(coalesce(approved_by, '')) <> ''))
);
-- One revision of one procedure. A second WPS-304-02 rev 1 is a second answer to the same question.
CREATE UNIQUE INDEX wps_one_revision ON wps(ref, revision);

-- ── Which welder is qualified to what ────────────────────────────────────────────────────────
CREATE TABLE welder_qual (
  id              bigserial PRIMARY KEY,
  -- The person, not their name. A qualification naming a string cannot be joined to whoever holds it, and
  -- the staff list has been in the snapshot since yesterday — so the demonstration data's `welder: 'Elena
  -- N.'` becomes a real reference. Two Elenas, or one Elena whose name is corrected in Access, and a text
  -- column is a qualification belonging to nobody.
  welder_id       bigint NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  qual_no         text NOT NULL CHECK (btrim(qual_no) <> ''),
  process         text NOT NULL CHECK (btrim(process) <> ''),
  material_group  text,
  thickness_range text,
  position        text,
  issued_by       text NOT NULL CHECK (btrim(issued_by) <> ''),
  issued_on       date NOT NULL,
  expires_on      date NOT NULL,
  status          welder_qual_status NOT NULL DEFAULT 'valid',
  document_id     bigint REFERENCES document(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT a_qualification_runs_forwards CHECK (expires_on > issued_on),
  -- A welder holds one of each qualification number. They hold several qualifications — one per process —
  -- so the register is per qualification and not per welder.
  CONSTRAINT one_qualification_per_number UNIQUE (welder_id, qual_no)
);
CREATE INDEX welder_qual_expiry_idx ON welder_qual(expires_on);
CREATE INDEX welder_qual_welder_idx ON welder_qual(welder_id, process);

-- ── The weld log ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE weld (
  id                bigserial PRIMARY KEY,
  ref               text NOT NULL UNIQUE DEFAULT next_ref('WLD-', 'seq_weld'::regclass, 4),
  project_id        bigint REFERENCES project(id) ON DELETE SET NULL,
  jobcard_id        bigint NOT NULL REFERENCES jobcard(id) ON DELETE RESTRICT,
  operation_id      bigint REFERENCES operation(id) ON DELETE SET NULL,
  component         text,
  drawing_no        text,
  -- Where on the drawing. Without it a weld log says a weld was made and not which one.
  weld_map_position text,
  joint_type        text,
  base_material     text,
  material_grade    text,
  thickness         numeric(8,2) CHECK (thickness IS NULL OR thickness > 0),
  process           text NOT NULL CHECK (btrim(process) <> ''),
  wps_id            bigint REFERENCES wps(id) ON DELETE RESTRICT,
  wpqr_ref          text,
  welder_id         bigint NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  welder_qual_id    bigint REFERENCES welder_qual(id) ON DELETE RESTRICT,
  filler_material   text,
  -- The batch of consumable. This is the field that answers "what went into this weld" when a filler
  -- batch is later recalled, and it is the reason a weld log exists at all.
  consumable_batch  text,
  shielding_gas     text,
  preheat_required  boolean NOT NULL DEFAULT false,
  interpass_temp_req text,
  welded_on         date NOT NULL DEFAULT current_date,
  visual_required   boolean NOT NULL DEFAULT true,
  ndt_required      boolean NOT NULL DEFAULT false,
  ndt_method        text,
  final_result      weld_result NOT NULL DEFAULT 'pending',
  status            weld_status NOT NULL DEFAULT 'welded',
  notes             text,
  recorded_by       text NOT NULL CHECK (btrim(recorded_by) <> ''),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT a_weld_is_not_made_tomorrow CHECK (welded_on <= current_date),
  -- If NDT is called for, the method has to be named. "Something should be tested" is not an instruction
  -- anybody can carry out.
  CONSTRAINT ndt_that_is_required_says_how CHECK (
    NOT ndt_required OR btrim(coalesce(ndt_method, '')) <> '')
);
CREATE INDEX weld_jobcard_idx ON weld(jobcard_id);
CREATE INDEX weld_welder_idx ON weld(welder_id, welded_on);

-- A repair is a row and not a rewrite. A weld that was repaired is not a weld that was always right, and
-- which is which is the question an auditor asks when a joint fails in service.
CREATE TABLE weld_repair (
  id          bigserial PRIMARY KEY,
  weld_id     bigint NOT NULL REFERENCES weld(id) ON DELETE CASCADE,
  repaired_on date NOT NULL DEFAULT current_date,
  reason      text NOT NULL CHECK (btrim(reason) <> ''),
  repaired_by text NOT NULL CHECK (btrim(repaired_by) <> ''),
  notes       text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX weld_repair_weld_idx ON weld_repair(weld_id);

-- ── The NDT against a weld ───────────────────────────────────────────────────────────────────
CREATE TABLE ndt_report (
  id                    bigserial PRIMARY KEY,
  ref                   text NOT NULL UNIQUE DEFAULT next_ref('NDT-', 'seq_ndt'::regclass, 4),
  weld_id               bigint NOT NULL REFERENCES weld(id) ON DELETE RESTRICT,
  drawing_no            text,
  method                text NOT NULL CHECK (btrim(method) <> ''),
  procedure_ref         text,
  inspection_percent    numeric(5,2) CHECK (inspection_percent IS NULL
                          OR (inspection_percent > 0 AND inspection_percent <= 100)),
  inspection_area       text,
  -- Either somebody here or a firm outside, and one of the two has to be named: an NDT report nobody
  -- signed is not evidence of anything.
  technician            text,
  external_company      text,
  technician_cert_ref   text,
  inspected_on          date NOT NULL DEFAULT current_date,
  acceptance_criteria   text,
  result                ndt_result NOT NULL DEFAULT 'pending',
  findings              text,
  repair_required       boolean NOT NULL DEFAULT false,
  reinspection_required boolean NOT NULL DEFAULT false,
  ncr_id                bigint REFERENCES ncr(id) ON DELETE SET NULL,
  notes                 text,
  recorded_by           text NOT NULL CHECK (btrim(recorded_by) <> ''),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ndt_is_signed_by_somebody CHECK (
    btrim(coalesce(technician, '')) <> '' OR btrim(coalesce(external_company, '')) <> ''),
  CONSTRAINT ndt_is_not_done_tomorrow CHECK (inspected_on <= current_date),
  -- A rejected report says what was found. "Rejected" with no findings is a decision nobody can check or
  -- argue with, and the weld it rejects cannot be repaired without knowing what to repair.
  CONSTRAINT a_rejected_report_says_what_was_found CHECK (
    result <> 'rejected' OR btrim(coalesce(findings, '')) <> '')
);
CREATE INDEX ndt_weld_idx ON ndt_report(weld_id);

-- ── The four rules that are the reason this is in a database ──────────────────────────────────
--
-- A screen can ask all four of these and a screen is not where they can live: a welder reaching the same
-- jobcard through another page, an import, or a console walks straight past a check written in a browser.
-- The same argument the equipment gate makes, and it was proved there — equipment-gates.js had refused an
-- out-of-certification machine for months while the database would accept one.

CREATE FUNCTION weld_is_properly_qualified() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  procedure record;
  held record;
  who text;
BEGIN
  SELECT display_name INTO who FROM app_user WHERE id = NEW.welder_id;

  -- 1. The procedure has to be one somebody approved. A draft WPS is a proposal.
  IF NEW.wps_id IS NOT NULL THEN
    SELECT ref, revision, status, process INTO procedure FROM wps WHERE id = NEW.wps_id;
    IF procedure.status <> 'approved' THEN
      RAISE EXCEPTION 'weld cannot be recorded to % rev %: that procedure is %, not approved',
        procedure.ref, procedure.revision, procedure.status USING ERRCODE = 'check_violation';
    END IF;
    IF lower(btrim(procedure.process)) <> lower(btrim(NEW.process)) THEN
      RAISE EXCEPTION 'weld cannot be recorded as % against %, which is a % procedure',
        NEW.process, procedure.ref, procedure.process USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- 2, 3. The qualification has to be the welder's own, cover the process, and not have run out on the
  -- day the weld was made. Three refusals rather than one, because "not qualified" tells somebody nothing
  -- about what to do next, and the third is the one an auditor is actually asking about.
  IF NEW.welder_qual_id IS NOT NULL THEN
    SELECT wq.id, wq.welder_id, wq.qual_no, wq.process, wq.expires_on, wq.status
      INTO held FROM welder_qual wq WHERE wq.id = NEW.welder_qual_id;

    IF held.welder_id <> NEW.welder_id THEN
      RAISE EXCEPTION 'qualification % does not belong to % — a qualification cannot be borrowed',
        held.qual_no, coalesce(who, 'that welder') USING ERRCODE = 'check_violation';
    END IF;
    IF lower(btrim(held.process)) <> lower(btrim(NEW.process)) THEN
      RAISE EXCEPTION '% is qualified to % under %, and this weld is %',
        coalesce(who, 'that welder'), held.process, held.qual_no, NEW.process
        USING ERRCODE = 'check_violation';
    END IF;
    IF held.status <> 'valid' THEN
      RAISE EXCEPTION 'the qualification % held by % is %, so it cannot be cited for a weld',
        held.qual_no, coalesce(who, 'that welder'), held.status USING ERRCODE = 'check_violation';
    END IF;
    -- The one that matters, with the date in it, like the equipment gate.
    IF held.expires_on < NEW.welded_on THEN
      RAISE EXCEPTION 'the qualification % held by % expired on %, and this weld was made on %',
        held.qual_no, coalesce(who, 'that welder'), held.expires_on, NEW.welded_on
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER weld_qualification_gate_trg BEFORE INSERT OR UPDATE ON weld
  FOR EACH ROW EXECUTE FUNCTION weld_is_properly_qualified();

-- 4. A weld that calls for NDT cannot be accepted until an NDT report accepts it.
--
-- This is the rule that stops a delivery being signed off against work nobody tested. It is separate from
-- the gate above because it is asked at a different moment: the gate asks when the weld is recorded, and
-- this asks when somebody tries to call it good.
CREATE FUNCTION weld_accepted_only_on_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.final_result = 'accepted' AND NEW.ndt_required THEN
    IF NOT EXISTS (SELECT 1 FROM ndt_report r
                    WHERE r.weld_id = NEW.id AND r.result = 'accepted') THEN
      RAISE EXCEPTION 'weld % requires % and no report has accepted it — a weld cannot be accepted on '
        'evidence that does not exist', NEW.ref, coalesce(NEW.ndt_method, 'NDT')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- And a weld cannot be accepted while a report against it is calling for a repair. Two rows disagreeing
  -- about whether a joint is sound is worse than either answer on its own.
  IF NEW.final_result = 'accepted' AND EXISTS (
       SELECT 1 FROM ndt_report r WHERE r.weld_id = NEW.id
         AND (r.result = 'rejected' OR r.repair_required)) THEN
    RAISE EXCEPTION 'weld % cannot be accepted while a report against it calls for a repair', NEW.ref
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER weld_evidence_gate_trg BEFORE UPDATE OF final_result ON weld
  FOR EACH ROW EXECUTE FUNCTION weld_accepted_only_on_evidence();

-- And the other direction: a report that rejects a weld puts the weld into repair-required, rather than
-- leaving a rejected report beside an accepted weld for somebody to notice.
CREATE FUNCTION ndt_result_reaches_the_weld() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.result = 'rejected' OR NEW.repair_required THEN
    UPDATE weld SET status = 'repair-required', final_result = 'rejected', updated_at = now()
     WHERE id = NEW.weld_id AND status <> 'repair-required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ndt_reaches_the_weld_trg AFTER INSERT OR UPDATE OF result ON ndt_report
  FOR EACH ROW EXECUTE FUNCTION ndt_result_reaches_the_weld();


-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- The audit trail
--
-- Append-only by trigger. A history somebody can quietly edit is not a history.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE activity_log (
  id          bigserial PRIMARY KEY,
  entity      text NOT NULL,
  entity_id   bigint NOT NULL,
  action      text NOT NULL CHECK (btrim(action) <> ''),
  actor       text NOT NULL DEFAULT 'system',
  detail      text,
  happened_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activity_entity_idx ON activity_log(entity, entity_id);

CREATE FUNCTION activity_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the activity log is append-only: a history that can be edited is not a history';
END;
$$;

CREATE TRIGGER activity_no_update BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION activity_is_append_only();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- The safety rules, as triggers
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- 1. An active quality hold blocks completing a jobcard or its project.
--
-- The statuses listed are the ones that mean "this work is finished and may leave" — which is
-- exactly what a hold exists to prevent. Pausing, blocking or cancelling a held jobcard is
-- allowed: a hold stops work going out, not the truth about where the work stands.
--
-- Fires on INSERT as well as UPDATE. A gate on the transition alone is walked straight past by
-- creating the work already completed, which is not a hypothetical — it is how a row arrives from
-- an import or from any caller that writes the finished state in one go.
CREATE FUNCTION jobcard_hold_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  blocking text;
BEGIN
  IF NEW.status IN ('completed','closed')
     AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    SELECT string_agg(ref, ', ') INTO blocking
    FROM quality_hold
    WHERE status = 'active'
      AND (jobcard_id = NEW.id OR project_id = NEW.project_id);
    IF blocking IS NOT NULL THEN
      RAISE EXCEPTION 'jobcard % cannot be % while quality hold(s) % are active',
        NEW.ref, NEW.status, blocking USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER jobcard_hold_gate_trg BEFORE INSERT OR UPDATE ON jobcard
  FOR EACH ROW EXECUTE FUNCTION jobcard_hold_gate();

-- Postgres fires BEFORE row triggers in name order, so the hold gate above speaks first. Where a
-- move is both illegal and held, both answers are true and the hold is the more useful one.
CREATE TRIGGER jobcard_status_flow_trg BEFORE UPDATE OF status ON jobcard
  FOR EACH ROW EXECUTE FUNCTION status_flow_gate('jobcard');

CREATE FUNCTION project_hold_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  blocking text;
BEGIN
  IF NEW.status IN ('completed','closed')
     AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    SELECT string_agg(h.ref, ', ') INTO blocking
    FROM quality_hold h
    LEFT JOIN jobcard j ON j.id = h.jobcard_id
    WHERE h.status = 'active'
      AND (h.project_id = NEW.id OR j.project_id = NEW.id);
    IF blocking IS NOT NULL THEN
      RAISE EXCEPTION 'project % cannot be % while quality hold(s) % are active',
        NEW.ref, NEW.status, blocking USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_hold_gate_trg BEFORE INSERT OR UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION project_hold_gate();

CREATE TRIGGER project_status_flow_trg BEFORE UPDATE OF status ON project
  FOR EACH ROW EXECUTE FUNCTION status_flow_gate('project');

-- 2. An operation cannot start on a machine that must not be run.
--
-- Out of service, under maintenance, quarantined and retired all mean the same thing to the person
-- about to press start: not today. The check is on the transition into in-progress, because that
-- is the moment somebody walks up to the machine.
CREATE FUNCTION operation_equipment_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- Three named columns rather than SELECT *. This trigger runs with the privileges of whoever is
  -- pressing start, and the workshop is granted equipment column by column because the table holds
  -- a purchase price — so SELECT * is refused for exactly the people this gate exists to protect.
  -- It read `machine equipment%ROWTYPE` until the price column was added, at which point every
  -- welder starting a job got "permission denied for table equipment" instead of a gate. The same
  -- property that keeps a price away from the floor breaks any query that asks for more than it
  -- needs, which is a reason to ask for less.
  machine_status equipment_status;
  machine_name text;
  machine_cert date;
BEGIN
  IF NEW.status = 'in-progress' AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.equipment_id IS NOT NULL THEN
    SELECT status, name, certification_expiry
      INTO machine_status, machine_name, machine_cert
      FROM equipment WHERE id = NEW.equipment_id;
    -- The same six equipment-gates.js blocks on, rather than four of them. The database was the more
    -- permissive of the two, which means the rule the screen enforced was not the system's rule: a
    -- machine whose service interval has passed could be started by anything that did not go through
    -- that screen.
    IF machine_status IN ('Out of Service', 'Under Maintenance', 'Maintenance Due',
                          'Inspection Required', 'Quarantined', 'Retired') THEN
      RAISE EXCEPTION 'operation % cannot start: % is %',
        NEW.description, machine_name, machine_status USING ERRCODE = 'check_violation';
    END IF;
    IF machine_cert IS NOT NULL AND machine_cert < current_date THEN
      RAISE EXCEPTION 'operation % cannot start: the certification for % expired on %',
        NEW.description, machine_name, machine_cert USING ERRCODE = 'check_violation';
    END IF;
    -- A pre-use check that failed and has not been answered stops the machine. equipment-gates.js has
    -- refused this in the browser since it was written, and the browser is not where a safety rule can
    -- live: a welder who reaches the same jobcard through another screen, or an import, or a console,
    -- walks straight past it. The rule is the same one and it is stated here as well.
    IF EXISTS (SELECT 1 FROM equipment_event
                WHERE equipment_id = NEW.equipment_id
                  AND kind = 'pre-use-check' AND result = 'fail' AND NOT resolved) THEN
      RAISE EXCEPTION 'operation % cannot start: a pre-use check on % failed and has not been answered',
        NEW.description, machine_name USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operation_equipment_gate_trg BEFORE UPDATE ON operation
  FOR EACH ROW EXECUTE FUNCTION operation_equipment_gate();

-- 3. An operation cannot start before what it depends on is finished, and the chain of
--    dependencies cannot loop back on itself.
CREATE FUNCTION operation_dependency_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent operation%ROWTYPE;
  walker bigint;
  hops int := 0;
BEGIN
  -- A cycle would make "what must finish first" unanswerable, so it is refused on the way in.
  IF NEW.depends_on IS NOT NULL THEN
    walker := NEW.depends_on;
    WHILE walker IS NOT NULL AND hops < 100 LOOP
      IF walker = NEW.id THEN
        RAISE EXCEPTION 'operation % would depend on itself through a chain of dependencies',
          NEW.description USING ERRCODE = 'check_violation';
      END IF;
      SELECT depends_on INTO walker FROM operation WHERE id = walker;
      hops := hops + 1;
    END LOOP;
  END IF;

  IF NEW.status = 'in-progress' AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.depends_on IS NOT NULL THEN
    SELECT * INTO parent FROM operation WHERE id = NEW.depends_on;
    IF parent.status NOT IN ('completed','skipped') THEN
      RAISE EXCEPTION 'operation % cannot start before % is finished',
        NEW.description, parent.description USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operation_dependency_insert_trg BEFORE INSERT ON operation
  FOR EACH ROW EXECUTE FUNCTION operation_dependency_gate();
CREATE TRIGGER operation_dependency_update_trg BEFORE UPDATE ON operation
  FOR EACH ROW EXECUTE FUNCTION operation_dependency_gate();

-- A step somebody has worked on is a record of what happened, not a line on a plan.
--
-- hours_entry.operation_id is ON DELETE SET NULL, which is right — hours must outlive a step being
-- reorganised — but it means deleting a step succeeds silently and leaves every hour ever booked on
-- it pointing at nothing. What is lost is the answer to "how long did the weld-out actually take",
-- which is the only number that makes the next estimate better than a guess, and nothing would show
-- on any screen. So the delete is refused instead, here rather than only in the workflow that edits
-- the list, because the office holds DELETE on this table and could otherwise do it in one statement.
CREATE FUNCTION operation_keeps_the_work_done_on_it() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.logged_hours > 0 THEN
    RAISE EXCEPTION 'step % (%) has % hours booked on it and cannot be removed',
      OLD.seq, OLD.description, OLD.logged_hours
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'step % (%) is % and cannot be removed', OLD.seq, OLD.description, OLD.status
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER operation_keeps_the_work_done_on_it_trg BEFORE DELETE ON operation
  FOR EACH ROW EXECUTE FUNCTION operation_keeps_the_work_done_on_it();

-- 4. Logged hours are the sum of the entries, maintained here so the two can never disagree.
--
-- Both the operation the entry went to and the one it came from are recomputed. An entry booked
-- to the wrong operation and then corrected is the ordinary case, and a roll-up that only looks
-- at the new row leaves the first operation still holding hours that have moved away — the same
-- three hours counted twice, in a figure somebody prices work from.
CREATE FUNCTION hours_roll_up() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target bigint;
BEGIN
  -- coalesce to an empty array, not just for tidiness: array_agg over no rows is NULL, and FOREACH
  -- over a NULL array raises "FOREACH expression must not be null". An hours entry that names no
  -- operation at all — which is exactly what the phone screen books when a welder picks a job
  -- rather than a step — leaves both sides NULL and took this whole trigger down with it.
  FOREACH target IN ARRAY coalesce((
    SELECT array_agg(DISTINCT id) FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.operation_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.operation_id END
    ]) AS id WHERE id IS NOT NULL
  ), ARRAY[]::bigint[]) LOOP
    UPDATE operation SET logged_hours = (
      SELECT COALESCE(SUM(hours), 0) FROM hours_entry WHERE operation_id = target
    ) WHERE id = target;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER hours_roll_up_trg AFTER INSERT OR UPDATE OR DELETE ON hours_entry
  FOR EACH ROW EXECUTE FUNCTION hours_roll_up();

-- 5. A project's used hours are the sum of the hours booked to its jobcards.
--
-- Same rule as the operation's logged hours and the estimate's total, and for the same reason: the
-- figure a job is judged late or over by cannot be one somebody types. Both the project an entry
-- left and the one it joined are recomputed, because an entry booked to the wrong jobcard and
-- corrected is the ordinary case — the hours roll-up got that wrong the first time and it is not a
-- mistake worth making twice.
CREATE FUNCTION project_hours_roll_up() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target bigint;
BEGIN
  FOREACH target IN ARRAY coalesce((
    SELECT array_agg(DISTINCT p) FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN (SELECT project_id FROM jobcard WHERE id = OLD.jobcard_id) END,
      CASE WHEN TG_OP <> 'DELETE' THEN (SELECT project_id FROM jobcard WHERE id = NEW.jobcard_id) END
    ]) AS p WHERE p IS NOT NULL
  ), ARRAY[]::bigint[]) LOOP
    UPDATE project SET used_hours = (
      SELECT COALESCE(SUM(h.hours), 0) FROM hours_entry h
        JOIN jobcard j ON j.id = h.jobcard_id WHERE j.project_id = target
    ) WHERE id = target;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER project_hours_roll_up_trg AFTER INSERT OR UPDATE OR DELETE ON hours_entry
  FOR EACH ROW EXECUTE FUNCTION project_hours_roll_up();

-- 6. An hours entry names one job.
--
-- The entry carries both the jobcard and the operation because both are asked for downstream.
-- Nothing stopped the two disagreeing, and an entry that names one job and an operation belonging
-- to another is counted under both — hours on the wrong job is exactly the figure a time system
-- exists to get right.
CREATE FUNCTION hours_entry_names_one_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner_jobcard bigint;
BEGIN
  IF NEW.operation_id IS NOT NULL THEN
    SELECT jobcard_id INTO owner_jobcard FROM operation WHERE id = NEW.operation_id;
    IF owner_jobcard IS DISTINCT FROM NEW.jobcard_id THEN
      RAISE EXCEPTION 'the operation on this entry belongs to jobcard %, not jobcard %',
        (SELECT ref FROM jobcard WHERE id = owner_jobcard),
        (SELECT ref FROM jobcard WHERE id = NEW.jobcard_id) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hours_entry_one_job_trg BEFORE INSERT OR UPDATE ON hours_entry
  FOR EACH ROW EXECUTE FUNCTION hours_entry_names_one_job();

-- 6. An estimate's total is the sum of its lines, plus the margin.
--
-- Same rule as logged hours and for the same reason: a figure somebody can type is a figure that
-- can disagree with what it is made of. This is the figure a job is priced from, so it is computed
-- from the lines on every change to any of them — including a line moved to another estimate, the
-- case the hours roll-up originally got wrong.
CREATE FUNCTION estimate_total_roll_up() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target bigint;
BEGIN
  FOREACH target IN ARRAY coalesce((
    SELECT array_agg(DISTINCT id) FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.estimate_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.estimate_id END
    ]) AS id WHERE id IS NOT NULL
  ), ARRAY[]::bigint[]) LOOP
    UPDATE estimate e SET total = round(
      COALESCE((SELECT SUM(line_total) FROM estimate_line WHERE estimate_id = target), 0)
      * (1 + e.margin_pct / 100), 2)
    WHERE e.id = target;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER estimate_total_roll_up_trg AFTER INSERT OR UPDATE OR DELETE ON estimate_line
  FOR EACH ROW EXECUTE FUNCTION estimate_total_roll_up();

-- Changing the margin changes the total too, which is easy to forget when only the lines have a
-- trigger on them.
CREATE FUNCTION estimate_margin_roll_up() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.total := round(
    COALESCE((SELECT SUM(line_total) FROM estimate_line WHERE estimate_id = NEW.id), 0)
    * (1 + NEW.margin_pct / 100), 2);
  RETURN NEW;
END;
$$;

CREATE TRIGGER estimate_margin_roll_up_trg BEFORE UPDATE OF margin_pct ON estimate
  FOR EACH ROW EXECUTE FUNCTION estimate_margin_roll_up();

-- 8. A locked estimate line cannot be repriced without a reason and a name.
--
-- The reason must also be a *new* reason. Requiring only that the column is non-empty means a
-- caller who leaves the previous justification sitting there can reprice as often as it likes, and
-- the column stops recording anything — which is the failure this rule exists to prevent rather
-- than a hypothetical, because it is the cheapest path for whoever writes the caller.
CREATE FUNCTION estimate_line_reprice_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked AND (NEW.unit_price IS DISTINCT FROM OLD.unit_price
                     OR NEW.quantity IS DISTINCT FROM OLD.quantity) THEN
    IF btrim(coalesce(NEW.reprice_reason, '')) = '' OR btrim(coalesce(NEW.repriced_by, '')) = '' THEN
      RAISE EXCEPTION 'line "%" has gone to the customer: repricing it needs a reason and a name',
        NEW.description USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reprice_reason IS NOT DISTINCT FROM OLD.reprice_reason THEN
      RAISE EXCEPTION 'line "%" was already repriced for that reason: this change needs its own',
        NEW.description USING ERRCODE = 'check_violation';
    END IF;
    NEW.repriced_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER estimate_line_reprice_gate_trg BEFORE UPDATE ON estimate_line
  FOR EACH ROW EXECUTE FUNCTION estimate_line_reprice_gate();

-- 9. Stock moves through one door.
--
-- Issuing more than exists is refused with a message that names the shortfall, rather than letting
-- the CHECK fire with something nobody can act on. The CHECK stays as the floor beneath it: this
-- function holds against the callers that use it, the CHECK holds against every other path.
CREATE FUNCTION issue_stock(
  p_item_id bigint, p_quantity numeric, p_jobcard_id bigint, p_by text, p_note text DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  item stock_item%ROWTYPE;
  movement_id bigint;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'a stock issue must be for more than nothing' USING ERRCODE = 'check_violation';
  END IF;
  -- Locked, so two people issuing the last of something cannot both succeed.
  SELECT * INTO item FROM stock_item WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such stock item' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF item.stock < p_quantity THEN
    RAISE EXCEPTION 'cannot issue % % of %: only % in stock',
      p_quantity, item.unit, item.code, item.stock USING ERRCODE = 'check_violation';
  END IF;

  UPDATE stock_item
     SET stock = stock - p_quantity,
         reserved = GREATEST(0, reserved - p_quantity)
   WHERE id = p_item_id;

  INSERT INTO stock_movement (stock_item_id, kind, quantity, jobcard_id, moved_by, note)
  VALUES (p_item_id, 'issue', p_quantity, p_jobcard_id, p_by, p_note)
  RETURNING id INTO movement_id;

  -- trim_scale so the line reads the same however the caller typed the number: 30, 30.0 and
  -- 30.000 are the same amount of steel and should not read as three different records.
  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('stock_item', p_item_id, 'issued', p_by,
          trim_scale(p_quantity) || ' ' || item.unit || ' of ' || item.code);

  RETURN movement_id;
END;
$$;

COMMIT;
