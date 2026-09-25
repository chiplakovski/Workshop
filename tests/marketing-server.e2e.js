'use strict';

// The sales pipeline on the database, driven through its own screen.
//
// The measurement was most of the work here. The coverage meter reported twelve fields across leads and
// enquiries as needing a column, and both README and BACKEND.md said the remaining schema width was
// "concentrated on estimating, purchasing and the sales pipeline" — while every one of the twelve had had
// a column since the pipeline was written, under the longer name the schema uses for a date or a figure.
//
// What was genuinely missing was narrower and sharper, and this suite checks each of the four:
//
//   * Two of the board's eight columns had no value in the stage enum, so dragging a card into either was
//     refused — on a board, where dragging a card is the one action there is.
//   * The lead filter has offered 'disqualified' since it was written, against a column that allowed only
//     'lost'. They are not the same thing: a lead is disqualified, an enquiry is lost to somebody.
//   * The tender form showed nine fields the table had nowhere to keep.
//   * do-not-contact, which is the law, and which the screen can set from two different places.
//
// And the one that is about the whole system rather than this screen: the pipeline arrives in the office's
// own payload, because with it in the plain snapshot a welder was refused the WHOLE workshop.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ensureUp } = require('../backend/pg');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = 'varmak_marketing_test';
const HTTP_PORT = Number(process.env.VARMAK_MARKETING_PORT || 8957);

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

function aWorkshop() {
  sql(`SET client_min_messages = warning;
    SELECT bootstrap_first_admin('anna@varmak.se', 'Anna Berg', 'correct horse battery staple');`);
  const welder = value(`INSERT INTO app_user (email, display_name, role)
    VALUES ('marko@varmak.se', 'Marko Ilic', 'workshop') RETURNING id;`);
  sql(`SELECT set_password(${welder}, 'a long enough passphrase');`);
  // One jobcard, so the welder's snapshot has work in it — which is the thing putting the pipeline in the
  // office's payload protects.
  const customer = value(`INSERT INTO customer (name, city) VALUES ('MarineVent AB', 'Malmö') RETURNING id;`);
  const project = value(`INSERT INTO project (name, customer_id, status) VALUES ('Frame', ${customer}, 'production') RETURNING id;`);
  sql(`INSERT INTO jobcard (project_id, customer_id, title) VALUES (${project}, ${customer}, 'Weldment');`);
  return { welder, customer };
}

async function signIn(page, site, email, secret) {
  await page.goto(`${site}/login.html`, { waitUntil: 'load' });
  await page.waitForSelector('#signInForm:not([hidden])', { timeout: 8000 });
  await page.locator('#signInEmail').fill(email);
  await page.locator('#signInSecret').fill(secret);
  await page.locator('#signInGo').click();
  await page.waitForURL(/hours-mobile\.html|hub-/, { timeout: 8000 });
}

async function openMarketing(page, site) {
  await page.goto(`${site}/marketing-desktop.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.WorkshopData && window.WorkshopData.isServerBacked(),
    { timeout: 8000 });
  assert.equal(await page.locator('[role="alert"]').count(), 0, 'the guard must let this page through');
}

async function main() {
  buildDatabase();
  const w = aWorkshop();
  assert.equal(value(`SELECT count(*) FROM lead;`), '0', 'the pipeline starts empty');

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
    await openMarketing(page, site);
    step('Pipeline: the board opens for a signed-in session instead of refusing');

    // ── A lead ──────────────────────────────────────────────────────────────────────────────
    await page.evaluate(() => {
      openLeadForm();
      const set = (id, v) => { document.getElementById(id).value = v; };
      set('lfCompany', 'Nordic Fabrication AB');
      set('lfContact', 'Petra Lind');
      set('lfEmail', 'petra@nordfab.se');
      set('lfPhone', '+46 42 555 90 10');
      set('lfCity', 'Helsingborg');
      set('lfCountry', 'Sweden');
      set('lfIndustry', 'Marine');
      set('lfSize', '50-200');
      set('lfService', 'Stainless fabrication');
      set('lfValue', '480000');
      set('lfFollowup', '2026-10-05');
      return saveLeadForm(null);
    });
    await until('the lead to reach Postgres', () => value(`SELECT count(*) FROM lead;`) === '1');
    const lead = value(`SELECT id FROM lead;`);
    assert.match(value(`SELECT ref FROM lead WHERE id = ${lead};`), /^L-\d{4}$/);
    // The five the meter called missing, every one of which had a column all along.
    assert.equal(value(`SELECT company_size || '|' || service_wanted || '|' || estimated_value::text
      || '|' || next_follow_up_on::text || '|' || contact_preference FROM lead WHERE id = ${lead};`),
      '50-200|Stainless fabrication|480000.00|2026-10-05|Email',
      'the fields the coverage meter called missing, which were renames');
    // And the priority the form offers, which the column has no word for.
    assert.equal(value(`SELECT priority FROM lead WHERE id = ${lead};`), 'normal',
      'the form offers "medium" and the column says "normal" — unmapped, every lead would be refused');
    step('Pipeline: a lead goes in from the form, whole, including the fields called missing');

    // ── Qualifying it makes the enquiry ─────────────────────────────────────────────────────
    const qualified = await until('the lead to reach the screen', () => page.evaluate(
      () => ((window.WorkshopData.get().marketingLeads || [])[0] || {}).id || null));
    assert.equal(String(qualified), lead);
    await page.evaluate(async (id) => {
      openQualifyLead(Number(id));
      document.getElementById('qualNote').value = 'Wants a price on ten duct runs';
      await saveQualifyLead(Number(id));
    }, lead);
    await until('the enquiry to reach Postgres', () => value(`SELECT count(*) FROM opportunity;`) === '1');
    const opp = value(`SELECT id FROM opportunity;`);
    assert.equal(value(`SELECT (lead_id = ${lead})::text || '|' || stage::text
      FROM opportunity WHERE id = ${opp};`), 'true|qualified',
      'qualifying a lead raises the enquiry against it, at the stage the board puts it in');
    assert.equal(value(`SELECT status::text FROM lead WHERE id = ${lead};`), 'qualified');
    step('Pipeline: qualifying a lead raises the enquiry against it, in one go');

    // ── The board's eight columns ───────────────────────────────────────────────────────────
    //
    // Two of them — rfq and qualified — had no value in the enum, so dragging a card into either was
    // refused. On a board that is the one action there is.
    for (const stage of ['rfq', 'preparing', 'quotesent', 'negotiation']) {
      const moved = await page.evaluate(async ([id, to]) => {
        const o = window.WorkshopData.get().marketingOpportunities.find((x) => String(x.id) === String(id));
        o.stage = to;
        const answer = await syncOpportunity(o);
        return answer && answer.error ? answer.error : '';
      }, [opp, stage]);
      assert.equal(moved, '', `dragging the card into ${stage} refused: ${moved}`);
      await until(`the card to land in ${stage}`,
        () => value(`SELECT stage::text FROM opportunity WHERE id = ${opp};`) === stage);
    }
    step('Pipeline: a card is dragged through all eight of the board\'s own columns');

    // ── Losing it says why ──────────────────────────────────────────────────────────────────
    const lostWithNoReason = await page.evaluate(async (id) => {
      const o = window.WorkshopData.get().marketingOpportunities.find((x) => String(x.id) === String(id));
      o.stage = 'lost';
      o.decisionReason = '';
      const answer = await syncOpportunity(o);
      return answer && answer.error ? answer.error : 'nothing was refused';
    }, opp);
    assert.match(lostWithNoReason, /why it was lost/,
      `losing an enquiry without saying why has to refuse: ${lostWithNoReason}`);
    assert.notEqual(value(`SELECT stage::text FROM opportunity WHERE id = ${opp};`), 'lost');
    await page.evaluate(async (id) => {
      openMarkLost(Number(id));
      document.getElementById('lostReason').value = 'Beaten on lead time by three weeks';
      await saveMarkLost(Number(id));
    }, opp);
    await until('the loss to reach Postgres',
      () => value(`SELECT stage::text FROM opportunity WHERE id = ${opp};`) === 'lost');
    assert.equal(value(`SELECT decision_reason FROM opportunity WHERE id = ${opp};`),
      'Beaten on lead time by three weeks');
    step('Pipeline: a lost enquiry records why, which is the one field worth having');

    // ── do-not-contact, which is the law ────────────────────────────────────────────────────
    await page.evaluate(async (id) => {
      openDisqualifyLead(Number(id));
      document.getElementById('disqReason').value = 'Asked us not to call again';
      document.getElementById('disqDnc').checked = true;
      await saveDisqualifyLead(Number(id));
    }, lead);
    await until('the lead to be marked',
      () => value(`SELECT do_not_contact::text FROM lead WHERE id = ${lead};`) === 'true');
    // Disqualified, not lost. The filter has offered the word since it was written, against a column that
    // allowed only 'lost'.
    assert.equal(value(`SELECT status::text FROM lead WHERE id = ${lead};`), 'disqualified',
      'a lead is disqualified because it was never going to be work; an enquiry is lost, to somebody');
    assert.equal(value(`SELECT coalesce(next_follow_up_on::text, 'none') FROM lead WHERE id = ${lead};`),
      'none', 'and the follow-up comes off with it, because the database will not hold both');
    const bookedAnyway = await page.evaluate(async (id) => {
      const l = window.WorkshopData.get().marketingLeads.find((x) => String(x.id) === String(id));
      l.dnc = true;
      l.nextFollowUp = '2026-10-20';
      const answer = await syncLead(l);
      return answer && answer.error ? answer.error : '';
    }, lead);
    assert.equal(bookedAnyway, '',
      'the record module holds the follow-up back rather than sending a save that fails');
    assert.equal(value(`SELECT coalesce(next_follow_up_on::text, 'none') FROM lead WHERE id = ${lead};`),
      'none', 'and nothing was booked');
    step('Pipeline: somebody who asked not to be contacted keeps no follow-up, from either screen');

    // ── A tender, and the nine fields the table had nowhere to keep ─────────────────────────
    await page.evaluate(async () => {
      openTenderForm();
      const set = (id, v) => { document.getElementById(id).value = v; };
      set('tfRef', 'HH-2026-441');
      set('tfCompany', 'Helsingborgs Hamn AB');
      set('tfSource', 'Public procurement');
      set('tfIndustry', 'Marine');
      set('tfDesc', 'Two gantry frames, hot-dip galvanised');
      set('tfDeadline', '2026-11-30');
      set('tfValue', '1250000');
      set('tfBid', 'pending');
      set('tfReminder', '2026-11-20');
      set('tfRequirements', 'EN 1090-2 EXC3');
      await saveTenderForm(null);
    });
    await until('the tender to reach Postgres', () => value(`SELECT count(*) FROM tender;`) === '1');
    const tender = value(`SELECT id FROM tender;`);
    assert.equal(value(`SELECT company || '|' || customer_ref || '|' || source || '|' || industry
      || '|' || requirements || '|' || bid_decision || '|' || reminder_on::text || '|' || due_on::text
      FROM tender WHERE id = ${tender};`),
      'Helsingborgs Hamn AB|HH-2026-441|Public procurement|Marine|EN 1090-2 EXC3|pending|2026-11-20|2026-11-30',
      'the nine fields the tender form showed and the table had nowhere to keep');
    assert.match(value(`SELECT ref FROM tender WHERE id = ${tender};`), /^T\d{6}-\d{3}$|^T-/,
      'our own reference is the database\'s to allocate; the form\'s ref is theirs');
    step('Pipeline: a tender is recorded whole, with their reference beside ours');

    // ── What a welder gets ──────────────────────────────────────────────────────────────────
    //
    // The check this suite exists for. The pipeline lists were in the plain snapshot first, and `lead` is
    // not granted to the floor — so a welder was refused the WHOLE workshop, every screen, not just this
    // one. They arrive in the office's own payload now.
    const floor = await context.newPage();
    floor.on('pageerror', (error) => thrown.push(error.stack || error.message));
    await signIn(floor, site, 'marko@varmak.se', 'a long enough passphrase');
    const asWelder = await floor.evaluate(() => window.WorkshopApi.snapshot());
    assert.ok(!asWelder.failed && !asWelder.signedOut,
      `a welder's whole workshop has to arrive: ${JSON.stringify(asWelder).slice(0, 200)}`);
    assert.ok(Array.isArray(asWelder.data.jobcards) && asWelder.data.jobcards.length,
      'including the work, which is the thing putting the pipeline elsewhere protects');
    assert.equal(asWelder.data.seesMoney, false);
    assert.equal((asWelder.data.marketingLeads || []).length, 0,
      'and no leads at all rather than leads with the figures taken out');
    step('Pipeline: a welder\'s whole workshop still arrives, and carries none of the pipeline');

    await floor.goto(`${site}/marketing-desktop.html`, { waitUntil: 'load' });
    const blocked = await floor.locator('[role="alert"]').count();
    const refused = await floor.evaluate(async () => {
      const answer = await window.WorkshopApi.call('save_lead', { id: null, company: 'Somebody AB' });
      return answer.ok ? 'nothing was refused' : answer.refused;
    });
    assert.match(refused, /not yours to do/, `the floor cannot record a lead: ${refused}`);
    assert.equal(value(`SELECT count(*) FROM lead;`), '1');
    step(`Pipeline: and the floor cannot record one — the pipeline is the office's${blocked ? '' : ''}`);

    // ── Nothing went into browser storage ───────────────────────────────────────────────────
    const stored = await page.evaluate(() => {
      try { return localStorage.getItem('varmak.workshop.v1'); } catch (e) { return null; }
    });
    assert.ok(!stored || !stored.includes('Nordic Fabrication AB'),
      'the pipeline was also written into browser storage, which is a second copy nobody reconciles');
    step('Pipeline: and nothing went into browser storage — the record is in one place');

    // ── What this screen cannot do yet ──────────────────────────────────────────────────────
    const campaign = await page.evaluate(() => {
      const answer = window.WorkshopData.upsertMarketingCampaign({ name: 'Spring mailing' });
      return answer && answer.error ? answer.error : 'nothing was refused';
    });
    assert.match(campaign, /not on the workshop database yet/,
      `a campaign has no table and has to refuse out loud: ${campaign}`);
    const sweep = await page.evaluate(() => {
      const answer = window.WorkshopData.recordProspectSweep([], { source: 'stub' });
      return answer && answer.error ? answer.error : 'nothing was refused';
    });
    assert.match(sweep, /not on the workshop database yet/, sweep);
    step('Pipeline: a campaign and the outward sweep refuse out loud, and write nothing');

    assert.deepEqual(thrown, [], `the page threw: ${thrown.slice(0, 3).join(' / ')}`);
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
    server.close();
  }
  console.log(`\n${checks} checks: the pipeline is the workshop's, and the board's own columns are the `
    + 'ones the database holds.');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
