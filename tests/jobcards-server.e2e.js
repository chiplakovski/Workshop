'use strict';

// The jobcard screen, on the database, driven through its own buttons.
//
// This one was wired differently from the customers screen, and the test is partly about whether that
// worked. Customers had one save function to wrap; this page writes through sixty-odd call sites, so
// instead the WorkshopData methods it writes through were replaced, for this page, with versions that
// send the same intent to the server. The page's own logic runs unchanged. What that buys is that
// every write site is covered at once; what it costs is that a mistake in the mapping is invisible
// until something is driven end to end. Hence this.
//
// Two checks matter most:
//   * A step with hours booked on it cannot be taken off the plan, and the person is told why, in the
//     database's words, from the page's own delete button.
//   * Pressing Start on a step whose machine is out of service shows the refusal rather than showing
//     the step as started and taking it back.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_jobcards_test';
const HTTP_PORT = Number(process.env.VARMAK_JOBCARDS_PORT || 8917);

const conn = () => ['-h', HOST, '-p', PORT, '-U', USER, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-qtAX'];
const sql = (text) => execFileSync('psql', conn(), { input: text, encoding: 'utf8' }).trim();
const value = (text) => sql(text).split('\n')[0].trim();

let checks = 0;
const step = (message) => { checks += 1; console.log(`OK   ${message}`); };

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Waits on Postgres, not on the screen: the page keeps drawing while a write is in flight.
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

function aWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const admin = value(`SELECT id FROM app_user WHERE email = 'anna@varmak.se';`);
  sql(`SET ROLE varmak_admin; SET app.user_id = '${admin}';
       SELECT add_person('marko@varmak.se', 'Marko Ilic', 'workshop');`);
  const welder = value(`SELECT id FROM app_user WHERE email = 'marko@varmak.se';`);
  sql(`SET ROLE varmak_admin; SET app.user_id = '${admin}'; SELECT set_person_pin(${welder}, '8472');`);

  const customer = value(`INSERT INTO customer (name, city) VALUES ('MarineVent AB', 'Malmö') RETURNING id;`);
  const project = value(`INSERT INTO project (name, customer_id, status, planned_hours)
    VALUES ('Conveyor frame', ${customer}, 'production', 80) RETURNING id;`);
  const jobcard = value(`INSERT INTO jobcard (project_id, customer_id, title, item, quantity,
      status, planned_hours, priority, responsible, material_readiness, heat_no, notes, progress)
    VALUES (${project}, ${customer}, 'Frame weldment', 'Frame', 2, 'in-progress', 24, 'high',
            'Marko Ilic', 'partial', 'H240516-S534', 'Two off, mirrored', 40) RETURNING id;`);
  sql(`INSERT INTO operation (jobcard_id, seq, description, planned_hours)
       VALUES (${jobcard}, 1, 'Cut and prepare', 8), (${jobcard}, 2, 'Weld out', 16),
              (${jobcard}, 3, 'Dress and paint', 6);`);
  const weldOut = value(`SELECT id FROM operation WHERE jobcard_id = ${jobcard} AND seq = 2;`);
  sql(`INSERT INTO hours_entry (jobcard_id, operation_id, worker, hours)
       VALUES (${jobcard}, ${weldOut}, 'Marko Ilic', 6.5);`);
  return { admin, welder, customer, project, jobcard, weldOut,
    ref: value(`SELECT ref FROM jobcard WHERE id = ${jobcard};`) };
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
  const context = await browser.newContext({ viewport: { width: 1500, height: 980 } });
  const page = await context.newPage();
  const thrown = [];
  page.on('pageerror', (error) => thrown.push(error.stack || error.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/favicon|net::|Failed to load resource/.test(m.text())) return;
    thrown.push(m.text());
  });

  try {
    await page.goto(`${site}/login.html`, { waitUntil: 'load' });
    await page.waitForSelector('#signInForm:not([hidden])', { timeout: 8000 });
    await page.locator('#signInEmail').fill('anna@varmak.se');
    await page.locator('#signInSecret').fill('correct horse battery staple');
    await page.locator('#signInGo').click();
    await page.waitForURL(/hours-mobile\.html|hub-/, { timeout: 8000 });

    await page.goto(`${site}/jobcard-desktop.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
    await page.waitForFunction(() => typeof JOBCARDS !== 'undefined' && JOBCARDS.length === 1,
      { timeout: 8000 });
    assert.equal(await page.locator('[role="alert"]').count(), 0, 'the guard must let this page through');

    const shown = await page.evaluate(() => {
      const j = JOBCARDS[0];
      return { no: j.no, title: j.title, project: j.projectNo, customer: j.customer,
               quantity: j.quantity, readiness: j.materialReadiness, heat: j.heatNo,
               steps: j.operations.length, logged: j.operations[1].loggedHours,
               workers: j.workers.length, bom: j.bom.length };
    });
    assert.equal(shown.no, w.ref, 'the jobcard on screen is the database\'s, by its own reference');
    assert.equal(shown.title, 'Frame weldment');
    assert.match(shown.project, /^P-\d{4}-\d{3}$/);
    assert.equal(shown.customer, 'MarineVent AB');
    assert.equal(shown.readiness, 'partial', 'the screen\'s own word for the material state');
    assert.equal(shown.heat, 'H240516-S534');
    assert.equal(shown.steps, 3);
    assert.equal(shown.logged, 6.5, 'and the hours booked on a step arrive with it');
    // The lists the database has nowhere for are empty rather than invented.
    assert.equal(shown.workers, 0);
    assert.equal(shown.bom, 0);
    step('Jobcards: the screen reads the workshop\'s own jobcards, their steps and the hours on them');

    // ── The dropdowns that offer a person ────────────────────────────────────────────────────
    //
    // Responsible, Worker, the filter by responsible, the Reassign select, and the job title in the
    // workers table were all fed by a const holding three names written into this page: Aleksandar C.,
    // Elena N., Marko K. At a real firm those five controls offered three strangers and none of the
    // staff — so the one field that decides who is answerable for a weld could not be set to anybody
    // who works there. The names come from the snapshot now, which takes them from app_user.
    const offered = await page.evaluate(() => ({
      names: staffNames(),
      roleOfEach: staffNames().map((n) => staffRole(n)),
      inTheForm: ownerOptions().map((o) => o.v)
    }));
    assert.deepEqual(offered.names, ['Anna Berg', 'Marko Ilic'],
      `the dropdowns offer this workshop's people, and offered ${JSON.stringify(offered.names)}`);
    assert.deepEqual(offered.roleOfEach, ['admin', 'workshop'],
      'and the workers table states the role the database holds, not a job title nobody entered');
    assert.deepEqual(offered.inTheForm, offered.names, 'and the form offers the same list');
    step('Jobcards: the person dropdowns offer this workshop\'s staff, not three names from the page');

    // ── Editing the jobcard, through the page's own form ────────────────────────────────────
    const onScreen = await page.evaluate(() => JOBCARDS[0].id);
    await page.evaluate((id) => { openJcDetail(id); openJcForm(id); }, onScreen);
    await page.waitForSelector('#jfPlannedHours', { timeout: 5000 });
    await page.locator('#jfPlannedHours').fill('30');
    await page.locator('#jfPriority').selectOption('low');
    // With the id, because saveJcForm() without one is the "new jobcard" path — which is what this
    // test did first, and it quietly created a second jobcard while asserting the first had changed.
    await page.evaluate((id) => saveJcForm(id), onScreen);
    // Any refusal shows as a dialog; read it rather than time out on the database, because "nothing
    // arrived" and "the database said no" look identical from the outside and only one is a bug here.
    const trouble = await page.locator('.waskmsg').innerText().catch(() => null);
    assert.equal(trouble, null, `saving the form was refused: ${trouble}`);
    await until('the corrected plan to reach Postgres',
      () => value(`SELECT planned_hours::text FROM jobcard WHERE id = ${w.jobcard};`) === '30.00');
    assert.equal(value(`SELECT priority FROM jobcard WHERE id = ${w.jobcard};`), 'low',
      'the dropdown offers low, medium and high, and the column holds those three words');
    // The form has no box for any of these, and save_jobcard replaces the record.
    assert.equal(value(`SELECT coalesce(heat_no, 'GONE') || '|' || coalesce(notes, 'GONE')
      || '|' || progress::text || '|' || status::text FROM jobcard WHERE id = ${w.jobcard};`),
      'H240516-S534|Two off, mirrored|40|in-progress',
      'editing the plan cleared a field the form never showed');
    assert.equal(value(`SELECT count(*) FROM jobcard;`), '1', 'and it is a correction, not a second jobcard');
    assert.equal(value(`SELECT count(*) FROM activity_log WHERE entity = 'jobcard' AND action = 'updated';`), '1',
      'the database wrote its own record of it, once');
    step('Jobcards: the plan is corrected through the form and the fields it never showed survive');

    // ── The step list ───────────────────────────────────────────────────────────────────────
    const ids = sql(`SELECT id FROM operation WHERE jobcard_id = ${w.jobcard} ORDER BY seq;`).split('\n');
    await page.evaluate(() => { activeTab = 'operations'; renderApp(); });
    await page.evaluate((args) => moveOp(args.jc, args.op, -1),
      { jc: await page.evaluate(() => JOBCARDS[0].id), op: ids[2] });
    await until('the re-ordered steps to reach Postgres',
      () => value(`SELECT string_agg(id::text, ',' ORDER BY seq) FROM operation
                    WHERE jobcard_id = ${w.jobcard};`) === `${ids[0]},${ids[2]},${ids[1]}`);
    assert.equal(value(`SELECT count(*) FROM operation WHERE jobcard_id = ${w.jobcard};`), '3',
      're-ordering moves the same rows rather than replacing them');
    assert.equal(value(`SELECT logged_hours::text FROM operation WHERE id = ${w.weldOut};`), '6.50',
      'and the hours booked on the step that moved are still on it');
    step('Jobcards: the steps are re-ordered from the screen and the same rows move, hours and all');

    // The check this whole file is for. The weld-out has 6.5 hours booked on it.
    await page.evaluate((args) => doDeleteOp(args.jc, args.op),
      { jc: await page.evaluate(() => JOBCARDS[0].id), op: w.weldOut });
    await page.waitForSelector('.waskwrap', { timeout: 10000 });
    const refusal = await page.locator('.waskmsg').innerText();
    assert.match(refusal, /6.50 hours booked on it and cannot be taken off/,
      `the screen has to show the database's wording: ${refusal}`);
    assert.match(refusal, /Weld out/, 'and name the step');
    await page.locator('.waskyes').click();
    assert.equal(value(`SELECT count(*) FROM operation WHERE jobcard_id = ${w.jobcard};`), '3');
    assert.equal(value(`SELECT count(*) FROM hours_entry WHERE operation_id = ${w.weldOut};`), '1',
      'the hours are still there and still know which step they were booked on');
    step('Jobcards: taking off a step somebody worked on is refused on screen, in the database\'s words');

    // A step nobody has touched does come off, which is most of what editing a plan is.
    await page.evaluate((args) => doDeleteOp(args.jc, args.op),
      { jc: await page.evaluate(() => JOBCARDS[0].id), op: ids[0] });
    await until('the step nobody touched to come off in Postgres',
      () => value(`SELECT count(*) FROM operation WHERE jobcard_id = ${w.jobcard};`) === '2');
    assert.equal(value(`SELECT string_agg(seq::text, ',' ORDER BY seq) FROM operation
      WHERE jobcard_id = ${w.jobcard};`), '1,2', 'and the remaining steps are renumbered without a gap');
    step('Jobcards: a step nobody has touched comes off, and the rest are renumbered');

    // ── Adding one ──────────────────────────────────────────────────────────────────────────
    const card = await page.evaluate(() => JOBCARDS[0].id);
    await page.evaluate((jc) => openOpForm(jc, null), card);
    await page.waitForSelector('#opDesc', { timeout: 5000 });
    await page.locator('#opDesc').fill('Final inspection');
    await page.locator('#opPlannedHours').fill('2');
    await page.locator('#opInspection').check();
    // Both arguments, for the same reason as saveJcForm above: the second is the step being edited,
    // and null is what says "a new one".
    await page.evaluate((jc) => saveOpForm(jc, null), card);
    await until('the new step to reach Postgres',
      () => value(`SELECT count(*) FROM operation WHERE jobcard_id = ${w.jobcard};`) === '3');
    assert.equal(value(`SELECT description || '|' || inspection_checkpoint::text FROM operation
      WHERE jobcard_id = ${w.jobcard} ORDER BY seq DESC LIMIT 1;`), 'Final inspection|true');
    step('Jobcards: a step added on screen is in the database, as the last one, with its checkpoint');

    // ── Two edits with no pause between them ────────────────────────────────────────────────
    //
    // The one that found the bug, and it found it by being flaky: `set_jobcard_operations` replaces the
    // whole list, the page builds that list out of the snapshot, and every queued write ends by refreshing
    // the snapshot. Read the list when the call is MADE rather than when it is sent, and an add queued
    // behind a delete sends the list as it was BEFORE the delete — putting the deleted step straight back,
    // silently, with no error anywhere and both writes reporting success.
    //
    // Asked as the screen's own delete followed immediately by an add, with nothing awaited between them,
    // which is what a person produces by clicking twice quickly on a slow connection.
    const doomed = await page.evaluate(() => {
      const jc = JOBCARDS[0].id;
      const list = (WorkshopData.get().jobcards || []).find((x) => x.id === jc).operations || [];
      const first = list[0];
      doDeleteOp(jc, first.id);
      WorkshopData.addJobcardOperation(jc, { no: 99, desc: 'Packing', plannedHours: 1, loggedHours: 0,
        status: 'pending', worker: '', machine: '', equipmentId: null, instructions: '',
        plannedStart: null, dependency: null, inspectionCheckpoint: false, notes: '',
        actualStart: null, actualCompletion: null, attachments: '' });
      return first.desc;
    });
    await until('the added step to land', () => value(`SELECT count(*) FROM operation
      WHERE jobcard_id = ${w.jobcard} AND description = 'Packing';`) === '1');
    assert.equal(value(`SELECT count(*) FROM operation
      WHERE jobcard_id = ${w.jobcard} AND description = ${JSON.stringify(doomed).replace(/"/g, "'")};`), '0',
    `the deleted step must stay deleted: the add behind it used to send the list from before the delete `
      + `and put ${doomed} back`);
    step('Jobcards: an add queued behind a delete does not put the deleted step back');

    // ── What has no workflow yet ────────────────────────────────────────────────────────────
    const said = await page.evaluate((jc) =>
      window.WorkshopData.addJobcardNote(jc, { text: 'Kept for the morning' }),
      await page.evaluate(() => JOBCARDS[0].id));
    assert.ok(said && said.error, 'a note has no workflow, so the page must be told rather than guess');
    assert.match(said.error, /does not exist on the server yet/);
    step('Jobcards: a note has no workflow yet, and the page is told so instead of writing nowhere');

    assert.deepEqual([...new Set(thrown)], [], `the page threw: ${[...new Set(thrown)].join(' / ')}`);
    console.log(`\n${checks} checks: the jobcard screen reads and writes Postgres, steps and hours included.`);
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
