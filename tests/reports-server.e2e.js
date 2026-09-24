'use strict';

// The six reports, read from the database.
//
// Reports was one of the screens a signed-in session could not see at all, which meant a workshop on
// the database could book hours and had no way to ask where they went. Wiring it is reading: getData()
// already goes through WorkshopData.get(), so a snapshot makes every figure the workshop's own.
//
// What makes this suite worth having is the half that cannot be answered yet. Three of the six reports
// stand on collections the snapshot does not carry — quotations, purchase orders and inspections — and
// left alone they would print "No quotations were accepted" to an office that has accepted several.
// That is a report lying with a straight face, and it is the one failure this project refuses. So each
// section asks whether its records are on the database at all and says so when they are not.
//
// It also asserts the figure that was wrong for as long as this page has existed: "Hours by project"
// read `h.projectNo` off a record that has only ever held `project`, so every project showed nothing
// logged against it while the hours sat in the record. Checked here against psql.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_reports_test';
const HTTP_PORT = Number(process.env.VARMAK_REPORTS_PORT || 8947);

const conn = () => ['-h', HOST, '-p', PORT, '-U', USER, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-qtAX'];
const sql = (text) => execFileSync('psql', conn(), { input: text, encoding: 'utf8' }).trim();
const value = (text) => sql(text).split('\n')[0].trim();

let checks = 0;
const step = (message) => { checks += 1; console.log(`OK   ${message}`); };

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

// A week of a real workshop: a job that is late, hours booked by two people, and one item below its
// minimum. Every figure the three answerable reports show can be checked by hand from this.
function aWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const customer = value(`INSERT INTO customer (name, city) VALUES ('MarineVent AB', 'Malmö') RETURNING id;`);
  const project = value(`INSERT INTO project (name, customer_id, status, planned_hours, deadline)
    VALUES ('Conveyor frame', ${customer}, 'production', 40, current_date - 3) RETURNING id;`);
  const jobcard = value(`INSERT INTO jobcard
    (project_id, customer_id, title, status, planned_hours, planned_completion)
    VALUES (${project}, ${customer}, 'Frame weldment', 'in-progress', 24, current_date - 2)
    RETURNING id;`);
  // On the shelf and below its minimum: 300 against a floor of 500. Set on the row rather than through
  // issue_stock, which refuses a negative quantity — it is an issue, not a receipt, and a seed is
  // neither.
  const item = value(`INSERT INTO stock_item (code, description, unit, min_stock, stock)
    VALUES ('S355-12', 'Plate S355J2 12mm', 'KG', 500, 300) RETURNING id;`);
  sql(`INSERT INTO hours_entry (jobcard_id, worker, hours, worked_on)
       VALUES (${jobcard}, 'Marko Ilic', 6.5, current_date),
              (${jobcard}, 'Marko Ilic', 4, current_date),
              (${jobcard}, 'Erik Sund', 3.5, current_date);`);
  return {
    customer, project, jobcard, item,
    ref: value(`SELECT ref FROM project WHERE id = ${project};`),
    stock: value(`SELECT stock::text FROM stock_item WHERE id = ${item};`)
  };
}

async function main() {
  buildDatabase();
  const w = aWorkshop();
  assert.equal(value(`SELECT sum(hours)::text FROM hours_entry;`), '14.00',
    'fourteen hours booked, which is what the report has to add up to');

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

  const show = async (section) => {
    await page.evaluate((s) => showSection(s), section);
    await page.waitForTimeout(120);
  };
  const text = (id) => page.locator(`#${id}`).innerText();

  try {
    await page.goto(`${site}/login.html`, { waitUntil: 'load' });
    await page.waitForSelector('#signInForm:not([hidden])', { timeout: 8000 });
    await page.locator('#signInEmail').fill('anna@varmak.se');
    await page.locator('#signInSecret').fill('correct horse battery staple');
    await page.locator('#signInGo').click();
    await page.waitForURL(/hours-mobile\.html|hub-/, { timeout: 8000 });

    await page.goto(`${site}/reports-desktop.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
    assert.equal(await page.locator('[role="alert"]').count(), 0, 'the guard must let this page through');
    step('Reports: signed in, the reports open instead of refusing');

    // ── Where the hours went ────────────────────────────────────────────────────────────────
    await show('hours');
    assert.match(await text('hrs-logged'), /14/, 'the hours logged are the database\'s own sum');
    assert.match(await text('hrs-planned'), /40/);
    assert.equal(await text('hrs-workers'), '2', 'two people booked time, which the entries say');
    assert.equal(await text('hrs-entries'), '3');
    const byWorker = await text('hrs-worker-body');
    assert.match(byWorker, /Marko Ilic/, 'and each worker is named from the entry the server recorded');
    assert.match(byWorker, /10\.5/, 'with their own total — 6.5 and 4 booked by the same person');
    assert.match(byWorker, /Erik Sund/);
    // The figure that was wrong for as long as this page existed.
    const byProject = await text('hrs-project-body');
    assert.match(byProject, new RegExp(w.ref), 'the project is listed');
    assert.match(byProject, /14/,
      'and the hours booked against it are shown — this read h.projectNo off a record that only ever '
      + 'held h.project, so this column was blank for every project in the app');
    step('Reports: where the hours went is the database\'s, and hours by project finally adds up');

    // ── What is late ────────────────────────────────────────────────────────────────────────
    await show('late');
    const late = await page.evaluate(() => document.getElementById('section-late').innerText);
    assert.match(late, new RegExp(w.ref), 'the project past its deadline is the workshop\'s own');
    assert.match(late, /Frame weldment/, 'and so is the jobcard past its own');
    step('Reports: what is late names the project and the jobcard that are actually past their dates');

    // ── What is low in stock ────────────────────────────────────────────────────────────────
    await show('stock');
    const stock = await page.evaluate(() => document.getElementById('section-stock').innerText);
    assert.match(stock, /S355-12/, 'the item below its minimum is the one on the shelf');
    assert.equal(w.stock, '300.000', 'which the database agrees is 300 against a floor of 500');
    step('Reports: what is low in stock is read from the shelf, not from this browser');

    // ── The three that cannot be answered yet ───────────────────────────────────────────────
    //
    // This is the check the suite exists for. "No quotations were accepted" and "these records are not
    // on the database yet" are different answers, and only one of them is true here.
    for (const [section, what] of [['won', 'quotations'], ['bought', 'purchase orders'], ['failed', 'inspections']]) {
      await show(section);
      const note = await page.locator(`#section-${section} .srvnote`).count();
      assert.equal(note, 1, `the ${what} report has to say its records are not on the database yet`);
      const said = await page.locator(`#section-${section} .srvnote`).innerText();
      assert.match(said, /not on the workshop database yet/, said);
      assert.match(said, /not saying the answer is none/,
        'and say plainly that it is not claiming the answer is nothing');
    }
    step('Reports: the three reports with no records on the database say so, instead of reporting none');

    // And the three that can be answered do NOT carry that note.
    for (const section of ['late', 'hours', 'stock']) {
      await show(section);
      assert.equal(await page.locator(`#section-${section} .srvnote`).count(), 0,
        `${section} can be answered from the database, so it must not be excused`);
    }
    step('Reports: and the three that can be answered carry no such note');

    // ── What this screen cannot write ───────────────────────────────────────────────────────
    const refused = await page.evaluate(() => {
      const answer = window.WorkshopData.saveReport({ name: 'Late jobs, weekly' });
      return answer && answer.error ? answer.error : 'nothing was refused';
    });
    assert.match(refused, /not on the server yet/, `saving a report has to refuse in words: ${refused}`);
    step('Reports: saving a report refuses out loud — it is a definition the office should share');

    // The last-used view is this browser's business, and must not be pushed at the data layer, which
    // would throw: a wired page that calls a mutator is exactly what the no-two-worlds guard refuses.
    await show('stock');
    const held = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('varmak.reports.config') || 'null'); }
      catch (e) { return null; }
    });
    assert.ok(held, 'the last-used view should be kept, and kept in this browser');
    assert.equal(held.section, 'stock');
    assert.deepEqual(thrown, [], `the page threw: ${thrown.slice(0, 3).join(' / ')}`);
    step('Reports: the last-used view is kept in this browser rather than pushed at the database');
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
    server.close();
  }
  console.log(`\n${checks} checks: the reports are the workshop's, and the ones that cannot answer say so.`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
