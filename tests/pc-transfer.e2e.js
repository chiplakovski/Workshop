'use strict';

// Moving the one-computer copy online. The PC copy is built the way a workshop would have built it —
// through the browser data layer, a customer with a contact, a supplier, steel received as two heats
// and partly issued, a project, a jobcard with steps, a machine, a certificate with its file, the
// letterhead — saved as the file "Save a copy" writes, and then sent to a real server through the same
// workflows the screens use. Then sent again, to show that a second run changes nothing. Then once more
// through the Access screen itself, the way the administrator will actually do it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');
const { loadEmptyWorkshopData } = require('./helpers/load-workshop-data');
const PcTransfer = require('../pc-transfer.js');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_transfer_test';
const HTTP_PORT = Number(process.env.VARMAK_TRANSFER_PORT || 8961);

const conn = () => ['-h', HOST, '-p', PORT, '-U', USER, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-qtAX'];
const sql = (text) => execFileSync('psql', conn(), { input: text, encoding: 'utf8' }).trim();
const value = (text) => sql(text).split('\n')[0].trim();

let checks = 0;
const step = (message) => { checks += 1; console.log(`OK   ${message}`); };

function findBrowser() {
  const found = [process.env.PLAYWRIGHT_CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean).find((c) => fs.existsSync(c));
  if (!found) throw new Error('No browser found. Set PLAYWRIGHT_CHROME_PATH.');
  return found;
}

function buildDatabase() {
  ensureUp();
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', 'postgres', '-qtAX',
    '-c', `DROP DATABASE IF EXISTS ${DB};`, '-c', `CREATE DATABASE ${DB};`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  for (const name of ['schema', 'auth', 'api', 'views']) {
    const file = process.env[`VARMAK_${name.toUpperCase()}`] || path.join(__dirname, '..', 'backend', `${name}.sql`);
    execFileSync('psql', [...conn(), '-f', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Test Office', 'correct horse battery staple');`);
}

// The PC copy, entered through the browser's own data layer and taken as "Save a copy" writes it.
function aPcCopy() {
  const WD = loadEmptyWorkshopData();
  WD.setCompany({ orgNo: '5560125790', vat: 'SE556012579001', fSkatt: true, bankgiro: '123-4567' });
  const customer = WD.upsertCustomer({ name: 'Test Transfer Kund AB', city: 'Lund', org: '811218-9876',
    contacts: [{ name: 'Test Contact', role: 'Buyer', email: 'buyer@example.com', phone: '', primary: true }] });
  WD.upsertSupplier({ name: 'Test Transfer Stål AB', category: 'Steel', country: 'Sweden', org: '556012-5790',
    contacts: [['TC', 'Test Seller', 'Sales', 'sales@example.com', '']] });
  WD.createInventoryItem({ code: 'TT-PL10', description: 'Plate 10 transfer', group: 'materials', unit: 'KG',
    location: 'R1', stock: 0, minStock: 0, reorderQty: 0, avgCost: 14, lastPrice: 14, supplier: 'Test Transfer Stål AB' });
  WD.receive({ code: 'TT-PL10', qty: 30, supplier: 'Test Transfer Stål AB', heat: 'HT-T1', certificate: 'MTC-T1.pdf' });
  WD.receive({ code: 'TT-PL10', qty: 10, supplier: 'Test Transfer Stål AB' });
  const project = WD.upsertProject({ name: 'Test transfer frame', customer: customer.name, customerId: customer.id });
  WD.issue({ code: 'TT-PL10', projectNo: project.no, qty: 5, jobcard: 'JC-PC-1', heat: 'HT-T1' });
  const job = WD.upsertJobcard({ projectNo: project.no, title: 'Transfer weldment' });
  WD.addJobcardOperation(job.no, { desc: 'Cut plates', plannedHours: 2 });
  WD.addJobcardOperation(job.no, { desc: 'Weld frame', plannedHours: 6 });
  WD.createEquipment({ equipmentId: 'TT-EQ-1', name: 'MIG transfer', category: 'Welding' });
  const body = 'Test certificate 3.1 body';
  WD.upsertDocument({ name: 'Test transfer certificate', type: 'Certificate', module: 'Projects', record: project.no,
    category: 'General', status: 'Valid', revision: '1', fileName: 'cert-3.1.pdf', mimeType: 'application/pdf',
    fileSize: body.length, fileData: 'data:application/pdf;base64,' + Buffer.from(body).toString('base64') });
  WD.logHours({ jobcard: job.no, worker: 'Test Welder', user: 'Test Welder', hours: 4, date: '2026-10-01' });
  return JSON.parse(JSON.stringify(WD.get()));
}

async function main() {
  buildDatabase();
  process.env.PGDATABASE = DB;
  process.env.PORT = String(HTTP_PORT);
  const { server, pool } = require('../backend/server');
  await new Promise((resolve) => server.listen(HTTP_PORT, resolve));
  const site = `http://127.0.0.1:${HTTP_PORT}`;
  const api = `${site}/api`;
  const token = (await (await fetch(`${api}/auth/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'anna@varmak.se', secret: 'correct horse battery staple', door: 'password' }) })).json()).token;
  const auth = { authorization: `Bearer ${token}` };
  const io = {
    async call(name, args) {
      const r = await fetch(`${api}/rpc/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify(args) });
      const b = await r.json().catch(() => ({}));
      return r.status === 200 ? { ok: true, result: b.result } : { ok: false, refused: b.refused };
    },
    async snapshot() { return (await fetch(`${api}/read/snapshot`, { headers: auth })).json(); },
    async upload(id, dataUrl, name, type) {
      const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
      const r = await fetch(`${api}/files/${id}`, { method: 'POST', body: bytes,
        headers: { ...auth, 'content-type': type || 'application/octet-stream', 'x-filename': encodeURIComponent(name) } });
      const b = await r.json().catch(() => ({}));
      return r.status === 200 ? { ok: true } : { ok: false, refused: b.refused };
    }
  };

  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const copy = aPcCopy();
    assert.equal(PcTransfer.check({ hello: 'world' }), 'that file is not a saved copy of the workshop');
    const { counts, leftBehind } = PcTransfer.plan(copy);
    assert.deepEqual(counts, { company: 1, customers: 1, suppliers: 1, stock: 1, projects: 1, jobcards: 1, equipment: 1, documents: 1 });
    assert.equal(leftBehind.hours, 1, 'the hours entry is counted as left behind, not lost silently');
    step('Transfer: a saved copy is recognised, counted, and what will not move is named before anything is sent');

    const first = await PcTransfer.run(copy, io);
    const moved = Object.fromEntries(Object.entries(first.report).map(([k, r]) => [k, r.moved]));
    if (process.env.SHOW_REPORT) console.log(JSON.stringify(first.report, null, 1));
    assert.deepEqual(moved, { company: 1, customers: 1, suppliers: 1, stock: 1, projects: 1, jobcards: 1, equipment: 1, documents: 1 },
      JSON.stringify(first.report, null, 1));
    const refusedHard = Object.values(first.report).flatMap((r) => r.refused);
    assert.deepEqual(refusedHard, [], `nothing should have been refused: ${JSON.stringify(refusedHard)}`);
    step('Transfer: every kind of record moved, and nothing was refused');

    assert.equal(value(`SELECT org_no || '|' || vat_no || '|' || f_skatt || '|' || bankgiro FROM company_profile;`),
      '556012-5790|SE556012579001|true|123-4567');
    assert.equal(value(`SELECT c.org_no || '|' || k.name || '|' || k.email FROM customer c JOIN customer_contact k ON k.customer_id = c.id
      WHERE c.name = 'Test Transfer Kund AB';`), '811218-9876|Test Contact|buyer@example.com');
    assert.equal(value(`SELECT s.org_no || '|' || k.name FROM supplier s JOIN supplier_contact k ON k.supplier_id = s.id
      WHERE s.name = 'Test Transfer Stål AB';`), '556012-5790|Test Seller');
    step('Transfer: the letterhead, a customer and a supplier arrive with their numbers and their contacts');

    assert.equal(value(`SELECT stock::text FROM stock_item WHERE code = 'TT-PL10';`), '35.000', 'what was on the shelf is on the shelf');
    assert.equal(value(`SELECT string_agg(coalesce(m.heat_no, 'untraced') || ':' || trim_scale(m.quantity) || ':' || coalesce(m.material_cert_ref, '-'), ' ' ORDER BY m.id)
      FROM stock_movement m JOIN stock_item s ON s.id = m.stock_item_id WHERE s.code = 'TT-PL10';`),
      'HT-T1:25:MTC-T1.pdf untraced:10:-', 'traced steel arrives per heat, with its certificate; the rest as one line');
    step('Transfer: steel arrives as an opening balance per heat, so a heat on the PC is still a heat online');

    assert.equal(value(`SELECT p.name || '|' || c.name FROM project p JOIN customer c ON c.id = p.customer_id;`),
      'Test transfer frame|Test Transfer Kund AB', 'the project points at the customer it pointed at on the PC');
    assert.equal(value(`SELECT j.title || '|' || string_agg(o.description, ',' ORDER BY o.seq) FROM jobcard j
      JOIN operation o ON o.jobcard_id = j.id GROUP BY j.title;`), 'Transfer weldment|Cut plates,Weld frame');
    assert.equal(value(`SELECT ref || '|' || name FROM equipment;`), 'TT-EQ-1|MIG transfer');
    step('Transfer: the project keeps its customer, the jobcard its project and steps, the machine its number');

    assert.equal(value(`SELECT d.entity || '|' || d.filename || '|' || convert_from(f.content, 'UTF8') FROM document d
      JOIN document_file f ON f.document_id = d.id WHERE d.title = 'Test transfer certificate';`),
      'project|cert-3.1.pdf|Test certificate 3.1 body', 'the certificate arrives linked to its project, with its file');
    assert.equal(value(`SELECT count(*) FROM hours_entry;`), '0', 'hours are not moved under somebody else\'s name');
    step('Transfer: a document arrives linked to the project, with its file — and no hours are booked in the wrong name');

    const before = value(`SELECT (SELECT count(*) FROM customer) || '|' || (SELECT count(*) FROM stock_movement) || '|' ||
      (SELECT count(*) FROM jobcard) || '|' || (SELECT count(*) FROM document)`);
    const second = await PcTransfer.run(copy, io);
    const again = Object.fromEntries(Object.entries(second.report).filter(([k]) => k !== 'company').map(([k, r]) => [k, [r.moved, r.alreadyThere]]));
    assert.deepEqual(again, { customers: [0, 1], suppliers: [0, 1], stock: [0, 1], projects: [0, 1], jobcards: [0, 1], equipment: [0, 1], documents: [0, 1] });
    assert.equal(value(`SELECT (SELECT count(*) FROM customer) || '|' || (SELECT count(*) FROM stock_movement) || '|' ||
      (SELECT count(*) FROM jobcard) || '|' || (SELECT count(*) FROM document)`), before, 'a second run moved nothing twice');
    step('Transfer: run twice, everything is already there and nothing is doubled');

    // ── The same, from the Access screen ────────────────────────────────────────────────────
    const extra = aPcCopy();
    extra.customers.push(Object.assign({}, extra.customers[0], { id: 9999, name: 'Test Transfer Andra AB', contacts: [] }));
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-copy-')), 'varmak-workshop-backup.json');
    fs.writeFileSync(file, JSON.stringify(extra));
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, timezoneId: 'Europe/Stockholm' })).newPage();
    const thrown = [];
    page.on('pageerror', (e) => thrown.push(e.message));
    await page.goto(`${site}/login.html`, { waitUntil: 'load' });
    await page.waitForSelector('#signInForm:not([hidden])', { timeout: 8000 });
    await page.locator('#signInEmail').fill('anna@varmak.se');
    await page.locator('#signInSecret').fill('correct horse battery staple');
    await page.locator('#signInGo').click();
    await page.waitForURL(/hub-desktop\.html/, { timeout: 8000 });
    await page.goto(`${site}/admin.html`, { waitUntil: 'load' });
    await page.waitForSelector('#transferPanel:not([hidden])', { timeout: 8000 });
    await page.locator('#transferFile').setInputFiles(file);
    await page.waitForSelector('#transferPlan:not([hidden])', { timeout: 5000 });
    assert.match(await page.locator('#transferPlan').innerText(), /Customers\s+2/);
    await page.locator('#transferGo').click();
    await page.locator('.waskyes').click();
    await page.waitForSelector('#transferSaid.done', { timeout: 20000 });
    const report = await page.locator('#transferReport').innerText();
    assert.match(report, /Customers\s+1\s+1\s+0/, `one new customer moved, one already there: ${report}`);
    assert.equal(value(`SELECT count(*) FROM customer WHERE name = 'Test Transfer Andra AB';`), '1');
    assert.deepEqual(thrown, []);
    step('Transfer: from the Access screen, the file is read, counted, sent, and reported row by row');
    console.log(`\n${checks} checks: a workshop's PC copy moved online, once, and the second time moved nothing.`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
