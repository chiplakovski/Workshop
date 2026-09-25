-- Varmak Workshop — reading it back.
--
-- The first half of step 5: the frontend has to be able to read the database, and it has to read it
-- in the shape it already uses. `workshop-data.js` keeps one object of named collections and the
-- sixteen pages read straight out of it, so the snapshot below is that object, built in SQL, with
-- the field names the pages already expect. Renaming happens here rather than in the browser
-- because the browser is where a rename becomes sixteen edits.
--
-- Run after api.sql.
--
-- Two functions, not one, and that split is the whole design:
--
--   workspace_snapshot()  everything with no figure in kronor anywhere in it. Granted to all three
--                         roles, so a welder gets the same call as the office.
--   workspace_money()     the money, keyed by record id, for the office to merge into it.
--
-- The alternative was one function that checks the role and leaves the prices out for the floor. It
-- was rejected because that puts the decision back into code: a `CASE WHEN may_see_money()` still
-- has to mention avg_cost, and mentioning a column needs privilege on it, so the function would have
-- been refused for a welder entirely. Two functions and a GRANT mean the privilege system decides,
-- the server forwards both without knowing what either contains, and a welder's snapshot cannot
-- carry a price because the SQL that builds it never names one.
--
-- This covers the collections the wired screens need. Adding a screen means adding its collection
-- here, and that is deliberate: a snapshot that returned everything the moment the tables existed
-- would be a page of blanks pretending to be wired.

BEGIN;

-- Operations, nested inside their jobcard the way the pages read them. A jobcard's operations are
-- part of the jobcard on screen, so they arrive as an array on it rather than as a collection the
-- browser has to stitch together.
CREATE FUNCTION operations_of(p_jobcard_id bigint) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id::text,
    'no', o.seq,
    'desc', o.description,
    'instructions', o.instructions,
    'worker', o.worker,
    'filler', o.filler,
    -- The machine by name, because that is what the screen shows. A copy of the name on the
    -- operation would be a name that can drift from the machine's own.
    'machine', (SELECT e.name FROM equipment e WHERE e.id = o.equipment_id),
    'machineId', o.equipment_id::text,
    'plannedHours', o.planned_hours,
    'loggedHours', o.logged_hours,
    'plannedStart', o.planned_start,
    'actualStart', o.actual_start,
    'actualCompletion', o.actual_completion,
    'status', o.status,
    'dependency', o.depends_on::text,
    'inspectionCheckpoint', o.inspection_checkpoint,
    'notes', o.notes
  ) ORDER BY o.seq), '[]'::jsonb)
  FROM operation o WHERE o.jobcard_id = p_jobcard_id;
$$;

-- What has been done to a machine, in the shapes the equipment screen and the safety gates read.
--
-- One table behind all of it — equipment_event, with a kind per row — and six lists in front of it,
-- because that is how the screen asks: a service history, a calibration record, an inspection record,
-- the breakdowns, the checks signed before use, and the notes. Splitting one table into six named lists
-- is the whole job of this file, and doing it here rather than in the browser means the names are said
-- once.
--
-- `preUseChecks` is the one that matters. equipment-gates.js refuses to let a machine be used unless it
-- finds a check that passed, for the same day, and for the same jobcard when the caller named one — so
-- the rows carry the date, the jobcard's own reference, and whether a failure has been answered. The
-- gate has been asking for exactly this since it was written and getting an empty list every time.
CREATE FUNCTION equipment_events_of(p_equipment_id bigint, p_kinds text[]) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', 'E-' || v.id,
    'kind', v.kind,
    'date', v.happened_on,
    'by', v.performed_by,
    -- 'passed' / 'failed', because that is the vocabulary the gate matches on. The column holds the
    -- database's four words and this is the screen's two; the translation belongs on this side.
    'result', CASE v.result WHEN 'pass' THEN 'passed' WHEN 'fail' THEN 'failed' ELSE v.result END,
    'nextDue', v.next_due_on,
    'note', v.note,
    'jobcardNo', (SELECT j.ref FROM jobcard j WHERE j.id = v.jobcard_id),
    'resolved', v.resolved,
    'resolves', CASE WHEN v.resolves_event_id IS NULL THEN NULL ELSE 'E-' || v.resolves_event_id END
  ) ORDER BY v.happened_on DESC, v.id DESC), '[]'::jsonb)
  FROM equipment_event v
  WHERE v.equipment_id = p_equipment_id AND v.kind::text = ANY (p_kinds);
$$;

-- What happened to a quality record, and the notes written on it, as one list.
--
-- Both come out of activity_log, and the notes are in there rather than in a notes column on purpose:
-- a quality note somebody can quietly edit afterwards is worth less than no note at all, and that
-- table is append-only by trigger. A note is the row whose action is 'note', which is what lets the
-- screen tell the two apart while they live in one place.
-- The newest twenty, and the limit is the same judgement the movement log's two hundred already makes:
-- this runs once per hold, inspection and NCR in the snapshot, and activity_log is the table that grows
-- fastest in the whole system. The panels that show it are a scrolling list about six entries tall. A
-- record with a longer history than this has it in the log, where the audit trail is, rather than in
-- every snapshot every screen takes.
-- What a document is filed against, as the word a person would read: a project number, a jobcard, a
-- merchant's name, a stock code. One function because it has to run as the engine, and it has to run as the
-- engine because the register spans both sides of the building: a document may be filed against a purchase
-- order or an estimate, and the floor holds no SELECT on either.
--
-- The first version of this looked the reference up inline, in workspace_snapshot(), which meant one
-- certificate filed against one purchase order refused a welder the WHOLE snapshot — not the document, the
-- whole workshop, on every screen. That is the third time that exact shape has appeared: a list in the
-- snapshot that touches an office-only table closes the door for the floor, and it fails closed so it looks
-- like a permissions success. The pipeline moved to workspace_money() for it. Documents cannot: a welder
-- holding revision A while revision B is on file is the failure this register exists to prevent, so they
-- have to be able to read it.
--
-- Nothing here is a price, a cost, a value or a rate, which is the test §1b sets. A merchant's NAME is new
-- to the floor and that is deliberate: it is the name printed on the material certificate they are holding,
-- and a welder who cannot tell which merchant a certificate came from cannot check it against the plate.
-- SECURITY DEFINER is not a skeleton key: the engine is subject to GRANTs like anybody else, and holds
-- SELECT on four tables. So it is given exactly the two columns per table this lookup reads and nothing
-- else — an id to match on and the one string a person would call the record. A money column added to any
-- of these tables later is not granted, because a column grant does not widen when the table does, which is
-- the whole reason §1b is written column by column.
GRANT SELECT (id, ref) ON project, jobcard, purchase_order, estimate, ncr, inspection,
                           quality_hold, equipment, tender TO varmak_engine;
GRANT SELECT (id, name) ON supplier, customer TO varmak_engine;
GRANT SELECT (id, code) ON stock_item TO varmak_engine;

-- Whose name is on a record, where the record holds an id.
--
-- The fourth time in this project that a list in the snapshot has read a table the reader holds narrowly,
-- and the first time it failed QUIETLY. The row policy on app_user narrows a welder to their own row, so
-- `(SELECT display_name FROM app_user WHERE id = w.welder_id)` returned the reader's own name on their own
-- welds and NULL on everybody else's — no refusal, no error, just a weld log reading "by (NOBODY)" for
-- every weld somebody else made. A register whose whole purpose is traceability, saying nothing about who
-- welded what, and nothing failing.
--
-- The three before it refused out loud and were found in minutes. This one would have reached a screen.
--
-- Narrowing app_user to the reader's own row is right for the staff list — a welder does not assign
-- responsibility, which is why `people` in the snapshot is narrowed. A weld log is not the staff list: it
-- exists to say who made which joint, and EN 1090 is the reason. So the name is read by a function owned
-- by the engine, returning one column and nothing else.
CREATE FUNCTION person_name(p_user_id bigint) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT display_name FROM app_user WHERE id = p_user_id;
$$;

-- Postgres requires the INCOMING owner of a function to hold CREATE on the schema, and on PostgreSQL 15
-- and later `public` does not grant that to everybody. api.sql and auth.sql each do this dance around
-- their own ownership changes and take the privilege back at the end of the file; this file has two of
-- them and had neither, which only showed up on a hosted-shaped database — test-deploy.js installs as a
-- non-superuser owner, and that is the whole reason it exists. The two functions here are the only ones
-- in views.sql that change owner, so the grant opens here and closes below.
GRANT CREATE ON SCHEMA public TO varmak_engine;

REVOKE ALL ON FUNCTION person_name(bigint) FROM PUBLIC;
ALTER FUNCTION person_name(bigint) OWNER TO varmak_engine;
GRANT EXECUTE ON FUNCTION person_name(bigint) TO varmak_admin, varmak_office, varmak_workshop;

CREATE FUNCTION document_record_label(p_entity text, p_entity_id bigint) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE p_entity
    WHEN 'project'        THEN (SELECT x.ref  FROM project x        WHERE x.id = p_entity_id)
    WHEN 'jobcard'        THEN (SELECT x.ref  FROM jobcard x        WHERE x.id = p_entity_id)
    WHEN 'purchase_order' THEN (SELECT x.ref  FROM purchase_order x WHERE x.id = p_entity_id)
    WHEN 'supplier'       THEN (SELECT x.name FROM supplier x       WHERE x.id = p_entity_id)
    WHEN 'customer'       THEN (SELECT x.name FROM customer x       WHERE x.id = p_entity_id)
    WHEN 'estimate'       THEN (SELECT x.ref  FROM estimate x       WHERE x.id = p_entity_id)
    WHEN 'stock_item'     THEN (SELECT x.code FROM stock_item x     WHERE x.id = p_entity_id)
    WHEN 'ncr'            THEN (SELECT x.ref  FROM ncr x            WHERE x.id = p_entity_id)
    WHEN 'inspection'     THEN (SELECT x.ref  FROM inspection x     WHERE x.id = p_entity_id)
    WHEN 'quality_hold'   THEN (SELECT x.ref  FROM quality_hold x   WHERE x.id = p_entity_id)
    WHEN 'equipment'      THEN (SELECT x.ref  FROM equipment x      WHERE x.id = p_entity_id)
    WHEN 'tender'         THEN (SELECT x.ref  FROM tender x         WHERE x.id = p_entity_id)
    ELSE NULL END;
$$;

CREATE FUNCTION quality_activity_of(p_entity text, p_entity_id bigint) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'timestamp', a.happened_at, 'action', a.action, 'user', a.actor,
      -- `reason` is the screen's word for the detail beside an entry, and `text` is what it reads a
      -- note's body from. One column, under both names, because a note rendered in the activity list
      -- and the same note in the notes panel are the same row.
      'reason', a.detail, 'text', a.detail, 'author', a.actor,
      'date', a.happened_at::date, 'note', a.action = 'note'
    ) ORDER BY a.happened_at DESC, a.id DESC), '[]'::jsonb)
  FROM (
    SELECT * FROM activity_log
     WHERE entity = p_entity AND entity_id = p_entity_id
     ORDER BY happened_at DESC, id DESC LIMIT 20
  ) a;
$$;

CREATE FUNCTION workspace_snapshot() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    -- Stamped so the browser can tell a stale snapshot from a fresh one, and so a reload knows
    -- whether anything moved while it was away.
    'takenAt', now(),
    'takenBy', current_app_name(),
    -- Who, as an id rather than a name. The shop tablet's offline queue is stored under its owner and
    -- only ever flushed by them, because the server takes the name for a booking from the session:
    -- a queue left behind by one welder and flushed under the next one's session would book the first
    -- welder's work in the second welder's name. A display name cannot be that key — two Markos, or
    -- one Marko whose name is corrected in Access, and the queue is orphaned or, worse, adopted.
    'takenById', current_app_user()::text,
    -- And what they may do, because two screens were showing a name beside the word "Admin" written
    -- into the page. A welder signing in on their own phone read "Aleksandar · Admin" on the hub, which
    -- is not a cosmetic problem: the badge is the only thing on that screen that says whose session
    -- this is, and it was saying somebody else's. The role comes from the session like the name does.
    'takenRole', current_app_role()::text,

    -- The people this workshop has. Six screens offered a "Responsible", "Owner" or "Estimator"
    -- dropdown whose three options were written into the page — Aleksandar C., Elena N., Marko K. —
    -- so on the first day at a real firm those fields offered three strangers and none of the staff.
    -- One of the three was also the answer to every "who did this": a note added by a welder was
    -- signed Aleksandar C., and a quality record that names the wrong person is worse than one that
    -- names nobody.
    --
    -- Name and role only. The email, the lock state and everything about a password stay in people(),
    -- which the Access screen calls for itself; this is the list a form needs to offer a choice. The
    -- row policy on app_user narrows it without any help from here: office and admin read the whole
    -- staff list, and a welder reads their own row, so the floor's copy of this is one person. That is
    -- the right answer for the floor — a welder does not assign responsibility — and it is why this
    -- belongs in the snapshot everybody reads rather than in the office's own payload.
    'people', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', u.id::text, 'name', u.display_name, 'role', u.role, 'active', u.is_active
      ) ORDER BY u.display_name) FROM app_user u WHERE u.is_active), '[]'::jsonb),

    'customers', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id::text, 'no', c.ref, 'name', c.name, 'status', c.status,
        'city', c.city, 'country', c.country, 'org', c.org_no, 'vat', c.vat_no,
        'email', c.email, 'phone', c.phone, 'website', c.website,
        'industry', c.industry, 'since', c.customer_since, 'type', c.customer_type,
        -- The contact method, not the is_preferred flag. The page's field is called `preferred` and
        -- sits under a label reading "Preferred Contact"; handing it a boolean put the word true on
        -- that line. Nothing reads a preferred-customer flag, so is_preferred is not in the snapshot
        -- at all rather than under a name that invites the same mistake again.
        'preferred', c.preferred_contact, 'notes', c.notes,
        -- The people at the customer. Named columns rather than a row, because a welder is granted
        -- this table column by column and SELECT * would be refused for them — the same trap the
        -- equipment gate fell into. Nothing here is a price, so it is in the snapshot everybody
        -- reads rather than in the money one.
        'contacts', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'name', k.name, 'role', k.role, 'email', k.email, 'phone', k.phone,
            'primary', k.is_primary
          ) ORDER BY k.is_primary DESC, k.name)
          FROM customer_contact k WHERE k.customer_id = c.id), '[]'::jsonb)
      ) ORDER BY c.ref) FROM customer c), '[]'::jsonb),

    'projects', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id::text, 'no', p.ref, 'name', p.name,
        'customerId', p.customer_id::text,
        'customer', (SELECT c.name FROM customer c WHERE c.id = p.customer_id),
        'status', p.status, 'phase', p.phase, 'progress', p.progress,
        'plannedHours', p.planned_hours, 'usedHours', p.used_hours,
        'deadline', p.deadline, 'start', p.planned_start,
        'plannedStart', p.planned_start, 'actualStart', p.actual_start,
        'plannedCompletion', p.planned_completion,
        'expectedCompletion', p.expected_completion,
        'actualCompletion', p.actual_completion, 'closedDate', p.closed_on,
        'responsible', p.responsible, 'materialStatus', p.material_status,
        'poNumber', p.po_number, 'workshop', p.workshop, 'description', p.description,
        -- The kinds of work on the project. The estimating screen holds them as a list and writes them
        -- as one field; it was missing from here entirely, so a project made on that screen came back
        -- without the one thing that said whether it was fabrication or service.
        'workTypes', p.work_types,
        'holdReason', p.hold_reason, 'holdComment', p.hold_comment,
        'expectedResume', p.expected_resume, 'cancelReason', p.cancel_reason,
        'notes', p.notes
      ) ORDER BY p.ref) FROM project p), '[]'::jsonb),

    'jobcards', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', j.id::text, 'no', j.ref, 'title', j.title, 'item', j.item,
        'projectId', j.project_id::text,
        'projectNo', (SELECT p.ref FROM project p WHERE p.id = j.project_id),
        'customerId', j.customer_id::text,
        'customer', (SELECT c.name FROM customer c WHERE c.id = j.customer_id),
        'quantity', j.quantity, 'revision', j.revision, 'drawingNo', j.drawing_no,
        'workType', j.work_type, 'location', j.location, 'priority', j.priority,
        'responsible', j.responsible, 'status', j.status, 'progress', j.progress,
        'plannedHours', j.planned_hours,
        'plannedStart', j.planned_start, 'plannedCompletion', j.planned_completion,
        'actualStart', j.actual_start, 'actualCompletion', j.actual_completion,
        'materialReadiness', j.material_readiness, 'deliveryTarget', j.delivery_target,
        'heatNo', j.heat_no, 'materialCertRef', j.material_cert_ref,
        'inspectionRequired', j.inspection_required,
        'archived', j.archived, 'created', j.created_at, 'createdBy', j.created_by,
        'notes', j.notes,
        'operations', operations_of(j.id)
      ) ORDER BY j.ref) FROM jobcard j), '[]'::jsonb),

    'equipment', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', e.id::text, 'equipmentId', e.ref, 'name', e.name, 'category', e.category,
        'status', e.status, 'manufacturer', e.manufacturer, 'model', e.model,
        'serial', e.serial_no, 'assetNumber', e.asset_no,
        'yearOfManufacture', e.year_of_manufacture, 'description', e.description,
        'currentLocation', e.current_location, 'homeLocation', e.home_location,
        'department', e.department, 'responsiblePerson', e.responsible_person,
        'operator', e.operator, 'condition', e.condition, 'criticality', e.criticality,
        'safetyWarnings', e.safety_warnings,
        'certificationExpiry', e.certification_expiry, 'warrantyExpiry', e.warranty_expiry,
        'operatingHourMeter', e.operating_hours, 'serviceInterval', e.service_interval_hours,
        'maintenanceDate', e.last_service_date, 'inspectionDate', e.last_inspection_date,
        'calibrationDate', e.last_calibration_date, 'qrCode', e.qr_code,
        'assignedProject', (SELECT p.ref FROM project p WHERE p.id = e.assigned_project_id),
        -- The jobcard it is on right now, from the assignment rather than from a column: the partial
        -- unique index on equipment_assignment is what makes "one machine, one jobcard" true, and a
        -- column here would be a second answer that can disagree with it.
        'assignedJobcard', (SELECT j.ref FROM equipment_assignment a
                             JOIN jobcard j ON j.id = a.jobcard_id
                            WHERE a.equipment_id = e.id AND a.released_at IS NULL
                            ORDER BY a.id DESC LIMIT 1),
        'purchaseDate', e.purchase_date, 'purchaseSupplier', e.purchase_supplier,
        -- What the safety gate reads before it may require anything of anybody.
        'requirements', jsonb_build_object('preUseCheckRequired', e.pre_use_check_required),
        -- The six logs, one table, split the way the screen asks for them.
        'preUseChecks', equipment_events_of(e.id, ARRAY['pre-use-check']),
        'maintenance', equipment_events_of(e.id, ARRAY['service', 'repair']),
        'calibrations', equipment_events_of(e.id, ARRAY['calibration']),
        'inspections', equipment_events_of(e.id, ARRAY['inspection']),
        'downtimeRecords', equipment_events_of(e.id, ARRAY['breakdown']),
        'activity', equipment_events_of(e.id,
          ARRAY['service', 'repair', 'calibration', 'inspection', 'breakdown', 'pre-use-check']),
        'notes', e.notes
      ) ORDER BY e.ref) FROM equipment e), '[]'::jsonb),

    'hours', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', 'H-' || h.id, 'date', h.worked_on, 'worker', h.worker, 'user', h.worker,
        'jobcard', (SELECT j.ref FROM jobcard j WHERE j.id = h.jobcard_id),
        'project', (SELECT p.ref FROM project p JOIN jobcard j ON j.project_id = p.id
                     WHERE j.id = h.jobcard_id),
        'operationId', h.operation_id::text,
        'hours', h.hours, 'note', h.note
      ) ORDER BY h.worked_on DESC, h.id DESC) FROM hours_entry h), '[]'::jsonb),

    -- The merchants. Here because the non-conformance form asks which supplier a rejected batch came
    -- from and its dropdown was empty — the snapshot carried no suppliers at all, so on a wired system
    -- the one field that makes a supplier complaint traceable could not be filled in.
    --
    -- payment_terms_days is not here. It is what this workshop is charged by, which §1b withholds from
    -- the floor for the same reason a customer's price list is withheld, and the floor reads this list.
    'suppliers', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', s.id::text, 'no', s.ref, 'name', s.name, 'org', s.org_no, 'vat', s.vat_no,
        'email', s.email, 'phone', s.phone, 'website', s.website,
        'address', s.address, 'city', s.city, 'country', s.country,
        'category', s.category, 'type', s.supplier_type, 'established', s.established,
        'delivery', s.delivery_terms, 'minimum', s.minimum_order, 'currency', s.currency,
        -- Cast because it is a numeric, and a JSON number parsed in a browser is a double. Not money,
        -- but the same rule: everything shaped like a figure crosses as text, so "is anything in this
        -- payload a JSON number" stays a question with one answer.
        'rating', s.rating::text,
        'status', s.status, 'notes', s.notes,
        -- Who to ring. Named columns rather than a row, because a welder is granted this table column by
        -- column and SELECT * would be refused for them — the trap the equipment gate fell into.
        'contacts', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'name', k.name, 'role', k.role, 'email', k.email, 'phone', k.phone,
            'primary', k.is_primary
          ) ORDER BY k.is_primary DESC, k.name)
          FROM supplier_contact k WHERE k.supplier_id = s.id), '[]'::jsonb),
        'activity', quality_activity_of('supplier', s.id)
      ) ORDER BY s.name) FROM supplier s), '[]'::jsonb),

    -- ── Quality ────────────────────────────────────────────────────────────────────────────
    --
    -- Three lists the snapshot did not carry at all, which meant the one screen whose job is to stop
    -- work leaving the building was reading its whole register out of the browser's own storage. The
    -- hold gates in the database were already enforcing against `quality_hold`; the screen showing
    -- the holds was looking somewhere else entirely.

    -- What is being held right now, and why. `reference` is the ref of whichever thing the hold names
    -- — the screen shows one column and a scope beside it, so the two are worked out from the same
    -- row rather than trusted to agree.
    'qualityHolds', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', h.id::text, 'no', h.ref, 'scope', h.scope, 'status', h.status,
        'reference', coalesce((SELECT j.ref FROM jobcard j WHERE j.id = h.jobcard_id),
                              (SELECT p.ref FROM project p WHERE p.id = h.project_id)),
        'projectNo', (SELECT p.ref FROM project p WHERE p.id = coalesce(h.project_id,
                       (SELECT j.project_id FROM jobcard j WHERE j.id = h.jobcard_id))),
        'reason', h.reason, 'severity', h.severity, 'requiredAction', h.required_action,
        'relatedRef', h.related_ref, 'appliedBy', h.applied_by, 'appliedDate', h.applied_at,
        'releaseAuthority', h.release_authority, 'releaseReason', h.release_reason,
        'releaseDate', h.released_at,
        'activity', quality_activity_of('quality_hold', h.id)
      ) ORDER BY h.applied_at DESC, h.id DESC) FROM quality_hold h), '[]'::jsonb),

    -- The document register. The screen's words throughout — it calls a title a `name`, a kind a `type`,
    -- and an entity a `module` — and two of its four status values are not stored at all.
    --
    -- 'Review Soon' and 'Expired' are answers to "what is the date today". The screen offers both in its
    -- status dropdown, which would store a fact that was true the morning somebody chose it and quietly
    -- stops being true; the column holds only what somebody sets, and the two dated states are worked out
    -- here, on every read. Thirty days is the window, which is the one number in this block that is a
    -- judgement rather than a fact — a certificate with a month left is still valid and is worth chasing.
    --
    -- A superseded document keeps saying superseded whatever its date says: revision A running out is not
    -- news once revision B is on file.
    'documents', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', d.id::text, 'no', d.ref, 'name', d.title, 'type', d.kind,
        'category', d.category, 'revision', d.revision,
        'status', CASE
          WHEN d.status = 'superseded' THEN 'Superseded'
          WHEN d.expires_on IS NOT NULL AND d.expires_on < current_date THEN 'Expired'
          WHEN d.expires_on IS NOT NULL AND d.expires_on <= current_date + 30 THEN 'Review Soon'
          WHEN d.status = 'approved' THEN 'Approved'
          WHEN d.status = 'valid' THEN 'Valid'
          ELSE 'Draft' END,
        -- What somebody actually chose, beside what the date makes of it. Both, because a screen that
        -- shows only the computed word cannot offer the form a value to save back — which is how a page
        -- ends up writing 'Review Soon' into a column as though somebody had decided it.
        'setStatus', d.status,
        'expiry', d.expires_on,
        -- The screen's own two fields for a link, from the one pair of columns that holds it.
        'module', CASE d.entity
          WHEN 'project' THEN 'Projects'      WHEN 'jobcard' THEN 'Workshop'
          WHEN 'purchase_order' THEN 'Purchasing' WHEN 'supplier' THEN 'Suppliers'
          WHEN 'customer' THEN 'Customers'    WHEN 'estimate' THEN 'Estimations'
          WHEN 'stock_item' THEN 'Store'
          WHEN 'ncr' THEN 'Quality' WHEN 'inspection' THEN 'Quality' WHEN 'quality_hold' THEN 'Quality'
          ELSE NULL END,
        'record', document_record_label(d.entity, d.entity_id),
        'author', d.author, 'notes', d.notes,
        'uploadedBy', d.uploaded_by, 'uploaded', d.uploaded_at, 'updated', d.updated_at,
        -- The file, and there is never one yet. Sent as nulls rather than left out so the screen's
        -- download button can ask and be told no, instead of reading a field that is not there.
        'fileName', d.filename, 'fileSize', d.size_bytes, 'mimeType', d.mime_type,
        'activity', quality_activity_of('document', d.id)
      ) ORDER BY d.updated_at DESC, d.id DESC) FROM document d), '[]'::jsonb),

    -- ── The welding registers ─────────────────────────────────────────────────────────────────
    --
    -- The screen's words throughout, and the same rule as the document register about the two statuses
    -- that are really dates. A welder qualification's demonstration data carries `expiring-soon` as a
    -- STORED status, in the register whose whole job is to say who may weld — so it is worked out here,
    -- on every read, from expires_on. Sixty days is the window, which is the one number in this block
    -- that is a judgement: a qualification with two months left is still valid and is worth renewing
    -- before somebody is standing at a bench unable to sign their own weld.
    'qualityWps', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id::text, 'no', p.ref, 'revision', p.revision, 'process', p.process,
        'materialGroup', p.material_group, 'thicknessRange', p.thickness_range,
        'diameterRange', p.diameter_range, 'jointType', p.joint_type, 'position', p.position,
        'fillerMaterial', p.filler_material, 'shieldingGas', p.shielding_gas,
        'preheatInterpass', p.preheat_interpass, 'supportingWpqr', p.supporting_wpqr,
        'status', CASE p.status
          WHEN 'approved' THEN 'valid' WHEN 'awaiting-approval' THEN 'awaiting-approval'
          WHEN 'withdrawn' THEN 'withdrawn' ELSE 'draft' END,
        'setStatus', p.status,
        'approvedOn', p.approved_on, 'approvedBy', p.approved_by,
        'documentRef', (SELECT d.title FROM document d WHERE d.id = p.document_id),
        'notes', p.notes,
        'activity', quality_activity_of('wps', p.id)
      ) ORDER BY p.ref, p.revision DESC) FROM wps p), '[]'::jsonb),

    'qualityWelderQuals', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', q.id::text, 'qualNo', q.qual_no,
        -- The name, from the staff list, because the screen shows a person and the column holds an id.
        'welder', person_name(q.welder_id),
        'welderId', q.welder_id::text,
        'process', q.process, 'materialGroup', q.material_group, 'thicknessRange', q.thickness_range,
        'position', q.position, 'issuedBy', q.issued_by, 'issueDate', q.issued_on,
        'expiryDate', q.expires_on,
        'status', CASE
          WHEN q.status <> 'valid' THEN q.status::text
          WHEN q.expires_on < current_date THEN 'expired'
          WHEN q.expires_on <= current_date + 60 THEN 'expiring-soon'
          ELSE 'valid' END,
        'setStatus', q.status,
        -- How long is left, because "expiring-soon" without a number is a warning nobody can plan around.
        'daysLeft', (q.expires_on - current_date),
        'documentRef', (SELECT d.title FROM document d WHERE d.id = q.document_id),
        'notes', q.notes,
        'activity', quality_activity_of('welder_qual', q.id)
      ) ORDER BY q.expires_on) FROM welder_qual q), '[]'::jsonb),

    'qualityWelds', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', w.id::text, 'no', w.ref,
        'projectNo', (SELECT x.ref FROM project x WHERE x.id = w.project_id),
        'jobcard', (SELECT x.ref FROM jobcard x WHERE x.id = w.jobcard_id),
        'operation', (SELECT o.description FROM operation o WHERE o.id = w.operation_id),
        'component', w.component, 'drawingNo', w.drawing_no,
        'weldMapPosition', w.weld_map_position, 'jointType', w.joint_type,
        'baseMaterial', w.base_material, 'materialGrade', w.material_grade,
        'thickness', w.thickness, 'process', w.process,
        'wpsNo', (SELECT p.ref FROM wps p WHERE p.id = w.wps_id),
        'wpqrRef', (SELECT p.supporting_wpqr FROM wps p WHERE p.id = w.wps_id),
        'welder', person_name(w.welder_id),
        'welderQualRef', (SELECT q.qual_no FROM welder_qual q WHERE q.id = w.welder_qual_id),
        'fillerMaterial', w.filler_material, 'consumableBatch', w.consumable_batch,
        'shieldingGas', w.shielding_gas, 'preheatRequired', w.preheat_required,
        'interpassTempReq', w.interpass_temp_req, 'weldDate', w.welded_on,
        'visualRequired', w.visual_required, 'ndtRequired', w.ndt_required, 'ndtMethod', w.ndt_method,
        'finalResult', w.final_result, 'status', w.status, 'notes', w.notes,
        -- The repairs, as the list the screen shows. A weld that was repaired is not a weld that was
        -- always right, and this is the column that says which.
        'repairHistory', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'date', r.repaired_on, 'reason', r.reason, 'by', r.repaired_by, 'notes', r.notes
          ) ORDER BY r.repaired_on, r.id) FROM weld_repair r WHERE r.weld_id = w.id), '[]'::jsonb),
        'activity', quality_activity_of('weld', w.id)
      ) ORDER BY w.welded_on DESC, w.id DESC) FROM weld w), '[]'::jsonb),

    'qualityNdt', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', n.id::text, 'no', n.ref,
        'weldRef', (SELECT x.ref FROM weld x WHERE x.id = n.weld_id),
        'projectNo', (SELECT p.ref FROM project p
                       JOIN weld x ON x.id = n.weld_id WHERE p.id = x.project_id),
        'jobcard', (SELECT j.ref FROM jobcard j JOIN weld x ON x.id = n.weld_id WHERE j.id = x.jobcard_id),
        'drawingNo', n.drawing_no, 'method', n.method, 'procedureRef', n.procedure_ref,
        'inspectionPercent', n.inspection_percent, 'inspectionArea', n.inspection_area,
        'technician', n.technician, 'externalCompany', n.external_company,
        'technicianCertRef', n.technician_cert_ref, 'inspectionDate', n.inspected_on,
        'acceptanceCriteria', n.acceptance_criteria, 'result', n.result, 'findings', n.findings,
        'repairRequired', n.repair_required, 'reinspectionRequired', n.reinspection_required,
        'ncrRef', (SELECT c.ref FROM ncr c WHERE c.id = n.ncr_id),
        -- The screen shows a status beside the result and they are the same fact. One column, read twice,
        -- because two would be two answers to whether a joint is sound.
        'status', n.result, 'notes', n.notes,
        'activity', quality_activity_of('ndt_report', n.id)
      ) ORDER BY n.inspected_on DESC, n.id DESC) FROM ndt_report n), '[]'::jsonb),

    -- The inspections. `type` rather than `kind`, because that is the word on the screen and on the
    -- filter above it; the column is named the way the rest of this schema names a kind of thing, and
    -- one of the two had to give.
    'qualityInspections', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', i.id::text, 'no', i.ref, 'type', i.kind, 'status', i.status, 'result', i.result,
        'jobcard', (SELECT j.ref FROM jobcard j WHERE j.id = i.jobcard_id),
        'projectNo', (SELECT p.ref FROM project p WHERE p.id = coalesce(i.project_id,
                       (SELECT j.project_id FROM jobcard j WHERE j.id = i.jobcard_id))),
        'operation', i.operation, 'component', i.component,
        'drawingNo', i.drawing_no, 'drawingRev', i.drawing_rev, 'method', i.method,
        'acceptanceCriteria', i.acceptance_criteria, 'customerWitness', i.customer_witness,
        'materialTraceabilityOk', i.material_traceability_ok, 'critical', i.critical,
        'plannedDate', i.planned_date, 'actualDate', i.actual_date, 'inspector', i.inspector,
        'findings', i.findings, 'notes', i.notes,
        'reinspectionOf', (SELECT o.ref FROM inspection o WHERE o.id = i.reinspection_of),
        -- The evidence, in the shape the screen indexes it in: `lower` and `upper` rather than the
        -- column names, and `resultItem` rather than `result`, because the page walks this array
        -- looking for exactly those keys and a nominal with no band beside it renders as a verdict of
        -- "N/A" on a line nobody measured.
        'checklist', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'item', c.item, 'resultItem', coalesce(c.result, ''),
            'nominal', c.nominal, 'lower', c.tol_lower, 'upper', c.tol_upper,
            'actual', c.actual, 'note', c.note
          ) ORDER BY c.line_no)
          FROM inspection_check c WHERE c.inspection_id = i.id), '[]'::jsonb),
        'activity', quality_activity_of('inspection', i.id)
      ) ORDER BY i.id DESC) FROM inspection i), '[]'::jsonb),

    -- The non-conformances. `responsiblePerson` and `dueDate` are the screen's names for `responsible`
    -- and `due_on`; the supplier arrives as a name because that is what the register shows.
    'qualityNcrs', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', n.id::text, 'no', n.ref, 'title', n.title, 'category', n.category,
        'severity', n.severity, 'status', n.status, 'description', n.description,
        'jobcard', (SELECT j.ref FROM jobcard j WHERE j.id = n.jobcard_id),
        'projectNo', (SELECT p.ref FROM project p WHERE p.id = coalesce(n.project_id,
                       (SELECT j.project_id FROM jobcard j WHERE j.id = n.jobcard_id))),
        'customer', (SELECT c.name FROM customer c JOIN project p ON p.customer_id = c.id
                      WHERE p.id = coalesce(n.project_id,
                        (SELECT j.project_id FROM jobcard j WHERE j.id = n.jobcard_id))),
        'responsiblePerson', n.responsible, 'dueDate', n.due_on,
        'detectedBy', n.detected_by, 'detectionDate', n.detected_on,
        'operation', n.operation, 'component', n.component, 'material', n.material,
        'supplier', (SELECT s.name FROM supplier s WHERE s.id = n.supplier_id),
        'supplierId', n.supplier_id::text,
        'containment', n.containment, 'disposition', n.disposition,
        'dispositionApprovalRef', n.disposition_approval_ref,
        'correctiveActionRef', n.corrective_action_ref,
        'verificationResult', n.verification_result, 'verifiedBy', n.verified_by,
        'closureApproval', n.closure_approval, 'closedOn', n.closed_on,
        'rootCause', n.root_cause, 'correctiveAction', n.corrective_action, 'notes', n.notes,
        'activity', quality_activity_of('ncr', n.id)
      ) ORDER BY n.id DESC) FROM ncr n), '[]'::jsonb),

    'inventory', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', i.id::text, 'code', i.code, 'itemNo', i.code, 'description', i.description,
        'unit', i.unit, 'baseUnit', i.base_unit, 'sizePerUnit', i.size_per_unit,
        'weightPerBase', i.weight_per_base, 'stock', i.stock, 'reserved', i.reserved,
        'minStock', i.min_stock, 'reorderQty', i.reorder_quantity,
        'category', i.category, 'grade', i.grade, 'dimensions', i.dimensions,
        'heat', i.heat_no, 'certificate', i.material_cert_ref, 'status', i.status,
        -- The bin the steel is in, which the storeman reads off the label. Distinct from the two
        -- below it: those are the warehouse and the rack.
        'location', i.bin_code,
        'group', (SELECT g.name FROM item_group g WHERE g.id = i.group_id),
        'subgroup', (SELECT g.name FROM item_group g WHERE g.id = i.subgroup_id),
        'locationGroup', (SELECT l.name FROM location l WHERE l.id = i.location_id),
        'locationSub', (SELECT l.name FROM location l WHERE l.id = i.sublocation_id),
        -- And the ids behind those four names. The names are what the screen shows; the ids are what a
        -- save has to send back, and without them correcting an item's description would move it out of
        -- its group — a name is not something save_stock_item can accept for a foreign key.
        'groupId', i.group_id::text, 'subgroupId', i.subgroup_id::text,
        'locationId', i.location_id::text, 'sublocationId', i.sublocation_id::text
      ) ORDER BY i.code) FROM stock_item i), '[]'::jsonb),

    -- The movements, which are the whole reason the store's figures can be trusted: every change to a
    -- shelf has a line here saying who moved what, when and where to. The store screen has a panel for
    -- them and it was empty, because the snapshot did not carry them — so the one screen whose job is
    -- explaining a figure could not.
    --
    -- The last two hundred, newest first. A workshop's movement log grows without limit and the panel
    -- shows a page of it; sending all of it would make every snapshot slower for every screen.
    'movements', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', m.id::text, 'ref', m.ref, 'time', m.moved_at, 'action', m.kind,
        'code', (SELECT s.code FROM stock_item s WHERE s.id = m.stock_item_id),
        'qty', m.quantity, 'unit', m.unit, 'from', m.moved_from, 'to', m.moved_to,
        'user', m.moved_by, 'note', m.note,
        'jobcard', (SELECT j.ref FROM jobcard j WHERE j.id = m.jobcard_id),
        'projectNo', (SELECT p.ref FROM project p
                      JOIN jobcard j ON j.project_id = p.id WHERE j.id = m.jobcard_id)
      ) ORDER BY m.id DESC) FROM (
        SELECT * FROM stock_movement ORDER BY id DESC LIMIT 200
      ) m), '[]'::jsonb)
  );
$$;

-- The money, keyed by id so the office can merge it into the snapshot record by record. Granted to
-- admin and office only; a welder calling this is refused by the server, and their snapshot is
-- complete without it rather than missing something it expected.
--
-- Every figure crosses as TEXT, not as a JSON number, and that is not fussiness. jsonb_build_object
-- on a numeric(12,2) produces a JSON number, and a JSON number parsed in a browser is a double —
-- which is the "money as floating point" mistake BACKEND.md §2 rules out in the schema and would
-- then have reintroduced on the wire. 14.50 arrives as "14.50" and keeps its scale; what the page
-- does with it is the page's business, but nothing is lost getting there.
CREATE FUNCTION workspace_money() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    -- Not only the figures. §1b withholds more from the floor than numbers in kronor: the payment
    -- terms, the price list and the discount agreement all say what this customer is charged, and
    -- the billing address belongs to invoicing rather than to the bench. The delivery terms are here
    -- for a plainer reason — the column is not granted to the floor, because Incoterms are not
    -- something anybody needs at a bench. Either way the test is the grant: a column the workshop
    -- cannot read cannot appear in the snapshot everybody reads, or a welder calling it would be
    -- refused the whole thing rather than that one field.
    'customers', coalesce((SELECT jsonb_object_agg(c.id::text, jsonb_build_object(
        'credit', c.credit_limit::text, 'currency', c.currency,
        -- A count of days rather than a figure in kronor, and cast anyway: "everything in this
        -- payload is text" is a rule that can be checked in one line, and an exception to it is a
        -- rule that has to be read carefully every time somebody adds a field.
        'terms', c.payment_terms_days::text, 'priceList', c.price_list,
        'deliveryTerms', c.delivery_terms, 'discountAgreement', c.discount_agreement,
        'billing', c.billing_address, 'shipping', c.shipping_address))
      FROM customer c), '{}'::jsonb),
    'projects', coalesce((SELECT jsonb_object_agg(p.id::text,
        jsonb_build_object('quotedValue', p.quoted_value::text)) FROM project p), '{}'::jsonb),
    'inventory', coalesce((SELECT jsonb_object_agg(i.id::text,
        jsonb_build_object('avgCost', i.avg_cost::text, 'lastPrice', i.last_price::text))
      FROM stock_item i), '{}'::jsonb),
    'equipment', coalesce((SELECT jsonb_object_agg(e.id::text,
        jsonb_build_object('purchasePrice', e.purchase_price::text)) FROM equipment e), '{}'::jsonb),

    -- ── The sales pipeline ─────────────────────────────────────────────────────────────────
    --
    -- Here rather than in the snapshot, and it was put in the snapshot first, which is how the reason
    -- was found: `lead`, `opportunity` and `tender` are not granted to varmak_workshop at all, so a
    -- welder calling workspace_snapshot() was refused the WHOLE THING — not the pipeline, the whole
    -- workshop. One list a role cannot read makes every screen that role opens fail.
    --
    -- Three whole lists rather than figures keyed by id, which the money payload had not carried
    -- before. What a lead is worth and what an enquiry is worth are figures, and none of the pipeline
    -- is anything a welder has a part in — so the honest shape is the whole list on this side of the
    -- line rather than an enquiry with its value removed, sent to somebody who is shown no enquiries.
    'marketingLeads', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', l.id::text, 'no', l.ref, 'company', l.company, 'contact', l.contact,
        'email', l.email, 'phone', l.phone, 'city', l.city, 'country', l.country,
        'industry', l.industry, 'size', l.company_size, 'source', l.source,
        'service', l.service_wanted, 'value', l.estimated_value::text,
        'priority', l.priority, 'status', l.status, 'owner', l.owner,
        'lastContact', l.last_contact_on, 'nextFollowUp', l.next_follow_up_on,
        'commPref', l.contact_preference, 'dnc', l.do_not_contact,
        'linkedCustomerId', l.customer_id::text,
        -- The enquiry this lead became, read the way round the schema points: opportunity.lead_id. A
        -- copy of the link on the lead would be a second thing that can be wrong about which is which.
        'linkedOpportunityId', (SELECT o.id::text FROM opportunity o WHERE o.lead_id = l.id
                                 ORDER BY o.id LIMIT 1),
        'notes', l.notes, 'created', l.created_at,
        'activity', quality_activity_of('lead', l.id),
        -- What has been found out about them. Append-only, and the screen shows it as a queue.
        'findings', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id', pf.id::text, 'finding', pf.finding, 'source', pf.source,
            'foundBy', pf.found_by, 'foundAt', pf.found_at
          ) ORDER BY pf.found_at DESC, pf.id DESC)
          FROM prospect_finding pf WHERE pf.lead_id = l.id), '[]'::jsonb)
      ) ORDER BY l.id DESC) FROM lead l), '[]'::jsonb),

    'marketingOpportunities', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', o.id::text, 'no', o.ref, 'title', o.title,
        -- Whose enquiry it is, read off whichever of the two it points at. Not a column: an opportunity
        -- belongs to a customer or to a lead, and the name lives on that record.
        'company', coalesce((SELECT c.name FROM customer c WHERE c.id = o.customer_id),
                            (SELECT l.company FROM lead l WHERE l.id = o.lead_id)),
        'contact', o.contact, 'leadId', o.lead_id::text, 'customerId', o.customer_id::text,
        'services', o.services, 'scope', o.scope, 'industry', o.industry,
        'value', o.value::text, 'currency', o.currency, 'probability', o.probability,
        'stage', o.stage, 'expectedClose', o.expected_close,
        'expectedDecision', o.expected_decision_on, 'requiredDelivery', o.required_delivery_on,
        'competitor', o.competitor, 'decisionReason', o.decision_reason, 'owner', o.owner,
        'nextAction', o.next_action, 'followUpDate', o.follow_up_on,
        'activity', quality_activity_of('opportunity', o.id),
        -- The tenders offered against it. tender.opportunity_id already points this way.
        'tenders', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id', t.id::text, 'no', t.ref, 'title', t.title, 'status', t.status,
            'due', t.due_on, 'submitted', t.submitted_on, 'value', t.value::text
          ) ORDER BY t.id) FROM tender t WHERE t.opportunity_id = o.id), '[]'::jsonb)
      ) ORDER BY o.id DESC) FROM opportunity o), '[]'::jsonb),

    'marketingTenders', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', t.id::text, 'no', t.ref, 'title', t.title, 'status', t.status,
        'opportunityId', t.opportunity_id::text, 'customerId', t.customer_id::text,
        -- Who is asking. The column first, because a tender arrives from a company this workshop may
        -- have no customer record for — that is what tendering is — and only then the customer or the
        -- enquiry it was later tied to.
        'company', coalesce(t.company,
                            (SELECT c.name FROM customer c WHERE c.id = t.customer_id),
                            (SELECT coalesce((SELECT c2.name FROM customer c2 WHERE c2.id = o.customer_id),
                                             (SELECT l.company FROM lead l WHERE l.id = o.lead_id))
                               FROM opportunity o WHERE o.id = t.opportunity_id)),
        -- `ref` on this screen is THEIR reference for it, which is what every email about it quotes.
        -- Our own is `no`, which the database allocates.
        'ref', t.customer_ref, 'source', t.source, 'industry', t.industry,
        'description', t.description, 'requirements', t.requirements,
        'responsible', t.responsible, 'bidDecision', t.bid_decision,
        'reminderDate', t.reminder_on, 'deadline', t.due_on,
        'due', t.due_on, 'submitted', t.submitted_on, 'value', t.value::text,
        'projectNo', (SELECT p.ref FROM project p WHERE p.id = t.project_id),
        'activity', quality_activity_of('tender', t.id)
      ) ORDER BY t.id DESC) FROM tender t), '[]'::jsonb),

    -- What each merchant charges, and what they are paid on. Both are prices in the sense §1b means —
    -- a price list is a price — so they are here rather than in the snapshot everybody reads, keyed by
    -- supplier id so the office can merge them into the register record by record.
    'suppliers', coalesce((SELECT jsonb_object_agg(s.id::text, jsonb_build_object(
        'terms', s.payment_terms_days::text,
        -- `priceList`, not `items`: the supplier screen's `items` is a rollup of what has been bought —
        -- total quantity, total spend — which needs invoices this system does not keep. This is what
        -- each merchant quotes, which is a different question and an answerable one. Two things under
        -- one word is how a table of price lines gets rendered into a column headed "Total spend".
        'priceList', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'itemId', si.stock_item_id::text,
            'code', (SELECT i.code FROM stock_item i WHERE i.id = si.stock_item_id),
            'description', (SELECT i.description FROM stock_item i WHERE i.id = si.stock_item_id),
            'articleNo', si.article_no, 'price', si.price::text, 'currency', si.currency,
            'packSize', si.pack_size::text, 'leadTime', si.lead_time_days::text,
            'preferred', si.is_preferred
          ) ORDER BY si.id)
          FROM supplier_item si WHERE si.supplier_id = s.id), '[]'::jsonb)))
      FROM supplier s), '{}'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION operations_of(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION equipment_events_of(bigint, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_activity_of(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION document_record_label(text, bigint) FROM PUBLIC;
-- Owned by the engine, which is what makes SECURITY DEFINER mean anything: as the migration role it
-- would run as whoever holds everything, and the point is that it runs as a role holding exactly the
-- reads this one lookup needs.
ALTER FUNCTION document_record_label(text, bigint) OWNER TO varmak_engine;
-- And taken back, the moment the last ownership change in this file is done. The privilege exists only
-- while it is being used, which is the rule the other two files follow.
REVOKE CREATE ON SCHEMA public FROM varmak_engine;
REVOKE ALL ON FUNCTION workspace_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION workspace_money() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION operations_of(bigint), equipment_events_of(bigint, text[]),
  quality_activity_of(text, bigint), workspace_snapshot(),
  document_record_label(text, bigint), person_name(bigint)
TO varmak_admin, varmak_office, varmak_workshop;
GRANT EXECUTE ON FUNCTION workspace_money() TO varmak_admin, varmak_office;

COMMIT;
