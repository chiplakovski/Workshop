'use strict';

// The desk half of the hours screen, on the database.
//
// Two screens book the same entries against the same jobcards — the phone one a welder uses at the
// machine, and this one at a desk. Only the phone half was wired, so an office signing in to enter a
// week of paper timesheets was shown a screen that refused to load.
//
// The one difference from the phone is deliberate and this suite asserts it: there is **no offline
// queue here**. The queue exists because a steel hall eats wifi and the welder is furthest from the
// router. At a desk an entry that cannot be sent says so on the spot with the form still filled in,
// which is better than a banner about work being held on a machine nobody carries anywhere.
//
// What it does share with the phone is the rule that matters most: the worker on an entry is the
// session, never the name on screen. This screen reads the name out of its own badge, so if the badge
// were still saying "Marko K." — as it did, written into the page — the office would be entering
// everybody's timesheets under a name the database would then ignore.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_hoursdesk_test';
const HTTP_PORT = Number(process.env.VARMAK_HOURSDESK_PORT || 8949);

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

function aWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const customer = value(`INSERT INTO customer (name, city) VALUES ('MarineVent AB', 'Malmö') RETURNING id;`);
  const project = value(`INSERT INTO project (name, customer_id, status, planned_hours)
    VALUES ('Conveyor frame', ${customer}, 'production', 40) RETURNING id;`);
  const jobcard = value(`INSERT INTO jobcard (project_id, customer_id, title, status, planned_hours)
    VALUES (${project}, ${customer}, 'Frame weldment', 'in-progress', 24) RETURNING id;`);
  const op = value(`INSERT INTO operation (jobcard_id, seq, description, status, planned_hours)
    VALUES (${jobcard}, 1, 'Cut and prepare', 'pending', 8) RETURNING id;`);
  return {
    customer, project, jobcard, op,
    projectRef: value(`SELECT ref FROM project WHERE id = ${project};`),
    ref: value(`SELECT ref FROM jobcard WHERE id = ${jobcard};`)
  };
}

async function main() {
  buildDatabase();
  const w = aWorkshop();

  process.env.PGDATABASE = DB;
  process.env.PORT = String(HTTP_PORT);
  const { server, pool } = require('../backend/server');
  await new Promise((resolve) => server.listen(HTTP_PORT, resolve));
  const site = `http://127.0.0.1:${HTTP_PORT}`;

  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const thrown = [];
  page.on('pageerror', (error) => thrown.push(error.stack || error.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/favicon|net::|Failed to load resource/.test(m.text())) return;
    thrown.push(m.text());
  });

  async function book(stepName, hours) {
    await page.locator('#project').selectOption(w.projectRef);
    await page.waitForFunction(() => document.querySelectorAll('#item option').length > 0, { timeout: 5000 });
    const picked = await page.evaluate((want) => {
      const item = document.getElementById('item');
      const at = [...item.options].findIndex((o) => o.textContent.trim() === want);
      if (at < 0) return false;
      item.selectedIndex = at;
      item.dispatchEvent(new Event('change'));
      return true;
    }, stepName);
    assert.ok(picked, `the Item list should offer "${stepName}"`);
    await page.locator('#hours').fill(String(hours));
    await page.locator('#saveEntry').click();
    await page.waitForSelector('.waskmsg', { timeout: 8000 });
    const said = await page.locator('.waskmsg').innerText();
    await page.locator('.waskyes').click();
    await page.waitForSelector('.waskwrap', { state: 'detached', timeout: 5000 });
    return said;
  }

  try {
    await page.goto(`${site}/login.html`, { waitUntil: 'load' });
    await page.waitForSelector('#signInForm:not([hidden])', { timeout: 8000 });
    await page.locator('#signInEmail').fill('anna@varmak.se');
    await page.locator('#signInSecret').fill('correct horse battery staple');
    await page.locator('#signInGo').click();
    await page.waitForURL(/hours-mobile\.html|hub-/, { timeout: 8000 });

    await page.goto(`${site}/hours-desktop.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
    assert.equal(await page.locator('[role="alert"]').count(), 0, 'the guard must let this page through');
    assert.equal(await page.locator('#whoName').innerText(), 'Anna Berg',
      'the badge is the session\'s, and this screen reads the worker off that label');
    step('Hours (desk): the screen opens for a signed-in session and says whose it is');

    const said = await book('Cut and prepare', 6.5);
    assert.match(said, /saved/i, `booking should be accepted: ${said}`);
    await until('the entry to reach Postgres', () => value(`SELECT count(*) FROM hours_entry;`) === '1');
    assert.equal(value(`SELECT worker || '|' || hours::text || '|' || operation_id::text FROM hours_entry;`),
      `Anna Berg|6.50|${w.op}`,
      'in the session\'s name, against the step that was picked');
    // The rolled-up figures the office reads are the trigger's, so they had to move with it.
    assert.equal(value(`SELECT logged_hours::text FROM operation WHERE id = ${w.op};`), '6.50');
    assert.equal(value(`SELECT used_hours::text FROM project WHERE id = ${w.project};`), '6.50');
    step('Hours (desk): the entry is in Postgres in the session\'s name, and the roll-ups followed it');

    // Nothing was written to this browser. Asked of localStorage rather than of WorkshopData, and the
    // difference is the whole point: the records in memory SHOULD hold that entry, because the page
    // re-read the snapshot and the database now has it. What must not happen is a copy being written
    // here as well — that is the two-worlds failure, and adopting a snapshot deliberately never writes.
    const inBrowser = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem(window.WorkshopData.key);
        return raw ? (JSON.parse(raw).hours || []).length : 0;
      } catch (e) { return -1; }
    });
    assert.equal(inBrowser, 0, 'the entry went to the database and nowhere else');
    assert.equal(await page.evaluate(() => (window.WorkshopData.get().hours || []).length), 1,
      'while the records on screen do hold it, because the page re-read the workshop afterwards');
    step('Hours (desk): and nothing was written to this browser alongside it');

    // ── What it will not do ─────────────────────────────────────────────────────────────────
    await page.evaluate(() => { const b = document.getElementById('addMat'); if (b) b.click(); });
    const withMaterial = await page.evaluate(() => {
      const row = document.querySelector('#matList .eqrow');
      if (!row) return false;
      row.querySelector('.matname').value = 'S355 plate';
      row.querySelector('.matqty').value = '12';
      return true;
    });
    if (withMaterial) {
      await page.locator('#project').selectOption(w.projectRef);
      await page.evaluate(() => {
        const item = document.getElementById('item');
        item.selectedIndex = 0;
        item.dispatchEvent(new Event('change'));
      });
      await page.locator('#hours').fill('2');
      await page.locator('#saveEntry').click();
      await page.waitForSelector('.waskmsg', { timeout: 8000 });
      const refusal = await page.locator('.waskmsg').innerText();
      await page.locator('.waskyes').click();
      assert.match(refusal, /not saved to the server yet/,
        `an entry carrying material must be held back and say so: ${refusal}`);
      assert.equal(value(`SELECT count(*) FROM hours_entry;`), '1',
        'and book nothing — the hours must not go in while the material is dropped');
      step('Hours (desk): an entry carrying material is held back and says what is missing');
    } else {
      assert.fail('the material row could not be added, so the half of this check that matters did not run');
    }

    // ── No queue here, and that is the decision rather than an omission ─────────────────────
    await page.route('**/api/rpc/book_hours', (route) => route.abort('internetdisconnected'));
    await page.evaluate(() => {
      document.querySelectorAll('#matList .eqrow').forEach((r) => r.remove());
    });
    await page.locator('#project').selectOption(w.projectRef);
    await page.evaluate(() => {
      const item = document.getElementById('item');
      item.selectedIndex = 0;
      item.dispatchEvent(new Event('change'));
    });
    await page.locator('#hours').fill('3');
    await page.locator('#saveEntry').click();
    await page.waitForSelector('.waskmsg', { timeout: 8000 });
    const offline = await page.locator('.waskmsg').innerText();
    await page.locator('.waskyes').click();
    assert.match(offline, /no connection/i, `a lost connection has to be said plainly: ${offline}`);
    assert.equal(value(`SELECT count(*) FROM hours_entry;`), '1', 'and nothing is booked');
    assert.equal(await page.evaluate(() => {
      try { return localStorage.getItem('varmak.queue'); } catch (e) { return null; }
    }), null, 'and nothing is queued: this screen is at a desk, and says so instead of holding work');
    assert.equal(await page.locator('#hours').inputValue(), '3',
      'the form still holds the entry, so pressing again is all it takes');
    await page.unroute('**/api/rpc/book_hours');
    step('Hours (desk): a lost connection is said plainly and the form keeps the entry — no queue here');

    assert.deepEqual(thrown, [], `the page threw: ${thrown.slice(0, 3).join(' / ')}`);
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
    server.close();
  }
  console.log(`\n${checks} checks: the desk hours screen books against the same database as the phone.`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
