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
    'current_app_name', 'current_app_role', 'equipment_state_after_event',
    // The hold that follows a critical failed inspection. The floor holds no INSERT on quality_hold
    // and `only_the_office_holds` sits behind it, so without this the welder's whole transaction rolls
    // back and the shop keeps neither the hold nor the finding. It takes an inspection id and nothing
    // else, and refuses to do anything unless that inspection is failed and critical as it stands.
    'hold_after_failed_inspection',
    'issue_material', 'issue_stock',
    'project_hours_roll_up',
    // Steel arriving and a shelf being counted, for the same reason issuing is here: both write a
    // stock movement, and the name on it is the session's rather than anything the caller passed. The
    // caller's own role holds no INSERT on stock_movement directly, which is what stops a movement
    // being signed in somebody else's name.
    'receive_stock', 'record_stocktake',
    'register_failure', 'session_identity',
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
       UPDATE equipment SET status = 'Out of Service' WHERE id = ${f.machine};`);
  const message = refused('a start queued offline against a machine that has since gone out of service',
    'varmak_workshop', PEOPLE.welder,
    `SELECT record_operation(${w.op}, 'in-progress', 'tablet-1-0010');`, /cannot start/);
  assert.ok(message.includes('Out of Service') && message.includes('MIG 400'),
    `the person has to be told what is wrong with the machine: ${message}`);
  assert.equal(value(`SELECT status FROM operation WHERE id = ${w.op};`), 'pending');
  step('Offline: a start queued against a machine that has gone out of service is refused when it replays');

  // And the refused attempt must not have consumed its event id — otherwise flushing the queue
  // again would report the failure as already done and the work would be silently lost.
  sql(`UPDATE equipment SET status = 'Available' WHERE id = ${f.machine};`);
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

// The store. Material could leave the shelf before these — issue_material_offline is what the shop
// tablet calls — but nothing could put an item on the shelf, or record steel arriving. So a workshop
// could issue material it had no way of telling the system it had.
// ── What the role that bypasses row security may actually write ───────────────────────────

// The companion to theBypassListIsStillShort. That one asks which functions run as varmak_engine; this
// asks what varmak_engine can write when they do — which is the question that decides how much those
// functions could do if one of them were wrong.
//
// Written down as a list rather than derived, because the point is that somebody has to look at it when
// it changes. It was added when a mutation widened `GRANT UPDATE (four columns) ON equipment` to the
// whole table and nothing anywhere noticed: a wider grant breaks no test, which is exactly why a
// privilege list needs a check of its own rather than a comment saying it is narrow.
function theEngineWritesOnlyWhatItMust() {
  const surface = sql(`
    SELECT table_name || ' ' || lower(privilege_type)
      FROM information_schema.table_privileges
     WHERE table_schema = 'public' AND grantee = 'varmak_engine'
       AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    UNION
    SELECT c.table_name || ' ' || lower(c.privilege_type)
        || '(' || string_agg(c.column_name, ',' ORDER BY c.column_name) || ')'
      FROM (SELECT DISTINCT table_name, privilege_type, column_name
              FROM information_schema.column_privileges
             WHERE table_schema = 'public' AND grantee = 'varmak_engine'
               AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')) c
     GROUP BY c.table_name, c.privilege_type
     ORDER BY 1;`).split('\n').map((l) => l.trim()).filter(Boolean);

  // A whole-table grant shows up twice — once as the table and once as every column of it — so the
  // interesting question is which tables it holds wholesale and which it holds column by column.
  const whole = surface.filter((l) => !l.includes('(')).sort();
  assert.deepEqual(whole, [
    // Signing in, signing out, locking an account after failed attempts, and creating the first admin:
    // all of them write app_user or app_session for somebody no policy can see yet.
    'app_session insert', 'app_session update', 'app_user insert', 'app_user update',
    // The audit trail, which every workflow appends to and nobody may edit.
    'activity_log insert',
    // The store: issuing, receiving and counting all move a shelf and write the movement that explains
    // it, and the name on the movement is the session's rather than anything the caller passed.
    'stock_item insert', 'stock_item update', 'stock_movement insert',
    // The project roll-up, which recomputes one figure when a welder books hours against a jobcard.
    'project insert', 'project update',
    // The hold that follows a critical failed inspection. INSERT and nothing else: this role can put a
    // hold on, and no route through it can take one off — releasing is the office's decision and the
    // one that lets work leave the building.
    'quality_hold insert'
  ].sort(), `varmak_engine writes these tables wholesale: ${whole.join(', ')}`);

  const narrow = surface.filter((l) => l.includes('(') && !whole.includes(l.split('(')[0]));
  assert.deepEqual(narrow, [
    // Four columns on equipment and nothing else on it: the three dates a machine is judged by, and its
    // status when it breaks down. A table-wide UPDATE here would let equipment_state_after_event rewrite
    // the register, the certificate expiry and the purchase price of every machine in the shop.
    'equipment update(last_calibration_date,last_inspection_date,last_service_date,status)'
  ], `varmak_engine writes these columns and only these: ${narrow.join(', ')}`);
  step('Bypass: the role that steps around row security writes ten tables and four columns, and that list is read by hand');
}

function theRegisterOfMachinesAndWhatHappensToThem() {
  const f = world();
  const office = PEOPLE.office;
  const welder = PEOPLE.welder;

  const machine = ok('the office putting a machine in the register', 'varmak_office', office,
    `SELECT save_equipment(NULL, 'eq-0100', 'Plasma 120', 'cutting', 'Available', 'Hypertherm',
      'Powermax 120', 'SN-99812', 'A-0100', 2022, 'Handheld plasma cutter',
      'Bay 2', 'Bay 2', 'Fabrication', 'Anna Berg', 'Marko Ilic', 'Good', 'High',
      'Eye protection and gloves', current_date + 200, current_date - 400, 'Nordic Machines',
      84000, current_date + 100, 120.5, 500, 'QR-0100', true, 'Bought with the press');`);
  assert.equal(value(`SELECT ref FROM equipment WHERE id = ${machine};`), 'EQ-0100',
    'the reference is what is written on the machine, and that is upper case');
  assert.equal(value(`SELECT pre_use_check_required::text FROM equipment WHERE id = ${machine};`), 'true',
    'and the flag the safety gate reads is finally settable — nothing could set it before');
  // The three dates a machine is judged by are not parameters.
  assert.equal(value(`SELECT count(*) FROM information_schema.parameters
     WHERE specific_schema = 'public' AND specific_name LIKE 'save_equipment%'
       AND parameter_name IN ('p_last_service_date', 'p_last_inspection_date', 'p_last_calibration_date');`), '0',
    'save_equipment must not take the date of the last service — a form that can type it in is a form '
    + 'that can claim a service nobody performed');
  step('Machines: a machine goes in the register, and the dates it is judged by are not typed into it');

  refused('a machine with no reference', 'varmak_office', office,
    `SELECT save_equipment(NULL, '  ', 'Something', 'welding');`, /needs a reference/);
  refused('a machine with no name', 'varmak_office', office,
    `SELECT save_equipment(NULL, 'EQ-X', '   ', 'welding');`, /needs a name/);
  refused('a machine with no category', 'varmak_office', office,
    `SELECT save_equipment(NULL, 'EQ-X', 'Something', '  ');`, /needs a category/);
  const twice = refused('a second machine under the same reference', 'varmak_office', office,
    `SELECT save_equipment(NULL, 'EQ-0100', 'Another plasma', 'cutting');`,
    /already a machine referenced EQ-0100/);
  assert.match(twice, /Plasma 120/, 'and it says which machine that reference already belongs to');
  refused('a welder editing the register', 'varmak_workshop', welder,
    `SELECT save_equipment(NULL, 'FLOOR-1', 'Floor machine', 'welding');`, /permission denied/);
  step('Machines: a machine needs a reference, a name and a category, and the register is the office\'s');

  // ── What happened to it ─────────────────────────────────────────────────────────────────
  const serviced = ok('the office recording a service', 'varmak_office', office,
    `SELECT record_equipment_event(${machine}, 'service', 'done', current_date - 10,
      current_date + 170, 4500, 'Annual service', NULL, NULL, 'svc-1');`);
  assert.match(serviced, /^E-\d+$/);
  assert.equal(value(`SELECT last_service_date::text FROM equipment WHERE id = ${machine};`),
    value(`SELECT (current_date - 10)::text;`),
    'the date of the last service is the date of the service that happened');
  assert.equal(value(`SELECT performed_by FROM equipment_event WHERE id = ${serviced.slice(2)};`), 'Lars Holm',
    'and who performed it is the session, never a parameter');
  // Asked twice, as a tablet flushing a queue does.
  assert.equal(ok('the same service sent twice', 'varmak_office', office,
    `SELECT record_equipment_event(${machine}, 'service', 'done', current_date - 10,
      current_date + 170, 4500, 'Annual service', NULL, NULL, 'svc-1');`), serviced);
  assert.equal(value(`SELECT count(*) FROM equipment_event WHERE kind = 'service';`), '1',
    'one service, not two');
  step('Machines: a service moves the date it is judged by, in the name of whoever recorded it, once');

  // A failed inspection is not an inspection date. It is a reason the machine is stopped.
  ok('a failed inspection', 'varmak_office', office,
    `SELECT record_equipment_event(${machine}, 'inspection', 'fail', current_date, NULL, NULL,
      'Guard missing');`);
  assert.equal(value(`SELECT coalesce(last_inspection_date::text, 'none') FROM equipment WHERE id = ${machine};`),
    'none', 'a failed inspection must not count as the date it was last inspected');
  ok('and then a passed one', 'varmak_office', office,
    `SELECT record_equipment_event(${machine}, 'inspection', 'pass', current_date, NULL, NULL, 'Guard refitted');`);
  assert.equal(value(`SELECT last_inspection_date::text FROM equipment WHERE id = ${machine};`),
    value(`SELECT current_date::text;`));
  step('Machines: only a service or check that passed moves the date — a failure is not a date');

  // A breakdown stops the machine by itself, because remembering to is how it gets missed.
  ok('a breakdown', 'varmak_office', office,
    `SELECT record_equipment_event(${machine}, 'breakdown', 'observations', current_date, NULL, NULL,
      'Torch head cracked');`);
  assert.equal(value(`SELECT status::text FROM equipment WHERE id = ${machine};`), 'Out of Service',
    'recording a breakdown and the machine being stopped are one event, not two actions');
  step('Machines: a breakdown takes the machine out of service without anybody remembering to');

  refused('a service recorded for next week', 'varmak_office', office,
    `SELECT record_equipment_event(${machine}, 'service', 'done', current_date + 7);`,
    /a date that has not happened yet/);
  refused('an event against a machine that does not exist', 'varmak_office', office,
    `SELECT record_equipment_event(999999, 'service', 'done');`, /no such machine/);
  step('Machines: an event cannot be dated in the future, nor recorded against nothing');

  // ── The check a welder signs, which is the whole reason the gate exists ──────────────────
  sql(`UPDATE equipment SET status = 'Available' WHERE id = ${f.machine};`);
  const failedCheck = ok('a welder signing a check that failed', 'varmak_workshop', welder,
    `SELECT record_equipment_event(${f.machine}, 'pre-use-check', 'fail', current_date, NULL, NULL,
      'Gas leak at the torch', NULL, NULL, 'chk-1');`);
  assert.equal(value(`SELECT performed_by FROM equipment_event WHERE id = ${failedCheck.slice(2)};`),
    'Marko Ilic', 'signed in the name of whoever is standing in front of the machine');
  // A project of its own, because world() has no projects in it — the first version of this selected
  // one that did not exist and produced `VALUES (, 1, ...)`.
  const project = value(`INSERT INTO project (name, customer_id)
    VALUES ('Cutting work', ${f.customer}) RETURNING id;`);
  const jobcard = value(`INSERT INTO jobcard (project_id, title)
    VALUES (${project}, 'Frame') RETURNING id;`);
  const op = value(`INSERT INTO operation (jobcard_id, seq, description, equipment_id)
    VALUES (${jobcard}, 1, 'Cut out', ${f.machine}) RETURNING id;`);
  refused('starting the work while that check is unanswered', 'varmak_office', office,
    `UPDATE operation SET status = 'in-progress' WHERE id = ${op};`,
    /a pre-use check on .+ failed and has not been answered/);
  step('Machines: a check the welder failed stops the work, and the database is what stops it');

  // And the welder answers it themselves, which is the part that needed a policy of its own.
  const answer = ok('the same welder signing a check that passed, answering the failure',
    'varmak_workshop', welder,
    `SELECT record_equipment_event(${f.machine}, 'pre-use-check', 'pass', current_date, NULL, NULL,
      'Hose replaced', ${jobcard}, ${failedCheck.slice(2)}, 'chk-2');`);
  assert.match(answer, /^E-\d+$/);
  assert.equal(value(`SELECT resolved::text FROM equipment_event WHERE id = ${failedCheck.slice(2)};`),
    'true', 'the failure is marked answered by the event that answers it, not by somebody remembering');
  ok('and now the work starts', 'varmak_office', office,
    `UPDATE operation SET status = 'in-progress' WHERE id = ${op};`);
  step('Machines: the welder answers their own failed check and the work starts — one call, not two');

  // ── Where the machine is ────────────────────────────────────────────────────────────────
  const second = value(`INSERT INTO jobcard (project_id, title)
    VALUES (${project}, 'Second job') RETURNING id;`);
  assert.equal(ok('a welder taking the machine to a bench', 'varmak_workshop', welder,
    `SELECT assign_equipment(${f.machine}, ${jobcard}, 'asg-1');`),
    value(`SELECT ref FROM jobcard WHERE id = ${jobcard};`),
    'it answers with the jobcard it went to, which is what the screen shows');
  assert.equal(value(`SELECT count(*) FROM equipment_assignment
    WHERE equipment_id = ${f.machine} AND released_at IS NULL;`), '1');
  // Pressed twice is not a mistake.
  ok('the same assignment sent twice', 'varmak_workshop', welder,
    `SELECT assign_equipment(${f.machine}, ${jobcard}, 'asg-1');`);
  ok('and asked again without the event id, to the same jobcard', 'varmak_workshop', welder,
    `SELECT assign_equipment(${f.machine}, ${jobcard});`);
  assert.equal(value(`SELECT count(*) FROM equipment_assignment WHERE equipment_id = ${f.machine};`), '1',
    'one assignment, whichever way it was asked');

  const taken = refused('sending it to a second jobcard while it is out', 'varmak_workshop', welder,
    `SELECT assign_equipment(${f.machine}, ${second});`, /return it from there first/);
  assert.match(taken, new RegExp(value(`SELECT ref FROM jobcard WHERE id = ${jobcard};`)),
    'and the refusal says which jobcard has it, which "duplicate key value" never would');
  refused('assigning a machine that does not exist', 'varmak_workshop', welder,
    `SELECT assign_equipment(999999, ${jobcard});`, /no such machine/);
  refused('assigning it to a jobcard that does not exist', 'varmak_workshop', welder,
    `SELECT assign_equipment(${f.machine}, 999999);`, /no such jobcard/);
  step('Machines: a machine goes to one bench at a time, and the refusal says which bench has it');

  ok('the welder bringing it back', 'varmak_workshop', welder,
    `SELECT return_equipment(${f.machine}, 'Finished with it', 'ret-1');`);
  assert.equal(value(`SELECT count(*) FROM equipment_assignment
    WHERE equipment_id = ${f.machine} AND released_at IS NULL;`), '0');
  assert.equal(value(`SELECT count(*) FROM equipment_assignment WHERE equipment_id = ${f.machine};`), '1',
    'the period it spent on that jobcard is kept, not deleted');
  assert.equal(ok('returning it again', 'varmak_workshop', welder,
    `SELECT return_equipment(${f.machine});`), 'already returned',
    'pressing it twice says so rather than refusing');
  ok('and now it can go somewhere else', 'varmak_workshop', welder,
    `SELECT assign_equipment(${f.machine}, ${second});`);
  // The machine's status is deliberately untouched by any of this.
  assert.equal(value(`SELECT status::text FROM equipment WHERE id = ${f.machine};`), 'Available',
    'where a machine is and whether it may be run are different questions, and the gates read the second');
  step('Machines: it comes back, the period it was out is kept, and its status was never the answer to "where is it"');
}

function theStoreCanBeStockedAndCounted() {
  const f = world();
  const office = PEOPLE.office;

  const item = ok('the office adding a store item', 'varmak_office', office,
    `SELECT save_stock_item(NULL, 's355-12', 'Plate S355J2 12mm', 'KG', NULL, NULL, NULL, NULL,
      'A1-01-02', 'Mild Steel Plate', 'S355J2', '12 × 1500 × 3000 mm', 'kg', 1, 1, 141.3,
      500, 1000, NULL, NULL, NULL, NULL);`);
  assert.equal(value(`SELECT code FROM stock_item WHERE id = ${item};`), 'S355-12',
    'the code is what the label says, and labels are upper case');
  assert.equal(value(`SELECT bin_code FROM stock_item WHERE id = ${item};`), 'A1-01-02');
  // The one column the store screen must never be able to type into.
  assert.equal(value(`SELECT stock::text FROM stock_item WHERE id = ${item};`), '0.000',
    'a new item has nothing on the shelf until something arrives with a movement behind it');
  assert.equal(value(`SELECT count(*) FROM information_schema.parameters
     WHERE specific_schema = 'public' AND specific_name LIKE 'save_stock_item%'
       AND parameter_name = 'p_stock';`), '0',
    'save_stock_item must not take a stock figure — a figure with no movement behind it is a shelf '
    + 'that disagrees with the record of why');
  step('Store: an item goes on the books with no stock on it, because stock arrives through a movement');

  refused('an item with no code', 'varmak_office', office,
    `SELECT save_stock_item(NULL, '  ', 'Something', 'KG');`, /needs a code/);
  refused('an item with no description', 'varmak_office', office,
    `SELECT save_stock_item(NULL, 'X-1', '   ', 'KG');`, /needs a description/);
  refused('an item with no unit', 'varmak_office', office,
    `SELECT save_stock_item(NULL, 'X-1', 'Something', '  ');`, /needs a unit/);
  const twice = refused('a second item with the same code', 'varmak_office', office,
    `SELECT save_stock_item(NULL, 'S355-12', 'Plate, again', 'KG');`, /already an item coded S355-12/);
  assert.match(twice, /Plate S355J2 12mm/, 'and it says which item that code already belongs to');
  refused('a welder adding a store item', 'varmak_workshop', PEOPLE.welder,
    `SELECT save_stock_item(NULL, 'FLOOR-1', 'Floor item', 'EA');`, /permission denied/);
  step('Store: an item needs a code, a description and a unit, and the code is not free for a second item');

  // ── Steel arriving ──────────────────────────────────────────────────────────────────────
  const first = ok('fifty kilos at 14.00', 'varmak_office', office,
    `SELECT receive_stock(${item}, 50, 14.00, 'Nordic Steel', 'DN-4471', 'H240516', 'MTC_H240516.pdf');`);
  assert.match(value(`SELECT ref FROM stock_movement WHERE id = ${first};`), /^MV-\d{4}-\d{5}$/);
  assert.equal(value(`SELECT stock::text || '|' || avg_cost::text || '|' || last_price::text
    FROM stock_item WHERE id = ${item};`), '50.000|14.00|14.00');
  assert.equal(value(`SELECT heat_no || '|' || material_cert_ref FROM stock_item WHERE id = ${item};`),
    'H240516|MTC_H240516.pdf', 'the heat and the certificate come in with the delivery');
  assert.equal(value(`SELECT moved_by FROM stock_movement WHERE id = ${first};`), 'Lars Holm',
    'the name on the movement is the session\'s, and there is no parameter that could say otherwise');
  assert.equal(value(`SELECT count(*) FROM information_schema.parameters
     WHERE specific_schema = 'public' AND specific_name LIKE 'receive_stock%'
       AND parameter_name IN ('p_by', 'p_user', 'p_moved_by');`), '0',
    'a receipt signed in a name the caller passed is not a record of who put the steel on the shelf');
  step('Store: steel arrives, the shelf goes up, and the movement is signed by whoever was signed in');

  // The weighted average, which is the difference between a store that can cost a job and one that can
  // only tell you what the last load cost. Fifty at 14.00 plus fifty at 16.00 is a hundred at 15.00.
  ok('fifty more at 16.00', 'varmak_office', office,
    `SELECT receive_stock(${item}, 50, 16.00, 'Nordic Steel', 'DN-4492');`);
  assert.equal(value(`SELECT stock::text || '|' || avg_cost::text || '|' || last_price::text
    FROM stock_item WHERE id = ${item};`), '100.000|15.00|16.00',
    'the average is weighted by what was on the shelf, not replaced by what arrived last');
  // And a delivery with no price on it must not drag the average to nothing.
  ok('twenty more with no price on the note', 'varmak_office', office,
    `SELECT receive_stock(${item}, 20);`);
  assert.equal(value(`SELECT stock::text || '|' || avg_cost::text FROM stock_item WHERE id = ${item};`),
    '120.000|15.00', 'a receipt with no price leaves the average exactly where it was');
  refused('a receipt for nothing', 'varmak_office', office,
    `SELECT receive_stock(${item}, 0, 14.00);`, /more than nothing/);
  refused('a receipt against an item that does not exist', 'varmak_office', office,
    `SELECT receive_stock(999999, 10, 14.00);`, /no such store item/);
  step('Store: the average cost is weighted by the shelf, and a note with no price on it changes neither');

  // ── Counting it ─────────────────────────────────────────────────────────────────────────
  const count = ok('counting 118 where the book says 120', 'varmak_office', office,
    `SELECT record_stocktake(${item}, 118, 'Two lengths cut and not booked');`);
  assert.equal(value(`SELECT stock::text FROM stock_item WHERE id = ${item};`), '118.000');
  assert.equal(value(`SELECT kind::text || '|' || quantity::text FROM stock_movement WHERE id = ${count};`),
    'adjustment|2.000', 'the difference is the movement, and it says which way');
  assert.match(value(`SELECT note FROM stock_movement WHERE id = ${count};`),
    /counted 118, was 120/);
  // Counted and found right: nothing to correct, and a movement of nothing would be noise in the one
  // place a storeman goes to find out why a figure changed.
  assert.equal(ok('counting it again and finding it right', 'varmak_office', office,
    `SELECT coalesce(record_stocktake(${item}, 118)::text, 'no movement');`), 'no movement');
  assert.equal(value(`SELECT count(*) FROM stock_movement WHERE stock_item_id = ${item}
    AND kind = 'adjustment';`), '1');
  refused('a count below nothing', 'varmak_office', office,
    `SELECT record_stocktake(${item}, -1);`, /less than nothing/);
  step('Store: a count corrects the shelf through a movement, and finding it right writes nothing');

  // And the floor can still take it off the shelf, which is what the whole store is for.
  // A job to issue against, made through the workflows added beside these — which is also the first
  // time in this suite that the store and the work are asked to fit together.
  const project = ok('a project for the steel to go to', 'varmak_office', office,
    `SELECT save_project(NULL, 'Store frame', ${f.customer}, 'quotation');`);
  const jobcard = ok('and a job on it', 'varmak_office', office,
    `SELECT save_jobcard(NULL, ${project}, 'Store weldment');`);
  ok('a welder taking twelve kilos for a job', 'varmak_workshop', PEOPLE.welder,
    `SELECT issue_material_offline(${item}, 12, ${jobcard}, 'Frame plates', 'store-0001');`);
  assert.equal(value(`SELECT stock::text FROM stock_item WHERE id = ${item};`), '106.000');
  assert.equal(value(`SELECT moved_by FROM stock_movement WHERE stock_item_id = ${item}
    AND kind = 'issue' ORDER BY id DESC LIMIT 1;`), 'Marko Ilic');
  step('Store: and the floor takes material off the shelf in its own name, against a job');
}

// Getting work onto the bench. Until save_project and save_jobcard existed, the only way a job
// reached the floor was accept_estimate — so a workshop that took an order over the telephone had no
// way to record it at all, and the hours screen had nothing to book against.
function workReachesTheFloor() {
  const f = world();
  const office = PEOPLE.office;
  const customer = value(`SELECT id FROM customer WHERE name = 'Skåne Verkstad AB';`);

  const project = ok('the office starting a project', 'varmak_office', office,
    `SELECT save_project(NULL, 'Conveyor frame', ${customer}, 'quotation', 40, 0,
      current_date + 60, 'Two frames and a hopper', 'planning', 'Fabrication', 'PO-77',
      'Marieholm', 'Aleksandar C.', 'not-ordered', NULL, current_date + 7, current_date + 50,
      NULL, NULL, NULL, NULL, NULL, NULL, 420000);`);
  assert.match(value(`SELECT ref FROM project WHERE id = ${project};`), /^P-\d{4}-\d{3}$/,
    'the reference comes from the dated sequence, not from the caller');
  assert.equal(value(`SELECT planned_hours::text || '|' || quoted_value::text || '|' || status::text
    FROM project WHERE id = ${project};`), '40.00|420000.00|quotation');
  assert.equal(value(`SELECT actor FROM activity_log WHERE entity = 'project' ORDER BY id DESC LIMIT 1;`),
    'Lars Holm', 'and the name is the session\'s');
  step('Work: the office starts a project from the screen and it is in the database, numbered');

  refused('a project with no name', 'varmak_office', office,
    `SELECT save_project(NULL, '  ', ${customer});`, /needs a name/);
  refused('a project belonging to nobody', 'varmak_office', office,
    `SELECT save_project(NULL, 'Orphan frame', NULL);`, /belongs to a customer/);
  refused('a project for a customer that does not exist', 'varmak_office', office,
    `SELECT save_project(NULL, 'Ghost frame', 999999);`, /no such customer/);
  refused('a welder starting a project', 'varmak_workshop', PEOPLE.welder,
    `SELECT save_project(NULL, 'Floor project', ${customer});`, /permission denied/);
  step('Work: a project needs a name and a customer that exists, and the floor cannot start one');

  // The status rulebook still has the last word, and it is a table rather than a copy of the rules
  // inside this function — so a transition nobody allowed is refused with the transition named.
  const jump = refused('a project going straight from quotation to completed', 'varmak_office', office,
    `SELECT save_project(${project}, 'Conveyor frame', ${customer}, 'completed');`,
    /cannot go from quotation to completed/);
  assert.equal(value(`SELECT status::text FROM project WHERE id = ${project};`), 'quotation');
  assert.ok(!/allowed_transition/.test(jump), 'the refusal names the transition, not the table');
  ok('the same project moving one allowed step', 'varmak_office', office,
    `SELECT save_project(${project}, 'Conveyor frame', ${customer}, 'approved');`);
  assert.equal(value(`SELECT status::text FROM project WHERE id = ${project};`), 'approved');
  // A hold has to say why, and that is the schema's rule rather than this function's. Asked from
  // 'planned', because a hold from 'approved' is refused by the rulebook first and would have tested
  // the transition twice instead of testing the reason — which is what it did.
  ok('the project reaching planned', 'varmak_office', office,
    `SELECT save_project(${project}, 'Conveyor frame', ${customer}, 'planned');`);
  refused('putting it on hold without saying why', 'varmak_office', office,
    `SELECT save_project(${project}, 'Conveyor frame', ${customer}, 'hold');`,
    /held_project_says_why|hold_reason/);
  ok('putting it on hold with a reason', 'varmak_office', office,
    `SELECT save_project(${project}, 'Conveyor frame', ${customer}, 'hold', 40, 0, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'Waiting for the customer to approve the drawings', 'Rev B expected Friday');`);
  assert.equal(value(`SELECT hold_reason FROM project WHERE id = ${project};`),
    'Waiting for the customer to approve the drawings');
  step('Work: the status rulebook and the hold-needs-a-reason rule still hold through the workflow');

  // The frontend's two names for one state. schema.sql fixed the canonical spelling and said the API
  // translates on the way in; without that, every screen that says 'active' would be refused and the
  // one that says 'production' would not, for the same project in the same state.
  const aliased = ok('a project started as "draft", which is the retired name for quotation',
    'varmak_office', office, `SELECT save_project(NULL, 'Aliased frame', ${customer}, 'draft');`);
  assert.equal(value(`SELECT status::text FROM project WHERE id = ${aliased};`), 'quotation');
  ok('the same project moved to "active", which is what the estimating screen calls production',
    'varmak_office', office,
    `SELECT save_project(${aliased}, 'Aliased frame', ${customer}, 'approved');`);
  ok('and on to planned', 'varmak_office', office,
    `SELECT save_project(${aliased}, 'Aliased frame', ${customer}, 'planned');`);
  ok('and to active', 'varmak_office', office,
    `SELECT save_project(${aliased}, 'Aliased frame', ${customer}, 'active');`);
  assert.equal(value(`SELECT status::text FROM project WHERE id = ${aliased};`), 'production',
    'one spelling in the database, whichever of the frontend\'s two words arrived');
  step('Work: the frontend\'s two names for one state are translated on the way in, not stored');

  // used_hours is maintained by the hours entries and is not a parameter. A screen that could set it
  // could make a project claim work nobody did, and the roll-up would then disagree with the hours.
  const args = value(`SELECT count(*) FROM information_schema.parameters
     WHERE specific_schema = 'public' AND parameter_name = 'p_used_hours';`);
  assert.equal(args, '0', 'no workflow may take used_hours as a parameter — it is a roll-up');
  step('Work: no workflow can set a project\'s used hours — that total belongs to the hours entries');

  const jobcard = ok('a jobcard on the project', 'varmak_office', office,
    `SELECT save_jobcard(NULL, ${project}, 'Frame weldment', 'draft', 'Frame', 2, 'BR-4410-A', 1,
      24, current_date + 10, current_date + 20, current_date + 25, 'fabrication', 'workshop',
      'high', 'Marko Ilic', 'partial', 'H240516', 'MTC-1', 'Two off', 0);`);
  assert.match(value(`SELECT ref FROM jobcard WHERE id = ${jobcard};`), /^JC-\d{4}-\d{4}$/);
  // The customer is taken from the project and there is no parameter for it. A jobcard carrying a
  // different customer from its project makes every report disagree with itself, and nobody would
  // ever put the two columns side by side to notice.
  assert.equal(value(`SELECT (j.customer_id = p.customer_id)::text FROM jobcard j
    JOIN project p ON p.id = j.project_id WHERE j.id = ${jobcard};`), 'true');
  assert.equal(value(`SELECT count(*) FROM information_schema.parameters
     WHERE specific_schema = 'public' AND specific_name LIKE 'save_jobcard%'
       AND parameter_name = 'p_customer_id';`), '0',
    'save_jobcard must not take a customer — it belongs to the project');
  assert.equal(value(`SELECT created_by FROM jobcard WHERE id = ${jobcard};`), 'Lars Holm');
  step('Work: a jobcard hangs off the project and takes its customer from it, never from the caller');

  refused('a jobcard with no title', 'varmak_office', office,
    `SELECT save_jobcard(NULL, ${project}, '   ');`, /needs a title/);
  refused('a jobcard belonging to no project', 'varmak_office', office,
    `SELECT save_jobcard(NULL, NULL, 'Loose weldment');`, /belongs to a project/);
  refused('a jobcard on a project that does not exist', 'varmak_office', office,
    `SELECT save_jobcard(NULL, 999999, 'Ghost weldment');`, /no such project/);
  refused('a welder writing a jobcard through the workflow', 'varmak_workshop', PEOPLE.welder,
    `SELECT save_jobcard(NULL, ${project}, 'Floor weldment');`, /permission denied/);
  // The schema's own vocabularies still apply through the workflow, which is the point of having
  // them as constraints rather than as a list in the page's JavaScript.
  refused('a jobcard whose material is in a state there is no word for', 'varmak_office', office,
    `SELECT save_jobcard(NULL, ${project}, 'Frame', 'draft', NULL, 1, NULL, 0, 0, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, 'ordered');`, /material_readiness|check/i);
  refused('a jobcard with a priority nobody uses', 'varmak_office', office,
    `SELECT save_jobcard(NULL, ${project}, 'Frame', 'draft', NULL, 1, NULL, 0, 0, NULL, NULL, NULL,
      NULL, NULL, 'whenever');`, /priority|check/i);
  step('Work: a jobcard needs a title and a project that exists, and the floor cannot write one');
  return { project, jobcard, customer, office };
}

// The steps, which are a list like the contacts and are not replaceable like one.
function theStepsRememberTheWorkDoneOnThem(w) {
  const office = w.office;
  const jobcard = w.jobcard;

  assert.equal(ok('three steps at once', 'varmak_office', office,
    `SELECT set_jobcard_operations(${jobcard}, '[
      {"desc": "Cut and prepare", "plannedHours": 8},
      {"desc": "Weld out", "plannedHours": 16, "inspectionCheckpoint": true},
      {"desc": "Dress and paint", "plannedHours": 6}
    ]'::jsonb);`), '3');
  assert.equal(value(`SELECT string_agg(seq::text || '=' || description, ', ' ORDER BY seq)
    FROM operation WHERE jobcard_id = ${jobcard};`),
    '1=Cut and prepare, 2=Weld out, 3=Dress and paint');
  assert.equal(value(`SELECT inspection_checkpoint::text FROM operation
    WHERE jobcard_id = ${jobcard} AND seq = 2;`), 'true');
  step('Work: the steps go in as a list and are numbered by their place in it');

  refused('a step with no description', 'varmak_office', office,
    `SELECT set_jobcard_operations(${jobcard}, '[{"plannedHours": 4}]'::jsonb);`,
    /step 1 has none/);
  refused('steps that are not a list', 'varmak_office', office,
    `SELECT set_jobcard_operations(${jobcard}, '{"desc": "Weld"}'::jsonb);`, /arrive as a list/);
  refused('steps for a jobcard that does not exist', 'varmak_office', office,
    `SELECT set_jobcard_operations(999999, '[]'::jsonb);`, /no such jobcard/);
  assert.equal(value(`SELECT count(*) FROM operation WHERE jobcard_id = ${jobcard};`), '3',
    'and none of those refusals changed the list');
  step('Work: a refused list of steps leaves the jobcard exactly as it was');

  // Re-ordering. The ids come back from the snapshot and go back with the list, so a step that moved
  // is the same step — and UNIQUE (jobcard_id, seq) means the renumbering cannot be done in place.
  const ids = sql(`SELECT id FROM operation WHERE jobcard_id = ${jobcard} ORDER BY seq;`).split('\n');
  assert.equal(ok('the same three steps in a different order', 'varmak_office', office,
    `SELECT set_jobcard_operations(${jobcard}, '[
      {"id": "${ids[1]}", "desc": "Weld out", "plannedHours": 16},
      {"id": "${ids[0]}", "desc": "Cut and prepare", "plannedHours": 8},
      {"id": "${ids[2]}", "desc": "Dress and paint", "plannedHours": 6}
    ]'::jsonb);`), '3');
  assert.equal(value(`SELECT string_agg(seq::text || '=' || id::text, ', ' ORDER BY seq)
    FROM operation WHERE jobcard_id = ${jobcard};`),
    `1=${ids[1]}, 2=${ids[0]}, 3=${ids[2]}`,
    'the steps are the same rows in a new order, not three new rows');
  assert.equal(value(`SELECT count(*) FROM operation WHERE jobcard_id = ${jobcard};`), '3');
  step('Work: re-ordering the steps moves the same rows rather than replacing them');

  // The rule this function exists for. Book hours on a step, then try to take it off the jobcard.
  // Through the states the rulebook allows, one at a time, because the rulebook is what says which
  // order they come in: draft → released → ready → in-progress.
  sql(`UPDATE jobcard SET status = 'released' WHERE id = ${jobcard};
       UPDATE jobcard SET status = 'ready' WHERE id = ${jobcard};
       UPDATE jobcard SET status = 'in-progress' WHERE id = ${jobcard};`);
  ok('a welder booking hours on the weld-out', 'varmak_workshop', PEOPLE.welder,
    `SELECT book_hours(${jobcard}, ${ids[1]}, 6.5, current_date, 'Root pass', 'ops-0001');`);
  assert.equal(value(`SELECT logged_hours::text FROM operation WHERE id = ${ids[1]};`), '6.50');

  const gone = refused('taking off a step somebody has worked on', 'varmak_office', office,
    `SELECT set_jobcard_operations(${jobcard}, '[
      {"id": "${ids[0]}", "desc": "Cut and prepare", "plannedHours": 8},
      {"id": "${ids[2]}", "desc": "Dress and paint", "plannedHours": 6}
    ]'::jsonb);`, /6.50 hours booked on it and cannot be taken off/);
  assert.match(gone, /Weld out/, 'the refusal has to name the step, not its number alone');
  assert.equal(value(`SELECT count(*) FROM operation WHERE jobcard_id = ${jobcard};`), '3');
  // The reason it matters: hours_entry.operation_id is ON DELETE SET NULL, so the delete would have
  // gone through silently and the hours would still be there — pointing at nothing.
  assert.equal(value(`SELECT count(*) FROM hours_entry WHERE operation_id = ${ids[1]};`), '1');
  step('Work: a step with hours booked on it cannot be taken off — those hours would lose the step');

  // A step can have been started without an hour booked against it yet — somebody pressed start on
  // the tablet an hour ago. Taking that off the plan says the work was never planned, while the
  // machine has been running. Set here directly, because starting it through the workflow would also
  // book hours and this is the case where there are none.
  sql(`UPDATE operation SET status = 'in-progress' WHERE id = ${ids[2]};`);
  const started = refused('taking off a step that has been started', 'varmak_office', office,
    `SELECT set_jobcard_operations(${jobcard}, '[
      {"id": "${ids[1]}", "desc": "Weld out", "plannedHours": 16},
      {"id": "${ids[0]}", "desc": "Cut and prepare", "plannedHours": 8}
    ]'::jsonb);`, /is in-progress and cannot be taken off/);
  assert.match(started, /Dress and paint/, 'and it names the step');
  assert.equal(value(`SELECT count(*) FROM operation WHERE jobcard_id = ${jobcard};`), '3');
  sql(`UPDATE operation SET status = 'pending' WHERE id = ${ids[2]};`);
  step('Work: nor can one that has been started, even with no hours booked on it yet');

  // But a step nobody has touched can go, which is most of what editing a plan is.
  assert.equal(ok('taking off a step nobody has touched', 'varmak_office', office,
    `SELECT set_jobcard_operations(${jobcard}, '[
      {"id": "${ids[1]}", "desc": "Weld out", "plannedHours": 16},
      {"id": "${ids[0]}", "desc": "Cut and prepare", "plannedHours": 8}
    ]'::jsonb);`), '2');
  assert.equal(value(`SELECT count(*) FROM operation WHERE jobcard_id = ${jobcard};`), '2');
  assert.equal(value(`SELECT logged_hours::text FROM operation WHERE id = ${ids[1]};`), '6.50',
    'and the hours on the step that stayed are still on it');
  step('Work: a step nobody has touched comes off, and the hours on the others are untouched');
}

// The first record a workshop starting from nothing has to be able to make. Until save_customer
// existed the only way to make one was an INSERT, which is a database console, which is the thing
// this whole layer exists to stop being necessary.
function aCustomerCanBeMadeAndCorrected() {
  const f = world();
  const office = PEOPLE.office;

  const made = ok('the office creating a customer', 'varmak_office', office,
    `SELECT save_customer(NULL, 'Höganäs Mekaniska AB', 'active', 'Höganäs', 'Sweden',
      '556677-8899', 'SE556677889901', 'order@hoganas-mek.se', '+46 42 33 44 55',
      'hoganas-mek.se', 'Food processing', '2026-02-01', 'direct', true, 'Email', 'Two shifts',
      180000, 'SEK', 30, 'Standard 2026', 'Ex Works', '4% over 200k', 'Box 12, 263 21 Höganäs');`);
  assert.match(made, /^\d+$/);
  assert.match(value(`SELECT ref FROM customer WHERE id = ${made};`), /^C-\d{3}$/,
    'a customer made this way still gets its reference from the sequence, not from the caller');
  assert.equal(value(`SELECT payment_terms_days::text || '|' || price_list || '|' || credit_limit::text
    FROM customer WHERE id = ${made};`), '30|Standard 2026|180000.00',
    'the commercial half has to arrive with the rest of it, in one call');
  // Two fields one letter apart in meaning, which were conflated once. preferred_contact is how the
  // customer wants to be reached; is_preferred is whether the workshop favours them.
  assert.equal(value(`SELECT preferred_contact || '|' || is_preferred::text FROM customer WHERE id = ${made};`),
    'Email|true', 'the preferred contact method and the preferred-customer flag are different columns');
  assert.equal(value(`SELECT count(*) FROM activity_log WHERE entity = 'customer' AND action = 'created';`), '1',
    'making a customer is on the record, under the name of whoever did it');
  assert.equal(value(`SELECT actor FROM activity_log WHERE entity = 'customer' ORDER BY id DESC LIMIT 1;`),
    'Lars Holm', 'and the name comes from the session, not from the caller');
  step('Customers: the office makes a customer from the screen, commercial half and all, and it is logged');

  // The name, not the reference. A second Höganäs Mekaniska is made by somebody who searched, did
  // not find it, and typed it again — and from then on half the jobs are under one and half the
  // other, which no report can put back together.
  const again = refused('a second customer with the same name', 'varmak_office', office,
    `SELECT save_customer(NULL, 'Höganäs Mekaniska AB');`, /already a customer called/);
  assert.match(again, /C-\d{3}/, 'the refusal has to say which customer it already is, or it is a dead end');
  ok('the same name with different spacing and case is still the same customer', 'varmak_office', office,
    `SELECT 1;`);
  refused('the same name in a different case', 'varmak_office', office,
    `SELECT save_customer(NULL, '  höganäs mekaniska ab ');`, /already a customer called/);
  assert.equal(value(`SELECT count(*) FROM customer;`), '2',
    'the fixture customer and the one new one — nothing else got in');
  step('Customers: the same customer cannot be typed in twice, whatever the spacing or the case');

  refused('a customer with no name', 'varmak_office', office,
    `SELECT save_customer(NULL, '   ');`, /needs a name/);
  refused('a customer in a state a customer cannot be in', 'varmak_office', office,
    `SELECT save_customer(NULL, 'Nowhere AB', 'archived');`, /check|status/i);
  refused('a credit limit below zero', 'varmak_office', office,
    `SELECT save_customer(NULL, 'Nowhere AB', 'active', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, false, NULL, NULL, -1);`, /credit_limit|check/i);
  step('Customers: and the schema still has the last word on the name, the status and the figures');

  // Correcting one. The screen hands back the whole record, so this replaces rather than patches —
  // and emptying a box has to actually empty the column, or a correction is impossible to make.
  ok('the office correcting the telephone number', 'varmak_office', office,
    `SELECT save_customer(${made}, 'Höganäs Mekaniska AB', 'active', 'Höganäs', 'Sweden',
      '556677-8899', 'SE556677889901', 'order@hoganas-mek.se', '+46 42 99 88 77',
      'hoganas-mek.se', 'Food processing', '2026-02-01', 'direct', true, 'Email', NULL,
      180000, 'SEK', 30, 'Standard 2026', 'Ex Works', '4% over 200k', 'Box 12, 263 21 Höganäs');`);
  assert.equal(value(`SELECT phone FROM customer WHERE id = ${made};`), '+46 42 99 88 77');
  assert.equal(value(`SELECT coalesce(notes, 'cleared') FROM customer WHERE id = ${made};`), 'cleared',
    'a box the person emptied has to end up empty, or a correction cannot be made at all');
  assert.equal(value(`SELECT count(*) FROM customer;`), '2', 'correcting one must not make another');
  step('Customers: correcting one replaces the record, so emptying a box empties the column');

  refused('correcting a customer that does not exist', 'varmak_office', office,
    `SELECT save_customer(999999, 'Ghost AB');`, /no such customer/);
  refused('a welder making a customer', 'varmak_workshop', PEOPLE.welder,
    `SELECT save_customer(NULL, 'Floor Customer AB');`, /permission denied/);
  refused('a welder correcting one', 'varmak_workshop', PEOPLE.welder,
    `SELECT save_customer(${made}, 'Renamed By The Floor AB');`, /permission denied/);
  assert.equal(value(`SELECT name FROM customer WHERE id = ${made};`), 'Höganäs Mekaniska AB');
  step('Customers: the floor cannot make a customer or rename one');
  return { customer: made, office: office };
}

// The contacts, which arrive as a list because that is how the screen holds them.
function theContactListIsReplacedAtomically(w) {
  const office = w.office;
  const customer = w.customer;

  assert.equal(ok('two contacts at once', 'varmak_office', office,
    `SELECT set_customer_contacts(${customer}, '[
      {"name": "Erik Lund", "role": "Purchasing", "email": "erik@hoganas-mek.se", "primary": true},
      {"name": "Sara Nyberg", "role": "Quality", "phone": "+46 70 444 55 66"}
    ]'::jsonb);`), '2');
  assert.equal(value(`SELECT name FROM customer_contact WHERE customer_id = ${customer} AND is_primary;`),
    'Erik Lund');
  step('Customers: the contact list goes in as a list, with one of them marked as the main one');

  // Two main contacts is nobody to ring, and the refusal has to be a sentence — the unique index
  // behind it says "customer_has_one_main_contact", which is not something to read out on the phone.
  const two = refused('a list with two main contacts', 'varmak_office', office,
    `SELECT set_customer_contacts(${customer}, '[
      {"name": "Erik Lund", "email": "erik@hoganas-mek.se", "primary": true},
      {"name": "Tomas Ek", "email": "tomas@hoganas-mek.se", "primary": true}
    ]'::jsonb);`, /one main contact, and this list has 2/);
  assert.ok(!/index|constraint|duplicate key/.test(two),
    `the refusal should be readable, not the name of an index: ${two}`);
  assert.match(two, /Höganäs Mekaniska AB/, 'and it should say which customer');

  // The important half: a refused list leaves the old one exactly as it was, not half of it. The
  // function deletes before it inserts, so without the transaction this is how the contacts vanish.
  assert.equal(value(`SELECT count(*) FROM customer_contact WHERE customer_id = ${customer};`), '2',
    'a refused list must leave the contacts that were there, not half of them and not none');
  assert.equal(value(`SELECT string_agg(name, ',' ORDER BY name) FROM customer_contact
    WHERE customer_id = ${customer};`), 'Erik Lund,Sara Nyberg');
  step('Customers: a refused contact list leaves the old one exactly as it was — not half of it');

  const unreachable = refused('a contact nobody can reach', 'varmak_office', office,
    `SELECT set_customer_contacts(${customer}, '[{"name": "Nils Berg", "role": "Accounts"}]'::jsonb);`,
    /Nils Berg.*email or a telephone/);
  assert.ok(!/check constraint/.test(unreachable), 'the person has to be named, not the constraint');
  refused('a contact with no name', 'varmak_office', office,
    `SELECT set_customer_contacts(${customer}, '[{"email": "who@hoganas-mek.se"}]'::jsonb);`,
    /a contact needs a name/);
  refused('contacts that are not a list', 'varmak_office', office,
    `SELECT set_customer_contacts(${customer}, '{"name": "Erik"}'::jsonb);`, /arrive as a list/);
  refused('contacts for a customer that does not exist', 'varmak_office', office,
    `SELECT set_customer_contacts(999999, '[]'::jsonb);`, /no such customer/);
  refused('a welder rewriting the contacts', 'varmak_workshop', PEOPLE.welder,
    `SELECT set_customer_contacts(${customer}, '[]'::jsonb);`, /permission denied/);
  assert.equal(value(`SELECT count(*) FROM customer_contact WHERE customer_id = ${customer};`), '2');
  step('Customers: every refusal names the person or the customer, and none of them changes anything');

  // Clearing the list is a thing somebody does, and has to be allowed.
  assert.equal(ok('emptying the list', 'varmak_office', office,
    `SELECT set_customer_contacts(${customer}, '[]'::jsonb);`), '0');
  assert.equal(value(`SELECT count(*) FROM customer_contact WHERE customer_id = ${customer};`), '0');
  assert.equal(value(`SELECT detail FROM activity_log WHERE action = 'contacts changed'
    ORDER BY id DESC LIMIT 1;`), '0 contacts');
  step('Customers: and the list can be emptied, which is on the record like everything else');
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

// ── Quality: the hold register, inspections and non-conformances ───────────────────────────

// A hold is the only thing in this system that physically stops work leaving the building, so these
// are the workflows whose refusals matter most.
function aHoldIsThePointOfTheWholeThing() {
  const project = value(`INSERT INTO project (name, customer_id, status)
    VALUES ('Tank skid', (SELECT id FROM customer LIMIT 1), 'production') RETURNING id;`);
  const card = value(`INSERT INTO jobcard (project_id, title, status)
    VALUES (${project}, 'Weld the frame', 'in-progress') RETURNING id;`);

  refused('a hold naming nothing at all', 'varmak_office', PEOPLE.office,
    `SELECT place_hold(NULL, NULL, 'Something is wrong somewhere');`,
    /has to name a project or a jobcard/);
  refused('a hold that does not say what it is for', 'varmak_office', PEOPLE.office,
    `SELECT place_hold(${project}, NULL, '   ');`, /has to say what it is for/);

  const held = ok('holding the jobcard', 'varmak_office', PEOPLE.office,
    `SELECT place_hold(${project}, ${card}, 'Weld rejected on the root pass', 'critical',
       'Grind out, re-run and re-inspect', 'INS-2026-001');`);
  assert.match(held, /^HOLD-\d{4}-\d{3}$/);
  // Given both, it holds the narrower thing — and the row says so rather than the two disagreeing.
  assert.equal(value(`SELECT scope || ' ' || (jobcard_id IS NOT NULL) || ' ' || (project_id IS NULL)
    FROM quality_hold WHERE ref = '${held}';`), 'jobcard true true');
  step('Quality: a hold names one thing, says what it is for, and holds the narrower of the two');

  // The same hold asked for twice is one hold. Two rows saying one thing means releasing it leaves
  // the work still held by its twin, and nobody can see why.
  const again = ok('asking for the same hold again', 'varmak_office', PEOPLE.office,
    `SELECT place_hold(${project}, ${card}, 'Weld rejected on the root pass', 'critical');`);
  assert.equal(again, held, 'an identical active hold has to be the same hold');
  const another = ok('a second, different problem on the same jobcard', 'varmak_office', PEOPLE.office,
    `SELECT place_hold(${project}, ${card}, 'Material certificate missing for heat 4471');`);
  assert.notEqual(another, held, 'a different reason is a different hold');
  assert.equal(value(`SELECT count(*) FROM quality_hold WHERE jobcard_id = ${card} AND status = 'active';`), '2');
  step('Quality: the same hold twice is one hold; a different reason is a hold of its own');

  // What the hold is actually for: the work cannot be finished while it stands.
  refused('completing held work', 'varmak_office', PEOPLE.office,
    `UPDATE jobcard SET status = 'completed' WHERE id = ${card};`, /quality hold/);

  const holdId = value(`SELECT id FROM quality_hold WHERE ref = '${held}';`);
  refused('releasing it on nobody’s authority', 'varmak_office', PEOPLE.office,
    `SELECT release_hold(${holdId}, '  ', 'Looks fine');`, /authorised approval and written evidence/);
  refused('releasing it with no evidence of what was resolved', 'varmak_office', PEOPLE.office,
    `SELECT release_hold(${holdId}, 'Lars Holm', '');`, /authorised approval and written evidence/);
  refused('a welder releasing it', 'varmak_workshop', PEOPLE.welder,
    `SELECT release_hold(${holdId}, 'Marko Ilic', 'I had another look');`, /permission denied/);
  ok('the office releasing it', 'varmak_office', PEOPLE.office,
    `SELECT release_hold(${holdId}, 'Lars Holm', 'Ground out, re-run, PT accepted to level B');`);
  refused('releasing it a second time', 'varmak_office', PEOPLE.office,
    `SELECT release_hold(${holdId}, 'Somebody Else', 'And again');`, /already been released/);
  assert.equal(value(`SELECT release_authority FROM quality_hold WHERE ref = '${held}';`), 'Lars Holm',
    'a second release would restamp the record with the wrong name');
  step('Quality: a release takes a named authority and written evidence, once, and only from the office');

  // And the other hold is still standing, which is why releasing one is not releasing the work.
  refused('completing the work with the other hold still on', 'varmak_office', PEOPLE.office,
    `UPDATE jobcard SET status = 'completed' WHERE id = ${card};`, /quality hold/);
  ok('releasing the second one too', 'varmak_office', PEOPLE.office,
    `SELECT release_hold((SELECT id FROM quality_hold WHERE ref = '${another}'), 'Lars Holm',
       'Certificate found and filed against the heat');`);
  // Through inspection, because the transition rulebook says so: from in-progress a jobcard may only
  // become blocked, paused or inspection. Two gates, and the hold is the one that was being tested.
  ok('and now the work can be finished', 'varmak_office', PEOPLE.office,
    `UPDATE jobcard SET status = 'inspection' WHERE id = ${card};
     UPDATE jobcard SET status = 'completed' WHERE id = ${card};`);
  step('Quality: releasing one hold does not release the work — every hold on it has to come off');

  return { project, card };
}

// An inspection is asked for, then answered. The two are separate calls because a form that could
// arrive already passed is a form for passing work without looking at it.
function anInspectionIsAskedForThenAnswered(w) {
  const card = value(`INSERT INTO jobcard (project_id, title, status)
    VALUES (${w.project}, 'Weld the nozzles', 'in-progress') RETURNING id;`);

  refused('an inspection of nothing', 'varmak_office', PEOPLE.office,
    `SELECT save_inspection(NULL, NULL, NULL, 'welding', NULL, NULL, NULL, NULL, NULL, NULL,
       false, false, current_date);`, /has to be of something/);
  refused('an inspection with no date it is planned for', 'varmak_office', PEOPLE.office,
    `SELECT save_inspection(NULL, ${w.project}, ${card}, 'welding');`, /needs a date it is planned for/);
  refused('an inspection that does not say what kind of check it is', 'varmak_office', PEOPLE.office,
    `SELECT save_inspection(NULL, ${w.project}, ${card}, '  ', NULL, NULL, NULL, NULL, NULL, NULL,
       false, false, current_date);`, /what kind of check/);

  const ins = ok('raising one', 'varmak_office', PEOPLE.office,
    `SELECT save_inspection(NULL, ${w.project}, ${card}, 'welding', 'Nozzle N2 root pass',
       'Nozzle N2', 'BR-4410', 'C', 'visual + PT', 'ISO 5817 level B', true, true, current_date,
       'Marko Ilic', 'requested', 'Customer attending');`);
  assert.equal(value(`SELECT result || ' ' || status FROM inspection WHERE id = ${ins};`),
    'pending completed'.replace('completed', 'requested'),
    'a request arrives undecided, whatever else it carries');
  step('Quality: an inspection is raised against real work, to a criterion, and arrives undecided');

  refused('completing it with no result', 'varmak_workshop', PEOPLE.welder,
    `SELECT complete_inspection(${ins}, 'pending');`, /takes a result/);
  refused('passing it with observations and no observation', 'varmak_workshop', PEOPLE.welder,
    `SELECT complete_inspection(${ins}, 'passed-observations', '   ');`,
    /something to say/);
  refused('completing it on a day that has not arrived', 'varmak_workshop', PEOPLE.welder,
    `SELECT complete_inspection(${ins}, 'passed', 'Fine', false, NULL, current_date + 1);`,
    /has not arrived/);

  // A welder records what they found, the checklist goes in with it, and a critical failure puts the
  // hold on inside the same transaction.
  const answer = ok('a welder recording a critical failure', 'varmak_workshop', PEOPLE.welder,
    `SELECT complete_inspection(${ins}, 'failed', 'Porosity beyond level B in the root', true,
       '[{"item":"Weld cap profile","result":"pass"},
         {"item":"Root penetration","result":"fail"},
         {"item":"Overall length","nominal":2400,"lower":-2,"upper":2,"actual":2401.5},
         {"item":"","result":"pass"}]'::jsonb);`);
  const held = JSON.parse(answer).hold;
  assert.match(held, /^HOLD-\d{4}-\d{3}$/, 'a critical failure has to put a hold on by itself');
  assert.equal(value(`SELECT count(*) FROM inspection_check WHERE inspection_id = ${ins};`), '3',
    'the nameless line is not evidence of anything and is dropped');
  assert.equal(value(`SELECT jobcard_id = ${card} FROM quality_hold WHERE ref = '${held}';`), 't');
  assert.equal(value(`SELECT related_ref = (SELECT ref FROM inspection WHERE id = ${ins})
    FROM quality_hold WHERE ref = '${held}';`), 't', 'the hold has to say which inspection caused it');
  // Its own history, too. Without this entry the holds with the least explanation on the screen would
  // be exactly the ones that matter most — an office hold shows who applied it and why, and an
  // automatic one would show an empty panel.
  assert.equal(value(`SELECT action || '|' || actor FROM activity_log
    WHERE entity = 'quality_hold'
      AND entity_id = (SELECT id FROM quality_hold WHERE ref = '${held}');`), 'applied|Marko Ilic',
    'a hold placed by the system still says who was standing there and why');
  step('Quality: the floor records what it found, with its evidence, and a critical failure holds the work');

  // The name on a completed inspection is whoever was signed in, not whoever the request named.
  assert.equal(value(`SELECT inspector FROM inspection WHERE id = ${ins};`), 'Marko Ilic');
  const byPetra = value(`INSERT INTO inspection (project_id, jobcard_id, kind, inspector, planned_date)
    VALUES (${w.project}, ${card}, 'visual', 'Somebody Else', current_date) RETURNING id;`);
  ok('another welder completing an inspection planned for a third person', 'varmak_workshop',
    PEOPLE.other, `SELECT complete_inspection(${byPetra}, 'passed', 'Acceptable');`);
  assert.equal(value(`SELECT inspector FROM inspection WHERE id = ${byPetra};`), 'Petra Nilsson',
    'a result carries the name of whoever recorded it, never the name on the request');
  step('Quality: a result is signed by whoever was signed in, not by the name typed on the request');

  // A failure that is not critical does not hold the work. The hold is what a critical failure means,
  // and a system that held every rejected weld would have a hold register nobody reads.
  const ordinary = value(`INSERT INTO inspection (project_id, jobcard_id, kind, inspector, planned_date)
    VALUES (${w.project}, ${card}, 'visual', 'Inspector', current_date) RETURNING id;`);
  const held_before = value(`SELECT count(*) FROM quality_hold;`);
  const quiet = ok('a welder recording an ordinary failure', 'varmak_workshop', PEOPLE.welder,
    `SELECT complete_inspection(${ordinary}, 'failed', 'Undercut, to be dressed back', false);`);
  assert.equal(JSON.parse(quiet).hold, null, 'only a critical failure puts a hold on');
  assert.equal(value(`SELECT count(*) FROM quality_hold;`), held_before,
    'and nothing was written to the hold register at all');
  step('Quality: an ordinary failure is recorded and holds nothing — the hold is what critical means');

  refused('answering it a second time', 'varmak_workshop', PEOPLE.welder,
    `SELECT complete_inspection(${ins}, 'passed', 'Had another look');`, /already decided/);
  refused('editing what it was measured against now that it has a result', 'varmak_office', PEOPLE.office,
    `SELECT save_inspection(${ins}, ${w.project}, ${card}, 'welding', NULL, NULL, 'BR-9999', 'D',
       NULL, 'Whatever looks alright', false, false, current_date);`, /already has a result/);
  step('Quality: a decided inspection is not edited — not its result and not the standard behind it');

  // The second look. A copy with the verdicts cleared, pointing back at the failure it repeats.
  const second = ok('raising the re-inspection', 'varmak_office', PEOPLE.office,
    `SELECT create_reinspection(${ins});`);
  assert.equal(value(`SELECT result || ' ' || status FROM inspection WHERE id = ${second};`),
    'pending planned');
  assert.equal(value(`SELECT reinspection_of = ${ins} FROM inspection WHERE id = ${second};`), 't');
  assert.equal(value(`SELECT acceptance_criteria || ' / ' || drawing_rev FROM inspection WHERE id = ${second};`),
    'ISO 5817 level B / C', 'the second look is measured against the same standard as the first');
  assert.equal(value(`SELECT count(*) FROM inspection_check WHERE inspection_id = ${second};`), '3');
  assert.equal(value(`SELECT count(*) FROM inspection_check
    WHERE inspection_id = ${second} AND (result IS NOT NULL OR actual IS NOT NULL);`), '0',
    'a re-inspection that arrives carrying the first inspection’s answers is the whole failure this record exists to prevent');
  assert.equal(value(`SELECT count(*) FROM inspection_check
    WHERE inspection_id = ${second} AND nominal IS NOT NULL AND tol_upper IS NOT NULL;`), '1',
    'the band it is measured against comes across; only the reading is cleared');
  refused('repeating an inspection nobody has decided yet', 'varmak_office', PEOPLE.office,
    `SELECT create_reinspection(${second});`, /has not been decided yet/);
  step('Quality: a re-inspection repeats the check and clears every answer, keeping the band');

  return { card, failed: ins };
}

// The life of a non-conformance. One function moves it along, because six would be six places
// deciding what follows what.
function aNonConformanceLivesItsWholeLife(w) {
  refused('an NCR with nothing wrong with it', 'varmak_office', PEOPLE.office,
    `SELECT save_ncr(NULL, 'Something', ${w.project}, NULL, 'welding', 'minor', '   ', 'Lars Holm');`,
    /description of what is wrong/);
  refused('an NCR nobody is answerable for', 'varmak_office', PEOPLE.office,
    `SELECT save_ncr(NULL, 'Something', ${w.project}, NULL, 'welding', 'minor', 'Porosity', '  ');`,
    /somebody answerable/);
  refused('a major NCR with no date it must be answered by', 'varmak_office', PEOPLE.office,
    `SELECT save_ncr(NULL, 'Porosity', ${w.project}, NULL, 'welding', 'major', 'In the root pass',
       'Lars Holm');`, /needs a date by which it is answered/);

  const raised = JSON.parse(ok('raising a major one', 'varmak_office', PEOPLE.office,
    `SELECT save_ncr(NULL, 'Porosity beyond level B', ${w.project}, NULL, 'welding', 'major',
       'Found on the nozzle weld during PT', 'Lars Holm', current_date + 14, 'Nozzle N2 root pass',
       'Nozzle N2', 'S355J2 10mm', (SELECT id FROM supplier LIMIT 1));`));
  assert.match(raised.ncr, /^NCR-\d{4}-\d{3}$/);
  assert.equal(raised.hold, null, 'only a critical one holds the work by itself');
  // Who found it is the session, never the form. The screen that raises these had the name written
  // into the page, so every NCR would have been found by the same person.
  assert.equal(value(`SELECT detected_by FROM ncr WHERE ref = '${raised.ncr}';`), 'Lars Holm');
  step('Quality: an NCR is raised by whoever is signed in, against work, with a date it is answered by');

  const critical = JSON.parse(ok('raising a critical one', 'varmak_office', PEOPLE.office,
    `SELECT save_ncr(NULL, 'Root crack in the shell seam', ${w.project}, ${w.card}, 'welding',
       'critical', 'Crack found on radiography', 'Lars Holm', current_date + 3);`));
  assert.match(critical.hold, /^HOLD-\d{4}-\d{3}$/,
    'a critical non-conformance holds the work in the same transaction that raises it');
  assert.equal(value(`SELECT related_ref FROM quality_hold WHERE ref = '${critical.hold}';`),
    critical.ncr);
  step('Quality: a critical non-conformance puts the hold on itself, rather than waiting for a second call');

  const id = value(`SELECT id FROM ncr WHERE ref = '${raised.ncr}';`);
  refused('a step that does not exist', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'sort-it-out', 'Somehow');`, /no such step/);
  refused('a blank containment', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'containment', '  ');`, /cannot be blank/);
  assert.equal(ok('recording the containment', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'containment',
       'Nozzle quarantined on the rack; welder stood down from the seam');`),
    'under-investigation');

  refused('closing it with nothing verified', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'close', 'QM-2026-14');`, /nothing verified/);
  refused('using the part as it is with nobody signing for it', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'disposition', 'use-as-is');`, /has to be signed for/);
  assert.equal(ok('deciding it is reworked', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'disposition', 'rework');`), 'corrective-action');
  assert.equal(ok('naming the corrective action', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'corrective-action', 'CAPA-2026-007');`), 'corrective-action');
  refused('verifying nothing', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'verify', '');`, /what was checked/);
  assert.equal(ok('recording the verification', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'verify', 'Re-run and PT accepted to level B', 'Anna Berg');`),
    'waiting-verification');
  assert.equal(value(`SELECT verified_by FROM ncr WHERE id = ${id};`), 'Anna Berg');
  refused('closing it with no approval reference', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'close', '   ');`, /closure approval reference/);
  assert.equal(ok('closing it', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'close', 'QM-2026-14');`), 'closed');
  assert.equal(value(`SELECT closed_on = current_date FROM ncr WHERE id = ${id};`), 't');
  step('Quality: contained, dispositioned, answered, verified, closed — in that order or not at all');

  refused('changing a closed one', 'varmak_office', PEOPLE.office,
    `SELECT save_ncr(${id}, 'Something milder', ${w.project}, NULL, 'welding', 'minor',
       'On reflection it was fine', 'Lars Holm');`, /closed — reopen it/);
  refused('moving a closed one on', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'containment', 'Actually we did something else');`,
    /closed — reopen it first/);
  refused('reopening it for no reason', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'reopen', '');`, /takes a reason/);
  assert.equal(ok('reopening it when the fault comes back', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'reopen', 'Same porosity on the next two nozzles');`), 'reopened');
  // The closure comes off with it. Left standing, the record reads as approved and open at once.
  assert.equal(value(`SELECT coalesce(closure_approval, 'none') || ' ' || coalesce(closed_on::text, 'none')
    FROM ncr WHERE id = ${id};`), 'none none');
  ok('and it can be worked on again', 'varmak_office', PEOPLE.office,
    `SELECT record_ncr_step(${id}, 'containment', 'All remaining nozzles quarantined');`);
  step('Quality: a reopened non-conformance loses its closure, so nothing reads as approved and open at once');

  // Notes go into the audit trail, which is append-only by trigger.
  refused('an empty note', 'varmak_office', PEOPLE.office,
    `SELECT add_quality_note('ncr', ${id}, '   ');`, /not a note/);
  refused('a note on something that is not a quality record', 'varmak_office', PEOPLE.office,
    `SELECT add_quality_note('jobcard', ${w.card}, 'Hello');`, /inspection, an NCR or a hold/);
  refused('a note on a record that is not there', 'varmak_office', PEOPLE.office,
    `SELECT add_quality_note('ncr', 99999, 'Hello');`, /no such ncr/);
  const note = ok('a note on the NCR', 'varmak_office', PEOPLE.office,
    `SELECT add_quality_note('ncr', ${id}, 'Customer told on the telephone; expects a report');`);
  // Two answers, and either is the right one: the office holds no UPDATE on the trail at all, and
  // behind that a trigger refuses the statement even for a role that did.
  refused('editing it afterwards', 'varmak_office', PEOPLE.office,
    `UPDATE activity_log SET detail = 'Never mind' WHERE id = ${note};`,
    /append-only|permission denied/);
  refused('and not even the owner of the database can', null, PEOPLE.office,
    `UPDATE activity_log SET detail = 'Never mind' WHERE id = ${note};`, /append-only/);
  assert.equal(value(`SELECT actor FROM activity_log WHERE id = ${note};`), 'Lars Holm');
  step('Quality: a note is written into the append-only trail, under the name of whoever wrote it');
}

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
  const work = workReachesTheFloor();
  theEngineWritesOnlyWhatItMust();
  theRegisterOfMachinesAndWhatHappensToThem();
  theStoreCanBeStockedAndCounted();
  theStepsRememberTheWorkDoneOnThem(work);
  // Before the people tests, which rebuild app_user from scratch: these run as the office and the
  // floor by id, and those ids stop meaning anybody once the list has been replaced.
  const q = aHoldIsThePointOfTheWholeThing();
  const insp = anInspectionIsAskedForThenAnswered(q);
  aNonConformanceLivesItsWholeLife({ project: q.project, card: insp.card });
  const c = aCustomerCanBeMadeAndCorrected();
  theContactListIsReplacedAtomically(c);
  theFirstAdminAndEveryoneAfter();
  theListSaysWhoCanActuallyGetIn();
  nobodyCanLockTheWorkshopOut();

  console.log(`\n${checks} checks: ${attempts.refused} things refused, ${attempts.allowed} allowed.`);
}

main().catch((error) => {
  console.error(`\n${error.message || error}`);
  process.exitCode = 1;
});
