'use strict';

// The customers screen, on the database, driven through its own buttons.
//
// This is the third page to be wired and the first commercial one, so it is where the shape problem
// shows: the screen has always held `terms` as the words "30 days", the billing address as an array
// of lines and the customer type as "Company", while the database holds a count of days, one block of
// text and one of four words. customer-record.js translates, and its own unit tests cover the
// translation — what this asks is whether the translated thing survives a round trip through a real
// browser, a real server and a real Postgres.
//
// The check that matters most is the last one. save_customer REPLACES the record, and this screen
// shows perhaps two thirds of it. A page that saved only what it displays would clear the price list
// every time somebody corrected a telephone number, and nothing on screen would say so.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_customers_test';
const HTTP_PORT = Number(process.env.VARMAK_CUSTOMERS_PORT || 8915);

const conn = () => ['-h', HOST, '-p', PORT, '-U', USER, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-qtAX'];
const sql = (text) => execFileSync('psql', conn(), { input: text, encoding: 'utf8' }).trim();
const value = (text) => sql(text).split('\n')[0].trim();

let checks = 0;
const step = (message) => { checks += 1; console.log(`OK   ${message}`); };

// Waiting on the database rather than on the screen, which is not a detail.
//
// This page keeps drawing while a write is in flight — it has to, or every save would freeze it — so
// the array on screen grows the instant the form closes and a wait on the array is satisfied before
// anything has reached Postgres. Every check in this file is about what is in Postgres, so this is
// what it waits for. Two of the steps below were passing and then asking too early, which reads
// exactly like the write not happening at all.
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

// One customer with its whole record filled in, including the half this screen does not show — which
// is the half the last check is about.
function aWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const admin = value(`SELECT id FROM app_user WHERE email = 'anna@varmak.se';`);
  sql(`SET ROLE varmak_admin; SET app.user_id = '${admin}';
       SELECT add_person('marko@varmak.se', 'Marko Ilic', 'workshop');`);
  const welder = value(`SELECT id FROM app_user WHERE email = 'marko@varmak.se';`);
  sql(`SET ROLE varmak_admin; SET app.user_id = '${admin}'; SELECT set_person_pin(${welder}, '8472');`);

  const customer = value(`INSERT INTO customer
    (name, city, country, org_no, vat_no, email, phone, website, industry, customer_since,
     customer_type, preferred_contact, credit_limit, currency, payment_terms_days, price_list,
     delivery_terms, discount_agreement, billing_address)
    VALUES ('MarineVent AB', 'Malmö', 'Sweden', '556789-1234', 'SE556789123401',
            'info@marinevent.se', '+46 40 123 45 67', 'marinevent.se', 'Marine ventilation',
            '2023-03-15', 'direct', 'Email', 250000, 'SEK', 30, 'Standard Price List 2026',
            'EXW Marieholm', '0%', 'MarineVent AB' || chr(10) || 'Östra Varvsgatan 12' || chr(10) || '211 19 Malmö')
    RETURNING id;`);
  sql(`INSERT INTO customer_contact (customer_id, name, role, email, phone, is_primary)
       VALUES (${customer}, 'Per Bengtsson', 'CEO', 'per@marinevent.se', '+46 70 555 66 77', true);`);
  return { admin, welder, customer, ref: value(`SELECT ref FROM customer WHERE id = ${customer};`) };
}

async function signIn(page, site, email, secret, door) {
  await page.goto(`${site}/login.html`, { waitUntil: 'load' });
  await page.waitForSelector('#signInForm:not([hidden])', { timeout: 8000 });
  if (door === 'pin') await page.locator('#doorPin').click();
  await page.locator('#signInEmail').fill(email);
  await page.locator('#signInSecret').fill(secret);
  await page.locator('#signInGo').click();
  await page.waitForURL(/hours-mobile\.html|hub-/, { timeout: 8000 });
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  const thrown = [];
  page.on('pageerror', (error) => thrown.push(error.stack || error.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/favicon|net::|Failed to load resource/.test(m.text())) return;
    thrown.push(m.text());
  });

  try {
    // ── With no session, nothing changes ────────────────────────────────────────────────────
    const guest = await context.newPage();
    await guest.goto(`${site}/customers-desktop.html`, { waitUntil: 'load' });
    assert.equal(await guest.locator('[role="alert"]').count(), 0,
      'with no session this page is the browser-storage screen it has always been');
    await guest.close();
    step('Customers: with no session the screen is exactly what it was — browser storage, no guard');

    // ── Signed in as the office ─────────────────────────────────────────────────────────────
    await signIn(page, site, 'anna@varmak.se', 'correct horse battery staple', 'password');
    await page.goto(`${site}/customers-desktop.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
    assert.equal(await page.locator('[role="alert"]').count(), 0,
      'this page is wired, so the guard must let it through');

    const shown = await page.evaluate(() => {
      const c = CUSTOMERS[0];
      return { count: CUSTOMERS.length, name: c.name, terms: c.terms, credit: c.credit,
               ctype: c.ctype, preferred: c.preferred, billing: c.billing,
               contacts: c.contacts.length, primary: (c.contacts[0] || {}).name };
    });
    assert.equal(shown.count, 1, 'the list is the database\'s, not this browser\'s');
    assert.equal(shown.name, 'MarineVent AB');
    // The translations, on a real page rather than in a unit test.
    assert.equal(shown.terms, '30 days', 'a count of days reads as words on the screen');
    assert.equal(shown.credit, 250000, 'and the figure arrived as text and became a number to format');
    assert.equal(shown.ctype, 'Direct', '"direct" reads as a word');
    assert.equal(shown.preferred, 'Email', 'and the preferred contact is the method, not a flag');
    assert.deepEqual(shown.billing, ['MarineVent AB', 'Östra Varvsgatan 12', '211 19 Malmö'],
      'one block of text became the lines of an address card');
    assert.equal(shown.contacts, 1);
    assert.equal(shown.primary, 'Per Bengtsson');
    step('Customers: the office reads the workshop\'s own customers, in the shapes the screen draws');

    // ── Making one, through the form ────────────────────────────────────────────────────────
    await page.evaluate(() => openNewCustomer());
    await page.waitForSelector('#fov.show', { timeout: 5000 });
    await page.locator('#ncName').fill('Lomma Svets AB');
    await page.locator('#ncCity').fill('Lomma');
    await page.locator('#ncEmail').fill('order@lomma-svets.se');
    await page.locator('#ncTerms').fill('45 days');
    await page.locator('#ncCredit').fill('90000');
    await page.evaluate(() => saveNewCustomer());
    // Waited on the reference rather than on the length of the array. The array grows the instant the
    // form closes, because the screen keeps drawing while the write is in flight — so waiting on it
    // means asking Postgres before the write has arrived. sharedNo only ever comes back from the
    // database, so it is the signal that the round trip is done.
    const made = await until('the new customer to reach Postgres',
      () => value(`SELECT coalesce((SELECT id::text FROM customer WHERE name = 'Lomma Svets AB'), '');`));
    assert.match(made, /^\d+$/, 'the customer typed into the form is in Postgres');
    assert.equal(value(`SELECT payment_terms_days::text FROM customer WHERE id = ${made};`), '45',
      '"45 days" has to arrive as the number 45, or the column is holding a sentence');
    assert.equal(value(`SELECT credit_limit::text FROM customer WHERE id = ${made};`), '90000.00');
    assert.match(value(`SELECT ref FROM customer WHERE id = ${made};`), /^C-\d{3}$/,
      'and the reference comes from the sequence, not from the browser');
    assert.equal(value(`SELECT count(*) FROM activity_log WHERE entity = 'customer' AND action = 'created';`), '1');
    step('Customers: a customer typed into the form is in the database, with its terms as a number');

    // The same name again, refused by the database and shown in the database's words.
    await page.evaluate(() => openNewCustomer());
    await page.waitForSelector('#fov.show', { timeout: 5000 });
    await page.locator('#ncName').fill('Lomma Svets AB');
    await page.evaluate(() => saveNewCustomer());
    await page.waitForSelector('.waskwrap', { timeout: 8000 });
    const refusal = await page.locator('.waskmsg').innerText();
    assert.match(refusal, /already a customer called Lomma Svets AB/,
      `the screen should show the database's wording: ${refusal}`);
    assert.match(refusal, /C-\d{3}/, 'and which customer it already is');
    await page.locator('.waskyes').click();
    await page.waitForFunction(() => CUSTOMERS.length === 2, { timeout: 10000 });
    assert.equal(value(`SELECT count(*) FROM customer WHERE name = 'Lomma Svets AB';`), '1',
      'the refused one must not be in the database, and the screen must not still be showing it');
    step('Customers: the same name twice is refused in the database\'s words, and the screen goes back to the truth');

    // ── Contacts ────────────────────────────────────────────────────────────────────────────
    const marine = await page.evaluate((ref) => {
      const c = CUSTOMERS.find((x) => x.sharedNo === ref);
      return c ? c.id : null;
    }, w.ref);
    assert.ok(marine !== null, 'the MarineVent row should be on screen by its reference');
    await page.evaluate((id) => openAddContact(id), marine);
    await page.waitForSelector('#fov.show', { timeout: 5000 });
    await page.locator('#acName').fill('Lena Mårtensson');
    await page.locator('#acRole').fill('Purchasing');
    await page.locator('#acEmail').fill('lena@marinevent.se');
    await page.evaluate((id) => saveAddContact(id), marine);
    await page.waitForFunction(() => document.querySelector('#fov.show') === null, { timeout: 8000 });
    await until('the contact to reach Postgres',
      () => value(`SELECT count(*) FROM customer_contact WHERE customer_id = ${w.customer};`) === '2');
    assert.equal(value(`SELECT name FROM customer_contact WHERE customer_id = ${w.customer} AND is_primary;`),
      'Per Bengtsson', 'adding somebody must not move the main contact');
    step('Customers: a contact added on screen is in the database, and the main one stays the main one');

    // ── The check this whole file is for ────────────────────────────────────────────────────
    //
    // Correct one field. Every field this screen never shows has to still be there afterwards,
    // because save_customer replaces the record.
    await page.evaluate((id) => openEditCustomer(id), marine);
    await page.waitForSelector('#fov.show', { timeout: 5000 });
    await page.locator('#ecPhone').fill('+46 40 99 88 77');
    await page.evaluate((id) => saveEditCustomer(id), marine);
    await until('the corrected telephone number to reach Postgres',
      () => value(`SELECT phone FROM customer WHERE id = ${w.customer};`) === '+46 40 99 88 77');
    const kept = value(`SELECT coalesce(customer_type, 'GONE') || '|' || coalesce(price_list, 'GONE')
      || '|' || coalesce(discount_agreement, 'GONE') || '|' || coalesce(delivery_terms, 'GONE')
      || '|' || coalesce(vat_no, 'GONE') || '|' || coalesce(org_no, 'GONE')
      || '|' || coalesce(industry, 'GONE') || '|' || coalesce(customer_since::text, 'GONE')
      || '|' || coalesce(preferred_contact, 'GONE')
      FROM customer WHERE id = ${w.customer};`);
    assert.equal(kept, 'direct|Standard Price List 2026|0%|EXW Marieholm|SE556789123401|556789-1234|'
      + 'Marine ventilation|2023-03-15|Email',
      'correcting a telephone number cleared a field the screen never showed');
    assert.equal(value(`SELECT payment_terms_days::text || '|' || credit_limit::text
      FROM customer WHERE id = ${w.customer};`), '30|250000.00',
      'and the terms and the credit limit came back as numbers, not as the words on screen');
    assert.equal(value(`SELECT count(*) FROM customer;`), '2', 'a correction is not a new customer');
    step('Customers: correcting one field leaves every field the screen never showed exactly as it was');

    // ── What has no workflow yet is refused, not half-saved ─────────────────────────────────
    await page.evaluate((id) => openNewQuote(id), marine);
    await page.waitForSelector('#fov.show', { timeout: 5000 });
    await page.locator('#nqValue').fill('42000');
    await page.evaluate((id) => saveNewQuote(id), marine);
    await page.waitForSelector('.waskwrap', { timeout: 8000 });
    const notBuilt = await page.locator('.waskmsg').innerText();
    assert.match(notBuilt, /does not exist on the server yet/,
      `the screen has to say so rather than appear to save: ${notBuilt}`);
    assert.match(notBuilt, /Nothing was written/);
    await page.locator('.waskyes').click();
    assert.equal(value(`SELECT count(*) FROM estimate;`), '0', 'and nothing was written');
    step('Customers: a quote has no workflow yet, so the screen refuses it out loud rather than losing it');

    // ── A welder on the same screen ─────────────────────────────────────────────────────────
    const floor = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const tablet = await floor.newPage();
    tablet.on('pageerror', (error) => thrown.push(`tablet: ${error.message}`));
    await signIn(tablet, site, 'marko@varmak.se', '8472', 'pin');
    await tablet.goto(`${site}/customers-desktop.html`, { waitUntil: 'load' });
    await tablet.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });

    const asWelder = await tablet.evaluate(() => {
      const c = CUSTOMERS.find((x) => x.name === 'MarineVent AB');
      return { terms: c.terms, credit: c.credit, pricelist: c.pricelist, discount: c.discountAgreement,
               seesMoney: c.seesMoney, phone: c.phone, contact: (c.contacts[0] || {}).name };
    });
    assert.equal(asWelder.contact, 'Per Bengtsson', 'a welder can see who to ring');
    assert.equal(asWelder.phone, '+46 40 99 88 77');
    assert.equal(asWelder.seesMoney, false);
    assert.equal(asWelder.terms, '—', 'and is shown a dash where the terms would be, not a number');
    assert.equal(asWelder.credit, 0);
    assert.equal(asWelder.pricelist, '—');
    assert.equal(asWelder.discount, '—');
    // What is on the screen, not what is in the file. content() returns the inline script too, and
    // this page's own browser-storage path contains the words "Standard Price List" as a default —
    // so searching the source reports a leak that is not one, which it did.
    const onScreen = await tablet.evaluate(() => document.body.innerText);
    for (const figure of ['Standard Price List 2026', 'EXW Marieholm', '250']) {
      assert.ok(!onScreen.includes(figure),
        `"${figure}" was rendered to a welder: ${onScreen.slice(0, 400)}`);
    }
    step('Customers: a welder sees the customer and who to ring, and not one thing it is charged');

    // And cannot write, by the database rather than by the screen.
    const refused = await tablet.evaluate(async () => {
      const c = CUSTOMERS.find((x) => x.name === 'MarineVent AB');
      return window.WorkshopApi.call('save_customer',
        Object.assign(window.CustomerRecord.toServer(c), { name: 'Renamed By The Floor AB' }));
    });
    assert.equal(refused.ok, false);
    assert.match(refused.refused, /not yours to do/);
    assert.equal(value(`SELECT name FROM customer WHERE id = ${w.customer};`), 'MarineVent AB');
    step('Customers: and a welder asking the API directly to rename one is refused by the database');
    await floor.close();

    assert.deepEqual([...new Set(thrown)], [], `the page threw: ${[...new Set(thrown)].join(' / ')}`);
    console.log(`\n${checks} checks: the customers screen reads and writes Postgres, in its own shapes.`);
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
