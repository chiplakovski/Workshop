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

const SCHEMA = path.join(__dirname, 'schema.sql');
const base = fs.readFileSync(SCHEMA, 'utf8');

// The schema is read once, here, and every mutation is a copy of it. Editing schema.sql while this
// is running therefore produces a result about a file that no longer exists: every mutation comes
// back "caught", because the suite is failing on the edit rather than on the mutation. That is a
// green run that means nothing, and it happened — a run reported all 42 caught while every one of
// them was actually failing on an unrelated assertion. So the file is checked again at the end and
// the whole run is thrown away if it moved underneath us.
function schemaHasChanged() {
  return fs.readFileSync(SCHEMA, 'utf8') !== base;
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
    what: 'a password may be stored as half of one',
    from: 'CONSTRAINT password_is_whole CHECK ((password_hash IS NULL) = (password_salt IS NULL))',
    to: 'CONSTRAINT password_is_whole CHECK (true)'
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
    what: 'changing the quantity sidesteps the repricing rule',
    from: `  IF OLD.locked AND (NEW.unit_price IS DISTINCT FROM OLD.unit_price
                     OR NEW.quantity IS DISTINCT FROM OLD.quantity) THEN`,
    to: '  IF OLD.locked AND NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN'
  }
];

// A single mutation can be run on its own by passing part of its description, which is how you
// check one rule without waiting for all of them.
const only = process.argv.slice(2).join(' ').toLowerCase();
const SELECTED = only ? MUTATIONS.filter((m) => m.what.toLowerCase().includes(only)) : MUTATIONS;

function runSuiteAgainst(source, index) {
  const file = path.join(os.tmpdir(), `varmak-mutant-${index}.sql`);
  fs.writeFileSync(file, source);
  try {
    execFileSync('node', [path.join(__dirname, 'test-schema.js')], {
      env: { ...process.env, VARMAK_SCHEMA: file, VARMAK_TEST_DB: `varmak_mutant_${index}` },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { caught: false };
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`;
    const line = output.split('\n').reverse().find((l) => /the database ACCEPTED|should have been|Expected|AssertionError|: refused|must/.test(l));
    return { caught: true, by: (line || '').trim().slice(0, 120) };
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
    if (!base.includes(mutation.from)) {
      console.log(`?    ${mutation.what} — the rule this mutation edits is no longer in the schema`);
      missed.push(mutation.what);
      return;
    }
    const damaged = base.replace(mutation.from, mutation.to);
    const result = runSuiteAgainst(damaged, index);
    if (result.caught) {
      console.log(`caught   ${mutation.what}`);
      if (result.by) console.log(`         └ ${result.by}`);
    } else {
      console.log(`MISSED   ${mutation.what}`);
      missed.push(mutation.what);
    }
  });

  console.log();
  if (schemaHasChanged()) {
    console.error('schema.sql changed while this was running, so every result above is about a file');
    console.error('that no longer exists — those failures may be the edit rather than the mutation.');
    console.error('Nothing above can be trusted. Run it again against the file as it now stands.');
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
