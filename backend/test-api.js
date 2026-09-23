'use strict';

// The workflows from BACKEND.md §4. Each is several writes that must all succeed or all fail, so
// the thing worth testing is not that they work — it is what they leave behind when they don't.
// A receipt that puts stock on the shelf and then fails to record the movement has left the store
// unable to explain itself, and no amount of the happy path passing will tell you that.
//
// So every workflow here is made to fail halfway on purpose, and the check is that nothing moved.
//
// The other half is replay. §3 lets the shop tablet queue three actions with no signal, and the
// tablet cannot know whether its first attempt arrived before the connection died — so it flushes
// the queue blindly and the server has to make asking twice harmless. Every one of those is asked
// twice here, and one of them is asked twice at the same moment from two sessions.

const assert = require('node:assert/strict');
const { ensureUp } = require('./pg');
const { execFileSync, execFile } = require('node:child_process');
const path = require('node:path');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = process.env.VARMAK_TEST_DB || 'varmak_api_test';
const FILES = ['schema', 'auth', 'api'].map((name) => ({
  name,
  path: process.env[`VARMAK_${name.toUpperCase()}`] || path.join(__dirname, `${name}.sql`)
}));

function conn(db) {
  return ['-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1', '-qtAX'];
}

function as(role, userId, text) {
  const preamble = `SET app.user_id = '${userId === null ? '' : userId}';\n${role ? `SET ROLE ${role};` : ''}`;
  try {
    const out = execFileSync('psql', conn(DB), {
      input: `${preamble}\n${text}`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    });
    return { ok: true, out: out.trim().split('\n').filter((l) => l && l !== 'SET').join('\n').trim() };
  } catch (error) {
    const stderr = String(error.stderr || '');
    const line = (stderr.split('\n').find((l) => /ERROR/.test(l)) || stderr).trim();
    return { ok: false, message: line.replace(/^.*ERROR:\s*/, '') };
  }
}

function sql(text) { return execFileSync('psql', conn(DB), { input: text, encoding: 'utf8' }).trim(); }
function value(text) { return sql(text).split('\n')[0].trim(); }

function run(text) {
  return new Promise((resolve) => {
    execFile('psql', conn(DB), { encoding: 'utf8' }, (error, stdout, stderr) =>
      resolve({ ok: !error, out: (stdout || '').trim(), err: (stderr || '').trim() })).stdin.end(text);
  });
}

const attempts = { refused: 0, allowed: 0 };
let checks = 0;
function step(message) { checks += 1; console.log(`OK   ${message}`); }

function refused(what, role, userId, text, expected) {
  const result = as(role, userId, text);
  attempts.refused += 1;
  assert.equal(result.ok, false, `${what}: went through, returning "${result.out}"`);
  assert.match(result.message, expected, `${what}: refused, but not for the reason expected`);
  return result.message;
}

function ok(what, role, userId, text) {
  const result = as(role, userId, text);
  attempts.allowed += 1;
  assert.equal(result.ok, true, `${what}: refused — ${result.message}`);
  return result.out;
}

// Everything that could have moved, as one string. Taken before a workflow is made to fail and
// compared afterwards: naming the tables a workflow touches is how a test misses the table it
// forgot about, so this counts all of them.
function snapshot() {
  return sql(`SELECT string_agg(line, ' | ' ORDER BY line) FROM (
    SELECT 'stock=' || coalesce(sum(stock)::text, '0') AS line FROM stock_item
    UNION ALL SELECT 'movements=' || count(*)::text FROM stock_movement
    UNION ALL SELECT 'projects=' || count(*)::text FROM project
    UNION ALL SELECT 'customers=' || count(*)::text FROM customer
    UNION ALL SELECT 'hours=' || count(*)::text FROM hours_entry
    UNION ALL SELECT 'estimates_sent=' || count(*)::text FROM estimate WHERE status <> 'draft'
    UNION ALL SELECT 'locked_lines=' || count(*)::text FROM estimate_line WHERE locked
    UNION ALL SELECT 'received=' || coalesce(sum(received_quantity)::text, '0') FROM purchase_order_line
    UNION ALL SELECT 'po_status=' || string_agg(status::text, ',' ORDER BY id) FROM purchase_order
    UNION ALL SELECT 'leads_converted=' || count(*)::text FROM lead WHERE status = 'converted'
    UNION ALL SELECT 'log=' || count(*)::text FROM activity_log
    UNION ALL SELECT 'planned=' || coalesce(sum(planned_hours)::text, '0') FROM project
  ) t;`);
}

const PEOPLE = {};

function world() {
  sql(`SET client_min_messages = warning;
       TRUNCATE device_event, app_session, activity_log, hours_entry, stock_movement, operation,
                jobcard, project, customer, stock_item, quality_hold, estimate, estimate_line,
                supplier, supplier_item, purchase_order, purchase_order_line, lead, opportunity,
                tender, equipment, equipment_assignment, equipment_event, inspection, ncr,
                app_user RESTART IDENTITY CASCADE;`);
  PEOPLE.office = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('lars@varmak.se', 'Lars Holm', 'office') RETURNING id;`);
  PEOPLE.welder = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('marko@varmak.se', 'Marko Ilic', 'workshop') RETURNING id;`);
  PEOPLE.other = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('petra@varmak.se', 'Petra Nilsson', 'workshop') RETURNING id;`);

  const customer = value(`INSERT INTO customer (name, city) VALUES ('Skåne Verkstad AB', 'Lund') RETURNING id;`);
  const item = value(`INSERT INTO stock_item (code, description, unit, stock, avg_cost)
    VALUES ('S355-10', 'Plate S355J2 10mm', 'KG', 200, 14.50) RETURNING id;`);
  const supplier = value(`INSERT INTO supplier (name) VALUES ('Stål & Metall AB') RETURNING id;`);
  const machine = value(`INSERT INTO equipment (ref, name, category) VALUES ('EQ-001', 'MIG 400', 'welding') RETURNING id;`);
  return { customer, item, supplier, machine };
}

function anEstimate(f, { hours = 40, material = 500, project = null } = {}) {
  const est = value(`INSERT INTO estimate (title, customer_id${project ? ', project_id' : ''})
    VALUES ('Conveyor frame', ${f.customer}${project ? `, ${project}` : ''}) RETURNING id;`);
  sql(`INSERT INTO estimate_line (estimate_id, kind, description, quantity, unit, unit_price)
       VALUES (${est}, 'material', 'Plate S355J2 10mm', ${material}, 'KG', 22.00),
              (${est}, 'labour', 'Welding', ${hours}, 'H', 650);`);
  return est;
}

// The same check test-auth.js makes, repeated here over all three files. That suite builds only
// schema.sql and auth.sql, so a function added in api.sql could step around row security with
// nothing watching — which is a gap in a check, and the quietest kind there is.
function theBypassListIsStillShort() {
  const bypass = sql(`SELECT p.proname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE r.rolbypassrls AND NOT r.rolsuper AND p.pronamespace = 'public'::regnamespace ORDER BY 1;`)
    .split('\n').map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(bypass.sort(), [
    // Creating the first admin and changing your own password both have to read or write app_user
    // for somebody the policies cannot yet see — the first because there is nobody at all, the
    // second because it compares a password hash, which no role may read.
    'bootstrap_first_admin', 'change_my_password',
    'current_app_name', 'current_app_role', 'issue_material', 'issue_stock',
    'project_hours_roll_up', 'register_failure', 'session_identity',
    'session_owner', 'set_password', 'set_pin', 'sign_in', 'sign_out'
  ], `functions that step around row security, across all three files: ${bypass.join(', ')}`);
  step(`Harness: ${bypass.length} functions may step around row security across all three files, and they are the expected ones`);
}

// ── Sending a quotation ───────────────────────────────────────────────────────────────────

function sendingLocksThePrice(f) {
  const est = anEstimate(f);
  assert.equal(value(`SELECT count(*) FROM estimate_line WHERE estimate_id = ${est} AND locked;`), '0');

  refused('sending an estimate with nothing on it', 'varmak_office', PEOPLE.office,
    `SELECT send_estimate((SELECT id FROM estimate WHERE title = 'Empty'));`, /no such estimate/);
  const empty = value(`INSERT INTO estimate (title, customer_id) VALUES ('Empty', ${f.customer}) RETURNING id;`);
  refused('sending an estimate with no lines', 'varmak_office', PEOPLE.office,
    `SELECT send_estimate(${empty});`, /no lines — there is no price to send/);
  assert.equal(value(`SELECT status FROM estimate WHERE id = ${empty};`), 'draft',
    'a refused send must leave the estimate a draft');
  step('Quoting: an estimate with no lines cannot be sent, and stays a draft');

  const ref = ok('sending it', 'varmak_office', PEOPLE.office, `SELECT send_estimate(${est});`);
  assert.match(ref, /^EST-\d{4}-\d{4}$/);
  assert.equal(value(`SELECT status FROM estimate WHERE id = ${est};`), 'sent');
  assert.equal(value(`SELECT count(*) FROM estimate_line WHERE estimate_id = ${est} AND locked;`), '2',
    'sending is what locks the lines — nothing else in the system set that column');
  assert.ok(value(`SELECT valid_until FROM estimate WHERE id = ${est};`), 'a sent quote needs a date it runs out');
  step('Quoting: sending locks every line and puts a date on the quote');

  // The rule locking was for, now reachable: the trigger from schema.sql, through the workflow.
  refused('repricing a line after the quote went out', 'varmak_office', PEOPLE.office,
    `UPDATE estimate_line SET unit_price = 30 WHERE estimate_id = ${est} AND kind = 'labour';`,
    /needs a reason and a name/);
  step('Quoting: and the locked line now refuses a reprice with no reason — the rule nothing could reach before');

  refused('sending the same estimate twice', 'varmak_office', PEOPLE.office,
    `SELECT send_estimate(${est});`, /has already been sent/);
  refused('a welder sending a quotation', 'varmak_workshop', PEOPLE.welder,
    `SELECT send_estimate(${est});`, /permission denied/);
  step('Quoting: it cannot be sent twice, and the floor cannot send one at all');
  return est;
}

// ── Accepting it ──────────────────────────────────────────────────────────────────────────

function acceptingMakesTheProject(f) {
  const est = anEstimate(f, { hours: 40 });
  refused('accepting a draft nobody has seen', 'varmak_office', PEOPLE.office,
    `SELECT accept_estimate(${est});`, /cannot be accepted from draft/);
  step('Accepting: a draft cannot be accepted — nobody outside the building has seen it');

  sql(`SELECT send_estimate(${est});`);
  const before = snapshot();
  sql(`UPDATE estimate SET valid_until = current_date - 1 WHERE id = ${est};`);
  refused('accepting a quote that has run out', 'varmak_office', PEOPLE.office,
    `SELECT accept_estimate(${est});`, /expired on .* requote it/);
  assert.equal(snapshot(), before, 'a refused acceptance must have created nothing');
  step('Accepting: an expired quote is requoted rather than accepted, and the refusal creates no project');

  sql(`UPDATE estimate SET valid_until = current_date + 30 WHERE id = ${est};`);
  const projectRef = ok('accepting it', 'varmak_office', PEOPLE.office, `SELECT accept_estimate(${est});`);
  assert.match(projectRef, /^P-\d{4}-\d{3}$/);
  assert.equal(value(`SELECT status FROM estimate WHERE id = ${est};`), 'accepted');

  const proj = sql(`SELECT p.status || '|' || p.planned_hours || '|' || p.customer_id
    FROM project p JOIN estimate e ON e.project_id = p.id WHERE e.id = ${est};`);
  assert.equal(proj, `approved|40.00|${f.customer}`,
    'the project should arrive approved, carrying the quoted labour hours and the same customer');
  step('Accepting: the project comes into being approved, for the same customer, with the quoted hours as its plan');

  // The hours are the point. A project whose plan was never filled in from the estimate is a
  // project every capacity figure downstream is wrong about.
  // Compared as numbers: planned_hours is numeric(10,2) and a line quantity is numeric(12,3), so
  // 40.00 and 40.000 are the same amount of work and only differ as text.
  assert.equal(value(`SELECT (p.planned_hours = (SELECT sum(quantity) FROM estimate_line
      WHERE estimate_id = ${est} AND kind = 'labour'))::text
    FROM project p WHERE p.ref = '${projectRef}';`), 'true',
    'the planned hours must equal the quoted labour, read back from the lines');
  assert.equal(value(`SELECT count(*) FROM activity_log WHERE entity = 'estimate' AND action = 'accepted';`), '1');
  step('Accepting: the planned hours are the quoted labour, read back from the lines the long way round');

  refused('accepting it a second time', 'varmak_office', PEOPLE.office,
    `SELECT accept_estimate(${est});`, /cannot be accepted from accepted/);

  // A second estimate on a project already running must not drag it backwards.
  const running = value(`SELECT id FROM project WHERE ref = '${projectRef}';`);
  sql(`UPDATE project SET status = 'planned' WHERE id = ${running};
       UPDATE project SET status = 'production' WHERE id = ${running};`);
  const second = anEstimate(f, { hours: 12, project: running });
  sql(`SELECT send_estimate(${second});`);
  ok('accepting a second estimate on a running project', 'varmak_office', PEOPLE.office,
    `SELECT accept_estimate(${second});`);
  assert.equal(value(`SELECT status FROM project WHERE id = ${running};`), 'production',
    'a project in production must not be dragged back to approved by a second acceptance');
  assert.equal(value(`SELECT planned_hours::text FROM project WHERE id = ${running};`), '52.00',
    'the extra work should be added to the plan, not replace it');
  step('Accepting: a second estimate adds to the plan and never drags a running project backwards');
}

// ── Receiving steel ───────────────────────────────────────────────────────────────────────

function receivingExplainsItself(f) {
  const order = value(`INSERT INTO purchase_order (supplier_id, ordered_by)
    VALUES (${f.supplier}, 'Lars Holm') RETURNING id;`);
  const plate = value(`INSERT INTO purchase_order_line (purchase_order_id, stock_item_id, description, quantity, unit_price)
    VALUES (${order}, ${f.item}, 'Plate S355J2 10mm', 500, 13.90) RETURNING id;`);
  const carriage = value(`INSERT INTO purchase_order_line (purchase_order_id, description, quantity, unit_price)
    VALUES (${order}, 'Carriage', 1, 950) RETURNING id;`);

  const before = snapshot();
  const message = refused('receiving more than was ordered', 'varmak_office', PEOPLE.office,
    `SELECT receive_goods(${plate}, 600);`, /has only 500 of 500 outstanding/);
  assert.ok(message.includes('Plate S355J2 10mm'), `the refusal must name the line: ${message}`);
  assert.equal(snapshot(), before, 'nothing may move on a refused receipt');
  refused('receiving nothing', 'varmak_office', PEOPLE.office,
    `SELECT receive_goods(${plate}, 0);`, /more than nothing/);
  step('Receiving: more than was ordered is refused in words that say what is outstanding, and moves nothing');

  const stockBefore = value(`SELECT stock::text FROM stock_item WHERE id = ${f.item};`);
  const movementRef = ok('receiving part of it', 'varmak_office', PEOPLE.office,
    `SELECT receive_goods(${plate}, 200, 'Two bundles, heat H-99821');`);
  assert.match(movementRef, /^MV-\d{4}-\d{5}$/);
  assert.equal(value(`SELECT stock::text FROM stock_item WHERE id = ${f.item};`),
    (Number(stockBefore) + 200).toFixed(3));
  assert.equal(value(`SELECT received_quantity::text FROM purchase_order_line WHERE id = ${plate};`), '200.000');
  assert.equal(value(`SELECT status FROM purchase_order WHERE id = ${order};`), 'part-received',
    'the order status is derived from its lines, not typed in');
  const movement = sql(`SELECT kind || '|' || quantity || '|' || moved_by || '|' || note
    FROM stock_movement WHERE ref = '${movementRef}';`);
  assert.equal(movement, 'receipt|200.000|Lars Holm|Two bundles, heat H-99821');
  step('Receiving: stock goes up, a movement explains why, the line records it, and the order follows its lines');

  ok('receiving the rest of the plate', 'varmak_office', PEOPLE.office, `SELECT receive_goods(${plate}, 300);`);
  assert.equal(value(`SELECT status FROM purchase_order WHERE id = ${order};`), 'part-received',
    'the order is not complete while the carriage line is outstanding');
  ok('receiving the carriage line', 'varmak_office', PEOPLE.office, `SELECT receive_goods(${carriage}, 1);`);
  assert.equal(value(`SELECT status FROM purchase_order WHERE id = ${order};`), 'received');
  step('Receiving: the order reads received only once every line on it is in, carriage included');

  // A line for a service has nothing to put on a shelf, and must not invent a movement.
  assert.equal(value(`SELECT count(*) FROM stock_movement WHERE note LIKE '%Carriage%';`), '0');
  assert.equal(value(`SELECT count(*) FROM stock_movement;`), '2',
    'the carriage line should not have produced a stock movement');
  step('Receiving: a line for a service moves no steel and writes no movement');

  refused('receiving against a cancelled order', 'varmak_office', PEOPLE.office,
    `UPDATE purchase_order SET status = 'cancelled' WHERE id = ${order};
     SELECT receive_goods(${plate}, 1);`, /was cancelled/);
  refused('a welder receiving goods', 'varmak_workshop', PEOPLE.welder,
    `SELECT receive_goods(${plate}, 1);`, /permission denied/);
  step('Receiving: not against a cancelled order, and not by the floor');
}

// ── A lead becomes a customer ─────────────────────────────────────────────────────────────

function convertingKeepsTheTrail(f) {
  const theLead = value(`INSERT INTO lead (company, contact, email, phone, city, source)
    VALUES ('Malmö Mekaniska AB', 'Anna Berg', 'anna@malmomek.se', '040-123456', 'Malmö', 'trade fair')
    RETURNING id;`);
  const opp = value(`INSERT INTO opportunity (title, lead_id, value) VALUES ('Frame work', ${theLead}, 320000) RETURNING id;`);

  const customerRef = ok('converting the lead', 'varmak_office', PEOPLE.office,
    `SELECT convert_lead(${theLead}, '556677-8899', 'SE556677889901');`);
  assert.match(customerRef, /^C-\d{3}$/);

  const made = sql(`SELECT name || '|' || org_no || '|' || email || '|' || city || '|' || status
    FROM customer WHERE ref = '${customerRef}';`);
  assert.equal(made, 'Malmö Mekaniska AB|556677-8899|anna@malmomek.se|Malmö|active',
    'what was known about the lead has to arrive on the customer, or it was typed in twice');
  assert.equal(value(`SELECT status FROM lead WHERE id = ${theLead};`), 'converted');
  step('Converting: the customer arrives carrying what was known about the lead, and the lead is marked converted');

  // The chain back is the whole point — "where did this job come from", answerable in two years.
  assert.equal(value(`SELECT c.ref FROM lead l JOIN customer c ON c.id = l.customer_id WHERE l.id = ${theLead};`),
    customerRef);
  assert.equal(value(`SELECT customer_id FROM opportunity WHERE id = ${opp};`),
    value(`SELECT id FROM customer WHERE ref = '${customerRef}';`),
    'an opportunity already quoted to the lead must follow it to the customer');
  step('Converting: the opportunity follows them across, so the trail from a job back to the enquiry still joins up');

  refused('converting the same lead twice', 'varmak_office', PEOPLE.office,
    `SELECT convert_lead(${theLead});`, /already customer C-/);
  const lost = value(`INSERT INTO lead (company, status) VALUES ('Went quiet AB', 'lost') RETURNING id;`);
  refused('converting a lead marked lost', 'varmak_office', PEOPLE.office,
    `SELECT convert_lead(${lost});`, /was marked lost/);
  const customersBefore = value(`SELECT count(*) FROM customer;`);
  refused('a welder converting a lead', 'varmak_workshop', PEOPLE.welder,
    `SELECT convert_lead(${lost});`, /permission denied/);
  assert.equal(value(`SELECT count(*) FROM customer;`), customersBefore,
    'a refused conversion must not have created a customer');
  step('Converting: not twice, not one that was lost, and not by the floor');
}

// ── All or nothing ────────────────────────────────────────────────────────────────────────

// The reason these are functions and not four statements in the HTTP server. Each is made to fail
// on its last write, and the check is that the earlier ones went with it.
function halfDoneIsNeverLeftBehind(f) {
  // All the setup first, then the snapshot. An earlier version took it before setting up and then
  // compared at the end, and was off by one activity_log row — because the setup itself sends an
  // estimate, which writes to the log, and the log is append-only so it cannot be tidied away
  // afterwards. The test was wrong, not the workflow: "nothing moved" has to mean nothing moved
  // since the failures, not since the beginning of the world.
  const order = value(`INSERT INTO purchase_order (supplier_id, ordered_by)
    VALUES (${f.supplier}, 'Lars Holm') RETURNING id;`);
  const line = value(`INSERT INTO purchase_order_line (purchase_order_id, stock_item_id, description, quantity, unit_price)
    VALUES (${order}, ${f.item}, 'Plate', 100, 13.90) RETURNING id;`);
  const est = anEstimate(f, { hours: 8 });
  sql(`SELECT send_estimate(${est});`);
  const theLead = value(`INSERT INTO lead (company) VALUES ('Half Converted AB') RETURNING id;`);

  const before = snapshot();

  // A receipt whose movement cannot be written: the stock rise and the line update must go too.
  // NOT VALID, so the constraint is not checked against rows already there — only against the write
  // this workflow is about to attempt, which is precisely the failure being staged. The sabotage is
  // applied as the owner because an office session cannot ALTER a table, which is itself the point
  // of the roles; the workflow is then called as the office, exactly as it always is.
  sql(`ALTER TABLE stock_movement ADD CONSTRAINT never CHECK (false) NOT VALID;`);
  refused('a receipt whose movement will not write', 'varmak_office', PEOPLE.office,
    `SELECT receive_goods(${line}, 50);`, /never|check/i);
  sql(`ALTER TABLE stock_movement DROP CONSTRAINT IF EXISTS never;`);
  assert.equal(snapshot(), before,
    'the stock rise and the line update survived a receipt whose movement failed — the store can no longer explain itself');
  step('All or nothing: a receipt that cannot write its movement leaves the stock and the line untouched');

  // An acceptance whose project cannot be created must not mark the estimate accepted.
  sql(`ALTER TABLE project ADD CONSTRAINT never CHECK (false) NOT VALID;`);
  refused('an acceptance whose project will not insert', 'varmak_office', PEOPLE.office,
    `SELECT accept_estimate(${est});`, /never|check/i);
  sql(`ALTER TABLE project DROP CONSTRAINT IF EXISTS never;`);
  assert.equal(value(`SELECT status FROM estimate WHERE id = ${est};`), 'sent',
    'the estimate was marked accepted without a project to show for it');
  assert.equal(snapshot(), before, 'a failed acceptance moved something');
  step('All or nothing: an acceptance that cannot create its project leaves the estimate unaccepted');

  // A conversion whose lead cannot be updated must not leave an orphan customer behind.
  sql(`ALTER TABLE lead ADD CONSTRAINT never CHECK (status <> 'converted') NOT VALID;`);
  refused('a conversion whose lead will not update', 'varmak_office', PEOPLE.office,
    `SELECT convert_lead(${theLead});`, /never|check/i);
  sql(`ALTER TABLE lead DROP CONSTRAINT IF EXISTS never;`);
  assert.equal(value(`SELECT count(*) FROM customer WHERE name = 'Half Converted AB';`), '0',
    'a customer was created for a lead that was never marked converted');
  step('All or nothing: a conversion that cannot mark the lead leaves no orphan customer behind');

  assert.equal(snapshot(), before,
    'after three workflows failed halfway, something somewhere had moved');
  step('All or nothing: three workflows failed at their last write, and not one row anywhere had moved');
}

// ── The tablet with no signal ─────────────────────────────────────────────────────────────

function askingTwiceIsHarmless(f) {
  const project = value(`INSERT INTO project (name, customer_id, status) VALUES ('Offline job', ${f.customer}, 'production') RETURNING id;`);
  const jobcard = value(`INSERT INTO jobcard (project_id, title) VALUES (${project}, 'Weldment') RETURNING id;`);
  const op = value(`INSERT INTO operation (jobcard_id, seq, description) VALUES (${jobcard}, 1, 'Weld out') RETURNING id;`);

  const first = ok('booking six hours from the tablet', 'varmak_workshop', PEOPLE.welder,
    `SELECT book_hours(${jobcard}, ${op}, 6, current_date, 'Offline queue', 'tablet-1-0001');`);
  const again = ok('the tablet sending it a second time', 'varmak_workshop', PEOPLE.welder,
    `SELECT book_hours(${jobcard}, ${op}, 6, current_date, 'Offline queue', 'tablet-1-0001');`);
  assert.equal(again, first, 'a replay must give back the same answer as the first attempt');
  assert.equal(value(`SELECT count(*) FROM hours_entry WHERE jobcard_id = ${jobcard};`), '1',
    'the same six hours were booked twice');
  assert.equal(value(`SELECT logged_hours::text FROM operation WHERE id = ${op};`), '6.00');
  step('Offline: hours sent twice with one event id are booked once, and the replay gets the first answer back');

  // A different id is a different entry, or the tablet could never book two identical hours.
  ok('a second, genuinely different entry', 'varmak_workshop', PEOPLE.welder,
    `SELECT book_hours(${jobcard}, ${op}, 6, current_date, 'Offline queue', 'tablet-1-0002');`);
  assert.equal(value(`SELECT count(*) FROM hours_entry WHERE jobcard_id = ${jobcard};`), '2',
    'two identical entries with different ids are two entries — a welder can work two sessions of six hours');
  step('Offline: a different event id is a different entry, so two identical bookings are still two');

  // The worker is the session. A queued entry cannot arrive with somebody else's name on it,
  // because the call has nowhere to put one.
  assert.equal(value(`SELECT count(DISTINCT worker) FROM hours_entry WHERE jobcard_id = ${jobcard};`), '1');
  assert.equal(value(`SELECT DISTINCT worker FROM hours_entry WHERE jobcard_id = ${jobcard};`), 'Marko Ilic');
  step("Offline: a queued entry carries the name of whoever's session replayed it, because there is no parameter for it");

  const started = ok('starting the operation from the tablet', 'varmak_workshop', PEOPLE.welder,
    `SELECT record_operation(${op}, 'in-progress', 'tablet-1-0003');`);
  assert.equal(started, 'in-progress');
  ok('the same start replayed', 'varmak_workshop', PEOPLE.welder,
    `SELECT record_operation(${op}, 'in-progress', 'tablet-1-0003');`);
  assert.equal(value(`SELECT count(*) FROM activity_log WHERE entity = 'operation' AND action = 'in-progress';`), '1',
    'the replayed start wrote a second line to the record');
  step('Offline: a start sent twice is recorded once');

  const issued = ok('issuing steel from the tablet', 'varmak_workshop', PEOPLE.welder,
    `SELECT issue_material_offline(${f.item}, 40, ${jobcard}, 'Offline queue', 'tablet-1-0004');`);
  const stockAfter = value(`SELECT stock::text FROM stock_item WHERE id = ${f.item};`);
  const replayed = ok('the same issue replayed', 'varmak_workshop', PEOPLE.welder,
    `SELECT issue_material_offline(${f.item}, 40, ${jobcard}, 'Offline queue', 'tablet-1-0004');`);
  assert.equal(replayed, issued);
  assert.equal(value(`SELECT stock::text FROM stock_item WHERE id = ${f.item};`), stockAfter,
    'forty kilos left the shelf twice for one issue');
  assert.equal(value(`SELECT count(*) FROM stock_movement WHERE ref = '${issued}';`), '1');
  step('Offline: steel issued twice with one event id leaves the shelf once');

  return { jobcard, op };
}

// §3: "An operation queued offline is still checked when it replays — if the machine was out of
// service, the server refuses it and the person is told. Offline delays the check; it does not skip
// it." That sentence is this test.
function theGatesStillHoldOnReplay(f, w) {
  sql(`UPDATE operation SET equipment_id = ${f.machine}, status = 'pending' WHERE id = ${w.op};
       UPDATE equipment SET status = 'out-of-service' WHERE id = ${f.machine};`);
  const message = refused('a start queued offline against a machine that has since gone out of service',
    'varmak_workshop', PEOPLE.welder,
    `SELECT record_operation(${w.op}, 'in-progress', 'tablet-1-0010');`, /cannot start/);
  assert.ok(message.includes('out-of-service') && message.includes('MIG 400'),
    `the person has to be told what is wrong with the machine: ${message}`);
  assert.equal(value(`SELECT status FROM operation WHERE id = ${w.op};`), 'pending');
  step('Offline: a start queued against a machine that has gone out of service is refused when it replays');

  // And the refused attempt must not have consumed its event id — otherwise flushing the queue
  // again would report the failure as already done and the work would be silently lost.
  sql(`UPDATE equipment SET status = 'available' WHERE id = ${f.machine};`);
  const second = ok('the same queued start, once the machine is back in service', 'varmak_workshop', PEOPLE.welder,
    `SELECT record_operation(${w.op}, 'in-progress', 'tablet-1-0010');`);
  assert.equal(second, 'in-progress',
    'the refused attempt had already claimed its event id, so the retry was answered "already done" and the work was lost');
  assert.equal(value(`SELECT status FROM operation WHERE id = ${w.op};`), 'in-progress');
  step('Offline: a refusal does not burn the event id — the same queued action still works once the reason is cleared');

  const held = value(`INSERT INTO quality_hold (scope, jobcard_id, reason, applied_by)
    VALUES ('jobcard', ${w.jobcard}, 'Weld rejected on the previous batch', 'Lars Holm') RETURNING ref;`);
  sql(`UPDATE operation SET status = 'completed' WHERE id = ${w.op};
       UPDATE jobcard SET status = 'released' WHERE id = ${w.jobcard};
       UPDATE jobcard SET status = 'ready' WHERE id = ${w.jobcard};
       UPDATE jobcard SET status = 'in-progress' WHERE id = ${w.jobcard};
       UPDATE jobcard SET status = 'inspection' WHERE id = ${w.jobcard};`);
  refused('finishing a held jobcard through the API', 'varmak_office', PEOPLE.office,
    `UPDATE jobcard SET status = 'completed' WHERE id = ${w.jobcard};`,
    /cannot be completed while quality hold/);
  step(`Offline: the quality hold ${held} stops the work through the API exactly as it does in the database`);
}

async function twoTabletsFlushingAtOnce(f, w) {
  sql(`DELETE FROM device_event WHERE id = 'tablet-race-0001';`);
  const both = await Promise.all([
    run(`SET app.user_id = '${PEOPLE.welder}'; SET ROLE varmak_workshop;
         SELECT book_hours(${w.jobcard}, ${w.op}, 3, current_date, 'Race', 'tablet-race-0001');`),
    run(`SET app.user_id = '${PEOPLE.welder}'; SET ROLE varmak_workshop;
         SELECT book_hours(${w.jobcard}, ${w.op}, 3, current_date, 'Race', 'tablet-race-0001');`)
  ]);
  const succeeded = both.filter((r) => r.ok).length;
  assert.ok(succeeded >= 1, `at least one flush should have got through: ${both.map((r) => r.err).join(' / ')}`);
  assert.equal(value(`SELECT count(*) FROM hours_entry WHERE note = 'Race';`), '1',
    'two flushes arriving together both booked the hours — the claim and the check are not one statement');
  step('Offline: two flushes of the same queued entry arriving at the same moment book it once');
}

// ── The floor cannot reach the office workflows ────────────────────────────────────────────

function eachRoleReachesItsOwnWork(f, w) {
  const forbidden = [
    ['send_estimate', `SELECT send_estimate(1);`],
    ['accept_estimate', `SELECT accept_estimate(1);`],
    ['receive_goods', `SELECT receive_goods(1, 1);`],
    ['convert_lead', `SELECT convert_lead(1);`]
  ];
  for (const [name, call] of forbidden) {
    refused(`a welder calling ${name}`, 'varmak_workshop', PEOPLE.welder, call, /permission denied for function/);
  }
  step('Roles: the four office workflows are not callable by the floor at all — refused on the function itself');

  for (const [name, call] of [
    ['book_hours', `SELECT book_hours(${w.jobcard}, ${w.op}, 1, current_date, 'ok', 'role-check-1');`],
    ['record_operation', `SELECT record_operation(${w.op}, 'paused', 'role-check-2');`],
    ['issue_material_offline', `SELECT issue_material_offline(${f.item}, 1, ${w.jobcard}, 'ok', 'role-check-3');`]
  ]) {
    ok(`a welder calling ${name}`, 'varmak_workshop', PEOPLE.welder, call);
  }
  step('Roles: and the three the floor does need all work for a welder');

  // Held to the wording, not merely to being refused. Row-level security would stop this anyway —
  // worker has to equal your own name and a session with no identity has none — so accepting "new
  // row violates row-level security policy" as a pass made the explicit check untested. It exists
  // for the message: somebody standing at a tablet that has quietly lost its session needs to be
  // told to sign in, not shown a policy name. The mutation check found that by deleting the check
  // and watching nothing fail.
  refused('an unsigned session booking hours', 'varmak_workshop', null,
    `SELECT book_hours(${w.jobcard}, ${w.op}, 1, current_date, 'no session', 'role-check-4');`,
    /sign in before booking hours/);
  refused('an unsigned session starting work', 'varmak_workshop', null,
    `SELECT record_operation(${w.op}, 'paused', 'role-check-5');`, /sign in before starting work/);
  refused('an unsigned session issuing material', 'varmak_workshop', null,
    `SELECT issue_material_offline(${f.item}, 1, ${w.jobcard}, 'no session', 'role-check-6');`,
    /sign in before taking material/);
  step('Roles: a session that has not said who it is is told to sign in, by name, on all three');
}

// ── People ────────────────────────────────────────────────────────────────────────────────

// Until these existed, adding somebody meant opening psql — so a workshop had no way to start using
// the system at all. The awkward case is the first admin, because every rule is written for a system
// that already has one.
function theFirstAdminAndEveryoneAfter() {
  sql(`SET client_min_messages = warning; TRUNCATE app_session, app_user RESTART IDENTITY CASCADE;`);

  // Works once, on an empty system, with no session — there is nobody to sign in as.
  const first = ok('creating the first admin on an empty system', null, null,
    `SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  assert.equal(first, 'anna@varmak.se');
  const admin = value(`SELECT id FROM app_user WHERE email = 'anna@varmak.se';`);
  assert.equal(value(`SELECT role::text FROM app_user WHERE id = ${admin};`), 'admin');
  assert.equal(value(`SELECT (password_hash IS NOT NULL)::text FROM app_user WHERE id = ${admin};`), 'true');

  // And refuses forever after. Not a flag somebody has to remember to turn off — a condition that
  // becomes false the moment it succeeds and cannot become true again without deleting everybody.
  refused('a second use of the bootstrap', null, null,
    `SELECT bootstrap_first_admin('someone@varmak.se', 'Someone Else', 'another long passphrase');`,
    /already has people in it/);
  assert.equal(value(`SELECT count(*) FROM app_user;`), '1');
  step('People: the first admin is made once on an empty system, and that door shuts behind them');

  // After that it is an admin's job, and a person arrives with no way in at all — so there is never
  // a moment where an account exists with a password somebody else chose and nobody changed.
  const welder = ok('the admin adding a welder', 'varmak_admin', admin,
    `SELECT add_person('marko@varmak.se', 'Marko Ilic', 'workshop');`);
  assert.equal(value(`SELECT (password_hash IS NULL AND pin_hash IS NULL)::text FROM app_user WHERE id = ${welder};`),
    'true', 'a new person should arrive with no way in until an admin gives them one');
  // sign_in answers rather than raising — it has to record a failed attempt, and a function that
  // raises rolls back what it just recorded — so the check is that no token came back.
  assert.equal(value(`SELECT coalesce((SELECT token FROM sign_in('marko@varmak.se', '8472', 'pin')), 'none');`),
    'none', 'somebody with no PIN set should not be able to sign in');
  ok('the admin giving them a PIN', 'varmak_admin', admin, `SELECT set_person_pin(${welder}, '8472');`);
  assert.equal(value(`SELECT coalesce((SELECT token FROM sign_in('marko@varmak.se', '8472', 'pin')), '') <> '';`), 't',
    'once the admin sets the PIN they can sign in');
  step('People: an admin adds a person with no way in, then gives them one — never the other way round');

  refused('a welder adding somebody', 'varmak_workshop', welder,
    `SELECT add_person('ghost@varmak.se', 'Ghost', 'admin');`, /permission denied/);

  // The welder above is stopped by the GRANT, before the check inside the function is reached — so
  // that check is untested by it, and removing it would change nothing observable. What it actually
  // defends against is the server handing out the wrong Postgres role: a bug that picked
  // varmak_admin for somebody whose row says workshop. Simulated exactly, because the two layers
  // guard different mistakes and only one of them is the database's.
  const throughTheWrongRole = refused('a welder driving the admin database role', 'varmak_admin', welder,
    `SELECT add_person('ghost@varmak.se', 'Ghost', 'admin');`, /only an admin adds people/);
  assert.ok(!/permission denied/.test(throughTheWrongRole),
    'this case has to be refused by the function, not by the grant, or it is testing the wrong layer');
  assert.equal(value(`SELECT count(*) FROM app_user WHERE email = 'ghost@varmak.se';`), '0');
  refused('the same, setting a PIN', 'varmak_admin', welder,
    `SELECT set_person_pin(${welder}, '9182');`, /by an admin/);
  step('People: and a session handed the wrong database role is still refused by the function itself');
  refused('a welder setting their own PIN through the workflow', 'varmak_workshop', welder,
    `SELECT set_person_pin(${welder}, '9182');`, /permission denied|by an admin/);
  refused('a welder resetting the admin password', 'varmak_workshop', welder,
    `SELECT set_person_password(${admin}, 'a brand new passphrase');`, /permission denied|only an admin/);
  step('People: the floor cannot add anybody, set a PIN, or reset a password — not even their own');

  // Your own password, and you have to prove you know the current one. Without that, anybody who
  // walks past an unlocked tablet owns the account from then on.
  refused('changing your password without knowing the current one', 'varmak_admin', admin,
    `SELECT change_my_password('not my password', 'a completely new passphrase');`,
    /not your current password/);
  ok('changing it with the current one', 'varmak_admin', admin,
    `SELECT change_my_password('correct horse battery staple', 'a completely new passphrase');`);
  assert.equal(value(`SELECT coalesce((SELECT token FROM sign_in('anna@varmak.se', 'a completely new passphrase', 'password')), '') <> '';`),
    't', 'the new password should work');
  assert.equal(value(`SELECT coalesce((SELECT token FROM sign_in('anna@varmak.se', 'correct horse battery staple', 'password')), 'none');`),
    'none', 'the old password must stop working the moment it is changed');
  step('People: you change your own password only by proving you know the current one');
}

// The list the access screen reads. It is the only way anybody sees who is in the system without a
// database console, so what it says has to be true of the database rather than nearly true: above
// all whether a person can actually get in, because add_person deliberately leaves them unable to
// and a screen that cannot tell those apart tells an admin they have given access when they have
// not.
function theListSaysWhoCanActuallyGetIn() {
  sql(`SET client_min_messages = warning; TRUNCATE app_session, app_user RESTART IDENTITY CASCADE;
       SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const admin = value(`SELECT id FROM app_user WHERE email = 'anna@varmak.se';`);
  const welder = value(`SET ROLE varmak_admin; SET app.user_id = '${admin}';
    SELECT add_person('marko@varmak.se', 'Marko Ilic', 'workshop');`);

  const listFor = (role, who) => JSON.parse(ok('reading the people', role, who, `SELECT people();`));
  const find = (list, email) => list.find((row) => row.email === email);

  let list = listFor('varmak_admin', admin);
  assert.equal(list.length, 2, 'an admin should see everybody');
  assert.equal(find(list, 'anna@varmak.se').passwordSet, true);
  assert.equal(find(list, 'anna@varmak.se').pinSet, false);
  // The state add_person leaves somebody in, and the one the screen has to be able to show.
  assert.equal(find(list, 'marko@varmak.se').passwordSet, false);
  assert.equal(find(list, 'marko@varmak.se').pinSet, false);
  assert.equal(value(`SELECT coalesce((SELECT token FROM sign_in('marko@varmak.se', '8472', 'pin')), 'none');`),
    'none', 'the list says this person has no way in, and the door has to agree');

  sql(`SET ROLE varmak_admin; SET app.user_id = '${admin}'; SELECT set_person_pin(${welder}, '8472');`);
  list = listFor('varmak_admin', admin);
  assert.equal(find(list, 'marko@varmak.se').pinSet, true, 'the list has to move when the PIN is set');
  assert.equal(find(list, 'marko@varmak.se').passwordSet, false,
    'a PIN is not a password — the two doors are separate and the list must not conflate them');
  step('People: the list says whether somebody can actually get in, and which door they have');

  // Exactly one row is the caller's, and it is theirs. The screen uses this to leave out the
  // buttons that would lock the building from the inside — switching yourself off, demoting
  // yourself. The database refuses both; not offering them is a different thing and both are wanted.
  assert.deepEqual(list.filter((row) => row.isMe).map((row) => row.email), ['anna@varmak.se']);
  const asWelder = listFor('varmak_workshop', welder);
  assert.deepEqual(asWelder.map((row) => row.email), ['marko@varmak.se'],
    'a welder sees themselves and nobody else — by row-level security, not by anything the server did');
  assert.equal(asWelder[0].isMe, true);
  step('People: exactly one row in the list is yours, and a welder\'s list is only that row');

  // Not one hash, in either shape, for anybody. The columns are not granted, so a function that
  // tried would fail rather than leak — this asserts the result, which is what leaves the building.
  for (const [role, who] of [['varmak_admin', admin], ['varmak_office', admin], ['varmak_workshop', welder]]) {
    const text = ok(`${role} reading the people`, role, who, `SELECT people()::text;`);
    assert.ok(!/\$2[aby]\$/.test(text), `a bcrypt hash reached ${role} through the people list`);
    assert.ok(!/hash/i.test(text), `the word hash reached ${role} through the people list`);
  }
  step('People: no hash of anything leaves through the list, for any role');
}

// Two ways to lock every person out of the system, both easy to do by accident on a Friday
// afternoon, and neither recoverable without a database console.
function nobodyCanLockTheWorkshopOut() {
  sql(`SET client_min_messages = warning; TRUNCATE app_session, app_user RESTART IDENTITY CASCADE;
       SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const admin = value(`SELECT id FROM app_user WHERE email = 'anna@varmak.se';`);
  const welder = value(`SET ROLE varmak_admin; SET app.user_id = '${admin}';
    SELECT add_person('marko@varmak.se', 'Marko Ilic', 'workshop');`);

  refused('the only admin switching themselves off', 'varmak_admin', admin,
    `SELECT set_person_active(${admin}, false);`, /cannot switch yourself off/);
  refused('the only admin making themselves a welder', 'varmak_admin', admin,
    `SELECT set_person_role(${admin}, 'workshop');`, /take away your own admin/);
  assert.equal(value(`SELECT role::text FROM app_user WHERE id = ${admin};`), 'admin');
  step('People: the last admin cannot switch themselves off or take away their own admin');

  // With a second admin the same moves go through — the rule is about yourself, not about admins.
  const second = value(`SET ROLE varmak_admin; SET app.user_id = '${admin}';
    SELECT add_person('lars@varmak.se', 'Lars Holm', 'admin');`);
  ok('a second admin switching the first off', 'varmak_admin', second,
    `SELECT set_person_active(${admin}, false);`);
  assert.equal(value(`SELECT is_active::text FROM app_user WHERE id = ${admin};`), 'false');

  // The invariant, asserted directly rather than through a message. This is what the two refusals
  // above are for, and testing it this way is what showed that a third check written beside them —
  // "that is the last admin" — could never fire: only an admin gets there, an admin is active, and
  // if they are not the person being changed then another active admin exists by definition.
  refused('the remaining admin switching themselves off', 'varmak_admin', second,
    `SELECT set_person_active(${second}, false);`, /cannot switch yourself off/);
  refused('the remaining admin demoting themselves', 'varmak_admin', second,
    `SELECT set_person_role(${second}, 'office');`, /take away your own admin/);
  assert.equal(value(`SELECT count(*) FROM app_user WHERE role = 'admin' AND is_active;`), '1',
    'no sequence of allowed moves may leave the system with nobody who can administer it');
  step('People: there is no sequence of moves that leaves the workshop with no admin at all');

  // Switching somebody off takes away the tablet they are already holding, not just the next one
  // they try to start.
  sql(`SET ROLE varmak_admin; SET app.user_id = '${second}'; SELECT set_person_pin(${welder}, '8472');`);
  const token = value(`SELECT token FROM sign_in('marko@varmak.se', '8472', 'pin');`);
  assert.equal(value(`SELECT coalesce(session_owner('${token}')::text, 'nobody');`), welder);
  ok('switching the welder off', 'varmak_admin', second, `SELECT set_person_active(${welder}, false);`);
  assert.equal(value(`SELECT coalesce(session_owner('${token}')::text, 'nobody');`), 'nobody',
    'the tablet they were already holding must stop working, not just the next sign-in');
  step('People: switching somebody off ends the session they are holding, not only the next one');
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
    console.error(String(error.stderr || error.message).trim());
    process.exit(1);
  }
  for (const file of FILES) {
    execFileSync('psql', [...conn(DB), '-f', file.path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
}

async function main() {
  buildDatabase();
  console.log(`Schema, auth and api built fresh into ${DB}.\n`);

  const f = world();
  theBypassListIsStillShort();
  sendingLocksThePrice(f);
  acceptingMakesTheProject(f);
  receivingExplainsItself(f);
  convertingKeepsTheTrail(f);
  halfDoneIsNeverLeftBehind(f);
  const w = askingTwiceIsHarmless(f);
  theGatesStillHoldOnReplay(f, w);
  await twoTabletsFlushingAtOnce(f, w);
  eachRoleReachesItsOwnWork(f, w);
  theFirstAdminAndEveryoneAfter();
  theListSaysWhoCanActuallyGetIn();
  nobodyCanLockTheWorkshopOut();

  console.log(`\n${checks} checks: ${attempts.refused} things refused, ${attempts.allowed} allowed.`);
}

main().catch((error) => {
  console.error(`\n${error.message || error}`);
  process.exitCode = 1;
});
