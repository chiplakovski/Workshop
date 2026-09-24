'use strict';

// test-schema.js passing tells you the schema refuses what it should. It does not tell you the
// tests would notice if it stopped. This file asks that second question: it puts each rule's bug
// back, one at a time, runs the suite against the damaged schema, and reports any rule whose
// removal the tests sleep through.
//
// Three of the mutations below are bugs that were really in the file and really shipped past a
// reading of it — the hold gate that only ran on UPDATE, the roll-up that only looked at the row
// it was handed, the entry that could name two different jobs. They are kept as mutations so the
// tests that caught them cannot quietly stop catching them.
//
// Nothing here writes to schema.sql. Each mutation is a copy in a temporary file, handed to the
// suite through VARMAK_SCHEMA, against a database of its own.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Two files, two suites. A mutation names the file it damages; the suite that is supposed to catch
// it is the one that tests that file.
const FILES = {
  schema: { path: path.join(__dirname, 'schema.sql'), suite: 'test-schema.js', env: 'VARMAK_SCHEMA' },
  auth: { path: path.join(__dirname, 'auth.sql'), suite: 'test-auth.js', env: 'VARMAK_AUTH' },
  api: { path: path.join(__dirname, 'api.sql'), suite: 'test-api.js', env: 'VARMAK_API' },
  // views.sql is exercised over HTTP, because what matters about it is what comes back on the wire.
  views: { path: path.join(__dirname, 'views.sql'), suite: 'test-server.js', env: 'VARMAK_VIEWS' },
  // Not everything that can be wrong is SQL. backup.sh is a file with rules in it too — which of the
  // two dumps it takes, what it filters out of them, what it tells you to restore first — and the
  // suite that can tell is the one that actually restores a backup.
  backup: { path: path.join(__dirname, 'backup.sh'), suite: 'test-restore.js', env: 'VARMAK_BACKUP' },
  // Named so a mutation can say `suite: 'restore'`, and so this run is thrown away if the restore
  // suite itself is edited underneath it. Nothing damages it.
  restore: { path: path.join(__dirname, 'test-restore.js'), suite: 'test-restore.js', env: 'VARMAK_RESTORE' },

  // The shop tablet's half of the offline queue is not SQL either, and the rules in it are as easy to
  // get wrong: which id goes with a retry, whose queue may be flushed, whether a dead signal counts as
  // a refusal. The suite that can tell is the one that drives the screen with the connection cut, and
  // it takes the damaged copy the same way — named in an env var — except that the substitution happens
  // when the browser asks for the file rather than at a psql -f. Nothing is written into the site
  // directory, so an interrupted run cannot leave a damaged page behind for the next person to find.
  queue: {
    path: path.join(__dirname, '..', 'workshop-queue.js'),
    suite: path.join('..', 'tests', 'offline-queue.e2e.js'), env: 'VARMAK_QUEUE'
  },
  apiclient: {
    path: path.join(__dirname, '..', 'workshop-api.js'),
    suite: path.join('..', 'tests', 'offline-queue.e2e.js'), env: 'VARMAK_API_CLIENT'
  },
  hourspage: {
    path: path.join(__dirname, '..', 'hours-mobile.html'),
    suite: path.join('..', 'tests', 'offline-queue.e2e.js'), env: 'VARMAK_HOURS_PAGE'
  },
  // Named so a queue mutation can say `suite: 'queueunit'`: two of the module's promises are made to
  // the module rather than to the screen — one person's queue is never flushed under another's session
  // — and the screen refuses that case before the module is ever asked. Two guards is right, and it
  // means the inner one can only be checked where it is stated.
  queueunit: {
    path: path.join(__dirname, '..', 'tests', 'workshop-queue.test.js'),
    suite: path.join('..', 'tests', 'workshop-queue.test.js'), env: 'VARMAK_QUEUE_TEST'
  },

  // Whether this system can be installed onto a hosted database at all. Four rules in auth.sql exist
  // only for that case and are invisible from this machine, so they are damaged against the suite that
  // installs into a Postgres shaped like a hosted one.
  deploy: {
    path: path.join(__dirname, 'auth.sql'),
    suite: 'test-deploy.js', env: 'VARMAK_AUTH'
  },
  // And the two refusals in the server that keep a wrong deployment from starting. This one needs its
  // mutant written into backend/ rather than into the temporary directory: it is a Node module that
  // requires `pg`, and from /tmp there is no node_modules to resolve it in. The name is distinctive and
  // the run unlinks it, so an interruption leaves a stray file rather than a damaged server.js.
  serverjs: {
    path: path.join(__dirname, 'server.js'),
    suite: 'test-deploy.js', env: 'VARMAK_SERVER', mutantDir: __dirname
  },
  // api.sql against the same suite: it holds the last of the ownership changes, and therefore the
  // revoke that actually decides whether varmak_engine keeps CREATE on public afterwards.
  deployapi: {
    path: path.join(__dirname, 'api.sql'),
    suite: 'test-deploy.js', env: 'VARMAK_API'
  }
};
const source = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, fs.readFileSync(f.path, 'utf8')]));
const base = source.schema;

// The schema is read once, here, and every mutation is a copy of it. Editing schema.sql while this
// is running therefore produces a result about a file that no longer exists: every mutation comes
// back "caught", because the suite is failing on the edit rather than on the mutation. That is a
// green run that means nothing, and it happened — a run reported all 42 caught while every one of
// them was actually failing on an unrelated assertion. So the file is checked again at the end and
// the whole run is thrown away if it moved underneath us.
// Returns the files that moved, so the warning can name them. It said "schema.sql changed" for an
// edit to auth.sql the first time this fired, which is a small thing that would send somebody
// looking in the wrong place.
function filesThatChanged() {
  return Object.entries(FILES)
    .filter(([key, f]) => fs.readFileSync(f.path, 'utf8') !== source[key])
    .map(([key]) => path.basename(FILES[key].path));
}

const MUTATIONS = [
  {
    what: 'the hold gate runs on UPDATE only again',
    from: 'CREATE TRIGGER jobcard_hold_gate_trg BEFORE INSERT OR UPDATE ON jobcard',
    to: 'CREATE TRIGGER jobcard_hold_gate_trg BEFORE UPDATE ON jobcard'
  },
  {
    what: 'the hours roll-up looks only at the row it was handed',
    from: `  FOREACH target IN ARRAY coalesce((
    SELECT array_agg(DISTINCT id) FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.operation_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.operation_id END
    ]) AS id WHERE id IS NOT NULL
  ), ARRAY[]::bigint[]) LOOP`,
    to: '  FOREACH target IN ARRAY ARRAY[COALESCE(NEW.operation_id, OLD.operation_id)] LOOP'
  },
  {
    what: 'nothing checks that an hours entry names one job',
    from: `CREATE TRIGGER hours_entry_one_job_trg BEFORE INSERT OR UPDATE ON hours_entry
  FOR EACH ROW EXECUTE FUNCTION hours_entry_names_one_job();`,
    to: ''
  },
  {
    what: 'the certification refusal goes back to reading wrong',
    from: "'operation % cannot start: the certification for % expired on %'",
    to: "'operation % cannot start: %s certification expired on %'"
  },
  {
    // The gate reading more than it needs from a table the caller may only read part of.
    what: 'the equipment gate reads the whole machine row again',
    // Lives in schema.sql, caught by the auth suite: the refusal only happens for a role that is
    // granted the table column by column, and the schema tests run as the superuser.
    suite: 'auth',
    edits: [
      {
        from: `  machine_status equipment_status;
  machine_name text;
  machine_cert date;`,
        to: '  machine equipment%ROWTYPE;'
      },
      {
        from: `    SELECT status, name, certification_expiry
      INTO machine_status, machine_name, machine_cert
      FROM equipment WHERE id = NEW.equipment_id;`,
        to: '    SELECT * INTO machine FROM equipment WHERE id = NEW.equipment_id;'
      },
      {
        from: `    IF machine_status IN ('out-of-service','under-maintenance','quarantined','retired') THEN
      RAISE EXCEPTION 'operation % cannot start: % is %',
        NEW.description, machine_name, machine_status USING ERRCODE = 'check_violation';
    END IF;
    IF machine_cert IS NOT NULL AND machine_cert < current_date THEN
      RAISE EXCEPTION 'operation % cannot start: the certification for % expired on %',
        NEW.description, machine_name, machine_cert USING ERRCODE = 'check_violation';
    END IF;`,
        to: `    IF machine.status IN ('out-of-service','under-maintenance','quarantined','retired') THEN
      RAISE EXCEPTION 'operation % cannot start: % is %',
        NEW.description, machine.name, machine.status USING ERRCODE = 'check_violation';
    END IF;
    IF machine.certification_expiry IS NOT NULL AND machine.certification_expiry < current_date THEN
      RAISE EXCEPTION 'operation % cannot start: the certification for % expired on %',
        NEW.description, machine.name, machine.certification_expiry USING ERRCODE = 'check_violation';
    END IF;`
      }
    ]
  },
  {
    what: 'the equipment gate stops caring what state the machine is in',
    from: "IF machine_status IN ('out-of-service','under-maintenance','quarantined','retired') THEN",
    to: "IF machine_status IN ('retired') THEN"
  },
  {
    what: 'an operation may start before what it depends on is finished',
    from: "IF parent.status NOT IN ('completed','skipped') THEN",
    to: 'IF false THEN'
  },
  {
    what: 'the stock issue stops locking the row it is about to change',
    from: 'SELECT * INTO item FROM stock_item WHERE id = p_item_id FOR UPDATE;',
    to: 'SELECT * INTO item FROM stock_item WHERE id = p_item_id;'
  },
  {
    // Both, because between them they are what forbids a negative stock — removing only the
    // column check changes nothing observable, which is stated in the schema and tested for.
    what: 'stock is allowed to go below zero',
    from: 'CONSTRAINT reserved_within_stock CHECK (reserved <= stock)',
    to: 'CONSTRAINT reserved_within_stock CHECK (true)'
  },
  {
    what: 'more may be reserved than exists',
    from: 'CONSTRAINT reserved_never_negative CHECK (reserved >= 0)',
    to: 'CONSTRAINT reserved_never_negative CHECK (true)'
  },
  {
    what: 'a hold can be released without written evidence',
    from: "      btrim(coalesce(release_reason,'')) <> '' AND\n",
    to: ''
  },
  {
    what: 'a hold may name a project and a jobcard at once',
    from: 'CONSTRAINT hold_names_one_thing CHECK (',
    to: 'CONSTRAINT hold_names_one_thing CHECK (true OR '
  },
  {
    what: 'the equipment can be assigned twice over',
    from: 'CREATE UNIQUE INDEX equipment_one_live_assignment',
    to: 'CREATE INDEX equipment_one_live_assignment'
  },
  {
    what: 'the activity log becomes editable',
    from: `CREATE TRIGGER activity_no_update BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION activity_is_append_only();`,
    to: ''
  },
  {
    what: 'document numbers go back to counting the rows',
    from: "ref         text NOT NULL UNIQUE DEFAULT next_ref('C-', 'seq_customer'::regclass, 3),",
    to: "ref         text NOT NULL UNIQUE DEFAULT ('C-' || lpad(((SELECT count(*) FROM customer) + 1)::text, 3, '0')),"
  },
  {
    what: 'a password may be stored as itself',
    from: "CHECK (password_hash IS NULL OR password_hash ~ '^\\$2[aby]\\$\\d{2}\\$')",
    to: 'CHECK (true)'
  },
  {
    what: 'an item may have two preferred suppliers',
    from: `CREATE UNIQUE INDEX supplier_item_one_preferred
  ON supplier_item(stock_item_id) WHERE is_preferred;`,
    to: ''
  },
  {
    what: 'the same item may be listed twice against one supplier',
    from: '  UNIQUE (supplier_id, stock_item_id)\n',
    to: ''
  },
  {
    what: 'an order may receive more than it asked for',
    from: 'CONSTRAINT not_more_received_than_ordered CHECK (received_quantity <= quantity)',
    to: 'CONSTRAINT not_more_received_than_ordered CHECK (true)'
  },
  {
    what: 'a rack may be deleted out from under the steel on it',
    from: '  location_id   bigint REFERENCES location(id) ON DELETE RESTRICT,',
    to: '  location_id   bigint REFERENCES location(id) ON DELETE SET NULL,'
  },
  {
    what: 'an offcut may have no size',
    from: 'CONSTRAINT offcut_has_a_size CHECK (length_mm IS NOT NULL OR width_mm IS NOT NULL)',
    to: 'CONSTRAINT offcut_has_a_size CHECK (true)'
  },
  {
    what: 'a barcode may scan to two things, or to nothing',
    from: `  CONSTRAINT barcode_names_one_thing CHECK (
    (stock_item_id IS NOT NULL AND offcut_id IS NULL) OR
    (stock_item_id IS NULL AND offcut_id IS NOT NULL)
  )`,
    to: '  CONSTRAINT barcode_names_one_thing CHECK (true)'
  },
  {
    what: 'a lead may be converted to nobody',
    from: "CONSTRAINT converted_lead_names_the_customer CHECK (status <> 'converted' OR customer_id IS NOT NULL)",
    to: 'CONSTRAINT converted_lead_names_the_customer CHECK (true)'
  },
  {
    what: 'an opportunity may belong to nobody',
    from: 'CONSTRAINT opportunity_names_somebody CHECK (customer_id IS NOT NULL OR lead_id IS NOT NULL)',
    to: 'CONSTRAINT opportunity_names_somebody CHECK (true)'
  },
  {
    what: 'a tender may be submitted on no date',
    from: "CONSTRAINT submitted_tender_has_a_date CHECK (status <> 'submitted' OR submitted_on IS NOT NULL)",
    to: 'CONSTRAINT submitted_tender_has_a_date CHECK (true)'
  },
  {
    what: 'the estimate total stops following its lines',
    from: `CREATE TRIGGER estimate_total_roll_up_trg AFTER INSERT OR UPDATE OR DELETE ON estimate_line
  FOR EACH ROW EXECUTE FUNCTION estimate_total_roll_up();`,
    to: ''
  },
  {
    what: 'the estimate total stops following its margin',
    from: `CREATE TRIGGER estimate_margin_roll_up_trg BEFORE UPDATE OF margin_pct ON estimate
  FOR EACH ROW EXECUTE FUNCTION estimate_margin_roll_up();`,
    to: ''
  },
  {
    what: 'a line total becomes a figure somebody can type',
    from: 'line_total    numeric(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,',
    to: 'line_total    numeric(14,2),'
  },
  {
    what: 'an estimate line may be for no quantity',
    from: '  quantity      numeric(12,3) NOT NULL CHECK (quantity > 0),\n  unit          text NOT NULL DEFAULT \'EA\',',
    to: '  quantity      numeric(12,3) NOT NULL,\n  unit          text NOT NULL DEFAULT \'EA\','
  },
  {
    what: 'a machine event may record a result that means nothing',
    from: "result        text NOT NULL CHECK (result IN ('pass','fail','done','observations')),",
    to: 'result        text NOT NULL,'
  },
  {
    what: 'an NCR may be closed with no root cause and no action',
    from: `  CONSTRAINT closed_ncr_says_what_was_done CHECK (
    status <> 'closed' OR (
      btrim(coalesce(root_cause,'')) <> '' AND
      btrim(coalesce(corrective_action,'')) <> '' AND
      closed_on IS NOT NULL
    )
  )`,
    to: '  CONSTRAINT closed_ncr_says_what_was_done CHECK (true)'
  },
  {
    what: 'a document may be filed against a table that does not exist',
    from: `  entity      text NOT NULL CHECK (entity IN
                ('customer','project','jobcard','operation','equipment','stock_item',
                 'quality_hold','inspection','ncr','supplier','purchase_order','estimate','tender')),`,
    to: '  entity      text NOT NULL,'
  },
  {
    what: 'two documents may claim one file in storage',
    from: 'storage_key text NOT NULL UNIQUE CHECK (btrim(storage_key) <> \'\'),',
    to: 'storage_key text NOT NULL CHECK (btrim(storage_key) <> \'\'),'
  },
  {
    // The whole of the decision to keep certification possible later is that these fields exist.
    what: 'the welder and the filler are not recorded',
    from: '  filler        text,',
    to: ''
  },
  {
    what: 'the material that went into the job is not recorded',
    from: '  material_cert_ref text,',
    to: ''
  },
  {
    // Reading the counter and writing it back is the browser bug, moved into the database. The
    // sleep only widens the window that is already there; the race does not need it to exist.
    what: 'per-group item numbers go back to read-then-write',
    from: `  UPDATE item_group SET next_number = next_number + 1
   WHERE id = p_group_id
   RETURNING next_number - 1, code INTO taken, prefix;`,
    to: `  SELECT next_number, code INTO taken, prefix FROM item_group WHERE id = p_group_id;
  PERFORM pg_sleep(0.05);
  UPDATE item_group SET next_number = taken + 1 WHERE id = p_group_id;`
  },
  {
    what: 'a group may be deleted from under its subgroups',
    from: '  parent_id   bigint REFERENCES item_group(id) ON DELETE RESTRICT,',
    to: '  parent_id   bigint REFERENCES item_group(id) ON DELETE SET NULL,'
  }
,
  {
    what: 'a jobcard may jump to any status it likes',
    from: `CREATE TRIGGER jobcard_status_flow_trg BEFORE UPDATE OF status ON jobcard
  FOR EACH ROW EXECUTE FUNCTION status_flow_gate('jobcard');`,
    to: ''
  },
  {
    what: 'a project may jump to any status it likes',
    from: `CREATE TRIGGER project_status_flow_trg BEFORE UPDATE OF status ON project
  FOR EACH ROW EXECUTE FUNCTION status_flow_gate('project');`,
    to: ''
  },
  {
    // An empty rulebook is the failure mode a transition table has that a CASE statement does not,
    // and it looks like everything working until somebody tries to go backwards.
    what: 'the transition rulebook ships empty',
    from: "-- `closed` on a jobcard and `cancelled` on both are deliberately absent as a from_status",
    to: "DELETE FROM allowed_transition;\n-- `closed` on a jobcard and `cancelled` on both are deliberately absent as a from_status"
  },
  {
    what: 'a locked line may be repriced with nothing written down',
    from: `CREATE TRIGGER estimate_line_reprice_gate_trg BEFORE UPDATE ON estimate_line
  FOR EACH ROW EXECUTE FUNCTION estimate_line_reprice_gate();`,
    to: ''
  },
  {
    what: 'the same reprice reason may be left standing and reused',
    from: `    IF NEW.reprice_reason IS NOT DISTINCT FROM OLD.reprice_reason THEN
      RAISE EXCEPTION 'line "%" was already repriced for that reason: this change needs its own',
        NEW.description USING ERRCODE = 'check_violation';
    END IF;`,
    to: ''
  },
  {
    what: 'a project on hold need not say why',
    from: "CONSTRAINT held_project_says_why CHECK (status <> 'hold' OR btrim(coalesce(hold_reason,'')) <> '')",
    to: 'CONSTRAINT held_project_says_why CHECK (true)'
  },
  {
    what: 'a cancelled project need not say why',
    from: `CONSTRAINT cancelled_project_says_why
    CHECK (status <> 'cancelled' OR btrim(coalesce(cancel_reason,'')) <> '')`,
    to: 'CONSTRAINT cancelled_project_says_why CHECK (true)'
  },
  {
    what: "the project's used hours stop following the entries",
    from: `CREATE TRIGGER project_hours_roll_up_trg AFTER INSERT OR UPDATE OR DELETE ON hours_entry
  FOR EACH ROW EXECUTE FUNCTION project_hours_roll_up();`,
    to: ''
  },
  {
    what: "the project's roll-up looks only at the row it was handed",
    from: `  FOREACH target IN ARRAY coalesce((
    SELECT array_agg(DISTINCT p) FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN (SELECT project_id FROM jobcard WHERE id = OLD.jobcard_id) END,
      CASE WHEN TG_OP <> 'DELETE' THEN (SELECT project_id FROM jobcard WHERE id = NEW.jobcard_id) END
    ]) AS p WHERE p IS NOT NULL
  ), ARRAY[]::bigint[]) LOOP`,
    to: '  FOREACH target IN ARRAY ARRAY[(SELECT project_id FROM jobcard WHERE id = COALESCE(NEW.jobcard_id, OLD.jobcard_id))] LOOP'
  },
  {
    // Hours booked to a job but no particular operation, which is what the phone screen sends.
    what: 'the hours roll-up dies on an entry that names no operation',
    from: `  FOREACH target IN ARRAY coalesce((
    SELECT array_agg(DISTINCT id) FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.operation_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.operation_id END
    ]) AS id WHERE id IS NOT NULL
  ), ARRAY[]::bigint[]) LOOP`,
    to: `  FOREACH target IN ARRAY (
    SELECT array_agg(DISTINCT id) FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.operation_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.operation_id END
    ]) AS id WHERE id IS NOT NULL
  ) LOOP`
  },
  {
    what: 'an offcut can be on the rack and used up at the same time',
    from: "CONSTRAINT consumed_offcut_says_when CHECK ((status = 'consumed') = (consumed_at IS NOT NULL))",
    to: 'CONSTRAINT consumed_offcut_says_when CHECK (true)'
  },
  {
    what: 'an offcut may be in any state at all',
    from: `  status        text NOT NULL DEFAULT 'available'
                CHECK (status IN ('available','reserved','consumed','scrapped')),`,
    to: "  status        text NOT NULL DEFAULT 'available',"
  },
  {
    what: 'a document may be in any state at all',
    from: "  status      text NOT NULL DEFAULT 'current' CHECK (status IN ('draft','current','superseded','expired')),",
    to: "  status      text NOT NULL DEFAULT 'current',"
  },
  {
    what: 'an inspection can be passed on no particular day',
    from: `  CONSTRAINT decided_inspection_has_a_date
    CHECK (result = 'pending' OR actual_date IS NOT NULL),`,
    to: '  CONSTRAINT decided_inspection_has_a_date CHECK (true),'
  },
  {
    what: 'an inspection can re-inspect itself',
    from: '  CHECK (reinspection_of IS DISTINCT FROM id),',
    to: ''
  },
  {
    what: 'a follow-up can be booked against somebody who asked not to be contacted',
    from: `  CONSTRAINT do_not_contact_means_no_follow_up
    CHECK (NOT do_not_contact OR next_follow_up_on IS NULL)`,
    to: '  CONSTRAINT do_not_contact_means_no_follow_up CHECK (true)'
  },
  {
    what: 'a lost enquiry need not record why',
    from: `  CONSTRAINT lost_opportunity_says_why
    CHECK (stage <> 'lost' OR btrim(coalesce(decision_reason,'')) <> '')`,
    to: '  CONSTRAINT lost_opportunity_says_why CHECK (true)'
  },
  {
    what: 'an NCR may be given a disposition that means nothing',
    from: `  disposition   text CHECK (disposition IS NULL OR
                  disposition IN ('rework','repair','use-as-is','scrap','return-to-supplier')),`,
    to: '  disposition   text,'
  },
  {
    // The one that made every plpgsql authorisation guard a no-op for an unauthenticated session.
    what: 'is_admin answers NULL again when nobody is signed in',
    file: 'auth',
    from: "LANGUAGE sql STABLE AS $$ SELECT coalesce(current_app_role() = 'admin', false); $$;",
    to: "LANGUAGE sql STABLE AS $$ SELECT current_app_role() = 'admin'; $$;"
  },
  {
    what: 'may_see_money answers NULL again when nobody is signed in',
    file: 'auth',
    from: "LANGUAGE sql STABLE AS $$ SELECT coalesce(current_app_role() IN ('admin', 'office'), false); $$;",
    to: "LANGUAGE sql STABLE AS $$ SELECT current_app_role() IN ('admin', 'office'); $$;"
  },
  {
    what: 'the bootstrap works more than once',
    file: 'api',
    from: '  IF EXISTS (SELECT 1 FROM app_user) THEN',
    to: '  IF false THEN'
  },
  {
    what: 'a new person arrives with a password somebody else chose',
    file: 'api',
    from: `  INSERT INTO app_user (email, display_name, role)
  VALUES (lower(btrim(p_email)), btrim(p_display_name), p_role)
  RETURNING id INTO made;`,
    to: `  INSERT INTO app_user (email, display_name, role)
  VALUES (lower(btrim(p_email)), btrim(p_display_name), p_role)
  RETURNING id INTO made;
  PERFORM set_password(made, 'welcome to varmak');`
  },
  {
    what: 'anybody may add a person',
    file: 'api',
    from: `  IF NOT is_admin() THEN
    RAISE EXCEPTION 'only an admin adds people' USING ERRCODE = 'insufficient_privilege';
  END IF;`,
    to: ''
  },
  {
    what: 'your own password can be changed without knowing the current one',
    file: 'api',
    from: '  IF stored IS NULL OR crypt(p_current, stored) <> stored THEN',
    to: '  IF false THEN'
  },
  {
    what: 'the last admin can switch themselves off',
    file: 'api',
    from: '  IF NOT p_active AND p_user_id = current_app_user() THEN',
    to: '  IF false THEN'
  },
  {
    what: 'the last admin can take away their own admin',
    file: 'api',
    from: "  IF p_user_id = current_app_user() AND p_role <> 'admin' THEN",
    to: '  IF false THEN'
  },
  {
    what: 'switching somebody off leaves the tablet they are holding signed in',
    file: 'api',
    from: '    UPDATE app_session SET ended_at = now() WHERE user_id = p_user_id AND ended_at IS NULL;',
    to: ''
  },
  // ── views.sql ─────────────────────────────────────────────────────────────────────────────
  {
    // The one that matters: the split between the priceless snapshot and the granted money call is
    // the whole enforcement. Putting a price back into the plain snapshot is the failure.
    what: 'the plain snapshot carries the plate cost again',
    file: 'views',
    from: "        'heat', i.heat_no, 'certificate', i.material_cert_ref, 'status', i.status,",
    to: "        'heat', i.heat_no, 'certificate', i.material_cert_ref, 'status', i.status, 'avgCost', i.avg_cost,"
  },
  {
    what: 'the money call is handed to the floor as well',
    file: 'views',
    from: 'GRANT EXECUTE ON FUNCTION workspace_money() TO varmak_admin, varmak_office;',
    to: 'GRANT EXECUTE ON FUNCTION workspace_money() TO varmak_admin, varmak_office, varmak_workshop;'
  },
  {
    what: 'money crosses the wire as a JSON number again',
    file: 'views',
    from: "        jsonb_build_object('avgCost', i.avg_cost::text, 'lastPrice', i.last_price::text))",
    to: "        jsonb_build_object('avgCost', i.avg_cost, 'lastPrice', i.last_price))"
  },
  {
    what: 'operations stop arriving nested on their jobcard',
    file: 'views',
    from: "        'operations', operations_of(j.id)",
    to: "        'operations', '[]'::jsonb"
  },
  {
    what: 'a jobcard stops naming the project the page filters on',
    file: 'views',
    from: "        'projectNo', (SELECT p.ref FROM project p WHERE p.id = j.project_id),",
    to: "        'projectNo', NULL,"
  },
  // ── auth.sql ──────────────────────────────────────────────────────────────────────────────
  //
  // The first two are the bugs that were really in the file. Both looked right when read.
  {
    // The one that matters most in the whole project: a broad table grant silently including a
    // price column, with a narrower column grant written below it that adds nothing.
    what: 'the workshop is granted the whole store table again, prices included',
    file: 'auth',
    from: `GRANT SELECT ON
  jobcard, operation, equipment_assignment,`,
    to: `GRANT SELECT ON
  stock_item, equipment_event,
  jobcard, operation, equipment_assignment,`
  },
  {
    // The lockout that did nothing because the refusal rolled back the count of it.
    what: 'sign_in raises on a bad secret instead of recording it',
    file: 'auth',
    from: `    PERFORM register_failure(person.id);
    RETURN (NULL, 'that is not a login we recognise')::sign_in_result;`,
    to: `    PERFORM register_failure(person.id);
    RAISE EXCEPTION 'that is not a login we recognise' USING ERRCODE = 'invalid_password';`
  },
  {
    what: 'the hashes are handed back to admin and office by the broad grant',
    file: 'auth',
    from: 'REVOKE ALL ON app_user FROM varmak_admin, varmak_office, varmak_workshop;',
    to: ''
  },
  {
    what: 'row security is enabled but not forced, so the owner is exempt',
    file: 'auth',
    from: "    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);",
    to: ''
  },
  {
    what: 'row security is not switched on at all',
    file: 'auth',
    from: "    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);",
    to: ''
  },
  {
    what: 'the role is taken from what the session claims rather than from the row',
    file: 'auth',
    from: '  SELECT role INTO actual FROM app_user WHERE id = current_app_user() AND is_active;',
    to: "  actual := coalesce(claimed, (SELECT role::text FROM app_user WHERE id = current_app_user()))::user_role;"
  },
  {
    what: 'a switched-off account keeps working',
    file: 'auth',
    from: '  SELECT role INTO actual FROM app_user WHERE id = current_app_user() AND is_active;',
    to: '  SELECT role INTO actual FROM app_user WHERE id = current_app_user();'
  },
  {
    what: 'the lockout threshold is put out of reach',
    file: 'auth',
    from: '  IF attempts >= 5 THEN',
    to: '  IF attempts >= 100000 THEN'
  },
  {
    what: 'a locked login is checked after the secret instead of before',
    file: 'auth',
    from: `  IF person.locked_until IS NOT NULL AND person.locked_until > now() THEN`,
    to: '  IF false THEN'
  },
  {
    what: 'the PINs a stranger tries first are allowed',
    file: 'auth',
    from: '  IF pin_is_too_obvious(p_pin) THEN',
    to: '  IF false THEN'
  },
  {
    what: 'a PIN may be any length',
    file: 'auth',
    from: "  IF p_pin !~ '^\\d{4,8}$' THEN",
    to: '  IF false THEN'
  },
  {
    what: 'a four-character password is accepted',
    file: 'auth',
    from: '  IF p_password IS NULL OR length(p_password) < 12 THEN',
    to: '  IF p_password IS NULL OR length(p_password) < 4 THEN'
  },
  {
    what: 'the shop tablet opens an admin session for an admin',
    file: 'auth',
    from: "  IF p_door = 'pin' AND person.role <> 'workshop' THEN",
    to: '  IF false THEN'
  },
  {
    what: 'an unknown address is refused in different words from a wrong password',
    file: 'auth',
    from: `    PERFORM pg_sleep(0.1);
    RETURN (NULL, 'that is not a login we recognise')::sign_in_result;`,
    to: `    PERFORM pg_sleep(0.1);
    RETURN (NULL, 'there is no account for that address')::sign_in_result;`
  },
  {
    what: 'the shop tablet session lasts a month',
    file: 'auth',
    from: "CASE p_door WHEN 'pin' THEN end_of_shift() ELSE now() + interval '12 hours' END",
    to: "now() + interval '30 days'"
  },
  {
    what: 'a signed-out token still names its owner',
    file: 'auth',
    from: 'WHERE token = p_token AND ended_at IS NULL AND expires_at > now();',
    to: 'WHERE token = p_token;'
  },
  {
    what: 'the workshop may edit stock figures directly, with no movement written',
    file: 'auth',
    from: 'GRANT EXECUTE ON FUNCTION issue_material(bigint, numeric, bigint, text)',
    to: `GRANT UPDATE (stock, reserved) ON stock_item TO varmak_workshop;
CREATE POLICY floor_edits_stock ON stock_item FOR UPDATE USING (is_signed_in()) WITH CHECK (is_signed_in());
GRANT EXECUTE ON FUNCTION issue_material(bigint, numeric, bigint, text)`
  },
  {
    // The hole that was really in the file, and it took two lines to make: an explicit GRANT of
    // issue_stock early on, and a REVOKE further down that only named PUBLIC. Either line on its
    // own is harmless — with no early GRANT, revoking from PUBLIC is enough, and with the roles
    // named in the revoke, the early GRANT is cancelled. Which is why this has to be one mutation
    // making both edits: tried separately, each reported MISSED and the rule looked untestable.
    what: 'the raw issue function is granted early and revoked only from PUBLIC',
    file: 'auth',
    edits: [
      {
        from: 'GRANT EXECUTE ON FUNCTION next_item_number(bigint) TO varmak_admin, varmak_office;',
        to: `GRANT EXECUTE ON FUNCTION next_item_number(bigint) TO varmak_admin, varmak_office;
GRANT EXECUTE ON FUNCTION issue_stock(bigint, numeric, bigint, text, text)
TO varmak_admin, varmak_office, varmak_workshop;`
      },
      {
        from: `REVOKE ALL ON FUNCTION issue_stock(bigint, numeric, bigint, text, text)
FROM PUBLIC, varmak_admin, varmak_office, varmak_workshop;`,
        to: 'REVOKE ALL ON FUNCTION issue_stock(bigint, numeric, bigint, text, text) FROM PUBLIC;'
      }
    ]
  },
  {
    what: 'issuing material does not need a session',
    file: 'auth',
    from: `  IF who IS NULL THEN
    RAISE EXCEPTION 'sign in before taking material off the shelf' USING ERRCODE = 'insufficient_privilege';
  END IF;`,
    to: "  who := coalesce(who, 'unknown');"
  },
  {
    what: 'hours may be booked in anybody name',
    file: 'auth',
    from: 'WITH CHECK (worker = current_app_name());',
    to: 'WITH CHECK (true);'
  },
  {
    what: "another welder may edit your hours",
    file: 'auth',
    from: `  USING (worker = current_app_name() OR may_see_money())
  WITH CHECK (worker = current_app_name() OR may_see_money());`,
    to: '  USING (true) WITH CHECK (true);'
  },
  {
    what: 'the floor may release a quality hold',
    file: 'auth',
    from: 'CREATE POLICY only_the_office_holds ON quality_hold FOR ALL USING (may_see_money()) WITH CHECK (may_see_money());',
    to: `CREATE POLICY only_the_office_holds ON quality_hold FOR ALL USING (is_signed_in()) WITH CHECK (is_signed_in());
GRANT UPDATE ON quality_hold TO varmak_workshop;`
  },
  {
    what: 'everybody signed in may read the whole session table',
    file: 'auth',
    from: 'DROP POLICY signed_in_can_read ON app_session;',
    to: ''
  },
  {
    what: 'a welder may read every row of app_user',
    file: 'auth',
    from: 'USING (id = current_app_user() OR may_see_money());',
    to: 'USING (is_signed_in());'
  },
  {
    what: 'the office may create and promote people',
    file: 'auth',
    from: 'GRANT INSERT, UPDATE, DELETE ON app_user TO varmak_admin;',
    to: 'GRANT INSERT, UPDATE, DELETE ON app_user TO varmak_admin, varmak_office;'
  },
  {
    what: 'anybody may set their own PIN',
    file: 'auth',
    from: 'GRANT EXECUTE ON FUNCTION set_password(bigint, text), set_pin(bigint, text) TO varmak_admin;',
    to: 'GRANT EXECUTE ON FUNCTION set_password(bigint, text), set_pin(bigint, text) TO PUBLIC;'
  },
  {
    what: 'sign-ins are not written to the record',
    file: 'auth',
    from: `  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('app_user', person.id, 'signed in', person.email, p_door::text);`,
    to: ''
  },
  {
    what: 'the connection pool role can read the tables itself',
    file: 'auth',
    from: 'GRANT varmak_admin, varmak_office, varmak_workshop TO varmak_api;',
    to: `GRANT varmak_admin, varmak_office, varmak_workshop TO varmak_api;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO varmak_api;`
  },
  // ── api.sql ───────────────────────────────────────────────────────────────────────────────
  {
    what: 'sending a quotation does not lock its lines',
    file: 'api',
    from: '  UPDATE estimate_line SET locked = true WHERE estimate_id = p_estimate_id;',
    to: ''
  },
  {
    what: 'an estimate with no lines on it can be sent',
    file: 'api',
    from: '  IF lines = 0 THEN',
    to: '  IF false THEN'
  },
  {
    what: 'a draft can be accepted before anybody has seen it',
    file: 'api',
    from: "  IF est.status <> 'sent' THEN",
    to: '  IF false THEN'
  },
  {
    what: 'an expired quotation can still be accepted',
    file: 'api',
    from: '  IF est.valid_until IS NOT NULL AND est.valid_until < current_date THEN',
    to: '  IF false THEN'
  },
  {
    what: 'the quoted hours never reach the project plan',
    file: 'api',
    from: "    FROM estimate_line WHERE estimate_id = p_estimate_id AND kind = 'labour';",
    to: '    FROM estimate_line WHERE false;'
  },
  {
    what: 'accepting a second estimate drags a running project back to approved',
    file: 'api',
    from: "    IF proj.status = 'quotation' THEN",
    to: '    IF true THEN'
  },
  {
    what: 'more can be received than was ordered',
    file: 'api',
    from: '  IF p_quantity > outstanding THEN',
    to: '  IF false THEN'
  },
  {
    what: 'a receipt puts nothing on the shelf',
    file: 'api',
    from: '    UPDATE stock_item SET stock = stock + p_quantity WHERE id = line.stock_item_id;',
    to: ''
  },
  {
    what: 'a receipt writes no movement to explain the stock rise',
    file: 'api',
    from: `    INSERT INTO stock_movement (stock_item_id, kind, quantity, jobcard_id, moved_by, note)
    VALUES (line.stock_item_id, 'receipt', p_quantity, NULL, who,
            coalesce(p_note, 'Received against ' || order_row.ref))
    RETURNING ref INTO movement_ref;`,
    to: ''
  },
  {
    what: 'a service line invents a stock movement anyway',
    file: 'api',
    from: '  IF line.stock_item_id IS NOT NULL THEN',
    to: '  IF true THEN'
  },
  {
    what: 'the order status is not derived from its lines',
    file: 'api',
    from: `      WHEN NOT EXISTS (SELECT 1 FROM purchase_order_line
                        WHERE purchase_order_id = order_row.id AND received_quantity < quantity)
        THEN 'received'`,
    to: "      WHEN true THEN 'received'"
  },
  {
    what: 'goods can be received against a cancelled order',
    file: 'api',
    from: "  IF order_row.status = 'cancelled' THEN",
    to: '  IF false THEN'
  },
  {
    what: 'a lead can be converted twice',
    file: 'api',
    from: "  IF the_lead.status = 'converted' THEN",
    to: '  IF false THEN'
  },
  {
    what: 'a lead marked lost can still be converted',
    file: 'api',
    from: "  IF the_lead.status = 'lost' THEN",
    to: '  IF false THEN'
  },
  {
    what: 'what was known about the lead is not carried to the customer',
    file: 'api',
    from: '  VALUES (the_lead.company, p_org_no, p_vat_no, the_lead.email, the_lead.phone, the_lead.city, \'active\')',
    to: "  VALUES (the_lead.company, p_org_no, p_vat_no, NULL, NULL, NULL, 'active')"
  },
  {
    what: 'the opportunity does not follow the lead to the customer',
    file: 'api',
    from: '  UPDATE opportunity SET customer_id = made.id WHERE lead_id = p_lead_id AND customer_id IS NULL;',
    to: ''
  },
  {
    // The whole of offline replay.
    what: 'the same queued action is done again every time it is replayed',
    file: 'api',
    from: `  INSERT INTO device_event (id, kind, user_id)
  VALUES (p_event_id, p_kind, current_app_user())
  ON CONFLICT (id) DO NOTHING;
  IF FOUND THEN
    RETURN NULL;
  END IF;`,
    to: '  RETURN NULL;'
  },
  {
    what: 'a replay gets a fresh answer instead of the first one',
    file: 'api',
    from: "  SELECT coalesce(result, 'accepted') INTO earlier FROM device_event WHERE id = p_event_id;",
    to: "  earlier := 'accepted';"
  },
  {
    what: 'two flushes arriving together can both decide they are first',
    file: 'api',
    from: '  ON CONFLICT (id) DO NOTHING;',
    to: `  ON CONFLICT (id) DO NOTHING;
  PERFORM pg_sleep(0.2);`
  },
  {
    what: 'hours can be booked in a name the caller passes',
    file: 'api',
    from: '  VALUES (p_jobcard_id, p_operation_id, who, p_hours, coalesce(p_worked_on, current_date), p_note)',
    to: "  VALUES (p_jobcard_id, p_operation_id, coalesce(p_note, who), p_hours, coalesce(p_worked_on, current_date), p_note)"
  },
  {
    // Row-level security refuses this anyway — worker must equal your own name, and a session with
    // no identity has none. What the check adds is the message: somebody at a tablet that quietly
    // lost its session needs to be told to sign in, not shown a policy name. Which is why the test
    // for it asserts the wording; accepting any refusal made this mutation invisible.
    what: 'nothing tells an unsigned session to sign in',
    file: 'api',
    from: `  IF who IS NULL THEN
    RAISE EXCEPTION 'sign in before %', p_doing USING ERRCODE = 'insufficient_privilege';
  END IF;`,
    to: "  who := coalesce(who, 'unknown');"
  },
  {
    // The order of two lines. already_done() records the event against current_app_user(), so
    // claiming the id before checking the session means an unsigned request dies on a not-null
    // violation instead of being told anything useful.
    what: 'the event id is claimed before the session is checked',
    file: 'api',
    edits: [
      {
        from: `  who text := require_session('booking hours');
  seen text := already_done(p_event_id, 'book_hours');`,
        to: `  seen text := already_done(p_event_id, 'book_hours');
  who text := require_session('booking hours');`
      }
    ]
  },
  {
    what: 'the office workflows are handed to the floor as well',
    file: 'api',
    // Anchored on the line that decides who the list is granted to, rather than on the list. Every
    // screen wired to the database adds its workflow to that list, so an anchor quoting it goes stale
    // the next time one is — which is exactly what had happened here, and a stale mutation is a rule
    // nobody is testing while the report says the opposite. The first attempt at re-anchoring added a
    // function to the list instead, which was a no-op: `book_hours` is already granted to the office
    // further down. The rule is the TO, so that is what this damages. It appears once in the file.
    from: `  record_stocktake(bigint, numeric, text)
TO varmak_admin, varmak_office;`,
    to: `  record_stocktake(bigint, numeric, text)
TO varmak_admin, varmak_office, varmak_workshop;`
  },
  {
    what: 'changing the quantity sidesteps the repricing rule',
    from: `  IF OLD.locked AND (NEW.unit_price IS DISTINCT FROM OLD.unit_price
                     OR NEW.quantity IS DISTINCT FROM OLD.quantity) THEN`,
    to: '  IF OLD.locked AND NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN'
  },

  {
    // The list would say "no password" for everybody, which reads as a workshop nobody can get
    // into and is the opposite of the truth — the worst kind of wrong for a screen whose whole job
    // is telling an admin who has access.
    what: 'setting a password does not record that one was set',
    file: 'auth',
    suite: 'api',
    from: `     SET password_hash = crypt(p_password, gen_salt('bf', 10)), password_set_at = now(),`,
    to: `     SET password_hash = crypt(p_password, gen_salt('bf', 10)),`
  },
  {
    // Every row claiming to be you. The access screen hides the buttons that would lock the
    // building from the inside on exactly this field, so a mistake here hides all of them.
    what: 'every row in the people list claims to be the caller',
    file: 'api',
    from: "    'isMe', u.id = current_app_user(),",
    to: "    'isMe', true,"
  },

  {
    // Both of these were real, and both passed two suites: the SQL suite asserts the wording and
    // never goes through HTTP, and the HTTP suite had no case for them. The screen is where it
    // showed — a first-run form answering "that is not yours to do" to the only person who could
    // possibly be using it.
    what: 'the first-run refusal claims to be a privilege error again',
    file: 'api',
    suite: 'views',
    from: `    RAISE EXCEPTION 'this system already has people in it — an admin adds the next one';`,
    to: `    RAISE EXCEPTION 'this system already has people in it — an admin adds the next one'
      USING ERRCODE = 'insufficient_privilege';`
  },
  {
    what: 'a wrong current password comes back as a fault at our end again',
    file: 'api',
    suite: 'views',
    from: `    RAISE EXCEPTION 'that is not your current password';`,
    to: `    RAISE EXCEPTION 'that is not your current password' USING ERRCODE = 'invalid_password';`
  },

  // ── Customers ─────────────────────────────────────────────────────────────────────────────
  {
    // Two rows called Skåne Verkstad AB is one customer to everybody in the building and two to
    // every report, and from then on half the jobs are under one and half the other.
    what: 'the same customer can be typed in twice',
    file: 'api',
    from: `  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'there is already a customer called % — it is %', btrim(p_name), existing;
  END IF;`,
    to: ''
  },
  {
    // The refusal the person reads, rather than the guarantee behind it. Without the count, the
    // unique index fires instead and the answer is "customer_has_one_main_contact" — which is not
    // something to read out to whoever is trying to save the list.
    what: 'two main contacts are left to the index to refuse',
    file: 'api',
    from: `  IF mains > 1 THEN
    RAISE EXCEPTION '% has one main contact, and this list has %', owner, mains;
  END IF;`,
    to: ''
  },
  {
    what: 'an unreachable contact is left to the constraint to refuse',
    file: 'api',
    from: `    IF coalesce(btrim(row_in->>'email'), '') = '' AND coalesce(btrim(row_in->>'phone'), '') = '' THEN
      RAISE EXCEPTION 'give % an email or a telephone number — a contact nobody can reach is not one',
        btrim(row_in->>'name');
    END IF;`,
    to: ''
  },
  // No mutation for "a refused contact list leaves the old one exactly as it was", and that is worth
  // saying rather than leaving as a gap in this list. set_customer_contacts deletes the list and
  // rebuilds it, so the obvious bug is a check that runs after the DELETE — but a refusal inside a
  // plpgsql function rolls the whole statement back, the DELETE with it, and re-raising from an
  // EXCEPTION block rolls back to the block as well. There is no edit to this file that makes the
  // delete stick. The rule is held by the transaction rather than by anything written here, which is
  // the same reason a refused offline replay does not burn its event id. The test stays, because it
  // asserts a property somebody could break by moving this work into the server.
  {
    what: 'a customer may have two main contacts',
    from: `CREATE UNIQUE INDEX customer_has_one_main_contact
  ON customer_contact (customer_id) WHERE is_primary;`,
    to: ''
  },
  {
    what: 'a contact nobody can reach is allowed back in',
    from: `ALTER TABLE customer_contact ADD CONSTRAINT contact_can_be_reached
  CHECK (coalesce(btrim(email), '') <> '' OR coalesce(btrim(phone), '') <> '');`,
    to: ''
  },
  {
    // The bug this column exists because of: the page's label says Preferred Contact and the answer
    // it was given was true.
    what: 'the snapshot hands the preferred-customer flag back as the contact method',
    file: 'views',
    from: `        'preferred', c.preferred_contact, 'notes', c.notes,`,
    to: `        'preferred', c.is_preferred, 'notes', c.notes,`
  },
  {
    // Written as the whole tail of the grant rather than as a comment marker on one line, which was
    // the first attempt: `document, --` comments out the rest of THAT line, and the rest of that line
    // was already empty, so the grant came out identical and the mutation was reported as untested.
    what: 'the floor can no longer read who to ring at the customer',
    file: 'auth',
    from: `  quality_hold, inspection, ncr, hours_entry, stock_movement, document,
  -- A name, a role, an email and a telephone number. Nothing on this table could ever be a price,
  -- which is the test the comment above sets for being in this list — and a welder holding a drawing
  -- that is wrong needs to be able to ring somebody.
  customer_contact
TO varmak_workshop;`,
    to: `  quality_hold, inspection, ncr, hours_entry, stock_movement, document
TO varmak_workshop;`
  },

  // ── Work: projects, jobcards and the steps on them ────────────────────────────────────────
  {
    // A jobcard carrying a different customer from its project makes every report disagree with
    // itself, and nobody would put the two columns side by side to notice.
    what: 'a jobcard is written without taking its customer from the project',
    file: 'api',
    from: `  SELECT customer_id, name INTO owner, project_name FROM project WHERE id = p_project_id;`,
    to: `  SELECT NULL::bigint, name INTO owner, project_name FROM project WHERE id = p_project_id;`
  },
  {
    // The refusal that protects hours already booked, at the layer the person reads.
    what: 'the step list stops checking for hours before it deletes',
    file: 'api',
    from: `    IF doomed.logged_hours > 0 THEN
      RAISE EXCEPTION 'step % (%) has % hours booked on it and cannot be taken off the jobcard',
        doomed.seq, doomed.description, doomed.logged_hours;
    END IF;`,
    to: ''
  },
  {
    // And at the layer that is the guarantee. The workflow's own check is the readable version; this
    // is what stops a plain DELETE doing it, which the office holds the privilege for.
    what: 'a step with hours booked on it can be deleted outright',
    from: `CREATE TRIGGER operation_keeps_the_work_done_on_it_trg BEFORE DELETE ON operation
  FOR EACH ROW EXECUTE FUNCTION operation_keeps_the_work_done_on_it();`,
    to: ''
  },
  {
    what: 'a step that has been started can be deleted outright',
    from: `  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'step % (%) is % and cannot be removed', OLD.seq, OLD.description, OLD.status
      USING ERRCODE = 'foreign_key_violation';
  END IF;`,
    to: ''
  },
  {
    // Re-ordering a list of steps writes seq 1 where seq 2 was while 1 is still 1. Checked
    // statement by statement, that halfway state is refused and the whole re-order is impossible.
    what: 'the one-step-per-place rule is checked before the list is finished',
    from: `  CONSTRAINT operation_one_step_per_place UNIQUE (jobcard_id, seq) DEFERRABLE INITIALLY IMMEDIATE,`,
    to: `  CONSTRAINT operation_one_step_per_place UNIQUE (jobcard_id, seq),`,
    suite: 'api'
  },
  {
    what: 'the step list forgets to defer the check while it renumbers',
    file: 'api',
    from: `  SET CONSTRAINTS operation_one_step_per_place DEFERRED;`,
    to: ''
  },
  {
    what: 'a project can be started for a customer that does not exist',
    file: 'api',
    from: `  IF NOT EXISTS (SELECT 1 FROM customer WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'no such customer, or it is not yours to read'
      USING ERRCODE = 'insufficient_privilege';
  END IF;`,
    to: ''
  },

  {
    // The words nobody uses. 'medium' is what the dropdown writes and this refused it, so every
    // jobcard saved at the middle priority was refused by a constraint the screen could not satisfy.
    what: 'the priority goes back to words the screen never writes',
    from: `  priority      text CHECK (priority IS NULL OR priority IN ('low','medium','high')),`,
    to: `  priority      text CHECK (priority IS NULL OR priority IN ('low','normal','high','urgent')),`
  },
  {
    what: 'the material state goes back to words the screen never writes',
    from: `  material_readiness text CHECK (material_readiness IS NULL OR
                       material_readiness IN ('not-checked','shortage','partial','available')),`,
    to: `  material_readiness text CHECK (material_readiness IS NULL OR
                       material_readiness IN ('none','partial','ready')),`
  },
  {
    // The jobcard-level flag, as opposed to a step being a checkpoint. Dropped from the snapshot, the
    // screen cannot show what it was told and nothing else would notice.
    what: 'the snapshot stops carrying whether a jobcard needs signing off',
    file: 'views',
    from: `        'inspectionRequired', j.inspection_required,`,
    to: ''
  },

  // ── The store ─────────────────────────────────────────────────────────────────────────────
  {
    // The difference between a store that can cost a job and one that can only say what the last load
    // cost. Fifty kilos at 14.00 plus fifty at 16.00 is a hundred at 15.00, and every job costed after
    // this mutation would be costed at the most recent invoice price instead.
    what: 'the average cost is replaced by the last price paid instead of weighted',
    file: 'api',
    from: `    avg_cost = CASE
      WHEN p_unit_price IS NULL THEN item.avg_cost
      WHEN coalesce(item.avg_cost, 0) = 0 OR item.stock <= 0 THEN p_unit_price
      ELSE round(((item.stock * item.avg_cost) + (p_quantity * p_unit_price))
                 / (item.stock + p_quantity), 2)
    END,`,
    to: `    avg_cost = coalesce(p_unit_price, item.avg_cost),`
  },
  {
    // A delivery note with no price on it, dragging the average to nothing.
    what: 'a receipt with no price on it sets the average cost to nothing',
    file: 'api',
    from: `      WHEN p_unit_price IS NULL THEN item.avg_cost`,
    to: `      WHEN p_unit_price IS NULL THEN 0`
  },
  {
    what: 'a count that finds the shelf right still writes a movement',
    file: 'api',
    from: `  IF difference = 0 THEN
    -- Counted and found right. Nothing to correct, and a movement of nothing would be noise in the
    -- one place a storeman goes to find out why a figure changed.
    RETURN NULL;
  END IF;`,
    to: ''
  },
  {
    what: 'the same item code can be used twice in the store',
    file: 'api',
    from: `  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'there is already an item coded % — it is %', upper(btrim(p_code)), existing;
  END IF;`,
    to: ''
  },
  {
    // The panel whose whole job is explaining why a figure changed, going quiet.
    what: 'the snapshot stops carrying the stock movements',
    file: 'views',
    from: `    'movements', coalesce((SELECT jsonb_agg(jsonb_build_object(`,
    to: `    'movements', coalesce((SELECT NULL::jsonb FROM (SELECT jsonb_build_object(`
  },

  // ── backup.sh, and the restore suite ──────────────────────────────────────────────────────
  //
  // test-restore.js is the one suite that can be green while proving nothing: it takes a backup,
  // restores it, and says it did. If the comparison stopped comparing, or the copy stopped being
  // asked whether it still refuses, every line would still read OK. So the backup gets its bugs put
  // back too, starting with the one anybody would make: thinking one dump is a backup.
  {
    what: 'the backup takes the data and leaves the roles behind',
    file: 'backup',
    edits: [
      {
        from: 'pg_dumpall -h "$HOST" -p "$PORT" -U "$USER" --roles-only --no-role-passwords \\\n  | grep -E \'varmak_|^--|^$\' > "$ROLES"',
        to: ':'
      },
      { from: 'echo "Roles: $ROLES  ($(wc -l < "$ROLES" | tr -d \' \') lines)"', to: ':' }
    ]
  },
  {
    what: 'the roles file is written with the roles filtered out of it',
    file: 'backup',
    from: "  | grep -E 'varmak_|^--|^$' > \"$ROLES\"",
    to: "  | grep -E '^--|^$' > \"$ROLES\""
  },
  {
    // A backup that carries the API role's password hash is a backup that hands over the database
    // to whoever finds the file — a tape in a drawer, a bucket somebody made public.
    what: 'the password hashes are carried off the server in the backup',
    file: 'backup',
    from: 'pg_dumpall -h "$HOST" -p "$PORT" -U "$USER" --roles-only --no-role-passwords',
    to: 'pg_dumpall -h "$HOST" -p "$PORT" -U "$USER" --roles-only'
  },
  {
    what: 'the backup no longer says which of its two files goes back first',
    file: 'backup',
    from: 'echo "The roles file goes FIRST. Without it the data restores and every GRANT in it fails,"',
    to: ':'
  },
  {
    // The mutation that asks whether the comparison compares anything. A structure-only dump
    // restores cleanly, opens cleanly, and has not one record in it.
    what: 'only the structure is backed up, not the records',
    file: 'backup',
    from: 'pg_dump -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" --format=custom --file="$DATA"',
    to: 'pg_dump -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" --schema-only --format=custom --file="$DATA"'
  },
  {
    // And whether the copy is really asked to refuse. The same trigger removal the schema suite
    // catches, put to the restored database instead: a dump that brings back the data and loses a
    // trigger is worse than no backup, because nothing looks wrong until somebody ships held work.
    what: 'a restored copy is not checked for the rules it should have brought with it',
    suite: 'restore',
    from: `CREATE TRIGGER jobcard_hold_gate_trg BEFORE INSERT OR UPDATE ON jobcard
  FOR EACH ROW EXECUTE FUNCTION jobcard_hold_gate();`,
    to: ''
  },
  {
    // The other half of what a restore has to bring back, and the half the roles file exists for.
    what: 'a restored copy is not checked for who may read the prices in it',
    file: 'auth',
    suite: 'restore',
    from: `GRANT SELECT ON
  jobcard, operation, equipment_assignment,`,
    to: `GRANT SELECT ON
  stock_item, equipment_event,
  jobcard, operation, equipment_assignment,`
  },

  // ── The shop tablet, with the connection cut ──────────────────────────────────────────────
  //
  // Not SQL, and the rules in it are as easy to get wrong: which id goes with a retry, whose queue may
  // be flushed, whether a dead signal is a refusal. Caught by the suite that drives the screen with
  // the connection cut, because none of it is visible to a suite that calls the functions directly.
  {
    // The rule the whole queue is built on: the id is generated once and never again. A retry with a
    // fresh id is a second entry for the same press, which is the failure nobody can see by looking.
    what: 'a retry makes a new id instead of sending the one it was given',
    file: 'queue',
    from: 'const answer = await send(entry.call, Object.assign({}, entry.args, { event_id: entry.id }));',
    to: 'const answer = await send(entry.call, Object.assign({}, entry.args, { event_id: newId() }));'
  },
  {
    what: 'a dead signal is treated as a refusal, so the entry leaves the queue',
    file: 'queue',
    from: '      if (answer && answer.offline) {',
    to: '      if (false && answer && answer.offline) {'
  },
  {
    what: 'the queue is flushed under whichever session happens to be signed in',
    file: 'queue',
    // Asked of the unit tests, not the screen: hours-mobile refuses to flush a queue it does not own
    // before the module is reached, so with the screen driving it this edit changes nothing anybody
    // can see. That is two guards where one would do, and the inner one is stated here.
    suite: 'queueunit',
    from: `    if (String(state.owner || '') !== String(owner || '')) {
      return { sent: 0, refused: 0, left: state.waiting.length, notYours: true };
    }`,
    to: ''
  },
  {
    what: 'claiming a queue adopts the work left in it by whoever had the tablet before',
    file: 'queue',
    from: '    if (state.waiting.length || state.refused.length) {',
    to: '    if (false) {'
  },
  {
    what: 'an entry is held in memory rather than written down before anything is sent',
    file: 'queue',
    from: `    write(next);
    return entry;`,
    to: '    return entry;'
  },
  {
    // Before this, a lost connection threw out of the click handler and the welder was left looking
    // at a button that did nothing and said nothing.
    what: 'a lost connection throws out of the API client instead of being answered',
    file: 'apiclient',
    from: `    if (unreachable(result)) return { ok: false, offline: true, refused: 'no connection to the workshop' };
    if (result.status === 401) return { ok: false, signedOut: true, refused: 'sign in again' };
    return { ok: false, refused: result.body.refused || 'that did not go through' };`,
    to: `    if (result.status === 401) return { ok: false, signedOut: true, refused: 'sign in again' };
    return { ok: false, refused: result.body.refused || 'that did not go through' };`
  },
  {
    what: 'a tablet that cannot read the workshop books onto this browser\'s own records instead',
    file: 'hourspage',
    from: `    if(window.WorkshopApi&&WorkshopApi.signedIn()){
      wAlert(T[current].q_noread);
      return false;
    }`,
    to: ''
  },
  {
    what: 'the press is sent before it is written down, so a failure mid-send loses it',
    file: 'hourspage',
    from: `      const queued=WorkshopQueue.add(me,'book_hours',args,label);
      await flushQueue();`,
    to: `      const queued={id:WorkshopQueue.newId()};
      await WorkshopApi.call('book_hours',Object.assign({},args,{event_id:queued.id}));`
  },

  // ── Installing onto a hosted database ─────────────────────────────────────────────────────
  //
  // Four rules that exist only for a database this machine is not, damaged against the suite that
  // installs into one shaped like it. Every one of these is a bug that really was here and really
  // stopped the install dead — they are kept so the suite that caught them cannot stop catching them.
  {
    what: 'NOSUPERUSER goes back on the role attributes, which only a superuser may say',
    file: 'deploy',
    from: 'ALTER ROLE varmak_admin NOLOGIN NOBYPASSRLS;',
    to: 'ALTER ROLE varmak_admin NOLOGIN NOBYPASSRLS NOSUPERUSER;'
  },
  {
    what: 'nothing puts pgcrypto\'s own schema on the search path',
    file: 'deploy',
    from: '  PERFORM set_config(\'search_path\', format(\'public, %I\', home), false);',
    to: ''
  },
  {
    what: 'the incoming owner of a function is not given CREATE on the schema',
    file: 'deploy',
    from: 'GRANT CREATE ON SCHEMA public TO varmak_engine;\n\nALTER FUNCTION sign_in(text, text, session_door, text) OWNER TO varmak_engine;',
    to: 'ALTER FUNCTION sign_in(text, text, session_door, text) OWNER TO varmak_engine;'
  },
  {
    // Damaged in api.sql rather than in auth.sql, and the reason is worth keeping: both files grant
    // CREATE and both take it back, so removing auth.sql's revoke changes nothing that can be seen —
    // api.sql's, being the last, decides what the role is left holding. Belt and braces again, and
    // again it means the mutation has to be asked where the answer actually comes from.
    what: 'the CREATE on public granted for the ownership changes is never given back',
    file: 'deployapi',
    from: `
-- The last ownership change in the system, so the privilege goes back now.
REVOKE CREATE ON SCHEMA public FROM varmak_engine;`,
    to: ''
  },
  {
    what: 'whoever installs cannot become varmak_engine, so it owns none of the functions',
    file: 'deploy',
    from: `DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('GRANT varmak_engine TO %I', current_user);
  END IF;
END;
$$;`,
    to: ''
  },
  {
    what: 'varmak_engine is left without USAGE on the schema pgcrypto is in, unchecked',
    file: 'deploy',
    from: `  IF NOT has_schema_privilege('varmak_engine', home, 'USAGE') THEN`,
    to: '  IF false THEN'
  },
  {
    // Two deployments that look exactly like a working one.
    what: 'a database over the network with no password is allowed to start',
    file: 'serverjs',
    from: `  if (!local && !password) {
    return \`the database is at \${host} over the network and no password is set. \`
      + 'Set DATABASE_URL (or PGPASSWORD) — a database reachable without one is a database anyone '
      + 'who can reach that host can open.';
  }`,
    to: ''
  },
  {
    what: 'connecting as the database owner is allowed, so every policy applies to nobody',
    file: 'serverjs',
    from: `  if (user && user !== 'varmak_api' && !process.env.VARMAK_ALLOW_ANY_DB_USER) {`,
    to: '  if (false) {'
  },
  {
    // The subtlest of the lot: the connection is still encrypted, so nothing looks wrong.
    what: 'sslmode from the connection string is left in, replacing the certificate check',
    file: 'serverjs',
    from: `  const parsed = new URL(url);
  parsed.searchParams.delete('sslmode');
  parsed.searchParams.delete('ssl');
  return { connectionString: parsed.toString(), ssl, max };`,
    to: '  return { connectionString: url, ssl, max };'
  },
  {
    what: 'HSTS is sent over plain HTTP as well, telling a browser to refuse the address that works',
    file: 'serverjs',
    from: "  if (proto === 'https') headers['strict-transport-security'] = 'max-age=31536000';",
    to: "  headers['strict-transport-security'] = 'max-age=31536000';"
  }
];

// A single mutation can be run on its own by passing part of its description, which is how you
// check one rule without waiting for all of them.
// Part of a description picks one rule; "file:auth" or "file:schema" picks everything in one file.
const only = process.argv.slice(2).join(' ').toLowerCase();
const SELECTED = !only ? MUTATIONS
  : only.startsWith('file:')
    ? MUTATIONS.filter((m) => (m.file || 'schema') === only.slice(5))
    : MUTATIONS.filter((m) => m.what.toLowerCase().includes(only));

// `which` is the file being damaged; `suite` is the file that runs. Usually the same, but not
// always: a rule can live in schema.sql and only be catchable by the auth suite, because catching it
// needs a real role rather than the superuser the schema tests run as. That was true the first time
// it came up — a safety trigger reading more of a table than the caller may read — and tying the
// suite to the file reported the rule as untested when it was simply being asked in the wrong place.
function runSuiteAgainst(damaged, which, index, suite) {
  const target = { ...FILES[which], ...(suite ? { suite: FILES[suite].suite } : {}) };
  const file = path.join(FILES[which].mutantDir || os.tmpdir(),
    `varmak-mutant-${index}${path.extname(FILES[which].path)}`);
  fs.writeFileSync(file, damaged);
  try {
    execFileSync('node', [path.join(__dirname, target.suite)], {
      env: {
        ...process.env,
        [target.env]: file,
        VARMAK_TEST_DB: `varmak_mutant_${index}`
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { caught: false };
  } catch (error) {
    // The reason the suite gave, which is only useful if it is the line that FAILED. An earlier
    // version matched on "can read" among others and happily reported a passing `OK` line as the
    // reason a mutation was caught — a report that reads as though it knows something it does not.
    const output = `${error.stdout || ''}${error.stderr || ''}`;
    const line = output.split('\n')
      .filter((l) => !/^OK\s/.test(l.trim()))
      .reverse()
      .find((l) => /the database ACCEPTED|ALLOWED —|should have been|refused, but|must |cannot |can read these|did not come back|did not survive|has to |ERROR:|AssertionError/.test(l));
    return { caught: true, by: (line || '').trim().slice(0, 130) };
  } finally {
    fs.unlinkSync(file);
  }
}

function main() {
  const missed = [];
  if (only && !SELECTED.length) {
    console.error(`No mutation matches "${only}".`);
    process.exitCode = 1;
    return;
  }
  SELECTED.forEach((mutation, index) => {
    const which = mutation.file || 'schema';
    const original = source[which];
    // A mutation is one edit, or several applied together. Several matters: a hole can need two
    // lines to be wrong at once, and then neither line alone changes anything a test can see — so
    // a one-edit harness reports it as untested in both directions and the rule looks untestable
    // when it is only being asked about wrongly.
    const edits = mutation.edits || [{ from: mutation.from, to: mutation.to }];
    const absent = edits.filter((e) => !original.includes(e.from));
    if (absent.length) {
      console.log(`?    ${mutation.what} — the rule this mutation edits is no longer in ${which}.sql`);
      missed.push(mutation.what);
      return;
    }
    const damaged = edits.reduce((text, e) => text.replace(e.from, e.to), original);
    const result = runSuiteAgainst(damaged, which, index, mutation.suite);
    if (result.caught) {
      console.log(`caught   ${mutation.what}`);
      if (result.by) console.log(`         └ ${result.by}`);
    } else {
      console.log(`MISSED   ${mutation.what}`);
      missed.push(mutation.what);
    }
  });

  console.log();
  const moved = filesThatChanged();
  if (moved.length) {
    console.error(`${moved.join(' and ')} changed while this was running, so every result above is about`);
    console.error('a file that no longer exists — those failures may be the edit rather than the');
    console.error('mutation. Nothing above can be trusted. Run it again as the files now stand.');
    process.exitCode = 1;
    return;
  }
  if (missed.length) {
    console.error(`${missed.length} of ${SELECTED.length} mutations went unnoticed — these rules are not actually tested:`);
    missed.forEach((what) => console.error(`  ${what}`));
    process.exitCode = 1;
    return;
  }
  console.log(`All ${SELECTED.length} mutations were caught: every rule these mutations touch has a test that fails without it.`);
}

main();
