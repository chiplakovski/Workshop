'use strict';

// The store on the database, driven through its own buttons.
//
// Material could leave the shelf before this pass — issue_material_offline is what the shop tablet
// calls — but nothing could put an item on the shelf or record steel arriving. So a workshop could
// issue material it had no way of telling the system it had.
//
// Two checks matter most:
//   * Steel arriving twice at different prices leaves the average cost weighted by the shelf, which is
//     the difference between a store that can cost a job and one that can only say what the last load
//     cost. Driven from the receiving form, not from SQL.
//   * A count that finds the shelf right writes no movement, because a movement of nothing is noise in
//     the one place a storeman goes to find out why a figure changed.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_store_test';
const HTTP_PORT = Number(process.env.VARMAK_STORE_PORT || 8923);

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
    // Awaited, so a check that returns a promise is actually asked. Without this an async check
    // returns a truthy promise on the first pass and the wait is no wait at all — which is how one
    // assertion in this family passed on timing for weeks and then failed the day the snapshot grew.
    last = await check();
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

// A job for the steel to go to, and an empty store.
function aWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const customer = value(`INSERT INTO customer (name, city) VALUES ('MarineVent AB', 'Malmö') RETURNING id;`);
  const project = value(`INSERT INTO project (name, customer_id, status, planned_hours)
    VALUES ('Conveyor frame', ${customer}, 'production', 40) RETURNING id;`);
  const jobcard = value(`INSERT INTO jobcard (project_id, customer_id, title, status, planned_hours)
    VALUES (${project}, ${customer}, 'Frame weldment', 'in-progress', 24) RETURNING id;`);
  const item = value(`INSERT INTO stock_item (code, description, unit, min_stock, bin_code)
    VALUES ('S355-12', 'Plate S355J2 12mm', 'KG', 500, 'A1-01-02') RETURNING id;`);
  return { customer, project, jobcard, item,
    jobcardRef: value(`SELECT ref FROM jobcard WHERE id = ${jobcard};`),
    projectRef: value(`SELECT ref FROM project WHERE id = ${project};`) };
}

async function main() {
  buildDatabase();
  const w = aWorkshop();
  assert.equal(value(`SELECT stock::text FROM stock_item WHERE id = ${w.item};`), '0.000',
    'the shelf starts empty, because stock only arrives through a movement');

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

    await page.goto(`${site}/store-desktop.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
    assert.equal(await page.locator('[role="alert"]').count(), 0, 'the guard must let this page through');
    const shown = await page.evaluate(() => {
      const i = window.WorkshopData.get().inventory[0];
      return { code: i.code, description: i.description, stock: i.stock, bin: i.location,
               count: window.WorkshopData.get().inventory.length };
    });
    assert.equal(shown.count, 1);
    assert.equal(shown.code, 'S355-12');
    assert.equal(shown.stock, 0, 'nothing on the shelf yet, and the screen says so');
    assert.equal(shown.bin, 'A1-01-02', 'the bin is what the storeman reads off the label');
    step('Store: the screen reads the workshop\'s own items, with nothing on the shelf yet');

    // ── Steel arriving, from the receiving form ────────────────────────────────────────────
    await page.evaluate(() => showView('receiving'));
    // The label modal opens on a receipt when auto-print is on, and it covers the Confirm button — so
    // the second delivery could never be entered. Switched off here rather than closed each time,
    // because what this test is about is the receipt and not the label.
    await page.evaluate(() => { const box = document.getElementById('autoLabel'); if (box) box.checked = false; });
    await page.locator('#receiveItem').selectOption({ label: /S355-12/ }).catch(async () => {
      await page.selectOption('#receiveItem', 'S355-12');
    });
    await page.locator('#receiveQty').fill('50');
    await page.locator('#receivePrice').fill('14.00');
    await page.locator('#receiveSupplier').fill('Nordic Steel');
    await page.locator('#receiveDn').fill('DN-4471');
    await page.locator('#receiveHeat').fill('H240516');
    await page.locator('#confirmReceipt').click();
    await until('the first delivery to reach Postgres',
      () => value(`SELECT stock::text FROM stock_item WHERE id = ${w.item};`) === '50.000');
    assert.equal(value(`SELECT avg_cost::text FROM stock_item WHERE id = ${w.item};`), '14.00');
    assert.equal(value(`SELECT heat_no FROM stock_item WHERE id = ${w.item};`), 'H240516');
    assert.equal(value(`SELECT moved_by FROM stock_movement WHERE kind = 'receipt';`), 'Anna Berg',
      'the movement is signed by whoever was signed in, not by the name in the form');
    step('Store: steel entered on the form is on the shelf, and the movement is signed by the session');

    // The weighted average, driven from the form. Fifty at 14.00 plus fifty at 16.00 is a hundred at
    // 15.00 — not a hundred at 16.00, which is what a store that only remembers the last price says.
    await page.locator('#receiveQty').fill('50');
    await page.locator('#receivePrice').fill('16.00');
    await page.locator('#receiveDn').fill('DN-4492');
    await page.locator('#confirmReceipt').click();
    await until('the second delivery to reach Postgres',
      () => value(`SELECT stock::text FROM stock_item WHERE id = ${w.item};`) === '100.000');
    assert.equal(value(`SELECT avg_cost::text || '|' || last_price::text FROM stock_item
      WHERE id = ${w.item};`), '15.00|16.00',
      'the average is weighted by what was already on the shelf');
    step('Store: a second delivery at a different price leaves the average weighted, not replaced');

    // ── Taking it off the shelf, against a job ─────────────────────────────────────────────
    await page.evaluate(() => showView('issuing'));   // the page's own key for that view
    await page.evaluate((refs) => {
      document.getElementById('issueItem').value = 'S355-12';
      document.getElementById('issueProject').value = refs.project;
      document.getElementById('issueJobcard').value = refs.jobcard;
      document.getElementById('issueQty').value = '12';
    }, { project: w.projectRef, jobcard: w.jobcardRef });
    await page.locator('#confirmIssue').click();
    await until('the issue to reach Postgres',
      () => value(`SELECT stock::text FROM stock_item WHERE id = ${w.item};`) === '88.000');
    assert.equal(value(`SELECT (jobcard_id = ${w.jobcard})::text FROM stock_movement
      WHERE kind = 'issue';`), 'true', 'material is booked against a job, which is what makes it costable');
    assert.equal(value(`SELECT moved_by FROM stock_movement WHERE kind = 'issue';`), 'Anna Berg');
    step('Store: material leaves the shelf against the job, in the name of whoever issued it');

    // ── Counting it ────────────────────────────────────────────────────────────────────────
    await page.evaluate(() => showView('stockcount'));
    await page.evaluate(() => {
      document.getElementById('countCode').value = 'S355-12';
      document.getElementById('countQty').value = '86';
    });
    await page.evaluate(() => recordCount());
    await until('the count to reach Postgres',
      () => value(`SELECT stock::text FROM stock_item WHERE id = ${w.item};`) === '86.000');
    assert.equal(value(`SELECT quantity::text FROM stock_movement WHERE kind = 'adjustment';`), '2.000',
      'the difference is the movement, and it says which way');
    assert.match(value(`SELECT note FROM stock_movement WHERE kind = 'adjustment';`), /counted 86, was 88/);
    step('Store: a count corrects the shelf through a movement that says what it was and what it is');

    // Counted again and found right: no second movement, because a movement of nothing is noise in the
    // one place a storeman goes to find out why a figure changed.
    await page.evaluate(() => {
      document.getElementById('countCode').value = 'S355-12';
      document.getElementById('countQty').value = '86';
    });
    await page.evaluate(() => recordCount());
    await pause(1200);
    assert.equal(value(`SELECT count(*) FROM stock_movement WHERE kind = 'adjustment';`), '1',
      'finding the shelf right writes nothing');
    assert.equal(value(`SELECT stock::text FROM stock_item WHERE id = ${w.item};`), '86.000');
    step('Store: counting it again and finding it right writes no movement at all');

    // ── The movement log the store screen shows ────────────────────────────────────────────
    const log = await page.evaluate(() => (window.WorkshopData.get().movements || []).map((m) => m.action));
    assert.deepEqual(log, ['adjustment', 'issue', 'receipt', 'receipt'],
      'the screen can show why every figure changed, newest first — the panel was empty before this');
    step('Store: and the movement log on screen is the database\'s, newest first');

    // ── What has no workflow yet ───────────────────────────────────────────────────────────
    const said = await page.evaluate(() => window.WorkshopData.addOffcut({
      code: 'S355-12', grade: 'S355J2', dimensions: '400 × 300', source: 'P-2026-001'
    }));
    assert.ok(said && said.error, 'the offcut rack has no workflow, so the page must be told');
    assert.match(said.error, /does not exist on the server yet/);
    assert.equal(value(`SELECT count(*) FROM offcut;`), '0');
    step('Store: the offcut rack has no workflow yet, and the screen says so rather than losing it');

    assert.deepEqual([...new Set(thrown)], [], `the page threw: ${[...new Set(thrown)].join(' / ')}`);
    console.log(`\n${checks} checks: the store screen reads and writes Postgres, movements and all.`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`\n${error.message || error}`);
  process.exitCode = 1;
  process.exit(1);
});
