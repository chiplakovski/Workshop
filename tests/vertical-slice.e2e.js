'use strict';

// The first thing in this project that works end to end.
//
// Everything before this tested one layer at a time: the schema refuses what it should, the roles
// cannot see prices, the workflows are all-or-nothing, the endpoints carry refusals through. All of
// it true, and none of it evidence that the app works — because until now nothing in the app had
// ever opened a database connection.
//
// So this is a real browser, on a real page, served by the real server, against a real Postgres. A
// welder types a PIN on the shop tablet, picks a job, books six and a half hours, and the test then
// walks round the back and asks the database whether the hours are there.
//
// Chosen as the first slice because it is the screen the workshop touches every day, and because it
// exercises the whole stack at once: the PIN door, the snapshot read, a workflow write, the roles,
// and what a welder must not be able to see.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_slice_test';
const HTTP_PORT = Number(process.env.VARMAK_SLICE_PORT || 8911);

function conn() {
  return ['-h', HOST, '-p', PORT, '-U', USER, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-qtAX'];
}
function sql(text) { return execFileSync('psql', conn(), { input: text, encoding: 'utf8' }).trim(); }
function value(text) { return sql(text).split('\n')[0].trim(); }

let checks = 0;
function step(message) { checks += 1; console.log(`OK   ${message}`); }

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

// A day's worth of a small workshop: one customer, one job released to the floor with two steps on
// it, one welder with a PIN, one machine.
function aWorkshop() {
  sql(`SET client_min_messages = warning;
    INSERT INTO app_user (email, display_name, role) VALUES
      ('marko@varmak.se', 'Marko Ilic', 'workshop'),
      ('lars@varmak.se', 'Lars Holm', 'office');
    SELECT set_pin((SELECT id FROM app_user WHERE email = 'marko@varmak.se'), '8472');
    SELECT set_password((SELECT id FROM app_user WHERE email = 'lars@varmak.se'), 'a long enough passphrase');`);

  const customer = value(`INSERT INTO customer (name, city, credit_limit)
    VALUES ('Skåne Verkstad AB', 'Lund', 250000) RETURNING id;`);
  const project = value(`INSERT INTO project (name, customer_id, status, planned_hours, quoted_value)
    VALUES ('Conveyor frame', ${customer}, 'production', 40, 420000) RETURNING id;`);
  const jobcard = value(`INSERT INTO jobcard (project_id, customer_id, title, status, planned_hours)
    VALUES (${project}, ${customer}, 'Frame weldment', 'in-progress', 24) RETURNING id;`);
  sql(`INSERT INTO equipment (ref, name, category, purchase_price)
       VALUES ('EQ-001', 'MIG 400', 'welding', 412000);
       INSERT INTO operation (jobcard_id, seq, description, planned_hours)
       VALUES (${jobcard}, 1, 'Cut and prepare', 8), (${jobcard}, 2, 'Weld out', 16);
       INSERT INTO stock_item (code, description, unit, stock, avg_cost)
       VALUES ('S355-10', 'Plate S355J2 10mm', 'KG', 500, 14.50);`);
  return { customer, project, jobcard,
    projectRef: value(`SELECT ref FROM project WHERE id = ${project};`),
    jobcardRef: value(`SELECT ref FROM jobcard WHERE id = ${jobcard};`) };
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
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  const thrown = [];
  page.on('pageerror', (error) => thrown.push(error.message));
  // Recorded with the reason, because the reasons are not alike and guessing between them wasted a
  // run. A request cancelled because the page navigated is normal. A blocked font from an external
  // CDN is not this app's fault — though it is worth knowing, and noted below. A 4xx from our own
  // endpoint is either a refusal this test provoked or a fault.
  const failed = [];
  page.on('requestfailed', (request) => failed.push({
    url: request.url(),
    why: (request.failure() && request.failure().errorText) || 'unknown'
  }));
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push({ url: response.url(), why: `HTTP ${response.status()}` });
  });
  page.on('console', (message) => {
    // A non-2xx fetch makes the browser log a console error, and this test provokes several on
    // purpose — a refused PIN, a refused price, a refused workflow, a signed-out read. Those are the
    // system working. Real faults arrive through 'pageerror' as uncaught exceptions; what the console
    // adds beyond that is "Failed to load resource", which says nothing this test has not already
    // asserted about directly.
    const text = message.text();
    if (message.type() !== 'error') return;
    if (/favicon|net::|Failed to load resource/.test(text)) return;
    thrown.push(text);
  });

  try {
    // ── The door ────────────────────────────────────────────────────────────────────────────
    await page.goto(`${site}/login.html`, { waitUntil: 'load' });
    await page.waitForSelector('#signInForm:not([hidden])', { timeout: 5000 });
    assert.equal(await page.locator('#demoButton').isVisible(), false,
      'with a server present the page should offer a real sign-in, not the local demo');
    step('Login: the page finds the server and shows a real sign-in instead of the local demo');

    // The wrong PIN, first, because the interesting half of a login is what it says no to.
    await page.locator('#doorPin').click();
    assert.equal(await page.locator('#signInSecret').getAttribute('inputmode'), 'numeric',
      'the shop tablet needs a number keypad, not a text keyboard');
    await page.locator('#signInEmail').fill('marko@varmak.se');
    await page.locator('#signInSecret').fill('0000');
    await page.locator('#signInGo').click();
    await page.waitForSelector('#signInError:not([hidden])', { timeout: 5000 });
    const refusal = await page.locator('#signInError').innerText();
    assert.match(refusal, /not a login we recognise/,
      `the refusal should be the database's own wording: ${refusal}`);
    assert.equal(await page.locator('#signInSecret').inputValue(), '',
      'a refused PIN should be cleared, not left on a shared tablet');
    assert.equal(page.url(), `${site}/login.html`, 'a wrong PIN must not get in');
    step('Login: a wrong PIN is refused in the words the database wrote, and the field is cleared');

    // And the right one.
    await page.locator('#signInSecret').fill('8472');
    await page.locator('#signInGo').click();
    await page.waitForURL(`${site}/hours-mobile.html`, { timeout: 8000 });
    step('Login: the right PIN opens the shop-floor screen');

    const session = sql(`SELECT door::text || '|' || device FROM app_session
      WHERE user_id = (SELECT id FROM app_user WHERE email = 'marko@varmak.se') ORDER BY started_at DESC LIMIT 1;`);
    assert.equal(session, 'pin|shop tablet', 'the session should record which door and which device');
    assert.match(value(`SELECT to_char(expires_at, 'HH24:MI') FROM app_session ORDER BY started_at DESC LIMIT 1;`),
      /^18:00$/, 'a tablet session ends with the shift');
    assert.equal(value(`SELECT count(*) FROM activity_log WHERE action = 'signed in';`), '1',
      'the sign-in should be on the record');
    step('Login: the session is a real row — which door, which device, expiring at the end of the shift');

    // ── What the welder can see ─────────────────────────────────────────────────────────────
    const snapshot = await page.evaluate(async () => {
      const answer = await window.WorkshopApi.snapshot();
      return answer.data || answer;
    });
    assert.ok(Array.isArray(snapshot.jobcards) && snapshot.jobcards.length === 1,
      'the welder should see the one job that is on');
    assert.equal(snapshot.jobcards[0].no, w.jobcardRef);
    assert.equal(snapshot.jobcards[0].operations.length, 2, 'both steps should arrive nested on it');
    assert.equal(snapshot.seesMoney, false, 'a welder is not shown money');
    step(`Login: the welder's own session reads the workshop back — ${snapshot.jobcards[0].no} with 2 steps`);

    // The promise from §1b, on a real page, in a real browser, signed in as a real welder.
    const asText = JSON.stringify(snapshot);
    for (const figure of ['14.50', '412000', '420000', '250000']) {
      assert.ok(!asText.includes(figure), `the figure ${figure} reached a welder's browser`);
    }
    const askedDirectly = await page.evaluate(async () => {
      const response = await fetch('/api/read/money', {
        headers: { authorization: 'Bearer ' + window.sessionStorage.getItem('varmak.session.token') }
      });
      return { status: response.status, body: await response.text() };
    });
    assert.equal(askedDirectly.status, 403, 'asking the API directly for the prices must be refused');
    assert.ok(!askedDirectly.body.includes('14.50'));
    step("Login: not one figure in kronor is in the welder's browser, and asking the API directly is refused");

    // ── Booking the hours ───────────────────────────────────────────────────────────────────
    const booked = await page.evaluate(async (jobcardRef) => {
      const snap = (await window.WorkshopApi.snapshot()).data;
      const jobcard = snap.jobcards.find((j) => j.no === jobcardRef);
      const operation = jobcard.operations.find((o) => o.desc === 'Weld out');
      return window.WorkshopApi.call('book_hours', {
        jobcard_id: Number(jobcard.id),
        operation_id: Number(operation.id),
        hours: 6.5,
        note: 'Booked on the tablet',
        event_id: 'slice-0001'
      });
    }, w.jobcardRef);
    assert.equal(booked.ok, true, `booking should have gone through: ${booked.refused}`);
    assert.match(booked.result, /^H-\d+$/);

    // And now the point of the whole exercise: ask the database.
    const entry = sql(`SELECT worker || '|' || hours || '|' || note || '|' || worked_on
      FROM hours_entry ORDER BY id DESC LIMIT 1;`);
    assert.equal(entry, `Marko Ilic|6.50|Booked on the tablet|${new Date().toISOString().slice(0, 10)}`,
      'the hours should be in Postgres, under the name of whoever the PIN belonged to');
    step('Hours: six and a half hours typed on a tablet are in Postgres, under the welder\'s own name');

    // The name came from the session, not from the browser. Worth proving on the real path, because
    // this is the property that makes a timesheet evidence of anything.
    const forged = await page.evaluate(() => window.WorkshopApi.call('book_hours', {
      jobcard_id: 1, operation_id: 1, hours: 8, worker: 'Lars Holm', note: 'Forged', event_id: 'slice-0002'
    }));
    assert.equal(forged.ok, true, 'the booking itself is fine — it is the name that must not take');
    assert.equal(value(`SELECT count(*) FROM hours_entry WHERE worker = 'Lars Holm';`), '0',
      "a name in the browser's request reached the timesheet");
    step('Hours: a name put in the request by the browser is ignored — the session decides who booked it');

    // The roll-ups the schema maintains, seen from the far end of the whole stack.
    assert.equal(value(`SELECT logged_hours::text FROM operation WHERE description = 'Weld out';`), '6.50');
    assert.equal(value(`SELECT used_hours::text FROM project WHERE id = ${w.project};`), '14.50',
      'the project should carry both bookings');
    step('Hours: the operation and the project totals followed the bookings without anybody typing them');

    // Replay, the way a tablet coming back onto the network behaves.
    const again = await page.evaluate(() => window.WorkshopApi.call('book_hours', {
      jobcard_id: 1, operation_id: 1, hours: 6.5, note: 'Booked on the tablet', event_id: 'slice-0001'
    }));
    assert.equal(again.ok, true);
    assert.equal(value(`SELECT count(*) FROM hours_entry WHERE note = 'Booked on the tablet';`), '1',
      'the tablet flushing its queue twice booked the hours twice');
    step('Hours: the tablet can flush its queue blindly — the same event id books once');

    // ── The screen itself, pressed ───────────────────────────────────────────────────────────
    //
    // Everything above went through WorkshopApi from the console, which proves the path but not the
    // page. This is the page: a welder presses a job, presses four hours, presses save — and the
    // entry has to be in Postgres with nothing else touched.
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(), { timeout: 8000 });
    step('Screen: on reload the page reads the workshop from the server rather than from this browser');

    // The name on screen is the session's, not one kept in the browser. The server records the
    // session's name whatever the page sends, so showing anything else would be showing a lie.
    assert.equal((await page.locator('#whoName').innerText()).trim(), 'Marko Ilic');
    step("Screen: the name on the screen is whoever the PIN belonged to");

    const before = Number(value(`SELECT count(*) FROM hours_entry;`));
    await page.locator('.jobpick').first().click();
    const picked = await page.evaluate(() => ({
      project: document.getElementById('project').value,
      item: document.getElementById('item').value
    }));
    assert.ok(picked.project, 'pressing a job should fill the project in from the server data');
    await page.locator('.qh[data-h="4"]').click();
    assert.equal(await page.locator('#hours').inputValue(), '4');
    await page.locator('#saveEntry').click();
    // The save is a round trip now, so the confirmation is waited for rather than assumed. Dismissed
    // if it appears, because the screen's own alert is not what this check is about.
    await page.waitForSelector('.waskbtns button, .waskyes', { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => {
      const ok = document.querySelector('.waskbtns button, .waskyes');
      if (ok) ok.click();
    });
    // The database is asked, not the screen. Polled, because the save is now a round trip and the
    // click returns before it lands.
    let landed = null;
    for (let attempt = 0; attempt < 20 && !landed; attempt += 1) {
      const rows = Number(value(`SELECT count(*) FROM hours_entry;`));
      if (rows > before) landed = sql(`SELECT worker || '|' || hours FROM hours_entry ORDER BY id DESC LIMIT 1;`);
      else await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(landed, 'Marko Ilic|4.00',
      'four hours pressed on the screen should be in Postgres under the session\'s name');
    step('Screen: a welder presses a job, presses four hours, presses save — and it is in Postgres');

    // And the screen shows it back, which is the only thing that makes a timesheet trustworthy to
    // the person filling it in.
    const today = await page.locator('#todayList').innerText();
    assert.ok(/4 h|4h/.test(today), `the day should read back the entry just saved: ${today}`);
    step('Screen: and the day reads it back, from the server, to the person who booked it');

    // Nothing was written to browser storage. The whole point of the backed mode: one place for the
    // record, and it is not this laptop.
    const stored = await page.evaluate(() => {
      try { return window.localStorage.getItem('varmak.workshop.frontend.v5'); } catch (e) { return null; }
    });
    assert.ok(!stored || !stored.includes('Marko Ilic'),
      'the entry was also written into browser storage, which is a second copy nobody reconciles');
    step('Screen: and nothing went into browser storage — the record is in one place');

    // ── What the welder cannot do ───────────────────────────────────────────────────────────
    const quoting = await page.evaluate(() => window.WorkshopApi.call('send_estimate', { estimate_id: 1 }));
    assert.equal(quoting.ok, false);
    assert.match(quoting.refused, /not yours to do/);
    step('Login: from that same signed-in browser, the office workflows are refused');

    // ── No two worlds ───────────────────────────────────────────────────────────────────────
    //
    // The hazard the guard exists for: signed in on the tablet, a person opens the hub and sees the
    // workshop twice — the real records on one screen and whatever is in this browser on another, with
    // neither screen saying which it is. Somebody would make a decision on the wrong one.
    //
    // This check used to name the one page that was still unwired, and the example moved five times — the
    // hub, then Quality, then Suppliers, then Marketing, then Documents — each time because the screen it
    // named got wired. Documents was the last of them, so there is no example left to name: all seventeen
    // declare themselves wired and the guard has nothing to refuse.
    //
    // Which is the moment a guard quietly stops being tested. So it is asked directly instead: the page is
    // served with its declaration taken out, exactly as an unwired page would look, and the notice has to
    // appear and cover the screen. Intercepted rather than written to disk — nothing here touches the
    // files the server is serving to everything else.
    const everyPage = fs.readdirSync(path.join(__dirname, '..'))
      .filter((f) => f.endsWith('.html') && f !== 'login.html');
    const unwired = everyPage.filter((f) => !/window\.WORKSHOP_SERVER_READY\s*=\s*true/
      .test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')));
    assert.deepEqual(unwired, [], `these pages are still not wired: ${unwired.join(', ')}`);
    step(`Two worlds: all ${everyPage.length} screens are on the database — there is no second world left`);

    // Now the guard, against a page pretending not to be wired.
    await page.route(`**/documents-desktop.html`, async (route) => {
      const held = fs.readFileSync(path.join(__dirname, '..', 'documents-desktop.html'), 'utf8');
      await route.fulfill({
        status: 200, contentType: 'text/html; charset=utf-8',
        body: held.replace(/window\.WORKSHOP_SERVER_READY\s*=\s*true;/, '')
      });
    });
    await page.goto(`${site}/documents-desktop.html`, { waitUntil: 'load' });
    const blocked = await page.locator('[role="alert"]').innerText();
    assert.match(blocked, /not connected to the server/,
      'a page that does not declare itself wired must refuse rather than show what is in this browser');
    step('Two worlds: signed in, a screen that is not wired refuses to show anything and says why');

    // Refused, not merely warned over the top. A page that shows stale figures with a banner is a
    // page somebody reads past — so the check is that the figures are not on screen at all.
    const stillShowing = await page.evaluate(() => {
      const alert = document.querySelector('[role="alert"]');
      if (!alert) return 'no notice at all';
      const box = alert.getBoundingClientRect();
      // The notice covers the viewport, so nothing behind it is readable.
      return (box.width >= window.innerWidth && box.height >= window.innerHeight) ? '' : 'the notice does not cover the page';
    });
    assert.equal(stillShowing, '', stillShowing);
    step('Two worlds: it covers the page rather than sitting over the top of stale figures');

    // And it stays out of the way when there is no session: that is the app somebody can still open
    // without signing in, and the guard has nothing to say to them.
    const guest = await context.newPage();
    await guest.goto(`${site}/documents-desktop.html`, { waitUntil: 'load' });
    assert.equal(await guest.locator('[role="alert"]').count(), 0,
      'with no session the pages must work exactly as they did before');
    assert.ok(await guest.locator('body').isVisible());
    await guest.close();
    step('Two worlds: with no session every page works exactly as it did — the guard only speaks to a signed-in one');

    await page.unroute(`**/documents-desktop.html`);
    // And the real page, which is wired, opens without the notice.
    await page.goto(`${site}/documents-desktop.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
    assert.equal(await page.locator('[role="alert"]').count(), 0,
      'the register itself is wired and must open');
    step('Two worlds: and the register itself — the seventeenth screen — opens on the database');

    await page.goto(`${site}/hours-mobile.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(), { timeout: 8000 });
    assert.equal(await page.locator('[role="alert"]').count(), 0,
      'the wired page must not be blocked by the guard');
    step('Two worlds: and the wired screen is not blocked by it');

    // ── Signing out ─────────────────────────────────────────────────────────────────────────
    await page.evaluate(() => window.WorkshopApi.signOut());
    assert.equal(value(`SELECT count(*) FROM app_session WHERE ended_at IS NOT NULL;`), '1');
    const after = await page.evaluate(() => window.WorkshopApi.snapshot());
    assert.equal(after.signedOut, true, 'once signed out the snapshot should say so rather than returning data');
    step('Login: signing out ends the session in the database, and the page is told it is out');

    assert.deepEqual([...new Set(thrown)], [], `the page threw: ${[...new Set(thrown)].join(' / ')}`);

    // The refusals this test provoked on purpose, by endpoint.
    const provoked = /\/api\/(read\/money|read\/snapshot|rpc\/send_estimate|auth\/sign-in)/;
    const ours = failed.filter((f) => f.url.startsWith(site));
    const unexpected = ours.filter((f) =>
      f.why !== 'net::ERR_ABORTED' && !provoked.test(f.url) && !/favicon/.test(f.url));
    assert.deepEqual(unexpected.map((f) => `${f.why} ${f.url}`), [],
      'requests to our own server failed that this test did not provoke');
    step('Page: every failed request to our own server was either a refusal this test provoked or a navigation cancelling a fetch');

    // Not our fault, and not a failure — but worth saying out loud, because the pages fetch their
    // typefaces from an external CDN and a workshop in a steel hall is exactly where that does not
    // arrive. The pages fall back to system fonts, which is why nothing here looks broken.
    const external = [...new Set(failed.filter((f) => !f.url.startsWith(site)).map((f) => new URL(f.url).host))];
    if (external.length) {
      console.log(`     (the pages also asked ${external.join(', ')} for fonts and did not get them — `
        + 'system fonts were used instead)');
    }
    console.log(`\n${checks} checks: a welder signed in on a tablet and their hours are in Postgres.`);
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
