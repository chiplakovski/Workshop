'use strict';

// The schema's promise is that certain things cannot happen no matter who is asking. A promise
// like that is worth exactly as much as the attempt to break it, so this file is that attempt:
// every constraint and every trigger in schema.sql is handed the thing it exists to refuse, and
// the refusal is asserted — including the wording, because "ERROR: check constraint violated" is
// not something a person at a machine can act on.
//
// The database is built fresh from schema.sql on every run. Testing a database that has been
// sitting around tests whatever has drifted into it, not the file that ships.
//
// Postgres, not a mock: the rules being tested here are locks, partial unique indexes and
// FOR UPDATE, and a mock of those would only ever confirm what it was written to confirm. Two of
// the tests below start a second session on purpose, because the failures that matter most —
// two people taking the same document number, two people issuing the last of something — cannot
// be reproduced with one.

const assert = require('node:assert/strict');
const { execFileSync, execFile } = require('node:child_process');
const path = require('node:path');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = process.env.VARMAK_TEST_DB || 'varmak_schema_test';
const SCHEMA = process.env.VARMAK_SCHEMA || path.join(__dirname, 'schema.sql');

function conn(db) {
  return ['-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1', '-qtAX'];
}

// ── Talking to the database ────────────────────────────────────────────────────────────────

// Returns the rows as text. Throws if the statement was refused — which most of this file is
// about, so `refused` below is the one used more often.
function sql(text, db = DB) {
  return execFileSync('psql', conn(db), { input: text, encoding: 'utf8' }).trim();
}

function value(text, db = DB) {
  return sql(text, db).split('\n')[0].trim();
}

function tryRun(text, db = DB) {
  try {
    return { ok: true, out: execFileSync('psql', conn(db), { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() };
  } catch (error) {
    const stderr = String(error.stderr || '');
    const line = (stderr.split('\n').find((l) => /^(ERROR|psql:.*ERROR)/.test(l)) || stderr).trim();
    return { ok: false, message: line.replace(/^ERROR:\s*/, '') };
  }
}

// The heart of the file. Hands the database something it must not accept and asserts both that it
// was refused and that the refusal says why in words somebody could act on.
function refused(what, text, expected) {
  const result = tryRun(text);
  attempts.refused += 1;
  assert.equal(result.ok, false, `${what}: the database ACCEPTED this — the rule is not being enforced`);
  assert.match(result.message, expected, `${what}: refused, but the message does not say why`);
  return result.message;
}

function accepted(what, text) {
  const result = tryRun(text);
  attempts.allowed += 1;
  assert.equal(result.ok, true, `${what}: should have been allowed but was refused — ${result.message}`);
  return result.out;
}

// Counted rather than claimed. A refusal is something the database was asked to reject; an
// allowance is the other half that stops a rule being a blanket freeze — a gate that says no to
// everything passes every refusal test and is still useless.
const attempts = { refused: 0, allowed: 0 };
let checks = 0;
function step(message) {
  checks += 1;
  console.log(`OK   ${message}`);
}

// ── The fixture ───────────────────────────────────────────────────────────────────────────

// One customer, one project, one jobcard, two operations, one machine, one stock item. Rebuilt
// before each group so a test never reads state another test left behind.
// Named rather than discovered, so that adding a table to the schema is a deliberate decision here
// too. The list is checked against the database itself below, because a list like this going stale
// means a test quietly reading what the last one left behind.
const ALL_TABLES = [
  'app_user', 'customer', 'project', 'jobcard', 'equipment', 'equipment_assignment',
  'equipment_event', 'operation', 'hours_entry', 'item_group', 'location', 'stock_item',
  'stock_movement', 'offcut', 'barcode', 'supplier', 'supplier_item', 'purchase_order',
  'purchase_order_line', 'lead', 'prospect_finding', 'opportunity', 'tender', 'estimate',
  'estimate_line', 'quality_hold', 'inspection', 'ncr', 'document', 'activity_log'
];

// Reference data, shipped by schema.sql rather than written by whoever is using the system. These
// must survive the reset — truncating the transition table would let every transition through and
// the tests for it would pass on an empty rulebook.
const REFERENCE_TABLES = ['allowed_transition'];

function everyTableIsAccountedFor() {
  const inDatabase = sql(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;`)
    .split('\n').map((t) => t.trim()).filter(Boolean);
  const known = [...ALL_TABLES, ...REFERENCE_TABLES];
  const missing = inDatabase.filter((t) => !known.includes(t));
  const stale = known.filter((t) => !inDatabase.includes(t));
  assert.deepEqual(missing, [],
    `the schema has tables this suite neither resets nor declares as reference data, so one test would read what another left: ${missing.join(', ')}`);
  assert.deepEqual(stale, [], `this suite names tables that no longer exist: ${stale.join(', ')}`);
  // Reference data that is empty is a rulebook with no rules in it, which every gate reading it
  // would silently pass.
  for (const table of REFERENCE_TABLES) {
    assert.notEqual(value(`SELECT count(*) FROM ${table};`), '0',
      `${table} is reference data and must arrive with rows — an empty rulebook refuses nothing`);
  }
  step(`Suite: all ${inDatabase.length} tables accounted for — ${ALL_TABLES.length} reset between tests, ${REFERENCE_TABLES.length} shipped as reference data`);
}

function fixture() {
  sql(`TRUNCATE ${ALL_TABLES.join(', ')} RESTART IDENTITY CASCADE;`);
  const ids = sql(`
    WITH c AS (INSERT INTO customer (name, city) VALUES ('Fixture Industri AB', 'Marieholm') RETURNING id),
         p AS (INSERT INTO project (name, customer_id, planned_hours)
               SELECT 'Fixture frame', id, 40 FROM c RETURNING id),
         j AS (INSERT INTO jobcard (project_id, title, planned_hours)
               SELECT id, 'Fixture weldment', 24 FROM p RETURNING id),
         e AS (INSERT INTO equipment (ref, name, category) VALUES ('EQ-001', 'Fixture MIG 400', 'welding') RETURNING id),
         o1 AS (INSERT INTO operation (jobcard_id, seq, description, planned_hours)
                SELECT id, 1, 'Cut and prepare', 8 FROM j RETURNING id),
         o2 AS (INSERT INTO operation (jobcard_id, seq, description, planned_hours, depends_on)
                SELECT (SELECT id FROM j), 2, 'Weld out', 16, (SELECT id FROM o1) RETURNING id),
         s AS (INSERT INTO stock_item (code, description, unit, stock, reserved, avg_cost)
               VALUES ('S355-10', 'Plate S355J2 10mm', 'KG', 120, 20, 14.50) RETURNING id)
    SELECT (SELECT id FROM c) || ' ' || (SELECT id FROM p) || ' ' || (SELECT id FROM j) || ' ' ||
           (SELECT id FROM e) || ' ' || (SELECT id FROM o1) || ' ' || (SELECT id FROM o2) || ' ' ||
           (SELECT id FROM s);`).split(' ');
  const [customer, project, jobcard, equipment, op1, op2, item] = ids;
  return { customer, project, jobcard, equipment, op1, op2, item };
}

// Work now has to travel the way work travels — draft, released, ready, in-progress, inspection —
// because the transition table refuses the shortcut. Which means every test about finishing a job
// first has to get the job to the point of being finishable, exactly as the workshop does.
function advance(table, id, ...statuses) {
  for (const status of statuses) sql(`UPDATE ${table} SET status = '${status}' WHERE id = ${id};`);
}
const READY_TO_FINISH = ['released', 'ready', 'in-progress', 'inspection'];

// ── Numbering ─────────────────────────────────────────────────────────────────────────────

// This is the bug the sequences exist for, shown before it is fixed rather than asserted about.
// Two sessions in the same snapshot both count the same number of existing rows, so the old
// browser-side numbering hands both of them the same reference and neither can tell.
async function countingRowsCollides() {
  fixture();
  const numberByCounting = `SELECT 'C-' || lpad((count(*) + 1)::text, 3, '0') FROM customer;`;
  const both = await Promise.all([
    run(`BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT pg_sleep(0.05); ${numberByCounting} COMMIT;`),
    run(`BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT pg_sleep(0.05); ${numberByCounting} COMMIT;`)
  ]);
  const handed = both.map((r) => r.out.split('\n').filter((l) => /^C-/.test(l))[0]);
  assert.equal(handed[0], handed[1],
    'the old way of numbering — counting the rows — should collide; if it no longer does, this test has stopped measuring anything');
  step(`Numbering: counting rows hands two simultaneous sessions the same reference (${handed[0]}) — which is why it is not done that way`);
}

function run(text, db = DB) {
  return new Promise((resolve) => {
    execFile('psql', conn(db), { encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: (stdout || '').trim(), err: (stderr || '').trim() });
    }).stdin.end(text);
  });
}

async function sequencesNeverCollide() {
  fixture();
  const writers = Array.from({ length: 12 }, (_, i) =>
    run(`INSERT INTO customer (name) VALUES ('Race ${i}') RETURNING ref;`));
  const refs = (await Promise.all(writers)).map((r) => r.out);
  assert.ok(refs.every(Boolean), 'every concurrent writer should have got a reference');
  assert.equal(new Set(refs).size, refs.length,
    `twelve simultaneous writers must get twelve different references, got: ${refs.join(', ')}`);
  step(`Numbering: twelve simultaneous writers get twelve different references (${refs.slice(0, 3).join(', ')}, …)`);

  // A gap is not a problem; two documents with one number is. This asserts the trade explicitly
  // so nobody later "fixes" the gaps by going back to counting rows.
  const before = value(`SELECT last_value FROM seq_customer;`);
  tryRun(`BEGIN; INSERT INTO customer (name) VALUES ('Rolled back'); ROLLBACK;`);
  const after = value(`SELECT last_value FROM seq_customer;`);
  assert.ok(Number(after) > Number(before), 'a rolled back insert still consumes its number — this is the intended trade');
  assert.equal(value(`SELECT count(*) FROM customer WHERE name = 'Rolled back';`), '0');
  step('Numbering: a rolled-back document leaves a gap and never a duplicate');

  assert.match(value(`SELECT ref FROM project LIMIT 1;`), /^P-\d{4}-\d{3}$/);
  assert.match(value(`SELECT ref FROM jobcard LIMIT 1;`), /^JC-\d{4}-\d{4}$/);
  step('Numbering: project and jobcard references carry the year and are shaped as the workshop reads them');
}

// ── Who is asking ─────────────────────────────────────────────────────────────────────────

function passwordsAreNeverHalfStored() {
  fixture();
  refused('a hash with no salt', `INSERT INTO app_user (email, display_name, password_hash)
    VALUES ('half@varmak.se', 'Half Stored', 'deadbeef');`, /password_is_whole/);
  refused('a salt with no hash', `INSERT INTO app_user (email, display_name, password_salt)
    VALUES ('half@varmak.se', 'Half Stored', 'abc123');`, /password_is_whole/);
  accepted('a user with no password yet', `INSERT INTO app_user (email, display_name)
    VALUES ('new@varmak.se', 'Not Yet Set');`);
  accepted('a whole password', `INSERT INTO app_user (email, display_name, password_hash, password_salt, role)
    VALUES ('admin@varmak.se', 'Workshop Admin', 'deadbeef', 'abc123', 'admin');`);
  step('Users: a password is stored whole or not at all — never a hash with no salt');

  refused('an email with different capitals', `INSERT INTO app_user (email, display_name)
    VALUES ('Mixed@Varmak.se', 'Mixed Case');`, /email/);
  refused('an email with a stray space', `INSERT INTO app_user (email, display_name)
    VALUES (' spaced@varmak.se', 'Spaced');`, /email/);
  refused('the same email twice', `INSERT INTO app_user (email, display_name)
    VALUES ('admin@varmak.se', 'Second Admin');`, /app_user_email_key|duplicate key/);
  step('Users: one row per email, stored the one way it will be looked up');

  refused('a role that does not exist', `INSERT INTO app_user (email, display_name, role)
    VALUES ('ghost@varmak.se', 'Ghost', 'superuser');`, /user_role/);
  step('Users: the three roles are the only three roles');
}

// ── A hold stops work leaving the building ────────────────────────────────────────────────

function holdBlocksCompletion() {
  const f = fixture();
  advance('jobcard', f.jobcard, ...READY_TO_FINISH);
  const hold = value(`INSERT INTO quality_hold (scope, jobcard_id, reason, severity, applied_by)
    VALUES ('jobcard', ${f.jobcard}, 'Porosity beyond EN ISO 5817 level C', 'critical', 'Quality Manager')
    RETURNING ref;`);

  const message = refused('completing a held jobcard',
    `UPDATE jobcard SET status = 'completed' WHERE id = ${f.jobcard};`,
    /cannot be completed while quality hold/);
  assert.ok(message.includes(hold), `the refusal must name the hold that caused it — said: ${message}`);
  assert.equal(value(`SELECT status FROM jobcard WHERE id = ${f.jobcard};`), 'inspection',
    'a refused transition must leave the jobcard exactly where it was');
  step(`Holds: a held jobcard cannot be completed, and the refusal names the hold (${hold})`);

  // A hold stops work going out. It does not stop the system telling the truth about where the
  // work stands, which is why these are allowed and worth asserting — a gate that freezes
  // everything gets worked around, and then it protects nothing.
  accepted('pausing a held jobcard', `UPDATE jobcard SET status = 'paused' WHERE id = ${f.jobcard};`);
  accepted('resuming it', `UPDATE jobcard SET status = 'inspection' WHERE id = ${f.jobcard};`);
  accepted('marking a held jobcard blocked', `UPDATE jobcard SET status = 'blocked' WHERE id = ${f.jobcard};`);
  accepted('unblocking it', `UPDATE jobcard SET status = 'inspection' WHERE id = ${f.jobcard};`);
  accepted('logging hours against held work', `INSERT INTO hours_entry (jobcard_id, operation_id, worker, hours)
    VALUES (${f.jobcard}, ${f.op1}, 'Welder', 2);`);
  step('Holds: the hold stops the work going out, not the record of where it stands');

  refused('releasing with nothing written down',
    `UPDATE quality_hold SET status = 'released' WHERE ref = '${hold}';`, /release_needs_evidence/);
  refused('releasing with an authority but no evidence',
    `UPDATE quality_hold SET status = 'released', release_authority = 'Quality Manager',
     released_at = now() WHERE ref = '${hold}';`, /release_needs_evidence/);
  refused('releasing with evidence but nobody named',
    `UPDATE quality_hold SET status = 'released', release_reason = 'Ground out and re-run',
     released_at = now() WHERE ref = '${hold}';`, /release_needs_evidence/);
  refused('releasing without recording when',
    `UPDATE quality_hold SET status = 'released', release_authority = 'Quality Manager',
     release_reason = 'Ground out and re-run' WHERE ref = '${hold}';`, /release_needs_evidence/);
  assert.equal(value(`SELECT status FROM quality_hold WHERE ref = '${hold}';`), 'active');
  step('Holds: a hold clears only against a named authority, written evidence and a date — all three');

  accepted('a properly evidenced release',
    `UPDATE quality_hold SET status = 'released', release_authority = 'Quality Manager',
     release_reason = 'Weld ground out and re-run; PT accepted on reinspection', released_at = now()
     WHERE ref = '${hold}';`);
  accepted('completing the jobcard once the hold is cleared',
    `UPDATE jobcard SET status = 'completed' WHERE id = ${f.jobcard};`);
  step('Holds: once the hold is properly released the work can go out');
}

function holdStopsFinishedWorkLeaving() {
  const f = fixture();
  advance('jobcard', f.jobcard, ...READY_TO_FINISH, 'completed');
  const hold = value(`INSERT INTO quality_hold (scope, jobcard_id, reason, applied_by)
    VALUES ('jobcard', ${f.jobcard}, 'Certificates missing for the plate', 'Quality Manager') RETURNING ref;`);
  const message = refused('closing a jobcard held after it was completed',
    `UPDATE jobcard SET status = 'closed' WHERE id = ${f.jobcard};`, /cannot be closed while quality hold/);
  assert.ok(message.includes(hold));
  assert.equal(value(`SELECT status FROM jobcard WHERE id = ${f.jobcard};`), 'completed');
  step('Holds: work already finished can still be stopped from going out by a hold raised after the fact');
}

function holdOnProjectBlocksItsJobcards() {
  const f = fixture();
  advance('jobcard', f.jobcard, ...READY_TO_FINISH);
  advance('project', f.project, 'approved', 'planned', 'production');
  const hold = value(`INSERT INTO quality_hold (scope, project_id, reason, applied_by)
    VALUES ('project', ${f.project}, 'Material certificates missing for the whole batch', 'Quality Manager')
    RETURNING ref;`);
  const message = refused('completing a jobcard under a project-wide hold',
    `UPDATE jobcard SET status = 'completed' WHERE id = ${f.jobcard};`,
    /cannot be completed while quality hold/);
  assert.ok(message.includes(hold));
  refused('completing the held project itself',
    `UPDATE project SET status = 'completed' WHERE id = ${f.project};`,
    /cannot be completed while quality hold/);
  step('Holds: a hold on the project stops the project and every jobcard under it');

  // A jobcard created already finished is the way round the gate that a BEFORE UPDATE trigger
  // alone does not see: the status never transitions, so the trigger never looks. Found by reading
  // the trigger rather than by running it, and confirmed by the database accepting it.
  //
  // The same hole does not exist on the project itself — a hold references a project, so a project
  // being created cannot already have one — which is why there is no matching case here.
  refused('a jobcard created already completed under an active hold',
    `INSERT INTO jobcard (project_id, title, status) VALUES (${f.project}, 'Straight to done', 'completed');`,
    /cannot be completed while quality hold/);
  refused('a jobcard created already closed under an active hold',
    `INSERT INTO jobcard (project_id, title, status) VALUES (${f.project}, 'Born closed', 'closed');`,
    /cannot be closed while quality hold/);
  accepted('a new jobcard under the hold that has not finished yet',
    `INSERT INTO jobcard (project_id, title) VALUES (${f.project}, 'Still to do');`);
  step('Holds: the gate is not avoidable by creating the work already finished');
}

function holdOnJobcardBlocksItsProject() {
  const f = fixture();
  advance('project', f.project, 'approved', 'planned', 'production', 'completed');
  const hold = value(`INSERT INTO quality_hold (scope, jobcard_id, reason, applied_by)
    VALUES ('jobcard', ${f.jobcard}, 'Weld rejected', 'Quality Manager') RETURNING ref;`);
  const message = refused('closing a project with a held jobcard inside it',
    `UPDATE project SET status = 'closed' WHERE id = ${f.project};`, /cannot be closed while quality hold/);
  assert.ok(message.includes(hold), 'the project refusal must name the jobcard hold that caused it');
  step('Holds: a project cannot be closed over the top of a hold on one of its jobcards');
}

function holdNamesExactlyOneThing() {
  const f = fixture();
  refused('a hold naming nothing', `INSERT INTO quality_hold (scope, reason, applied_by)
    VALUES ('jobcard', 'Vague worry', 'Quality Manager');`, /hold_names_one_thing/);
  refused('a hold naming both a project and a jobcard',
    `INSERT INTO quality_hold (scope, project_id, jobcard_id, reason, applied_by)
     VALUES ('jobcard', ${f.project}, ${f.jobcard}, 'Both', 'Quality Manager');`, /hold_names_one_thing/);
  refused('a hold whose scope disagrees with what it names',
    `INSERT INTO quality_hold (scope, jobcard_id, reason, applied_by)
     VALUES ('project', ${f.jobcard}, 'Mislabelled', 'Quality Manager');`, /hold_names_one_thing/);
  refused('a hold with no reason on it', `INSERT INTO quality_hold (scope, jobcard_id, reason, applied_by)
    VALUES ('jobcard', ${f.jobcard}, '   ', 'Quality Manager');`, /reason/);
  refused('a hold nobody put their name to', `INSERT INTO quality_hold (scope, jobcard_id, reason, applied_by)
    VALUES ('jobcard', ${f.jobcard}, 'Weld rejected', '');`, /applied_by/);
  step('Holds: a hold names one thing, says why, and has somebody behind it');
}

// ── A machine that must not be run ────────────────────────────────────────────────────────

function equipmentGateStopsStart() {
  const f = fixture();
  for (const state of ['out-of-service', 'under-maintenance', 'quarantined', 'retired']) {
    sql(`UPDATE equipment SET status = '${state}' WHERE id = ${f.equipment};
         UPDATE operation SET equipment_id = ${f.equipment}, status = 'pending' WHERE id = ${f.op1};`);
    const message = refused(`starting work on a ${state} machine`,
      `UPDATE operation SET status = 'in-progress' WHERE id = ${f.op1};`, /cannot start/);
    assert.ok(message.includes(state), `the refusal must say what is wrong with the machine — said: ${message}`);
    assert.ok(message.includes('Fixture MIG 400'), 'the refusal must name the machine');
  }
  step('Equipment: work cannot start on a machine that is out of service, under maintenance, quarantined or retired');

  sql(`UPDATE equipment SET status = 'available' WHERE id = ${f.equipment};`);
  accepted('starting on an available machine', `UPDATE operation SET status = 'in-progress' WHERE id = ${f.op1};`);
  step('Equipment: and it starts normally on a machine that is fit to run');
}

function expiredCertificationStopsStart() {
  const f = fixture();
  sql(`UPDATE equipment SET certification_expiry = current_date - 1 WHERE id = ${f.equipment};
       UPDATE operation SET equipment_id = ${f.equipment} WHERE id = ${f.op1};`);
  const message = refused('starting on a machine whose certification ran out yesterday',
    `UPDATE operation SET status = 'in-progress' WHERE id = ${f.op1};`,
    /the certification for .+ expired on \d{4}-\d{2}-\d{2}/);
  assert.ok(message.includes('Fixture MIG 400'),
    `the refusal must name the machine, not describe it in the abstract — said: ${message}`);
  // The message read "Fixture MIG 400s certification expired" until this was checked: %s in a
  // RAISE is the placeholder followed by a literal s, not a possessive.
  assert.ok(!/MIG 400s/.test(message), `the refusal reads wrong: ${message}`);

  sql(`UPDATE equipment SET certification_expiry = current_date + 30 WHERE id = ${f.equipment};`);
  accepted('starting on a machine certified for another month',
    `UPDATE operation SET status = 'in-progress' WHERE id = ${f.op1};`);
  step('Equipment: an expired certification stops the start, and a valid one does not');
}

function machineCannotBeInTwoPlaces() {
  const f = fixture();
  const other = value(`INSERT INTO jobcard (project_id, title) VALUES (${f.project}, 'Other work') RETURNING id;`);
  accepted('assigning the machine', `INSERT INTO equipment_assignment (equipment_id, jobcard_id)
    VALUES (${f.equipment}, ${f.jobcard});`);
  refused('assigning the same machine to a second jobcard',
    `INSERT INTO equipment_assignment (equipment_id, jobcard_id) VALUES (${f.equipment}, ${other});`,
    /equipment_one_live_assignment|duplicate key/);
  step('Equipment: a machine cannot be assigned to two jobcards at once');

  sql(`UPDATE equipment_assignment SET released_at = now() WHERE equipment_id = ${f.equipment};`);
  accepted('assigning it once it is released', `INSERT INTO equipment_assignment (equipment_id, jobcard_id)
    VALUES (${f.equipment}, ${other});`);
  refused('a release recorded before the assignment', `UPDATE equipment_assignment
    SET released_at = assigned_at - interval '1 hour' WHERE jobcard_id = ${other};`, /check/i);
  step('Equipment: released, it can go to the next job — and cannot be released before it was assigned');
}

// ── What must finish first ────────────────────────────────────────────────────────────────

function dependencyGateStopsStart() {
  const f = fixture();
  const message = refused('starting the second operation while the first is unfinished',
    `UPDATE operation SET status = 'in-progress' WHERE id = ${f.op2};`, /cannot start before/);
  assert.ok(message.includes('Cut and prepare') && message.includes('Weld out'),
    `the refusal must name both operations — said: ${message}`);

  sql(`UPDATE operation SET status = 'completed' WHERE id = ${f.op1};`);
  accepted('starting it once the first is done', `UPDATE operation SET status = 'in-progress' WHERE id = ${f.op2};`);

  sql(`UPDATE operation SET status = 'pending' WHERE id = ${f.op2};
       UPDATE operation SET status = 'skipped' WHERE id = ${f.op1};`);
  accepted('starting it when the first was skipped', `UPDATE operation SET status = 'in-progress' WHERE id = ${f.op2};`);
  step('Operations: work waits for what it depends on, and a skipped step counts as settled');
}

function dependencyCannotLoop() {
  const f = fixture();
  refused('an operation depending on itself',
    `UPDATE operation SET depends_on = id WHERE id = ${f.op1};`, /depend on itself/);

  // The trigger gets there first, which leaves the question of whether the CHECK underneath it is
  // real or decoration. Asked directly by taking the trigger out of the way: two layers were the
  // intention, so both are checked.
  sql(`ALTER TABLE operation DISABLE TRIGGER operation_dependency_update_trg;`);
  try {
    refused('an operation depending on itself with the trigger out of the way',
      `UPDATE operation SET depends_on = id WHERE id = ${f.op1};`, /operation_check|check constraint/);
  } finally {
    sql(`ALTER TABLE operation ENABLE TRIGGER operation_dependency_update_trg;`);
  }
  refused('a loop two steps long',
    `UPDATE operation SET depends_on = ${f.op2} WHERE id = ${f.op1};`, /depend on itself through a chain/);

  const third = value(`INSERT INTO operation (jobcard_id, seq, description, depends_on)
    VALUES (${f.jobcard}, 3, 'Paint', ${f.op2}) RETURNING id;`);
  refused('a loop three steps long',
    `UPDATE operation SET depends_on = ${third} WHERE id = ${f.op1};`, /depend on itself through a chain/);
  step('Operations: a dependency cannot loop back on itself, directly or round a longer chain');
}

// ── Hours ─────────────────────────────────────────────────────────────────────────────────

function hoursRollUp() {
  const f = fixture();
  const total = () => value(`SELECT logged_hours FROM operation WHERE id = ${f.op1};`);
  assert.equal(total(), '0.00');

  const first = value(`INSERT INTO hours_entry (jobcard_id, operation_id, worker, hours)
    VALUES (${f.jobcard}, ${f.op1}, 'Welder A', 6.5) RETURNING id;`);
  assert.equal(total(), '6.50', 'the operation total should follow the entry in');
  sql(`INSERT INTO hours_entry (jobcard_id, operation_id, worker, hours)
       VALUES (${f.jobcard}, ${f.op1}, 'Welder B', 2);`);
  assert.equal(total(), '8.50');
  sql(`UPDATE hours_entry SET hours = 4 WHERE id = ${first};`);
  assert.equal(total(), '6.00', 'correcting an entry should correct the total');
  sql(`DELETE FROM hours_entry WHERE id = ${first};`);
  assert.equal(total(), '2.00', 'deleting an entry should take its hours back out');
  step('Hours: the operation total is the sum of the entries, through every way an entry changes');

  // Moving an entry from one operation to another is the case a roll-up written against only the
  // new row gets wrong: the hours arrive on the second operation and never leave the first.
  const moved = value(`INSERT INTO hours_entry (jobcard_id, operation_id, worker, hours)
    VALUES (${f.jobcard}, ${f.op1}, 'Welder C', 3) RETURNING id;`);
  assert.equal(total(), '5.00');
  sql(`UPDATE hours_entry SET operation_id = ${f.op2} WHERE id = ${moved};`);
  assert.equal(value(`SELECT logged_hours FROM operation WHERE id = ${f.op2};`), '3.00',
    'the hours should arrive on the operation they were moved to');
  assert.equal(total(), '2.00',
    'and leave the one they were moved from — otherwise the same three hours are billed twice');
  step('Hours: booked to the wrong operation and moved, the hours leave the first and arrive on the second');

  const honest = value(`SELECT (SELECT COALESCE(SUM(hours),0) FROM hours_entry WHERE operation_id = ${f.op1})
    = (SELECT logged_hours FROM operation WHERE id = ${f.op1});`);
  assert.equal(honest, 't', 'the running total and the entries must agree');
  step('Hours: the total and the entries agree when asked the long way round');
}

function hoursMustBePossible() {
  const f = fixture();
  refused('a day of twenty-five hours', `INSERT INTO hours_entry (jobcard_id, worker, hours)
    VALUES (${f.jobcard}, 'Welder', 25);`, /hours/);
  refused('nothing at all', `INSERT INTO hours_entry (jobcard_id, worker, hours)
    VALUES (${f.jobcard}, 'Welder', 0);`, /hours/);
  refused('negative hours', `INSERT INTO hours_entry (jobcard_id, worker, hours)
    VALUES (${f.jobcard}, 'Welder', -2);`, /hours/);
  refused('an entry with nobody on it', `INSERT INTO hours_entry (jobcard_id, worker, hours)
    VALUES (${f.jobcard}, '  ', 4);`, /worker/);
  refused('hours against a jobcard that does not exist', `INSERT INTO hours_entry (jobcard_id, worker, hours)
    VALUES (999999, 'Welder', 4);`, /foreign key|jobcard/);
  step('Hours: an entry names a real job, a real person, and a number of hours a day can hold');

  // An entry carrying both a jobcard and an operation can name two different jobs at once, and
  // then every figure built from either of them is quietly wrong.
  const elsewhere = value(`INSERT INTO jobcard (project_id, title) VALUES (${f.project}, 'Different job') RETURNING id;`);
  refused('an entry whose operation belongs to another jobcard',
    `INSERT INTO hours_entry (jobcard_id, operation_id, worker, hours)
     VALUES (${elsewhere}, ${f.op1}, 'Welder', 4);`, /operation .* belongs to|does not belong/);
  step('Hours: an entry cannot name one jobcard and an operation from a different one');
}

// ── Stock ─────────────────────────────────────────────────────────────────────────────────

function stockNeverGoesNegative() {
  const f = fixture();
  const message = refused('issuing more than exists',
    `SELECT issue_stock(${f.item}, 500, ${f.jobcard}, 'Storeman');`, /cannot issue/);
  assert.ok(message.includes('S355-10') && message.includes('120'),
    `the refusal must name the item and what there actually is — said: ${message}`);
  assert.equal(value(`SELECT stock FROM stock_item WHERE id = ${f.item};`), '120.000',
    'a refused issue must not have moved anything');
  assert.equal(value(`SELECT count(*) FROM stock_movement;`), '0',
    'a refused issue must not have written a movement');
  step('Store: issuing more than exists is refused in words that name the shortfall, and moves nothing');

  // Two constraints forbid a negative stock between them, and asking which one refuses is how a
  // mistake in this test came to light: the first version cleared the reservation and expected
  // stock_never_negative, but reserved >= 0 and reserved <= stock already make a negative stock
  // arithmetically impossible, so that constraint can never be the one that fires. The rule is
  // real; it is the pair that holds it. Tested as the pair, and named so a refusal says which.
  refused('driving the stock below zero with a reservation standing',
    `UPDATE stock_item SET stock = -1 WHERE id = ${f.item};`, /reserved_within_stock/);
  sql(`UPDATE stock_item SET reserved = 0 WHERE id = ${f.item};`);
  refused('driving the stock below zero with nothing reserved',
    `UPDATE stock_item SET stock = -1 WHERE id = ${f.item};`, /reserved_within_stock|stock_never_negative/);
  assert.equal(value(`SELECT stock FROM stock_item WHERE id = ${f.item};`), '120.000');
  refused('reserving more than exists',
    `UPDATE stock_item SET reserved = 200 WHERE id = ${f.item};`, /reserved_within_stock/);
  refused('a negative reservation',
    `UPDATE stock_item SET reserved = -5 WHERE id = ${f.item};`, /reserved_never_negative/);
  refused('issuing nothing', `SELECT issue_stock(${f.item}, 0, ${f.jobcard}, 'Storeman');`, /more than nothing/);
  refused('issuing from an item that is not there', `SELECT issue_stock(999999, 1, ${f.jobcard}, 'Storeman');`,
    /no such stock item/);
  step('Store: the floor under the issue function holds against every other way in as well');
}

function issuingLeavesATrail() {
  const f = fixture();
  const movement = value(`SELECT issue_stock(${f.item}, 30, ${f.jobcard}, 'Storeman', 'Cut for the frame');`);
  assert.equal(value(`SELECT stock FROM stock_item WHERE id = ${f.item};`), '90.000');
  assert.equal(value(`SELECT reserved FROM stock_item WHERE id = ${f.item};`), '0.000',
    'issuing against a reservation should consume the reservation, not leave it standing');
  const row = sql(`SELECT ref, kind, quantity, moved_by FROM stock_movement WHERE id = ${movement};`);
  assert.match(row, /^MV-\d{4}-\d{5}\|issue\|30\.000\|Storeman$/, `the movement reads: ${row}`);
  assert.equal(value(`SELECT detail FROM activity_log WHERE entity = 'stock_item' AND action = 'issued';`),
    '30 KG of S355-10');
  // The same amount typed three ways has to read as one line, or the log looks like three issues.
  sql(`SELECT issue_stock(${f.item}, 2.500, ${f.jobcard}, 'Storeman');
       SELECT issue_stock(${f.item}, 2.5, ${f.jobcard}, 'Storeman');`);
  assert.equal(value(`SELECT count(DISTINCT detail) FROM activity_log WHERE detail LIKE '2.5 %';`), '1');
  step('Store: an issue leaves a numbered movement and a line in the activity log that reads the same however it was typed');
}

async function twoPeopleCannotIssueTheSameLastPiece() {
  const f = fixture();
  sql(`UPDATE stock_item SET stock = 5, reserved = 0 WHERE id = ${f.item};`);
  const first = run(`BEGIN; SELECT issue_stock(${f.item}, 5, ${f.jobcard}, 'Storeman A');
                     SELECT pg_sleep(0.6); COMMIT;`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const second = await run(`SELECT issue_stock(${f.item}, 5, ${f.jobcard}, 'Storeman B');`);
  const firstResult = await first;

  assert.equal(firstResult.ok, true, `the first storeman should have got the steel: ${firstResult.err}`);
  assert.equal(second.ok, false,
    'the second storeman must NOT have got the same five kilos — the lock is not holding');
  assert.match(second.err, /cannot issue/);
  assert.equal(value(`SELECT stock FROM stock_item WHERE id = ${f.item};`), '0.000');
  assert.equal(value(`SELECT count(*) FROM stock_movement;`), '1',
    'exactly one movement for the one lot of steel that existed');
  step('Store: two people issuing the last of something at the same moment — one gets it, one is told why not');
}

// ── The audit trail ───────────────────────────────────────────────────────────────────────

function historyCannotBeEdited() {
  const f = fixture();
  sql(`INSERT INTO activity_log (entity, entity_id, action, actor, detail)
       VALUES ('jobcard', ${f.jobcard}, 'released', 'Workshop Admin', 'Released to the floor');`);
  refused('editing the history', `UPDATE activity_log SET actor = 'Somebody Else' WHERE entity_id = ${f.jobcard};`,
    /append-only/);
  refused('deleting from the history', `DELETE FROM activity_log WHERE entity_id = ${f.jobcard};`, /append-only/);
  assert.equal(value(`SELECT actor FROM activity_log WHERE entity_id = ${f.jobcard};`), 'Workshop Admin');
  step('History: the activity log can be added to and nothing else');
}

// ── Records that must hang together ───────────────────────────────────────────────────────

function nothingIsOrphanedOrErased() {
  const f = fixture();
  refused('deleting a customer who has projects', `DELETE FROM customer WHERE id = ${f.customer};`,
    /foreign key|still referenced/);
  refused('deleting a project that has jobcards', `DELETE FROM project WHERE id = ${f.project};`,
    /foreign key|still referenced/);
  sql(`INSERT INTO hours_entry (jobcard_id, operation_id, worker, hours)
       VALUES (${f.jobcard}, ${f.op1}, 'Welder', 4);`);
  refused('deleting a jobcard that has hours booked to it', `DELETE FROM jobcard WHERE id = ${f.jobcard};`,
    /foreign key|still referenced/);
  step('Records: losing a customer, a project or a jobcard never silently takes the work with it');

  refused('a jobcard for no project', `INSERT INTO jobcard (project_id, title) VALUES (999999, 'Nowhere');`,
    /foreign key/);
  refused('a jobcard with no title', `INSERT INTO jobcard (project_id, title) VALUES (${f.project}, '   ');`, /title/);
  refused('a jobcard for none of something', `INSERT INTO jobcard (project_id, title, quantity)
    VALUES (${f.project}, 'Nothing', 0);`, /quantity/);
  refused('a jobcard finishing before it starts', `INSERT INTO jobcard (project_id, title, planned_start, planned_completion)
    VALUES (${f.project}, 'Backwards', '2026-06-01', '2026-05-01');`, /check/i);
  refused('two operations claiming the same step number', `INSERT INTO operation (jobcard_id, seq, description)
    VALUES (${f.jobcard}, 1, 'Also step one');`, /operation_jobcard_id_seq_key|duplicate key/);
  refused('a project more than finished', `UPDATE project SET progress = 120 WHERE id = ${f.project};`, /progress/);
  step('Records: the shapes a record may take are fixed where the record lives');
}

// ── Per-group item numbering ──────────────────────────────────────────────────────────────

// The one number in the system a sequence cannot hand out, because every group counts from 1. That
// puts the counter back on a row, which is exactly the shape that failed in the browser — so it
// gets the same concurrency test the sequences got, rather than a comment saying it is fine.
async function perGroupNumbersNeverCollide() {
  fixture();
  const plates = value(`INSERT INTO item_group (code, name) VALUES ('PLT', 'Plates') RETURNING id;`);
  const valves = value(`INSERT INTO item_group (code, name) VALUES ('VLV', 'Valves') RETURNING id;`);
  assert.equal(value(`SELECT next_item_number(${plates});`), 'PLT-0001');
  assert.equal(value(`SELECT next_item_number(${plates});`), 'PLT-0002');
  assert.equal(value(`SELECT next_item_number(${valves});`), 'VLV-0001',
    'each group counts from one — that is why this cannot be a single sequence');
  step('Store: item numbers run per group, and every group starts at one');

  const taken = (await Promise.all(Array.from({ length: 12 }, () =>
    run(`SELECT next_item_number(${plates});`)))).map((r) => r.out);
  assert.ok(taken.every(Boolean), `every writer should have got a number: ${taken.join(', ')}`);
  assert.equal(new Set(taken).size, taken.length,
    `twelve simultaneous writers must get twelve different item numbers, got: ${taken.join(', ')}`);
  step('Store: twelve people adding to one group at the same moment get twelve different numbers');

  refused('a number from a group that does not exist', `SELECT next_item_number(999999);`, /no such item group/);
  refused('a group that is its own parent', `UPDATE item_group SET parent_id = id WHERE id = ${plates};`, /check/i);
  const sub = value(`INSERT INTO item_group (code, name, parent_id) VALUES ('PLT-S355', 'S355 plate', ${plates}) RETURNING id;`);
  refused('deleting a group that has subgroups under it', `DELETE FROM item_group WHERE id = ${plates};`,
    /foreign key|still referenced/);
  assert.equal(value(`SELECT next_item_number(${sub});`), 'PLT-S355-0001');
  step('Store: a subgroup numbers on its own, and a group holding subgroups cannot be deleted from under them');
}

// ── Suppliers, and what they sell ─────────────────────────────────────────────────────────

function oneAnswerToWhoWeBuyFrom() {
  const f = fixture();
  const a = value(`INSERT INTO supplier (name, city) VALUES ('Stål & Metall AB', 'Malmö') RETURNING id;`);
  const b = value(`INSERT INTO supplier (name, city) VALUES ('Nordic Steel', 'Helsingborg') RETURNING id;`);
  accepted('the first supplier for an item', `INSERT INTO supplier_item
    (supplier_id, stock_item_id, article_no, price, pack_size, lead_time_days, is_preferred)
    VALUES (${a}, ${f.item}, 'ST-10-S355', 13.90, 1, 5, true);`);
  accepted('a second supplier for the same item, at their own price', `INSERT INTO supplier_item
    (supplier_id, stock_item_id, article_no, price, lead_time_days) VALUES (${b}, ${f.item}, 'NS-1055', 14.75, 12);`);
  assert.equal(value(`SELECT count(*) FROM supplier_item WHERE stock_item_id = ${f.item};`), '2',
    'the same plate bought from two merchants must keep both prices — this is the gap the table exists to close');

  refused('the same item listed twice against one supplier',
    `INSERT INTO supplier_item (supplier_id, stock_item_id, price) VALUES (${a}, ${f.item}, 12.00);`,
    /supplier_item_supplier_id_stock_item_id_key|duplicate key/);
  refused('a second preferred supplier for one item',
    `UPDATE supplier_item SET is_preferred = true WHERE supplier_id = ${b} AND stock_item_id = ${f.item};`,
    /supplier_item_one_preferred|duplicate key/);
  step('Suppliers: two merchants can both quote the same plate, and exactly one of them is the preferred one');

  refused('a negative price', `INSERT INTO supplier_item (supplier_id, stock_item_id, price)
    VALUES (${a}, (SELECT id FROM stock_item WHERE code = 'S355-10'), -1);`, /price|duplicate/);
  refused('a pack of nothing', `UPDATE supplier_item SET pack_size = 0 WHERE supplier_id = ${a};`, /pack_size/);
  refused('a lowercase currency', `UPDATE supplier_item SET currency = 'sek' WHERE supplier_id = ${a};`, /currency/);
  step('Suppliers: a price, a pack size and a currency are all shaped the one way they are read');
}

function buyingAddsUp() {
  const f = fixture();
  const supplier = value(`INSERT INTO supplier (name) VALUES ('Stål & Metall AB') RETURNING id;`);
  const order = value(`INSERT INTO purchase_order (supplier_id, project_id, ordered_by)
    VALUES (${supplier}, ${f.project}, 'Workshop Admin') RETURNING id;`);
  assert.match(value(`SELECT ref FROM purchase_order WHERE id = ${order};`), /^PO-\d{4}-\d{4}$/);
  const line = value(`INSERT INTO purchase_order_line (purchase_order_id, stock_item_id, description, quantity, unit_price)
    VALUES (${order}, ${f.item}, 'Plate S355J2 10mm', 500, 13.90) RETURNING id;`);

  refused('receiving more than was ordered',
    `UPDATE purchase_order_line SET received_quantity = 600 WHERE id = ${line};`,
    /not_more_received_than_ordered/);
  accepted('receiving part of the order', `UPDATE purchase_order_line SET received_quantity = 200 WHERE id = ${line};`);
  accepted('receiving the rest', `UPDATE purchase_order_line SET received_quantity = 500 WHERE id = ${line};`);
  refused('ordering none of something', `INSERT INTO purchase_order_line (purchase_order_id, description, quantity, unit_price)
    VALUES (${order}, 'Nothing', 0, 10);`, /quantity/);
  refused('an order expected before it was placed',
    `UPDATE purchase_order SET expected_on = ordered_on - 1 WHERE id = ${order};`, /check/i);
  refused('deleting a supplier who has orders', `DELETE FROM supplier WHERE id = ${supplier};`,
    /foreign key|still referenced/);
  step('Buying: an order cannot receive more than it asked for, arrive before it was placed, or lose its supplier');
}

// ── Offcuts and barcodes ──────────────────────────────────────────────────────────────────

function offcutsAreRealThings() {
  const f = fixture();
  const place = value(`INSERT INTO location (code, name) VALUES ('W1', 'Warehouse 1') RETURNING id;`);
  const rack = value(`INSERT INTO location (code, name, parent_id) VALUES ('W1-R3', 'Rack 3', ${place}) RETURNING id;`);
  const cut = value(`INSERT INTO offcut (stock_item_id, location_id, length_mm, width_mm, heat_no, from_jobcard_id)
    VALUES (${f.item}, ${rack}, 1250.0, 400.0, 'H-99821', ${f.jobcard}) RETURNING id;`);
  assert.match(value(`SELECT ref FROM offcut WHERE id = ${cut};`), /^OFF-\d{4}$/);

  refused('an offcut with no size at all', `INSERT INTO offcut (stock_item_id, quantity)
    VALUES (${f.item}, 1);`, /offcut_has_a_size/);
  refused('an offcut of zero length', `INSERT INTO offcut (stock_item_id, length_mm)
    VALUES (${f.item}, 0);`, /length_mm/);
  refused('a location that is its own parent', `UPDATE location SET parent_id = id WHERE id = ${place};`, /check/i);
  refused('deleting a location that still holds something', `DELETE FROM location WHERE id = ${rack};`,
    /foreign key|still referenced/);
  step('Store: an offcut has a size, a place and where it came from — and a place cannot contain itself');

  accepted('a barcode on the offcut', `INSERT INTO barcode (code, offcut_id) VALUES ('VK-OFF-0001', ${cut});`);
  accepted('a barcode on the item', `INSERT INTO barcode (code, stock_item_id) VALUES ('VK-ITM-0001', ${f.item});`);
  refused('the same barcode twice', `INSERT INTO barcode (code, stock_item_id) VALUES ('VK-ITM-0001', ${f.item});`,
    /barcode_code_key|duplicate key/);
  refused('a barcode that scans to two things', `INSERT INTO barcode (code, stock_item_id, offcut_id)
    VALUES ('VK-BOTH', ${f.item}, ${cut});`, /barcode_names_one_thing/);
  refused('a barcode that scans to nothing', `INSERT INTO barcode (code) VALUES ('VK-NOTHING');`,
    /barcode_names_one_thing/);
  step('Store: a barcode scans to exactly one thing, and only one barcode has each code');
}

// ── Before it is a project ────────────────────────────────────────────────────────────────

function thePipelineKeepsItsLinksBack() {
  const f = fixture();
  const lead = value(`INSERT INTO lead (company, contact, city, source)
    VALUES ('Skåne Verkstad AB', 'Anna Berg', 'Lund', 'trade fair') RETURNING id;`);
  sql(`INSERT INTO prospect_finding (lead_id, finding, source)
       VALUES (${lead}, 'Tendering for a 40-tonne conveyor frame', 'public procurement notice');`);
  refused('a lead converted to nobody', `UPDATE lead SET status = 'converted' WHERE id = ${lead};`,
    /converted_lead_names_the_customer/);
  accepted('a lead converted to a customer',
    `UPDATE lead SET status = 'converted', customer_id = ${f.customer} WHERE id = ${lead};`);
  step('Pipeline: a lead cannot be marked converted without naming who it became');

  refused('an opportunity belonging to nobody', `INSERT INTO opportunity (title, value)
    VALUES ('Floating enquiry', 100000);`, /opportunity_names_somebody/);
  const opp = value(`INSERT INTO opportunity (title, customer_id, lead_id, value, probability)
    VALUES ('Conveyor frame', ${f.customer}, ${lead}, 420000, 60) RETURNING id;`);
  refused('a probability over one hundred per cent',
    `UPDATE opportunity SET probability = 140 WHERE id = ${opp};`, /probability/);

  const tender = value(`INSERT INTO tender (title, opportunity_id, customer_id, due_on)
    VALUES ('Conveyor frame tender', ${opp}, ${f.customer}, '2026-11-30') RETURNING id;`);
  refused('a tender submitted on no date', `UPDATE tender SET status = 'submitted' WHERE id = ${tender};`,
    /submitted_tender_has_a_date/);
  accepted('a tender submitted with its date',
    `UPDATE tender SET status = 'submitted', submitted_on = current_date WHERE id = ${tender};`);
  accepted('the won tender naming the project it became',
    `UPDATE tender SET status = 'won', project_id = ${f.project} WHERE id = ${tender};`);

  const trail = sql(`SELECT l.company FROM project p
    JOIN tender t ON t.project_id = p.id
    JOIN opportunity o ON o.id = t.opportunity_id
    JOIN lead l ON l.id = o.lead_id
    WHERE p.id = ${f.project};`);
  assert.equal(trail, 'Skåne Verkstad AB',
    'the chain from a running project back to where the enquiry came from must still join up');
  step('Pipeline: lead to opportunity to tender to project — the chain back is walkable two years later');
}

// ── Estimating ────────────────────────────────────────────────────────────────────────────

function theEstimateTotalIsItsLines() {
  const f = fixture();
  const est = value(`INSERT INTO estimate (title, customer_id, margin_pct)
    VALUES ('Conveyor frame', ${f.customer}, 0) RETURNING id;`);
  const total = () => value(`SELECT total FROM estimate WHERE id = ${est};`);
  assert.equal(total(), '0.00', 'an estimate with no lines is worth nothing, not an invented figure');

  const first = value(`INSERT INTO estimate_line (estimate_id, kind, description, stock_item_id, quantity, unit, unit_price)
    VALUES (${est}, 'material', 'Plate S355J2 10mm', ${f.item}, 500, 'KG', 14.50) RETURNING id;`);
  assert.equal(value(`SELECT line_total FROM estimate_line WHERE id = ${first};`), '7250.00');
  assert.equal(total(), '7250.00');
  sql(`INSERT INTO estimate_line (estimate_id, kind, description, quantity, unit, unit_price)
       VALUES (${est}, 'labour', 'Welding', 40, 'H', 650);`);
  assert.equal(total(), '33250.00', 'the total should follow the lines without anybody typing it');
  sql(`UPDATE estimate_line SET quantity = 600 WHERE id = ${first};`);
  assert.equal(total(), '34700.00');
  sql(`DELETE FROM estimate_line WHERE id = ${first};`);
  assert.equal(total(), '26000.00');
  step('Estimating: the total is the sum of the lines, through every way a line changes');

  // A line total that can be written to is a price that can disagree with the quantity beside it.
  refused('writing a line total by hand',
    `UPDATE estimate_line SET line_total = 1 WHERE estimate_id = ${est};`,
    /can only be updated to DEFAULT/);
  step('Estimating: a line total cannot be typed over — it is arithmetic on its own row');

  accepted('putting a margin on it', `UPDATE estimate SET margin_pct = 15 WHERE id = ${est};`);
  assert.equal(total(), '29900.00', 'changing the margin must change the total, not only the lines');
  step('Estimating: the margin is part of the figure, and changing it recomputes the figure');

  // The same mistake the hours roll-up had: a line moved away leaves its money behind.
  const other = value(`INSERT INTO estimate (title, customer_id) VALUES ('Second job', ${f.customer}) RETURNING id;`);
  const moved = value(`INSERT INTO estimate_line (estimate_id, kind, description, quantity, unit_price)
    VALUES (${est}, 'other', 'Transport', 1, 4000) RETURNING id;`);
  assert.equal(total(), '34500.00');
  sql(`UPDATE estimate_line SET estimate_id = ${other} WHERE id = ${moved};`);
  assert.equal(value(`SELECT total FROM estimate WHERE id = ${other};`), '4000.00');
  assert.equal(total(), '29900.00', 'the money must leave the estimate the line left');
  step('Estimating: a line moved to another estimate takes its money with it');

  refused('a line for none of something', `INSERT INTO estimate_line (estimate_id, kind, description, quantity, unit_price)
    VALUES (${est}, 'other', 'Nothing', 0, 10);`, /quantity/);
  refused('a margin that gives the work away below zero',
    `UPDATE estimate SET margin_pct = -100 WHERE id = ${est};`, /margin_pct/);
  step('Estimating: a line is for some quantity, and the margin cannot wipe the price out');
}

// ── What happened to a machine ────────────────────────────────────────────────────────────

function machineHistoryIsOneShape() {
  const f = fixture();
  for (const kind of ['service', 'calibration', 'inspection', 'breakdown', 'pre-use-check', 'repair']) {
    accepted(`recording a ${kind}`, `INSERT INTO equipment_event
      (equipment_id, kind, performed_by, result, next_due_on, cost)
      VALUES (${f.equipment}, '${kind}', 'Service Engineer', 'done', current_date + 180, 2400);`);
  }
  assert.equal(value(`SELECT count(*) FROM equipment_event WHERE equipment_id = ${f.equipment};`), '6',
    'one table holds all six kinds of thing that happen to a machine');
  refused('a kind of event that does not exist', `INSERT INTO equipment_event
    (equipment_id, kind, performed_by, result) VALUES (${f.equipment}, 'vibes', 'Somebody', 'pass');`,
    /equipment_event_kind/);
  refused('a result that means nothing', `INSERT INTO equipment_event
    (equipment_id, kind, performed_by, result) VALUES (${f.equipment}, 'service', 'Somebody', 'maybe');`, /result/);
  refused('a service next due before it was done', `INSERT INTO equipment_event
    (equipment_id, kind, performed_by, result, happened_on, next_due_on)
    VALUES (${f.equipment}, 'service', 'Somebody', 'done', current_date, current_date - 1);`, /check/i);
  refused('an event nobody performed', `INSERT INTO equipment_event
    (equipment_id, kind, performed_by, result) VALUES (${f.equipment}, 'service', '  ', 'done');`, /performed_by/);
  step('Equipment: twelve tabs of history are one table, and it refuses a shape that is not history');
}

// ── Non-conformances ──────────────────────────────────────────────────────────────────────

function ncrCannotCloseOnNothing() {
  const f = fixture();
  const n = value(`INSERT INTO ncr (title, project_id, jobcard_id, category, severity, description, responsible, due_on)
    VALUES ('Porosity beyond level C', ${f.project}, ${f.jobcard}, 'welding', 'major',
            'Found on the bracket weld during visual inspection', 'Quality Manager', '2026-12-01') RETURNING ref;`);
  assert.match(n, /^NCR-\d{4}-\d{3}$/);
  refused('an NCR about nothing', `INSERT INTO ncr (title, category, description, responsible)
    VALUES ('Floating problem', 'welding', 'Somewhere', 'Quality Manager');`, /ncr_names_something/);
  refused('closing it with no root cause and no action',
    `UPDATE ncr SET status = 'closed' WHERE ref = '${n}';`, /closed_ncr_says_what_was_done/);
  refused('closing it with a root cause but no action taken',
    `UPDATE ncr SET status = 'closed', root_cause = 'Damp filler wire', closed_on = current_date
     WHERE ref = '${n}';`, /closed_ncr_says_what_was_done/);
  accepted('closing it with what was found and what was done',
    `UPDATE ncr SET status = 'closed', root_cause = 'Damp filler wire from an opened spool',
     corrective_action = 'Spool scrapped; wire now stored in the heated cabinet and logged on issue',
     closed_on = current_date WHERE ref = '${n}';`);
  step('Quality: a non-conformance closes only on what was found and what was done about it');
}

// ── Documents ─────────────────────────────────────────────────────────────────────────────

function documentsPointAtSomethingReal() {
  const f = fixture();
  accepted('a drawing on the jobcard', `INSERT INTO document
    (entity, entity_id, kind, filename, storage_key, mime_type, size_bytes, uploaded_by)
    VALUES ('jobcard', ${f.jobcard}, 'drawing', 'BR-4410-A.pdf', 'jobcard/1/BR-4410-A.pdf',
            'application/pdf', 284213, 'Workshop Admin');`);
  refused('a document filed against a table that does not exist', `INSERT INTO document
    (entity, entity_id, kind, filename, storage_key, uploaded_by)
    VALUES ('jobcards', ${f.jobcard}, 'drawing', 'x.pdf', 'x/1.pdf', 'Admin');`, /entity/);
  refused('two documents on one file in storage', `INSERT INTO document
    (entity, entity_id, kind, filename, storage_key, uploaded_by)
    VALUES ('project', ${f.project}, 'drawing', 'again.pdf', 'jobcard/1/BR-4410-A.pdf', 'Admin');`,
    /storage_key|duplicate key/);
  refused('an empty file', `INSERT INTO document
    (entity, entity_id, kind, filename, storage_key, size_bytes, uploaded_by)
    VALUES ('project', ${f.project}, 'drawing', 'empty.pdf', 'project/1/empty.pdf', 0, 'Admin');`, /size_bytes/);
  refused('a document nobody uploaded', `INSERT INTO document
    (entity, entity_id, kind, filename, storage_key, uploaded_by)
    VALUES ('project', ${f.project}, 'drawing', 'anon.pdf', 'project/1/anon.pdf', '  ');`, /uploaded_by/);
  step('Documents: a document names a table that exists, a file that is there, and who put it there');
}

// ── The facts that cannot be back-filled ──────────────────────────────────────────────────

// BACKEND.md decided against a certification subsystem and in the same breath decided to keep the
// few facts that make one possible later. Those fields being present is the whole of that decision,
// so their absence should fail rather than be noticed in two years.
function theHistoryCertificationWouldNeed() {
  const f = fixture();
  accepted('recording who welded it and with what',
    `UPDATE operation SET worker = 'Marko Ilić', filler = 'ESAB OK Autrod 12.51 ø1.0'
     WHERE id = ${f.op1};`);
  accepted('recording the material that went into the job',
    `UPDATE jobcard SET heat_no = 'H-99821', material_cert_ref = '3.1 EN 10204 / SSAB 2026-0412'
     WHERE id = ${f.jobcard};`);
  const kept = sql(`SELECT o.worker || ' | ' || o.filler || ' | ' || j.heat_no || ' | ' || j.material_cert_ref
    FROM operation o JOIN jobcard j ON j.id = o.jobcard_id WHERE o.id = ${f.op1};`);
  assert.equal(kept, 'Marko Ilić | ESAB OK Autrod 12.51 ø1.0 | H-99821 | 3.1 EN 10204 / SSAB 2026-0412');
  step('Records: who welded it, with what filler, from which heat, against which certificate — kept from day one');
}

// ── Which status may follow which ─────────────────────────────────────────────────────────

function workTravelsInOrder() {
  const f = fixture();
  const message = refused('a jobcard jumping straight from draft to completed',
    `UPDATE jobcard SET status = 'completed' WHERE id = ${f.jobcard};`, /cannot go from draft to completed/);
  assert.match(message, /from draft it may only become cancelled, released/,
    `the refusal must say what IS allowed, or the person reading it is no better off — said: ${message}`);
  step('Status: a job cannot jump to finished, and the refusal says where it can actually go');

  // Every step of the real path, in order, as the workshop walks it.
  for (const next of [...READY_TO_FINISH, 'completed', 'closed']) {
    accepted(`moving it to ${next}`, `UPDATE jobcard SET status = '${next}' WHERE id = ${f.jobcard};`);
  }
  refused('reopening a closed jobcard', `UPDATE jobcard SET status = 'in-progress' WHERE id = ${f.jobcard};`,
    /nothing — it is finished/);
  step('Status: the whole path from draft to closed is walkable, and closed is the end of it');

  // An update that does not touch the status must not be refused for the status it never changed.
  accepted('editing a closed jobcard without touching its status',
    `UPDATE jobcard SET item = 'Bracket, revision B' WHERE id = ${f.jobcard};`);
  accepted('setting the status to what it already is',
    `UPDATE jobcard SET status = 'closed' WHERE id = ${f.jobcard};`);
  step('Status: a job that is not moving is not stopped — editing other columns still works');

  const paused = fixture();
  advance('jobcard', paused.jobcard, 'released', 'ready', 'in-progress', 'paused');
  accepted('resuming to where it was paused from',
    `UPDATE jobcard SET status = 'in-progress' WHERE id = ${paused.jobcard};`);
  sql(`UPDATE jobcard SET status = 'paused' WHERE id = ${paused.jobcard};`);
  refused('resuming a paused job straight into completed',
    `UPDATE jobcard SET status = 'completed' WHERE id = ${paused.jobcard};`, /cannot go from paused to completed/);
  step('Status: a paused job resumes to a status it could have been paused from, and nowhere else');

  const cancelled = fixture();
  sql(`UPDATE jobcard SET status = 'cancelled' WHERE id = ${cancelled.jobcard};`);
  refused('un-cancelling a cancelled job',
    `UPDATE jobcard SET status = 'draft' WHERE id = ${cancelled.jobcard};`, /nothing — it is finished/);
  step('Status: a cancelled job stays cancelled — anything else is a new document');
}

function theProjectTravelsInOrderToo() {
  const f = fixture();
  refused('a project going straight from quotation to production',
    `UPDATE project SET status = 'production' WHERE id = ${f.project};`,
    /cannot go from quotation to production/);
  for (const next of ['approved', 'planned', 'production', 'completed', 'closed']) {
    accepted(`moving the project to ${next}`, `UPDATE project SET status = '${next}' WHERE id = ${f.project};`);
  }
  accepted('reopening a closed project, which the screen does offer',
    `UPDATE project SET status = 'production' WHERE id = ${f.project};`);
  accepted('putting it on hold', `UPDATE project SET status = 'hold' WHERE id = ${f.project};`);
  accepted('taking it off hold', `UPDATE project SET status = 'production' WHERE id = ${f.project};`);
  refused('cancelling a project that is already completed',
    `UPDATE project SET status = 'completed' WHERE id = ${f.project};
     UPDATE project SET status = 'cancelled' WHERE id = ${f.project};`, /cannot go from completed to cancelled/);
  step('Status: the project follows its own sequence, reopens the way the screen says, and cannot be cancelled once finished');

  // The rulebook is data, which is the point: the argument about workflow is settled by editing a
  // row. Checked by adding the transition and watching the same move go through.
  sql(`INSERT INTO allowed_transition (entity, from_status, to_status)
       VALUES ('project', 'completed', 'cancelled');`);
  accepted('the same move once the rulebook allows it',
    `UPDATE project SET status = 'cancelled' WHERE id = ${f.project};`);
  sql(`DELETE FROM allowed_transition WHERE entity = 'project' AND from_status = 'completed' AND to_status = 'cancelled';`);
  step('Status: the sequence is a table, so changing the workflow is changing a row and not a deployment');

  refused('a rule that lets a status follow itself', `INSERT INTO allowed_transition (entity, from_status, to_status)
    VALUES ('project', 'hold', 'hold');`, /check/i);
  // A typo here is not an error message, it is a rule that quietly does nothing — or a missing rule
  // that quietly refuses real work. Both are invisible until somebody's job will not move.
  refused('a rule with a misspelled status', `INSERT INTO allowed_transition (entity, from_status, to_status)
    VALUES ('jobcard', 'in-progres', 'completed');`, /invalid input value for enum|statuses_are_real/);
  refused('a jobcard rule using a project status', `INSERT INTO allowed_transition (entity, from_status, to_status)
    VALUES ('jobcard', 'quotation', 'planned');`, /invalid input value for enum|statuses_are_real/);
  refused('a rule for something that is not a jobcard or a project',
    `INSERT INTO allowed_transition (entity, from_status, to_status) VALUES ('invoice', 'a', 'b');`, /entity/);
  step('Status: the rulebook itself has rules');
}

// ── A price that has gone to the customer ─────────────────────────────────────────────────

function repricingALockedLineNeedsAReasonAndAName() {
  const f = fixture();
  const est = value(`INSERT INTO estimate (title, customer_id) VALUES ('Conveyor frame', ${f.customer}) RETURNING id;`);
  const line = value(`INSERT INTO estimate_line (estimate_id, kind, description, quantity, unit_price)
    VALUES (${est}, 'material', 'Plate S355J2 10mm', 500, 14.50) RETURNING id;`);

  accepted('repricing it freely before it goes out',
    `UPDATE estimate_line SET unit_price = 14.90 WHERE id = ${line};`);
  step('Estimating: before the estimate goes to the customer a price is just a price');

  sql(`UPDATE estimate_line SET locked = true WHERE id = ${line};
       UPDATE estimate SET status = 'sent' WHERE id = ${est};`);

  const message = refused('repricing a line that has gone to the customer',
    `UPDATE estimate_line SET unit_price = 18.00 WHERE id = ${line};`, /needs a reason and a name/);
  assert.ok(message.includes('Plate S355J2 10mm'), `the refusal must name the line — said: ${message}`);
  refused('repricing it with a reason but nobody behind it',
    `UPDATE estimate_line SET unit_price = 18.00, reprice_reason = 'Mill price rose' WHERE id = ${line};`,
    /needs a reason and a name/);
  refused('repricing it with a name but no reason',
    `UPDATE estimate_line SET unit_price = 18.00, repriced_by = 'Workshop Admin' WHERE id = ${line};`,
    /needs a reason and a name/);
  refused('changing the quantity instead, which changes the price just as much',
    `UPDATE estimate_line SET quantity = 800 WHERE id = ${line};`, /needs a reason and a name/);
  assert.equal(value(`SELECT unit_price FROM estimate_line WHERE id = ${line};`), '14.90',
    'a refused reprice must leave the price where the customer last saw it');
  step('Estimating: a line that has gone out cannot be repriced, or requantified, without a reason and a name');

  accepted('repricing it properly', `UPDATE estimate_line SET unit_price = 18.00,
    reprice_reason = 'SSAB raised the mill price on 2026-09-15; customer informed by email',
    repriced_by = 'Workshop Admin' WHERE id = ${line};`);
  assert.ok(value(`SELECT repriced_at FROM estimate_line WHERE id = ${line};`),
    'the time of a reprice is recorded without anybody having to remember to write it');
  assert.equal(value(`SELECT total FROM estimate WHERE id = ${est};`), '9000.00',
    'the estimate total must follow a reprice like any other change');
  step('Estimating: with a reason, a name and an automatic timestamp, the reprice goes through and the total follows');

  // The cheapest thing a caller can do is leave the old justification sitting in the column and
  // keep repricing. Then the column records nothing, which is worse than not having it.
  refused('repricing again on the reason already recorded',
    `UPDATE estimate_line SET unit_price = 21.00 WHERE id = ${line};`, /already repriced for that reason/);
  accepted('repricing again with its own reason', `UPDATE estimate_line SET unit_price = 21.00,
    reprice_reason = 'Second mill increase 2026-09-20' WHERE id = ${line};`);
  step('Estimating: each reprice needs its own reason — the last one cannot be left standing and reused');

  accepted('adding a new line to a sent estimate', `INSERT INTO estimate_line
    (estimate_id, kind, description, quantity, unit_price) VALUES (${est}, 'labour', 'Welding', 40, 650);`);
  step('Estimating: locking a line does not freeze the whole estimate — a new line is a new line');
}

// ── The run ───────────────────────────────────────────────────────────────────────────────

function buildDatabase() {
  try {
    execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', 'postgres', '-qtAX',
      '-c', `DROP DATABASE IF EXISTS ${DB};`, '-c', `CREATE DATABASE ${DB};`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    console.error(`Cannot reach PostgreSQL at ${HOST}:${PORT} as ${USER}.`);
    console.error('These tests run against a real database on purpose — locks and unique indexes');
    console.error('cannot be tested against a mock. Start one and run again:');
    console.error('  pg_ctl -D <datadir> -o "-k /tmp -p 5433" start');
    console.error(String(error.stderr || error.message).trim());
    process.exit(1);
  }
  execFileSync('psql', [...conn(DB), '-f', SCHEMA], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function main() {
  buildDatabase();
  console.log(`Schema built fresh into ${DB} from ${path.basename(SCHEMA)}.\n`);

  everyTableIsAccountedFor();
  await countingRowsCollides();
  await sequencesNeverCollide();
  passwordsAreNeverHalfStored();
  holdBlocksCompletion();
  holdStopsFinishedWorkLeaving();
  holdOnProjectBlocksItsJobcards();
  holdOnJobcardBlocksItsProject();
  holdNamesExactlyOneThing();
  equipmentGateStopsStart();
  expiredCertificationStopsStart();
  machineCannotBeInTwoPlaces();
  dependencyGateStopsStart();
  dependencyCannotLoop();
  hoursRollUp();
  hoursMustBePossible();
  stockNeverGoesNegative();
  issuingLeavesATrail();
  await twoPeopleCannotIssueTheSameLastPiece();
  historyCannotBeEdited();
  nothingIsOrphanedOrErased();
  workTravelsInOrder();
  theProjectTravelsInOrderToo();
  repricingALockedLineNeedsAReasonAndAName();
  await perGroupNumbersNeverCollide();
  oneAnswerToWhoWeBuyFrom();
  buyingAddsUp();
  offcutsAreRealThings();
  thePipelineKeepsItsLinksBack();
  theEstimateTotalIsItsLines();
  machineHistoryIsOneShape();
  ncrCannotCloseOnNothing();
  documentsPointAtSomethingReal();
  theHistoryCertificationWouldNeed();

  console.log(`\n${checks} checks: ${attempts.refused} things the schema refused, `
    + `${attempts.allowed} it allowed, every refusal asserted on its wording.`);
}

main().catch((error) => {
  console.error(`\n${error.message || error}`);
  if (error.stack) console.error(error.stack.split('\n').slice(1, 4).join('\n'));
  process.exitCode = 1;
});
