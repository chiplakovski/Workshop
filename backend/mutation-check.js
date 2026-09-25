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
  // Named so a mutation can say `suite: 'documents'`. The document register's rules are asserted through
  // its own screen — what is expiring, what supersedes what, and a welder reading it without losing the
  // whole snapshot — and none of that is in test-server.js. The path and env are unused for this entry: a
  // mutation names it only to redirect which suite runs.
  documents: {
    path: path.join(__dirname, 'schema.sql'),
    suite: path.join('..', 'tests', 'documents-server.e2e.js'), env: 'VARMAK_SCHEMA'
  },

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
  },
  // auth.sql against the suite that loads the workflows as well. Some of what auth.sql grants exists
  // only so a workflow can run — varmak_engine's INSERT on quality_hold is there for the one function
  // that holds work behind a critical failed inspection, and test-auth.js never loads api.sql, so
  // taking that grant away is invisible to it. The suite that can tell is the one that calls the
  // function.
  authapi: {
    path: path.join(__dirname, 'auth.sql'),
    suite: 'test-api.js', env: 'VARMAK_AUTH'
  },
  // The quality register's translation between the screen's words and the database's. Two of its
  // promises are made in JavaScript and nowhere else: an unanswered checklist line stays unanswered,
  // and the screen's marker for a measured row is never sent as a verdict.
  qualityrecord: {
    path: path.join(__dirname, '..', 'quality-record.js'),
    suite: path.join('..', 'tests', 'quality-record.test.js'), env: 'VARMAK_QUALITY_RECORD'
  },
  // And the supplier register's, whose own promises are the payment terms in words, a rating that can be
  // absent, and the six figures it refuses to save.
  supplierrecord: {
    path: path.join(__dirname, '..', 'supplier-record.js'),
    suite: path.join('..', 'tests', 'supplier-record.test.js'), env: 'VARMAK_SUPPLIER_RECORD'
  },
  // And the pipeline's, whose own promises are the ids as numbers (the board puts them in its markup and
  // compares with ===), the tender naming itself from what was typed, and a follow-up never sent for
  // somebody who has asked not to be contacted.
  marketingrecord: {
    path: path.join(__dirname, '..', 'marketing-record.js'),
    suite: path.join('..', 'tests', 'marketing-record.test.js'), env: 'VARMAK_MARKETING_RECORD'
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
        from: `      RAISE EXCEPTION 'operation % cannot start: % is %',
        NEW.description, machine_name, machine_status USING ERRCODE = 'check_violation';
    END IF;
    IF machine_cert IS NOT NULL AND machine_cert < current_date THEN
      RAISE EXCEPTION 'operation % cannot start: the certification for % expired on %',
        NEW.description, machine_name, machine_cert USING ERRCODE = 'check_violation';
    END IF;`,
        // The three reads, put back as reads of the whole row. The status list itself is left alone and
        // anchored elsewhere — quoting it here made this mutation go stale the moment the vocabulary
        // changed, and this edit is about the row, not about which states block.
        to: `      RAISE EXCEPTION 'operation % cannot start: % is %',
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
    from: `IF machine_status IN ('Out of Service', 'Under Maintenance', 'Maintenance Due',
                          'Inspection Required', 'Quarantined', 'Retired') THEN`,
    to: "IF machine_status IN ('Retired') THEN"
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
  // The mutation for submitted_tender_has_a_date used to be here and anchored on the one-line version of
  // that constraint. It is now 'a tender can be recorded as awarded having apparently never been sent',
  // further down, which anchors on the rule as it stands — awarded and declined both mean it went in.
  // Two anchors for one rule would be one anchor going quietly stale, which is what happened to this one.
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
    // Re-anchored, and the rule it guards changed with it. This used to read root_cause and
    // corrective_action, which is what closed_ncr_says_what_was_done demanded — and no screen in this
    // system can fill either, so the constraint could not have been satisfied by anything a person
    // does. It now demands what the closure screen actually collects. A stale anchor is a rule nobody
    // is testing while the report says otherwise, which is why the harness reports one rather than
    // skipping it.
    what: 'an NCR may be closed with nothing written down at all',
    from: `  CONSTRAINT closed_ncr_says_what_was_done CHECK (
    status <> 'closed' OR (
      btrim(coalesce(verification_result,'')) <> '' AND
      btrim(coalesce(closure_approval,'')) <> '' AND
      closed_on IS NOT NULL
    )
  )`,
    to: '  CONSTRAINT closed_ncr_says_what_was_done CHECK (true)'
  },
  {
    // The third time a list in the snapshot has closed the door on the floor. Replaced with the inline read
    // it used to be: a welder holds nothing on purchase_order, so one certificate filed against one order
    // refuses them the WHOLE workshop, on every screen, failing closed so it reads as a permissions success.
    what: 'the document list reads an office-only table and refuses the floor the whole snapshot',
    from: "        'record', document_record_label(d.entity, d.entity_id),",
    to: "        'record', (SELECT x.ref FROM purchase_order x WHERE x.id = d.entity_id),",
    file: 'views',
    suite: 'documents'
  },
  {
    // And the other half of it: the function running as the caller rather than the engine is the same
    // failure with a longer path to it.
    what: 'the document label lookup stops running as the engine',
    from: 'CREATE FUNCTION document_record_label(p_entity text, p_entity_id bigint) RETURNS text\nLANGUAGE sql STABLE SECURITY DEFINER AS $$',
    to: 'CREATE FUNCTION document_record_label(p_entity text, p_entity_id bigint) RETURNS text\nLANGUAGE sql STABLE AS $$',
    file: 'views',
    suite: 'documents'
  },
  {
    what: 'a document may be filed against a reference nothing answers to',
    from: `  IF entity_id IS NULL THEN
    RAISE EXCEPTION 'nothing in % is called %', p_module, said USING ERRCODE = 'foreign_key_violation';
  END IF;`,
    to: '  NULL;',
    file: 'api',
    suite: 'documents'
  },
  {
    what: 'a document register accepts a module that is not a module',
    from: `    ELSE
      RAISE EXCEPTION 'there is no module called %', p_module USING ERRCODE = 'check_violation';
  END CASE;`,
    to: `    ELSE
      NULL;
  END CASE;`,
    file: 'api',
    suite: 'documents'
  },
  {
    what: 'a document can be superseded twice, losing what replaced it the first time',
    from: `  IF old.status = 'superseded' THEN
    RAISE EXCEPTION '% is already superseded', old.title USING ERRCODE = 'check_violation';
  END IF;`,
    to: '  NULL;',
    file: 'api',
    suite: 'documents'
  },
  {
    what: 'a document can supersede itself',
    from: `  IF p_by_id = p_id THEN
    RAISE EXCEPTION 'a document cannot supersede itself' USING ERRCODE = 'check_violation';
  END IF;`,
    to: '  NULL;',
    file: 'api',
    suite: 'documents'
  },
  {
    // The author is whoever filed it unless somebody says otherwise. Written this way because the form
    // has no author field at all: a save that sent an empty one would take the name off a drawing every
    // time somebody corrected its category.
    what: 'correcting a document clears whoever was named as its author',
    from: '      author = coalesce(nullif(btrim(coalesce(p_author,\'\')), \'\'), author),',
    to: '      author = nullif(btrim(coalesce(p_author,\'\')), \'\'),',
    file: 'api',
    suite: 'documents'
  },
  {
    // Re-anchored when the register was wired. The column stopped being NOT NULL — a document filed
    // against nothing yet is a state the screen has a word for — and the list of tables moved inside the
    // nullable check. Anchored on the list itself, which is the rule, rather than on the line.
    what: 'a document may be filed against a table that does not exist',
    from: `  entity      text CHECK (entity IS NULL OR entity IN
                ('customer','project','jobcard','operation','equipment','stock_item',
                 'quality_hold','inspection','ncr','supplier','purchase_order','estimate','tender')),`,
    to: '  entity      text,'
  },
  {
    what: 'two documents may claim one file in storage',
    from: "  storage_key text UNIQUE CHECK (storage_key IS NULL OR btrim(storage_key) <> ''),",
    to: "  storage_key text CHECK (storage_key IS NULL OR btrim(storage_key) <> ''),"
  },
  {
    // The two halves that are all-or-nothing. Both were NOT NULL before the register was wired, which is
    // the whole reason the table went unused: there is no object storage, so no entry could be made at all.
    what: 'half a link — a table with no record, or a record with no table',
    from: '  CONSTRAINT a_link_names_both_halves CHECK ((entity IS NULL) = (entity_id IS NULL)),',
    to: '  CONSTRAINT a_link_names_both_halves CHECK (true),'
  },
  {
    what: 'a filename with nowhere to be stored, or a stored file nothing can name',
    from: '  CONSTRAINT a_stored_file_has_a_key CHECK ((storage_key IS NULL) = (filename IS NULL)),',
    to: '  CONSTRAINT a_stored_file_has_a_key CHECK (true),'
  },
  {
    // Anchored with the line below it, because `title text NOT NULL CHECK (btrim(title) <> ''),` appears
    // character for character in three tables and String.replace takes the first.
    what: 'a document nobody can find by name',
    from: `  title       text NOT NULL CHECK (btrim(title) <> ''),
  kind        text NOT NULL CHECK (kind IN`,
    to: `  title       text,
  kind        text NOT NULL CHECK (kind IN`
  },
  {
    what: 'a kind of document no screen offers',
    from: `  kind        text NOT NULL CHECK (kind IN
                ('Document', 'Certificate', 'Drawing', 'Report', 'Template', 'Image')),`,
    to: '  kind        text NOT NULL,'
  },
  {
    // A template does not expire. The rule is small and the reason it is here is that an expiry on a
    // template is a review date nobody will ever act on, sitting in the list of things running out.
    what: 'a template can be given an expiry date',
    from: `  CONSTRAINT only_a_dated_document_expires CHECK (
    expires_on IS NULL OR kind IN ('Certificate', 'Drawing', 'Report', 'Document'))`,
    to: '  CONSTRAINT only_a_dated_document_expires CHECK (true)'
  },
  {
    // The whole of the decision to keep certification possible later is that these fields exist.
    what: 'the welder and the filler are not recorded',
    from: '  filler        text,',
    to: ''
  },
  {
    what: 'the material that went into the job is not recorded',
    // `material_cert_ref text,` is a column on jobcard AND on stock_item, so on its own this anchor edited
    // whichever came first and reported under the other's name. Paired with the heat number beside it,
    // which is what makes it the jobcard's.
    from: '  heat_no       text,\n  material_cert_ref text,',
    to: '  heat_no       text,'
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
    // Re-anchored: the states are an enum now rather than a CHECK, and two of the four words changed. The
    // ones that left are the point — 'current' became 'valid' because that is the screen's word, and
    // 'expired' left altogether because it is an answer to what the date is, worked out on every read. A
    // register whose column says "expired" is a register that was right one morning.
    what: 'a document may be in any state at all, including the two that are really dates',
    from: "CREATE TYPE document_status AS ENUM ('draft', 'valid', 'approved', 'superseded');",
    to: "CREATE DOMAIN document_status AS text;"
  },
  {
    // Re-anchored: the rule gained 'not-applicable' when that result was added to the enum, because an
    // inspection written off as not applicable never happened and has no date to claim.
    what: 'an inspection can be passed on no particular day',
    from: `  CONSTRAINT decided_inspection_has_a_date
    CHECK (result IN ('pending','not-applicable') OR actual_date IS NOT NULL),`,
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
    // Re-anchored: the list is the screen's eight now rather than five, three of which the dropdown
    // offered and the column refused — 'pending' among them, which is what the screen shows while the
    // decision is still being argued about.
    what: 'an NCR may be given a disposition that means nothing',
    from: `  disposition   text CHECK (disposition IS NULL OR
                  disposition IN ('rework','repair','use-as-is','return-to-supplier','scrap',
                                  'replace','reclassify','pending')),`,
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
    // The anchor is the TO alone, on the one line in the file that reads exactly this. Quoting the
    // function above it went stale the moment save_equipment was added to the list, which is the second
    // time this mutation has gone stale for the same reason — a list that grows is not an anchor.
    // Third time this one has gone stale, and the third cause: first the list grew, then it grew again,
    // and this time a section inserted above it added a blank line the anchor was quoting. The rule is the
    // TO and nothing else — one line, appearing exactly once in the file, with no neighbour to drift.
    from: '\nTO varmak_admin, varmak_office;\n',
    to: '\nTO varmak_admin, varmak_office, varmak_workshop;\n'
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
    // Two mutations where there was one, and that is the finding rather than a tidy-up. This rule is written
    // out twice — once in set_customer_contacts and once in set_supplier_contacts — character for character,
    // so a single anchor edited the customer's copy and reported under a name that claimed to cover both.
    // The supplier's copy has never been mutated at all. Each is anchored by the comment line above its own
    // loop, which is the one thing that differs between them: "unique index" against "index".
    what: 'an unreachable CUSTOMER contact is left to the constraint to refuse',
    file: 'api',
    from: `  -- unique index. The index behind it is what makes the rule true; this is what makes it readable.
  FOR row_in IN SELECT * FROM jsonb_array_elements(p_contacts) LOOP
    IF coalesce(btrim(row_in->>'name'), '') = '' THEN
      RAISE EXCEPTION 'a contact needs a name';
    END IF;
    IF coalesce(btrim(row_in->>'email'), '') = '' AND coalesce(btrim(row_in->>'phone'), '') = '' THEN
      RAISE EXCEPTION 'give % an email or a telephone number — a contact nobody can reach is not one',
        btrim(row_in->>'name');
    END IF;`,
    to: `  -- unique index. The index behind it is what makes the rule true; this is what makes it readable.
  FOR row_in IN SELECT * FROM jsonb_array_elements(p_contacts) LOOP
    IF coalesce(btrim(row_in->>'name'), '') = '' THEN
      RAISE EXCEPTION 'a contact needs a name';
    END IF;`
  },
  {
    what: 'an unreachable SUPPLIER contact is left to the constraint to refuse',
    file: 'api',
    from: `  -- index. The index is what makes the rule true; this is what makes it readable.
  FOR row_in IN SELECT * FROM jsonb_array_elements(p_contacts) LOOP
    IF coalesce(btrim(row_in->>'name'), '') = '' THEN
      RAISE EXCEPTION 'a contact needs a name';
    END IF;
    IF coalesce(btrim(row_in->>'email'), '') = '' AND coalesce(btrim(row_in->>'phone'), '') = '' THEN
      RAISE EXCEPTION 'give % an email or a telephone number — a contact nobody can reach is not one',
        btrim(row_in->>'name');
    END IF;`,
    to: `  -- index. The index is what makes the rule true; this is what makes it readable.
  FOR row_in IN SELECT * FROM jsonb_array_elements(p_contacts) LOOP
    IF coalesce(btrim(row_in->>'name'), '') = '' THEN
      RAISE EXCEPTION 'a contact needs a name';
    END IF;`
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

  // ── The machines, and the gate that finally has something to read ─────────────────────────
  {
    // The rule this whole pass exists for. equipment-gates.js has refused this in the browser since it
    // was written, and the browser is not where a safety rule can live.
    what: 'a failed pre-use check no longer stops the work',
    from: `    IF EXISTS (SELECT 1 FROM equipment_event
                WHERE equipment_id = NEW.equipment_id
                  AND kind = 'pre-use-check' AND result = 'fail' AND NOT resolved) THEN`,
    to: '    IF false THEN'
  },
  {
    what: 'a failed check stops the work even after it has been answered',
    from: "                  AND kind = 'pre-use-check' AND result = 'fail' AND NOT resolved) THEN",
    to: "                  AND kind = 'pre-use-check' AND result = 'fail') THEN"
  },
  {
    what: 'a failed check can be answered by another failed check',
    from: `  CHECK (resolves_event_id IS NULL OR result <> 'fail')`,
    to: '  CHECK (true)'
  },
  {
    what: 'an event can answer one about a different machine',
    from: `  IF NEW.resolves_event_id IS NOT NULL
     AND (SELECT equipment_id FROM equipment_event WHERE id = NEW.resolves_event_id)
         IS DISTINCT FROM NEW.equipment_id THEN`,
    to: '  IF false THEN'
  },
  {
    what: 'a failed inspection counts as the date the machine was last inspected',
    file: 'api',
    from: "  IF p_result IN ('pass', 'done') AND p_kind IN ('service', 'repair', 'inspection', 'calibration') THEN",
    to: "  IF true THEN"
  },
  {
    what: 'a breakdown leaves the machine in service',
    file: 'api',
    from: `  IF p_kind = 'breakdown' THEN
    UPDATE equipment SET status = 'Out of Service' WHERE id = p_equipment_id;
  END IF;`,
    to: ''
  },
  {
    what: 'the event that answers a failure does not mark it answered',
    file: 'api',
    from: `  IF p_resolves_event_id IS NOT NULL THEN
    UPDATE equipment_event SET resolved = true
     WHERE id = p_resolves_event_id AND equipment_id = p_equipment_id;
  END IF;`,
    to: ''
  },
  {
    what: 'a machine can be registered twice under one reference',
    file: 'api',
    from: `  SELECT name INTO existing FROM equipment
   WHERE upper(btrim(ref)) = upper(btrim(p_ref)) AND (p_id IS NULL OR id <> p_id) LIMIT 1;
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'there is already a machine referenced % — it is %', upper(btrim(p_ref)), existing;
  END IF;`,
    to: ''
  },
  {
    what: 'the floor may not answer a failed check after all, so the machine stays stopped',
    file: 'auth',
    from: `CREATE POLICY floor_answers_a_failed_check ON equipment_event FOR UPDATE
  USING (is_signed_in() AND kind = 'pre-use-check' AND result = 'fail')
  WITH CHECK (is_signed_in() AND kind = 'pre-use-check' AND result = 'fail');`,
    to: ''
  },
  {
    what: 'the floor may answer anything on an equipment event, not only a failed check',
    file: 'auth',
    from: `  USING (is_signed_in() AND kind = 'pre-use-check' AND result = 'fail')
  WITH CHECK (is_signed_in() AND kind = 'pre-use-check' AND result = 'fail');`,
    to: `  USING (is_signed_in()) WITH CHECK (is_signed_in());`
  },
  {
    // The narrow grant is what keeps the engine's extra power to two columns.
    what: 'the engine is given the whole equipment table rather than four columns of it',
    file: 'auth',
    // Asked of the api suite, because that is where the list of what varmak_engine may write is written
    // down. The auth suite builds only schema.sql and auth.sql and has no such list.
    suite: 'api',
    from: `GRANT UPDATE (status, last_service_date, last_inspection_date, last_calibration_date)
ON equipment TO varmak_engine;`,
    to: 'GRANT UPDATE ON equipment TO varmak_engine;'
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
  },

  // ── Quality: the register that stops work leaving the building ──────────────────────────────

  {
    what: 'a non-conformance can be closed with nothing verified',
    from: `      btrim(coalesce(verification_result,'')) <> '' AND
      btrim(coalesce(closure_approval,'')) <> '' AND`,
    to: `      btrim(coalesce(closure_approval,'')) <> '' AND`
  },
  {
    what: 'a non-conforming part can be used as it is with nobody signing for it',
    from: `  CONSTRAINT use_as_is_is_signed_for CHECK (
    disposition IS DISTINCT FROM 'use-as-is' OR
    btrim(coalesce(disposition_approval_ref,'')) <> ''
  ),`,
    to: ''
  },
  {
    what: 'a critical non-conformance needs no date by which it is answered',
    from: `  CONSTRAINT serious_ncrs_have_a_date CHECK (severity = 'minor' OR due_on IS NOT NULL)`,
    to: `  CONSTRAINT serious_ncrs_have_a_date CHECK (true)`
  },
  {
    what: 'passed with observations can be recorded with no observation',
    from: `  CONSTRAINT observations_say_what_was_observed CHECK (
    result <> 'passed-observations' OR btrim(coalesce(findings,'')) <> ''
  ),`,
    to: ''
  },
  {
    what: 'an inspection written off as not applicable is made to claim a date it happened on',
    from: `    CHECK (result IN ('pending','not-applicable') OR actual_date IS NOT NULL),`,
    to: `    CHECK (result = 'pending' OR actual_date IS NOT NULL),`
  },
  {
    what: 'the inspection statuses go back to four the screens do not write',
    from: `                CHECK (status IN ('draft','planned','requested','in-progress','completed','cancelled')),`,
    to: `                CHECK (status IN ('requested','scheduled','done','cancelled')),`
  },
  {
    what: 'the non-conformance statuses go back to six, four of which no screen can reach',
    from: `CREATE TYPE ncr_status AS ENUM
  ('draft','open','containment-required','under-investigation','disposition-required',
   'corrective-action','waiting-verification','closed','rejected','reopened');`,
    to: `CREATE TYPE ncr_status AS ENUM
  ('open','investigating','corrective-action','verification','closed','rejected');`
  },
  {
    what: 'a checklist line can carry a nominal with no tolerance to judge it by',
    from: `  CONSTRAINT a_nominal_needs_a_tolerance CHECK (
    nominal IS NULL OR (tol_lower IS NOT NULL AND tol_upper IS NOT NULL)
  ),`,
    to: ''
  },
  {
    what: 'a tolerance band can be upside down, so every measurement against it fails',
    from: `  CONSTRAINT tolerance_band_is_the_right_way_up CHECK (
    tol_lower IS NULL OR tol_upper IS NULL OR tol_upper >= tol_lower
  ),`,
    to: ''
  },
  {
    what: 'the checklist outlives the inspection it is evidence for',
    from: `  inspection_id bigint NOT NULL REFERENCES inspection(id) ON DELETE CASCADE,
  line_no       int NOT NULL CHECK (line_no > 0),`,
    to: `  inspection_id bigint NOT NULL REFERENCES inspection(id),
  line_no       int NOT NULL CHECK (line_no > 0),`
  },
  {
    what: 'two checklist lines can share a line number, so one of them is not there',
    from: `  UNIQUE (inspection_id, line_no)
);

CREATE INDEX inspection_check_idx`,
    to: `  UNIQUE (inspection_id, line_no, item)
);

CREATE INDEX inspection_check_idx`
  },

  // ── Quality: the workflows ─────────────────────────────────────────────────────────────────

  {
    what: 'an ordinary failed inspection puts a hold on as well, so the register fills with noise',
    file: 'api',
    from: `  IF found.id IS NULL OR found.result <> 'failed' OR NOT found.critical THEN
    RETURN NULL;
  END IF;`,
    to: `  IF found.id IS NULL OR found.result <> 'failed' THEN
    RETURN NULL;
  END IF;`
  },
  {
    what: 'a decided inspection can be answered a second time',
    file: 'api',
    from: `  IF found.result <> 'pending' THEN
    RAISE EXCEPTION 'inspection % was already decided as %; a second look is a re-inspection',
      found.ref, found.result USING ERRCODE = 'check_violation';
  END IF;`,
    to: ''
  },
  {
    what: 'the verdict is written before its evidence, which row security then refuses',
    file: 'api',
    edits: [
      { from: `  PERFORM replace_inspection_checks(found.id, p_checks);

  UPDATE inspection SET
    result = p_result, findings = p_findings, critical = coalesce(p_critical, false),`,
        to: `  UPDATE inspection SET
    result = p_result, findings = p_findings, critical = coalesce(p_critical, false),` },
      { from: `    status = CASE WHEN p_result = 'not-applicable' THEN 'cancelled' ELSE 'completed' END
   WHERE id = found.id;`,
        to: `    status = CASE WHEN p_result = 'not-applicable' THEN 'cancelled' ELSE 'completed' END
   WHERE id = found.id;

  PERFORM replace_inspection_checks(found.id, p_checks);` }
    ]
  },
  {
    what: 'a completed inspection keeps the name the request was planned for',
    file: 'api',
    from: `    actual_date = CASE WHEN p_result = 'not-applicable' THEN NULL ELSE on_day END,
    inspector = who,`,
    to: `    actual_date = CASE WHEN p_result = 'not-applicable' THEN NULL ELSE on_day END,`
  },
  {
    what: 'an unanswered checklist line is stored as an empty verdict rather than as unanswered',
    file: 'api',
    from: `         nullif(btrim(coalesce(line->>'result', '')), ''),`,
    to: `         btrim(coalesce(line->>'result', '')),`
  },
  {
    what: 'the standard an inspection was judged against can be edited after the result is in',
    file: 'api',
    from: `    SELECT ref INTO locked FROM inspection WHERE id = p_id AND result <> 'pending';
    IF locked IS NOT NULL THEN
      RAISE EXCEPTION 'inspection % already has a result — raise a re-inspection rather than editing it',
        locked USING ERRCODE = 'check_violation';
    END IF;`,
    to: ''
  },
  {
    what: 'a re-inspection arrives carrying the first inspection’s own answers',
    file: 'api',
    from: `  INSERT INTO inspection_check (inspection_id, line_no, item, nominal, tol_lower, tol_upper)
  SELECT made, line_no, item, nominal, tol_lower, tol_upper
    FROM inspection_check WHERE inspection_id = original.id ORDER BY line_no;`,
    to: `  INSERT INTO inspection_check (inspection_id, line_no, item, nominal, tol_lower, tol_upper,
                               result, actual)
  SELECT made, line_no, item, nominal, tol_lower, tol_upper, result, actual
    FROM inspection_check WHERE inspection_id = original.id ORDER BY line_no;`
  },
  {
    what: 'a hold given both a project and a jobcard claims to hold both',
    file: 'api',
    from: `  IF on_jobcard IS NOT NULL THEN
    on_project := NULL;
  ELSIF on_project IS NULL THEN`,
    to: `  IF on_jobcard IS NOT NULL THEN
    NULL;
  ELSIF on_project IS NULL THEN`
  },
  {
    what: 'the same hold asked for twice becomes two holds, so releasing one leaves the work held',
    file: 'api',
    from: `  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  INSERT INTO quality_hold (scope, project_id, jobcard_id, reason, severity, applied_by,
                            required_action, related_ref)
  VALUES (CASE WHEN on_jobcard IS NOT NULL THEN 'jobcard' ELSE 'project' END::hold_scope,`,
    to: `  INSERT INTO quality_hold (scope, project_id, jobcard_id, reason, severity, applied_by,
                            required_action, related_ref)
  VALUES (CASE WHEN on_jobcard IS NOT NULL THEN 'jobcard' ELSE 'project' END::hold_scope,`
  },
  {
    what: 'a released hold can be released again, restamping it with the second name',
    file: 'api',
    from: `  IF held.status = 'released' THEN
    RAISE EXCEPTION 'hold % has already been released', held.ref USING ERRCODE = 'check_violation';
  END IF;`,
    to: ''
  },
  {
    what: 'a hold comes off with no evidence of what was resolved',
    file: 'api',
    from: `  IF authority = '' OR why = '' THEN
    RAISE EXCEPTION 'releasing a hold takes an authorised approval and written evidence of what was resolved'
      USING ERRCODE = 'check_violation';
  END IF;`,
    to: ''
  },
  {
    what: 'who found a non-conformance comes from the form rather than from the session',
    file: 'api',
    from: `            btrim(p_description), btrim(p_responsible), who, p_due_on, p_operation, p_component,`,
    to: `            btrim(p_description), btrim(p_responsible), 'Aleksandar C.', p_due_on, p_operation, p_component,`
  },
  {
    what: 'a critical non-conformance no longer holds the work it is about',
    file: 'api',
    from: `    IF p_severity = 'critical' THEN
      held := place_hold(p_project_id, p_jobcard_id,`,
    to: `    IF false THEN
      held := place_hold(p_project_id, p_jobcard_id,`
  },
  {
    what: 'a non-conformance closes on an approval with nothing verified behind it',
    file: 'api',
    from: `    IF coalesce(btrim(it.verification_result), '') = '' THEN
      RAISE EXCEPTION 'non-conformance % has nothing verified — closing it would record that the fix worked without anybody checking',
        it.ref USING ERRCODE = 'check_violation';
    END IF;`,
    to: ''
  },
  {
    what: 'a reopened non-conformance keeps its closure, so it reads as approved and open at once',
    file: 'api',
    from: `    UPDATE ncr SET status = moved_to, closure_approval = NULL, closed_on = NULL WHERE id = it.id;`,
    to: `    UPDATE ncr SET status = moved_to WHERE id = it.id;`
  },
  {
    what: 'a closed non-conformance can be edited without reopening it',
    file: 'api',
    from: `     WHERE id = p_id AND status <> 'closed'
    RETURNING id, ref INTO saved, raised;`,
    to: `     WHERE id = p_id
    RETURNING id, ref INTO saved, raised;`
  },
  {
    what: 'a quality note can be written against a record that is not there',
    file: 'api',
    from: `  IF exists_here IS NOT TRUE THEN
    RAISE EXCEPTION 'no such %', p_entity USING ERRCODE = 'foreign_key_violation';
  END IF;`,
    to: ''
  },
  {
    what: 'a hold placed by the system has no history, so the panel that explains it is empty',
    file: 'api',
    from: `  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('quality_hold', held, 'applied', coalesce(found.inspector, 'system'), made || ' — ' || why);`,
    to: ''
  },
  {
    what: 'the hold that follows a critical failure runs as the caller, who cannot write a hold',
    file: 'api',
    from: `ALTER FUNCTION hold_after_failed_inspection(bigint) OWNER TO varmak_engine;`,
    to: ''
  },

  // ── Quality: who may do what ───────────────────────────────────────────────────────────────

  {
    what: 'a welder can turn a failure they signed for into a pass a week later',
    file: 'auth',
    from: `CREATE POLICY floor_records_a_result ON inspection FOR UPDATE
  USING (is_signed_in() AND result = 'pending') WITH CHECK (is_signed_in());`,
    to: `CREATE POLICY floor_records_a_result ON inspection FOR UPDATE
  USING (is_signed_in()) WITH CHECK (is_signed_in());`
  },
  {
    what: 'the floor can move the standard the work was judged against, not only record the verdict',
    file: 'auth',
    from: `GRANT UPDATE (result, findings, critical, actual_date, inspector, status)
ON inspection TO varmak_workshop;`,
    to: `GRANT UPDATE ON inspection TO varmak_workshop;`
  },
  {
    what: 'evidence can be added to an inspection after somebody has signed for its result',
    file: 'auth',
    from: `CREATE POLICY floor_writes_the_checklist ON inspection_check FOR INSERT
  WITH CHECK (is_signed_in() AND EXISTS (
    SELECT 1 FROM inspection i WHERE i.id = inspection_id AND i.result = 'pending'));`,
    to: `CREATE POLICY floor_writes_the_checklist ON inspection_check FOR INSERT
  WITH CHECK (is_signed_in());`
  },
  {
    what: 'the floor can place a hold by hand, which is most of the way to releasing one',
    file: 'auth',
    from: `CREATE POLICY only_the_office_holds ON quality_hold FOR ALL USING (may_see_money()) WITH CHECK (may_see_money());`,
    to: `CREATE POLICY only_the_office_holds ON quality_hold FOR ALL USING (is_signed_in()) WITH CHECK (is_signed_in());
GRANT INSERT ON quality_hold TO varmak_workshop;`
  },
  {
    what: 'the engine cannot write the hold a critical failed inspection is supposed to place',
    file: 'authapi',
    from: `GRANT SELECT, INSERT ON quality_hold TO varmak_engine;`,
    to: ''
  },

  // ── Quality: what reaches the screen ───────────────────────────────────────────────────────

  {
    what: 'the hold register is left out of the snapshot, as it was before this pass',
    file: 'views',
    from: `    'qualityHolds', coalesce((SELECT jsonb_agg(jsonb_build_object(`,
    to: `    'qualityHoldsNotSent', coalesce((SELECT jsonb_agg(jsonb_build_object(`
  },
  {
    what: 'an unanswered checklist line reaches the screen as null, which its dropdown shows as a word',
    file: 'views',
    from: `            'item', c.item, 'resultItem', coalesce(c.result, ''),`,
    to: `            'item', c.item, 'resultItem', c.result,`
  },
  {
    what: 'the inspection type arrives under the column’s name instead of the screen’s',
    file: 'views',
    from: `        'id', i.id::text, 'no', i.ref, 'type', i.kind, 'status', i.status, 'result', i.result,`,
    to: `        'id', i.id::text, 'no', i.ref, 'kind', i.kind, 'status', i.status, 'result', i.result,`
  },
  {
    what: 'the person answerable for a non-conformance arrives under a name no screen reads',
    file: 'views',
    from: `        'responsiblePerson', n.responsible, 'dueDate', n.due_on,`,
    to: `        'responsible', n.responsible, 'dueDate', n.due_on,`
  },
  {
    what: 'a quality record\u2019s whole history travels in every snapshot every screen takes',
    file: 'views',
    from: `     ORDER BY happened_at DESC, id DESC LIMIT 20`,
    to: `     ORDER BY happened_at DESC, id DESC`
  },
  {
    what: 'the merchants are left out, so the non-conformance form cannot name one',
    file: 'views',
    from: `    'suppliers', coalesce((SELECT jsonb_agg(jsonb_build_object(`,
    to: `    'suppliersNotSent', coalesce((SELECT jsonb_agg(jsonb_build_object(`
  },
  // The mutation that used to be here became stale when the supplier list in the snapshot was widened,
  // and the harness said so — "the rule this mutation edits is no longer in views.sql". It is replaced by
  // 'what a merchant charges travels in the list every welder reads', further down, which anchors on the
  // block as it now stands. Two anchors for one rule would be one anchor going quietly stale.

  // ── Quality: the translation in the browser ────────────────────────────────────────────────

  {
    what: 'an unanswered checklist line comes back as null, not as the empty string the page expects',
    file: 'qualityrecord',
    from: `      .map((line) => Object.assign({}, line, { resultItem: line.resultItem || '' }));`,
    to: `      .map((line) => Object.assign({}, line));`
  },
  {
    what: 'the screen’s marker for a measured row is sent as though it were a verdict',
    file: 'qualityrecord',
    from: `      result: VERDICTS.indexOf(verdict) === -1 ? '' : verdict,`,
    to: `      result: verdict === null ? '' : verdict,`
  },
  {
    what: 'the request form can set the result, so work can be passed without being looked at',
    file: 'qualityrecord',
    from: `    'acceptanceCriteria', 'customerWitness', 'materialTraceabilityOk', 'plannedDate', 'inspector',
    'status', 'notes'
  ];`,
    to: `    'acceptanceCriteria', 'customerWitness', 'materialTraceabilityOk', 'plannedDate', 'inspector',
    'status', 'notes', 'result', 'findings', 'critical'
  ];`
  },
  {
    what: 'a line whose name is three spaces is sent as a check of nothing',
    file: 'qualityrecord',
    from: `    const item = said(line && line.item === undefined ? null : String(line.item === null
      || line.item === undefined ? '' : line.item).trim());`,
    to: `    const item = said(line && line.item);`
  },

  // ── Suppliers: the merchants a workshop buys from ───────────────────────────────────────────

  {
    what: 'a merchant can be rated out of more than five, or below nothing',
    from: `  rating      numeric(2,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),`,
    to: `  rating      numeric(2,1),`
  },
  {
    what: 'the supplier statuses go back to two, and the one the register filters by is refused',
    from: `  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','preferred','inactive')),`,
    to: `  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),`
  },
  {
    what: 'a merchant can have two main contacts, so "who do I ring" has two answers',
    from: `CREATE UNIQUE INDEX supplier_has_one_main_contact
  ON supplier_contact (supplier_id) WHERE is_primary;`,
    to: ''
  },
  {
    what: 'a supplier contact nobody can reach is still a contact',
    from: `  CONSTRAINT supplier_contact_can_be_reached
    CHECK (coalesce(btrim(email), '') <> '' OR coalesce(btrim(phone), '') <> '')`,
    to: `  CONSTRAINT supplier_contact_can_be_reached CHECK (true)`
  },
  {
    what: 'a supplier contact outlives the merchant it belongs to',
    from: `  supplier_id bigint NOT NULL REFERENCES supplier(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  role        text,
  email       text,
  phone       text,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_contact_can_be_reached`,
    to: `  supplier_id bigint NOT NULL REFERENCES supplier(id),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  role        text,
  email       text,
  phone       text,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_contact_can_be_reached`
  },
  {
    what: 'two merchants can be recorded under one name',
    file: 'api',
    from: `  SELECT ref INTO existing FROM supplier
   WHERE upper(btrim(name)) = upper(btrim(p_name)) AND (p_id IS NULL OR id <> p_id) LIMIT 1;
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'there is already a supplier called % — it is %', btrim(p_name), existing;
  END IF;`,
    to: ''
  },
  {
    what: 'one name in capitals is treated as a different merchant',
    file: 'api',
    from: `   WHERE upper(btrim(name)) = upper(btrim(p_name)) AND (p_id IS NULL OR id <> p_id) LIMIT 1;`,
    to: `   WHERE btrim(name) = btrim(p_name) AND (p_id IS NULL OR id <> p_id) LIMIT 1;`
  },
  {
    what: 'a rating given to a merchant can never be taken back',
    file: 'api',
    from: `      rating = p_rating, payment_terms_days = p_payment_terms_days, notes = p_notes`,
    to: `      rating = coalesce(p_rating, rating), payment_terms_days = p_payment_terms_days, notes = p_notes`
  },
  {
    what: 'a refused supplier contact list has already deleted the one it was replacing',
    file: 'api',
    edits: [
      { from: `  -- Checked before anything is written, so the refusal is a sentence rather than the name of a unique
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

  DELETE FROM supplier_contact WHERE supplier_id = p_supplier_id;`,
        to: `  DELETE FROM supplier_contact WHERE supplier_id = p_supplier_id;` },
      { from: `    VALUES (p_supplier_id, btrim(row_in->>'name'), nullif(btrim(coalesce(row_in->>'role', '')), ''),`,
        to: `    VALUES (p_supplier_id, coalesce(nullif(btrim(coalesce(row_in->>'name','')),''), 'Somebody'),
            nullif(btrim(coalesce(row_in->>'role', '')), ''),` }
    ]
  },
  {
    what: 'a price can be quoted against a merchant or an item that is not there',
    file: 'api',
    from: `  IF NOT EXISTS (SELECT 1 FROM supplier WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'no such supplier' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_item WHERE id = p_stock_item_id) THEN
    RAISE EXCEPTION 'no such item' USING ERRCODE = 'foreign_key_violation';
  END IF;`,
    to: ''
  },
  {
    what: 'changing which merchant we buy an item from is refused instead of changing it',
    file: 'api',
    from: `  IF coalesce(p_is_preferred, false) THEN
    UPDATE supplier_item SET is_preferred = false
     WHERE stock_item_id = p_stock_item_id AND supplier_id <> p_supplier_id AND is_preferred;
  END IF;`,
    to: ''
  },
  {
    what: 'a second quote from the same merchant becomes a second line rather than a correction',
    file: 'api',
    // Re-anchored twice over. The is_preferred line inside this block was rewritten when a MISSED mutation
    // found that `excluded.is_preferred` could not tell "not preferred" from "nobody said", which left the
    // original anchor stale. The first re-anchor took the ON CONFLICT line alone and left the SET body
    // dangling — so the mutant was a syntax error and the harness recorded the rule as caught, which is the
    // same false pass the $$ bug produced. A mutant has to be VALID and WRONG. This one is both: the whole
    // clause goes, so a second quote from the same merchant is refused by the unique index rather than
    // correcting the first — which is the behaviour before the upsert was written.
    from: `  ON CONFLICT (supplier_id, stock_item_id) DO UPDATE SET
    article_no = excluded.article_no, price = excluded.price, currency = excluded.currency,
    pack_size = excluded.pack_size, lead_time_days = excluded.lead_time_days,
    -- Read off the parameter rather than \`excluded\`, because excluded already holds the coalesced value
    -- and cannot tell "not preferred" from "nobody said". Who this workshop buys an item from is a
    -- decision, and a price correction is not one.
    is_preferred = CASE WHEN p_is_preferred IS NULL THEN supplier_item.is_preferred
                        ELSE p_is_preferred END,
    updated_at = now()
  RETURNING id INTO saved;`,
    to: '  RETURNING id INTO saved;'
  },
  {
    what: 'a supplier note can be written against a merchant that is not there',
    file: 'api',
    from: `  IF NOT EXISTS (SELECT 1 FROM supplier WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'no such supplier' USING ERRCODE = 'foreign_key_violation';
  END IF;
  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('supplier', p_supplier_id, 'note', who, said)`,
    to: `  INSERT INTO activity_log (entity, entity_id, action, actor, detail)
  VALUES ('supplier', p_supplier_id, 'note', who, said)`
  },
  {
    what: 'the floor can read what this workshop pays a merchant on',
    file: 'auth',
    from: `GRANT SELECT (id, ref, name, org_no, vat_no, email, phone, website, address, city, country,
              category, supplier_type, established, delivery_terms, minimum_order, currency,
              rating, status, notes, created_at)
ON supplier TO varmak_workshop;`,
    to: `GRANT SELECT ON supplier TO varmak_workshop;`
  },
  {
    what: 'the merchants reach the screen but who to ring at them does not',
    file: 'views',
    from: `        'contacts', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'name', k.name, 'role', k.role, 'email', k.email, 'phone', k.phone,
            'primary', k.is_primary
          ) ORDER BY k.is_primary DESC, k.name)
          FROM supplier_contact k WHERE k.supplier_id = s.id), '[]'::jsonb),
        'activity', quality_activity_of('supplier', s.id)`,
    to: `        'activity', quality_activity_of('supplier', s.id)`
  },
  {
    what: 'what a merchant charges travels in the list every welder reads',
    file: 'views',
    from: `        'rating', s.rating::text,
        'status', s.status, 'notes', s.notes,`,
    to: `        'rating', s.rating::text, 'terms', s.payment_terms_days::text,
        'status', s.status, 'notes', s.notes,`
  },
  {
    what: 'a merchant’s price crosses the wire as a JSON number, which a browser parses as a double',
    file: 'views',
    from: `            'articleNo', si.article_no, 'price', si.price::text, 'currency', si.currency,`,
    to: `            'articleNo', si.article_no, 'price', si.price, 'currency', si.currency,`
  },
  {
    what: 'a price correction quietly stops a merchant being the one we buy from',
    file: 'api',
    from: `    is_preferred = CASE WHEN p_is_preferred IS NULL THEN supplier_item.is_preferred
                        ELSE p_is_preferred END,`,
    to: `    is_preferred = excluded.is_preferred,`
  },
  {
    what: 'the payment terms are sent as the words on screen rather than as a count of days',
    file: 'supplierrecord',
    from: `      payment_terms_days: paymentDays(whole.payment),`,
    to: `      payment_terms_days: whole.payment,`
  },
  {
    what: 'a missing rating is read as four stars, which nobody gave',
    file: 'supplierrecord',
    from: `    if (value === undefined || value === null || value === '') return null;
    const score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 5) return null;
    return score;`,
    to: `    const score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 5) return 4;
    return score;`
  },
  {
    what: 'the figures computed from rows elsewhere are saved onto the merchant',
    file: 'supplierrecord',
    from: `    'country', 'type', 'established', 'delivery', 'minimum', 'currency', 'rating', 'payment',
    'description'
  ];`,
    to: `    'country', 'type', 'established', 'delivery', 'minimum', 'currency', 'rating', 'payment',
    'description', 'performance', 'spendYtd', 'openPOs'
  ];`
  },
  {
    what: 'the notes panel’s dated list is sent as the merchant’s standing description',
    file: 'supplierrecord',
    from: `      notes: trimmed(whole.description)`,
    to: `      notes: trimmed(whole.notes)`
  },
  {
    what: 'a price list is rendered into the panel headed by what has been bought',
    file: 'supplierrecord',
    from: `    shaped.items = [];`,
    to: `    shaped.items = Array.isArray(given.priceList) ? given.priceList : [];`
  },
  {
    what: 'the avatar initials are stored rather than worked out from the name beside them',
    file: 'supplierrecord',
    from: `        primary: Array.isArray(row) ? at === 0 : !!given.primary`,
    to: `        initials: Array.isArray(row) ? row[0] : '',
        primary: Array.isArray(row) ? at === 0 : !!given.primary`
  },

  // ── The sales pipeline ──────────────────────────────────────────────────────────────────────

  {
    what: 'two of the board’s eight columns go back to having no value at all',
    from: `CREATE TYPE opportunity_stage AS ENUM
  ('discovery','qualified','rfq','preparing','quotesent','negotiation','won','lost');`,
    to: `CREATE TYPE opportunity_stage AS ENUM
  ('discovery','preparing','quotesent','negotiation','won','lost');`
  },
  {
    what: 'a lead can only be lost, not disqualified, which is not the same thing',
    from: `CREATE TYPE lead_status AS ENUM
  ('new','contacted','qualified','disqualified','converted','lost');`,
    to: `CREATE TYPE lead_status AS ENUM
  ('new','contacted','qualified','converted','lost');`
  },
  {
    what: 'the contact preference goes back to a case no dropdown offers',
    from: `  contact_preference text CHECK (contact_preference IS NULL OR
                       contact_preference IN ('Email','Phone','Post','None')),`,
    to: `  contact_preference text CHECK (contact_preference IS NULL OR
                       contact_preference IN ('email','phone','post','none')),`
  },
  {
    what: 'a tender can be recorded as awarded having apparently never been sent',
    from: `  CONSTRAINT submitted_tender_has_a_date
    CHECK (status NOT IN ('submitted', 'awarded', 'declined') OR submitted_on IS NOT NULL),`,
    to: `  CONSTRAINT submitted_tender_has_a_date
    CHECK (status <> 'submitted' OR submitted_on IS NOT NULL),`
  },
  {
    what: 'a tender can be from nobody at all',
    from: `  CONSTRAINT tender_is_from_somebody CHECK (
    customer_id IS NOT NULL OR opportunity_id IS NOT NULL OR btrim(coalesce(company,'')) <> ''
  ),`,
    to: ''
  },
  {
    what: 'a tender marked no-bid can be submitted anyway',
    from: `  CONSTRAINT no_bid_means_no_tender CHECK (
    bid_decision <> 'no-bid' OR status NOT IN ('submitted', 'awarded')
  )`,
    to: `  CONSTRAINT no_bid_means_no_tender CHECK (true)`
  },
  {
    what: 'a bid decision can be any word at all',
    from: `  bid_decision   text NOT NULL DEFAULT 'pending'
                 CHECK (bid_decision IN ('bid', 'pending', 'no-bid')),`,
    to: `  bid_decision   text NOT NULL DEFAULT 'pending',`
  },
  {
    what: 'the same firm can be entered as two leads',
    file: 'api',
    from: `  SELECT ref INTO existing FROM lead
   WHERE upper(btrim(company)) = upper(btrim(p_company)) AND (p_id IS NULL OR id <> p_id) LIMIT 1;
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'there is already a lead for % — it is %', btrim(p_company), existing;
  END IF;`,
    to: ''
  },
  {
    what: 'a lead marked converted can be moved back by the ordinary form',
    file: 'api',
    from: `      status = CASE WHEN status = 'converted' THEN status ELSE coalesce(p_status, status) END,`,
    to: `      status = coalesce(p_status, status),`
  },
  {
    what: 'a next step can be booked on the enquiry of somebody who asked not to be contacted',
    file: 'api',
    from: `    IF said_no THEN
      RAISE EXCEPTION '% has asked not to be contacted, so no next step can be booked against them',
        whose USING ERRCODE = 'check_violation';
    END IF;`,
    to: ''
  },
  {
    what: 'a lost enquiry needs no reason from the workflow, only from the constraint',
    file: 'api',
    from: `  IF p_stage = 'lost' AND coalesce(btrim(p_decision_reason), '') = '' THEN
    RAISE EXCEPTION 'a lost enquiry records why it was lost — it is the one field worth having'
      USING ERRCODE = 'check_violation';
  END IF;`,
    to: ''
  },
  {
    what: 'a finding about somebody who asked not to be contacted is a reason to ring them',
    file: 'api',
    from: `    IF found.do_not_contact THEN
      RAISE EXCEPTION '% has asked not to be contacted — a finding about them is not a reason to ring',
        found.company USING ERRCODE = 'check_violation';
    END IF;`,
    to: ''
  },
  {
    what: 'the pipeline goes back into the snapshot, and the floor is refused the whole workshop',
    file: 'views',
    from: `    'marketingLeads', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', l.id::text, 'no', l.ref, 'company', l.company, 'contact', l.contact,`,
    to: `    'marketingLeadsMoved', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', l.id::text, 'no', l.ref, 'company', l.company, 'contact', l.contact,`
  },
  {
    what: 'a lead’s estimated value crosses the wire as a JSON number',
    file: 'views',
    from: `        'service', l.service_wanted, 'value', l.estimated_value::text,`,
    to: `        'service', l.service_wanted, 'value', l.estimated_value,`
  },
  {
    what: 'a follow-up is sent for somebody who has asked not to be contacted',
    file: 'marketingrecord',
    from: `      next_follow_up_on: yes(whole.dnc) ? null : day(whole.nextFollowUp),`,
    to: `      next_follow_up_on: day(whole.nextFollowUp),`
  },
  {
    what: 'the ids stay text, so no row on the board can be opened',
    file: 'marketingrecord',
    from: `    numberedIds(shaped, ['id', 'linkedCustomerId', 'linkedOpportunityId']);`,
    to: ''
  },
  {
    what: 'the tender has no title, so every one saved from that form is refused',
    file: 'marketingrecord',
    from: `      title: trimmed(whole.title) || trimmed(whole.ref) || trimmed(whole.company),`,
    to: `      title: trimmed(whole.title),`
  },
  {
    what: 'the priority the prospect queue writes is sent as the word the column refuses',
    file: 'marketingrecord',
    from: `    return given === null ? null : (PRIORITY[String(given).toLowerCase()] || null);`,
    to: `    return given === null ? null : String(given);`
  },
  {
    what: 'the form can mark a lead converted without making the customer',
    file: 'marketingrecord',
    from: `      status: said(whole.status) === 'converted' ? null : said(whole.status, 'new'),`,
    to: `      status: said(whole.status, 'new'),`
  },
  {
    what: 'the notes list goes down as a row of objects rather than as text',
    file: 'marketingrecord',
    from: `    return notes.map((entry) => {
      if (typeof entry === 'string') return entry;`,
    to: `    return notes.map((entry) => {
      if (typeof entry === 'object') return String(entry);
      if (typeof entry === 'string') return entry;`
  },
  {
    what: 'a tender not yet gone in is stamped with today anyway',
    file: 'marketingrecord',
    from: `      submitted_on: day(whole.submitted)
        || (['submitted', 'awarded', 'declined'].indexOf(status) === -1
          ? null : new Date().toISOString().slice(0, 10)),`,
    to: `      submitted_on: day(whole.submitted) || new Date().toISOString().slice(0, 10),`
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
    // A suite run under `node --test` prints TAP, where every passing subtest is a line beginning
    // `ok N - <name>` and the failure is `not ok N - <name>`. The filter below dropped `OK ` and kept
    // `ok `, so a unit-test mutation was reported as caught by whichever assertion happened to pass
    // last — the same mistake in a different spelling, and it read exactly as convincingly. Where a
    // `not ok` line exists it is the answer; nothing else in TAP output is.
    const lines = output.split('\n');
    const tap = lines.filter((l) => /^\s*not ok\s/.test(l));
    if (tap.length) return { caught: true, by: tap[0].trim().slice(0, 130) };
    const line = lines
      .filter((l) => !/^(OK|ok)\s/.test(l.trim()))
      .reverse()
      .find((l) => /the database ACCEPTED|ALLOWED —|should have been|refused, but|must |cannot |can read these|did not come back|did not survive|has to |ERROR:|AssertionError/.test(l));
    return { caught: true, by: (line || '').trim().slice(0, 130) };
  } finally {
    fs.unlinkSync(file);
  }
}

function main() {
  const missed = [];
  // Which of the above could not be applied, as against which were applied and noticed by
  // nothing. Kept apart so the summary can say which kind of problem each one is.
  const wentStale = new Set();
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
      missed.push(mutation.what); wentStale.add(mutation.what);
      return;
    }
    // An anchor that matches in more than one place is as bad as one that matches nowhere, and quieter.
    // String.replace takes the FIRST match, so the mutation damages whichever rule happens to come first
    // in the file and reports its verdict under the name of the one it meant. Three tables carry the line
    // `title text NOT NULL CHECK (btrim(title) <> ''),` character for character — lead, opportunity and
    // document — so a mutation written for the document register was breaking a lead's title instead and
    // reporting MISSED, which read as a rule nobody tests. It is neither: it is an anchor pointing at two
    // things at once.
    const ambiguous = edits.filter((e) => original.split(e.from).length - 1 > 1);
    if (ambiguous.length) {
      console.log(`?    ${mutation.what} — this anchor matches `
        + `${original.split(ambiguous[0].from).length - 1} places in ${which}.sql, so it edits whichever `
        + 'comes first rather than the one it names');
      missed.push(mutation.what); wentStale.add(mutation.what);
      return;
    }
    // A FUNCTION as the replacement, not the string. String.replace treats `$` in a replacement string as
    // a substitution pattern — `$$` means one literal `$`, `$&` means the whole match — so any mutation
    // whose replacement holds a dollar sign was quietly producing something other than what it says.
    //
    // Six mutations do, and five of them were written long before this was noticed: the two that turn
    // is_admin() and may_see_money() back to answering NULL, the two on the backup script, and one on the
    // roles file. Every one of them names `$$`, which is how PL/pgSQL quotes a function body — so the
    // mutant was `AS $` instead of `AS $$`, and the suite failed on a SYNTAX ERROR while the harness
    // recorded it as the rule being caught. Four of the six are about money reaching the shop floor or
    // password hashes leaving the building, and all four have been reading as tested for weeks.
    //
    // A function replacement takes no patterns at all, so the text goes in as written.
    const damaged = edits.reduce((text, e) => text.replace(e.from, () => e.to), original);
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
    // Separated, because they are different findings and lumping them together cost a reading of this
    // report: a stale anchor is a mutation pointing at code that has moved, and a MISSED one is a rule
    // nobody tests. The first is fixed by re-anchoring, the second by writing a test.
    const stale = missed.filter((what) => wentStale.has(what));
    const untested = missed.filter((what) => !wentStale.has(what));
    if (untested.length) {
      console.error(`${untested.length} of ${SELECTED.length} mutations went unnoticed — these rules are `
        + 'not actually tested:');
      untested.forEach((what) => console.error(`  ${what}`));
    }
    if (stale.length) {
      console.error(`${stale.length} mutation(s) could not be applied at all, so they test nothing — the `
        + 'code they point at has moved or appears twice:');
      stale.forEach((what) => console.error(`  ${what}`));
    }
    process.exitCode = 1;
    return;
  }
  console.log(`All ${SELECTED.length} mutations were caught: every rule these mutations touch has a test that fails without it.`);
}

main();
