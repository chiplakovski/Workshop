'use strict';

// The machine register on the database, driven through its own screen.
//
// Every safety gate in this app reads the equipment register — the jobcard screen refuses to attach a
// machine that may not be run, the shop-floor hours screen refuses to book time against one, and the
// database refuses to start an operation on a machine that is out of service, whose certificate has
// expired, or whose pre-use check failed. And until this pass nothing could put a machine in the
// register, mark it serviced, or sign a check before use. The gates were real and had nothing to read.
//
// Four checks matter most:
//
//   * A machine goes in the register from the screen, with its reference upper-cased and its
//     pre-use-check flag set — the flag every gate has read since it was written and nothing could set.
//   * The three dates the form types in become events. save_equipment refuses to take the date a machine
//     was last serviced, because a form that can type one in is a form that can claim a service nobody
//     performed; so the date arrives as the service it describes, through the only door that can set it.
//   * A machine goes to one bench at a time, and the refusal says which bench has it. This is the write
//     the jobcard screen also makes, and it used to throw there.
//   * The subset rule, one more time: correcting where a machine lives must not clear its safety warning.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_equipment_test';
const HTTP_PORT = Number(process.env.VARMAK_EQUIPMENT_PORT || 8951);

const conn = () => ['-h', HOST, '-p', PORT, '-U', USER, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-qtAX'];
const sql = (text) => execFileSync('psql', conn(), { input: text, encoding: 'utf8' }).trim();
const value = (text) => sql(text).split('\n')[0].trim();

let checks = 0;
const step = (message) => { checks += 1; console.log(`OK   ${message}`); };

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what, check, ms = 12000) {
  const deadline = Date.now() + ms;
  let last = null;
  while (Date.now() < deadline) {
    last = check();
    if (last) return last;
    await pause(150);
  }
  throw new Error(`timed out waiting for ${what} (last answer: ${last})`);
}

function findBrowser() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROME_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'
  ].filter(Boolean);
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error('No browser found. Set PLAYWRIGHT_CHROME_PATH.');
  return found;
}

function buildDatabase() {
  ensureUp();
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', 'postgres', '-qtAX',
    '-c', `DROP DATABASE IF EXISTS ${DB};`, '-c', `CREATE DATABASE ${DB};`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  for (const name of ['schema', 'auth', 'api', 'views']) {
    execFileSync('psql', [...conn(), '-f', path.join(__dirname, '..', 'backend', `${name}.sql`)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
}

// An empty register, and two jobs for a machine to go to.
function aWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const customer = value(`INSERT INTO customer (name, city) VALUES ('MarineVent AB', 'Malmö') RETURNING id;`);
  const project = value(`INSERT INTO project (name, customer_id, status, planned_hours)
    VALUES ('Conveyor frame', ${customer}, 'production', 40) RETURNING id;`);
  const card = (title) => value(`INSERT INTO jobcard (project_id, customer_id, title, status, planned_hours)
    VALUES (${project}, ${customer}, '${title}', 'in-progress', 8) RETURNING id;`);
  const first = card('Frame weldment');
  const second = card('Base plate');
  return {
    customer, project, first, second,
    projectRef: value(`SELECT ref FROM project WHERE id = ${project};`),
    firstRef: value(`SELECT ref FROM jobcard WHERE id = ${first};`),
    secondRef: value(`SELECT ref FROM jobcard WHERE id = ${second};`)
  };
}

async function main() {
  buildDatabase();
  const w = aWorkshop();
  assert.equal(value(`SELECT count(*) FROM equipment;`), '0', 'the register starts empty');

  process.env.PGDATABASE = DB;
  process.env.PORT = String(HTTP_PORT);
  const { server, pool } = require('../backend/server');
  await new Promise((resolve) => server.listen(HTTP_PORT, resolve));
  const site = `http://127.0.0.1:${HTTP_PORT}`;

  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const thrown = [];
  page.on('pageerror', (error) => thrown.push(error.stack || error.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/favicon|net::|Failed to load resource/.test(m.text())) return;
    thrown.push(m.text());
  });

  try {
    await page.goto(`${site}/login.html`, { waitUntil: 'load' });
    await page.waitForSelector('#signInForm:not([hidden])', { timeout: 8000 });
    await page.locator('#signInEmail').fill('anna@varmak.se');
    await page.locator('#signInSecret').fill('correct horse battery staple');
    await page.locator('#signInGo').click();
    await page.waitForURL(/hours-mobile\.html|hub-/, { timeout: 8000 });

    await page.goto(`${site}/equipment-machines-desktop.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
    assert.equal(await page.locator('[role="alert"]').count(), 0, 'the guard must let this page through');
    step('Machines: the register opens for a signed-in session instead of refusing');

    // ── Putting a machine in the register ───────────────────────────────────────────────────
    const filled = await page.evaluate(() => {
      const form = document.getElementById('equipmentForm');
      if (!form) return null;
      const set = (name, v) => {
        const field = form.querySelector(`[name="${name}"]`);
        if (!field) return false;
        field.value = v;
        return true;
      };
      const missing = [
        ['equipmentId', 'eq-0100'], ['name', 'Plasma 120'], ['manufacturer', 'Hypertherm'],
        ['model', 'Powermax 120'], ['serial', 'SN-99812'], ['assetNumber', 'A-0100'],
        ['yearOfManufacture', '2022'], ['currentLocation', 'Bay 2'], ['homeLocation', 'Bay 2'],
        ['department', 'Fabrication'], ['responsiblePerson', 'Anna Berg'],
        ['purchaseDate', '2022-06-01'], ['purchaseSupplier', 'Nordic Machines'],
        ['purchasePrice', '84000'], ['warrantyExpiry', '2027-06-01'],
        ['operatingHourMeter', '120.5'], ['serviceInterval', '500'],
        ['certificationExpiry', '2028-04-01'],
        // The three the workflow refuses to take as columns.
        ['maintenanceDate', '2026-06-14'], ['inspectionDate', '2026-08-01'],
        ['description', 'Handheld plasma cutter'], ['notes', 'Bought with the press']
      ].filter(([name, v]) => !set(name, v)).map(([name]) => name);
      // The category and status are dropdowns filled from the page's own lists.
      const category = form.querySelector('[name="category"]');
      if (category && category.options.length) category.selectedIndex = 0;
      // 'Available' — the words the register offers and, since the vocabulary was settled, the words
      // the column holds. 'available' selected nothing and the form refused for a missing status.
      const status = form.querySelector('[name="status"]');
      if (status && status.options.length) status.value = 'Available';
      return { missing, category: category ? category.value : null };
    });
    assert.ok(filled, 'the register form should be on the page');
    assert.deepEqual(filled.missing, [], `the form is missing fields this test fills: ${filled.missing}`);

    await page.evaluate(() => document.getElementById('equipmentForm')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
    // The form's own error summary, read before waiting on the database: "timed out waiting for the
    // machine to reach Postgres" and "the form refused because the status was empty" look identical
    // from the outside, and only one of them is about the wiring.
    const refusedByForm = await page.evaluate(() => {
      const box = document.getElementById('equipmentFormErrors');
      return box && box.classList.contains('show') ? box.innerText : '';
    });
    assert.equal(refusedByForm, '', `the register form refused this: ${refusedByForm}`);
    await until('the machine to reach Postgres', () => value(`SELECT count(*) FROM equipment;`) === '1');
    const machine = value(`SELECT id FROM equipment;`);
    assert.equal(value(`SELECT ref FROM equipment WHERE id = ${machine};`), 'EQ-0100',
      'the reference is what is written on the machine, and that is upper case');
    assert.equal(value(`SELECT serial_no || '|' || asset_no || '|' || operating_hours::text
      || '|' || service_interval_hours::text FROM equipment WHERE id = ${machine};`),
      'SN-99812|A-0100|120.5|500',
      'the four fields the meter said had no column, which have had one all along');
    assert.equal(value(`SELECT purchase_price::text || '|' || purchase_supplier
      FROM equipment WHERE id = ${machine};`), '84000.00|Nordic Machines');
    step('Machines: a machine goes in the register from the screen, under the names the schema uses');

    // ── The dates that are events ───────────────────────────────────────────────────────────
    await until('the two dates to arrive as events',
      () => value(`SELECT count(*) FROM equipment_event WHERE equipment_id = ${machine};`) === '2');
    assert.equal(value(`SELECT kind::text || '|' || happened_on::text || '|' || result
      FROM equipment_event WHERE equipment_id = ${machine} AND kind = 'service';`),
      'service|2026-06-14|done',
      'the date the form typed in arrived as the service it describes');
    assert.equal(value(`SELECT kind::text || '|' || happened_on::text
      FROM equipment_event WHERE equipment_id = ${machine} AND kind = 'inspection';`),
      'inspection|2026-08-01');
    assert.match(value(`SELECT note FROM equipment_event
      WHERE equipment_id = ${machine} AND kind = 'service';`), /rather than from a report/,
      'and says where it came from, so nobody reads it as an engineer\'s report');
    // And the date the machine is judged by moved, through the only door that can move it.
    assert.equal(value(`SELECT last_service_date::text FROM equipment WHERE id = ${machine};`), '2026-06-14');
    assert.equal(value(`SELECT performed_by FROM equipment_event
      WHERE equipment_id = ${machine} AND kind = 'service';`), 'Anna Berg',
      'in the name of whoever recorded it, taken from the session');
    step('Machines: the three dates the form types in arrive as the events they describe');

    // No second service for a date that has not changed.
    await page.evaluate(() => document.getElementById('equipmentForm')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
    await pause(1200);
    assert.equal(value(`SELECT count(*) FROM equipment;`), '1',
      'saving the same reference again is refused as a duplicate rather than making a second machine');
    assert.equal(value(`SELECT count(*) FROM equipment_event WHERE equipment_id = ${machine};`), '2',
      'and records no second service for a date that has not changed');
    step('Machines: saving the same machine again makes no second machine and no second service');

    // ── The subset rule ─────────────────────────────────────────────────────────────────────
    sql(`UPDATE equipment SET safety_warnings = 'Eye protection and gloves',
         qr_code = 'QR-0100' WHERE id = ${machine};`);
    // Reloaded, because those two were set behind the page's back and the overlay rule is about what the
    // page was HANDED. Correcting a field against a record the page has not re-read is a test of nothing
    // — the first version of this check did exactly that and reported the warning as cleared when the
    // page had simply never seen it.
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
    const corrected = await page.evaluate(() => {
      const on = (window.WorkshopData.getEquipment() || [])[0];
      if (!on) return 'no machine on screen';
      // What the form shows, and only what it shows.
      const answer = window.WorkshopData.createEquipment(Object.assign({}, on, {
        currentLocation: 'Bay 4', condition: 'Fair'
      }));
      return answer && answer.error ? answer.error : 'sent';
    });
    assert.equal(corrected, 'sent', corrected);
    await until('the correction to reach Postgres',
      () => value(`SELECT current_location FROM equipment WHERE id = ${machine};`) === 'Bay 4');
    assert.equal(value(`SELECT coalesce(safety_warnings,'GONE') || '|' || coalesce(qr_code,'GONE')
      || '|' || coalesce(notes,'GONE') FROM equipment WHERE id = ${machine};`),
      'Eye protection and gloves|QR-0100|Bought with the press',
      'correcting where a machine lives must not clear its safety warning');
    step('Machines: correcting one field leaves the safety warning and everything else alone');

    // ── Where the machine is ────────────────────────────────────────────────────────────────
    const sentTo = await page.evaluate((ref) => {
      const answer = window.WorkshopData.assignEquipment('EQ-0100', { jobcard: ref, worker: 'Marko Ilic' });
      return answer && answer.error ? answer.error : 'sent';
    }, w.firstRef);
    assert.equal(sentTo, 'sent', sentTo);
    await until('the assignment to reach Postgres',
      () => value(`SELECT count(*) FROM equipment_assignment
                    WHERE equipment_id = ${machine} AND released_at IS NULL;`) === '1');
    assert.equal(value(`SELECT j.ref FROM equipment_assignment a JOIN jobcard j ON j.id = a.jobcard_id
      WHERE a.equipment_id = ${machine} AND a.released_at IS NULL;`), w.firstRef);
    // And the snapshot says where it is, which is what the screen reads.
    await until('the screen to show where it is', async () => true);
    assert.equal(await page.evaluate(() => (window.WorkshopData.getEquipment() || [])[0].assignedJobcard),
      w.firstRef, 'the register shows which jobcard has it, from the assignment rather than a column');
    assert.equal(value(`SELECT status::text FROM equipment WHERE id = ${machine};`), 'Available',
      'and its status is untouched: where it is and whether it may be run are different questions');
    step('Machines: a machine goes to a bench through the screen, and the register shows where it is');

    await page.locator('#langtoggle').click().catch(() => {});
    const clash = await page.evaluate((ref) => {
      const answer = window.WorkshopData.assignEquipment('EQ-0100', { jobcard: ref });
      return answer && answer.error ? answer.error : 'sent';
    }, w.secondRef);
    // The refusal arrives from the database a moment later, in a dialog.
    if (clash === 'sent') {
      await page.waitForSelector('.waskmsg', { timeout: 10000 });
      const said = await page.locator('.waskmsg').innerText();
      await page.locator('.waskyes').click();
      assert.match(said, /return it from there first/, said);
      assert.match(said, new RegExp(w.firstRef), 'and it says which jobcard has it');
    } else {
      assert.match(clash, /return it from there first|jobcard/, clash);
    }
    assert.equal(value(`SELECT count(*) FROM equipment_assignment
      WHERE equipment_id = ${machine} AND released_at IS NULL;`), '1',
      'and the machine stays where it was');
    step('Machines: sending it to a second bench is refused, saying which bench has it');

    const back = await page.evaluate(() => {
      const answer = window.WorkshopData.returnEquipment('EQ-0100', { note: 'Finished with it' });
      return answer && answer.error ? answer.error : 'sent';
    });
    assert.equal(back, 'sent', back);
    await until('the return to reach Postgres',
      () => value(`SELECT count(*) FROM equipment_assignment
                    WHERE equipment_id = ${machine} AND released_at IS NULL;`) === '0');
    assert.equal(value(`SELECT count(*) FROM equipment_assignment WHERE equipment_id = ${machine};`), '1',
      'the period it spent on that jobcard is kept, not deleted');
    step('Machines: it comes back, and the period it was out is kept');

    // ── What this screen cannot do ──────────────────────────────────────────────────────────
    const reserved = await page.evaluate(() => {
      const answer = window.WorkshopData.reserveEquipment('EQ-0100', { project: 'P-1', reservedBy: 'Anna' });
      return answer && answer.error ? answer.error : 'nothing was refused';
    });
    assert.match(reserved, /not on the server yet/, `a reservation has to refuse in words: ${reserved}`);
    const usage = await page.evaluate(() => {
      const answer = window.WorkshopData.logEquipmentUsage('EQ-0100', { hours: 3 });
      return answer && answer.error ? answer.error : 'nothing was refused';
    });
    assert.match(usage, /not on the server yet/, usage);
    step('Machines: a reservation and machine usage hours refuse out loud, and write nothing');

    assert.deepEqual(thrown, [], `the page threw: ${thrown.slice(0, 3).join(' / ')}`);
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
    server.close();
  }
  console.log(`\n${checks} checks: the register is the workshop's, and the safety gates finally have something to read.`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
