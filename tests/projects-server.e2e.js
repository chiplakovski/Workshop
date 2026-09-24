'use strict';

// Making a project on the database, from the screen that makes projects.
//
// This is the gap that blocked real use: save_project existed and no wired screen called it, so a
// workshop could record a customer and then get no further — nothing on a screen could create the
// project the jobcards and the hours hang off.
//
// Half of this screen is wired and half is not, and the test asserts both halves. Estimating carries
// work items in nested groups, options, terms, exclusions, a revision history and a priced bill of
// materials; the estimate table holds seven columns. That gap is real work on the schema, so the
// estimating writes refuse out loud rather than write to a browser the next reload wipes.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_projects_test';
const HTTP_PORT = Number(process.env.VARMAK_PROJECTS_PORT || 8921);

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

// A customer and nothing else, which is exactly the state a workshop is in on its second day.
function aWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const customer = value(`INSERT INTO customer (name, city) VALUES ('MarineVent AB', 'Malmö') RETURNING id;`);
  return { customer };
}

async function main() {
  buildDatabase();
  const w = aWorkshop();
  assert.equal(value(`SELECT count(*) FROM project;`), '0', 'this suite starts with no work at all');

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

    await page.goto(`${site}/estimations-desktop.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
      { timeout: 8000 });
    assert.equal(await page.locator('[role="alert"]').count(), 0, 'the guard must let this page through');
    const customers = await page.evaluate(() => Object.values(CUSTOMERS).map((c) => c.name));
    assert.deepEqual(customers, ['MarineVent AB'], 'the customer comes from the database');
    step('Projects: the estimating screen reads the workshop\'s own customers and has no work yet');

    // ── Making one, through the page's own form ─────────────────────────────────────────────
    await page.evaluate(() => openNewProject());
    await page.waitForSelector('#npName', { timeout: 5000 });
    await page.locator('#npName').fill('Conveyor frame');
    await page.locator('#npKind').selectOption('offer');   // 'offer' and 'internal' are fabrication; 'service' is service
    await page.locator('#npDeadline').fill('2026-11-30');
    // Two items on it, which the screen turns into jobcards on the project.
    await page.locator('#npItemDesc').fill('Frame weldment');
    await page.evaluate(() => addNewProjItem());
    await page.locator('#npItemDesc').fill('Hopper');
    await page.evaluate(() => addNewProjItem());
    await page.evaluate(() => saveNewProject());

    const project = await until('the project to reach Postgres',
      () => value(`SELECT coalesce((SELECT id::text FROM project WHERE name = 'Conveyor frame'), '');`));
    assert.match(value(`SELECT ref FROM project WHERE id = ${project};`), /^P-\d{4}-\d{3}$/,
      'the reference comes from the dated sequence, not from the browser');
    assert.equal(value(`SELECT status::text FROM project WHERE id = ${project};`), 'quotation');
    assert.equal(value(`SELECT (customer_id = ${w.customer})::text FROM project WHERE id = ${project};`), 'true');
    assert.equal(value(`SELECT work_types FROM project WHERE id = ${project};`), 'Fabrication',
      'the kind of work is a list on screen and one field in the column');
    assert.equal(value(`SELECT coalesce(quoted_value::text, 'not quoted') FROM project WHERE id = ${project};`),
      'not quoted', 'nothing has been priced, which is not the same answer as zero');
    step('Projects: a project typed into the form is in the database, numbered, against its customer');

    // The items became jobcards on it, with the customer taken from the project rather than sent.
    await until('the two items to reach Postgres',
      () => value(`SELECT count(*) FROM jobcard WHERE project_id = ${project};`) === '2');
    assert.equal(value(`SELECT string_agg(title, ', ' ORDER BY ref) FROM jobcard
      WHERE project_id = ${project};`), 'Frame weldment, Hopper');
    assert.equal(value(`SELECT bool_and(j.customer_id = p.customer_id)::text FROM jobcard j
      JOIN project p ON p.id = j.project_id WHERE p.id = ${project};`), 'true',
      'each item takes its customer from the project, because there is no parameter that could differ');
    assert.equal(value(`SELECT count(*) FROM activity_log WHERE entity = 'project' AND action = 'created';`), '1');
    step('Projects: the items on it are jobcards in the database, each taking its customer from the project');

    // ── Refusals reach the screen ──────────────────────────────────────────────────────────
    await page.evaluate(() => openNewProject());
    await page.waitForSelector('#npName', { timeout: 5000 });
    await page.locator('#npName').fill('   ');
    await page.evaluate(() => saveNewProject());
    // The page's own required-field check speaks first, which is correct — it is the same rule.
    const local = await page.locator('#npErr').innerText().catch(() => '');
    assert.ok(local.length > 0, 'a project with no name is refused before it reaches the server');
    assert.equal(value(`SELECT count(*) FROM project;`), '1');
    step('Projects: a project with no name never leaves the screen, and nothing was written');

    // ── And the half that is not built ─────────────────────────────────────────────────────
    const said = await page.evaluate(() => window.WorkshopData.upsertEstimation({
      customer: 'MarineVent AB', title: 'Conveyor frame', status: 'draft', sellingPrice: 42000
    }));
    assert.ok(said && said.error, 'estimating has no workflow, so the page must be told');
    assert.match(said.error, /Estimating does not exist on the server yet/);
    assert.match(said.error, /Nothing was written/);
    assert.equal(value(`SELECT count(*) FROM estimate;`), '0');
    step('Projects: estimating has no workflow yet, and the screen says so rather than losing a quote');

    // The project side keeps working after that refusal, which is the thing a half-wired screen has to
    // prove: one half being unavailable does not take the other half down with it.
    await page.evaluate(() => openNewProject());
    await page.waitForSelector('#npName', { timeout: 5000 });
    await page.locator('#npName').fill('Hopper frame');
    await page.locator('#npKind').selectOption('service');
    await page.evaluate(() => saveNewProject());
    await until('the second project to reach Postgres',
      () => value(`SELECT count(*) FROM project;`) === '2');
    assert.equal(value(`SELECT work_types FROM project WHERE name = 'Hopper frame';`), 'Service');
    step('Projects: and the project half still works after the estimating half has refused');

    assert.deepEqual([...new Set(thrown)], [], `the page threw: ${[...new Set(thrown)].join(' / ')}`);
    console.log(`\n${checks} checks: a workshop can put work on the board without opening psql.`);
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
