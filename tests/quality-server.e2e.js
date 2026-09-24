'use strict';

// The quality register on the database, driven through its own screen.
//
// This is the screen where being wrong matters most. A hold is the only thing in this system that
// physically stops work leaving the building, and until this pass the database was refusing to complete
// a held jobcard while the page that lists the holds read them out of the browser's own storage. The
// gate and the list somebody reads to understand the gate were looking at two different sets of facts:
// a hold placed by the database was invisible here, and a hold "released" here stopped nothing.
//
// Five checks matter most:
//
//   * An inspection is raised from the form, with the standard it will be judged against — and arrives
//     undecided, because a request that could arrive already passed is a form for passing work unlooked
//     at.
//   * A welder records a critical failure and the hold goes on in the same request. The floor holds no
//     privilege on quality_hold at all; the route is a function that runs as the engine and can only
//     ever hold work behind an inspection that is failed and critical as it stands.
//   * The held jobcard cannot be completed, and the refusal comes from the database.
//   * The release takes a named authority and written evidence, and the floor is refused it outright.
//   * The checklist survives the round trip as evidence — including the line nobody answered, which
//     must not come back as a pass.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_quality_test';
const HTTP_PORT = Number(process.env.VARMAK_QUALITY_PORT || 8953);

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

// An empty register, a job to inspect, a merchant to complain to, and a welder to sign the result.
function aWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const welder = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('marko@varmak.se', 'Marko Ilic', 'workshop') RETURNING id;`);
  sql(`SELECT set_password(${welder}, 'a long enough passphrase');`);
  const customer = value(`INSERT INTO customer (name, city) VALUES ('MarineVent AB', 'Malmö') RETURNING id;`);
  const project = value(`INSERT INTO project (name, customer_id, status, planned_hours)
    VALUES ('Pressure skid', ${customer}, 'production', 120) RETURNING id;`);
  const card = value(`INSERT INTO jobcard (project_id, customer_id, title, status, planned_hours)
    VALUES (${project}, ${customer}, 'Shell seam', 'in-progress', 24) RETURNING id;`);
  const supplier = value(`INSERT INTO supplier (name, city, payment_terms_days)
    VALUES ('Stål & Metall AB', 'Helsingborg', 30) RETURNING id;`);
  return {
    customer, project, card, supplier, welder,
    projectRef: value(`SELECT ref FROM project WHERE id = ${project};`),
    cardRef: value(`SELECT ref FROM jobcard WHERE id = ${card};`)
  };
}

async function signIn(page, site, { email, secret, pin }) {
  await page.goto(`${site}/login.html`, { waitUntil: 'load' });
  if (pin) {
    await page.locator('#pinTab').click();
    await page.waitForSelector('#pinForm:not([hidden])', { timeout: 8000 });
    await page.locator('#pinEmail').fill(email);
    await page.locator('#pinSecret').fill(pin);
    await page.locator('#pinGo').click();
  } else {
    await page.waitForSelector('#signInForm:not([hidden])', { timeout: 8000 });
    await page.locator('#signInEmail').fill(email);
    await page.locator('#signInSecret').fill(secret);
    await page.locator('#signInGo').click();
  }
  await page.waitForURL(/hours-mobile\.html|hub-/, { timeout: 8000 });
}

async function openQuality(page, site) {
  await page.goto(`${site}/quality-desktop.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
    { timeout: 8000 });
  assert.equal(await page.locator('[role="alert"]').count(), 0, 'the guard must let this page through');
}

async function main() {
  buildDatabase();
  const w = aWorkshop();
  assert.equal(value(`SELECT count(*) FROM inspection;`), '0', 'the register starts empty');

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
    await signIn(page, site, { email: 'anna@varmak.se', secret: 'correct horse battery staple' });
    await openQuality(page, site);
    step('Quality: the register opens for a signed-in session instead of refusing');

    // ── Raising an inspection ───────────────────────────────────────────────────────────────
    //
    // Through the page's own handler, with the form filled the way somebody fills it. The dropdowns
    // are populated from the snapshot, so a project that is not in it cannot be selected — which is
    // the read half of the wiring, asserted by the write half working at all.
    const raised = await page.evaluate(async (w) => {
      openNewInspectionModal();
      const set = (id, v) => { const el = document.getElementById(id); el.value = v; return el.value === String(v); };
      const chose = {
        project: set('ins_project', w.projectRef),
        jobcard: set('ins_jobcard', w.cardRef),
        type: set('ins_type', 'welding')
      };
      set('ins_operation', 'Shell seam, root pass');
      set('ins_component', 'Shell course 2');
      set('ins_drawing', 'BR-4410');
      set('ins_rev', 'C');
      set('ins_method', 'visual + PT');
      set('ins_criteria', 'ISO 5817 level B');
      set('ins_planned', '2026-09-24');
      set('ins_inspector', 'Marko Ilic');
      set('ins_notes', 'Customer attending');
      document.getElementById('ins_witness').checked = true;
      document.getElementById('ins_matready').checked = true;
      await submitInspection();
      const box = document.getElementById('insFormErr');
      return { chose, refused: box && box.textContent ? box.textContent.trim() : '' };
    }, w);
    assert.deepEqual(raised.chose, { project: true, jobcard: true, type: true },
      'the dropdowns are filled from the snapshot, so the job has to be selectable in them');
    assert.equal(raised.refused, '', `the inspection form refused this: ${raised.refused}`);
    await until('the inspection to reach Postgres', () => value(`SELECT count(*) FROM inspection;`) === '1');
    const ins = value(`SELECT id FROM inspection;`);
    const insRef = value(`SELECT ref FROM inspection WHERE id = ${ins};`);
    assert.equal(value(`SELECT kind || '|' || drawing_no || '|' || drawing_rev || '|' || acceptance_criteria
      FROM inspection WHERE id = ${ins};`), 'welding|BR-4410|C|ISO 5817 level B',
      'the standard the work will be judged against is recorded when it is asked for, not afterwards');
    assert.equal(value(`SELECT customer_witness::text || '|' || material_traceability_ok::text
      || '|' || operation FROM inspection WHERE id = ${ins};`),
      'true|true|Shell seam, root pass');
    assert.equal(value(`SELECT notes FROM inspection WHERE id = ${ins};`), 'Customer attending',
      'the Notes box belongs on the record — it used to need a second call, against a reference that '
      + 'did not exist yet');
    assert.equal(value(`SELECT result::text || '|' || status FROM inspection WHERE id = ${ins};`),
      'pending|requested', 'a request arrives undecided, whatever else it carries');
    step('Quality: an inspection is raised from the form, against real work, and arrives undecided');

    // ── The welder records what they found ───────────────────────────────────────────────────
    const floor = await context.newPage();
    floor.on('pageerror', (error) => thrown.push(error.stack || error.message));
    await signIn(floor, site, { email: 'marko@varmak.se', secret: 'a long enough passphrase' });
    await openQuality(floor, site);

    // The lines the inspection is to be checked against, put on the request before it is answered —
    // which is what an inspection and test plan does. There is no ITP register on the database yet, so
    // the office sets them through the function that exists for it; the screen's request form has no
    // checklist editor, and nothing here pretends otherwise.
    const planned = await page.evaluate(async (insRef) => {
      const answer = await window.WorkshopApi.call('replace_inspection_checks', {
        inspection_id: Number(window.WorkshopData.get().qualityInspections
          .find((i) => i.no === insRef).id),
        lines: [
          { item: 'Weld cap profile' },
          { item: 'Root penetration' },
          // With the reading already on it, because the exec modal shows a measured line rather than
          // asking for it: there is no box on this screen for typing a measurement. What matters here
          // is that the welder's save does not lose the reading on its way past.
          { item: 'Overall length', nominal: 2400, lower: -2, upper: 2, actual: 2401.5 }
        ]
      });
      return answer.ok ? '' : answer.refused;
    }, insRef);
    assert.equal(planned, '', `setting the plan's lines refused: ${planned}`);
    assert.equal(value(`SELECT count(*) FROM inspection_check WHERE inspection_id = ${ins};`), '3');
    step('Quality: the lines an inspection will be judged against are set before anybody answers them');

    // Reloaded, because the lines went on after this page took its snapshot. A screen answering a
    // checklist it cannot see would send three lines back as one.
    await openQuality(floor, site);

    const answered = await floor.evaluate(async (insRef) => {
      openExecInspection(insRef);
      document.getElementById('exec_result').value = 'failed';
      document.getElementById('exec_critical').checked = true;
      document.getElementById('exec_findings').value = 'Porosity beyond level B in the root';
      const first = document.querySelector('.execChkResult[data-idx="0"]');
      if (first) first.value = 'pass';
      const second = document.querySelector('.execChkResult[data-idx="1"]');
      if (second) second.value = 'fail';
      await submitInspectionResult();
      const box = document.getElementById('execFormErr');
      return box && box.textContent ? box.textContent.trim() : '';
    }, insRef);
    assert.equal(answered, '', `the result form refused this: ${answered}`);
    await until('the verdict to reach Postgres',
      () => value(`SELECT result::text FROM inspection WHERE id = ${ins};`) === 'failed');
    assert.equal(value(`SELECT inspector FROM inspection WHERE id = ${ins};`), 'Marko Ilic',
      'the name on a completed inspection is whoever recorded it');
    assert.equal(value(`SELECT critical::text || '|' || (actual_date = current_date)::text || '|' || status
      FROM inspection WHERE id = ${ins};`), 'true|true|completed');
    step('Quality: a welder records the verdict from the same screen, under their own name');

    // The hold, placed by a role that holds no privilege on the hold table at all.
    await until('the hold to go on',
      () => value(`SELECT count(*) FROM quality_hold WHERE status = 'active';`) === '1');
    const hold = value(`SELECT ref FROM quality_hold WHERE status = 'active';`);
    assert.equal(value(`SELECT related_ref FROM quality_hold WHERE ref = '${hold}';`), insRef,
      'the hold says which inspection put it there');
    assert.equal(value(`SELECT (jobcard_id = ${w.card})::text || '|' || (project_id IS NULL)::text
      FROM quality_hold WHERE ref = '${hold}';`), 'true|true',
      'a jobcard is the narrower thing, so the hold holds the jobcard');
    assert.match(value(`SELECT required_action FROM quality_hold WHERE ref = '${hold}';`),
      /re-inspection/i, 'and says what has to happen before it comes off');
    assert.equal(value(`SELECT applied_by FROM quality_hold WHERE ref = '${hold}';`), 'Marko Ilic');
    step('Quality: the critical failure put the hold on, from a role that cannot touch the hold table');

    // ── The evidence ────────────────────────────────────────────────────────────────────────
    await until('the checklist to arrive',
      () => value(`SELECT count(*) FROM inspection_check WHERE inspection_id = ${ins};`) === '3');
    assert.equal(value(`SELECT coalesce(result, 'unanswered') FROM inspection_check
      WHERE inspection_id = ${ins} AND item = 'Overall length';`), 'unanswered',
      'a measured line holds a reading rather than a judgement, and must not arrive as a verdict');
    assert.equal(value(`SELECT nominal::text || '|' || tol_lower::text || '|' || tol_upper::text
      || '|' || actual::text FROM inspection_check
      WHERE inspection_id = ${ins} AND item = 'Overall length';`),
      '2400.000|-2.000|2.000|2401.500');
    assert.equal(value(`SELECT result FROM inspection_check
      WHERE inspection_id = ${ins} AND item = 'Root penetration';`), 'fail');
    // And back onto the screen in the shape the page indexes it in.
    const readBack = await page.evaluate(async (insRef) => {
      await window.WorkshopApi.snapshot().then((a) => a.data
        && window.WorkshopData.adoptSnapshot(Object.assign({}, a.data, {
          qualityInspections: a.data.qualityInspections.map(QualityRecord.inspectionFromServer)
        })));
      const rec = window.WorkshopData.get().qualityInspections.find((i) => i.no === insRef);
      return rec.checklist.map((c) => `${c.item}=${c.resultItem}`);
    }, insRef);
    assert.deepEqual(readBack,
      ['Weld cap profile=pass', 'Root penetration=fail', 'Overall length='],
      'an unanswered line comes back unanswered — the page\'s dropdown renders a null as the word null');
    step('Quality: the checklist is evidence in the database and reads back as the screen wrote it');

    // ── What the hold is for ────────────────────────────────────────────────────────────────
    // Asked of the database directly, and quietly: the refusal is what is being tested, so its own
    // message on stderr is noise rather than a failure.
    let refused = '';
    try {
      execFileSync('psql', conn(), {
        input: `UPDATE jobcard SET status = 'inspection' WHERE id = ${w.card};
                UPDATE jobcard SET status = 'completed' WHERE id = ${w.card};`,
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) { refused = String(error.stderr || error.message); }
    assert.match(refused, /quality hold/,
      'the hold has to be what stops the work, and the database has to be what says so');
    assert.equal(value(`SELECT status::text FROM jobcard WHERE id = ${w.card};`), 'inspection',
      'and the move it did allow stands — a hold stops work going out, not the truth about it');
    step('Quality: the held jobcard cannot be finished, and the refusal is the database\'s');

    // ── The release ─────────────────────────────────────────────────────────────────────────
    const byTheFloor = await floor.evaluate(async (hold) => {
      openHoldReleaseModal(hold);
      document.getElementById('hold_authority').value = 'Marko Ilic';
      document.getElementById('hold_reason').value = 'I had another look and it seems fine';
      await submitHoldRelease();
      const box = document.getElementById('holdFormErr');
      return box && box.textContent ? box.textContent.trim() : '';
    }, hold);
    assert.match(byTheFloor, /not yours to do/,
      `the person who did the weld cannot clear the hold on it: ${byTheFloor}`);
    assert.equal(value(`SELECT status::text FROM quality_hold WHERE ref = '${hold}';`), 'active');
    step('Quality: the welder is refused the release — that is the decision that lets work leave');

    const withNothing = await page.evaluate(async (hold) => {
      openHoldReleaseModal(hold);
      document.getElementById('hold_authority').value = 'Anna Berg';
      document.getElementById('hold_reason').value = '   ';
      await submitHoldRelease();
      const box = document.getElementById('holdFormErr');
      return box && box.textContent ? box.textContent.trim() : '';
    }, hold);
    assert.match(withNothing, /evidence/i, `a release with no evidence has to refuse: ${withNothing}`);
    assert.equal(value(`SELECT status::text FROM quality_hold WHERE ref = '${hold}';`), 'active');

    const released = await page.evaluate(async (hold) => {
      openHoldReleaseModal(hold);
      document.getElementById('hold_authority').value = 'Anna Berg';
      document.getElementById('hold_reason').value = 'Ground out, re-run, PT accepted to level B';
      await submitHoldRelease();
      const box = document.getElementById('holdFormErr');
      return box && box.textContent ? box.textContent.trim() : '';
    }, hold);
    assert.equal(released, '', `the release refused: ${released}`);
    await until('the release to reach Postgres',
      () => value(`SELECT status::text FROM quality_hold WHERE ref = '${hold}';`) === 'released');
    assert.equal(value(`SELECT release_authority || '|' || release_reason
      FROM quality_hold WHERE ref = '${hold}';`),
      'Anna Berg|Ground out, re-run, PT accepted to level B');
    sql(`UPDATE jobcard SET status = 'completed' WHERE id = ${w.card};`);
    assert.equal(value(`SELECT status::text FROM jobcard WHERE id = ${w.card};`), 'completed',
      'and once the hold is off the work can be finished');
    step('Quality: the office releases it on named authority and written evidence, and the work goes out');

    // ── The re-inspection ───────────────────────────────────────────────────────────────────
    const repeated = await page.evaluate(async (insRef) => {
      openExecInspection(insRef);
      await createReinspectionFromModal();
      return window.WorkshopData.get().qualityInspections.filter((i) => i.reinspectionOf).map((i) => i.no);
    }, insRef);
    assert.equal(repeated.length, 1, `the re-inspection should be on the screen: ${repeated}`);
    const second = value(`SELECT id FROM inspection WHERE reinspection_of = ${ins};`);
    assert.equal(value(`SELECT count(*) FROM inspection_check WHERE inspection_id = ${second};`), '3',
      'the second look repeats the same lines');
    assert.equal(value(`SELECT count(*) FROM inspection_check
      WHERE inspection_id = ${second} AND (result IS NOT NULL OR actual IS NOT NULL);`), '0',
      'and carries none of the first inspection\'s answers');
    assert.equal(value(`SELECT acceptance_criteria FROM inspection WHERE id = ${second};`),
      'ISO 5817 level B', 'measured against the same standard as the first');
    step('Quality: the re-inspection repeats the check with every answer cleared, from the screen');

    // ── A non-conformance, through its whole life ───────────────────────────────────────────
    const ncrRaised = await page.evaluate(async (w) => {
      openNewNcrModal();
      const set = (id, v) => { const el = document.getElementById(id); el.value = v; return el.value === String(v); };
      const chose = {
        project: set('ncr_project', w.projectRef),
        category: set('ncr_category', 'welding'),
        severity: set('ncr_severity', 'major'),
        supplier: set('ncr_supplier', 'Stål & Metall AB')
      };
      set('ncr_jobcard', w.cardRef);
      set('ncr_title', 'Porosity beyond level B');
      set('ncr_component', 'Shell course 2');
      set('ncr_description', 'Found on the shell seam during PT');
      set('ncr_responsible', 'Anna Berg');
      set('ncr_due', '2026-10-08');
      await submitNcr();
      const box = document.getElementById('ncrFormErr');
      return { chose, refused: box && box.textContent ? box.textContent.trim() : '' };
    }, w);
    assert.deepEqual(ncrRaised.chose,
      { project: true, category: true, severity: true, supplier: true },
      'the merchant dropdown is filled from the snapshot, which carried no suppliers at all before this');
    assert.equal(ncrRaised.refused, '', `the NCR form refused this: ${ncrRaised.refused}`);
    await until('the NCR to reach Postgres', () => value(`SELECT count(*) FROM ncr;`) === '1');
    const ncr = value(`SELECT ref FROM ncr;`);
    assert.equal(value(`SELECT detected_by FROM ncr WHERE ref = '${ncr}';`), 'Anna Berg',
      'who found it comes from the session — the screen had one name written into the page');
    assert.equal(value(`SELECT (supplier_id = ${w.supplier})::text || '|' || responsible || '|' || due_on::text
      FROM ncr WHERE ref = '${ncr}';`), 'true|Anna Berg|2026-10-08');
    step('Quality: a non-conformance is raised from the form, by whoever is signed in');

    const life = await page.evaluate(async (ncr) => {
      const said = [];
      // The detail modal, then the action's own little form — which is what the buttons in it do. The
      // input does not exist until an action is chosen, so filling it first finds nothing.
      const run = async (action, fn, text, ref) => {
        openNcrDetail(ncr);
        ncrShowAction(ncr, action);
        document.getElementById('ncrActInput').value = text;
        const refBox = document.getElementById('ncrActRef');
        if (refBox) refBox.value = ref || '';
        await fn(ncr);
        const box = document.getElementById('ncrActErr');
        said.push(box && box.textContent ? box.textContent.trim() : '');
      };
      // Out of order first: closing it before anything is verified.
      await run('close', ncrSubmitClose, 'QM-2026-14');
      await run('containment', ncrSubmitContainment,
        'Shell course quarantined; welder stood down from the seam');
      await run('disposition', ncrSubmitDisposition, 'rework');
      await run('capa', ncrSubmitCapaLink, 'CAPA-2026-007');
      await run('verify', ncrSubmitVerify, 'Re-run and PT accepted to level B', 'Anna Berg');
      await run('close', ncrSubmitClose, 'QM-2026-14');
      return said;
    }, ncr);
    assert.match(life[0], /nothing verified/,
      `closing it before anything was verified has to refuse: ${life[0]}`);
    assert.deepEqual(life.slice(1), ['', '', '', '', ''],
      `the steps in order should all go through: ${JSON.stringify(life)}`);
    await until('the NCR to close',
      () => value(`SELECT status::text FROM ncr WHERE ref = '${ncr}';`) === 'closed');
    assert.equal(value(`SELECT containment IS NOT NULL AND disposition = 'rework'
      AND corrective_action_ref = 'CAPA-2026-007' AND verified_by = 'Anna Berg'
      AND closure_approval = 'QM-2026-14' AND closed_on = current_date
      FROM ncr WHERE ref = '${ncr}';`), 't',
      'every step left its own record, in its own column');
    step('Quality: contained, dispositioned, answered, verified, closed — and it cannot skip the middle');

    const reopened = await page.evaluate(async (ncr) => {
      openNcrDetail(ncr);
      ncrShowAction(ncr, 'reopen');
      document.getElementById('ncrActInput').value = 'Same porosity on the next two seams';
      await ncrSubmitReopen(ncr);
      const box = document.getElementById('ncrActErr');
      return box && box.textContent ? box.textContent.trim() : '';
    }, ncr);
    assert.equal(reopened, '', `reopening it refused: ${reopened}`);
    await until('the NCR to reopen',
      () => value(`SELECT status::text FROM ncr WHERE ref = '${ncr}';`) === 'reopened');
    assert.equal(value(`SELECT coalesce(closure_approval, 'none') || '|' || coalesce(closed_on::text, 'none')
      FROM ncr WHERE ref = '${ncr}';`), 'none|none',
      'a reopened non-conformance loses its closure, or it reads as approved and open at once');
    step('Quality: it reopens when the fault comes back, and the closure comes off with it');

    // ── Nothing went into browser storage ───────────────────────────────────────────────────
    const stored = await page.evaluate(() => {
      try { return localStorage.getItem('varmak.workshop.v1'); } catch (e) { return null; }
    });
    assert.ok(!stored || !stored.includes('Porosity beyond level B'),
      'the register was also written into browser storage, which is a second copy nobody reconciles');
    step('Quality: and nothing went into browser storage — the register is in one place');

    // ── What this screen cannot do yet ──────────────────────────────────────────────────────
    const itp = await page.evaluate(() => {
      const answer = window.WorkshopData.createItp({ title: 'Shell ITP' });
      return answer && answer.error ? answer.error : 'nothing was refused';
    });
    assert.match(itp, /not on the database yet/,
      `the ITP register has no table and has to refuse out loud: ${itp}`);
    const capa = await page.evaluate(() => {
      const answer = window.WorkshopData.createCapa({ title: 'Wire storage' });
      return answer && answer.error ? answer.error : 'nothing was refused';
    });
    assert.match(capa, /not on the database yet/, capa);
    step('Quality: the ITP register and the CAPA records refuse out loud, and write nothing');

    assert.deepEqual(thrown, [], `the page threw: ${thrown.slice(0, 3).join(' / ')}`);
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
    server.close();
  }
  console.log(`\n${checks} checks: the hold register is the workshop's, and the thing that stops work `
    + 'leaving the building is now the same thing on the screen and in the database.');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
