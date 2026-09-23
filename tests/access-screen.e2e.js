'use strict';

// The screen that decides who gets in, driven the way a person drives it.
//
// Until this page existed, adding somebody to this system meant opening psql — which is not a
// workshop using software, it is a workshop phoning whoever wrote it. So the screen matters, and so
// does testing it through the buttons rather than through the functions behind them: the workflows
// in api.sql already have their own suite, and every one of them passing did not stop the page from
// being unusable. What is asked here is the other half — that the thing on screen is true.
//
// Two of these checks are the reason the page exists at all:
//
//   * add_person deliberately creates somebody who cannot sign in, and the list has to SAY so. An
//     admin who reads "added" and walks away has given nobody anything, and will find out when a
//     welder stands at a tablet at six in the morning.
//   * An admin must not be offered the two moves that lock the building from the inside — switching
//     themselves off, taking away their own admin. The database refuses both; this asserts the
//     buttons are not there to press, which is a different promise and worth its own check.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_access_test';
const HTTP_PORT = Number(process.env.VARMAK_ACCESS_PORT || 8913);

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

// Empty on purpose. This is the only suite that starts from a system with nobody in it, because
// that is the state the first administrator is made in and it exists exactly once.
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

const rowFor = (page, email) => page.locator('#peopleRows tr').filter({ hasText: email });

// Waiting on a chip rather than on the row's text, and that distinction is not fussiness: the row
// also holds a button labelled "Set PIN", so waiting for the row to contain "PIN" returns
// immediately and every assertion after it runs against the list as it was before the click. It did,
// and the failure looked like the PIN not being set.
function waitForChip(page, email, chip) {
  return page.waitForFunction(([mail, want]) => {
    const row = [...document.querySelectorAll('#peopleRows tr')].find((r) => r.textContent.includes(mail));
    return !!row && [...row.querySelectorAll('.chip')].some((c) => c.textContent.trim() === want);
  }, [email, chip], { timeout: 8000 });
}

async function main() {
  buildDatabase();
  assert.equal(value(`SELECT count(*) FROM app_user;`), '0', 'this suite starts from nobody');

  process.env.PGDATABASE = DB;
  process.env.PORT = String(HTTP_PORT);
  const { server, pool } = require('../backend/server');
  await new Promise((resolve) => server.listen(HTTP_PORT, resolve));
  const site = `http://127.0.0.1:${HTTP_PORT}`;

  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const thrown = [];
  page.on('pageerror', (error) => thrown.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() !== 'error') return;
    if (/favicon|net::|Failed to load resource/.test(text)) return;
    thrown.push(text);
  });

  try {
    // ── An empty system ─────────────────────────────────────────────────────────────────────
    await page.goto(`${site}/admin.html`, { waitUntil: 'load' });
    await page.waitForSelector('#signedOut:not([hidden])', { timeout: 8000 });
    assert.equal(await page.locator('#peoplePanel').isVisible(), false);
    assert.equal(await page.locator('#addPanel').isVisible(), false,
      'nobody is signed in, so there is nothing to add anybody with');
    step('Access: with nobody signed in the screen offers the way in and nothing else');

    // The database's own rules on a password, reaching the screen in its own words.
    await page.locator('#firstEmail').fill('anna@varmak.se');
    await page.locator('#firstName').fill('Anna Berg');
    await page.locator('#firstPassword').fill('short');
    await page.locator('#firstForm button[type="submit"]').click();
    await page.waitForSelector('#firstSaid:not([hidden])', { timeout: 5000 });
    const shortRefusal = await page.locator('#firstSaid').innerText();
    assert.match(shortRefusal, /twelve characters/,
      `the screen should show the database's wording: ${shortRefusal}`);
    assert.equal(value(`SELECT count(*) FROM app_user;`), '0', 'a refused password must create nobody');
    step('Access: a too-short password is refused in the database\'s words, and creates nobody');

    await page.locator('#firstPassword').fill('correct horse battery staple');
    await page.locator('#firstForm button[type="submit"]').click();
    await page.waitForFunction(() => {
      const el = document.getElementById('firstSaid');
      return el && !el.hidden && el.classList.contains('done');
    }, { timeout: 5000 });
    assert.equal(value(`SELECT count(*) FROM app_user;`), '1');
    assert.equal(value(`SELECT role::text FROM app_user WHERE email = 'anna@varmak.se';`), 'admin');
    step('Access: the first administrator is made from the screen, on an empty system, with no session');

    // And the door shuts. Not a flag anybody has to remember to turn off.
    await page.locator('#firstEmail').fill('someone@varmak.se');
    await page.locator('#firstName').fill('Someone Else');
    await page.locator('#firstPassword').fill('another long passphrase');
    await page.locator('#firstForm button[type="submit"]').click();
    await page.waitForFunction(() => {
      const el = document.getElementById('firstSaid');
      return el && !el.hidden && el.classList.contains('refused');
    }, { timeout: 5000 });
    assert.match(await page.locator('#firstSaid').innerText(), /already has people in it/);
    assert.equal(value(`SELECT count(*) FROM app_user;`), '1');
    step('Access: and the first-run form shuts behind them — a second use is refused');

    // ── Signed in as that administrator ─────────────────────────────────────────────────────
    await page.goto(`${site}/login.html`, { waitUntil: 'load' });
    await page.waitForSelector('#signInForm:not([hidden])', { timeout: 5000 });
    await page.locator('#signInEmail').fill('anna@varmak.se');
    await page.locator('#signInSecret').fill('correct horse battery staple');
    await page.locator('#signInGo').click();
    await page.waitForURL(/hours-mobile\.html|hub-/, { timeout: 8000 });

    await page.goto(`${site}/admin.html`, { waitUntil: 'load' });
    await page.waitForSelector('#peoplePanel:not([hidden])', { timeout: 8000 });
    assert.equal(await page.locator('[role="alert"]').count(), 0,
      'this page is wired, so the two-worlds guard must not block it');
    assert.equal(await page.locator('#peopleRows tr').count(), 1);
    const mine = rowFor(page, 'anna@varmak.se');
    await assertChips(mine, ['Password'], ['PIN', 'No way in yet']);
    // Case-insensitive: the marker is upper-cased by CSS, so innerText says YOU. Asserting the
    // exact casing would be asserting a stylesheet.
    assert.match(await mine.innerText(), /\bYou\b/i, 'your own row should say so');
    step('Access: the administrator signs in and the list is the database\'s — one person, with a password');

    // The two moves that lock the building from the inside are not offered on your own row.
    assert.equal(await mine.locator('button', { hasText: 'Switch off' }).count(), 0,
      'an admin must not be offered the button that switches themselves off');
    assert.equal(await mine.locator('button', { hasText: 'Role' }).count(), 0,
      'nor the one that takes away their own admin');
    assert.equal(await mine.locator('button', { hasText: 'Set PIN' }).count(), 1,
      'they may still give themselves a PIN — that locks nobody out');
    step('Access: your own row is not offered the two moves that would lock the building from inside');

    // ── Adding somebody, and the state they arrive in ───────────────────────────────────────
    await page.locator('#addEmail').fill('marko@varmak.se');
    await page.locator('#addName').fill('Marko Ilic');
    await page.locator('#addRole').selectOption('workshop');
    await page.locator('#addForm button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#peopleRows tr').length === 2, { timeout: 8000 });

    const marko = rowFor(page, 'marko@varmak.se');
    // The check this whole page exists for. add_person leaves somebody unable to sign in, and the
    // screen has to say it rather than leave an admin thinking the job is done.
    await assertChips(marko, ['No way in yet'], ['PIN', 'Password']);
    assert.equal(value(`SELECT (password_hash IS NULL AND pin_hash IS NULL)::text
      FROM app_user WHERE email = 'marko@varmak.se';`), 'true');
    assert.equal(value(`SELECT coalesce((SELECT token FROM sign_in('marko@varmak.se', '8472', 'pin')), 'none');`),
      'none', 'the screen says they have no way in, and the door has to agree');
    step('Access: a new person arrives with no way in, and the screen says so instead of implying otherwise');

    // ── Giving them one ─────────────────────────────────────────────────────────────────────
    await marko.locator('button', { hasText: 'Set PIN' }).click();
    await page.waitForSelector('#modal.show', { timeout: 5000 });
    await page.locator('#modalValue').fill('0000');
    await page.locator('#modalSave').click();
    await page.waitForSelector('#peopleSaid.refused', { timeout: 5000 });
    assert.match(await page.locator('#peopleSaid').innerText(), /first a stranger would try/);
    await assertChips(rowFor(page, 'marko@varmak.se'), ['No way in yet'], []);
    step('Access: a PIN a stranger would try first is refused, in the database\'s words, and nothing changes');

    await rowFor(page, 'marko@varmak.se').locator('button', { hasText: 'Set PIN' }).click();
    await page.waitForSelector('#modal.show', { timeout: 5000 });
    await page.locator('#modalValue').fill('8472');
    await page.locator('#modalSave').click();
    await waitForChip(page, 'marko@varmak.se', 'PIN');
    await assertChips(rowFor(page, 'marko@varmak.se'), ['PIN'], ['No way in yet', 'Password']);
    assert.match(value(`SELECT coalesce((SELECT token FROM sign_in('marko@varmak.se', '8472', 'pin')), 'none');`),
      /^[0-9a-f]{64}$/, 'once the screen shows a PIN, the PIN has to work');
    step('Access: the PIN is set from the screen, the list moves, and the welder can sign in');

    // ── Switching somebody off ──────────────────────────────────────────────────────────────
    const held = value(`SELECT token FROM app_session ORDER BY started_at DESC LIMIT 1;`);
    await rowFor(page, 'marko@varmak.se').locator('button', { hasText: 'Switch off' }).click();
    await page.waitForSelector('.waskwrap', { timeout: 5000 });
    assert.match(await page.locator('.waskmsg').innerText(), /tablet they are holding right now/,
      'the question has to say what switching somebody off actually does');
    await page.locator('.waskyes').click();
    await waitForChip(page, 'marko@varmak.se', 'Switched off');
    assert.equal(value(`SELECT is_active::text FROM app_user WHERE email = 'marko@varmak.se';`), 'false');
    assert.equal(value(`SELECT coalesce(session_owner('${held}')::text, 'nobody');`), 'nobody',
      'the tablet they were already holding must stop working, not just the next sign-in');
    step('Access: switching somebody off from the screen ends the session they are holding right now');

    await rowFor(page, 'marko@varmak.se').locator('button', { hasText: 'Switch on' }).click();
    await page.waitForSelector('.waskwrap', { timeout: 5000 });
    await page.locator('.waskyes').click();
    await waitForChip(page, 'marko@varmak.se', 'Active');
    step('Access: and switching them back on is the same screen, not a database console');

    // ── Your own password ───────────────────────────────────────────────────────────────────
    await page.locator('#meCurrent').fill('not my password');
    await page.locator('#meNew').fill('a completely new passphrase');
    await page.locator('#meForm button[type="submit"]').click();
    await page.waitForSelector('#meSaid.refused', { timeout: 5000 });
    assert.match(await page.locator('#meSaid').innerText(), /not your current password/);
    step('Access: changing your own password without knowing the current one is refused');

    await page.locator('#meCurrent').fill('correct horse battery staple');
    await page.locator('#meNew').fill('a completely new passphrase');
    await page.locator('#meForm button[type="submit"]').click();
    await page.waitForSelector('#meSaid.done', { timeout: 5000 });
    assert.match(value(`SELECT coalesce((SELECT token FROM sign_in('anna@varmak.se', 'a completely new passphrase', 'password')), 'none');`),
      /^[0-9a-f]{64}$/);
    assert.equal(value(`SELECT coalesce((SELECT token FROM sign_in('anna@varmak.se', 'correct horse battery staple', 'password')), 'none');`),
      'none', 'the old password must stop working the moment it is changed');
    step('Access: and with it, the old one stops working in the same moment');

    // ── The same screen, as a welder ────────────────────────────────────────────────────────
    const floor = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const tablet = await floor.newPage();
    tablet.on('pageerror', (error) => thrown.push(`tablet: ${error.message}`));
    await tablet.goto(`${site}/login.html`, { waitUntil: 'load' });
    await tablet.waitForSelector('#signInForm:not([hidden])', { timeout: 5000 });
    await tablet.locator('#doorPin').click();
    await tablet.locator('#signInEmail').fill('marko@varmak.se');
    await tablet.locator('#signInSecret').fill('8472');
    await tablet.locator('#signInGo').click();
    await tablet.waitForURL(/hours-mobile\.html/, { timeout: 8000 });

    await tablet.goto(`${site}/admin.html`, { waitUntil: 'load' });
    await tablet.waitForSelector('#peoplePanel:not([hidden])', { timeout: 8000 });
    // Row-level security, not the page. The welder's request comes back with one row in it.
    assert.equal(await tablet.locator('#peopleRows tr').count(), 1);
    assert.match(await tablet.locator('#peopleRows tr').innerText(), /marko@varmak\.se/);
    assert.ok(!(await tablet.locator('#peopleRows').innerText()).includes('anna@varmak.se'),
      'a welder must not see the administrator through this screen');
    assert.equal(await tablet.locator('#addPanel').isVisible(), false,
      'a welder is not offered a form whose every use the database would refuse');
    assert.equal(await tablet.locator('#peopleRows button').count(), 0,
      'nor any of the buttons that only an admin may press');
    assert.equal(await tablet.locator('#mePanel').isVisible(), true,
      'their own password is still theirs to change');
    step('Access: a welder on the same screen sees one row — their own — and none of the admin buttons');

    // Not one hash reaches any of it, in either shape.
    for (const [who, target] of [['the admin', page], ['the welder', tablet]]) {
      const html = await target.content();
      assert.ok(!/\$2[aby]\$\d{2}\$/.test(html), `a bcrypt hash was rendered to ${who}`);
    }
    step('Access: no hash of a password or a PIN is anywhere on the page, for either of them');

    await floor.close();
    assert.deepEqual([...new Set(thrown)], [], `the page threw: ${[...new Set(thrown)].join(' / ')}`);
    console.log(`\n${checks} checks: a workshop gave somebody access, and took it away, without opening psql.`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

// Chips rather than raw text, because "PIN" appears in the header and in the lede as well, and a
// substring match on the whole row passed once while the row said nothing of the kind.
async function assertChips(row, expected, absent) {
  const chips = (await row.locator('.chip').allInnerTexts()).map((s) => s.trim());
  for (const want of expected) {
    assert.ok(chips.includes(want), `expected the chip "${want}", row has: ${chips.join(', ') || 'none'}`);
  }
  for (const not of absent) {
    assert.ok(!chips.includes(not), `the chip "${not}" should not be there, row has: ${chips.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(`\n${error.message || error}`);
  process.exitCode = 1;
  process.exit(1);
});
