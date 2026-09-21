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
  auth: { path: path.join(__dirname, 'auth.sql'), suite: 'test-auth.js', env: 'VARMAK_AUTH' }
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
    from: `  FOREACH target IN ARRAY (
    SELECT array_agg(DISTINCT id) FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.operation_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.operation_id END
    ]) AS id WHERE id IS NOT NULL
  ) LOOP`,
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
    what: 'the equipment gate stops caring what state the machine is in',
    from: "IF machine.status IN ('out-of-service','under-maintenance','quarantined','retired') THEN",
    to: "IF machine.status IN ('retired') THEN"
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
  // ── auth.sql ──────────────────────────────────────────────────────────────────────────────
  //
  // The first two are the bugs that were really in the file. Both looked right when read.
  {
    // The one that matters most in the whole project: a broad table grant silently including a
    // price column, with a narrower column grant written below it that adds nothing.
    what: 'the workshop is granted the whole store table again, prices included',
    file: 'auth',
    from: `GRANT SELECT ON
  project, jobcard, operation, equipment, equipment_assignment,`,
    to: `GRANT SELECT ON
  stock_item, equipment_event,
  project, jobcard, operation, equipment, equipment_assignment,`
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
  {
    what: 'changing the quantity sidesteps the repricing rule',
    from: `  IF OLD.locked AND (NEW.unit_price IS DISTINCT FROM OLD.unit_price
                     OR NEW.quantity IS DISTINCT FROM OLD.quantity) THEN`,
    to: '  IF OLD.locked AND NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN'
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

function runSuiteAgainst(damaged, which, index) {
  const target = FILES[which];
  const file = path.join(os.tmpdir(), `varmak-mutant-${index}.sql`);
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
      .find((l) => /the database ACCEPTED|ALLOWED —|should have been|refused, but|must |cannot |can read these/.test(l));
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
    const result = runSuiteAgainst(damaged, which, index);
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
  console.log(`All ${SELECTED.length} mutations were caught: every rule in the schema has a test that fails without it.`);
}

main();
