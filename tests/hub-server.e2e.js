'use strict';

// The front door, which until now refused everybody who signed in.
//
// login.html sends anybody with a password to hub-desktop.html, and that page was not wired — so the
// guard covered it and the first thing this system did for a welder on their own phone was tell them
// the screen could not be shown. The phone hub was the other half of the same problem and worse: it
// loaded no data layer at all, so nothing guarded it and nothing could correct it, and it showed a
// name and the word **Admin** written into the page. A welder read "Aleksandar · Admin" on the only
// part of that screen that says whose session it is.
//
// Three checks matter most:
//
//   * The badge is the session's. Asked as two different people, on both hubs, because a badge that is
//     right for the first person who signs in and wrong for the second is the failure.
//   * The counts are the workshop's. And a collection the database does not serve yet reads as nothing
//     rather than as whatever is left in this browser.
//   * "Save a copy" and "Restore a copy" are not offered. They are operations on browser storage, and
//     on the server they would write a file called a backup that held nothing.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_hub_test';
const HTTP_PORT = Number(process.env.VARMAK_HUB_PORT || 8943);

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
    // Named from the environment when the mutation harness is driving, so a damaged copy of one backend
    // file is the one this suite builds against. Sixteen suites ignored this, which meant a mutation aimed
    // at any of them damaged a file nobody loaded: the suite passed, correctly, and the harness reported
    // MISSED — "this rule has no test" — when the test had never seen the damage. Two invoice-basis
    // mutations read that way before it was found.
    const file = process.env[`VARMAK_${name.toUpperCase()}`]
      || path.join(__dirname, '..', 'backend', `${name}.sql`);
    execFileSync('psql', [...conn(), '-f', file],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
}

// Two customers, one project, two jobcards, one stock item and an hours entry: enough that every
// count on the hub is a number somebody could check by hand.
function aWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const marko = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('marko@varmak.se', 'Marko Ilic', 'workshop') RETURNING id;`);
  sql(`SELECT set_password(${marko}, 'a long enough passphrase');`);
  const customer = value(`INSERT INTO customer (name, city, credit_limit)
    VALUES ('MarineVent AB', 'Malmö', 250000) RETURNING id;`);
  sql(`INSERT INTO customer (name, city) VALUES ('Nordvent AB', 'Lund');`);
  const project = value(`INSERT INTO project (name, customer_id, status, planned_hours)
    VALUES ('Conveyor frame', ${customer}, 'production', 40) RETURNING id;`);
  const jobcard = value(`INSERT INTO jobcard (project_id, customer_id, title, status, planned_hours)
    VALUES (${project}, ${customer}, 'Frame weldment', 'in-progress', 24) RETURNING id;`);
  sql(`INSERT INTO jobcard (project_id, customer_id, title, status, planned_hours)
    VALUES (${project}, ${customer}, 'Base plate', 'in-progress', 8);`);
  sql(`INSERT INTO stock_item (code, description, unit, min_stock)
    VALUES ('S355-12', 'Plate S355J2 12mm', 'KG', 500);`);
  sql(`INSERT INTO hours_entry (jobcard_id, worker, hours) VALUES (${jobcard}, 'Marko Ilic', 6.5);`);
  return { marko, customer, project, jobcard };
}

async function signIn(page, site, email, secret) {
  await page.goto(`${site}/login.html`, { waitUntil: 'load' });
  await page.waitForSelector('#signInForm:not([hidden])', { timeout: 8000 });
  await page.locator('#signInEmail').fill(email);
  await page.locator('#signInSecret').fill(secret);
  await page.locator('#signInGo').click();
  await page.waitForURL(/hours-mobile\.html|hub-/, { timeout: 8000 });
}

const badge = (page) => page.evaluate(() => ({
  name: (document.getElementById('whoName') || {}).textContent,
  role: (document.getElementById('whoRole') || {}).textContent,
  initials: (document.getElementById('whoAv') || {}).textContent
}));

async function main() {
  buildDatabase();
  aWorkshop();

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

  try {
    // ── The office, on the desktop hub ──────────────────────────────────────────────────────
    await signIn(page, site, 'anna@varmak.se', 'correct horse battery staple');
    await page.goto(`${site}/hub-desktop.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
    assert.equal(await page.locator('[role="alert"]').count(), 0,
      'the front door must not be the one screen that refuses a signed-in session');
    step('Hub: signed in, the front door opens instead of refusing — it is wired now');

    const anna = await badge(page);
    assert.equal(anna.name, 'Anna Berg', 'the badge is the session\'s, not a name written into the page');
    assert.equal(anna.role, 'Admin');
    assert.equal(anna.initials, 'AB', 'including the initials, which were AK for everybody');
    step('Hub: the badge holds the name and the role the session belongs to');

    // The counts, checked against the database by hand rather than against the page's own idea.
    const counts = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('#ydCounts .ydcount').forEach((el) => {
        const n = el.querySelector('b');
        out[el.textContent.replace(n.textContent, '').trim()] = Number(n.textContent);
      });
      return out;
    });
    assert.equal(counts.customers, 2, `the hub's customer count should be the database's: ${JSON.stringify(counts)}`);
    assert.equal(counts.projects, 1);
    assert.equal(counts.jobcards, 2);
    assert.equal(counts['stock items'], 1);
    assert.equal(counts['hours entries'], 1);
    assert.equal(value(`SELECT count(*) FROM customer;`), '2');
    // Quotations and inspections exist as collections the snapshot does not carry yet, and a count
    // from browser storage in their place is exactly the two-worlds failure this page used to have.
    assert.equal(counts.quotations, undefined, 'a collection the database does not serve reads as nothing');
    assert.equal(counts.inspections, undefined);
    step('Hub: the record counts are the workshop\'s, and a collection with no snapshot shows nothing');

    // The two operations on browser storage, which mean nothing once the records are on the server.
    assert.equal(await page.locator('#ydBackup').count(), 0,
      '"Save a copy" saves this browser, and on the server it would write a backup holding nothing');
    assert.equal(await page.locator('#ydRestore').count(), 0);
    const where = await page.locator('.ydwhere').innerText();
    assert.match(where, /workshop database/, `the panel has to say where the work actually is: ${where}`);
    assert.match(await page.locator('.ydwarn').innerText(), /backup\.sh/,
      'and who backs it up, which is not the person reading this screen clearing their browser');
    step('Hub: the browser backup buttons are gone and the panel says where the work is kept');

    // Switching language must not put the dictionary's "Admin" back over a session's own role.
    // Through the menu, the way a person does it: the language buttons are behind the globe.
    await page.locator('#langtoggle').click();
    await page.locator('[data-lang="sv"]').click();
    await page.waitForTimeout(80);
    const swedish = await badge(page);
    assert.equal(swedish.name, 'Anna Berg');
    assert.equal(swedish.role, 'Admin', 'admin is admin in Swedish too, but it must come from the session');
    await page.locator('#langtoggle').click();
    await page.locator('[data-lang="en"]').click();
    await page.waitForTimeout(80);
    step('Hub: switching language leaves the session\'s own name and role alone');

    // ── The welder, on the phone hub ────────────────────────────────────────────────────────
    await page.locator('#logoutBtn').click();
    await page.waitForURL(/login\.html/, { timeout: 8000 });
    assert.equal(value(`SELECT count(*) FROM app_session WHERE ended_at IS NULL;`), '0',
      'the way out has to end the session in the database, not only navigate away');
    step('Hub: signing out from the hub ends the session rather than just leaving the page');

    await signIn(page, site, 'marko@varmak.se', 'a long enough passphrase');
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(`${site}/hub-mobile.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => {
      const el = document.getElementById('whoName');
      return el && el.textContent === 'Marko Ilic';
    }, { timeout: 8000 });
    const marko = await badge(page);
    assert.equal(marko.name, 'Marko Ilic');
    assert.equal(marko.role, 'Workshop',
      'the phone hub said Admin to everybody, which is the one line on it that says whose session this is');
    assert.equal(marko.initials, 'MI');
    step('Hub: on the phone the badge is the welder\'s own name and role, not the page\'s');

    // The message box that sent nothing to anybody.
    assert.equal(await page.locator('#ttInput').isDisabled(), true,
      'a box that accepts what somebody types and drops it is worse than no box');
    assert.equal(await page.locator('#ttSend').isDisabled(), true);
    assert.match(await page.locator('#ttInput').getAttribute('placeholder'), /nothing is sent/i,
      'and it says so, rather than reading "Write to team…"');
    step('Hub: the message feed says it is not connected instead of eating what is typed into it');

    // And the welder's hub carries no figure in kronor, on either page.
    await page.goto(`${site}/hub-desktop.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
    const shown = await page.evaluate(() => document.body.innerText);
    assert.ok(!shown.includes('250000') && !shown.includes('250 000'),
      'the credit limit must not reach a welder\'s front door');
    assert.equal(await page.evaluate(() => window.WorkshopData.get().customers
      .some((c) => 'credit' in c || 'creditLimit' in c)), false,
      'nor be in the records behind it');
    step('Hub: and on a welder\'s hub there is no figure in kronor anywhere');

    assert.deepEqual(thrown, [], `a hub threw: ${thrown.slice(0, 3).join(' / ')}`);
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
    server.close();
  }
  console.log(`\n${checks} checks: the front door is the workshop's, and it says whose session it is.`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
