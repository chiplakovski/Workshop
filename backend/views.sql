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
        jsonb_build_object('purchasePrice', e.purchase_price::text)) FROM equipment e), '{}'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION operations_of(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION workspace_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION workspace_money() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION operations_of(bigint), workspace_snapshot()
TO varmak_admin, varmak_office, varmak_workshop;
GRANT EXECUTE ON FUNCTION workspace_money() TO varmak_admin, varmak_office;

COMMIT;
