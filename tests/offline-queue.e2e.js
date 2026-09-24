'use strict';

// Hours booked with no connection, driven the way a welder drives it.
//
// This is the check the whole offline queue exists to pass, and it cannot be made any other way: the
// unit tests in workshop-queue.test.js prove the queue keeps entries in order and hands back the
// database's refusals, and every one of them passed while the tablet screen still had no idea the
// queue existed. What is asked here is the other half — that pressing Save with a dead signal keeps
// the entry, says so, and that the hours land in Postgres exactly once when the line comes back.
//
// Four of these checks are the reason the file exists:
//
//   * Pressing Save offline books nothing and loses nothing. The entry is on the tablet, the screen
//     says which entry, and Postgres has no row — because a screen that says "saved" for work that
//     never arrived is the failure this project refuses above all others.
//   * The same entry, sent twice, is one row. That is the case a tablet cannot avoid: it has no way
//     to know whether its first attempt arrived before the connection died, so it sends again — and
//     the id it generated once is what makes asking twice harmless.
//   * A refusal is shown, not retried. The office moved the step to another jobcard while the tablet
//     was out of signal; the database says so in its own words and the welder decides.
//   * A tablet that cannot read the workshop does not fall back to the browser's own storage. The
//     records still in it are demonstration data, and hours logged onto them go where nobody looks.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = process.env.VARMAK_TEST_DB || 'varmak_offline_test';
const HTTP_PORT = Number(process.env.VARMAK_OFFLINE_PORT || 8933);

const conn = () => ['-h', HOST, '-p', PORT, '-U', USER, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-qtAX'];
const sql = (text) => execFileSync('psql', conn(), { input: text, encoding: 'utf8' }).trim();
const value = (text) => sql(text).split('\n')[0].trim();

let checks = 0;
const step = (message) => { checks += 1; console.log(`OK   ${message}`); };

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Waiting on Postgres rather than on the screen, for the reason the other server suites wait that
// way: the screen can say a thing before the database has it, and the database is the question.
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

// A mutation of one of these files arrives here: mutation-check.js writes the damaged copy to a
// temporary file, names it in one of these variables, and the browser is served that copy instead of
// the one on disk. Substituting at the route rather than on disk is the point — the site directory is
// never touched, so a mutation run cannot leave a damaged page behind if it is interrupted.
const SUBSTITUTES = {
  'workshop-queue.js': process.env.VARMAK_QUEUE,
  'workshop-api.js': process.env.VARMAK_API_CLIENT,
  'hours-mobile.html': process.env.VARMAK_HOURS_PAGE
};
const TYPE = { '.js': 'application/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8' };
async function serveSubstitutes(context) {
  for (const [name, file] of Object.entries(SUBSTITUTES)) {
    if (!file) continue;
    const body = fs.readFileSync(file, 'utf8');
    await context.route(`**/${name}`, (route) => route.fulfill({
      status: 200, contentType: TYPE[path.extname(name)], body
    }));
  }
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

// A running job with two steps, a second jobcard for the step to be moved to, and two welders who
// share the tablet — which is the arrangement the queue's owner rule exists for.
function aWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const welder = (email, name) => {
    const id = value(`INSERT INTO app_user (email, display_name, role)
      VALUES ('${email}', '${name}', 'workshop') RETURNING id;`);
    sql(`SELECT set_password(${id}, 'a long enough passphrase');`);
    return id;
  };
  const marko = welder('marko@varmak.se', 'Marko Ilic');
  const erik = welder('erik@varmak.se', 'Erik Sund');
  const customer = value(`INSERT INTO customer (name, city) VALUES ('MarineVent AB', 'Malmö') RETURNING id;`);
  const project = value(`INSERT INTO project (name, customer_id, status, planned_hours)
    VALUES ('Conveyor frame', ${customer}, 'production', 40) RETURNING id;`);
  const card = (title) => value(`INSERT INTO jobcard (project_id, customer_id, title, status, planned_hours)
    VALUES (${project}, ${customer}, '${title}', 'in-progress', 24) RETURNING id;`);
  const jobcard = card('Frame weldment');
  const other = card('Base plate');
  const op = (seq, description) => value(`INSERT INTO operation (jobcard_id, seq, description, status, planned_hours)
    VALUES (${jobcard}, ${seq}, '${description}', 'pending', 8) RETURNING id;`);
  return {
    marko, erik, customer, project, jobcard, other,
    cut: op(1, 'Cut and prepare'),
    weld: op(2, 'Weld out'),
    ref: value(`SELECT ref FROM jobcard WHERE id = ${jobcard};`),
    otherRef: value(`SELECT ref FROM jobcard WHERE id = ${other};`),
    projectRef: value(`SELECT ref FROM project WHERE id = ${project};`)
  };
}

const hoursRows = () => value(`SELECT count(*) FROM hours_entry;`);
const queueOf = (page) => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('varmak.queue') || 'null'); } catch (e) { return null; }
});

async function signIn(page, site, email, secret) {
  await page.goto(`${site}/login.html`, { waitUntil: 'load' });
  await page.waitForSelector('#signInForm:not([hidden])', { timeout: 8000 });
  await page.locator('#signInEmail').fill(email);
  await page.locator('#signInSecret').fill(secret);
  await page.locator('#signInGo').click();
  await page.waitForURL(/hours-mobile\.html|hub-/, { timeout: 8000 });
}

async function openHours(page, site) {
  await page.goto(`${site}/hours-mobile.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
    { timeout: 8000 });
  assert.equal(await page.locator('[role="alert"]').count(), 0, 'the guard must let this page through');
}

// Fill the form the way a thumb does: pick the project, pick the step out of the Item list by its
// own words, type the hours. Never by calling saveHours() with an object — the dropdowns are where
// the jobcard id and the operation id come from, and that is half of what is being tested.
async function bookHours(page, projectRef, stepName, hours) {
  await page.locator('#project').selectOption(projectRef);
  await page.waitForFunction(() => document.querySelectorAll('#item option').length > 1, { timeout: 5000 });
  const picked = await page.evaluate((want) => {
    const item = document.getElementById('item');
    const at = [...item.options].findIndex((o) => o.textContent.trim() === want);
    if (at < 0) return false;
    item.selectedIndex = at;
    item.dispatchEvent(new Event('change'));
    return true;
  }, stepName);
  assert.ok(picked, `the Item list should offer the step "${stepName}"`);
  await page.locator('#hours').fill(String(hours));
  await page.locator('#hours').dispatchEvent('input');
  await page.locator('#saveEntry').click();
  await page.waitForSelector('.waskmsg', { timeout: 8000 });
  const said = await page.locator('.waskmsg').innerText();
  await page.locator('.waskyes').click();
  await page.waitForSelector('.waskwrap', { state: 'detached', timeout: 5000 });
  return said;
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
  const context = await browser.newContext({ viewport: { width: 390, height: 780 } });
  await serveSubstitutes(context);
  const page = await context.newPage();
  const thrown = [];
  page.on('pageerror', (error) => thrown.push(error.stack || error.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/favicon|net::|Failed to load resource/.test(m.text())) return;
    thrown.push(m.text());
  });

  try {
    await signIn(page, site, 'marko@varmak.se', 'a long enough passphrase');
    await openHours(page, site);
    assert.equal(await page.locator('#unsentPanel').isVisible(), false,
      'with nothing held the banner is not on screen at all');
    // The snapshot is where the page learns whose queue this is, and it comes from the session.
    assert.equal(await page.evaluate(() => sessionStorage.getItem('varmak.session.user')), w.marko,
      'the tablet knows which person the session belongs to, by id');
    step('Offline: a signed-in tablet with nothing held shows no banner, and knows whose queue it is');

    // ── The signal dies ─────────────────────────────────────────────────────────────────────
    await context.setOffline(true);
    const first = await bookHours(page, w.projectRef, 'Cut and prepare', 2.5);
    assert.match(first, /saved on this tablet/, `the screen has to say it is held: ${first}`);
    assert.match(first, /Do not enter it again/,
      'and say the one thing that stops a welder booking it twice out of doubt');
    assert.equal(hoursRows(), '0', 'nothing reached the database, which is the whole premise');

    const held = await queueOf(page);
    assert.equal(held.owner, w.marko, 'the queue is stored under the person, not the device');
    assert.equal(held.waiting.length, 1);
    assert.equal(held.waiting[0].call, 'book_hours');
    assert.equal(held.waiting[0].args.hours, 2.5);
    assert.equal(String(held.waiting[0].args.operation_id), w.cut);
    assert.ok(held.waiting[0].id, 'and it carries the id the server will be given');
    assert.equal(await page.locator('#unsentPanel').isVisible(), true);
    assert.match(await page.locator('#unsentSaid').innerText(), /1 entr/);
    assert.match(await page.locator('#unsentHeld').innerText(), new RegExp(`2\\.5 h · ${w.ref}`),
      'the banner names the entry rather than only counting it');
    step('Offline: pressing Save with no connection keeps the entry, says so, and books nothing');

    const second = await bookHours(page, w.projectRef, 'Weld out', 1.5);
    assert.match(second, /saved on this tablet/);
    const two = await queueOf(page);
    assert.equal(two.waiting.length, 2, 'a second press is a second entry, in order behind the first');
    assert.deepEqual(two.waiting.map((e) => e.args.hours), [2.5, 1.5]);
    const firstId = two.waiting[0].id;
    assert.notEqual(two.waiting[0].id, two.waiting[1].id, 'each with its own id');
    assert.equal(hoursRows(), '0');
    step('Offline: a second entry queues behind the first, in the order it was pressed');

    // ── And comes back ──────────────────────────────────────────────────────────────────────
    await context.setOffline(false);
    // The browser's own event, which is what a tablet coming back into range actually fires.
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await until('both held entries to reach Postgres', () => hoursRows() === '2');
    assert.equal(value(`SELECT string_agg(hours::text, ',' ORDER BY id) FROM hours_entry;`), '2.50,1.50',
      'in the order they were booked, not the order the network chose');
    assert.equal(value(`SELECT DISTINCT worker FROM hours_entry;`), 'Marko Ilic',
      'and in the name the session belongs to, which the server took rather than being told');
    assert.equal(value(`SELECT string_agg(operation_id::text, ',' ORDER BY id) FROM hours_entry;`),
      `${w.cut},${w.weld}`, 'each against the step it was booked on');
    // The rolled-up figures the office reads are the trigger's, so they had to move too.
    assert.equal(value(`SELECT logged_hours::text FROM operation WHERE id = ${w.cut};`), '2.50');
    await page.waitForFunction(() => document.getElementById('unsentPanel').hidden, { timeout: 8000 });
    assert.equal((await queueOf(page)).waiting.length, 0, 'and the queue is empty');
    assert.match(await page.locator('#todayList').innerText(), /2\.5/,
      'Logged today is the workshop\'s again, not the tablet\'s idea of it');
    step('Offline: the line comes back and the held entries go through, in order and in the right name');

    // ── The same entry, sent twice ──────────────────────────────────────────────────────────
    //
    // The case a tablet cannot avoid: the entry arrived, the answer did not, so it sends again. The
    // id it generated once is the only thing standing between that and a second day's hours.
    await page.evaluate((entry) => {
      localStorage.setItem('varmak.queue', JSON.stringify({
        owner: entry.owner, waiting: [entry.row], refused: []
      }));
    }, { owner: w.marko, row: two.waiting[0] });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
    await until('the replayed entry to leave the queue',
      async () => (await queueOf(page)).waiting.length === 0);
    assert.equal(hoursRows(), '2', 'the same id sent twice is one entry, not two');
    assert.equal(value(`SELECT count(*) FROM device_event WHERE id = '${firstId}';`), '1',
      'the database remembered the press rather than repeating it');
    step('Offline: an entry sent twice because the answer was lost is booked once');

    // ── The database says no ────────────────────────────────────────────────────────────────
    //
    // A refusal cannot be retried away, and retrying forever would hide it. The office moved the step
    // to another jobcard while the tablet was out of range; the welder is shown the database's words.
    await page.route('**/api/rpc/book_hours', (route) => route.abort('internetdisconnected'));
    const third = await bookHours(page, w.projectRef, 'Cut and prepare', 3);
    assert.match(third, /saved on this tablet/);
    sql(`UPDATE operation SET jobcard_id = ${w.other}, seq = 1 WHERE id = ${w.cut};`);
    await page.unroute('**/api/rpc/book_hours');
    await page.locator('#sendNow').click();
    await page.waitForFunction(() => {
      const el = document.getElementById('unsentRefused');
      return el && el.innerText.trim().length > 0;
    }, { timeout: 10000 });
    const words = await page.locator('#unsentRefused').innerText();
    assert.match(words, new RegExp(`belongs to jobcard ${w.otherRef}`),
      `the screen has to show the database's own wording: ${words}`);
    assert.match(words, new RegExp(`3 h · ${w.ref}`), 'and name the entry it is about');
    assert.equal(hoursRows(), '2', 'and book nothing');
    assert.equal((await queueOf(page)).waiting.length, 0,
      'a refused entry is out of the waiting line — retrying it cannot help');
    step('Offline: an entry the database refuses is shown in its own words, and retried by nobody');

    // The welder decides. Removing it is the one button here that loses work, so it asks first.
    await page.locator('#unsentRefused button:nth-of-type(2)').click();
    await page.waitForSelector('.waskmsg', { timeout: 5000 });
    assert.match(await page.locator('.waskmsg').innerText(), /will have to be logged again/);
    await page.locator('.waskyes').click();
    await page.waitForFunction(() => document.getElementById('unsentPanel').hidden, { timeout: 8000 });
    assert.equal((await queueOf(page)).refused.length, 0);
    step('Offline: the refused entry is removed only after the screen says what that costs');

    // ── A tablet that cannot read the workshop ──────────────────────────────────────────────
    //
    // The two-worlds failure in its last hiding place: with the API unreachable on load the page used
    // to fall back to this browser's own storage, show whatever was in it, and book hours onto it.
    await page.route('**/api/read/**', (route) => route.abort('internetdisconnected'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => {
      const el = document.getElementById('unsentPanel');
      return el && !el.hidden;
    }, { timeout: 8000 });
    assert.match(await page.locator('#unsentSaid').innerText(), /could not be read/);
    assert.equal(await page.evaluate(() => window.WorkshopData.isServerBacked()), false,
      'nothing was adopted, because nothing was read');

    // The trap has to be baited, or this check passes for the wrong reason rather than the right one.
    // Browser storage is filled with the demonstration workshop — which is what a tablet that ran
    // this app before it was pointed at a server still has in it, because adopting a snapshot never
    // writes to browser storage and so never clears what is there. The dropdowns then offer
    // real-looking jobs, and the only thing between a welder and booking five hours onto one of them
    // is the refusal being tested. That WorkshopData accepts this write at all is the point: the
    // no-two-worlds guard refuses it the moment a snapshot has been adopted, and this is the one
    // state where it cannot — signed in, with nothing adopted.
    await page.evaluate(() => window.WorkshopData.loadDemoData());
    await page.waitForFunction(() => document.querySelectorAll('#project option').length > 1,
      { timeout: 5000 });
    const bait = await page.evaluate(() => {
      const options = [...document.querySelectorAll('#project option')].filter((o) => o.value);
      if (!options.length) return null;
      const project = document.getElementById('project');
      project.value = options[0].value;
      project.dispatchEvent(new Event('change'));
      const item = document.getElementById('item');
      if (!item.options.length || !item.options[0].dataset.jobcard) return null;
      item.selectedIndex = 0;
      item.dispatchEvent(new Event('change'));
      document.getElementById('hours').value = '5';
      return item.options[0].dataset.jobcard;
    });
    assert.ok(bait, 'browser storage should still be offering jobs — otherwise this proves nothing');
    await page.locator('#saveEntry').click();
    await page.waitForSelector('.waskmsg', { timeout: 8000 });
    const refusedRead = await page.locator('.waskmsg').innerText();
    await page.locator('.waskyes').click();
    assert.match(refusedRead, /could not be read/,
      `a tablet that cannot read the workshop must not book against it: ${refusedRead}`);
    assert.equal(hoursRows(), '2', 'and nothing went into browser storage pretending to be booked');
    assert.equal(await page.evaluate(() => (window.WorkshopData.get().hours || []).length), 0,
      'nor into this browser, which is where an unrefused save would have put it');
    step('Offline: with the workshop unreadable the page says so instead of falling back to this browser');

    await page.unroute('**/api/read/**');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
    await page.waitForFunction(() => document.getElementById('unsentPanel').hidden, { timeout: 8000 });
    step('Offline: and reads it by itself the moment the line is back, without a reload');

    // ── Two welders, one tablet ─────────────────────────────────────────────────────────────
    //
    // A real Tuesday. The server takes the name for a booking from the session, so work queued by one
    // welder and flushed under the next one's session would be booked in the wrong name.
    await page.route('**/api/rpc/book_hours', (route) => route.abort('internetdisconnected'));
    const marksLast = await bookHours(page, w.projectRef, 'Weld out', 4);
    assert.match(marksLast, /saved on this tablet/);
    await page.unroute('**/api/rpc/book_hours');
    // Signing out is allowed with work unsent — refusing would strand the next welder — but it says so.
    await page.route('**/api/rpc/book_hours', (route) => route.abort('internetdisconnected'));
    await page.locator('#logoutBtn').click();
    await page.waitForSelector('.waskmsg', { timeout: 8000 });
    const leaving = await page.locator('.waskmsg').innerText();
    assert.match(leaving, /have not been sent yet/, `the way out has to say it: ${leaving}`);
    await page.locator('.waskyes').click();
    await page.waitForURL(/login\.html/, { timeout: 8000 });
    await page.unroute('**/api/rpc/book_hours');
    step('Offline: signing out with work unsent is allowed, and says what is being left behind');

    await signIn(page, site, 'erik@varmak.se', 'a long enough passphrase');
    await openHours(page, site);
    await page.waitForFunction(() => {
      const el = document.getElementById('unsentPanel');
      return el && !el.hidden;
    }, { timeout: 8000 });
    assert.match(await page.locator('#unsentSaid').innerText(), /unsent work from an earlier sign-in/i);
    assert.equal(await page.locator('#sendNow').isVisible(), false,
      'and it is not Erik\'s to send — the button is not there to press');
    assert.equal((await queueOf(page)).owner, w.marko, 'the queue still belongs to Marko');
    step('Offline: a tablet holding somebody else\'s work says so, and does not offer to send it');

    // Erik can still book, and it goes straight to the server rather than into Marko's queue.
    const eriks = await bookHours(page, w.projectRef, 'Weld out', 1);
    assert.match(eriks, /Hours entry saved/, `Erik's own booking should go through: ${eriks}`);
    await until('Erik\'s hours to reach Postgres', () => hoursRows() === '3');
    assert.equal(value(`SELECT worker FROM hours_entry ORDER BY id DESC LIMIT 1;`), 'Erik Sund',
      'in Erik\'s name, because the server takes the name from the session');
    const stillMarkos = await queueOf(page);
    assert.equal(stillMarkos.owner, w.marko);
    assert.equal(stillMarkos.waiting.length, 1, 'and Marko\'s entry is untouched, still his');
    step('Offline: the other welder books normally, and the held work stays the first one\'s');

    // And when Marko comes back to the same tablet, his entry goes through — in his name.
    await page.locator('#logoutBtn').click();
    await page.waitForURL(/login\.html/, { timeout: 8000 });
    await signIn(page, site, 'marko@varmak.se', 'a long enough passphrase');
    await openHours(page, site);
    await until('Marko\'s held entry to go through when he signs back in', () => hoursRows() === '4');
    assert.equal(value(`SELECT worker || '|' || hours::text FROM hours_entry ORDER BY id DESC LIMIT 1;`),
      'Marko Ilic|4.00', 'the hours he booked out of range, in his name, hours later');
    assert.equal((await queueOf(page)).waiting.length, 0);
    step('Offline: and it goes through, in his name, when he signs in at that tablet again');

    assert.deepEqual(thrown, [], `the page threw: ${thrown.slice(0, 3).join(' / ')}`);
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
    server.close();
  }
  console.log(`\n${checks} offline-queue checks passed.`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
