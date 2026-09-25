'use strict';

// The supplier register on the database, driven through its own screen.
//
// The register was the thinnest table in the schema against the widest screen: a name, a town and a
// payment term, against a page showing an address, a VAT number, a website, what they sell, the
// Incoterms, a minimum order and a rating. So the page filled the rest in for itself — which is the bug
// fixed just before this wiring, and the reason this suite checks the blanks as carefully as the values.
//
// Five checks matter most:
//
//   * A merchant goes in the register from the four-field form, and the fifteen fields the form does not
//     show are not cleared by an edit made through it.
//   * One merchant per name, whatever case it is typed in. Two rows under one name is two merchants to
//     the system and one to whoever is ringing them.
//   * The contact list is replaced whole, with one main contact, and a refused replacement changes
//     nothing.
//   * A welder sees the merchant and not what this workshop pays them on — and the screen shows a dash
//     there rather than a guess.
//   * The price list is what they quote. The panel that used to be "Total spend" needs invoices this
//     system does not keep.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_suppliers_test';
const HTTP_PORT = Number(process.env.VARMAK_SUPPLIERS_PORT || 8955);

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

// An empty register, a welder to read it, and one item for a merchant to quote.
function aWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const welder = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('marko@varmak.se', 'Marko Ilic', 'workshop') RETURNING id;`);
  sql(`SELECT set_password(${welder}, 'a long enough passphrase');`);
  const item = value(`INSERT INTO stock_item (code, description, unit, stock, avg_cost)
    VALUES ('S355-10', 'Plate S355J2 10mm', 'KG', 300, 14.50) RETURNING id;`);
  return { welder, item, itemCode: 'S355-10' };
}

async function signIn(page, site, email, secret) {
  await page.goto(`${site}/login.html`, { waitUntil: 'load' });
  await page.waitForSelector('#signInForm:not([hidden])', { timeout: 8000 });
  await page.locator('#signInEmail').fill(email);
  await page.locator('#signInSecret').fill(secret);
  await page.locator('#signInGo').click();
  await page.waitForURL(/hours-mobile\.html|hub-/, { timeout: 8000 });
}

async function openSuppliers(page, site) {
  await page.goto(`${site}/suppliers-desktop.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
    { timeout: 8000 });
  assert.equal(await page.locator('[role="alert"]').count(), 0, 'the guard must let this page through');
}

async function main() {
  buildDatabase();
  const w = aWorkshop();
  assert.equal(value(`SELECT count(*) FROM supplier;`), '0', 'the register starts empty');

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
    await signIn(page, site, 'anna@varmak.se', 'correct horse battery staple');
    await openSuppliers(page, site);
    // An empty register is a state, not a fault.
    assert.match(await page.locator('#mainContent').innerText(), /No suppliers yet|first supplier/i,
      'an empty register says so and offers the one action that changes it');
    step('Suppliers: the register opens for a signed-in session, and says when it is empty');

    // ── Adding one ──────────────────────────────────────────────────────────────────────────
    const added = await page.evaluate(async () => {
      openModal('supplier');
      document.getElementById('supplierName').value = 'Nordic Steel';
      document.getElementById('supplierCategory').value = 'Steel & plate';
      document.getElementById('supplierCountry').value = 'Sweden';
      document.getElementById('supplierStatus').value = 'preferred';
      document.getElementById('modalForm').dispatchEvent(
        new Event('submit', { cancelable: true, bubbles: true }));
      return true;
    });
    assert.ok(added);
    await until('the merchant to reach Postgres', () => value(`SELECT count(*) FROM supplier;`) === '1');
    const merchant = value(`SELECT id FROM supplier;`);
    assert.match(value(`SELECT ref FROM supplier WHERE id = ${merchant};`), /^S-\d{3}$/);
    assert.equal(value(`SELECT name || '|' || category || '|' || country || '|' || status
      FROM supplier WHERE id = ${merchant};`), 'Nordic Steel|Steel & plate|Sweden|preferred',
      'the four fields the form asks for are the four that are saved');
    // And nothing else. The screen used to fill in an address, a VAT number, a telephone number and a
    // rating for a merchant nobody had entered them for.
    assert.equal(value(`SELECT coalesce(address,'-') || '|' || coalesce(vat_no,'-') || '|'
      || coalesce(phone,'-') || '|' || coalesce(rating::text,'-') || '|'
      || coalesce(delivery_terms,'-') || '|' || coalesce(payment_terms_days::text,'-')
      FROM supplier WHERE id = ${merchant};`), '-|-|-|-|-|-',
      'and what nobody entered is not in the register either');
    step('Suppliers: a merchant goes in from the form, and nothing else goes in with them');

    // ── The rest of the record, and the subset rule ──────────────────────────────────────────
    //
    // Polled, because the screen's own re-read is what puts the merchant in its register — the form
    // handler fires the save and does not wait for it.
    const onScreen = await until('the merchant to reach the screen', () => page.evaluate(
      () => ((window.WorkshopData.get().suppliers || [])[0] || {}).sharedId || null));
    assert.equal(String(onScreen), merchant);
    await page.evaluate(async () => {
      const answer = await window.WorkshopApi.call('save_supplier', {
        id: Number(window.WorkshopData.get().suppliers[0].sharedId),
        name: 'Nordic Steel', category: 'Steel & plate', status: 'preferred',
        org_no: '556123-4567', vat_no: 'SE556123456701', email: 'order@nordicsteel.se',
        phone: '+46 42 555 10 20', website: 'www.nordicsteel.se',
        address: 'Hamngatan 14, 252 21 Helsingborg', city: 'Helsingborg', country: 'Sweden',
        supplier_type: 'Company', established: '1994', delivery_terms: 'DAP',
        minimum_order: '5 000 SEK', currency: 'SEK', rating: 4.5, payment_terms_days: 30,
        notes: 'Cuts to length on request'
      });
      if (!answer.ok) throw new Error(answer.refused);
    });
    await openSuppliers(page, site);

    // The edit form shows four fields out of nineteen. Correcting the category through it must not clear
    // the other fifteen — fourth screen where this rule has had to be checked.
    const edited = await page.evaluate(() => {
      openModal('supplier', true);
      document.getElementById('supplierCategory').value = 'Steel, plate and tube';
      document.getElementById('modalForm').dispatchEvent(
        new Event('submit', { cancelable: true, bubbles: true }));
      return true;
    });
    assert.ok(edited);
    await until('the correction to reach Postgres',
      () => value(`SELECT category FROM supplier WHERE id = ${merchant};`) === 'Steel, plate and tube');
    assert.equal(value(`SELECT vat_no || '|' || address || '|' || minimum_order || '|' || delivery_terms
      || '|' || rating::text || '|' || payment_terms_days::text || '|' || notes
      FROM supplier WHERE id = ${merchant};`),
      'SE556700000001|Hamngatan 14, 252 21 Helsingborg|5 000 SEK|DAP|4.5|30|Cuts to length on request'
        .replace('SE556700000001', 'SE556123456701'),
      'correcting the category through a four-field form cannot clear the other fifteen');
    assert.equal(value(`SELECT count(*) FROM supplier;`), '1',
      'and it corrected the merchant rather than adding a second one');
    step('Suppliers: a form showing four fields out of nineteen does not clear the other fifteen');

    // ── One merchant per name ───────────────────────────────────────────────────────────────
    const twice = await page.evaluate(() => {
      openModal('supplier');
      document.getElementById('supplierName').value = 'NORDIC STEEL';
      document.getElementById('supplierCategory').value = 'Steel';
      document.getElementById('modalForm').dispatchEvent(
        new Event('submit', { cancelable: true, bubbles: true }));
      return new Promise((resolve) => setTimeout(() => resolve(
        document.getElementById('toast').textContent), 1200));
    });
    assert.match(twice, /already a supplier called/i,
      `the same merchant typed in capitals has to be refused: ${twice}`);
    assert.equal(value(`SELECT count(*) FROM supplier;`), '1');
    step('Suppliers: the same merchant typed twice is refused, in the words the database wrote');

    // ── Who to ring ─────────────────────────────────────────────────────────────────────────
    const contact = await page.evaluate(() => {
      openModal('contact');
      document.getElementById('contactName').value = 'Erik Lund';
      document.getElementById('contactRole').value = 'Order desk';
      document.getElementById('contactEmail').value = 'order@nordicsteel.se';
      document.getElementById('contactPhone').value = '+46 42 555 10 20';
      document.getElementById('modalForm').dispatchEvent(
        new Event('submit', { cancelable: true, bubbles: true }));
      return true;
    });
    assert.ok(contact);
    await until('the contact to reach Postgres',
      () => value(`SELECT count(*) FROM supplier_contact WHERE supplier_id = ${merchant};`) === '1');
    assert.equal(value(`SELECT name || '|' || role || '|' || email || '|' || is_primary::text
      FROM supplier_contact WHERE supplier_id = ${merchant};`),
      'Erik Lund|Order desk|order@nordicsteel.se|true',
      'the first contact in the list is the main one, which is what the screen chips');
    await openSuppliers(page, site);
    assert.match(await page.locator('#contacts').innerText(), /Erik Lund/,
      'and it comes back onto the screen');
    step('Suppliers: a contact is added and reads back, with the initials worked out rather than stored');

    // ── A note ──────────────────────────────────────────────────────────────────────────────
    await page.evaluate(() => {
      openModal('note');
      document.getElementById('noteText').value = 'Lead time up to three weeks in January';
      document.getElementById('modalForm').dispatchEvent(
        new Event('submit', { cancelable: true, bubbles: true }));
    });
    await until('the note to reach Postgres', () => value(`SELECT count(*) FROM activity_log
      WHERE entity = 'supplier' AND entity_id = ${merchant} AND action = 'note';`) === '1');
    assert.equal(value(`SELECT actor FROM activity_log
      WHERE entity = 'supplier' AND entity_id = ${merchant} AND action = 'note';`), 'Anna Berg',
      'a note carries whoever wrote it, from the session rather than from the page');
    await openSuppliers(page, site);
    assert.match(await page.locator('#notes').innerText(), /three weeks in January/);
    step('Suppliers: a note goes into the append-only trail and comes back into the panel');

    // ── The price list ──────────────────────────────────────────────────────────────────────
    await page.evaluate(async (item) => {
      const answer = await window.WorkshopApi.call('save_supplier_item', {
        supplier_id: Number(window.WorkshopData.get().suppliers[0].sharedId),
        stock_item_id: Number(item), price: 13.9, article_no: 'ST-10-S355', currency: 'SEK',
        pack_size: 1, lead_time_days: 5, is_preferred: true
      });
      if (!answer.ok) throw new Error(answer.refused);
    }, w.item);
    await openSuppliers(page, site);
    const prices = await page.locator('#itemsTable').innerText();
    assert.match(prices, /ST-10-S355/, `the merchant's own article number has to be on the panel: ${prices}`);
    assert.match(prices, /13\.90 SEK/, 'and their price, as the exact decimal the column holds');
    assert.equal(/Total spend/i.test(prices), false,
      'the panel is what they quote, not what has been bought — that needs invoices nobody keeps');
    step('Suppliers: the price panel answers what a merchant quotes, which is a question the register has');

    // ── What a welder sees ──────────────────────────────────────────────────────────────────
    const floor = await context.newPage();
    floor.on('pageerror', (error) => thrown.push(error.stack || error.message));
    await signIn(floor, site, 'marko@varmak.se', 'a long enough passphrase');
    await openSuppliers(floor, site);
    const asWelder = await floor.locator('#mainContent').innerText();
    assert.match(asWelder, /Nordic Steel/, 'a welder who rejected a batch can say whose steel it was');
    assert.match(asWelder, /Hamngatan 14/, 'and where it came from');
    assert.equal(/30 days|30 dagar/.test(asWelder), false,
      'what this workshop is paid on is a commercial term, and the floor is not shown one');
    // A dash, not a blank and not a guess. The screen used to invent this whole line.
    const info = await floor.locator('#supplierInfo').innerText();
    assert.match(info, /—/, `the terms read as a blank rather than as a figure: ${info}`);
    const floorPrices = await floor.locator('#itemsTable').innerText();
    assert.equal(/13\.90/.test(floorPrices), false, 'and a price list is a price');
    step('Suppliers: a welder reads the merchant and the address, and neither the terms nor the prices');

    const refused = await floor.evaluate(async () => {
      const answer = await window.WorkshopApi.call('save_supplier', { id: null, name: 'Cheap Steel Ltd' });
      return answer.ok ? 'nothing was refused' : answer.refused;
    });
    assert.match(refused, /not yours to do/, `the floor cannot add a merchant: ${refused}`);
    assert.equal(value(`SELECT count(*) FROM supplier;`), '1');
    step('Suppliers: and cannot add one — the register is the office\'s');

    // ── Nothing went into browser storage ───────────────────────────────────────────────────
    const stored = await page.evaluate(() => {
      try { return localStorage.getItem('varmak.workshop.v1'); } catch (e) { return null; }
    });
    assert.ok(!stored || !stored.includes('Nordic Steel'),
      'the register was also written into browser storage, which is a second copy nobody reconciles');
    step('Suppliers: and nothing went into browser storage — the register is in one place');

    // ── What this screen cannot do yet ──────────────────────────────────────────────────────
    const order = await page.evaluate(() => {
      const answer = window.WorkshopData.upsertPurchaseOrder({ supplier: 'Nordic Steel', value: 1000 });
      return answer && answer.error ? answer.error : 'nothing was refused';
    });
    assert.match(order, /not on the workshop database yet/,
      `raising a purchase order has no workflow and has to say so: ${order}`);
    const doc = await page.evaluate(() => {
      const answer = window.WorkshopData.upsertDocument({ name: 'Agreement.pdf', module: 'Suppliers' });
      return answer && answer.error ? answer.error : 'nothing was refused';
    });
    assert.match(doc, /not on the workshop database yet/, doc);
    step('Suppliers: a purchase order and a document refuse out loud, and write nothing');

    assert.deepEqual(thrown, [], `the page threw: ${thrown.slice(0, 3).join(' / ')}`);
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
    server.close();
  }
  console.log(`\n${checks} checks: the supplier register is the workshop's, and what nobody entered `
    + 'about a merchant is not in it.');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
