'use strict';

// The document register on the database, driven through its own screen.
//
// The last screen to be wired, and it had been waiting on object storage — which was the wrong thing to
// wait for. What matters in a document register is not the bytes: it is that the material certificate for
// this heat runs out on the 12th, that revision B supersedes revision A, and which job the welding
// procedure on file belongs to. All of that is metadata, and a browser holding it means the answer to
// "which certificates expire this month" lives on one person's laptop.
//
// What these checks hold to:
//
//   * A document is filed from the form and arrives in Postgres with the fields the form asked for and
//     nothing else — no author, no revision and no category that nobody typed.
//   * A link is resolved and a reference nothing answers to is refused, by name. A certificate filed
//     against a project number that does not exist is a certificate nobody will find.
//   * 'Review Soon' and 'Expired' are worked out from the expiry date on every read and are never stored.
//     A register whose status column says "Review Soon" is a register that was right one morning.
//   * Superseding keeps the old revision on file, and cannot happen twice.
//   * A welder READS the register, including a document filed against a purchase order — and still gets
//     the whole snapshot. That is the third time a list in the snapshot touching an office-only table has
//     closed the door on the floor, and the first two were found in production code.
//   * The file itself is refused out loud, and the refusal says what was kept.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
// Named from the environment when the mutation harness is driving, so a damaged copy of one backend file
// is actually the one this suite builds against. A suite that ignores that override silently builds the real
// files and reports every mutation as uncaught — and a run where everything is MISSED reads as a row of
// untested rules when it is a harness fault. That happened once already, to all five views.sql mutations.
const DB = process.env.VARMAK_TEST_DB || 'varmak_documents_test';
const HTTP_PORT = Number(process.env.VARMAK_DOCUMENTS_PORT || 8957);

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
    const file = process.env[`VARMAK_${name.toUpperCase()}`]
      || path.join(__dirname, '..', 'backend', `${name}.sql`);
    execFileSync('psql', [...conn(), '-f', file],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
}


// An empty register, a welder to read it, and four kinds of record to file against.
function aWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const welder = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('marko@varmak.se', 'Marko Ilic', 'workshop') RETURNING id;`);
  sql(`SELECT set_password(${welder}, 'a long enough passphrase');`);
  const customer = value(`INSERT INTO customer (name, city) VALUES ('MarineVent AB', 'Malmö') RETURNING id;`);
  const project = value(`INSERT INTO project (name, customer_id, status, planned_hours)
    VALUES ('Pressure skid', ${customer}, 'production', 120) RETURNING id;`);
  const jobcard = value(`INSERT INTO jobcard (project_id, customer_id, title, status, planned_hours)
    VALUES (${project}, ${customer}, 'Shell seam', 'in-progress', 24) RETURNING id;`);
  const supplier = value(`INSERT INTO supplier (name, city, payment_terms_days)
    VALUES ('Stål & Metall AB', 'Helsingborg', 30) RETURNING id;`);
  const order = value(`INSERT INTO purchase_order (supplier_id, status, ordered_by)
    VALUES (${supplier}, 'draft', 'Anna Berg') RETURNING id;`);
  return {
    welder, customer, project, jobcard, supplier, order,
    projectRef: value(`SELECT ref FROM project WHERE id = ${project};`),
    jobcardRef: value(`SELECT ref FROM jobcard WHERE id = ${jobcard};`),
    orderRef: value(`SELECT ref FROM purchase_order WHERE id = ${order};`)
  };
}

async function signIn(page, site, email, secret) {
  await page.goto(`${site}/login.html`, { waitUntil: 'load' });
  await page.waitForSelector('#signInForm:not([hidden])', { timeout: 8000 });
  await page.locator('#signInEmail').fill(email);
  await page.locator('#signInSecret').fill(secret);
  await page.locator('#signInGo').click();
  await page.waitForURL(/hours-mobile\.html|hub-/, { timeout: 8000 });
}

async function openDocuments(page, site) {
  await page.goto(`${site}/documents-desktop.html`, { waitUntil: 'load' });
  // Reports what the page itself said rather than timing out mutely. The failure this catches is a
  // snapshot refused in full because one list in it touches a table the reader holds nothing on, and a
  // bare "waitForFunction timed out" sends whoever is reading it looking in the wrong file — the page is
  // fine, the view is not. Asked at the end of the wait so a slow snapshot is not mistaken for a refused
  // one.
  try {
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
  } catch (timedOut) {
    const said = await page.evaluate(() => {
      const toast = document.querySelector('.toast, .notice, #toast');
      return toast ? toast.textContent.trim() : '';
    }).catch(() => '');
    throw new Error('the register never went server-backed'
      + (said ? ` — the page said: ${said}` : ' and the page said nothing')
      + '. A snapshot refused in full usually means one of its lists reads a table this role cannot.');
  }
  assert.equal(await page.locator('[role="alert"]').count(), 0, 'the guard must let this page through');
}

// Fills the upload form and submits it, the way somebody would.
async function fileIt(page, fields) {
  return page.evaluate(async (f) => {
    openUpload();
    document.getElementById('docName').value = f.name;
    document.getElementById('docType').value = f.type;
    document.getElementById('docModule').value = f.module || 'Projects';
    document.getElementById('docRecord').value = f.record || '';
    document.getElementById('docCategory').value = f.category || '';
    document.getElementById('docStatus').value = f.status || 'Draft';
    document.getElementById('docExpiry').value = f.expiry || '';
    document.getElementById('docRevision').value = f.revision || '';
    document.getElementById('docNotes').value = f.notes || '';
    const form = document.getElementById('uploadForm');
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const said = document.querySelector('.toast, .notice, #toast');
    return said ? said.textContent.trim() : '';
  }, fields);
}

async function main() {
  buildDatabase();
  const w = aWorkshop();
  assert.equal(value(`SELECT count(*) FROM document;`), '0', 'the register starts empty');

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
    await openDocuments(page, site);
    step('Documents: the register opens for a signed-in session instead of refusing');

    // ── Filing one ──────────────────────────────────────────────────────────────────────────
    await fileIt(page, {
      name: 'Material Certificate MTC-240516', type: 'Certificate', module: 'Projects',
      record: w.projectRef, category: 'Materials', status: 'Valid',
      expiry: '2027-06-30', revision: '1', notes: 'Heat H240516'
    });
    await until('the certificate to reach Postgres', () => value(`SELECT count(*) FROM document;`) === '1');
    const filed = value(`SELECT id FROM document;`);
    assert.match(value(`SELECT ref FROM document WHERE id = ${filed};`), /^DOC-\d{5}$/);
    assert.equal(value(`SELECT title || '|' || kind || '|' || category || '|' || status
      || '|' || expires_on || '|' || revision || '|' || notes
      FROM document WHERE id = ${filed};`),
    'Material Certificate MTC-240516|Certificate|Materials|valid|2027-06-30|1|Heat H240516',
    'every field the form asked for is the field that was saved');
    assert.equal(value(`SELECT entity || '|' || entity_id FROM document WHERE id = ${filed};`),
      `project|${w.project}`, 'and the module and reference resolved to the record they name');
    // The file half, which there is nowhere to put. Both columns or neither, and here neither.
    assert.equal(value(`SELECT coalesce(filename,'-') || '|' || coalesce(storage_key,'-')
      || '|' || coalesce(size_bytes::text,'-') FROM document WHERE id = ${filed};`), '-|-|-',
      'and no file, because there is nowhere to put one — not an empty string pretending to be one');
    step('Documents: a certificate is filed from the form, against real work, with its expiry date');

    // Who filed it. The form has no author field, and the screen used to write one name into every
    // record it made.
    assert.equal(value(`SELECT uploaded_by || '|' || author FROM document WHERE id = ${filed};`),
      'Anna Berg|Anna Berg', 'the session filed it, and is the author until somebody says otherwise');
    step('Documents: the register records who actually filed it, from the session');

    // ── A reference nothing answers to ──────────────────────────────────────────────────────
    const ghost = await fileIt(page, {
      name: 'Ghost Certificate', type: 'Certificate', module: 'Projects', record: 'P-9999-999'
    });
    assert.match(ghost, /nothing in Projects is called P-9999-999/i,
      `the refusal has to name the reference it could not find, and said: ${ghost}`);
    assert.equal(value(`SELECT count(*) FROM document;`), '1', 'and nothing was filed');
    step('Documents: a link to a record nobody has is refused by name, and writes nothing');

    // ── The two computed states ─────────────────────────────────────────────────────────────
    //
    // Set as 'valid', with an expiry inside the window and one behind it. Neither word is ever written to
    // the column: both are worked out on every read, which is the only way they cannot go stale.
    sql(`SET ROLE varmak_admin; SET app.user_id = '1';
      INSERT INTO document (title, kind, status, expires_on, uploaded_by)
      VALUES ('Welder Qualification 141', 'Certificate', 'valid', current_date + 12, 'Anna Berg'),
             ('Crane Inspection 2025', 'Certificate', 'valid', current_date - 3, 'Anna Berg');`);
    await page.evaluate(async () => {
      await window.WorkshopApi.snapshot().then((a) => window.WorkshopData.adoptSnapshot(a.data));
    });
    const seen = await page.evaluate(() => (WorkshopData.get().documents || [])
      .map((d) => `${d.name}=${d.status}/${d.setStatus}`).sort());
    assert.deepEqual(seen, [
      'Crane Inspection 2025=Expired/valid',
      'Material Certificate MTC-240516=Valid/valid',
      'Welder Qualification 141=Review Soon/valid'
    ], `the register reads these as: ${JSON.stringify(seen)}`);
    assert.equal(value(`SELECT count(*) FROM document WHERE status::text IN ('Expired','Review Soon');`), '0',
      'and neither word is in the column — a stored "Review Soon" is a fact that was true one morning');
    step('Documents: what is expiring and what has expired are worked out from the date, never stored');

    // And saving one of them back does not write the computed word into the column, which is the failure
    // this shape exists to prevent: the form shows "Review Soon" and has to send what somebody chose.
    const dated = value(`SELECT id FROM document WHERE title = 'Welder Qualification 141';`);
    await page.evaluate(async (id) => {
      await WorkshopData.updateDocument(Number(id), { category: 'Welding' });
    }, dated);
    await until('the correction to land', () =>
      value(`SELECT coalesce(category,'-') FROM document WHERE id = ${dated};`) === 'Welding');
    assert.equal(value(`SELECT status FROM document WHERE id = ${dated};`), 'valid',
      'correcting the category must not write the computed status into the column');

    // And the one that discriminates. 'Review Soon' happens to mean the same stored value as what somebody
    // chose here, so a mapping that sent the computed word back would pass the check above unnoticed —
    // which it did, when this was planted. 'Expired' does not: mapping it to anything at all changes the
    // record, and mapping it to 'superseded' — the only nearby value the enum accepts — would quietly
    // retire a certificate because somebody corrected its category.
    const lapsed = value(`SELECT id FROM document WHERE title = 'Crane Inspection 2025';`);
    await page.evaluate(async (id) => {
      await WorkshopData.updateDocument(Number(id), { category: 'Lifting' });
    }, lapsed);
    await until('the expired certificate to be corrected', () =>
      value(`SELECT coalesce(category,'-') FROM document WHERE id = ${lapsed};`) === 'Lifting');
    assert.equal(value(`SELECT status FROM document WHERE id = ${lapsed};`), 'valid',
      'an expired certificate stays as somebody set it — correcting a category does not retire it');
    step('Documents: a record showing "Review Soon" or "Expired" saves back what somebody chose');

    // ── Superseding ─────────────────────────────────────────────────────────────────────────
    await fileIt(page, {
      name: 'Duct Drawing Rev B', type: 'Drawing', module: 'Workshop', record: w.jobcardRef,
      category: 'Drawings', status: 'Approved', revision: 'B'
    });
    await until('revision B to be filed', () =>
      value(`SELECT count(*) FROM document WHERE revision = 'B';`) === '1');
    await page.evaluate(async (id) => { await WorkshopData.archiveDocument(Number(id)); }, filed);
    await until('the certificate to be superseded', () =>
      value(`SELECT status FROM document WHERE id = ${filed};`) === 'superseded');
    // Still on file. Deleting it would be losing the reason a weld was made the way it was.
    assert.equal(value(`SELECT title FROM document WHERE id = ${filed};`),
      'Material Certificate MTC-240516', 'the superseded revision stays in the register');
    assert.equal(value(`SELECT count(*) FROM activity_log
      WHERE entity = 'document' AND entity_id = ${filed} AND action = 'superseded';`), '1',
    'and the log says who did it and when');
    const twice = await page.evaluate(async (id) =>
      (await WorkshopData.archiveDocument(Number(id))).error || '', filed);
    assert.match(twice, /already superseded/i, `superseding twice must be refused, and said: ${twice}`);
    step('Documents: a superseded revision stays on file, and cannot be superseded twice');

    // ── Linking, on its own ─────────────────────────────────────────────────────────────────
    //
    // Its own function because a certificate is often filed before anybody knows which job it belongs to,
    // and correcting that later must not re-send the rest of the record.
    const unlinked = await fileIt(page, {
      name: 'Welding Procedure WPS-12', type: 'Document', module: 'Projects', record: '',
      category: 'Procedures', status: 'Approved', revision: '2'
    });
    assert.ok(!/refused|nothing in/i.test(unlinked), `filing without a link must work, and said: ${unlinked}`);
    const loose = value(`SELECT id FROM document WHERE title = 'Welding Procedure WPS-12';`);
    assert.equal(value(`SELECT coalesce(entity,'-') || '|' || coalesce(entity_id::text,'-')
      FROM document WHERE id = ${loose};`), '-|-', 'a document filed against nothing is unlinked, not broken');
    await page.evaluate(async (id) => {
      await WorkshopData.updateDocument(Number(id), { module: 'Purchasing', record: null });
    }, loose);
    // Still unlinked: a module with no reference is not a link.
    assert.equal(value(`SELECT coalesce(entity,'-') FROM document WHERE id = ${loose};`), '-',
      'a module with no reference beside it is not half a link, it is no link');
    await page.evaluate(async ({ id, ref }) => {
      await WorkshopData.updateDocument(Number(id), { module: 'Purchasing', record: ref });
    }, { id: loose, ref: w.orderRef });
    await until('the link to be made', () =>
      value(`SELECT coalesce(entity,'-') FROM document WHERE id = ${loose};`) === 'purchase_order');
    assert.equal(value(`SELECT revision || '|' || category FROM document WHERE id = ${loose};`),
      '2|Procedures', 'and linking it kept its revision and its category');
    step('Documents: a document is filed unlinked, then linked, without losing what was on it');

    // ── Three rules a mutation found nothing testing ────────────────────────────────────────
    //
    // Each of these exists in api.sql and each survived being broken, because nothing above asked.
    //
    // A module the screen does not have. The dropdown only offers the eight, so nothing on screen can
    // send a ninth — but the RPC is reachable by name, and a document filed under a module nothing
    // resolves is a document nobody will ever find by looking where it should be.
    const nonsense = await page.evaluate(async () => {
      const answer = await WorkshopApi.call('link_document',
        { id: 1, module: 'Accounting', record: 'X-1' });
      return answer.refused || (answer.ok ? 'ALLOWED' : 'refused without saying why');
    });
    assert.match(nonsense, /there is no module called Accounting/i,
      `a module nothing resolves has to be refused by name, and said: ${nonsense}`);

    // A document superseding itself. The screen never sends `by_id`, so this is only reachable by name
    // too — and a record whose replacement is itself says a revision was replaced by the revision it is.
    const itself = await page.evaluate(async (id) => {
      const answer = await WorkshopApi.call('supersede_document', { id: Number(id), by_id: Number(id) });
      return answer.refused || (answer.ok ? 'ALLOWED' : 'refused without saying why');
    }, loose);
    assert.match(itself, /cannot supersede itself/i,
      `a document cannot be its own replacement, and the answer was: ${itself}`);
    assert.equal(value(`SELECT status FROM document WHERE id = ${loose};`), 'approved',
      'and the refusal left it exactly as it was');

    // And the author, which no screen has a field for. Asked by name rather than through the form, and for
    // a reason worth writing down: the screen sends back whatever author it read, so this rule is not
    // reachable from it at all — a mutation that removed the rule changed nothing the screen could see,
    // and the rule read as tested while being exercised by nothing. `author: null` is what every other
    // caller sends, and it has to mean "leave whoever it was" rather than "nobody".
    sql(`SET ROLE varmak_admin; SET app.user_id = '1';
      UPDATE document SET author = 'Marcus Lind' WHERE id = ${loose};`);
    // The link is sent as it stands, because save_document takes the whole record: leaving the reference out
    // would unlink it, which is correct behaviour and not what is being asked about here.
    const kept = await page.evaluate(async ({ id, ref }) => {
      const answer = await WorkshopApi.call('save_document', {
        id: Number(id), title: 'Welding Procedure WPS-12', kind: 'Document',
        module: 'Purchasing', record: ref, category: 'Welding procedures',
        status: 'approved', expires_on: null, revision: '2', author: null, notes: null
      });
      return answer.ok ? 'saved' : (answer.refused || 'refused without saying why');
    }, { id: loose, ref: w.orderRef });
    assert.equal(kept, 'saved', `the correction was refused: ${kept}`);
    assert.equal(value(`SELECT coalesce(category,'-') FROM document WHERE id = ${loose};`),
      'Welding procedures', 'the correction has to have landed, or the next line proves nothing');
    assert.equal(value(`SELECT author FROM document WHERE id = ${loose};`), 'Marcus Lind',
      'a save with no author named must leave the draughtsman\'s name on the drawing');
    step('Documents: a module nothing resolves, a self-supersede, and a lost author are all refused');

    // ── The file itself ─────────────────────────────────────────────────────────────────────
    const noFile = await page.evaluate(async (id) =>
      (await WorkshopData.removeDocumentContent(Number(id))).error || '', loose);
    assert.match(noFile, /no file stored on the server/i,
      `the screen must say what is held and what is not, and said: ${noFile}`);
    const folder = await page.evaluate(() => {
      const answer = WorkshopData.upsertDocumentFolder({ name: 'Certificates 2026' });
      return (answer && answer.error) || '';
    });
    assert.match(folder, /not on the workshop database yet/i,
      `a folder has no table and must refuse out loud, and said: ${folder}`);
    step('Documents: the file and the folder refuse out loud, and say what the register does hold');

    // ── A welder ────────────────────────────────────────────────────────────────────────────
    //
    // The point of the whole register: somebody at a bench reading which revision is current. And the
    // check that the first version of this failed — a document filed against a purchase order made
    // workspace_snapshot() refuse the floor the WHOLE workshop, because they hold no SELECT on that table.
    const floor = await context.newPage();
    floor.on('pageerror', (error) => thrown.push(error.stack || error.message));
    await signIn(floor, site, 'marko@varmak.se', 'a long enough passphrase');
    await openDocuments(floor, site);
    const forTheFloor = await until('a welder\'s register to arrive', async () => {
      const got = await floor.evaluate(() => ({
        docs: (WorkshopData.get().documents || []).length,
        jobcards: (WorkshopData.get().jobcards || []).length,
        onOrder: (WorkshopData.get().documents || [])
          .filter((d) => d.module === 'Purchasing').map((d) => d.record)
      }));
      return got.docs ? got : null;
    });
    assert.equal(forTheFloor.docs, 5, 'a welder reads the whole register');
    assert.deepEqual(forTheFloor.onOrder, [w.orderRef],
      'including a document filed against a purchase order, by the order\'s own number');
    assert.ok(forTheFloor.jobcards >= 1,
      'and the rest of the workshop still reaches them, which is what one list closing the door costs');
    step('Documents: a welder reads the register, purchase-order paperwork and all, and the snapshot arrives');

    // And is refused filing one. Which revision is current is a decision, not a bench job.
    const refused = await floor.evaluate(async () => {
      const answer = await WorkshopData.upsertDocument({ name: 'Mine', type: 'Document' });
      return (answer && answer.error) || '';
    });
    assert.match(refused, /not yours|permission|refused/i,
      `a welder must be refused filing, and was told: ${refused}`);
    assert.equal(value(`SELECT count(*) FROM document WHERE title = 'Mine';`), '0', 'and nothing was filed');
    step('Documents: a welder is refused filing one — which revision is current is the office\'s decision');

    // Nothing in browser storage. The register is in one place, or it is two registers that nobody
    // reconciles — and the one on the laptop is the one somebody will read on the day it matters.
    const stored = await page.evaluate(() => {
      const out = {};
      try {
        for (const key of Object.keys(localStorage)) {
          if (/varmak/.test(key) && key !== 'varmak.theme') out[key] = localStorage.getItem(key) || '';
        }
      } catch (e) { out['?'] = String(e); }
      return out;
    });
    for (const [key, held] of Object.entries(stored)) {
      assert.ok(!/MTC-240516|Duct Drawing Rev B|WPS-12|Welder Qualification/.test(held),
        `${key} holds a second copy of the register: ${held.slice(0, 200)}`);
    }
    step('Documents: and nothing went into browser storage — the register is in one place');

    assert.deepEqual(thrown, [], `the page threw: ${thrown.slice(0, 3).join(' / ')}`);
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
    server.close();
  }
  console.log(`\n${checks} checks: the document register is the workshop's, and what is expiring is `
    + 'worked out from the date rather than remembered.');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
