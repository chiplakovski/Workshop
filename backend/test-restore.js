'use strict';

// A backup nobody has restored is not a backup. This restores one.
//
// Step 6 of BACKEND.md, and the sentence it uses is "backups verified by restoring one" — which is
// the whole point: `pg_dump` exiting zero says the dump was written, not that anything could be got
// back out of it. So this takes a real backup of a populated workshop, restores it into a fresh
// database, and asks two different questions of the copy.
//
// The first is whether the records came back, compared table by table with a checksum of the contents
// rather than a row count. A row count matches when every price in the store has been rounded.
//
// The second matters more, and is the one a restore drill usually skips: does the copy still REFUSE
// what the original refused? A dump that brings back the data and loses a trigger is worse than no
// backup at all, because you would trust it — the hold gate would be gone, the append-only log would
// be editable, and nothing would look wrong until somebody shipped work that was on hold.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ensureUp } = require('./pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
// Two databases, named off one base so mutation-check.js can give each mutant a pair of its own.
const BASE = process.env.VARMAK_TEST_DB || 'varmak_restore';
const LIVE = `${BASE}_live`;
const COPY = `${BASE}_copy`;
// The env overrides are how mutation-check.js hands this suite a damaged copy of one file — the
// script included. Without them a mutation runs against the real files and every one comes back
// uncaught, which is a harness fault wearing the clothes of an untested rule.
const sqlFile = (name) => process.env[`VARMAK_${name.toUpperCase()}`] || path.join(__dirname, `${name}.sql`);
const SCRIPT = process.env.VARMAK_BACKUP || path.join(__dirname, 'backup.sh');

function conn(db) { return ['-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1', '-qtAX']; }
function sql(text, db = LIVE) { return execFileSync('psql', conn(db), { input: text, encoding: 'utf8' }).trim(); }
function value(text, db = LIVE) { return sql(text, db).split('\n')[0].trim(); }

function as(db, role, userId, text) {
  const preamble = `SET app.user_id = '${userId === null ? '' : userId}';\n${role ? `SET ROLE ${role};` : ''}`;
  try {
    const out = execFileSync('psql', conn(db), {
      input: `${preamble}\n${text}`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    });
    return { ok: true, out: out.trim().split('\n').filter((l) => l && l !== 'SET').join('\n').trim() };
  } catch (error) {
    const stderr = String(error.stderr || '');
    const line = (stderr.split('\n').find((l) => /ERROR/.test(l)) || stderr).trim();
    return { ok: false, message: line.replace(/^.*ERROR:\s*/, '') };
  }
}

let checks = 0;
function step(message) { checks += 1; console.log(`OK   ${message}`); }

function build(db) {
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', 'postgres', '-qtAX',
    '-c', `DROP DATABASE IF EXISTS ${db};`, '-c', `CREATE DATABASE ${db};`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// A workshop with a day's work in it, and deliberately including the things a careless dump loses:
// a live quality hold, an append-only log with rows in it, hours rolled up into an operation and a
// project, a released estimate with locked lines, and money nobody on the floor may read.
function aWorkingWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const admin = value(`SELECT id FROM app_user WHERE email = 'anna@varmak.se';`);
  sql(`SET ROLE varmak_admin; SET app.user_id = '${admin}';
    SELECT add_person('marko@varmak.se', 'Marko Ilic', 'workshop');
    SELECT add_person('lars@varmak.se', 'Lars Holm', 'office');`);
  const welder = value(`SELECT id FROM app_user WHERE email = 'marko@varmak.se';`);
  sql(`SET ROLE varmak_admin; SET app.user_id = '${admin}'; SELECT set_person_pin(${welder}, '8472');`);

  const customer = value(`INSERT INTO customer (name, city, credit_limit)
    VALUES ('Skåne Verkstad AB', 'Lund', 250000) RETURNING id;`);
  const project = value(`INSERT INTO project (name, customer_id, status, planned_hours, quoted_value)
    VALUES ('Conveyor frame', ${customer}, 'production', 40, 420000) RETURNING id;`);
  const jobcard = value(`INSERT INTO jobcard (project_id, customer_id, title, status)
    VALUES (${project}, ${customer}, 'Frame weldment', 'inspection') RETURNING id;`);
  const op = value(`INSERT INTO operation (jobcard_id, seq, description, planned_hours)
    VALUES (${jobcard}, 1, 'Weld out', 16) RETURNING id;`);
  sql(`INSERT INTO hours_entry (jobcard_id, operation_id, worker, hours)
       VALUES (${jobcard}, ${op}, 'Marko Ilic', 6.5), (${jobcard}, ${op}, 'Marko Ilic', 3);
       INSERT INTO stock_item (code, description, unit, stock, avg_cost)
       VALUES ('S355-10', 'Plate S355J2 10mm', 'KG', 500, 14.50);
       INSERT INTO equipment (ref, name, category, purchase_price)
       VALUES ('EQ-001', 'MIG 400', 'welding', 412000);
       INSERT INTO quality_hold (scope, jobcard_id, reason, severity, applied_by)
       VALUES ('jobcard', ${jobcard}, 'Porosity beyond level C', 'critical', 'Lars Holm');`);
  const estimate = value(`INSERT INTO estimate (title, customer_id) VALUES ('Conveyor frame', ${customer}) RETURNING id;`);
  sql(`INSERT INTO estimate_line (estimate_id, kind, description, quantity, unit_price)
       VALUES (${estimate}, 'labour', 'Welding', 40, 650);
       SET ROLE varmak_office; SET app.user_id = '${value(`SELECT id FROM app_user WHERE email = 'lars@varmak.se';`)}';
       SELECT send_estimate(${estimate});`);
  return { admin, welder, customer, project, jobcard, op, estimate,
    jobcardRef: value(`SELECT ref FROM jobcard WHERE id = ${jobcard};`) };
}

// Contents, not counts. A count matches when every figure has been silently rounded.
function fingerprint(db) {
  const tables = sql(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;`, db)
    .split('\n').map((t) => t.trim()).filter(Boolean);
  const lines = [];
  for (const table of tables) {
    const mark = value(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty')
      FROM ${table} t;`, db);
    const rows = value(`SELECT count(*) FROM ${table};`, db);
    lines.push(`${table} ${rows} ${mark}`);
  }
  return lines;
}

function main() {
  ensureUp();
  build(LIVE);
  for (const name of ['schema', 'auth', 'api', 'views']) {
    execFileSync('psql', [...conn(LIVE), '-f', sqlFile(name)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
  const w = aWorkingWorkshop();

  const before = fingerprint(LIVE);
  const populated = before.filter((line) => !/ 0 empty$/.test(line));
  assert.ok(populated.length >= 10,
    `there should be a workshop's worth of records to lose — only ${populated.length} tables have any`);
  step(`Backup: a workshop with records in ${populated.length} tables is the thing being backed up`);

  // ── Taken the way the runbook says ────────────────────────────────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'varmak-restore-'));
  // A real deployment gives varmak_api a password, and that hash is the thing the backup must not
  // carry off the server. Set here rather than assumed: with trust authentication no role has one,
  // so the check that no hash reaches the file would pass by being asked about an empty cluster.
  sql(`ALTER ROLE varmak_api PASSWORD 'the password the deploy sets';`);
  let out;
  try {
    out = execFileSync('sh', [SCRIPT, dir], { encoding: 'utf8', env: { ...process.env, PGDATABASE: LIVE } });
  } finally {
    sql('ALTER ROLE varmak_api PASSWORD NULL;');
  }
  const roles = fs.readdirSync(dir).find((f) => f.endsWith('.roles.sql'));
  const dump = fs.readdirSync(dir).find((f) => f.endsWith('.dump'));
  assert.ok(roles && dump,
    `backup.sh must write both files, and wrote only: ${fs.readdirSync(dir).join(', ') || 'nothing'}`);
  assert.match(out, /roles file goes FIRST/i, 'the script must say what order the two files go back in');
  step('Backup: backup.sh writes both pieces and says what order they go back in');

  // The reason there are two files, measured rather than asserted. This is the trap: the data dump
  // is full of GRANTs and policies and contains not one CREATE ROLE, because roles live in the
  // cluster. Restore it alone onto a clean server and every one of those lines fails.
  const dumpText = execFileSync('pg_restore', ['-f', '-', path.join(dir, dump)], { encoding: 'utf8' });
  const grants = (dumpText.match(/^GRANT /gm) || []).length;
  const policies = (dumpText.match(/^CREATE POLICY /gm) || []).length;
  const createRole = (dumpText.match(/^CREATE ROLE /gm) || []).length;
  assert.ok(grants > 100, `the dump should be full of grants, found ${grants}`);
  assert.ok(policies > 50, `and of policies, found ${policies}`);
  assert.equal(createRole, 0, 'if pg_dump started carrying roles, the second file is redundant — check before removing it');
  const rolesText = fs.readFileSync(path.join(dir, roles), 'utf8');
  for (const role of ['varmak_admin', 'varmak_office', 'varmak_workshop', 'varmak_api', 'varmak_engine']) {
    assert.ok(rolesText.includes(role), `the roles file must carry ${role} — ${grants} grants depend on it`);
  }
  assert.ok(!/PASSWORD|md5|SCRAM/i.test(rolesText),
    'the roles file must not carry password hashes — a backup that does hands over the database to whoever finds it');
  step(`Backup: ${grants} grants and ${policies} policies in the data dump, 0 roles — which is why the roles file exists`);

  // ── Put back ──────────────────────────────────────────────────────────────────────────────
  build(COPY);
  execFileSync('pg_restore', ['-h', HOST, '-p', PORT, '-U', USER, '-d', COPY, path.join(dir, dump)],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  step('Restore: the dump goes back into a fresh database without complaint');

  const after = fingerprint(COPY);
  const differing = before.filter((line, i) => line !== after[i]);
  assert.deepEqual(differing, [],
    `these tables did not come back the same:\n  ${differing.join('\n  ')}\n  was\n  ${after.filter((l, i) => l !== before[i]).join('\n  ')}`);
  step(`Restore: all ${before.length} tables came back byte for byte — compared by checksum of the contents, not by row count`);

  // The figures specifically, because rounding is the failure a checksum of the whole row catches
  // and a spot check of a count does not.
  assert.equal(value(`SELECT avg_cost::text FROM stock_item WHERE code = 'S355-10';`, COPY), '14.50');
  assert.equal(value(`SELECT quoted_value::text FROM project WHERE id = ${w.project};`, COPY), '420000.00');
  assert.equal(value(`SELECT logged_hours::text FROM operation WHERE id = ${w.op};`, COPY), '9.50');
  assert.equal(value(`SELECT used_hours::text FROM project WHERE id = ${w.project};`, COPY), '9.50');
  step('Restore: the figures kept their scale, and the hours that were rolled up are still rolled up');

  // ── And does the copy still say no? ───────────────────────────────────────────────────────
  //
  // The question a restore drill usually skips. A dump that brings back the data and loses a trigger
  // is worse than no backup, because nothing looks wrong until somebody ships work that was on hold.
  const held = as(COPY, null, null, `UPDATE jobcard SET status = 'completed' WHERE id = ${w.jobcard};`);
  assert.equal(held.ok, false, 'the hold gate did not survive the restore');
  assert.match(held.message, /cannot be completed while quality hold/);

  const log = as(COPY, null, null, `DELETE FROM activity_log;`);
  assert.equal(log.ok, false, 'the append-only log did not survive the restore');
  assert.match(log.message, /append-only/);

  const stock = as(COPY, null, null, `UPDATE stock_item SET stock = -1 WHERE code = 'S355-10';`);
  assert.equal(stock.ok, false, 'the stock floor did not survive the restore');

  const jump = as(COPY, null, null, `UPDATE project SET status = 'quotation' WHERE id = ${w.project};`);
  assert.equal(jump.ok, false, 'the status sequence did not survive the restore');
  assert.match(jump.message, /cannot go from production to quotation/);

  const reprice = as(COPY, null, null,
    `UPDATE estimate_line SET unit_price = 1 WHERE estimate_id = ${w.estimate};`);
  assert.equal(reprice.ok, false, 'the locked-line rule did not survive the restore');
  step('Restore: the copy still refuses — the hold gate, the append-only log, the stock floor, the status sequence and the locked price');

  // Row-level security and the column grants, which are the half of this system that is privileges
  // rather than data — and the half the roles file exists for.
  const price = as(COPY, 'varmak_workshop', w.welder, `SELECT avg_cost FROM stock_item;`);
  assert.equal(price.ok, false, 'a welder can read the plate cost in the restored copy');
  assert.match(price.message, /permission denied/);
  const money = as(COPY, 'varmak_workshop', w.welder, `SELECT workspace_money();`);
  assert.equal(money.ok, false, 'a welder can read the money in the restored copy');
  const own = as(COPY, 'varmak_workshop', w.welder, `SELECT count(*) FROM app_user;`);
  assert.equal(own.ok, true);
  assert.equal(own.out, '1', 'the welder should see their own row and nobody else in the restored copy');
  step('Restore: and a welder in the copy still cannot read a price, or anybody else\'s row');

  // Somebody can still get in. A restore that loses the password hashes is a restore nobody can sign
  // in to, which is a working database and a locked building.
  const token = value(`SELECT coalesce((SELECT token FROM sign_in('marko@varmak.se', '8472', 'pin')), 'none');`, COPY);
  assert.match(token, /^[0-9a-f]{64}$/, 'the welder cannot sign in to the restored copy — the PIN did not come back');
  assert.equal(value(`SELECT coalesce((SELECT token FROM sign_in('anna@varmak.se', 'correct horse battery staple', 'password')), 'none');`, COPY).length,
    64, 'the admin cannot sign in to the restored copy');
  step('Restore: the people can still sign in — a restored database nobody can get into is a locked building');

  // And the workshop can carry on working in it, which is the only definition of a restore that
  // matters: not that it opens, but that the next hour of work goes in.
  const carriedOn = as(COPY, 'varmak_workshop', w.welder,
    `SELECT book_hours(${w.jobcard}, ${w.op}, 2, current_date, 'After the restore', 'restore-0001');`);
  assert.equal(carriedOn.ok, true, `work should continue in the restored copy: ${carriedOn.message}`);
  assert.equal(value(`SELECT logged_hours::text FROM operation WHERE id = ${w.op};`, COPY), '11.50',
    'and the roll-up should still maintain itself');
  step('Restore: the next two hours of work go into the copy and the totals follow — the restore is usable, not just readable');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${checks} checks: a backup was taken, restored, compared record for record, and still refuses what it should.`);
}

try {
  main();
} catch (error) {
  console.error(`\n${error.message || error}`);
  process.exitCode = 1;
}
