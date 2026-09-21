'use strict';

// The HTTP layer, tested over real HTTP against a real database.
//
// Two questions, and only two, because there is almost nothing else in server.js to test.
//
// The first is whether the promises the database makes survive the journey through it. Step 3 spent
// a long time establishing that a welder cannot read a price by asking the database directly; that
// is worth nothing if the API hands the answer over on a different route. So the same attempts are
// made again, through HTTP, with a real bearer token.
//
// The second is whether the layer is as thin as it claims. A workflow that leaks into the server is
// a workflow that can be got around by talking to the database another way, and the only way to
// stop that claim rotting is to check it mechanically.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = process.env.VARMAK_TEST_DB || 'varmak_server_test';
const HTTP_PORT = Number(process.env.VARMAK_HTTP_PORT || 8899);
const BASE = `http://127.0.0.1:${HTTP_PORT}`;

function conn(db) {
  return ['-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1', '-qtAX'];
}
function sql(text) { return execFileSync('psql', conn(DB), { input: text, encoding: 'utf8' }).trim(); }
function value(text) { return sql(text).split('\n')[0].trim(); }

let checks = 0;
const attempts = { refused: 0, allowed: 0 };
function step(message) { checks += 1; console.log(`OK   ${message}`); }

async function call(method, route, { token, body } = {}) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return { status: response.status, body: parsed };
}

function turnedAway(what, response, status, expected) {
  attempts.refused += 1;
  assert.equal(response.status, status,
    `${what}: expected ${status} but got ${response.status} — ${JSON.stringify(response.body)}`);
  if (expected) {
    assert.match(String(response.body.refused || ''), expected,
      `${what}: refused, but not for the reason expected — ${JSON.stringify(response.body)}`);
  }
}

function wentThrough(what, response) {
  attempts.allowed += 1;
  assert.equal(response.status, 200, `${what}: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body.result;
}

// ── The layer is as thin as it says ───────────────────────────────────────────────────────

function theServerDecidesNothing() {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const code = source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

  const writes = code.match(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/gi) || [];
  assert.deepEqual(writes, [],
    `server.js writes to the database itself: ${writes.join(', ')} — a workflow here can be got around by talking to the database another way`);

  // A branch on a role in this file would be a rule the database does not know about, and therefore
  // a rule a second caller does not have to obey. The roles appear here only as a fixed map from
  // the database's own answer to a Postgres role name.
  const decisions = code.match(/if\s*\([^)]*\b(role|is_admin|admin|office|workshop)\b[^)]*\)/gi) || [];
  assert.deepEqual(decisions, [],
    `server.js decides something from a role: ${decisions.join(' / ')}`);

  step('Thin: the server writes nothing itself and branches on nobody\'s role — every decision is the database\'s');

  // The allow-list is the difference between an API and a remote SQL console.
  const { RPC } = require('./server');
  assert.deepEqual(Object.keys(RPC).sort(), [
    'accept_estimate', 'book_hours', 'convert_lead', 'issue_material_offline',
    'receive_goods', 'record_operation', 'send_estimate'
  ], 'the reachable workflows should be exactly the seven from §4 and §3');
  step('Thin: exactly seven workflows are reachable over HTTP, by name, from a fixed list');
}

// ── Getting in ────────────────────────────────────────────────────────────────────────────

async function theDoorOverHttp() {
  turnedAway('an unknown address', await call('POST', '/auth/sign-in',
    { body: { email: 'nobody@varmak.se', secret: 'whatever at all', door: 'password' } }),
    401, /not a login we recognise/);
  turnedAway('the wrong password', await call('POST', '/auth/sign-in',
    { body: { email: 'lars@varmak.se', secret: 'not the password', door: 'password' } }),
    401, /not a login we recognise/);
  turnedAway('a sign-in with no door named', await call('POST', '/auth/sign-in',
    { body: { email: 'lars@varmak.se', secret: 'a long enough passphrase' } }), 400);
  step('Door: a wrong secret and an unknown address are both 401, in the same words');

  const office = await call('POST', '/auth/sign-in',
    { body: { email: 'lars@varmak.se', secret: 'a long enough passphrase', door: 'password' } });
  assert.equal(office.status, 200);
  assert.match(office.body.token, /^[0-9a-f]{64}$/);
  attempts.allowed += 1;

  const floor = await call('POST', '/auth/sign-in',
    { body: { email: 'marko@varmak.se', secret: '8472', door: 'pin', device: 'hall tablet' } });
  assert.equal(floor.status, 200, JSON.stringify(floor.body));
  attempts.allowed += 1;
  step('Door: both doors work over HTTP and hand back a token');

  // Nothing about the person comes back with the token. The client is told it is in, and nothing
  // it could use to decide something for itself.
  assert.deepEqual(Object.keys(office.body), ['token'],
    `the sign-in response carries more than a token: ${Object.keys(office.body).join(', ')}`);
  step('Door: the response is a token and nothing else — no role for the client to make decisions with');

  return { office: office.body.token, floor: floor.body.token };
}

async function aTokenIsRequiredAndMustBeReal(tokens, f) {
  turnedAway('no token at all', await call('POST', '/rpc/book_hours',
    { body: { jobcard_id: f.jobcard, operation_id: f.op, hours: 4 } }), 401, /sign in first/);
  turnedAway('an invented token', await call('POST', '/rpc/book_hours',
    { token: 'f'.repeat(64), body: { jobcard_id: f.jobcard, operation_id: f.op, hours: 4 } }),
    401, /sign in again/);
  turnedAway('a token of the wrong shape', await call('POST', '/rpc/book_hours',
    { token: 'not-a-token', body: { hours: 4 } }), 401, /sign in first/);
  step('Token: a request with no token, a made-up one, or a malformed one all get nowhere');

  // A signed-out token stops working immediately, which a stateless token could not manage.
  const spare = await call('POST', '/auth/sign-in',
    { body: { email: 'marko@varmak.se', secret: '8472', door: 'pin' } });
  await call('POST', '/auth/sign-out', { token: spare.body.token });
  turnedAway('a token that has been signed out', await call('POST', '/rpc/book_hours',
    { token: spare.body.token, body: { jobcard_id: f.jobcard, operation_id: f.op, hours: 1 } }),
    401, /sign in again/);
  step('Token: signing out kills the token there and then');

  // And a person switched off in the office stops working on the tablet they are already holding.
  sql(`UPDATE app_user SET is_active = false WHERE email = 'petra@varmak.se';`);
  const petra = value(`SELECT token FROM app_session s JOIN app_user u ON u.id = s.user_id
                        WHERE u.email = 'petra@varmak.se' ORDER BY s.started_at DESC LIMIT 1;`);
  if (petra) {
    turnedAway('a session belonging to somebody switched off', await call('POST', '/rpc/book_hours',
      { token: petra, body: { jobcard_id: f.jobcard, operation_id: f.op, hours: 1 } }), 401, /sign in again/);
    step('Token: switching somebody off cuts the session they are already holding');
  }
  sql(`UPDATE app_user SET is_active = true WHERE email = 'petra@varmak.se';`);
}

// ── The promises survive the journey ──────────────────────────────────────────────────────

async function theFloorCannotReachTheOfficeWorkflows(tokens, f) {
  turnedAway('a welder sending a quotation', await call('POST', '/rpc/send_estimate',
    { token: tokens.floor, body: { estimate_id: f.estimate } }), 403, /not yours to do/);
  turnedAway('a welder accepting one', await call('POST', '/rpc/accept_estimate',
    { token: tokens.floor, body: { estimate_id: f.estimate } }), 403, /not yours to do/);
  turnedAway('a welder receiving goods', await call('POST', '/rpc/receive_goods',
    { token: tokens.floor, body: { line_id: f.line, quantity: 1 } }), 403, /not yours to do/);
  turnedAway('a welder converting a lead', await call('POST', '/rpc/convert_lead',
    { token: tokens.floor, body: { lead_id: f.lead } }), 403, /not yours to do/);
  step('Roles over HTTP: the four office workflows are refused for a welder, by the database, through the API');

  // Nothing about the price comes back in the refusal either.
  const attempt = await call('POST', '/rpc/accept_estimate',
    { token: tokens.floor, body: { estimate_id: f.estimate } });
  assert.ok(!JSON.stringify(attempt.body).includes('22.00') && !JSON.stringify(attempt.body).includes('650'),
    `a price leaked in the refusal: ${JSON.stringify(attempt.body)}`);
  step('Roles over HTTP: and the refusal itself carries no figure the welder was not allowed to see');

  turnedAway('a workflow that does not exist', await call('POST', '/rpc/drop_everything',
    { token: tokens.office, body: {} }), 404, /no workflow called/);
  turnedAway('a function that exists but is not on the list', await call('POST', '/rpc/set_password',
    { token: tokens.office, body: {} }), 404, /no workflow called/);
  turnedAway('the issue function underneath', await call('POST', '/rpc/issue_stock',
    { token: tokens.office, body: {} }), 404, /no workflow called/);
  step('Roles over HTTP: only the listed workflows are reachable — the rest of the database is not an endpoint');
}

async function theWorkflowsRunOverHttp(tokens, f) {
  const ref = wentThrough('the office sending the quotation',
    await call('POST', '/rpc/send_estimate', { token: tokens.office, body: { estimate_id: f.estimate } }));
  assert.match(ref, /^EST-\d{4}-\d{4}$/);
  assert.equal(value(`SELECT status FROM estimate WHERE id = ${f.estimate};`), 'sent');

  const project = wentThrough('the office accepting it',
    await call('POST', '/rpc/accept_estimate', { token: tokens.office, body: { estimate_id: f.estimate } }));
  assert.match(project, /^P-\d{4}-\d{3}$/);
  step('Workflows over HTTP: a quotation goes out and comes back accepted, and the project exists');

  const movement = wentThrough('the office receiving steel',
    await call('POST', '/rpc/receive_goods', { token: tokens.office, body: { line_id: f.line, quantity: 100, note: 'One bundle' } }));
  assert.match(movement, /^MV-\d{4}-\d{5}$/);
  assert.equal(value(`SELECT moved_by FROM stock_movement WHERE ref = '${movement}';`), 'Lars Holm',
    'the movement should be recorded against the person whose token was used, not a name in the body');
  step('Workflows over HTTP: steel is received and the movement is signed by whoever the token belonged to');

  const entry = wentThrough('a welder booking hours',
    await call('POST', '/rpc/book_hours', { token: tokens.floor,
      body: { jobcard_id: f.jobcard, operation_id: f.op, hours: 6.5, note: 'From the tablet' } }));
  assert.equal(value(`SELECT worker FROM hours_entry ORDER BY id DESC LIMIT 1;`), 'Marko Ilic');
  assert.ok(entry.startsWith('H-'));
  step('Workflows over HTTP: a welder books hours and they arrive under their own name');

  // The body cannot name somebody else, because the workflow has nowhere to put a name.
  await call('POST', '/rpc/book_hours', { token: tokens.floor,
    body: { jobcard_id: f.jobcard, operation_id: f.op, hours: 1, worker: 'Lars Holm', note: 'Forged' } });
  assert.equal(value(`SELECT count(*) FROM hours_entry WHERE worker = 'Lars Holm';`), '0',
    'a worker name in the request body reached the entry');
  step('Workflows over HTTP: a name in the request body is ignored — there is no parameter for it');
}

async function replayOverHttpIsHarmless(tokens, f) {
  const body = { jobcard_id: f.jobcard, operation_id: f.op, hours: 3, event_id: 'tablet-http-0001', note: 'Queued' };
  const first = wentThrough('the queued entry arriving', await call('POST', '/rpc/book_hours', { token: tokens.floor, body }));
  const again = wentThrough('the tablet flushing it again', await call('POST', '/rpc/book_hours', { token: tokens.floor, body }));
  assert.equal(again, first);
  assert.equal(value(`SELECT count(*) FROM hours_entry WHERE note = 'Queued';`), '1',
    'the tablet flushing its queue twice booked the hours twice');
  step('Offline over HTTP: the tablet can flush its queue blindly — the same event id books once');

  // Ten at once, as a tablet coming back onto the network actually behaves.
  const ten = await Promise.all(Array.from({ length: 10 }, () =>
    call('POST', '/rpc/book_hours', { token: tokens.floor, body: { ...body, event_id: 'tablet-http-0002', note: 'Storm' } })));
  const answered = ten.filter((r) => r.status === 200);
  assert.ok(answered.length >= 1, `at least one of ten should have been answered: ${JSON.stringify(ten[0].body)}`);
  assert.equal(value(`SELECT count(*) FROM hours_entry WHERE note = 'Storm';`), '1',
    'ten simultaneous flushes of one queued entry booked it more than once');
  step('Offline over HTTP: ten flushes of the same entry arriving together still book it exactly once');
}

async function aRefusalFromTheDatabaseReachesThePerson(tokens, f) {
  const tooMuch = await call('POST', '/rpc/receive_goods',
    { token: tokens.office, body: { line_id: f.line, quantity: 9999 } });
  turnedAway('receiving more than was ordered', tooMuch, 422, /outstanding/);
  assert.ok(/PO-\d{4}-\d{4}/.test(tooMuch.body.refused),
    `the refusal should name the order: ${tooMuch.body.refused}`);
  step('Refusals: a database refusal comes back as 422 in the words the database wrote it in');

  const short = await call('POST', '/rpc/issue_material_offline',
    { token: tokens.floor, body: { item_id: f.item, quantity: 99999, jobcard_id: f.jobcard } });
  turnedAway('issuing more steel than exists', short, 422, /cannot issue/);
  assert.ok(short.body.refused.includes('S355-10'),
    `the storeman has to be told which item and how much: ${short.body.refused}`);
  step('Refusals: and it names the item and the shortfall, not the constraint that fired');

  const gate = await call('POST', '/rpc/record_operation',
    { token: tokens.floor, body: { operation_id: f.blockedOp, status: 'in-progress' } });
  turnedAway('starting work on an out-of-service machine', gate, 422, /cannot start/);
  assert.ok(gate.body.refused.includes('out-of-service'));
  step('Refusals: the safety gates speak through the API in their own words');

  const broken = await call('POST', '/rpc/book_hours',
    { token: tokens.floor, body: { jobcard_id: f.jobcard, operation_id: f.op, hours: 99 } });
  turnedAway('a day of ninety-nine hours', broken, 422, /hours/);
  assert.ok(!/pg_|pgcrypto|pg_catalog|\/home\//.test(JSON.stringify(broken.body)),
    `the refusal leaks the inside of the server: ${JSON.stringify(broken.body)}`);
  step('Refusals: nothing about the inside of the database or the server comes back with them');
}

// ── The run ───────────────────────────────────────────────────────────────────────────────

function buildDatabase() {
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', 'postgres', '-qtAX',
    '-c', `DROP DATABASE IF EXISTS ${DB};`, '-c', `CREATE DATABASE ${DB};`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  for (const name of ['schema', 'auth', 'api']) {
    execFileSync('psql', [...conn(DB), '-f', path.join(__dirname, `${name}.sql`)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
}

function world() {
  sql(`SET client_min_messages = warning;
       INSERT INTO app_user (email, display_name, role) VALUES
         ('lars@varmak.se', 'Lars Holm', 'office'),
         ('marko@varmak.se', 'Marko Ilic', 'workshop'),
         ('petra@varmak.se', 'Petra Nilsson', 'workshop');
       SELECT set_password((SELECT id FROM app_user WHERE email = 'lars@varmak.se'), 'a long enough passphrase');
       SELECT set_pin((SELECT id FROM app_user WHERE email = 'marko@varmak.se'), '8472');
       SELECT set_pin((SELECT id FROM app_user WHERE email = 'petra@varmak.se'), '5913');`);

  const customer = value(`INSERT INTO customer (name, city) VALUES ('Skåne Verkstad AB', 'Lund') RETURNING id;`);
  const item = value(`INSERT INTO stock_item (code, description, unit, stock, avg_cost)
    VALUES ('S355-10', 'Plate S355J2 10mm', 'KG', 300, 14.50) RETURNING id;`);
  const project = value(`INSERT INTO project (name, customer_id, status) VALUES ('Frame', ${customer}, 'production') RETURNING id;`);
  const jobcard = value(`INSERT INTO jobcard (project_id, title) VALUES (${project}, 'Weldment') RETURNING id;`);
  const op = value(`INSERT INTO operation (jobcard_id, seq, description) VALUES (${jobcard}, 1, 'Weld out') RETURNING id;`);
  const machine = value(`INSERT INTO equipment (ref, name, category, status)
    VALUES ('EQ-009', 'MIG 400', 'welding', 'out-of-service') RETURNING id;`);
  const blockedOp = value(`INSERT INTO operation (jobcard_id, seq, description, equipment_id)
    VALUES (${jobcard}, 2, 'Grind', ${machine}) RETURNING id;`);
  const estimate = value(`INSERT INTO estimate (title, customer_id) VALUES ('Conveyor frame', ${customer}) RETURNING id;`);
  sql(`INSERT INTO estimate_line (estimate_id, kind, description, quantity, unit, unit_price)
       VALUES (${estimate}, 'material', 'Plate', 500, 'KG', 22.00),
              (${estimate}, 'labour', 'Welding', 40, 'H', 650);`);
  const supplier = value(`INSERT INTO supplier (name) VALUES ('Stål & Metall AB') RETURNING id;`);
  const order = value(`INSERT INTO purchase_order (supplier_id, ordered_by) VALUES (${supplier}, 'Lars Holm') RETURNING id;`);
  const line = value(`INSERT INTO purchase_order_line (purchase_order_id, stock_item_id, description, quantity, unit_price)
    VALUES (${order}, ${item}, 'Plate S355J2 10mm', 500, 13.90) RETURNING id;`);
  const lead = value(`INSERT INTO lead (company, city) VALUES ('Malmö Mekaniska AB', 'Malmö') RETURNING id;`);
  return { customer, item, project, jobcard, op, blockedOp, estimate, line, lead };
}

async function main() {
  buildDatabase();
  const f = world();
  process.env.PGDATABASE = DB;
  process.env.PORT = String(HTTP_PORT);
  const { server, pool } = require('./server');
  await new Promise((resolve) => server.listen(HTTP_PORT, resolve));
  console.log(`Schema, auth and api built into ${DB}; server listening on ${HTTP_PORT}.\n`);

  try {
    theServerDecidesNothing();
    const tokens = await theDoorOverHttp();
    await aTokenIsRequiredAndMustBeReal(tokens, f);
    await theFloorCannotReachTheOfficeWorkflows(tokens, f);
    await theWorkflowsRunOverHttp(tokens, f);
    await replayOverHttpIsHarmless(tokens, f);
    await aRefusalFromTheDatabaseReachesThePerson(tokens, f);
    console.log(`\n${checks} checks: ${attempts.refused} things refused, ${attempts.allowed} allowed, over real HTTP.`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`\n${error.message || error}`);
  process.exitCode = 1;
  process.exit(1);
});
