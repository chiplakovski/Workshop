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
const { ensureUp } = require('./pg');
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
  'app_user', 'customer', 'customer_contact', 'project', 'jobcard', 'equipment', 'equipment_assignment',
  'equipment_event', 'operation', 'hours_entry', 'item_group', 'location', 'stock_item',
  'stock_movement', 'offcut', 'barcode', 'supplier', 'supplier_contact', 'supplier_item',
  'purchase_order',
  'purchase_order_line', 'lead', 'prospect_finding', 'opportunity', 'tender', 'estimate',
  'estimate_line', 'quality_hold', 'inspection', 'inspection_check', 'ncr', 'document',
  // The welding registers. In the truncate list because a fixture that leaves a weld behind is a fixture
  // whose next test counts one more than it should — and the weld log is the one register where a row
  // nobody expected is indistinguishable from a real one.
  'wps', 'welder_qual', 'weld', 'weld_repair', 'ndt_report',
  'activity_log'
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
  // The column has to look like a bcrypt hash, so there is no way to put a password in it. This
  // replaced a password_hash/password_salt pair whose constraint only checked that both were set
  // together — which 'password' and 'salt' satisfy perfectly.
  refused('a password stored as itself', `INSERT INTO app_user (email, display_name, password_hash)
    VALUES ('plain@varmak.se', 'Plain Text', 'hunter2');`, /password_is_hashed/);
  refused('something that merely looks hashed', `INSERT INTO app_user (email, display_name, password_hash)
    VALUES ('md5@varmak.se', 'MD5 Era', '5f4dcc3b5aa765d61d8327deb882cf99');`, /password_is_hashed/);
  refused('a bcrypt hash with no cost in it', `INSERT INTO app_user (email, display_name, password_hash)
    VALUES ('odd@varmak.se', 'Malformed', '$2a$notacost$abcdefghijklmnopqrstuv');`, /password_is_hashed/);
  accepted('a user with no password yet', `INSERT INTO app_user (email, display_name)
    VALUES ('new@varmak.se', 'Not Yet Set');`);
  accepted('a real bcrypt hash', `INSERT INTO app_user (email, display_name, password_hash, role)
    VALUES ('admin@varmak.se', 'Workshop Admin',
            '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'admin');`);
  step('Users: the password column can only hold a bcrypt hash, so a plain-text password cannot go in it');

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
  // All six the screen's gate blocks on, not four of them. The database used to be the more permissive
  // of the two, which meant the rule the screen enforced was not the system's rule.
  for (const state of ['Out of Service', 'Under Maintenance', 'Maintenance Due',
                       'Inspection Required', 'Quarantined', 'Retired']) {
    sql(`UPDATE equipment SET status = '${state}' WHERE id = ${f.equipment};
         UPDATE operation SET equipment_id = ${f.equipment}, status = 'pending' WHERE id = ${f.op1};`);
    const message = refused(`starting work on a ${state} machine`,
      `UPDATE operation SET status = 'in-progress' WHERE id = ${f.op1};`, /cannot start/);
    assert.ok(message.includes(state), `the refusal must say what is wrong with the machine — said: ${message}`);
    assert.ok(message.includes('Fixture MIG 400'), 'the refusal must name the machine');
  }
  step('Equipment: work cannot start on any of the six states the screen\'s own gate blocks on');

  sql(`UPDATE equipment SET status = 'Available' WHERE id = ${f.equipment};`);
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

function failedPreUseCheckStopsStart() {
  const f = fixture();
  sql(`UPDATE equipment SET status = 'Available', certification_expiry = NULL WHERE id = ${f.equipment};
       UPDATE operation SET equipment_id = ${f.equipment}, status = 'pending' WHERE id = ${f.op1};`);
  const failed = value(`INSERT INTO equipment_event (equipment_id, kind, performed_by, result, note)
    VALUES (${f.equipment}, 'pre-use-check', 'Marko Ilic', 'fail', 'gas leak at the torch')
    RETURNING id;`);
  const message = refused('starting on a machine whose pre-use check failed this morning',
    `UPDATE operation SET status = 'in-progress' WHERE id = ${f.op1};`,
    /a pre-use check on .+ failed and has not been answered/);
  assert.ok(message.includes('Fixture MIG 400'), `the refusal must name the machine — said: ${message}`);

  // A later check that passed is what answers it, and it has to say which failure it answers.
  const passed = value(`INSERT INTO equipment_event
    (equipment_id, kind, performed_by, result, resolves_event_id, note)
    VALUES (${f.equipment}, 'pre-use-check', 'Marko Ilic', 'pass', ${failed}, 'hose replaced')
    RETURNING id;`);
  refused('starting while the failure is still marked unresolved',
    `UPDATE operation SET status = 'in-progress' WHERE id = ${f.op1};`, /pre-use check/);
  sql(`UPDATE equipment_event SET resolved = true WHERE id = ${failed};`);
  accepted('starting once the failure has been answered',
    `UPDATE operation SET status = 'in-progress' WHERE id = ${f.op1};`);
  step('Equipment: a failed pre-use check stops the start until it is answered, and the answer names it');

  // The three ways of writing a resolution that would mean nothing.
  refused('a failed check resolving something',
    `INSERT INTO equipment_event (equipment_id, kind, performed_by, result, resolves_event_id)
     VALUES (${f.equipment}, 'pre-use-check', 'Marko Ilic', 'fail', ${passed});`,
    /equipment_event_check|resolves_event_id/);
  // A second machine, because the interesting version of this mistake is cross-machine and the first
  // attempt at this check used the same machine twice — which is legal, and passed while testing
  // nothing at all.
  const other = value(`INSERT INTO equipment (ref, name, category)
    VALUES ('EQ-OTHER', 'Fixture plasma', 'cutting') RETURNING id;`);
  refused('an event resolving one about another machine',
    `INSERT INTO equipment_event (equipment_id, kind, performed_by, result, resolves_event_id)
     VALUES (${other}, 'repair', 'Anna Berg', 'done', ${failed});`,
    /same machine/);
  step('Equipment: a failure cannot be answered by another failure, nor by an event about another machine');
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

  // Hours booked to a jobcard without naming an operation, which is what the phone screen does when
  // a welder picks a job rather than a step. Both sides of the roll-up are then null, and the
  // trigger used to die on "FOREACH expression must not be null" — taking the whole booking with it.
  accepted('booking hours against a job but no particular operation',
    `INSERT INTO hours_entry (jobcard_id, worker, hours) VALUES (${f.jobcard}, 'Welder D', 3);`);
  assert.equal(value(`SELECT logged_hours::text FROM operation WHERE id = ${f.op1};`), '2.00',
    'hours booked to no operation must not land on one');
  step('Hours: an entry that names a job but no operation books cleanly and lands on no operation');

  const honest = value(`SELECT (SELECT COALESCE(SUM(hours),0) FROM hours_entry WHERE operation_id = ${f.op1})
    = (SELECT logged_hours FROM operation WHERE id = ${f.op1});`);
  assert.equal(honest, 't', 'the running total and the entries must agree');
  step('Hours: the total and the entries agree when asked the long way round');
}

// The project's own figure, kept the same way the operation's is. A project is judged late or over
// by this number, so it cannot be one somebody types.
function theProjectKnowsItsOwnHours() {
  const f = fixture();
  const second = value(`INSERT INTO jobcard (project_id, title) VALUES (${f.project}, 'Second jobcard') RETURNING id;`);
  const used = () => value(`SELECT used_hours FROM project WHERE id = ${f.project};`);
  assert.equal(used(), '0.00', 'a project with no hours booked against it has used none');

  const entry = value(`INSERT INTO hours_entry (jobcard_id, operation_id, worker, hours)
    VALUES (${f.jobcard}, ${f.op1}, 'Welder A', 6) RETURNING id;`);
  assert.equal(used(), '6.00');
  sql(`INSERT INTO hours_entry (jobcard_id, worker, hours) VALUES (${second}, 'Welder B', 4);`);
  assert.equal(used(), '10.00', 'hours on any jobcard of the project count towards the project');
  sql(`UPDATE hours_entry SET hours = 2 WHERE id = ${entry};`);
  assert.equal(used(), '6.00');
  sql(`DELETE FROM hours_entry WHERE id = ${entry};`);
  assert.equal(used(), '4.00');
  step("Hours: the project's used hours are the sum of everything booked to its jobcards");

  // The case the operation roll-up got wrong the first time, asked of this one before it could.
  const elsewhere = value(`INSERT INTO project (name, customer_id) VALUES ('Another job', ${f.customer}) RETURNING id;`);
  const elsewhereJob = value(`INSERT INTO jobcard (project_id, title) VALUES (${elsewhere}, 'Its jobcard') RETURNING id;`);
  const moved = value(`INSERT INTO hours_entry (jobcard_id, worker, hours)
    VALUES (${second}, 'Welder C', 5) RETURNING id;`);
  assert.equal(used(), '9.00');
  sql(`UPDATE hours_entry SET jobcard_id = ${elsewhereJob} WHERE id = ${moved};`);
  assert.equal(value(`SELECT used_hours FROM project WHERE id = ${elsewhere};`), '5.00');
  assert.equal(used(), '4.00', 'the hours must leave the project they were moved away from');
  step('Hours: an entry moved to another project takes its hours with it, off one figure and onto the other');
}

// A project stopped or cancelled has to say why, because both are decisions somebody made and the
// record is the only place the reason survives.
function stoppingAJobIsOnTheRecord() {
  const f = fixture();
  advance('project', f.project, 'approved', 'planned');
  refused('putting a project on hold with no reason',
    `UPDATE project SET status = 'hold' WHERE id = ${f.project};`, /held_project_says_why/);
  refused('a reason of nothing but spaces',
    `UPDATE project SET status = 'hold', hold_reason = '   ' WHERE id = ${f.project};`,
    /held_project_says_why/);
  accepted('putting it on hold with a reason',
    `UPDATE project SET status = 'hold', hold_reason = 'Waiting on a drawing revision',
     expected_resume = current_date + 14 WHERE id = ${f.project};`);
  assert.equal(value(`SELECT status FROM project WHERE id = ${f.project};`), 'hold');
  step('Records: a project on hold says why, and when it is expected back');

  refused('cancelling with no reason',
    `UPDATE project SET status = 'cancelled' WHERE id = ${f.project};`, /cancelled_project_says_why/);
  accepted('cancelling with one',
    `UPDATE project SET status = 'cancelled', cancel_reason = 'Customer withdrew' WHERE id = ${f.project};`);
  step('Records: and a cancelled project says why it was cancelled');

  const g = fixture();
  refused('a job that finished before it started',
    `UPDATE jobcard SET actual_start = '2026-06-01', actual_completion = '2026-05-01' WHERE id = ${g.jobcard};`,
    /check/i);
  refused('a project finished before it started',
    `UPDATE project SET actual_start = '2026-06-01', actual_completion = '2026-05-01' WHERE id = ${g.project};`,
    /check/i);
  step('Records: neither a job nor a project can have finished before it started');
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
  // Two rules refuse this now and either is a correct answer: hours_entry.jobcard_id is RESTRICT, and
  // the cascade to the jobcard's steps hits the trigger that will not let a step with hours on it go.
  // The second one says more — it names the step and the hours — which is why the wording is allowed
  // to be either rather than pinned to the foreign key it used to be.
  refused('deleting a jobcard that has hours booked to it', `DELETE FROM jobcard WHERE id = ${f.jobcard};`,
    /foreign key|still referenced|hours booked on it/);
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

  // The register itself, which held a name, a town and a payment term while the screen showed an
  // address, a VAT number, a website, what they sell, the Incoterms, a minimum order and a rating. The
  // screen was filling every one of those in for itself, which is why they are columns now.
  accepted('a merchant recorded whole', `UPDATE supplier SET vat_no = 'SE556700000001',
    website = 'www.stalmetall.se', address = 'Industrivägen 8, 212 41 Malmö', category = 'Steel',
    supplier_type = 'Company', established = '1998', delivery_terms = 'DAP',
    minimum_order = '2 500 SEK', payment_terms_days = 30, rating = 4.5, status = 'preferred',
    notes = 'Cuts to length on request' WHERE id = ${a};`);
  // 'preferred' is the merchant this workshop buys from first, and the screen has offered it since it
  // was written — three filter tabs, a chip beside the name — against a column that allowed two words.
  // Fifth time a screen's vocabulary and a column's were found disagreeing.
  for (const st of ['active', 'preferred', 'inactive']) {
    accepted(`the status the screen offers: ${st}`,
      `UPDATE supplier SET status = '${st}' WHERE id = ${b};`);
  }
  refused('a status no screen has a word for',
    `UPDATE supplier SET status = 'maybe' WHERE id = ${b};`, /status/);
  // Out of five, and nobody has to rate anybody. A NULL rating has to stay tellable from a rating of
  // zero: the screen printed four stars beside every supplier's name because absence was being filled
  // in with 4, which is a judgement about a real merchant that nobody made.
  refused('a rating out of more than five', `UPDATE supplier SET rating = 6 WHERE id = ${b};`, /rating/);
  refused('a rating below nothing', `UPDATE supplier SET rating = -1 WHERE id = ${b};`, /rating/);
  accepted('no rating at all', `UPDATE supplier SET rating = NULL WHERE id = ${b};`);
  assert.equal(value(`SELECT rating IS NULL FROM supplier WHERE id = ${b};`), 't',
    'nobody having rated a merchant is not the same fact as rating them zero');
  step('Suppliers: the register holds what the screen shows, including the three states it filters by');

  accepted('somebody to ring at the merchant', `INSERT INTO supplier_contact
    (supplier_id, name, role, email, phone, is_primary)
    VALUES (${a}, 'Erik Lund', 'Order desk', 'order@stalmetall.se', '+46 40 555 01 20', true);`);
  accepted('and somebody in accounts', `INSERT INTO supplier_contact
    (supplier_id, name, role, email) VALUES (${a}, 'Ann Ek', 'Accounts', 'ann@stalmetall.se');`);
  refused('a second main contact at one merchant', `INSERT INTO supplier_contact
    (supplier_id, name, phone, is_primary) VALUES (${a}, 'Somebody Else', '+46 40 555 01 21', true);`,
    /supplier_has_one_main_contact|duplicate key/);
  refused('a contact nobody can reach', `INSERT INTO supplier_contact
    (supplier_id, name, role) VALUES (${a}, 'Nameless Desk', 'Sales');`,
    /supplier_contact_can_be_reached/);
  refused('a contact with no name', `INSERT INTO supplier_contact
    (supplier_id, name, phone) VALUES (${a}, '  ', '+46 40 555 01 22');`, /name/);
  sql(`DELETE FROM supplier WHERE id = ${a};`);
  assert.equal(value(`SELECT count(*) FROM supplier_contact WHERE supplier_id = ${a};`), '0',
    'contacts go with the merchant rather than becoming rows pointing at nobody');
  step('Suppliers: one main contact per merchant, reachable, and they go with the merchant');
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

  // The one thing an offcut register has to get right is whether the piece is still on the rack, so
  // the status and the date it was used up have to agree.
  refused('an offcut marked used up with no date',
    `UPDATE offcut SET status = 'consumed' WHERE id = ${cut};`, /consumed_offcut_says_when/);
  refused('an offcut dated as used up but still listed available',
    `UPDATE offcut SET consumed_at = now() WHERE id = ${cut};`, /consumed_offcut_says_when/);
  accepted('marking it used up properly',
    `UPDATE offcut SET status = 'consumed', consumed_at = now() WHERE id = ${cut};`);
  accepted('putting it back on the rack',
    `UPDATE offcut SET status = 'available', consumed_at = NULL WHERE id = ${cut};`);
  refused('a status that is not a state a piece of steel can be in',
    `UPDATE offcut SET status = 'maybe' WHERE id = ${cut};`, /check/i);
  step('Store: an offcut is either on the rack or used up on a date — it cannot say both');

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
  // Awarded and declined both mean it went in, so both are held to the date too. Asked only of
  // 'submitted', a tender could be recorded as awarded having apparently never been sent.
  refused('a tender awarded having apparently never been sent',
    `UPDATE tender SET status = 'awarded' WHERE id = ${tender};`, /submitted_tender_has_a_date/);
  refused('and declined the same way',
    `UPDATE tender SET status = 'declined' WHERE id = ${tender};`, /submitted_tender_has_a_date/);
  // The two states a tender sits in while it is being put together, which the screen offers and the
  // column refused. Those need no date, because nothing has gone anywhere.
  accepted('one still being put together',
    `UPDATE tender SET status = 'in-progress' WHERE id = ${tender};`);
  accepted('one out for internal review',
    `UPDATE tender SET status = 'reviewing' WHERE id = ${tender};`);
  accepted('a tender submitted with its date',
    `UPDATE tender SET status = 'submitted', submitted_on = current_date WHERE id = ${tender};`);
  accepted('the awarded tender naming the project it became',
    `UPDATE tender SET status = 'awarded', project_id = ${f.project} WHERE id = ${tender};`);

  // The pipeline board's own eight columns. A card is dragged between them, so a column the enum has no
  // word for is a drag that is refused — and 'rfq' and 'qualified' had no word at all.
  for (const stage of ['discovery', 'qualified', 'rfq', 'preparing', 'quotesent', 'negotiation', 'won']) {
    accepted(`the stage the board drags a card into: ${stage}`,
      `UPDATE opportunity SET stage = '${stage}' WHERE id = ${opp};`);
  }
  refused('a stage no column on the board has a word for',
    `UPDATE opportunity SET stage = 'thinking-about-it' WHERE id = ${opp};`,
    /opportunity_stage|invalid input/);
  // A lead the filter can show as disqualified, which the column refused: disqualified is not lost. A
  // lead is disqualified because it was never going to be work; an opportunity is lost, to somebody.
  accepted('a lead disqualified rather than lost',
    `UPDATE lead SET status = 'disqualified' WHERE id = ${lead};`);
  step('Pipeline: the board\'s eight columns and the tender\'s five states are the ones the screen has');

  // A tender arrives from a company this workshop may have no customer record for — that is what
  // tendering is — so it may name one outright, and it must name something.
  refused('a tender from nobody', `INSERT INTO tender (title) VALUES ('Floating tender');`,
    /tender_is_from_somebody/);
  const outside = value(`INSERT INTO tender (title, company, customer_ref, source, industry,
      description, requirements, responsible, due_on, reminder_on, bid_decision)
    VALUES ('Harbour gantry', 'Helsingborgs Hamn AB', 'HH-2026-441', 'Public procurement', 'Marine',
            'Two gantry frames, hot-dip galvanised', 'EN 1090-2 EXC3', 'Lars Holm',
            '2026-11-30', '2026-11-20', 'pending') RETURNING id;`);
  assert.equal(value(`SELECT company || '|' || customer_ref || '|' || responsible || '|'
    || reminder_on::text FROM tender WHERE id = ${outside};`),
    'Helsingborgs Hamn AB|HH-2026-441|Lars Holm|2026-11-20',
    'the nine fields the tender screen showed and the table had nowhere to keep');
  refused('a bid decision that means nothing',
    `UPDATE tender SET bid_decision = 'maybe' WHERE id = ${outside};`, /bid_decision/);
  // Deciding not to bid and then submitting one is a contradiction the register should not hold.
  accepted('deciding not to bid', `UPDATE tender SET bid_decision = 'no-bid' WHERE id = ${outside};`);
  refused('and submitting it anyway',
    `UPDATE tender SET status = 'submitted', submitted_on = current_date WHERE id = ${outside};`,
    /no_bid_means_no_tender/);
  accepted('bidding after all, then submitting',
    `UPDATE tender SET bid_decision = 'bid', status = 'submitted', submitted_on = current_date
     WHERE id = ${outside};`);
  step('Pipeline: a tender says who it is from, whether we are bidding, and cannot be both no-bid and sent');

  sql(`UPDATE lead SET status = 'converted', customer_id = ${f.customer} WHERE id = ${lead};`);
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

// An inspection recorded as passed or failed with no date it happened on is not evidence of
// anything, and a re-inspection has to point at the one it is repeating or the history of a weld
// that was rejected and re-run reads as two unrelated events.
function anInspectionIsEvidenceOrItIsNothing() {
  const f = fixture();
  refused('an inspection passed on no particular day',
    `INSERT INTO inspection (jobcard_id, kind, inspector, result)
     VALUES (${f.jobcard}, 'visual', 'Inspector', 'passed');`, /decided_inspection_has_a_date/);
  accepted('one still waiting to be done',
    `INSERT INTO inspection (jobcard_id, kind, inspector, planned_date)
     VALUES (${f.jobcard}, 'visual', 'Inspector', current_date + 3);`);
  accepted('one written off as not applicable, with no date and no pretence of one',
    `INSERT INTO inspection (jobcard_id, kind, inspector, result, status)
     VALUES (${f.jobcard}, 'visual', 'Inspector', 'not-applicable', 'cancelled');`);
  const failed = value(`INSERT INTO inspection (jobcard_id, operation, kind, drawing_no, drawing_rev,
      method, acceptance_criteria, customer_witness, inspector, result, actual_date, status,
      critical, findings)
    VALUES (${f.jobcard}, 'Weld seam 3, root pass', 'welding', 'BR-4410', 'C', 'visual + PT',
            'ISO 5817 level C', true, 'Inspector',
            'failed', current_date, 'completed', true, 'Porosity beyond level C') RETURNING id;`);
  step('Quality: an inspection with a result has a date it happened on; one still to be done does not pretend to');

  // Passed with observations is the result that says "acceptable, but". With the box empty it says
  // only "acceptable", and the observation nobody wrote down is the entire value of the category.
  refused('passed with observations and nothing observed',
    `INSERT INTO inspection (jobcard_id, kind, inspector, result, actual_date, status)
     VALUES (${f.jobcard}, 'visual', 'Inspector', 'passed-observations', current_date, 'completed');`,
    /observations_say_what_was_observed/);
  accepted('passed with observations, and the observation',
    `INSERT INTO inspection (jobcard_id, kind, inspector, result, actual_date, status, findings)
     VALUES (${f.jobcard}, 'visual', 'Inspector', 'passed-observations', current_date, 'completed',
             'Undercut at the toe, within tolerance, dressed');`);

  // The six the screens actually write. Three of these were refused by the CHECK this replaced, which
  // is a rule nobody could have obeyed: an inspector moving a request to in-progress got an error.
  for (const s of ['draft', 'planned', 'requested', 'in-progress', 'completed', 'cancelled']) {
    accepted(`the status a screen writes: ${s}`,
      `INSERT INTO inspection (jobcard_id, kind, inspector, status)
       VALUES (${f.jobcard}, 'visual', 'Inspector', '${s}');`);
  }
  refused('a status no screen has a word for',
    `INSERT INTO inspection (jobcard_id, kind, inspector, status)
     VALUES (${f.jobcard}, 'visual', 'Inspector', 'nearly');`, /status/);
  step('Quality: the six inspection statuses are the six the screen writes, and nothing else');

  const again = value(`INSERT INTO inspection (jobcard_id, kind, inspector, result, actual_date,
      status, reinspection_of, findings)
    VALUES (${f.jobcard}, 'welding', 'Inspector', 'passed', current_date, 'completed', ${failed},
            'Ground out and re-run; PT accepted') RETURNING id;`);
  refused('an inspection that re-inspects itself',
    `UPDATE inspection SET reinspection_of = id WHERE id = ${again};`, /check/i);
  const story = sql(`SELECT first.findings || ' → ' || second.findings
    FROM inspection second JOIN inspection first ON first.id = second.reinspection_of
   WHERE second.id = ${again};`);
  assert.equal(story, 'Porosity beyond level C → Ground out and re-run; PT accepted',
    'the rejected weld and its re-inspection must read as one story');
  step('Quality: a re-inspection points back at the failure it repeats, and cannot point at itself');

  // The checklist is the evidence. Without it a passed final inspection on a pressure vessel is one
  // word in a database.
  accepted('a line somebody signed off', `INSERT INTO inspection_check
    (inspection_id, line_no, item, result) VALUES (${failed}, 1, 'Weld cap profile', 'pass');`);
  accepted('a measured line, with the band it was measured against', `INSERT INTO inspection_check
    (inspection_id, line_no, item, nominal, tol_lower, tol_upper, actual)
    VALUES (${failed}, 2, 'Overall length', 2400.0, -2.0, 2.0, 2401.5);`);
  accepted('a line nobody has answered yet', `INSERT INTO inspection_check
    (inspection_id, line_no, item) VALUES (${failed}, 3, 'Surface finish');`);
  refused('a verdict that is not one of the three',
    `INSERT INTO inspection_check (inspection_id, line_no, item, result)
     VALUES (${failed}, 4, 'Something', 'probably');`, /result/);
  refused('a nominal with no tolerance to judge it by',
    `INSERT INTO inspection_check (inspection_id, line_no, item, nominal, actual)
     VALUES (${failed}, 5, 'Bore', 40.0, 40.1);`, /a_nominal_needs_a_tolerance/);
  refused('a tolerance band upside down, which nothing can fall inside',
    `INSERT INTO inspection_check (inspection_id, line_no, item, nominal, tol_lower, tol_upper)
     VALUES (${failed}, 6, 'Bore', 40.0, 0.5, -0.5);`, /tolerance_band_is_the_right_way_up/);
  refused('a line with no line number of its own',
    `INSERT INTO inspection_check (inspection_id, line_no, item)
     VALUES (${failed}, 2, 'Overall length again');`, /line_no|duplicate key/);
  refused('a check against nothing',
    `INSERT INTO inspection_check (inspection_id, line_no, item)
     VALUES (${failed}, 7, '   ');`, /item/);
  step('Quality: the checklist is the evidence — a line is answered, measured against a real band, or open');

  // Deleting an inspection takes its evidence with it rather than leaving orphan measurements
  // pointing at a record that no longer exists.
  sql(`DELETE FROM inspection WHERE id = ${failed};`);
  assert.equal(value(`SELECT count(*) FROM inspection_check WHERE inspection_id = ${failed};`), '0',
    'the checklist belongs to its inspection and goes with it');
  step('Quality: a checklist cannot outlive the inspection it belongs to');
}

// A lost enquiry with no reason recorded teaches the workshop nothing, and somebody who has asked
// not to be contacted cannot have a follow-up booked against them.
function thePipelineRemembersWhyAndRespectsNo() {
  const f = fixture();
  const theLead = value(`INSERT INTO lead (company, city, priority, estimated_value)
    VALUES ('Nordic Fabrication AB', 'Helsingborg', 'high', 480000) RETURNING id;`);
  accepted('booking a follow-up', `UPDATE lead SET next_follow_up_on = current_date + 7,
    last_contact_on = current_date, contact_preference = 'Email' WHERE id = ${theLead};`);
  // Capitalised, because that is what the dropdown offers. Lower case here meant every lead the form
  // saved was refused on a field nobody typed.
  refused('a contact preference in a case no dropdown offers',
    `UPDATE lead SET contact_preference = 'email' WHERE id = ${theLead};`,
    /lead_contact_preference_check/);
  refused('marking them do-not-contact while a follow-up stands',
    `UPDATE lead SET do_not_contact = true WHERE id = ${theLead};`,
    /do_not_contact_means_no_follow_up/);
  accepted('clearing the follow-up and respecting it',
    `UPDATE lead SET do_not_contact = true, next_follow_up_on = NULL WHERE id = ${theLead};`);
  refused('booking a follow-up against somebody who asked not to be contacted',
    `UPDATE lead SET next_follow_up_on = current_date + 7 WHERE id = ${theLead};`,
    /do_not_contact_means_no_follow_up/);
  step('Pipeline: somebody who has asked not to be contacted cannot have a follow-up booked against them');

  const opp = value(`INSERT INTO opportunity (title, lead_id, value, probability, owner)
    VALUES ('Frame work', ${theLead}, 320000, 40, 'Lars Holm') RETURNING id;`);
  refused('losing an enquiry without recording why',
    `UPDATE opportunity SET stage = 'lost' WHERE id = ${opp};`, /lost_opportunity_says_why/);
  accepted('recording why it was lost',
    `UPDATE opportunity SET stage = 'lost', competitor = 'Malmö Mekaniska',
     decision_reason = 'Beaten on lead time by three weeks' WHERE id = ${opp};`);
  const lesson = value(`SELECT decision_reason FROM opportunity WHERE id = ${opp};`);
  assert.equal(lesson, 'Beaten on lead time by three weeks');
  step('Pipeline: a lost enquiry records why it was lost, which is the one field worth having');
}

function ncrCannotCloseOnNothing() {
  const f = fixture();
  const n = value(`INSERT INTO ncr (title, project_id, jobcard_id, category, severity, description,
      responsible, detected_by, due_on)
    VALUES ('Porosity beyond level C', ${f.project}, ${f.jobcard}, 'welding', 'major',
            'Found on the bracket weld during visual inspection', 'Quality Manager',
            'Aleksandar C.', '2026-12-01') RETURNING ref;`);
  assert.match(n, /^NCR-\d{4}-\d{3}$/);
  refused('an NCR about nothing', `INSERT INTO ncr (title, category, description, responsible, detected_by)
    VALUES ('Floating problem', 'welding', 'Somewhere', 'Quality Manager', 'Aleksandar C.');`,
    /ncr_names_something/);
  // Who found it is not who has to fix it, and a register that cannot say who raised a fault cannot
  // answer the only question asked after a delivery goes wrong: how long did we know.
  refused('a fault nobody found',
    `INSERT INTO ncr (title, project_id, category, severity, description, responsible, detected_by)
     VALUES ('Anonymous', ${f.project}, 'welding', 'minor', 'Somewhere', 'QM', '  ');`, /detected_by/);
  refused('a critical fault with no date by which it is answered',
    `INSERT INTO ncr (title, project_id, category, severity, description, responsible, detected_by)
     VALUES ('Cracked weld', ${f.project}, 'welding', 'critical', 'Root crack', 'QM', 'Inspector');`,
    /serious_ncrs_have_a_date/);
  accepted('a minor one that may sit on the list',
    `INSERT INTO ncr (title, project_id, category, severity, description, responsible, detected_by)
     VALUES ('Paint run', ${f.project}, 'surface-coating', 'minor', 'Cosmetic', 'QM', 'Inspector');`);
  step('Quality: an NCR says who found it, and a serious one says when it must be answered by');

  refused('closing it on nothing at all',
    `UPDATE ncr SET status = 'closed' WHERE ref = '${n}';`, /closed_ncr_says_what_was_done/);
  refused('closing it on verification with no approval behind it',
    `UPDATE ncr SET status = 'closed', verification_result = 'Re-tested, accepted',
     closed_on = current_date WHERE ref = '${n}';`, /closed_ncr_says_what_was_done/);
  refused('closing it on an approval with nothing verified',
    `UPDATE ncr SET status = 'closed', closure_approval = 'QM-2026-14',
     closed_on = current_date WHERE ref = '${n}';`, /closed_ncr_says_what_was_done/);
  // Containment is what was done about it immediately — the parts quarantined, the machine stopped.
  // Conflating that with the corrective action is how an NCR gets closed on the containment alone.
  accepted('recording the containment and what happens to the parts',
    `UPDATE ncr SET containment = 'Batch quarantined on the rack; welder stood down from the seam',
     disposition = 'rework', component = 'Bracket BR-4410', material = 'S355J2 10mm',
     operation = 'Weld seam 3, root pass' WHERE ref = '${n}';`);
  refused('a disposition that means nothing',
    `UPDATE ncr SET disposition = 'probably fine' WHERE ref = '${n}';`, /check/i);
  // The one disposition that leaves the fault in the delivered work. Somebody signs for it or it is
  // not recorded.
  refused('using a non-conforming part as it is, with nobody signing for it',
    `UPDATE ncr SET disposition = 'use-as-is' WHERE ref = '${n}';`, /use_as_is_is_signed_for/);
  accepted('using it as it is, with the concession recorded',
    `UPDATE ncr SET disposition = 'use-as-is', disposition_approval_ref = 'CONC-2026-03'
     WHERE ref = '${n}';`);
  accepted('and back to rework once the customer refuses the concession',
    `UPDATE ncr SET disposition = 'rework', disposition_approval_ref = NULL WHERE ref = '${n}';`);
  step('Quality: containment is separate from the fix, and using a bad part as it is has to be signed for');

  // The ten states the screen writes. Four of them had no value in the enum this replaced, and two
  // more were spelled differently there — so a containment recorded on the floor, and any NCR
  // reopened after closure, would have been refused by the database.
  for (const st of ['draft', 'open', 'containment-required', 'under-investigation',
                    'disposition-required', 'corrective-action', 'waiting-verification',
                    'rejected', 'reopened']) {
    accepted(`the status the screen writes: ${st}`,
      `UPDATE ncr SET status = '${st}' WHERE ref = '${n}';`);
  }
  refused('a status no screen has a word for',
    `UPDATE ncr SET status = 'nearly-done' WHERE ref = '${n}';`, /ncr_status|invalid input/);
  step('Quality: the ten NCR statuses are the ten the screen writes, and nothing else');

  accepted('closing it on what was verified and who approved it',
    `UPDATE ncr SET status = 'closed', verification_result = 'Re-tested by PT, accepted to level B',
     verified_by = 'Quality Manager', corrective_action_ref = 'CAPA-2026-007',
     closure_approval = 'QM-2026-14', closed_on = current_date WHERE ref = '${n}';`);
  step('Quality: a non-conformance closes only on verified evidence and a named approval');
}

// ── Documents ─────────────────────────────────────────────────────────────────────────────

function documentsPointAtSomethingReal() {
  const f = fixture();
  accepted('a drawing on the jobcard', `INSERT INTO document
    (title, kind, entity, entity_id, filename, storage_key, mime_type, size_bytes, uploaded_by)
    VALUES ('Duct drawing rev A', 'Drawing', 'jobcard', ${f.jobcard}, 'BR-4410-A.pdf',
            'jobcard/1/BR-4410-A.pdf', 'application/pdf', 284213, 'Workshop Admin');`);
  refused('a document nobody can find by name', `INSERT INTO document
    (title, kind, uploaded_by) VALUES ('   ', 'Drawing', 'Admin');`, /title/);
  refused('a kind of document the screen does not offer', `INSERT INTO document
    (title, kind, uploaded_by) VALUES ('Something', 'blueprint', 'Admin');`, /kind/);
  refused('a document filed against a table that does not exist', `INSERT INTO document
    (title, kind, entity, entity_id, uploaded_by)
    VALUES ('x', 'Drawing', 'jobcards', ${f.jobcard}, 'Admin');`, /entity/);
  refused('two documents on one file in storage', `INSERT INTO document
    (title, kind, filename, storage_key, uploaded_by)
    VALUES ('again', 'Drawing', 'again.pdf', 'jobcard/1/BR-4410-A.pdf', 'Admin');`,
  /storage_key|duplicate key/);
  refused('an empty file', `INSERT INTO document
    (title, kind, filename, storage_key, size_bytes, uploaded_by)
    VALUES ('empty', 'Drawing', 'empty.pdf', 'project/1/empty.pdf', 0, 'Admin');`, /size_bytes/);
  refused('a document nobody uploaded', `INSERT INTO document
    (title, kind, filename, storage_key, uploaded_by)
    VALUES ('anon', 'Drawing', 'anon.pdf', 'project/1/anon.pdf', '  ');`, /uploaded_by/);
  step('Documents: a document has a name, a kind the screen offers, a table that exists, and an owner');

  // The two halves of this record that are optional, and both of them all-or-nothing.
  //
  // Both were NOT NULL when this table was written, which is what kept it unused for four passes: there is
  // no object storage, so `storage_key` had nothing to hold and no register entry could be made at all —
  // while the thing worth having was never the bytes. Half of either half is worse than none: a storage key
  // with no filename is a file nobody can offer to download, and an entity with no id reads as though it
  // points somewhere.
  accepted('a register entry with no file, which is every entry today', `INSERT INTO document
    (title, kind, category, revision, uploaded_by)
    VALUES ('Material Certificate MTC-240516', 'Certificate', 'Materials', '1', 'Workshop Admin');`);
  accepted('a document filed against nothing yet', `INSERT INTO document
    (title, kind, uploaded_by) VALUES ('Welding Procedure WPS-12', 'Document', 'Workshop Admin');`);
  refused('a link with a table and no record', `INSERT INTO document
    (title, kind, entity, uploaded_by)
    VALUES ('half', 'Drawing', 'project', 'Admin');`, /a_link_names_both_halves/);
  refused('a link with a record and no table', `INSERT INTO document
    (title, kind, entity_id, uploaded_by)
    VALUES ('half', 'Drawing', ${f.project}, 'Admin');`, /a_link_names_both_halves/);
  refused('a filename with nowhere to be stored', `INSERT INTO document
    (title, kind, filename, uploaded_by)
    VALUES ('lost', 'Drawing', 'somewhere.pdf', 'Admin');`, /a_stored_file_has_a_key/);
  refused('a stored file nothing can name', `INSERT INTO document
    (title, kind, storage_key, uploaded_by)
    VALUES ('nameless', 'Drawing', 'project/1/x.pdf', 'Admin');`, /a_stored_file_has_a_key/);
  step('Documents: the file and the link are each all or nothing — no half a file, no half a link');

  // A certificate that has run out is the most common document problem in a workshop, so the date it
  // runs out is a column rather than a line in the notes.
  const cert = value(`INSERT INTO document
    (title, kind, entity, entity_id, uploaded_by, expires_on, revision, status)
    VALUES ('Crane inspection 2026', 'Certificate', 'equipment', (SELECT id FROM equipment LIMIT 1),
            'Workshop Admin', current_date + 180, 'B', 'valid') RETURNING id;`);
  assert.equal(value(`SELECT (expires_on > current_date)::text FROM document WHERE id = ${cert};`), 'true');
  refused('a document in a state a document cannot be in',
    `UPDATE document SET status = 'lost' WHERE id = ${cert};`, /invalid input value|check/i);

  // The two states nobody sets. Both are answers to "what is the date today", worked out by
  // workspace_snapshot() on every read — so a column holding either would be a fact that was true the
  // morning somebody chose it and then silently stopped being true. The Documents screen offered
  // "Review Soon" in its status dropdown, which is where this would have come from.
  for (const dated of ['expired', 'review soon', 'Review Soon']) {
    refused(`the state "${dated}", which is a date and not a decision`,
      `UPDATE document SET status = '${dated}' WHERE id = ${cert};`, /invalid input value/i);
  }
  accepted('marking it superseded when a new revision lands',
    `UPDATE document SET status = 'superseded', updated_at = now() WHERE id = ${cert};`);
  refused('an expiry date on a template, which does not have a life',
    `INSERT INTO document (title, kind, expires_on, uploaded_by)
     VALUES ('Weld map', 'Template', current_date + 90, 'Admin');`, /only_a_dated_document_expires/);
  const expiring = value(`SELECT count(*) FROM document WHERE expires_on IS NOT NULL
                           AND expires_on <= current_date + 365;`);
  assert.equal(expiring, '1', 'the register has to be able to answer what runs out within the year');
  step('Documents: a certificate carries the date it runs out, and the two dated states are not storable');
}

// ── The welding registers ─────────────────────────────────────────────────────────────────

// The sentence this whole subsystem exists for: a weld is made by a welder qualified for that process, to
// a procedure that was valid on the day. Four refusals, each asserted on its wording, because a refusal
// nobody can read is a refusal somebody works around.
function aWeldIsMadeBySomebodyQualified() {
  const f = fixture();
  // Two welders, one procedure approved and one still a draft, and two qualifications — one current and
  // one that ran out a month ago.
  const elena = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('elena@fixture.se', 'Elena Nikolic', 'workshop') RETURNING id;`);
  const marko = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('marko@fixture.se', 'Marko Ilic', 'workshop') RETURNING id;`);
  const approved = value(`INSERT INTO wps (ref, revision, process, supporting_wpqr, status,
      approved_on, approved_by)
    VALUES ('WPS-304-02', 1, 'TIG', 'WPQR-304-02-R1', 'approved', current_date - 200, 'Quality Manager')
    RETURNING id;`);
  const draft = value(`INSERT INTO wps (ref, revision, process, status)
    VALUES ('WPS-MAG-01', 1, 'MAG', 'draft') RETURNING id;`);
  const current = value(`INSERT INTO welder_qual (welder_id, qual_no, process, issued_by,
      issued_on, expires_on)
    VALUES (${elena}, 'WPQ-EN-2024-11', 'TIG', 'Nordic Weld Cert AB',
            current_date - 400, current_date + 200) RETURNING id;`);
  const lapsed = value(`INSERT INTO welder_qual (welder_id, qual_no, process, issued_by,
      issued_on, expires_on)
    VALUES (${elena}, 'WPQ-EN-2021-03', 'TIG', 'Nordic Weld Cert AB',
            current_date - 1200, current_date - 30) RETURNING id;`);

  accepted('a weld to an approved procedure, by a welder qualified for it', `INSERT INTO weld
    (jobcard_id, process, wps_id, welder_id, welder_qual_id, welded_on, recorded_by, component)
    VALUES (${f.jobcard}, 'TIG', ${approved}, ${elena}, ${current}, current_date - 1,
            'Elena Nikolic', 'Shell course');`);

  const toDraft = refused('a weld to a procedure nobody has approved', `INSERT INTO weld
    (jobcard_id, process, wps_id, welder_id, welded_on, recorded_by)
    VALUES (${f.jobcard}, 'MAG', ${draft}, ${elena}, current_date, 'x');`, /is draft, not approved/);
  assert.match(toDraft, /WPS-MAG-01/, 'the refusal names the procedure, not "a procedure"');

  const wrongProcess = refused('a weld whose process is not the procedure\'s', `INSERT INTO weld
    (jobcard_id, process, wps_id, welder_id, welded_on, recorded_by)
    VALUES (${f.jobcard}, 'MAG', ${approved}, ${elena}, current_date, 'x');`,
  /recorded as MAG against WPS-304-02, which is a TIG procedure/);
  assert.ok(wrongProcess.includes('TIG'), 'and says what the procedure actually is');

  refused('a qualification borrowed from another welder', `INSERT INTO weld
    (jobcard_id, process, welder_id, welder_qual_id, welded_on, recorded_by)
    VALUES (${f.jobcard}, 'TIG', ${marko}, ${current}, current_date, 'x');`,
  /does not belong to Marko Ilic — a qualification cannot be borrowed/);

  // The one an auditor is actually asking about, and the one worth the date being in the message —
  // the same shape as the equipment gate, which names the day a machine's certification ran out.
  const expired = refused('a weld on a qualification that had already run out', `INSERT INTO weld
    (jobcard_id, process, welder_id, welder_qual_id, welded_on, recorded_by)
    VALUES (${f.jobcard}, 'TIG', ${elena}, ${lapsed}, current_date, 'x');`,
  /the qualification WPQ-EN-2021-03 held by Elena Nikolic expired on \d{4}-\d{2}-\d{2}/);
  assert.match(expired, /and this weld was made on \d{4}-\d{2}-\d{2}/,
    'the refusal gives both dates, because which side of the line the weld falls on is the question');

  // A qualification that has been suspended is not a qualification, whatever its date says.
  sql(`UPDATE welder_qual SET status = 'suspended' WHERE id = ${current};`);
  refused('a weld citing a suspended qualification', `INSERT INTO weld
    (jobcard_id, process, welder_id, welder_qual_id, welded_on, recorded_by)
    VALUES (${f.jobcard}, 'TIG', ${elena}, ${current}, current_date, 'x');`,
  /is suspended, so it cannot be cited/);
  sql(`UPDATE welder_qual SET status = 'valid' WHERE id = ${current};`);

  refused('a weld made tomorrow', `INSERT INTO weld
    (jobcard_id, process, welder_id, welded_on, recorded_by)
    VALUES (${f.jobcard}, 'TIG', ${elena}, current_date + 1, 'x');`, /a_weld_is_not_made_tomorrow/);
  refused('NDT called for with no method named', `INSERT INTO weld
    (jobcard_id, process, welder_id, recorded_by, ndt_required)
    VALUES (${f.jobcard}, 'TIG', ${elena}, 'x', true);`, /ndt_that_is_required_says_how/);
  refused('a qualification that runs backwards', `INSERT INTO welder_qual
    (welder_id, qual_no, process, issued_by, issued_on, expires_on)
    VALUES (${elena}, 'WPQ-BAD', 'TIG', 'X', current_date, current_date - 1);`,
  /a_qualification_runs_forwards/);
  refused('a procedure approved without saying who approved it', `INSERT INTO wps
    (ref, revision, process, status) VALUES ('WPS-NOBODY', 1, 'TIG', 'approved');`,
  /an_approved_wps_says_who/);
  refused('two copies of one revision of one procedure', `INSERT INTO wps
    (ref, revision, process, status) VALUES ('WPS-304-02', 1, 'MAG', 'draft');`,
  /wps_one_revision|duplicate key/);
  step('Welding: a weld is made by a welder qualified for that process, to an approved procedure');
}

// The rule that stops a delivery being signed off against work nobody tested.
function aWeldIsAcceptedOnlyOnEvidence() {
  const f = fixture();
  const elena = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('elena@fixture.se', 'Elena Nikolic', 'workshop') RETURNING id;`);
  const weld = value(`INSERT INTO weld (jobcard_id, process, welder_id, welded_on, recorded_by,
      ndt_required, ndt_method, component)
    VALUES (${f.jobcard}, 'TIG', ${elena}, current_date - 2, 'Elena Nikolic', true, 'RT', 'Nozzle weld')
    RETURNING id;`);

  const noEvidence = refused('accepting a weld that requires radiography, with no report at all',
    `UPDATE weld SET final_result = 'accepted' WHERE id = ${weld};`,
    /requires RT and no report has accepted it/);
  assert.match(noEvidence, /evidence that does not exist/,
    'the refusal says what is missing rather than that something is wrong');

  refused('a rejected report that does not say what was found', `INSERT INTO ndt_report
    (weld_id, method, technician, result, recorded_by)
    VALUES (${weld}, 'RT', 'A. Technician', 'rejected', 'x');`,
  /a_rejected_report_says_what_was_found/);
  refused('a report nobody signed', `INSERT INTO ndt_report (weld_id, method, result, recorded_by)
    VALUES (${weld}, 'RT', 'pending', 'x');`, /ndt_is_signed_by_somebody/);
  refused('a report written for tomorrow', `INSERT INTO ndt_report
    (weld_id, method, technician, inspected_on, recorded_by)
    VALUES (${weld}, 'RT', 'A. Technician', current_date + 1, 'x');`, /ndt_is_not_done_tomorrow/);

  // A rejection reaches the weld by itself. Left to a function to remember, a second route into
  // ndt_report — an import, a console — leaves a rejected report beside an accepted weld.
  sql(`INSERT INTO ndt_report (weld_id, method, technician, result, findings, repair_required,
      recorded_by)
    VALUES (${weld}, 'RT', 'A. Technician', 'rejected', 'Porosity beyond level 2 at 40 mm', true, 'x');`);
  assert.equal(value(`SELECT status::text || '/' || final_result::text FROM weld WHERE id = ${weld};`),
    'repair-required/rejected', 'a rejected report puts the weld into repair-required without being asked');

  refused('accepting it while that report stands',
    `UPDATE weld SET final_result = 'accepted' WHERE id = ${weld};`,
    /requires RT and no report has accepted it|calls for a repair/);

  // Repaired, re-tested, and now it signs off — with the repair on file, because a weld that was
  // repaired is not a weld that was always right.
  sql(`INSERT INTO weld_repair (weld_id, reason, repaired_by)
       VALUES (${weld}, 'Ground out and re-welded', 'Elena Nikolic');
       UPDATE ndt_report SET result = 'accepted', repair_required = false,
         findings = 'Re-tested, no relevant indications' WHERE weld_id = ${weld};`);
  accepted('signing it off once a report accepts it',
    `UPDATE weld SET status = 'repaired', final_result = 'accepted' WHERE id = ${weld};`);
  assert.equal(value(`SELECT count(*) FROM weld_repair WHERE weld_id = ${weld};`), '1',
    'and the repair is still on file — which is the question asked when a joint fails in service');
  refused('a repair that does not say why it was needed', `INSERT INTO weld_repair
    (weld_id, reason, repaired_by) VALUES (${weld}, '   ', 'x');`, /reason/);
  step('Welding: a weld that needs testing cannot be signed off on evidence that does not exist');
}

// A step on a jobcard, and the work booked against it.
function aStepRemembersTheWorkDoneOnIt() {
  const f = fixture();
  sql(`INSERT INTO hours_entry (jobcard_id, operation_id, worker, hours)
       VALUES (${f.jobcard}, ${f.op1}, 'Marko Ilic', 6.5);`);
  assert.equal(value(`SELECT logged_hours::text FROM operation WHERE id = ${f.op1};`), '6.50');

  // Asked as a plain DELETE rather than through the workflow, because the workflow's own check is the
  // readable version and this is the guarantee. hours_entry.operation_id is ON DELETE SET NULL, so
  // without the trigger this succeeds, the hours stay, and they stop knowing which step they were for
  // — with nothing on any screen to say it happened.
  const gone = refused('deleting a step somebody has booked hours on',
    `DELETE FROM operation WHERE id = ${f.op1};`, /hours booked on it and cannot be removed/);
  assert.match(gone, /6.50/, 'the refusal says how many hours are at stake');
  assert.equal(value(`SELECT count(*) FROM operation WHERE id = ${f.op1};`), '1');
  assert.equal(value(`SELECT count(*) FROM hours_entry WHERE operation_id = ${f.op1};`), '1');

  // And one that has been started, which is a record of what happened even before an hour is booked.
  // A step of its own rather than the fixture's second one: that one depends on the first, and the
  // dependency gate refuses to start it — which would have been this test failing on an unrelated
  // rule and reading as though this one did not work.
  const started = value(`INSERT INTO operation (jobcard_id, seq, description, planned_hours)
    VALUES (${f.jobcard}, 8, 'Dress and paint', 4) RETURNING id;`);
  sql(`UPDATE operation SET status = 'in-progress' WHERE id = ${started};`);
  refused('deleting a step that has been started',
    `DELETE FROM operation WHERE id = ${started};`, /is in-progress and cannot be removed/);

  // A step nobody has touched goes, because that is most of what editing a plan is.
  const spare = value(`INSERT INTO operation (jobcard_id, seq, description, planned_hours)
    VALUES (${f.jobcard}, 9, 'Spare step', 2) RETURNING id;`);
  accepted('deleting a step nobody has touched', `DELETE FROM operation WHERE id = ${spare};`);
  step('Work: a step with hours booked on it, or one that has been started, cannot be deleted at all');

  // Two steps cannot claim the same place — checked at the end of the transaction rather than
  // statement by statement, so re-ordering a list is possible without the halfway state being refused.
  refused('two steps in the same place on one jobcard',
    `INSERT INTO operation (jobcard_id, seq, description) VALUES (${f.jobcard}, 1, 'Also first');`,
    /operation_one_step_per_place|duplicate key/);
  accepted('swapping two steps round inside one transaction', `BEGIN;
    SET CONSTRAINTS operation_one_step_per_place DEFERRED;
    UPDATE operation SET seq = 1 WHERE id = ${f.op2};
    UPDATE operation SET seq = 2 WHERE id = ${f.op1};
    COMMIT;`);
  assert.equal(value(`SELECT seq FROM operation WHERE id = ${f.op2};`), '1');
  step('Work: two steps cannot share a place, and swapping two round is still one transaction');

  // One spelling per state, and the spelling is the screen's. These four words are what somebody picks
  // from the dropdown on the jobcard page; the three this column was invented with were nobody's, and
  // folding 'shortage' onto 'partial' to translate between them would have lost the difference between
  // "some is missing" and "some is here".
  for (const word of ['not-checked', 'shortage', 'partial', 'available']) {
    accepted(`material readiness "${word}"`,
      `UPDATE jobcard SET material_readiness = '${word}' WHERE id = ${f.jobcard};`);
  }
  refused('material readiness in a word nothing uses',
    `UPDATE jobcard SET material_readiness = 'ready' WHERE id = ${f.jobcard};`, /material_readiness|check/i);

  // The same argument for the priority. The dropdown offers low, medium and high; the column was
  // invented with low, normal, high and urgent, and refused the one value the screen actually writes.
  for (const word of ['low', 'medium', 'high']) {
    accepted(`priority "${word}"`, `UPDATE jobcard SET priority = '${word}' WHERE id = ${f.jobcard};`);
  }
  refused('a priority nothing offers', `UPDATE jobcard SET priority = 'urgent' WHERE id = ${f.jobcard};`,
    /priority|check/i);
  step('Work: the material state and the priority use the words the jobcard screen uses, and no others');
}

// The people at a customer. Held as a list on the record for as long as this app has existed, which
// is exactly how long it has been impossible to say anything true about them.
function oneMainContactWhoCanBeReached() {
  const f = fixture();
  accepted('the main contact', `INSERT INTO customer_contact (customer_id, name, role, email, phone, is_primary)
    VALUES (${f.customer}, 'Erik Lund', 'Purchasing', 'erik@fixture.se', '+46 70 111 22 33', true);`);
  accepted('a second person who is not the main one', `INSERT INTO customer_contact
    (customer_id, name, role, phone) VALUES (${f.customer}, 'Sara Nyberg', 'Quality', '+46 70 444 55 66');`);

  // "Ring the main contact" is an instruction somebody follows at four in the afternoon with a
  // drawing that is wrong. Two main contacts is nobody to ring.
  refused('a second main contact for the same customer', `INSERT INTO customer_contact
    (customer_id, name, email, is_primary) VALUES (${f.customer}, 'Tomas Ek', 'tomas@fixture.se', true);`,
    /customer_has_one_main_contact|duplicate key/);
  // But another customer's main contact is a different question, and has to go through.
  const other = value(`INSERT INTO customer (name, city) VALUES ('Other Industri AB', 'Lund') RETURNING id;`);
  accepted('the main contact at a different customer', `INSERT INTO customer_contact
    (customer_id, name, email, is_primary) VALUES (${other}, 'Anna Falk', 'anna@other.se', true);`);

  refused('a contact with no name', `INSERT INTO customer_contact (customer_id, name, email)
    VALUES (${f.customer}, '   ', 'x@fixture.se');`, /name/);
  refused('a contact nobody can reach', `INSERT INTO customer_contact (customer_id, name, role)
    VALUES (${f.customer}, 'Nils Berg', 'Accounts');`, /contact_can_be_reached/);
  refused('a contact whose email and telephone are both blank', `INSERT INTO customer_contact
    (customer_id, name, email, phone) VALUES (${f.customer}, 'Nils Berg', '  ', '');`,
    /contact_can_be_reached/);
  step('Customers: one main contact per customer, and a contact nobody can reach is not a contact');

  // And they go when the customer does, rather than becoming rows pointing at nothing. Asked of the
  // other customer, because the fixture's has a job on it and a customer with work against it is
  // not deletable at all — which is the rule nothing_is_orphaned_or_erased already asserts.
  assert.equal(value(`SELECT count(*) FROM customer_contact WHERE customer_id = ${other};`), '1');
  sql(`DELETE FROM customer WHERE id = ${other};`);
  assert.equal(value(`SELECT count(*) FROM customer_contact WHERE customer_id = ${other};`), '0',
    'a contact must not outlive the customer it belongs to');
  step('Customers: contacts go with the customer rather than becoming rows pointing at nobody');
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
  // A project on hold with no reason written down is one nobody can restart without asking three
  // people, so the reason is a constraint rather than a habit.
  refused('putting it on hold for no stated reason',
    `UPDATE project SET status = 'hold' WHERE id = ${f.project};`, /held_project_says_why/);
  accepted('putting it on hold with the reason',
    `UPDATE project SET status = 'hold', hold_reason = 'Customer paused pending a drawing revision'
     WHERE id = ${f.project};`);
  accepted('taking it off hold', `UPDATE project SET status = 'production' WHERE id = ${f.project};`);
  refused('cancelling a project that is already completed',
    `UPDATE project SET status = 'completed' WHERE id = ${f.project};
     UPDATE project SET status = 'cancelled' WHERE id = ${f.project};`, /cannot go from completed to cancelled/);
  step('Status: the project follows its own sequence, reopens the way the screen says, and cannot be cancelled once finished');

  // The rulebook is data, which is the point: the argument about workflow is settled by editing a
  // row. Checked by adding the transition and watching the same move go through.
  sql(`INSERT INTO allowed_transition (entity, from_status, to_status)
       VALUES ('project', 'completed', 'cancelled');`);
  refused('cancelling it without saying why',
    `UPDATE project SET status = 'cancelled' WHERE id = ${f.project};`, /cancelled_project_says_why/);
  accepted('the same move once the rulebook allows it, with a reason',
    `UPDATE project SET status = 'cancelled',
     cancel_reason = 'Customer withdrew the order before release' WHERE id = ${f.project};`);
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
  ensureUp();
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
  failedPreUseCheckStopsStart();
  machineCannotBeInTwoPlaces();
  dependencyGateStopsStart();
  dependencyCannotLoop();
  hoursRollUp();
  theProjectKnowsItsOwnHours();
  stoppingAJobIsOnTheRecord();
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
  anInspectionIsEvidenceOrItIsNothing();
  thePipelineRemembersWhyAndRespectsNo();
  ncrCannotCloseOnNothing();
  documentsPointAtSomethingReal();
  aWeldIsMadeBySomebodyQualified();
  aWeldIsAcceptedOnlyOnEvidence();
  theHistoryCertificationWouldNeed();
  oneMainContactWhoCanBeReached();
  aStepRemembersTheWorkDoneOnIt();

  console.log(`\n${checks} checks: ${attempts.refused} things the schema refused, `
    + `${attempts.allowed} it allowed, every refusal asserted on its wording.`);
}

main().catch((error) => {
  console.error(`\n${error.message || error}`);
  if (error.stack) console.error(error.stack.split('\n').slice(1, 4).join('\n'));
  process.exitCode = 1;
});
