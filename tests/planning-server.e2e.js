'use strict';

// The board a workshop decides next week from, on the database.
//
// Planning was one of the screens a signed-in session could not see at all, and it is the one that
// answers "what is the shop doing" — so a workshop on the database had the projects and no way to look
// at them together. Wiring it is mostly reading: every render on that page already goes through
// WorkshopData.get(), so a snapshot makes the board, the schedule and the weekly load the workshop's
// own. What it writes is a project's stage and a project's dates, and both had workflows already.
//
// Three checks matter most:
//
//   * Moving a card writes a status and a phase, and **nothing else**. save_project replaces the
//     record, so the patch this page sends has to ride on top of the record the snapshot handed over —
//     otherwise dragging a project across the board clears its purchase order number, its responsible
//     and its notes, and nothing on screen says so.
//   * Setting the dates moves the project AND each item that moved with it, in that order, because a
//     jobcard planned outside its project's span is what this screen exists to stop.
//   * Creating a project from a quotation refuses out loud. That is the estimating path, and the
//     estimate table cannot hold what that screen carries.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_planning_test';
const HTTP_PORT = Number(process.env.VARMAK_PLANNING_PORT || 8945);

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
    last = check();
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

// A project with dates and two items on it, and every field the board does not show filled in — which
// is what makes "the patch must not clear the rest of the record" a question with an answer.
function aWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const customer = value(`INSERT INTO customer (name, city) VALUES ('MarineVent AB', 'Malmö') RETURNING id;`);
  const project = value(`INSERT INTO project
    (name, customer_id, status, phase, progress, planned_hours, planned_start, planned_completion,
     deadline, po_number, responsible, notes, workshop, material_status, work_types, quoted_value)
    VALUES ('Conveyor frame', ${customer}, 'planned', 'planning', 10, 40,
            '2026-10-05', '2026-10-30', '2026-11-06', 'PO-88213', 'Anna Berg',
            'Two off, mirrored', 'Bay 2', 'ordered', 'Fabrication, Welding', 185000)
    RETURNING id;`);
  const card = (title, hours, start, done) => value(`INSERT INTO jobcard
    (project_id, customer_id, title, status, planned_hours, planned_start, planned_completion,
     heat_no, notes, progress)
    VALUES (${project}, ${customer}, '${title}', 'draft', ${hours}, '${start}', '${done}',
            'H240516-S534', 'from the drawing', 25) RETURNING id;`);
  return {
    customer, project,
    first: card('Frame weldment', 24, '2026-10-05', '2026-10-16'),
    second: card('Base plate', 16, '2026-10-19', '2026-10-30'),
    ref: value(`SELECT ref FROM project WHERE id = ${project};`)
  };
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
    await page.goto(`${site}/login.html`, { waitUntil: 'load' });
    await page.waitForSelector('#signInForm:not([hidden])', { timeout: 8000 });
    await page.locator('#signInEmail').fill('anna@varmak.se');
    await page.locator('#signInSecret').fill('correct horse battery staple');
    await page.locator('#signInGo').click();
    await page.waitForURL(/hours-mobile\.html|hub-/, { timeout: 8000 });

    await page.goto(`${site}/planning-desktop.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
    assert.equal(await page.locator('[role="alert"]').count(), 0, 'the guard must let this page through');

    // ── What it shows ───────────────────────────────────────────────────────────────────────
    const shown = await page.evaluate(() => {
      const p = (window.WorkshopData.get().projects || [])[0];
      return {
        no: p.no, name: p.name, status: p.status, lane: PlanningRules.laneOf(p),
        start: p.start, plannedStart: p.plannedStart, deadline: p.deadline,
        hours: p.plannedHours,
        items: PlanningRules.itemsOf(p, window.WorkshopData.listJobcards()).map((i) => ({
          no: i.no, source: i.source, start: i.start, end: i.end, hours: i.hours
        }))
      };
    });
    assert.equal(shown.no, w.ref, 'the board shows the workshop\'s own project, by its own reference');
    assert.equal(shown.lane, 'planned', 'in the lane its status puts it in');
    assert.equal(shown.start, '2026-10-05',
      'the snapshot carries `start` as well as `plannedStart`, which is what the schedule reads');
    assert.equal(shown.hours, 40);
    assert.equal(shown.items.length, 2, 'and the items on it are the jobcards');
    assert.deepEqual(shown.items.map((i) => i.source), ['jobcard', 'jobcard'],
      'every item on the server is a jobcard row, never a list the project carries itself');
    assert.equal(shown.items[0].hours, 24);
    step('Planning: the board, the lanes and the items are the database\'s own projects and jobcards');

    // ── Moving a card ───────────────────────────────────────────────────────────────────────
    // 'progress', which is the board's own id for that lane — not 'inprogress', which setLane maps to
    // nothing and returns from silently.
    await page.evaluate((no) => setLane(no, 'progress'), w.ref);
    await until('the lane move to reach Postgres',
      () => value(`SELECT status FROM project WHERE id = ${w.project};`) === 'production');
    assert.equal(value(`SELECT phase FROM project WHERE id = ${w.project};`), 'production',
      'the lane sets the phase as well, which is what the board reads back');
    // The check this file is for. save_project replaces the record.
    assert.equal(value(`SELECT coalesce(po_number,'GONE') || '|' || coalesce(responsible,'GONE')
      || '|' || coalesce(notes,'GONE') || '|' || coalesce(workshop,'GONE')
      || '|' || coalesce(material_status,'GONE') || '|' || coalesce(work_types,'GONE')
      || '|' || coalesce(quoted_value::text,'GONE') || '|' || coalesce(deadline::text,'GONE')
      FROM project WHERE id = ${w.project};`),
      'PO-88213|Anna Berg|Two off, mirrored|Bay 2|ordered|Fabrication, Welding|185000.00|2026-11-06',
      'moving a card across the board must not clear the eight fields the board never shows');
    assert.equal(value(`SELECT count(*) FROM project;`), '1', 'and it is the same project, not a second one');
    step('Planning: moving a card writes the stage and leaves every field the board does not show alone');

    // ── The dates, and the items that move with them ────────────────────────────────────────
    await page.evaluate((no) => openDateForm(no), w.ref);
    await page.waitForSelector('#dateModal.show', { timeout: 5000 });
    await page.locator('#dfStart').fill('2026-10-12');
    await page.locator('#dfDeadline').fill('2026-11-20');
    await page.locator('#dfExpected').fill('2026-11-13');
    await page.locator('#dfHours').fill('52');
    // The item rows the form offers, moved with it: the first item is pushed a week later.
    const moved = await page.evaluate(() => {
      // #itemRows .itemrow, with the date inputs named itStart… / itEnd… — which is what
      // typedItems() reads, and reading it the same way is the only way to be sure the rows the form
      // will send are the rows this test moved.
      const rows = [...document.querySelectorAll('#itemRows .itemrow')];
      if (!rows.length) return 0;
      const first = rows[0];
      const start = first.querySelector('input[id^=itStart]');
      const end = first.querySelector('input[id^=itEnd]');
      if (!start || !end) return 0;
      start.value = '2026-10-12';
      end.value = '2026-10-23';
      start.dispatchEvent(new Event('change'));
      end.dispatchEvent(new Event('change'));
      return rows.length;
    });
    assert.ok(moved >= 2, 'the date form should list both items on the project, or this proves nothing');
    await page.evaluate(() => saveDates());
    await until('the project dates to reach Postgres',
      () => value(`SELECT planned_start::text FROM project WHERE id = ${w.project};`) === '2026-10-12');
    assert.equal(value(`SELECT deadline::text || '|' || planned_completion::text
      || '|' || expected_completion::text || '|' || planned_hours::text
      FROM project WHERE id = ${w.project};`),
      '2026-11-20|2026-11-20|2026-11-13|52.00',
      'the date form writes the deadline, the planned completion, the expected one and the hours');
    if (moved) {
      await until('the item that moved to reach Postgres',
        () => value(`SELECT planned_start::text FROM jobcard WHERE id = ${w.first};`) === '2026-10-12');
      assert.equal(value(`SELECT planned_completion::text FROM jobcard WHERE id = ${w.first};`), '2026-10-23');
      // And the same rule one level down: save_jobcard replaces the record too.
      assert.equal(value(`SELECT coalesce(heat_no,'GONE') || '|' || coalesce(notes,'GONE')
        || '|' || progress::text || '|' || planned_hours::text FROM jobcard WHERE id = ${w.first};`),
        'H240516-S534|from the drawing|25|24.00',
        'nudging an item\'s dates must not clear the heat number, the notes or the hours');
      assert.equal(value(`SELECT planned_start::text FROM jobcard WHERE id = ${w.second};`), '2026-10-19',
        'and the item that did not move is untouched');
      assert.equal(value(`SELECT count(*) FROM jobcard;`), '2', 'no item was duplicated');
      step('Planning: the dates go through, the item that moved moves with them, and the rest is left alone');
    } else {
      assert.fail('the date form listed no items, so the half of this check that matters did not run');
    }

    // ── What this screen cannot do ──────────────────────────────────────────────────────────
    const refused = await page.evaluate(() => {
      const answer = window.WorkshopData.createProjectFromEstimation('E-0001');
      return answer && answer.error ? answer.error : 'nothing was refused';
    });
    assert.match(refused, /does not exist on the server yet/,
      `creating a project from a quotation has to refuse in words: ${refused}`);
    assert.equal(value(`SELECT count(*) FROM project;`), '1', 'and create nothing');
    step('Planning: creating a project from a quotation refuses out loud, and writes nothing');

    // A project that is gone is a refusal rather than a silent no-op.
    const stale = await page.evaluate(() => {
      const answer = window.WorkshopData.updateProject('P-9999-999', { status: 'production' });
      return answer && answer.error ? answer.error : 'nothing was refused';
    });
    assert.match(stale, /no longer here/, `a project that has gone should say so: ${stale}`);
    step('Planning: a project somebody else removed is refused by name rather than silently ignored');

    assert.deepEqual(thrown, [], `the page threw: ${thrown.slice(0, 3).join(' / ')}`);
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
    server.close();
  }
  console.log(`\n${checks} checks: the plan on screen is the workshop's, and moving it moves the database.`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
