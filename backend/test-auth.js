'use strict';

// The promise in BACKEND.md §1b is one sentence:
//
//     "A welder's session must be unable to read the customer's agreed price even by asking the
//      API directly."
//
// This file asks directly. Every check below runs as a real Postgres role — SET ROLE varmak_workshop
// and then the rudest query that role could write — because row-level security tested as the
// superuser proves nothing at all: the superuser bypasses it, so every policy in the file would
// pass whether it existed or not. That is the single easiest way to ship an auth layer that does
// nothing, and it is why the first check in this file is that the tests are not running as
// somebody who cannot be stopped.
//
// Built fresh from schema.sql + auth.sql on every run.

const assert = require('node:assert/strict');
const { execFileSync, execFile } = require('node:child_process');
const path = require('node:path');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = process.env.VARMAK_TEST_DB || 'varmak_auth_test';
const SCHEMA = process.env.VARMAK_SCHEMA || path.join(__dirname, 'schema.sql');
const AUTH = process.env.VARMAK_AUTH || path.join(__dirname, 'auth.sql');

function conn(db) {
  return ['-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1', '-qtAX'];
}

// ── Asking as somebody ────────────────────────────────────────────────────────────────────

// Every statement runs inside a session that has become the given role and said who it is, which
// is exactly what the API does after checking a credential. RESET ROLE at the end so the next
// call starts clean.
function as(role, userId, text) {
  const preamble = [
    `SET app.user_id = '${userId === null ? '' : userId}';`,
    role ? `SET ROLE ${role};` : ''
  ].join('\n');
  try {
    const out = execFileSync('psql', conn(DB), {
      input: `${preamble}\n${text}`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    });
    return { ok: true, out: out.trim().split('\n').filter((l) => l !== '' && l !== 'SET').join('\n').trim() };
  } catch (error) {
    const stderr = String(error.stderr || '');
    const line = (stderr.split('\n').find((l) => /ERROR/.test(l)) || stderr).trim();
    return { ok: false, message: line.replace(/^.*ERROR:\s*/, '') };
  }
}

function sql(text, db = DB) {
  return execFileSync('psql', conn(db), { input: text, encoding: 'utf8' }).trim();
}
function value(text, db = DB) { return sql(text, db).split('\n')[0].trim(); }

const attempts = { refused: 0, allowed: 0 };

function denied(what, role, userId, text, expected) {
  const result = as(role, userId, text);
  attempts.refused += 1;
  assert.equal(result.ok, false,
    `${what}: ALLOWED — ${role || 'an unauthenticated session'} got "${result.out}"`);
  assert.match(result.message, expected, `${what}: refused, but not for the reason expected`);
  return result.message;
}

function allowed(what, role, userId, text) {
  const result = as(role, userId, text);
  attempts.allowed += 1;
  assert.equal(result.ok, true, `${what}: refused but should have been allowed — ${result.message}`);
  return result.out;
}

let checks = 0;
function step(message) { checks += 1; console.log(`OK   ${message}`); }

// ── The people ────────────────────────────────────────────────────────────────────────────

const PEOPLE = {};

function makeWorkshop() {
  sql(`SET client_min_messages = warning;
       TRUNCATE app_session, activity_log, hours_entry, stock_movement, operation, jobcard,
             project, customer, stock_item, quality_hold, estimate, estimate_line, supplier,
             supplier_item, app_user RESTART IDENTITY CASCADE;`);
  PEOPLE.admin = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('anna@varmak.se', 'Anna Berg', 'admin') RETURNING id;`);
  PEOPLE.office = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('lars@varmak.se', 'Lars Holm', 'office') RETURNING id;`);
  PEOPLE.welder = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('marko@varmak.se', 'Marko Ilic', 'workshop') RETURNING id;`);
  PEOPLE.other = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('petra@varmak.se', 'Petra Nilsson', 'workshop') RETURNING id;`);
  sql(`SELECT set_password(${PEOPLE.admin}, 'correct horse battery staple');
       SELECT set_password(${PEOPLE.welder}, 'a much longer passphrase');
       SELECT set_pin(${PEOPLE.welder}, '8472');
       SELECT set_pin(${PEOPLE.other}, '5913');`);

  const customer = value(`INSERT INTO customer (name, city, credit_limit)
    VALUES ('Skåne Verkstad AB', 'Lund', 250000) RETURNING id;`);
  const project = value(`INSERT INTO project (name, customer_id) VALUES ('Conveyor frame', ${customer}) RETURNING id;`);
  const jobcard = value(`INSERT INTO jobcard (project_id, title) VALUES (${project}, 'Weldment') RETURNING id;`);
  const op = value(`INSERT INTO operation (jobcard_id, seq, description) VALUES (${jobcard}, 1, 'Weld out') RETURNING id;`);
  const item = value(`INSERT INTO stock_item (code, description, unit, stock, avg_cost)
    VALUES ('S355-10', 'Plate S355J2 10mm', 'KG', 500, 14.50) RETURNING id;`);
  const estimate = value(`INSERT INTO estimate (title, customer_id) VALUES ('Conveyor frame', ${customer}) RETURNING id;`);
  sql(`INSERT INTO estimate_line (estimate_id, kind, description, quantity, unit_price)
       VALUES (${estimate}, 'material', 'Plate', 500, 22.00);`);
  return { customer, project, jobcard, op, item, estimate };
}

// ── Nothing here is being tested as somebody who cannot be stopped ────────────────────────

function theTestsAreNotCheating() {
  const whoTheRunnerIs = value(`SELECT current_user || ' superuser=' || (SELECT usesuper FROM pg_user WHERE usename = current_user);`);
  assert.match(whoTheRunnerIs, /superuser=t/, 'the harness itself connects as a superuser to build the database');

  // And the roles it tests with are not. If any of them were superuser or held BYPASSRLS, every
  // policy in auth.sql would pass whether or not it had ever been written.
  const dangerous = sql(`SELECT rolname || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls
    FROM pg_roles WHERE rolname IN ('varmak_admin','varmak_office','varmak_workshop','varmak_api')
      AND (rolsuper OR rolbypassrls);`);
  assert.equal(dangerous, '', `a role under test can step around row security, so nothing below means anything: ${dangerous}`);

  // The one role that may, may only own the four functions that have to work before sign-in.
  const bypass = sql(`SELECT p.proname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE r.rolbypassrls AND NOT r.rolsuper AND p.pronamespace = 'public'::regnamespace ORDER BY 1;`)
    .split('\n').map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(bypass.sort(), [
    'current_app_name', 'current_app_role', 'issue_material', 'issue_stock',
    'project_hours_roll_up', 'register_failure',
    'session_owner', 'set_password', 'set_pin', 'sign_in', 'sign_out'
  ], `the list of functions that step around row security must stay short and known — it is: ${bypass.join(', ')}`);
  // This suite builds schema.sql and auth.sql only, so it cannot see anything api.sql adds. The
  // same check runs in test-api.js over all three, or a function added there could step around row
  // security with nothing watching.
  step(`Harness: the roles under test cannot bypass row security, and only ${bypass.length} named functions may`);

  const unprotected = sql(`SELECT tablename FROM pg_tables t WHERE schemaname = 'public'
    AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = t.tablename AND c.relrowsecurity)
    ORDER BY 1;`);
  assert.equal(unprotected, '', `these tables have row security switched off entirely: ${unprotected}`);
  const unforced = sql(`SELECT relname FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND NOT relforcerowsecurity ORDER BY 1;`);
  assert.equal(unforced, '', `these tables exempt their own owner from row security: ${unforced}`);
  step('Harness: every table has row security enabled, and forced, so the owner is held to it too');
}

// A GRANT with no policy behind it is a privilege that does nothing. It fails closed, so it is not
// dangerous — it is just broken, and broken in the quietest possible way: the role holds INSERT on
// the table, every read of the SQL says it may write, and every write it attempts matches no rows
// or is filtered away.
//
// This is written because exactly that happened. The first version of auth.sql had write policies
// on a handful of tables and none at all on estimate, estimate_line, supplier, purchase_order, lead
// and eleven others. The office could not create an estimate. Nothing noticed, because the auth
// tests up to then asked what the floor could not do and took the office for granted, and it only
// came out when a workflow in step 4 tried to lock an estimate row and was told no such estimate.
function everyWritePrivilegeHasAPolicyBehindIt() {
  const orphans = sql(`
    SELECT g.grantee || ' ' || lower(g.privilege_type) || ' on ' || g.table_name
      FROM information_schema.table_privileges g
     WHERE g.table_schema = 'public'
       AND g.grantee IN ('varmak_admin', 'varmak_office', 'varmak_workshop')
       AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = g.table_name
            AND (p.cmd = 'ALL' OR p.cmd = g.privilege_type)
       )
     ORDER BY 1;`).split('\n').map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(orphans, [],
    `these roles hold a write privilege that no policy permits, so the privilege silently does nothing:\n  ${orphans.join('\n  ')}`);
  step(`Harness: every write privilege any role holds has a policy behind it — a GRANT with no policy is a quiet no-op`);
}

// ── The sentence this whole file exists for ───────────────────────────────────────────────

// Every column in the database that holds money. Asked of the privilege tables rather than by
// running a query per column, because this is the check that has to still work in two years when
// somebody adds a price to a table nobody thought of. A query-per-column suite only ever tests the
// columns whose names were typed into it.
const MONEY = [
  ['customer', 'credit_limit'], ['stock_item', 'avg_cost'], ['supplier_item', 'price'],
  ['purchase_order_line', 'unit_price'], ['opportunity', 'value'], ['tender', 'value'],
  ['estimate', 'total'], ['estimate', 'margin_pct'], ['estimate_line', 'unit_price'],
  ['estimate_line', 'line_total'], ['equipment_event', 'cost'],
  // Added in step 5, when widening the schema gave two more tables a figure in kronor. Neither was
  // noticed by hand — the check below flagged them both the minute the columns appeared, and one of
  // them (equipment.purchase_price) was readable by every welder because equipment was still in a
  // whole-table grant.
  ['equipment', 'purchase_price'], ['stock_item', 'last_price'],
  // And project, in the next widening pass. Four tables have now gained a money column after being
  // put in a whole-table grant; this check is the only thing that has noticed any of them.
  ['project', 'quoted_value'],
  // lead is not granted to the workshop at all, so this one is already out of reach — but the list
  // has to stay complete or the check that the list is complete stops meaning anything.
  ['lead', 'estimated_value']
];

function noPriceColumnIsReachable() {
  // First: the list above is complete. A numeric column with a money-ish name that is not on it is
  // a price nobody remembered to protect.
  const looksLikeMoney = sql(`SELECT table_name || '.' || column_name FROM information_schema.columns
     WHERE table_schema = 'public'
       AND data_type = 'numeric'
       AND (column_name ~ 'price|cost|value|total|credit|margin')
     ORDER BY 1;`).split('\n').map((l) => l.trim()).filter(Boolean);
  const unlisted = looksLikeMoney.filter((c) => !MONEY.some(([t, col]) => `${t}.${col}` === c));
  assert.deepEqual(unlisted, [],
    `these columns hold money and nothing in this suite protects them: ${unlisted.join(', ')}`);
  step(`Money: all ${MONEY.length} columns in the database that hold a figure in kronor are accounted for`);

  // Then: the workshop role holds no privilege on any of them. Asked of the server's own privilege
  // tables, so a broad table grant that quietly includes a price column shows up here — which is
  // exactly how the first version of auth.sql was caught handing avg_cost to every welder.
  // Answered as a word rather than a boolean, on purpose. The first version of this asked for
  // has_column_privilege(...)::text and compared it to 't' — but casting a Postgres boolean to text
  // gives 'true'; 't' is only how psql prints it. So the comparison was never true, nothing was
  // ever added to the list, and this check passed while the workshop could read every price in the
  // building. It was caught only because the office check below failed out loud.
  function mayRead(role, table, column) {
    const answer = value(`SELECT CASE WHEN has_column_privilege('${role}', '${table}', '${column}', 'SELECT')
                                      THEN 'yes' ELSE 'no' END;`);
    assert.ok(answer === 'yes' || answer === 'no', `the privilege question answered "${answer}"`);
    return answer === 'yes';
  }

  const reachable = MONEY.filter(([t, c]) => mayRead('varmak_workshop', t, c)).map((m) => m.join('.'));
  assert.deepEqual(reachable, [], `the workshop role can read these money columns: ${reachable.join(', ')}`);
  step('Money: and the workshop role holds no read privilege on a single one of them');

  // The office must still be able to do its job, or this is not a rule about roles.
  const blind = MONEY.filter(([t, c]) => !mayRead('varmak_office', t, c)).map((m) => m.join('.'));
  assert.deepEqual(blind, [], `the office cannot read these, which stops it quoting: ${blind.join(', ')}`);
  step('Money: the office can read all of them, which is the difference between a rule and a broken column');
}

function aWelderCannotReadAPrice(f) {
  denied('a welder reading the cost of a plate', 'varmak_workshop', PEOPLE.welder,
    `SELECT avg_cost FROM stock_item WHERE id = ${f.item};`, /permission denied|column .* does not exist/);
  denied('a welder reading the customer credit limit', 'varmak_workshop', PEOPLE.welder,
    `SELECT credit_limit FROM customer WHERE id = ${f.customer};`, /permission denied|column .* does not exist/);
  denied('a welder reading what the job was quoted at', 'varmak_workshop', PEOPLE.welder,
    `SELECT total FROM estimate;`, /permission denied/);
  denied('a welder reading the estimate lines', 'varmak_workshop', PEOPLE.welder,
    `SELECT unit_price FROM estimate_line;`, /permission denied/);
  denied('a welder reading what a supplier charges', 'varmak_workshop', PEOPLE.welder,
    `SELECT price FROM supplier_item;`, /permission denied/);
  denied('a welder reading the purchase orders', 'varmak_workshop', PEOPLE.welder,
    `SELECT * FROM purchase_order;`, /permission denied/);
  denied('a welder reading the sales pipeline', 'varmak_workshop', PEOPLE.welder,
    `SELECT value FROM opportunity;`, /permission denied/);
  step('Money: a welder asking the database directly for a price is refused by the server, on every table that holds one');

  // The greedy query, which is the one somebody actually writes.
  denied('a welder selecting everything from the store', 'varmak_workshop', PEOPLE.welder,
    `SELECT * FROM stock_item;`, /permission denied/);
  denied('a welder selecting everything from the customers', 'varmak_workshop', PEOPLE.welder,
    `SELECT * FROM customer;`, /permission denied/);
  step('Money: SELECT * is refused too — the price cannot arrive by accident in a query nobody read');

  // Arithmetic is still reading it.
  denied('a welder asking whether the cost is over ten', 'varmak_workshop', PEOPLE.welder,
    `SELECT id FROM stock_item WHERE avg_cost > 10;`, /permission denied/);
  denied('a welder ordering by a price to find the dearest', 'varmak_workshop', PEOPLE.welder,
    `SELECT code FROM stock_item ORDER BY avg_cost DESC LIMIT 1;`, /permission denied/);
  denied('a welder counting how many plates cost more than twenty', 'varmak_workshop', PEOPLE.welder,
    `SELECT count(*) FROM stock_item WHERE avg_cost > 20;`, /permission denied/);
  step('Money: nor can a price be reached sideways — filtering, sorting and counting by it are all reading it');

  // And the columns they legitimately need still work, or the rule is just a broken store screen.
  const row = allowed('a welder reading what they need from the store', 'varmak_workshop', PEOPLE.welder,
    `SELECT code || ' ' || stock || ' ' || unit FROM stock_item WHERE id = ${f.item};`);
  assert.equal(row, 'S355-10 500.000 KG');
  const who = allowed('a welder seeing whose job is on the bench', 'varmak_workshop', PEOPLE.welder,
    `SELECT name || ', ' || city FROM customer WHERE id = ${f.customer};`);
  assert.equal(who, 'Skåne Verkstad AB, Lund');
  step('Money: and everything a welder does need — the code, the quantity, whose job it is — still reads');

  const seen = allowed('the office reading the same figures', 'varmak_office', PEOPLE.office,
    `SELECT avg_cost::text FROM stock_item WHERE id = ${f.item};`);
  assert.equal(seen, '14.50');
  assert.equal(allowed('the office reading the quote', 'varmak_office', PEOPLE.office,
    `SELECT total::text FROM estimate;`), '11000.00');
  step('Money: the office sees all of it, which is what makes this a rule about roles and not a broken column');
}

// ── Signing in ────────────────────────────────────────────────────────────────────────────

function secretsAreNeverStored() {
  const stored = sql(`SELECT coalesce(password_hash,'') || '|' || coalesce(pin_hash,'')
                        FROM app_user WHERE id = ${PEOPLE.welder};`);
  assert.ok(!stored.includes('8472'), 'the PIN is in the table in plain sight');
  assert.ok(!stored.includes('a much longer passphrase'), 'the password is in the table in plain sight');
  assert.match(stored, /^\$2[aby]\$10\$.+\|\$2[aby]\$08\$.+$/, `neither looks like bcrypt: ${stored}`);

  // The same PIN set on two people must not produce the same hash, or the table tells you who
  // shares a PIN with whom without anybody knowing either.
  sql(`SELECT set_pin(${PEOPLE.other}, '8472');`);
  const pair = sql(`SELECT count(DISTINCT pin_hash) FROM app_user WHERE pin_hash IS NOT NULL;`);
  assert.equal(pair, '2', 'two people with the same PIN have the same hash — the salt is not doing anything');
  sql(`SELECT set_pin(${PEOPLE.other}, '5913');`);
  step('Secrets: neither the password nor the PIN is in the database, and the same PIN twice looks different');
}

function obviousSecretsAreRefused() {
  const bad = ['0000', '1234', '1111', '4321', '2580'];
  for (const pin of bad) {
    denied(`the PIN ${pin}`, null, null, `SELECT set_pin(${PEOPLE.welder}, '${pin}');`, /first a stranger would try/);
  }
  denied('a three-digit PIN', null, null, `SELECT set_pin(${PEOPLE.welder}, '847');`, /four to eight digits/);
  denied('a PIN with a letter in it', null, null, `SELECT set_pin(${PEOPLE.welder}, '84a2');`, /four to eight digits/);
  denied('a PIN of the same digit repeated', null, null, `SELECT set_pin(${PEOPLE.welder}, '777777');`, /first a stranger would try/);
  allowed('a PIN that is not one of those', null, null, `SELECT set_pin(${PEOPLE.welder}, '8472');`);
  step('Secrets: the PINs a stranger tries first are refused, and a PIN is four to eight digits');

  denied('a short password', null, null, `SELECT set_password(${PEOPLE.admin}, 'Passw0rd!');`, /twelve characters/);
  denied('a long password off every list', null, null,
    `SELECT set_password(${PEOPLE.admin}, 'password1234');`, /every list a guesser starts from/);
  allowed('a passphrase', null, null, `SELECT set_password(${PEOPLE.admin}, 'correct horse battery staple');`);
  step('Secrets: a password is long rather than decorated — length is what costs a guesser something');
}

// sign_in answers with a token or a refusal, and never raises — it has to record a failed attempt,
// and a function that raises rolls back what it just recorded.
function signIn(email, secret, door, device) {
  const out = value(`SELECT coalesce((sign_in('${email}', '${secret}', '${door}'`
    + `${device ? `, '${device}'` : ''})).token, '') || '|'`
    + ` || coalesce((sign_in('${email}', '${secret}', '${door}'${device ? `, '${device}'` : ''})).refused, '');`);
  const [token, refused] = out.split('|');
  return { token, refused };
}

// One call, both fields, because calling sign_in twice counts two attempts.
function tryDoor(email, secret, door, device) {
  const out = value(`SELECT coalesce(token, '') || '|' || coalesce(refused, '') FROM sign_in('${email}', '${secret}', '${door}'${device ? `, '${device}'` : ''});`);
  const [token, refused] = out.split('|');
  return { token, refused };
}

function opened(what, email, secret, door, device) {
  const r = tryDoor(email, secret, door, device);
  attempts.allowed += 1;
  assert.equal(r.refused, '', `${what}: refused — ${r.refused}`);
  assert.ok(r.token, `${what}: no token came back`);
  return r.token;
}

function shut(what, email, secret, door, expected) {
  const r = tryDoor(email, secret, door);
  attempts.refused += 1;
  assert.equal(r.token, '', `${what}: the door OPENED and handed back a token`);
  assert.match(r.refused, expected, `${what}: refused, but not for the reason expected`);
  return r.refused;
}

function theDoorsOpenAndSayNothingExtra() {
  const token = opened('the right password', 'anna@varmak.se', 'correct horse battery staple', 'password', 'office laptop');
  assert.match(token, /^[0-9a-f]{64}$/, `a session token should be unguessable: ${token}`);
  assert.equal(value(`SELECT user_id FROM app_session WHERE token = '${token}';`), PEOPLE.admin);
  step('Doors: the office door opens on email and password and hands back a random token');

  const wrong = shut('the wrong password', 'anna@varmak.se', 'not the password', 'password', /not a login we recognise/);
  const unknown = shut('an address nobody has', 'nobody@varmak.se', 'not the password', 'password', /not a login we recognise/);
  assert.equal(wrong, unknown,
    'a wrong password and an unknown address must give the same answer, or the refusal tells a stranger which addresses are real');
  step('Doors: a wrong password and an address nobody has are refused in exactly the same words');

  const pinToken = opened('a PIN at the shop tablet', 'marko@varmak.se', '8472', 'pin', 'hall tablet');
  assert.equal(value(`SELECT door::text FROM app_session WHERE token = '${pinToken}';`), 'pin');
  step('Doors: the shop tablet opens on a PIN');

  // The strength of the door has to match what is behind it. An admin at the shared tablet gets
  // the tablet's authority, not their own, or the two-door argument collapses.
  sql(`SELECT set_pin(${PEOPLE.admin}, '3947');`);
  shut('an admin signing in with a PIN on the shared tablet', 'anna@varmak.se', '3947', 'pin', /needs the office door/);
  step('Doors: an admin cannot pick up admin rights from the shared tablet by typing a PIN');

  shut('a PIN used at the office door', 'marko@varmak.se', '8472', 'password', /not a login we recognise/);
  shut('a password used at the tablet', 'marko@varmak.se', 'a much longer passphrase', 'pin', /not a login we recognise/);
  step('Doors: each door only accepts its own kind of secret');
}

function guessingIsNotWorthIt() {
  sql(`UPDATE app_user SET failed_attempts = 0, locked_until = NULL WHERE id = ${PEOPLE.other};`);
  sql(`SELECT set_pin(${PEOPLE.other}, '5913');`);
  for (let i = 0; i < 5; i += 1) {
    shut(`guess ${i + 1}`, 'petra@varmak.se', `000${i}`, 'pin', /not a login we recognise/);
  }
  // The correct PIN, on the sixth try. This is the check that found the lockout doing nothing at
  // all, because the exception that refused the fifth guess also rolled back the count of it.
  const locked = shut('the sixth guess, with the right PIN', 'petra@varmak.se', '5913', 'pin', /too many tries/);
  assert.match(locked, /locked until \d\d:\d\d/, `the refusal should say until when: ${locked}`);
  // The correct PIN is refused while the lock stands — otherwise the lockout only inconveniences
  // the person who forgot theirs and does nothing at all to somebody working through ten thousand.
  step('Doors: five wrong tries locks the login for fifteen minutes, and the right PIN does not open it either');

  sql(`UPDATE app_user SET locked_until = now() - interval '1 minute' WHERE id = ${PEOPLE.other};`);
  opened('the right PIN once the lock has run out', 'petra@varmak.se', '5913', 'pin');
  assert.equal(value(`SELECT failed_attempts FROM app_user WHERE id = ${PEOPLE.other};`), '0',
    'signing in should clear the count, or the next four mistakes lock a person out again');
  step('Doors: the lock lifts on its own, and a good sign-in clears the count behind it');

  // Ten thousand PINs at five tries per fifteen minutes is the arithmetic that makes a four-digit
  // secret defensible at all. Stated here so that changing either number is a visible decision.
  const days = (10000 / 5) * 15 / 60 / 24;
  assert.ok(days > 20, `five tries per fifteen minutes should put a full sweep of a 4-digit PIN weeks away, got ${days.toFixed(1)} days`);
  step(`Doors: a full sweep of every four-digit PIN would take ${days.toFixed(0)} days at that rate`);
}

function sessionsEnd() {
  const shop = opened('a shop-floor session', 'marko@varmak.se', '8472', 'pin');
  const office = opened('an office session', 'anna@varmak.se', 'correct horse battery staple', 'password');
  const shopEnds = value(`SELECT expires_at FROM app_session WHERE token = '${shop}';`);
  const officeEnds = value(`SELECT expires_at FROM app_session WHERE token = '${office}';`);
  assert.ok(new Date(shopEnds) < new Date(Date.now() + 25 * 3600 * 1000),
    `a tablet session must end with the shift, not in thirty days — it ends ${shopEnds}`);
  assert.match(value(`SELECT to_char(expires_at, 'HH24:MI') FROM app_session WHERE token = '${shop}';`), /^18:00$/);
  assert.notEqual(shopEnds, officeEnds);
  step('Sessions: the shop tablet expires at the end of the shift, not in thirty days');

  assert.equal(value(`SELECT session_owner('${office}');`), PEOPLE.admin);
  sql(`SELECT sign_out('${office}');`);
  assert.equal(value(`SELECT coalesce(session_owner('${office}')::text, 'nobody');`), 'nobody',
    'a signed-out token must stop naming anybody');
  step('Sessions: signing out ends the session, and the token stops meaning anything');

  // Aged rather than given an impossible expiry: expires_at > started_at is a constraint, and the
  // first version of this line tried to violate it to make the point. A session that began two
  // hours ago and ran out an hour ago is the real shape of the thing being tested.
  sql(`UPDATE app_session SET started_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
        WHERE token = '${shop}';`);
  assert.equal(value(`SELECT coalesce(session_owner('${shop}')::text, 'nobody');`), 'nobody');
  assert.equal(value(`SELECT coalesce(session_owner('not a real token')::text, 'nobody');`), 'nobody');
  step('Sessions: an expired token and an invented one both name nobody');
}

// ── What each role may do ─────────────────────────────────────────────────────────────────

function theFloorDoesTheWork(f) {
  allowed('a welder starting the operation', 'varmak_workshop', PEOPLE.welder,
    `UPDATE jobcard SET status = 'released' WHERE id = ${f.jobcard};`);
  allowed('a welder booking their own hours', 'varmak_workshop', PEOPLE.welder,
    `INSERT INTO hours_entry (jobcard_id, operation_id, worker, hours)
     VALUES (${f.jobcard}, ${f.op}, 'Marko Ilic', 6.5);`);
  allowed('a welder recording an inspection', 'varmak_workshop', PEOPLE.welder,
    `INSERT INTO inspection (jobcard_id, kind, inspector, result, actual_date, status)
     VALUES (${f.jobcard}, 'visual', 'Marko Ilic', 'passed', current_date, 'done');`);
  allowed('a welder recording a pre-use check on a machine', 'varmak_workshop', PEOPLE.welder,
    `INSERT INTO equipment_event (equipment_id, kind, performed_by, result)
     SELECT id, 'pre-use-check', 'Marko Ilic', 'pass' FROM equipment LIMIT 1;`);
  step('The floor: a welder can move the work along, book hours, inspect, and check a machine over');

  // Booking hours in somebody else's name is how a timesheet stops being evidence of anything.
  denied('a welder booking hours in another name', 'varmak_workshop', PEOPLE.welder,
    `INSERT INTO hours_entry (jobcard_id, operation_id, worker, hours)
     VALUES (${f.jobcard}, ${f.op}, 'Petra Nilsson', 8);`, /row-level security/);
  // A row-level policy on UPDATE does not refuse — it hides the row, so the statement succeeds
  // having changed nothing. That is secure, but it means "no error" proves nothing whatsoever here;
  // the only evidence is that the number did not move. Written this way because the first version
  // of this check expected an error, and would have passed just as happily if the policy had let
  // the update through and reported success.
  const touched = allowed("a welder trying to edit another welder's hours", 'varmak_workshop', PEOPLE.other,
    `UPDATE hours_entry SET hours = 12 WHERE worker = 'Marko Ilic' RETURNING id;`);
  assert.equal(touched, '', 'the update should have matched no rows at all');
  assert.equal(value(`SELECT hours::text FROM hours_entry WHERE worker = 'Marko Ilic';`), '6.50',
    "another welder's hours changed, which is the whole thing this is meant to stop");
  step('The floor: hours go in under your own name, and another welder editing them changes nothing');
}

function theFloorDoesNotRunTheBusiness(f) {
  denied('a welder taking a customer on', 'varmak_workshop', PEOPLE.welder,
    `INSERT INTO customer (name) VALUES ('A new customer');`, /permission denied/);
  denied('a welder writing a quote', 'varmak_workshop', PEOPLE.welder,
    `INSERT INTO estimate (title, customer_id) VALUES ('Cheap', ${f.customer});`, /permission denied/);
  denied('a welder changing a price', 'varmak_workshop', PEOPLE.welder,
    `UPDATE stock_item SET avg_cost = 1 WHERE id = ${f.item};`, /permission denied/);
  denied('a welder deleting a jobcard', 'varmak_workshop', PEOPLE.welder,
    `DELETE FROM jobcard WHERE id = ${f.jobcard};`, /permission denied/);
  step('The floor: and cannot take on a customer, write a quote, change a price or delete the work');

  const hold = value(`INSERT INTO quality_hold (scope, jobcard_id, reason, applied_by)
    VALUES ('jobcard', ${f.jobcard}, 'Weld rejected', 'Lars Holm') RETURNING ref;`);
  denied('a welder releasing the hold on their own job', 'varmak_workshop', PEOPLE.welder,
    `UPDATE quality_hold SET status = 'released', release_authority = 'Marko Ilic',
     release_reason = 'Looks fine to me', released_at = now() WHERE ref = '${hold}';`,
    /permission denied|row-level security/);
  assert.equal(value(`SELECT status FROM quality_hold WHERE ref = '${hold}';`), 'active');
  allowed('the office releasing it', 'varmak_office', PEOPLE.office,
    `UPDATE quality_hold SET status = 'released', release_authority = 'Lars Holm',
     release_reason = 'Re-run and PT accepted', released_at = now() WHERE ref = '${hold}';`);
  step('The floor: the person who did the weld cannot clear the hold on it — that is the office');
}

function materialLeavesThroughOneDoor(f) {
  denied('a welder changing the stock figure by hand', 'varmak_workshop', PEOPLE.welder,
    `UPDATE stock_item SET stock = 9999 WHERE id = ${f.item};`, /permission denied/);
  const before = value(`SELECT stock::text FROM stock_item WHERE id = ${f.item};`);
  allowed('a welder issuing material to the job', 'varmak_workshop', PEOPLE.welder,
    `SELECT issue_material(${f.item}, 120, ${f.jobcard}, 'Cut for the frame');`);
  assert.equal(value(`SELECT stock::text FROM stock_item WHERE id = ${f.item};`),
    (Number(before) - 120).toFixed(3));
  step('Material: the workshop issues steel, and the only way it can is the door that writes a movement');

  // The movement says who actually did it, not whichever name the caller felt like passing.
  assert.equal(value(`SELECT moved_by FROM stock_movement ORDER BY id DESC LIMIT 1;`), 'Marko Ilic');
  denied('issuing material with no session at all', 'varmak_workshop', null,
    `SELECT issue_material(${f.item}, 10, ${f.jobcard});`, /sign in before/);
  step("Material: the movement records who really issued it, not the name the caller passed");

  // issue_stock is the function underneath, and it does take a name. The workshop being unable to
  // call it proves little on its own — a welder has no UPDATE on stock_item either, so the refusal
  // arrives from the table before the function privilege is ever reached. The office is the case
  // that isolates it: it DOES hold UPDATE on stock_item through the broad grant, so the only thing
  // stopping it signing a movement in somebody else's name is that EXECUTE was revoked. Found by
  // the mutation check, which removed the REVOKE and watched nothing fail.
  denied('the workshop calling the raw function', 'varmak_workshop', PEOPLE.welder,
    `SELECT issue_stock(${f.item}, 10, ${f.jobcard}, 'Somebody Else');`, /permission denied/);
  denied('the office calling the raw function to sign a movement in another name', 'varmak_office', PEOPLE.office,
    `SELECT issue_stock(${f.item}, 10, ${f.jobcard}, 'Somebody Else');`, /permission denied for function/);
  assert.equal(value(`SELECT count(*) FROM stock_movement WHERE moved_by = 'Somebody Else';`), '0');
  allowed('the office issuing material properly', 'varmak_office', PEOPLE.office,
    `SELECT issue_material(${f.item}, 5, ${f.jobcard});`);
  assert.equal(value(`SELECT moved_by FROM stock_movement ORDER BY id DESC LIMIT 1;`), 'Lars Holm',
    'the office issue should be recorded against the person who made it');
  step('Material: nobody can call the function underneath to sign a movement in a name that is not theirs');
}

// ── Saying you are somebody you are not ───────────────────────────────────────────────────

function theSessionCannotLieAboutWho() {
  // The role is read from the row, never from what the session claims.
  const lie = as('varmak_workshop', PEOPLE.welder,
    `SELECT set_config('app.user_role', 'admin', false); SELECT current_app_role();`);
  assert.equal(lie.ok, false, 'a session claiming a role it does not hold should be refused outright');
  assert.match(lie.message, /claims the role admin but marko@varmak\.se is workshop/);
  step('Identity: a session that claims a role its row does not have is refused, and named in the refusal');

  // Even with the grant of a stronger database role, the row decides. This is the case that
  // matters: an API bug that picks the wrong role must not hand out the wrong authority.
  denied('a welder driving the office database role', 'varmak_office', PEOPLE.welder,
    `INSERT INTO customer (name) VALUES ('Smuggled in');`, /row-level security/);
  assert.equal(value(`SELECT count(*) FROM customer WHERE name = 'Smuggled in';`), '0');
  step('Identity: holding the office database role is not enough — the policies read the person, not the connection');

  // The connector role, which is what the pool logs in as before it picks a role for the request.
  // A bug that forgets to pick one must end with a connection that can read nothing — this is the
  // direction a mistake here has to fail.
  denied('the connection pool reading the work without choosing a role', 'varmak_api', PEOPLE.admin,
    `SELECT count(*) FROM jobcard;`, /permission denied/);

  // And a role with the grants but no session: every policy asks who you are, gets nothing, and
  // says no. Checked by counting rows rather than by expecting an error, because a SELECT policy
  // filters rather than refuses — so the evidence is the zero.
  const nothing = allowed('a session that has not said who it is', 'varmak_workshop', null,
    `SELECT count(*) FROM jobcard;`);
  assert.equal(nothing, '0', 'a session that has not said who it is must see nothing at all');
  const alsoNothing = allowed('the same session reading the store', 'varmak_workshop', null,
    `SELECT count(*) FROM stock_movement;`);
  assert.equal(alsoNothing, '0');
  // Not merely that it sees nothing — that the rows are really there for somebody who did say.
  assert.equal(allowed('a welder who did say who they are', 'varmak_workshop', PEOPLE.welder,
    `SELECT count(*) FROM jobcard;`), '1', 'the zero above has to be the policy, not an empty table');
  step('Identity: a session that has not said who it is sees nothing, and the rows are there for one that has');

  denied('a deactivated person carrying on', 'varmak_workshop', PEOPLE.welder,
    `UPDATE app_user SET is_active = false WHERE id = ${PEOPLE.welder};`, /permission denied/);
  sql(`UPDATE app_user SET is_active = false WHERE id = ${PEOPLE.welder};`);
  const afterOff = as('varmak_workshop', PEOPLE.welder, `SELECT count(*) FROM jobcard;`);
  assert.equal(afterOff.out, '0', 'switching somebody off must take effect on the session they already have');
  shut('a deactivated person signing in again', 'marko@varmak.se', '8472', 'pin', /not a login we recognise/);
  sql(`UPDATE app_user SET is_active = true WHERE id = ${PEOPLE.welder};`);
  step('Identity: switching somebody off stops the session they are already holding, not just the next one');
}

function peopleAreMadeByAnAdmin() {
  denied('a welder making themselves an account', 'varmak_workshop', PEOPLE.welder,
    `INSERT INTO app_user (email, display_name, role) VALUES ('new@varmak.se', 'New', 'admin');`,
    /permission denied/);
  denied('the office promoting themselves', 'varmak_office', PEOPLE.office,
    `UPDATE app_user SET role = 'admin' WHERE id = ${PEOPLE.office};`, /permission denied/);
  assert.equal(value(`SELECT role::text FROM app_user WHERE id = ${PEOPLE.office};`), 'office');
  denied('a welder setting their own PIN', 'varmak_workshop', PEOPLE.welder,
    `SELECT set_pin(${PEOPLE.welder}, '9182');`, /permission denied/);
  // A read policy filters rather than refuses, so the evidence is the empty answer beside the
  // non-empty one — the same row, asked for by two different people.
  const others = allowed("a welder reading somebody else's row", 'varmak_workshop', PEOPLE.welder,
    `SELECT email FROM app_user WHERE id = ${PEOPLE.admin};`);
  assert.equal(others, '', "a welder can read the admin's row");
  const own = allowed('a welder reading their own row', 'varmak_workshop', PEOPLE.welder,
    `SELECT email FROM app_user WHERE id = ${PEOPLE.welder};`);
  assert.equal(own, 'marko@varmak.se', 'and cannot read their own, which would be a broken screen rather than a rule');
  const everyone = allowed('the office reading the staff list', 'varmak_office', PEOPLE.office,
    `SELECT count(*) FROM app_user;`);
  assert.equal(everyone, '4', 'the office keeps the staff list, so the empty answer above is the policy and not an empty table');
  step('People: no self-registration, no self-promotion, no setting your own PIN — and you see your own row only');

  // Asked of every role, and of the privilege tables as well as by query, because a broad
  // GRANT ... ON ALL TABLES had already handed both hash columns to admin and office without
  // anything in auth.sql appearing to say so.
  for (const role of ['varmak_admin', 'varmak_office', 'varmak_workshop']) {
    for (const column of ['password_hash', 'pin_hash']) {
      const holds = value(`SELECT CASE WHEN has_column_privilege('${role}', 'app_user', '${column}', 'SELECT')
                                       THEN 'yes' ELSE 'no' END;`);
      assert.equal(holds, 'no', `${role} can read app_user.${column}`);
    }
  }
  denied('an admin reading a password hash', 'varmak_admin', PEOPLE.admin,
    `SELECT password_hash FROM app_user WHERE id = ${PEOPLE.admin};`, /permission denied/);
  denied('the office reading a PIN hash', 'varmak_office', PEOPLE.office,
    `SELECT pin_hash FROM app_user;`, /permission denied/);
  denied('a welder reading the hashes with a wildcard', 'varmak_workshop', PEOPLE.welder,
    `SELECT * FROM app_user WHERE id = ${PEOPLE.welder};`, /permission denied/);
  step('People: no role can read either hash — signing in compares inside the database, so nothing needs to');
}

function whoIsLoggedInIsNotEverybodysBusiness() {
  sql(`SELECT sign_in('anna@varmak.se', 'correct horse battery staple', 'password', 'office laptop');
       SELECT sign_in('marko@varmak.se', '8472', 'pin', 'hall tablet');`);
  const total = value(`SELECT count(*) FROM app_session;`);
  assert.ok(Number(total) >= 2, 'there should be sessions from both doors to look at');

  const mine = allowed('a welder listing sessions', 'varmak_workshop', PEOPLE.welder,
    `SELECT count(*) FROM app_session;`);
  const onlyOwn = value(`SELECT count(*) FROM app_session WHERE user_id = ${PEOPLE.welder};`);
  assert.equal(mine, onlyOwn,
    `a welder can see ${mine} sessions but only ${onlyOwn} are theirs — that is a list of who is logged in and on which device`);
  assert.notEqual(mine, total, 'the whole session table is visible to a welder');

  const everything = allowed('an admin listing sessions', 'varmak_admin', PEOPLE.admin,
    `SELECT count(*) FROM app_session;`);
  assert.equal(everything, total, 'an admin has to be able to see a session in order to end it');
  step('Sessions: a welder sees their own sessions; who else is logged in and on what device is an admin matter');
}

// The goods-in book is not rubbed out. Found by the privilege check above: admin and office held
// UPDATE and DELETE on stock_movement with no policy behind either, so the privilege did nothing
// while looking as though it did something. Asked properly, it should not exist.
// A safety gate reads a table the person pressing start may only read part of. Written because that
// broke: equipment gained a purchase_price in step 5, equipment moved to a column grant to keep the
// price off the floor, and the trigger's `SELECT *` was then refused for every welder — so instead of
// a gate they got "permission denied for table equipment". The property that protects the price
// breaks any query asking for more than it needs.
function aGateCanStillReadWhatItNeeds() {
  const machine = value(`INSERT INTO equipment (ref, name, category, status, purchase_price)
    VALUES ('EQ-GATE', 'Gate Test MIG', 'welding', 'out-of-service', 412000) RETURNING id;`);
  const project = value(`SELECT id FROM project LIMIT 1;`);
  const jobcard = value(`INSERT INTO jobcard (project_id, title) VALUES (${project}, 'Gate test') RETURNING id;`);
  const op = value(`INSERT INTO operation (jobcard_id, seq, description, equipment_id)
    VALUES (${jobcard}, 1, 'Weld', ${machine}) RETURNING id;`);

  const message = denied('a welder starting work on an out-of-service machine', 'varmak_workshop', PEOPLE.welder,
    `UPDATE operation SET status = 'in-progress' WHERE id = ${op};`, /cannot start/);
  assert.ok(message.includes('Gate Test MIG') && message.includes('out-of-service'),
    `the welder must be told what is wrong with the machine, not that they lack a privilege: ${message}`);
  assert.ok(!/permission denied/.test(message),
    `the gate could not read the machine at all: ${message}`);
  step('Gates: a welder gets the gate\'s own refusal, not a privilege error, on a table they may only read part of');

  sql(`UPDATE equipment SET status = 'available' WHERE id = ${machine};`);
  allowed('the same welder once the machine is fit to run', 'varmak_workshop', PEOPLE.welder,
    `UPDATE operation SET status = 'in-progress' WHERE id = ${op};`);
  // And the price was never readable throughout.
  denied('the welder reading what that machine cost', 'varmak_workshop', PEOPLE.welder,
    `SELECT purchase_price FROM equipment WHERE id = ${machine};`, /permission denied/);
  step('Gates: the work starts, and the price of the machine was never readable to do it');
}

function theGoodsInBookIsNotRubbedOut() {
  const item = value(`SELECT id FROM stock_item LIMIT 1;`);
  sql(`INSERT INTO stock_movement (stock_item_id, kind, quantity, moved_by, note)
       VALUES (${item}, 'receipt', 100, 'Lars Holm', 'Two bundles');`);
  const ref = value(`SELECT ref FROM stock_movement ORDER BY id DESC LIMIT 1;`);

  denied('an admin editing a movement', 'varmak_admin', PEOPLE.admin,
    `UPDATE stock_movement SET quantity = 1 WHERE ref = '${ref}';`, /permission denied/);
  denied('the office deleting a movement', 'varmak_office', PEOPLE.office,
    `DELETE FROM stock_movement WHERE ref = '${ref}';`, /permission denied/);
  denied('a welder editing one', 'varmak_workshop', PEOPLE.welder,
    `UPDATE stock_movement SET quantity = 1 WHERE ref = '${ref}';`, /permission denied/);
  assert.equal(value(`SELECT quantity::text FROM stock_movement WHERE ref = '${ref}';`), '100.000');

  // The correction is a second movement, which is what a store actually does.
  allowed('correcting it with an adjustment instead', 'varmak_office', PEOPLE.office,
    `INSERT INTO stock_movement (stock_item_id, kind, quantity, moved_by, note)
     VALUES (${item}, 'adjustment', 10, 'Lars Holm', 'Miscount on ${ref} — ten short');`);
  step('Store: a stock movement cannot be edited or deleted by anyone — a miscount is corrected by an adjustment');
}

function historyRecordsWhoSignedIn() {
  const rows = sql(`SELECT actor || ' ' || detail FROM activity_log
    WHERE entity = 'app_user' AND action = 'signed in' ORDER BY id;`);
  assert.ok(rows.includes('anna@varmak.se password'), `the office sign-ins should be on the record: ${rows}`);
  assert.ok(rows.includes('marko@varmak.se pin'));
  denied('an admin tidying the sign-in record afterwards', 'varmak_admin', PEOPLE.admin,
    `DELETE FROM activity_log WHERE action = 'signed in';`, /permission denied|append-only/);
  step('History: every sign-in is on the record, by which door, and nobody can tidy it away later');
}

// ── The run ───────────────────────────────────────────────────────────────────────────────

function buildDatabase() {
  try {
    execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', 'postgres', '-qtAX',
      '-c', `DROP DATABASE IF EXISTS ${DB};`, '-c', `CREATE DATABASE ${DB};`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    console.error(`Cannot reach PostgreSQL at ${HOST}:${PORT} as ${USER}.`);
    console.error(String(error.stderr || error.message).trim());
    process.exit(1);
  }
  for (const file of [SCHEMA, AUTH]) {
    execFileSync('psql', [...conn(DB), '-f', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
}

function main() {
  buildDatabase();
  console.log(`Schema and auth built fresh into ${DB}.\n`);

  theTestsAreNotCheating();
  everyWritePrivilegeHasAPolicyBehindIt();
  const f = makeWorkshop();
  noPriceColumnIsReachable();
  aWelderCannotReadAPrice(f);
  secretsAreNeverStored();
  obviousSecretsAreRefused();
  theDoorsOpenAndSayNothingExtra();
  guessingIsNotWorthIt();
  sessionsEnd();
  theFloorDoesTheWork(f);
  theFloorDoesNotRunTheBusiness(f);
  materialLeavesThroughOneDoor(f);
  theSessionCannotLieAboutWho();
  peopleAreMadeByAnAdmin();
  whoIsLoggedInIsNotEverybodysBusiness();
  aGateCanStillReadWhatItNeeds();
  theGoodsInBookIsNotRubbedOut();
  historyRecordsWhoSignedIn();

  console.log(`\n${checks} checks: ${attempts.refused} things refused, ${attempts.allowed} allowed, `
    + 'every one of them asked as a real database role.');
}

try {
  main();
} catch (error) {
  console.error(`\n${error.message || error}`);
  process.exitCode = 1;
}
