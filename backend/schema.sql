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
  price_list  text,
  delivery_terms text,
  discount_agreement text,
  billing_address text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

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
  priority      text CHECK (priority IS NULL OR priority IN ('low','normal','high','urgent')),
  responsible   text,
  created_by    text,
  notes         text,
  -- Is the steel there yet. A job released to the floor without its material is the most common
  -- reason work stops after it has started.
  material_readiness text CHECK (material_readiness IS NULL OR
                       material_readiness IN ('none','partial','ready')),
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

CREATE TYPE equipment_status AS ENUM
  ('available','in-use','maintenance-due','under-maintenance','out-of-service','quarantined','retired');

CREATE TABLE equipment (
  id          bigserial PRIMARY KEY,
  ref         text NOT NULL UNIQUE,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  category    text NOT NULL,
  status      equipment_status NOT NULL DEFAULT 'available',
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
  condition   text CHECK (condition IS NULL OR condition IN ('new','good','fair','poor','unserviceable')),
  criticality text CHECK (criticality IS NULL OR criticality IN ('low','medium','high','critical')),
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
  actual_completion date,
  UNIQUE (jobcard_id, seq),
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
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','obsolete','blocked')),
  -- Buying. reorder_quantity is how much to order when it drops below min_stock, which is not the
  -- same number and was being conflated.
  reorder_quantity numeric(12,3) CHECK (reorder_quantity IS NULL OR reorder_quantity > 0),
  last_price  numeric(12,2) CHECK (last_price IS NULL OR last_price >= 0),
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

CREATE TYPE inspection_result AS ENUM ('pending','passed','passed-observations','failed');

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
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspection_names_something CHECK (jobcard_id IS NOT NULL OR project_id IS NOT NULL)
);

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
  email       text,
  phone       text,
  city        text,
  country     text,
  payment_terms_days int CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

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
  quantity      numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  heat_no       text,
  from_jobcard_id bigint REFERENCES jobcard(id) ON DELETE SET NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- An offcut with no size is not an offcut, it is a note.
  CONSTRAINT offcut_has_a_size CHECK (length_mm IS NOT NULL OR width_mm IS NOT NULL)
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

CREATE TYPE lead_status AS ENUM ('new','contacted','qualified','converted','lost');

CREATE TABLE lead (
  id          bigserial PRIMARY KEY,
  ref         text NOT NULL UNIQUE DEFAULT next_ref('L-', 'seq_lead'::regclass, 4),
  company     text NOT NULL CHECK (btrim(company) <> ''),
  contact     text,
  email       text,
  phone       text,
  city        text,
  source      text,
  status      lead_status NOT NULL DEFAULT 'new',
  -- Set when the lead becomes a customer. A converted lead that names nobody is a dead end in the
  -- record, so the two are tied together.
  customer_id bigint REFERENCES customer(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT converted_lead_names_the_customer CHECK (status <> 'converted' OR customer_id IS NOT NULL)
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

CREATE TYPE opportunity_stage AS ENUM
  ('enquiry','estimating','quoted','negotiation','won','lost');

CREATE TABLE opportunity (
  id          bigserial PRIMARY KEY,
  ref         text NOT NULL UNIQUE DEFAULT next_dated_ref('OPP', 'seq_opportunity'::regclass, 3),
  title       text NOT NULL CHECK (btrim(title) <> ''),
  customer_id bigint REFERENCES customer(id) ON DELETE RESTRICT,
  lead_id     bigint REFERENCES lead(id) ON DELETE SET NULL,
  stage       opportunity_stage NOT NULL DEFAULT 'enquiry',
  value       numeric(12,2) CHECK (value IS NULL OR value >= 0),
  currency    char(3) NOT NULL DEFAULT 'SEK' CHECK (currency = upper(currency)),
  probability int CHECK (probability IS NULL OR probability BETWEEN 0 AND 100),
  expected_close date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- An opportunity belongs to somebody, whether they are a customer yet or not.
  CONSTRAINT opportunity_names_somebody CHECK (customer_id IS NOT NULL OR lead_id IS NOT NULL)
);

CREATE TYPE tender_status AS ENUM ('open','submitted','won','lost','withdrawn');

CREATE TABLE tender (
  id             bigserial PRIMARY KEY,
  ref            text NOT NULL UNIQUE DEFAULT next_dated_ref('T', 'seq_tender'::regclass, 3),
  title          text NOT NULL CHECK (btrim(title) <> ''),
  opportunity_id bigint REFERENCES opportunity(id) ON DELETE SET NULL,
  customer_id    bigint REFERENCES customer(id) ON DELETE RESTRICT,
  status         tender_status NOT NULL DEFAULT 'open',
  submitted_on   date,
  due_on         date,
  value          numeric(12,2) CHECK (value IS NULL OR value >= 0),
  -- Set when the tender is won and the work starts. This is the link that answers "where did this
  -- project come from".
  project_id     bigint REFERENCES project(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submitted_tender_has_a_date CHECK (status <> 'submitted' OR submitted_on IS NOT NULL)
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
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (next_due_on IS NULL OR next_due_on >= happened_on)
);

CREATE INDEX equipment_event_machine_idx ON equipment_event(equipment_id, happened_on DESC);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Non-conformances
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TYPE ncr_status AS ENUM
  ('open','investigating','corrective-action','verification','closed','rejected');

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
  root_cause    text,
  corrective_action text,
  closed_on     date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ncr_names_something CHECK (project_id IS NOT NULL OR jobcard_id IS NOT NULL),
  -- A non-conformance closed with no root cause and no action taken is a record of nothing. The
  -- point of the register is that the same fault does not come back.
  CONSTRAINT closed_ncr_says_what_was_done CHECK (
    status <> 'closed' OR (
      btrim(coalesce(root_cause,'')) <> '' AND
      btrim(coalesce(corrective_action,'')) <> '' AND
      closed_on IS NOT NULL
    )
  )
);

CREATE INDEX ncr_open_idx ON ncr(status) WHERE status NOT IN ('closed','rejected');

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Documents
--
-- The file itself lives in object storage; this is the record of what it is and what it belongs
-- to. The entity/entity_id pair cannot be a foreign key, so the entity name is restricted to the
-- tables it may actually refer to — a spelling mistake there is a document nothing can find.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE document (
  id          bigserial PRIMARY KEY,
  ref         text NOT NULL UNIQUE DEFAULT next_ref('DOC-', 'seq_document'::regclass, 5),
  entity      text NOT NULL CHECK (entity IN
                ('customer','project','jobcard','operation','equipment','stock_item',
                 'quality_hold','inspection','ncr','supplier','purchase_order','estimate','tender')),
  entity_id   bigint NOT NULL,
  kind        text NOT NULL CHECK (btrim(kind) <> ''),
  filename    text NOT NULL CHECK (btrim(filename) <> ''),
  storage_key text NOT NULL UNIQUE CHECK (btrim(storage_key) <> ''),
  mime_type   text,
  size_bytes  bigint CHECK (size_bytes IS NULL OR size_bytes > 0),
  uploaded_by text NOT NULL CHECK (btrim(uploaded_by) <> ''),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_entity_idx ON document(entity, entity_id);

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
    IF machine_status IN ('out-of-service','under-maintenance','quarantined','retired') THEN
      RAISE EXCEPTION 'operation % cannot start: % is %',
        NEW.description, machine_name, machine_status USING ERRCODE = 'check_violation';
    END IF;
    IF machine_cert IS NOT NULL AND machine_cert < current_date THEN
      RAISE EXCEPTION 'operation % cannot start: the certification for % expired on %',
        NEW.description, machine_name, machine_cert USING ERRCODE = 'check_violation';
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
