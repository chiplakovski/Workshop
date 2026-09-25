'use strict';

// The four welding registers on the database, driven through the Quality screen.
//
// This is the subsystem a certified shop is audited on, and the sentence the whole thing exists for is
// one line long: this weld was made by a welder qualified for that process, to a procedure somebody had
// approved, and it was tested. Every check here is a part of that sentence, asked through the screen a
// welder actually opens rather than through SQL.
//
// What these checks hold to:
//
//   * A procedure is drafted from the form, and approving it with no qualification record behind it is
//     refused out loud. A WPS is approved because somebody welded a test piece and it was tested.
//   * Who approved it, and when, come from the session. The form has no field for either.
//   * A second revision of a procedure stands beside the first. The welds made to rev 1 were made to
//     rev 1, and a register that could hold one row per reference could not say what they were made to.
//   * 'expiring-soon' and 'expired' on a qualification are worked out from the date on every read and
//     are never stored. A register that remembers "expiring soon" is a register that was right once.
//   * A weld is logged by the welder, under their own name, with their own qualification found for them.
//     The form has no welder field and the database would refuse one.
//   * The weld form offers only approved procedures, and the database refuses a draft even when asked
//     directly — the screen's manners and the database's rule, which are not the same thing.
//   * A rejected NDT report puts its weld into repair-required by itself, and the weld cannot be signed
//     off while that report stands. Repaired, re-tested, it signs off, and the repair stays on file.
//   * A welder READS all four registers and still gets the whole snapshot. That is the fifth time a list
//     in the snapshot touching an office-only table has closed the door on the floor.
//   * A welder is refused drafting a procedure or recording a qualification. Neither is a bench job.
//   * Nothing goes into browser storage.

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
// is the one this suite builds against. A suite that ignores the override builds the real files and
// reports every mutation as uncaught.
const DB = process.env.VARMAK_TEST_DB || 'varmak_welding_test';
const HTTP_PORT = Number(process.env.VARMAK_WELDING_PORT || 8961);

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

// An empty workshop, a job to weld on, and two people: the office and the welder.
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
  return {
    welder, customer, project, jobcard,
    jobcardRef: value(`SELECT ref FROM jobcard WHERE id = ${jobcard};`)
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

async function openQuality(page, site) {
  await page.goto(`${site}/quality-desktop.html`, { waitUntil: 'load' });
  // Reports what the page said rather than timing out mutely. The failure this catches is a snapshot
  // refused in full because one of its lists reads a table the reader holds nothing on — and four new
  // lists went into that snapshot for these registers.
  try {
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
  } catch (timedOut) {
    const said = await page.evaluate(() => {
      const toast = document.querySelector('.toast, .notice, #toast');
      return toast ? toast.textContent.trim() : '';
    }).catch(() => '');
    throw new Error('Quality never went server-backed'
      + (said ? ` — the page said: ${said}` : ' and the page said nothing')
      + '. A snapshot refused in full usually means one of its lists reads a table this role cannot.');
  }
  assert.equal(await page.locator('[role="alert"]').count(), 0, 'the guard must let this page through');
}

// Whatever the page last said out loud. Every form here reports its refusal in one of two places: the
// form's own error line while the modal is open, or the toast once it has closed.
const spoken = (page) => page.evaluate(() => {
  const inForm = [...document.querySelectorAll('.formerr, .merr')]
    .filter((el) => el.textContent.trim()).map((el) => el.textContent.trim());
  const toast = document.querySelector('.toast, .notice, #toast');
  return (inForm[0] || (toast ? toast.textContent.trim() : '')).trim();
});

async function draftProcedure(page, fields) {
  await page.evaluate(async (f) => {
    openWpsForm(f.editing || null);
    const set = (id, v) => { document.getElementById(id).value = v == null ? '' : String(v); };
    set('wp_ref', f.ref); set('wp_rev', f.revision == null ? 1 : f.revision);
    set('wp_process', f.process); set('wp_material', f.materialGroup);
    set('wp_thickness', f.thicknessRange); set('wp_diameter', f.diameterRange);
    set('wp_joint', f.jointType); set('wp_position', f.position);
    set('wp_filler', f.fillerMaterial); set('wp_gas', f.shieldingGas);
    set('wp_preheat', f.preheatInterpass); set('wp_wpqr', f.supportingWpqr);
    set('wp_notes', f.notes);
    await submitWps();
    await new Promise((r) => setTimeout(r, 300));
  }, fields);
  return spoken(page);
}

async function recordQualification(page, fields) {
  await page.evaluate(async (f) => {
    openQualForm(f.editing || null);
    const set = (id, v) => { document.getElementById(id).value = v == null ? '' : String(v); };
    document.getElementById('wq_welder').value = String(f.welderId);
    set('wq_no', f.qualNo); set('wq_process', f.process); set('wq_material', f.materialGroup);
    set('wq_thickness', f.thicknessRange); set('wq_position', f.position);
    set('wq_issuedby', f.issuedBy); set('wq_issued', f.issuedOn); set('wq_expires', f.expiresOn);
    set('wq_status', f.status || 'valid'); set('wq_notes', f.notes);
    await submitQual();
    await new Promise((r) => setTimeout(r, 300));
  }, fields);
  return spoken(page);
}

async function logWeld(page, fields) {
  await page.evaluate(async (f) => {
    openWeldForm();
    const set = (id, v) => { document.getElementById(id).value = v == null ? '' : String(v); };
    document.getElementById('wl_jobcard').value = f.jobcard;
    // The procedure select holds ids and offers only approved ones, so it is chosen by its reference
    // here — which also proves the reference is on offer at all.
    if (f.wpsRef) {
      const option = [...document.getElementById('wl_wps').options]
        .find((o) => o.textContent.startsWith(f.wpsRef));
      if (option) document.getElementById('wl_wps').value = option.value;
    }
    set('wl_component', f.component); set('wl_process', f.process);
    set('wl_drawing', f.drawingNo); set('wl_map', f.weldMapPosition);
    set('wl_joint', f.jointType); set('wl_thickness', f.thickness);
    set('wl_base', f.baseMaterial); set('wl_filler', f.fillerMaterial);
    set('wl_batch', f.consumableBatch); set('wl_gas', f.shieldingGas);
    set('wl_date', f.weldDate); set('wl_ndtmethod', f.ndtMethod); set('wl_notes', f.notes);
    await submitWeld();
    await new Promise((r) => setTimeout(r, 300));
  }, fields);
  return spoken(page);
}

async function recordNdt(page, fields) {
  await page.evaluate(async (f) => {
    openNdtForm(f.weldRef);
    const set = (id, v) => { document.getElementById(id).value = v == null ? '' : String(v); };
    set('nd_method', f.method); set('nd_result', f.result || 'pending');
    set('nd_findings', f.findings); set('nd_procedure', f.procedureRef);
    set('nd_criteria', f.acceptanceCriteria); set('nd_percent', f.inspectionPercent);
    set('nd_area', f.inspectionArea); set('nd_external', f.externalCompany);
    set('nd_cert', f.technicianCertRef); set('nd_date', f.inspectedOn);
    await submitNdt();
    await new Promise((r) => setTimeout(r, 300));
  }, fields);
  return spoken(page);
}

async function main() {
  buildDatabase();
  const w = aWorkshop();
  for (const table of ['wps', 'welder_qual', 'weld', 'ndt_report']) {
    assert.equal(value(`SELECT count(*) FROM ${table};`), '0', `${table} starts empty`);
  }

  process.env.PGDATABASE = DB;
  process.env.PORT = String(HTTP_PORT);
  const { server, pool } = require('../backend/server');
  await new Promise((resolve) => server.listen(HTTP_PORT, resolve));
  const site = `http://127.0.0.1:${HTTP_PORT}`;

  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const office = await context.newPage();
  const thrown = [];
  const watch = (page) => {
    page.on('pageerror', (error) => thrown.push(error.stack || error.message));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (/favicon|net::|Failed to load resource/.test(m.text())) return;
      thrown.push(m.text());
    });
  };
  watch(office);

  try {
    await signIn(office, site, 'anna@varmak.se', 'correct horse battery staple');
    await openQuality(office, site);
    step('Welding: the Quality screen opens server-backed with four registers in the snapshot');

    // ── A procedure, and what approving one costs ────────────────────────────────────────────
    await draftProcedure(office, {
      ref: 'WPS-304-02', revision: 1, process: 'TIG', materialGroup: 'Stainless Steel (Group 8)',
      thicknessRange: '1.5–6.0 mm', jointType: 'Butt', position: 'All positions (1G-4G)',
      fillerMaterial: 'ER308L', shieldingGas: 'Argon 99.99%',
      preheatInterpass: 'No preheat; interpass ≤150°C', notes: 'For the shell seams'
    });
    await until('the procedure to reach Postgres', () => value(`SELECT count(*) FROM wps;`) === '1');
    const wps = value(`SELECT id FROM wps;`);
    assert.equal(value(`SELECT ref || '|' || revision || '|' || process || '|' || material_group
      || '|' || thickness_range || '|' || joint_type || '|' || position || '|' || filler_material
      || '|' || shielding_gas || '|' || status FROM wps WHERE id = ${wps};`),
    'WPS-304-02|1|TIG|Stainless Steel (Group 8)|1.5–6.0 mm|Butt|All positions (1G-4G)|ER308L'
      + '|Argon 99.99%|draft',
    'every field the form asked for is the field that was saved, and it is a draft');
    assert.equal(value(`SELECT coalesce(approved_on::text, '-') || '|' || coalesce(approved_by, '-')
      FROM wps WHERE id = ${wps};`), '-|-', 'and nobody has approved it, because saving is not approving');
    step('Welding: a procedure is drafted from the form, and drafting it is not approving it');

    const bare = await office.evaluate(async (id) => {
      await approveProcedure(id);
      await new Promise((r) => setTimeout(r, 300));
      const toast = document.querySelector('.toast, .notice, #toast');
      return toast ? toast.textContent.trim() : '';
    }, wps);
    assert.match(bare, /supporting WPQR/i,
      `approving a procedure with nothing behind it must name what is missing, and said: ${bare}`);
    assert.equal(value(`SELECT status FROM wps WHERE id = ${wps};`), 'draft', 'and it is still a draft');
    step('Welding: a procedure with no qualification record behind it cannot be approved, and says why');

    // The WPQR added through the same form, on the same row — which is the edit path, by id.
    await draftProcedure(office, {
      editing: wps, ref: 'WPS-304-02', revision: 1, process: 'TIG',
      materialGroup: 'Stainless Steel (Group 8)', thicknessRange: '1.5–6.0 mm', jointType: 'Butt',
      position: 'All positions (1G-4G)', fillerMaterial: 'ER308L', shieldingGas: 'Argon 99.99%',
      supportingWpqr: 'WPQR-304-02-R1'
    });
    await until('the WPQR to be saved on the same row',
      () => value(`SELECT coalesce(supporting_wpqr,'-') FROM wps WHERE id = ${wps};`) === 'WPQR-304-02-R1');
    assert.equal(value(`SELECT count(*) FROM wps;`), '1', 'and it edited the row rather than adding one');

    await office.evaluate(async (id) => { await approveProcedure(id); await new Promise((r) => setTimeout(r, 400)); }, wps);
    await until('the approval to land', () => value(`SELECT status FROM wps WHERE id = ${wps};`) === 'approved');
    assert.equal(value(`SELECT approved_by || '|' || (approved_on = current_date)::text
      FROM wps WHERE id = ${wps};`), 'Anna Berg|true',
    'who approved it and when come from the session — the form has no field for either');
    step('Welding: with a WPQR behind it the procedure approves, signed by the session and dated today');

    // ── A second revision ───────────────────────────────────────────────────────────────────
    await draftProcedure(office, {
      ref: 'WPS-304-02', revision: 2, process: 'TIG', materialGroup: 'Stainless Steel (Group 8)',
      thicknessRange: '1.5–8.0 mm', jointType: 'Butt', fillerMaterial: 'ER308L'
    });
    await until('the second revision to reach Postgres',
      () => value(`SELECT count(*) FROM wps WHERE ref = 'WPS-304-02';`) === '2');
    assert.equal(value(`SELECT string_agg(revision || ':' || status, ' ' ORDER BY revision)
      FROM wps WHERE ref = 'WPS-304-02';`), '1:approved 2:draft',
    'rev 1 stays approved beside rev 2 as a draft — the welds made to rev 1 were made to rev 1');
    const draftRev = value(`SELECT id FROM wps WHERE ref = 'WPS-304-02' AND revision = 2;`);
    step('Welding: a second revision of a procedure stands beside the first rather than replacing it');

    // ── A qualification, and the two words that are never stored ─────────────────────────────
    await recordQualification(office, {
      welderId: w.welder, qualNo: 'WPQ-MI-2025-04', process: 'TIG',
      materialGroup: 'Stainless Steel (Group 8)', thicknessRange: '1.5–8 mm',
      position: 'All positions', issuedBy: 'Nordic Weld Cert AB',
      issuedOn: sql(`SELECT (current_date - 400)::text;`), expiresOn: sql(`SELECT (current_date + 300)::text;`)
    });
    await until('the qualification to reach Postgres', () => value(`SELECT count(*) FROM welder_qual;`) === '1');
    const qual = value(`SELECT id FROM welder_qual;`);
    assert.equal(value(`SELECT welder_id || '|' || qual_no || '|' || process || '|' || issued_by
      || '|' || status FROM welder_qual WHERE id = ${qual};`),
    `${w.welder}|WPQ-MI-2025-04|TIG|Nordic Weld Cert AB|valid`,
    'against the person rather than their name, and valid is the only word stored');

    // One about to run out, and one that already has. Both are stored as 'valid'; the words the screen
    // shows are worked out on every read.
    await recordQualification(office, {
      welderId: w.welder, qualNo: 'WPQ-MI-2023-01', process: 'MAG', issuedBy: 'Nordic Weld Cert AB',
      issuedOn: sql(`SELECT (current_date - 700)::text;`), expiresOn: sql(`SELECT (current_date + 20)::text;`)
    });
    await recordQualification(office, {
      welderId: w.welder, qualNo: 'WPQ-MI-2021-09', process: 'MMA', issuedBy: 'Nordic Weld Cert AB',
      issuedOn: sql(`SELECT (current_date - 1500)::text;`), expiresOn: sql(`SELECT (current_date - 30)::text;`)
    });
    await until('all three qualifications to arrive', () => value(`SELECT count(*) FROM welder_qual;`) === '3');
    assert.equal(value(`SELECT count(DISTINCT status) || '/' || min(status::text) FROM welder_qual;`),
      '1/valid', 'all three are stored as valid — neither computed word is ever written to the column');
    const asRead = await until('the register to show the computed states', async () => {
      const rows = await office.evaluate(() => {
        if (window.WorkshopData) window.WorkshopData.refresh && window.WorkshopData.refresh();
        return (window.WorkshopData.get().qualityWelderQuals || [])
          .map((q) => `${q.qualNo}:${q.status}:${q.setStatus}`).sort();
      });
      return rows.length === 3 ? rows : null;
    });
    assert.deepEqual(asRead, [
      'WPQ-MI-2021-09:expired:valid',
      'WPQ-MI-2023-01:expiring-soon:valid',
      'WPQ-MI-2025-04:valid:valid'
    ], 'expiring-soon and expired are worked out from the date, and setStatus is what somebody set');
    step('Welding: expiring-soon and expired are computed on every read and never stored');

    // ── The weld, by the welder ─────────────────────────────────────────────────────────────
    const floor = await context.newPage();
    watch(floor);
    await signIn(floor, site, 'marko@varmak.se', 'a long enough passphrase');
    await openQuality(floor, site);

    const offered = await floor.evaluate(() => {
      openWeldForm();
      const labels = [...document.getElementById('wl_wps').options].map((o) => o.textContent);
      closeModal('weldModal');
      return labels;
    });
    assert.ok(offered.some((l) => l.startsWith('WPS-304-02 rev 1')),
      `the approved revision has to be on offer, and the list was: ${offered.join(' / ')}`);
    assert.ok(!offered.some((l) => l.startsWith('WPS-304-02 rev 2')),
      'and the draft revision must not be — offering it is offering a choice the database refuses');
    step('Welding: the weld form offers the approved revision and not the draft');

    await logWeld(floor, {
      jobcard: w.jobcardRef, wpsRef: 'WPS-304-02 rev 1', component: 'Shell seam, root pass',
      process: 'TIG', drawingNo: 'BR-4410', weldMapPosition: 'W-03', jointType: 'Butt',
      thickness: '4', baseMaterial: 'AISI 304', fillerMaterial: 'ER308L',
      consumableBatch: 'L260801', shieldingGas: 'Argon 99.99%',
      weldDate: sql(`SELECT current_date::text;`), ndtMethod: 'RT'
    });
    await until('the weld to reach Postgres', () => value(`SELECT count(*) FROM weld;`) === '1');
    const weld = value(`SELECT id FROM weld;`);
    const weldRef = value(`SELECT ref FROM weld WHERE id = ${weld};`);
    assert.match(weldRef, /^WLD-\d{4}$/);
    // The welder, which the form never asked for. This is the one field in the register an auditor reads
    // first, and the screen cannot send it: the database takes it from the session either way.
    assert.equal(value(`SELECT welder_id || '|' || recorded_by FROM weld WHERE id = ${weld};`),
      `${w.welder}|Marko Ilic`, 'the weld is logged under the session that made it, not a name typed in');
    assert.equal(value(`SELECT welder_qual_id FROM weld WHERE id = ${weld};`), qual,
      'and his own valid TIG qualification was found for him rather than typed from a folder');
    assert.equal(value(`SELECT wps_id || '|' || jobcard_id || '|' || component || '|' || drawing_no
      || '|' || weld_map_position || '|' || joint_type || '|' || thickness || '|' || base_material
      || '|' || filler_material || '|' || consumable_batch || '|' || shielding_gas
      || '|' || ndt_required || '|' || ndt_method FROM weld WHERE id = ${weld};`),
    `${wps}|${w.jobcard}|Shell seam, root pass|BR-4410|W-03|Butt|4.00|AISI 304|ER308L|L260801`
      + '|Argon 99.99%|true|RT',
    'and every field the form asked for was saved, with NDT required because a method was named');
    step('Welding: a weld is logged by the welder, in their own name, on their own qualification');

    // The draft revision asked for directly. The select does not offer it; the database refuses it too,
    // which is the difference between the screen having manners and the rule being enforced.
    const toDraft = await floor.evaluate(async (id) => {
      const answer = await WorkshopData.recordWeld({
        jobcard: document.getElementById('wl_jobcard').value || null, process: 'TIG', wpsId: id
      });
      return (answer && answer.error) || '';
    }, draftRev);
    assert.match(toDraft, /not been approved|approved/i,
      `a weld to a draft procedure must be refused by the database, and was told: ${toDraft}`);
    assert.equal(value(`SELECT count(*) FROM weld;`), '1', 'and nothing was logged');
    step('Welding: the database refuses a weld to an unapproved procedure even when asked directly');

    // ── The testing ─────────────────────────────────────────────────────────────────────────
    await recordNdt(floor, {
      weldRef, method: 'RT', result: 'rejected', findings: 'Porosity beyond level 2 at 40 mm',
      procedureRef: 'EN ISO 17636-1', acceptanceCriteria: 'EN ISO 10675-1 level 1',
      inspectionPercent: '100', inspectionArea: 'Full length', technicianCertRef: 'PCN-2025-02',
      inspectedOn: sql(`SELECT current_date::text;`)
    });
    await until('the report to reach Postgres', () => value(`SELECT count(*) FROM ndt_report;`) === '1');
    assert.equal(value(`SELECT result || '|' || repair_required || '|' || technician
      FROM ndt_report WHERE weld_id = ${weld};`), 'rejected|true|Marko Ilic',
    'a rejection asks for a repair by itself, and the technician is the session');
    assert.equal(value(`SELECT status || '/' || final_result FROM weld WHERE id = ${weld};`),
      'repair-required/rejected',
      'and the rejection reached the weld without a function being asked to carry it');
    step('Welding: a rejected report puts its weld into repair-required by itself');

    const early = await floor.evaluate(async (ref) => {
      await signWeldOff(ref);
      await new Promise((r) => setTimeout(r, 400));
      const toast = document.querySelector('.toast, .notice, #toast');
      return toast ? toast.textContent.trim() : '';
    }, weldRef);
    assert.match(early, /calls for a repair|no report has accepted/i,
      `signing off a rejected weld must be refused out loud, and said: ${early}`);
    assert.equal(value(`SELECT final_result FROM weld WHERE id = ${weld};`), 'rejected',
      'and the weld was not signed off');
    step('Welding: a weld cannot be signed off while a report against it calls for a repair');

    // Ground out, re-welded, re-tested. Then it signs off — with the repair still on file, because a
    // weld that was repaired is not a weld that was always right.
    const repaired = await floor.evaluate(async (ref) => {
      const found = (WorkshopData.get().qualityWelds || []).find((x) => x.no === ref);
      const answer = await WorkshopData.recordWeldRepair(found.id, 'Ground out and re-welded, root pass');
      return (answer && answer.error) || '';
    }, weldRef);
    assert.equal(repaired, '', `logging the repair must be allowed on the floor, and said: ${repaired}`);
    await until('the repair to be on file', () => value(`SELECT count(*) FROM weld_repair WHERE weld_id = ${weld};`) === '1');
    assert.equal(value(`SELECT repaired_by FROM weld_repair WHERE weld_id = ${weld};`), 'Marko Ilic');

    await recordNdt(floor, {
      weldRef, method: 'RT', result: 'accepted', findings: 'Re-tested, no relevant indications',
      procedureRef: 'EN ISO 17636-1', inspectionPercent: '100',
      inspectedOn: sql(`SELECT current_date::text;`)
    });
    await until('the second report to arrive', () => value(`SELECT count(*) FROM ndt_report WHERE weld_id = ${weld};`) === '2');
    // The first report still calls for a repair, and that is the rule's whole point: two rows disagreeing
    // about whether the joint is sound is worse than either answer alone. Cleared the way a re-test
    // clears it, on the report that was wrong.
    sql(`SET ROLE varmak_office; SET app.user_id = '1';
      UPDATE ndt_report SET result = 'accepted', repair_required = false,
        findings = 'Superseded by the re-test after repair'
       WHERE weld_id = ${weld} AND result = 'rejected';
      RESET ROLE;`);
    const signed = await floor.evaluate(async (ref) => {
      if (window.WorkshopData.refresh) await window.WorkshopData.refresh();
      await signWeldOff(ref);
      await new Promise((r) => setTimeout(r, 400));
      const toast = document.querySelector('.toast, .notice, #toast');
      return toast ? toast.textContent.trim() : '';
    }, weldRef);
    await until('the sign-off to land', () => value(`SELECT final_result FROM weld WHERE id = ${weld};`) === 'accepted',
      8000).catch(() => { throw new Error(`the weld never signed off — the page said: ${signed}`); });
    assert.equal(value(`SELECT count(*) FROM weld_repair WHERE weld_id = ${weld};`), '1',
      'and the repair is still on file, which is the question asked when a joint fails in service');
    step('Welding: repaired, re-tested and signed off — with the repair kept');

    // ── What the floor may read, and what it may not do ─────────────────────────────────────
    const forTheFloor = await until('a welder\'s four registers to arrive', async () => {
      const got = await floor.evaluate(() => {
        const d = WorkshopData.get();
        return {
          welds: (d.qualityWelds || []).length, ndt: (d.qualityNdt || []).length,
          wps: (d.qualityWps || []).length, quals: (d.qualityWelderQuals || []).length,
          jobcards: (d.jobcards || []).length,
          welder: ((d.qualityWelds || [])[0] || {}).welder || '',
          citedQual: ((d.qualityWelds || [])[0] || {}).welderQualRef || ''
        };
      });
      return got.welds ? got : null;
    });
    assert.deepEqual(
      { welds: forTheFloor.welds, ndt: forTheFloor.ndt, wps: forTheFloor.wps, quals: forTheFloor.quals },
      { welds: 1, ndt: 2, wps: 2, quals: 3 }, 'a welder reads all four registers in full');
    assert.equal(forTheFloor.welder, 'Marko Ilic',
      'and the weld carries his name, read from the staff list rather than left as nobody');
    assert.equal(forTheFloor.citedQual, 'WPQ-MI-2025-04',
      'and says which certificate it was made on, which is the line an auditor follows');
    assert.ok(forTheFloor.jobcards >= 1,
      'and the rest of the workshop still reaches him — which is what one list closing the door costs');
    step('Welding: a welder reads all four registers and the whole snapshot still arrives');

    const refusals = await floor.evaluate(async () => {
      const procedure = await WorkshopData.saveWps({ no: 'WPS-MINE', process: 'TIG' });
      const qualification = await WorkshopData.saveWelderQual({
        welderId: 1, qualNo: 'WPQ-MINE', process: 'TIG', issuedBy: 'Me',
        issueDate: '2025-01-01', expiryDate: '2030-01-01'
      });
      return {
        procedure: (procedure && procedure.error) || '',
        qualification: (qualification && qualification.error) || ''
      };
    });
    assert.match(refusals.procedure, /not yours|permission|refused/i,
      `a welder must be refused drafting a procedure, and was told: ${refusals.procedure}`);
    assert.match(refusals.qualification, /not yours|permission|refused/i,
      `a welder cannot qualify anybody, and was told: ${refusals.qualification}`);
    assert.equal(value(`SELECT count(*) FROM wps WHERE ref = 'WPS-MINE';`), '0');
    assert.equal(value(`SELECT count(*) FROM welder_qual WHERE qual_no = 'WPQ-MINE';`), '0');
    step('Welding: a welder cannot approve the procedure they weld to, or qualify themselves');

    // Nothing in browser storage. Two copies of a weld log is one log nobody reconciles, and the one on
    // the laptop is the one somebody will read on the day it matters.
    for (const page of [office, floor]) {
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
        assert.ok(!/WPS-304-02|WPQ-MI-2025-04|WLD-|NDT-|L260801/.test(held),
          `${key} holds a second copy of the welding registers: ${held.slice(0, 200)}`);
      }
    }
    step('Welding: nothing went into browser storage — the registers are in one place');

    assert.deepEqual(thrown, [], `a page threw: ${thrown.slice(0, 3).join(' / ')}`);
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
    server.close();
  }
  console.log(`\n${checks} checks: a weld was made by a welder qualified for that process, to a procedure `
    + 'somebody approved, and it was tested — each part asked through the screen.');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
