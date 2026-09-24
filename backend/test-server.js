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
const { ensureUp } = require('./pg');
const { execFileSync } = require('node:child_process');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = process.env.VARMAK_TEST_DB || 'varmak_server_test';
const HTTP_PORT = Number(process.env.VARMAK_HTTP_PORT || 8899);
const BASE = `http://127.0.0.1:${HTTP_PORT}/api`;
const SITE = `http://127.0.0.1:${HTTP_PORT}`;

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
  const { RPC, READS } = require('./server');
  assert.deepEqual(Object.keys(READS).sort(), ['money', 'people', 'snapshot'],
    'reads go through a list too, or the endpoint is a remote SQL console');
  assert.deepEqual(Object.keys(RPC).sort(), [
    'accept_estimate', 'add_person', 'book_hours', 'bootstrap_first_admin', 'change_my_password',
    'convert_lead', 'issue_material_offline', 'receive_goods', 'record_operation',
    'save_customer', 'save_jobcard', 'save_project', 'send_estimate', 'set_customer_contacts',
    'set_jobcard_operations', 'set_person_active', 'set_person_password', 'set_person_pin',
    'set_person_role'
  ], 'the reachable workflows should be exactly the ones named here');
  step(`Thin: exactly ${Object.keys(RPC).length} workflows are reachable over HTTP, by name, from a fixed list`);

  // Every refusal the SQL raises by hand has to land somewhere the person can read, and the only
  // thing deciding that is its error code. server.js turns 42501 into a flat "that is not yours to
  // do", carries five codes through with their own words, and calls everything else a fault at our
  // end — so a refusal raised with any sixth code comes back as "something went wrong at our end".
  //
  // That is not hypothetical. change_my_password raised invalid_password (28P01), which is not on
  // the list, so the one refusal in the whole people flow an ordinary person meets weekly — typing
  // their current password wrong — reached them as a server error. Two suites passed over it: the
  // SQL one asserts the wording and never goes through HTTP, and the HTTP one had no case for it.
  //
  // So the rule is asserted structurally rather than case by case, because the next one will be a
  // function nobody thought to test over HTTP either.
  // Through the same env override the database is built from, not straight off disk. Reading the
  // real api.sql here made this check blind to the very mutation that proves it works — which is the
  // second time in this file a suite has quietly ignored the harness's file and reported a rule as
  // untested when it was being asked about the wrong file.
  const rules = ['api', 'auth'].flatMap((name) => {
    const file = process.env[`VARMAK_${name.toUpperCase()}`] || path.join(__dirname, `${name}.sql`);
    const text = fs.readFileSync(file, 'utf8');
    return [...text.matchAll(/ERRCODE\s*=\s*'([a-z_0-9]+)'/g)].map((m) => ({ name: `${name}.sql`, code: m[1] }));
  });
  const readable = ['check_violation', 'unique_violation', 'foreign_key_violation',
    'not_null_violation', 'raise_exception'];
  const stray = rules.filter((r) => !readable.includes(r.code) && r.code !== 'insufficient_privilege');
  assert.deepEqual(stray.map((r) => `${r.name}: ${r.code}`), [],
    'a refusal raised with a code the server does not recognise comes back as "something went wrong '
    + 'at our end" — raise it plainly instead, which is P0001, and its own words carry through');
  step(`Thin: all ${rules.length} hand-raised refusals use a code that reaches the person as a refusal, not as a fault`);

  // The one that works without a token, and it has to stay the one. Anything else on this list
  // would be a hole in the front door.
  const { WITHOUT_A_SESSION } = require('./server');
  assert.deepEqual([...WITHOUT_A_SESSION], ['bootstrap_first_admin'],
    'only creating the very first admin may happen without a session');
  step('Thin: exactly one call works without a token — creating the first admin, when there is nobody to sign in as');
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

// ── The pages come from the same place as the endpoints ───────────────────────────────────

// One origin, so there is no CORS to get wrong. The risk moves to what else the static server will
// hand out, which is why the list is extensions AND no directories — either alone would serve
// backend/server.js, and a containment check alone would serve node_modules and .git.
async function theSiteIsServedAndNothingElseIs() {
  const page = await fetch(`${SITE}/login.html`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.ok((await page.text()).includes('Varmak'), 'the login page should be the login page');
  attempts.allowed += 1;

  const root = await fetch(`${SITE}/`);
  assert.equal(root.status, 200, 'the root should be the login page');
  attempts.allowed += 1;

  const script = await fetch(`${SITE}/workshop-data.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  attempts.allowed += 1;
  step('Site: the pages and their scripts are served from the same origin as the endpoints');

  // Everything that must not come back. Each of these is a .js or would resolve cleanly, so the
  // extension list on its own would have handed over three of them.
  for (const target of [
    '/backend/server.js', '/backend/schema.sql', '/backend/auth.sql',
    '/node_modules/pg/package.json', '/package.json', '/.git/config',
    '/../etc/passwd', '/..%2f..%2fetc%2fpasswd', '/%2e%2e%2fbackend%2fauth.sql'
  ]) {
    const attempt = await fetch(`${SITE}${target}`);
    attempts.refused += 1;
    assert.equal(attempt.status, 404, `${target} came back with ${attempt.status}`);
    const text = await attempt.text();
    assert.ok(!/CREATE TABLE|GRANT SELECT|require\(/.test(text), `${target} leaked its contents`);
  }
  step('Site: the SQL, the server source, node_modules, .git and every way up out of the directory are all refused');

  const written = await fetch(`${SITE}/login.html`, { method: 'POST' });
  assert.equal(written.status, 405, 'a page is not something to post to');
  attempts.refused += 1;
  step('Site: a page can be read and nothing else');
}

// ── Reading the workshop back ─────────────────────────────────────────────────────────────

// The snapshot is what step 5 needs: the database read back in the shape the pages already use. The
// thing worth testing hardest about it is what a welder's copy does NOT contain — everything step 3
// established about prices is worth nothing if the read endpoint hands them over.
async function theSnapshotCarriesNoPriceForAWelder(tokens, f) {
  const floor = await call('GET', '/read/snapshot', { token: tokens.floor });
  assert.equal(floor.status, 200, JSON.stringify(floor.body));
  attempts.allowed += 1;
  const snapshot = floor.body;

  assert.ok(Array.isArray(snapshot.jobcards) && snapshot.jobcards.length,
    'a welder has to be able to see the work');
  assert.ok(Array.isArray(snapshot.inventory) && snapshot.inventory.length);
  step(`Snapshot: a welder reads the workshop back — ${snapshot.jobcards.length} jobcard(s), ${snapshot.inventory.length} item(s), ${snapshot.projects.length} project(s)`);

  // Searched as text, across the whole document, rather than by checking the fields this test
  // happens to think of. A price that arrives under a name nobody expected is exactly the failure
  // that would slip through a field-by-field check.
  const asText = JSON.stringify(snapshot);
  const priced = ['avgCost', 'lastPrice', 'credit', 'quotedValue', 'purchasePrice', 'sellingPrice',
    'unitPrice', 'total', 'price', 'cost', 'value'];
  const leaked = priced.filter((key) => new RegExp(`"${key}"\\s*:`).test(asText));
  assert.deepEqual(leaked, [],
    `a welder's snapshot carries money under these keys: ${leaked.join(', ')}`);

  // And the actual figures, by value: 14.50 is the plate cost, 412000 what the machine cost.
  for (const figure of ['14.50', '412000', '250000']) {
    assert.ok(!asText.includes(figure), `the figure ${figure} is in a welder's snapshot`);
  }
  step("Snapshot: not one money key and not one of the figures appears in a welder's copy");

  turnedAway('a welder asking for the money separately',
    await call('GET', '/read/money', { token: tokens.floor }), 403, /not yours to do/);

  // Asked of the privilege directly as well, because the 403 above does not distinguish between
  // "you may not call that function" and "you may not read the columns inside it". Both are true
  // and both refuse, which is defence in depth — but it means handing the function to the floor
  // would change nothing observable over HTTP, and then the GRANT would be untested.
  const mayCall = value(`SELECT CASE WHEN has_function_privilege('varmak_workshop', 'workspace_money()', 'EXECUTE')
                                     THEN 'yes' ELSE 'no' END;`);
  assert.equal(mayCall, 'no', 'the workshop holds EXECUTE on the money call');
  const officeMayCall = value(`SELECT CASE WHEN has_function_privilege('varmak_office', 'workspace_money()', 'EXECUTE')
                                          THEN 'yes' ELSE 'no' END;`);
  assert.equal(officeMayCall, 'yes', 'the office has to be able to call it, or this is a broken screen');
  step('Snapshot: asking for the prices directly is refused, and the floor holds no privilege to call it either');
}

async function theOfficeGetsTheFiguresItNeeds(tokens, f) {
  const office = await call('GET', '/read/snapshot', { token: tokens.office });
  assert.equal(office.status, 200);
  attempts.allowed += 1;
  const money = await call('GET', '/read/money', { token: tokens.office });
  assert.equal(money.status, 200, JSON.stringify(money.body));
  attempts.allowed += 1;

  const item = office.body.inventory.find((i) => i.code === 'S355-10');
  assert.ok(item, 'the office should see the same items');
  assert.ok(!('avgCost' in item), 'the plain snapshot carries no money for anybody, including the office');
  assert.equal(money.body.inventory[item.id].avgCost, '14.50',
    'and the office gets the cost from the second call, keyed by the same id');
  step('Snapshot: the office reads the same snapshot and merges the figures from a second call, record by record');

  // Every figure a string, never a JSON number. A JSON number parsed in a browser is a double, and
  // money as a double is the mistake the schema rules out with numeric — reintroducing it on the
  // wire would undo that for the sake of two characters.
  const asNumbers = [];
  for (const [collection, records] of Object.entries(money.body)) {
    for (const [id, fields] of Object.entries(records)) {
      for (const [field, figure] of Object.entries(fields)) {
        if (figure !== null && typeof figure !== 'string') asNumbers.push(`${collection}.${id}.${field}`);
      }
    }
  }
  assert.deepEqual(asNumbers, [],
    `these figures crossed the wire as JSON numbers, which a browser parses as doubles: ${asNumbers.join(', ')}`);
  assert.equal(money.body.inventory[item.id].avgCost.length, 5, '14.50 must keep its scale, not arrive as 14.5');
  step('Snapshot: every figure crosses as text and keeps its scale — money never becomes a double on the way');

  // The split is what makes the rule enforceable. Stated as a check so nobody later "simplifies" it
  // into one function that decides for itself.
  const both = JSON.stringify(office.body);
  assert.ok(!both.includes('14.50'),
    'the plain snapshot has money in it, which means the split has stopped doing anything');
  step('Snapshot: the plain snapshot is priceless for everybody — the money only ever arrives by the granted call');
}

// The customer screen over HTTP: the contacts everybody may read, the commercial half only the
// office may, and a customer made through the endpoint rather than through psql.
async function theCustomerScreenReadsAndWritesOverHttp(tokens, f) {
  const floor = await call('GET', '/read/snapshot', { token: tokens.floor });
  assert.equal(floor.status, 200);
  attempts.allowed += 1;
  const theirs = floor.body.customers.find((c) => c.name === 'Skåne Verkstad AB');
  assert.ok(theirs, 'a welder sees the customer whose job is on the bench');
  assert.ok(Array.isArray(theirs.contacts), 'and the people to ring, which is why that grant exists');
  assert.equal(theirs.contacts.length, 1);
  assert.equal(theirs.contacts[0].name, 'Erik Lund');
  assert.equal(theirs.contacts[0].primary, true, 'the main one has to arrive marked as the main one');
  // The page renders this under a label reading "Preferred Contact". It has to be the method, not a
  // boolean — handing it is_preferred put the word true on that line, and both columns are set here
  // so the wrong one cannot pass by being empty.
  assert.equal(theirs.preferred, 'Email',
    'preferred is how the customer wants to be contacted, not whether the workshop favours them');
  // Nothing the customer is charged, in either shape. Asked of the record rather than of a column
  // list, because the question is what reached the browser.
  for (const withheld of ['priceList', 'discountAgreement', 'terms', 'billing', 'credit', 'deliveryTerms']) {
    assert.ok(!(withheld in theirs), `${withheld} reached a welder's copy of the customer`);
  }
  step('Customers over HTTP: a welder gets the customer and the people to ring, and nothing it is charged');

  const money = await call('GET', '/read/money', { token: tokens.office });
  assert.equal(money.status, 200);
  attempts.allowed += 1;
  const commercial = money.body.customers[theirs.id];
  assert.ok(commercial, 'the office gets the commercial half keyed by the same id');
  assert.equal(commercial.credit, '250000.00', 'and the figure keeps its scale');
  step('Customers over HTTP: and the office gets what it is charged from the granted call, by the same id');

  // Made over HTTP, by the office, with a name nobody has used.
  const created = await call('POST', '/rpc/save_customer', { token: tokens.office, body: {
    name: 'Lomma Svets AB', status: 'active', city: 'Lomma', country: 'Sweden',
    email: 'order@lomma-svets.se', preferred_contact: 'Phone',
    credit_limit: 90000, payment_terms_days: 30, currency: 'SEK'
  } });
  const id = wentThrough('the office making a customer over HTTP', created);
  assert.match(String(id), /^\d+$/);
  assert.equal(sql(`SELECT ref FROM customer WHERE name = 'Lomma Svets AB';`).slice(0, 2), 'C-',
    'the reference still comes from the database, not from the request');

  const twice = await call('POST', '/rpc/save_customer',
    { token: tokens.office, body: { name: 'Lomma Svets AB' } });
  turnedAway('the same customer typed in twice over HTTP', twice, 422, /already a customer called/);
  assert.match(twice.body.refused, /C-\d{3}/, 'and it says which one it already is');

  const byTheFloor = await call('POST', '/rpc/save_customer',
    { token: tokens.floor, body: { name: 'Floor Customer AB' } });
  turnedAway('a welder making a customer over HTTP', byTheFloor, 403, /not yours to do/);
  assert.equal(sql(`SELECT count(*) FROM customer WHERE name = 'Floor Customer AB';`), '0');
  step('Customers over HTTP: the office makes one, the same name twice is refused by its reference, the floor cannot');

  const contacts = await call('POST', '/rpc/set_customer_contacts', { token: tokens.office, body: {
    customer_id: Number(id),
    contacts: [{ name: 'Jonas Ek', role: 'Workshop manager', phone: '+46 40 12 34 56', primary: true }]
  } });
  assert.equal(wentThrough('the contacts going in over HTTP', contacts), 1);
  const two = await call('POST', '/rpc/set_customer_contacts', { token: tokens.office, body: {
    customer_id: Number(id),
    contacts: [{ name: 'Jonas Ek', phone: '+46 40 12 34 56', primary: true },
               { name: 'Eva Ohlsson', phone: '+46 40 65 43 21', primary: true }]
  } });
  turnedAway('two main contacts over HTTP', two, 422, /one main contact, and this list has 2/);
  assert.equal(sql(`SELECT count(*) FROM customer_contact WHERE customer_id = ${id};`), '1',
    'a refused list leaves the one that was there — the refusal has to roll the delete back too');
  step('Customers over HTTP: a list arrives as a list, and a refused one leaves the old contacts alone');
}

async function theSnapshotIsTheShapeThePagesRead(tokens) {
  const { body } = await call('GET', '/read/snapshot', { token: tokens.office });
  for (const collection of ['customers', 'projects', 'jobcards', 'equipment', 'hours', 'inventory']) {
    assert.ok(Array.isArray(body[collection]), `${collection} should be an array like the pages expect`);
  }
  const jobcard = body.jobcards[0];
  // The names the pages actually read. Checked by name because the whole purpose of building the
  // snapshot in SQL is that these match without the browser renaming anything.
  for (const field of ['no', 'projectNo', 'title', 'status', 'archived', 'operations']) {
    assert.ok(field in jobcard, `a jobcard needs ${field} — the phone screen filters on it`);
  }
  // Not merely an array — the steps really on it. An empty array satisfies "is an array" and is
  // exactly what a snapshot that stopped nesting them would return, so the count is checked against
  // the database rather than against nothing.
  assert.ok(Array.isArray(jobcard.operations), 'operations arrive nested on the jobcard, as the pages read them');
  const stepsInDb = value(`SELECT count(*) FROM operation o JOIN jobcard j ON j.id = o.jobcard_id
                            WHERE j.ref = '${jobcard.no}';`);
  assert.ok(Number(stepsInDb) > 0, 'the fixture should give this jobcard some operations to nest');
  assert.equal(String(jobcard.operations.length), stepsInDb,
    `the jobcard carries ${jobcard.operations.length} operations and the database has ${stepsInDb}`);
  for (const field of ['id', 'desc', 'plannedHours', 'status']) {
    assert.ok(field in jobcard.operations[0], `an operation needs ${field}`);
  }
  assert.ok(jobcard.operations[0].desc, 'an operation with no description is not a step anybody can pick');
  assert.match(jobcard.no, /^JC-\d{4}-\d{4}$/);
  assert.equal(jobcard.projectNo, body.projects.find((p) => p.id === jobcard.projectId).no,
    'the jobcard names its project by the reference the page filters on');
  step('Snapshot: it arrives in the shape the pages already read — nested operations, references, and the field names they use');

  assert.ok(body.takenAt, 'a snapshot has to say when it was taken');
  assert.equal(body.takenBy, 'Lars Holm', 'and who it was taken for');
  step('Snapshot: it says when it was taken and whose view it is');
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

// Getting work onto the bench over HTTP, which is the path the estimating and jobcard screens will
// take. The interesting half is the last check: the step list is the only workflow in this system
// whose refusal protects a record of work already done.
async function workReachesTheFloorOverHttp(tokens, f) {
  const project = wentThrough('the office starting a project over HTTP',
    await call('POST', '/rpc/save_project', { token: tokens.office, body: {
      name: 'Hopper frame', customer_id: Number(f.customer), status: 'quotation',
      planned_hours: 32, responsible: 'Lars Holm', quoted_value: 180000
    } }));
  assert.match(String(project), /^\d+$/);
  assert.match(sql(`SELECT ref FROM project WHERE id = ${project};`), /^P-\d{4}-\d{3}$/);

  const jobcard = wentThrough('a jobcard on it over HTTP',
    await call('POST', '/rpc/save_jobcard', { token: tokens.office, body: {
      project_id: Number(project), title: 'Hopper weldment', quantity: 1, planned_hours: 18,
      priority: 'high', responsible: 'Marko Ilic'
    } }));
  assert.equal(sql(`SELECT (j.customer_id = p.customer_id)::text FROM jobcard j
    JOIN project p ON p.id = j.project_id WHERE j.id = ${jobcard};`), 'true',
    'the customer came from the project, and there is no parameter that could have said otherwise');

  const steps = wentThrough('the steps over HTTP',
    await call('POST', '/rpc/set_jobcard_operations', { token: tokens.office, body: {
      jobcard_id: Number(jobcard),
      operations: [{ desc: 'Cut and prepare', plannedHours: 6 },
                   { desc: 'Weld out', plannedHours: 12, inspectionCheckpoint: true }]
    } }));
  assert.equal(steps, 2);
  assert.equal(sql(`SELECT string_agg(seq::text || '=' || description, ', ' ORDER BY seq)
    FROM operation WHERE jobcard_id = ${jobcard};`), '1=Cut and prepare, 2=Weld out');
  step('Work over HTTP: a project, a jobcard on it and its steps all go in through the endpoint');

  const byTheFloor = await call('POST', '/rpc/save_project',
    { token: tokens.floor, body: { name: 'Floor project', customer_id: Number(f.customer) } });
  turnedAway('a welder starting a project over HTTP', byTheFloor, 403, /not yours to do/);
  const cardByTheFloor = await call('POST', '/rpc/save_jobcard',
    { token: tokens.floor, body: { project_id: Number(project), title: 'Floor weldment' } });
  turnedAway('a welder writing a jobcard over HTTP', cardByTheFloor, 403, /not yours to do/);
  assert.equal(sql(`SELECT count(*) FROM project WHERE name = 'Floor project';`), '0');
  step('Work over HTTP: and the floor is refused both, by the database rather than by the server');

  // Book an hour against the second step through the floor's own workflow, then try to take that step
  // off the plan. The refusal has to name the step and the hours, over the wire, as a refusal — not
  // as a fault at our end.
  sql(`UPDATE jobcard SET status = 'released' WHERE id = ${jobcard};
       UPDATE jobcard SET status = 'ready' WHERE id = ${jobcard};
       UPDATE jobcard SET status = 'in-progress' WHERE id = ${jobcard};`);
  const weldOut = sql(`SELECT id FROM operation WHERE jobcard_id = ${jobcard} AND seq = 2;`);
  wentThrough('a welder booking hours on the weld-out over HTTP',
    await call('POST', '/rpc/book_hours', { token: tokens.floor, body: {
      jobcard_id: Number(jobcard), operation_id: Number(weldOut), hours: 3.5, note: 'Root pass'
    } }));
  const cutOnly = sql(`SELECT id FROM operation WHERE jobcard_id = ${jobcard} AND seq = 1;`);
  const removed = await call('POST', '/rpc/set_jobcard_operations', { token: tokens.office, body: {
    jobcard_id: Number(jobcard),
    operations: [{ id: cutOnly, desc: 'Cut and prepare', plannedHours: 6 }]
  } });
  turnedAway('taking off a step with hours booked on it, over HTTP', removed, 422,
    /3.50 hours booked on it and cannot be taken off/);
  assert.match(removed.body.refused, /Weld out/, 'and it names the step rather than its number alone');
  assert.equal(sql(`SELECT count(*) FROM operation WHERE jobcard_id = ${jobcard};`), '2');
  assert.equal(sql(`SELECT count(*) FROM hours_entry WHERE operation_id = ${weldOut};`), '1',
    'the hours are still there and still know which step they were booked on');
  step('Work over HTTP: a step somebody has worked on cannot be taken off the plan, and the refusal says why');
}

// The one call that works without a token, and the one whose refusal is not about who is asking.
//
// server.js replaces the text of every 42501 with "that is not yours to do", because Postgres writes
// its own privilege errors as "permission denied for table stock_item" and that names the inside of
// the database to whoever asked. The bootstrap's refusal was raised as 42501 and therefore reached
// the first-run screen as "that is not yours to do" — wrong, since nobody is signed in and nobody
// can be, and useless to the person standing in front of it. The rule this asserts: a refusal
// written to be read must not claim to be a privilege error.
async function theFirstRunRefusalSaysWhatIsActuallyWrong() {
  const second = await call('POST', '/rpc/bootstrap_first_admin',
    { body: { email: 'someone@varmak.se', display_name: 'Someone Else', password: 'another long passphrase' } });
  turnedAway('a second use of the bootstrap over HTTP', second, 422, /already has people in it/);
  assert.ok(!/not yours to do/.test(String(second.body.refused)),
    'this refusal is about the state of the system, not about who is asking, and has to say so');
  step('First run: the bootstrap refusal reaches the screen in its own words, not as a privilege error');

  // And the things that ARE about who is asking still say nothing more than that.
  const byAWelder = await call('POST', '/rpc/add_person',
    { token: (await call('POST', '/auth/sign-in',
      { body: { email: 'marko@varmak.se', secret: '8472', door: 'pin' } })).body.token,
      body: { email: 'ghost@varmak.se', display_name: 'Ghost', role: 'admin' } });
  turnedAway('a welder adding somebody over HTTP', byAWelder, 403, /not yours to do/);
  assert.ok(!/app_user|permission denied for/.test(JSON.stringify(byAWelder.body)),
    'a privilege refusal must not name a table');
  step('First run: and a refusal that IS about who is asking still names nothing inside the database');
}

// ── The run ───────────────────────────────────────────────────────────────────────────────

function buildDatabase() {
  ensureUp();
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', 'postgres', '-qtAX',
    '-c', `DROP DATABASE IF EXISTS ${DB};`, '-c', `CREATE DATABASE ${DB};`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // The env override matters: mutation-check.js hands a damaged copy of one file through
  // VARMAK_SCHEMA / VARMAK_AUTH / VARMAK_API / VARMAK_VIEWS. Without reading it this suite silently
  // builds the real files and reports every mutation as uncaught — which it did, for all five
  // views.sql mutations at once, and a run where everything is MISSED is the shape of a harness
  // fault rather than a row of untested rules.
  for (const name of ['schema', 'auth', 'api', 'views']) {
    const file = process.env[`VARMAK_${name.toUpperCase()}`] || path.join(__dirname, `${name}.sql`);
    execFileSync('psql', [...conn(DB), '-f', file],
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

  // With its commercial half filled in, so the checks that a welder is not shown what a customer is
  // charged are asking about real values rather than about columns that happen to be empty.
  const customer = value(`INSERT INTO customer
    (name, city, credit_limit, payment_terms_days, price_list, discount_agreement,
     delivery_terms, billing_address)
    VALUES ('Skåne Verkstad AB', 'Lund', 250000, 30, 'Standard 2026', '4% over 200k',
            'Ex Works', 'Box 4, 222 22 Lund') RETURNING id;`);
  sql(`UPDATE customer SET preferred_contact = 'Email', is_preferred = true WHERE id = ${customer};`);
  sql(`INSERT INTO customer_contact (customer_id, name, role, phone, is_primary)
       VALUES (${customer}, 'Erik Lund', 'Purchasing', '+46 70 111 22 33', true);`);
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
    await theSiteIsServedAndNothingElseIs();
    const tokens = await theDoorOverHttp();
    await aTokenIsRequiredAndMustBeReal(tokens, f);
    await theSnapshotCarriesNoPriceForAWelder(tokens, f);
    await theOfficeGetsTheFiguresItNeeds(tokens, f);
    await theSnapshotIsTheShapeThePagesRead(tokens);
    await theCustomerScreenReadsAndWritesOverHttp(tokens, f);
    await workReachesTheFloorOverHttp(tokens, f);
    await theFloorCannotReachTheOfficeWorkflows(tokens, f);
    await theWorkflowsRunOverHttp(tokens, f);
    await replayOverHttpIsHarmless(tokens, f);
    await aRefusalFromTheDatabaseReachesThePerson(tokens, f);
    await theFirstRunRefusalSaysWhatIsActuallyWrong();
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
