'use strict';

// Quality is now four pages instead of sixteen, and the one that matters most is the new
// Quality Holds register: a hold is the only thing in the system that physically stops work
// leaving the building. These tests hold that gate to its promise — it appears when a critical
// failure is recorded, it blocks the jobcard while it stands, and it clears only against a
// named authority and written evidence.

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness, loadDemoData } = require('./helpers/browser-harness');

// The four the screen started with, and the four welding registers that joined them. Named rather than
// counted, because the point of the assertion below is that the nav offers exactly these and nothing
// half-built beside them.
const SECTIONS = ['overview', 'inspections', 'ncr', 'holds', 'welds', 'ndt', 'wps', 'quals'];
const COMPONENT = 'E2E Bracket Weld B-07';
const NCR_TITLE = 'E2E porosity beyond EN ISO 5817 level C';

function step(message) {
  console.log(`OK   ${message}`);
}

async function navigation(page) {
  const nav = await page.evaluate(() =>
    [...document.querySelectorAll('#qualityNav .sideitem[data-section]')].map((b) => b.dataset.section));
  assert.deepEqual(nav, SECTIONS, `the module should offer exactly these ${SECTIONS.length} pages`);

  for (const section of SECTIONS) {
    await page.locator(`.sideitem[data-section="${section}"]`).click();
    const visible = await page.evaluate(() =>
      [...document.querySelectorAll('.section')].filter((s) => s.style.display !== 'none').map((s) => s.id));
    assert.deepEqual(visible, [`section-${section}`], `${section} should be the only page on screen`);
  }
  step('Quality: four pages, one on screen at a time');
}

async function inspectionToHold(page) {
  await page.locator('.sideitem[data-section="inspections"]').click();
  await page.evaluate(() => openNewInspectionModal());
  await page.locator('#ins_project').selectOption('P-2026-014');
  await page.locator('#ins_jobcard').selectOption('JC-2026-0002');
  await page.locator('#ins_type').selectOption('welding');
  await page.locator('#ins_component').fill(COMPONENT);
  await page.locator('#ins_inspector').fill('E2E Inspector');
  await page.locator('#ins_criteria').fill('EN ISO 5817 level C');
  await page.evaluate(() => submitInspection());
  await page.waitForFunction((component) =>
    WorkshopData.listQualityInspections().some((i) => i.component === component), COMPONENT);

  const created = await page.evaluate((component) =>
    WorkshopData.listQualityInspections().find((i) => i.component === component), COMPONENT);
  assert.equal(created.status, 'requested');
  assert.equal(created.result, 'pending');
  assert.ok((await page.locator('#insp-list-body').innerText()).includes(created.no));
  step('Quality: a new inspection lands in the register as requested, not decided');

  const holdsBefore = await page.evaluate(() => WorkshopData.getActiveQualityHolds().length);

  await page.evaluate((no) => openExecInspection(no), created.no);
  await page.locator('#exec_result').selectOption('failed');
  await page.locator('#exec_critical').check();
  await page.locator('#exec_findings').fill('Porosity cluster 14 mm, beyond level C. Weld rejected.');
  await page.evaluate(() => submitInspectionResult());
  await page.waitForFunction((count) => WorkshopData.getActiveQualityHolds().length > count, holdsBefore);

  const hold = (await page.evaluate(() => WorkshopData.getActiveQualityHolds()))
    .find((h) => String(h.relatedRef) === created.no);
  assert.ok(hold, 'a critical failed inspection must raise a hold');
  assert.equal(hold.status, 'active');
  assert.equal(hold.severity, 'critical');
  assert.equal(hold.reference, 'JC-2026-0002');
  step('Quality: a critical failure raises a hold naming the jobcard it stops');

  return hold;
}

async function holdsPage(page, hold) {
  await page.locator('.sideitem[data-section="holds"]').click();
  const table = await page.locator('#holdsBody').innerText();
  assert.ok(table.includes(hold.no), 'the hold should be listed on its own page');
  assert.ok(table.includes('JC-2026-0002'), 'the register should name what the hold blocks');

  const counts = await page.evaluate(() => ({
    active: Number(document.getElementById('hold-active').textContent),
    jobcards: Number(document.getElementById('hold-jobcards').textContent),
    released: Number(document.getElementById('hold-released').textContent)
  }));
  const truth = await page.evaluate(() => {
    const all = WorkshopData.listQualityHolds();
    const live = all.filter((h) => h.status === 'active');
    return {
      active: live.length,
      jobcards: live.filter((h) => h.scope === 'jobcard').length,
      released: all.filter((h) => h.status !== 'active').length
    };
  });
  assert.deepEqual(counts, truth, 'the figures on the page must be the figures in the data');
  step('Quality: the holds register counts what it lists');
}

async function holdBlocksWork(page, hold) {
  const gate = await page.evaluate(() => WorkshopData.getJobcardQualityGate('JC-2026-0002'));
  assert.equal(gate.blocked, true, 'an active hold must block its jobcard');
  assert.ok(gate.holds.some((h) => h.no === hold.no));

  const allowed = await page.evaluate(() => WorkshopData.canTransitionJobcard('JC-2026-0002').allowed);
  assert.equal(allowed, false);
  const attempt = await page.evaluate(() =>
    WorkshopData.updateJobcard('JC-2026-0002', { status: 'completed' }));
  assert.ok(attempt && attempt.error, 'completing a held jobcard should be refused, not merely discouraged');
  assert.notEqual(
    await page.evaluate(() => WorkshopData.findJobcard('JC-2026-0002').status), 'completed',
    'the refused transition must leave the jobcard where it was');
  step('Quality: while the hold stands the jobcard cannot be completed');
}

async function releaseNeedsEvidence(page, hold) {
  await page.evaluate((no) => openHoldReleaseModal(no), hold.no);
  await page.evaluate(() => submitHoldRelease());
  let stillActive = await page.evaluate((no) =>
    WorkshopData.listQualityHolds().find((h) => h.no === no).status, hold.no);
  assert.equal(stillActive, 'active', 'an empty release form must not clear a hold');
  assert.ok((await page.locator('#holdFormErr').innerText()).length > 0, 'the refusal should be stated on the form');

  await page.locator('#hold_authority').fill('E2E Quality Manager');
  await page.evaluate(() => submitHoldRelease());
  stillActive = await page.evaluate((no) =>
    WorkshopData.listQualityHolds().find((h) => h.no === no).status, hold.no);
  assert.equal(stillActive, 'active', 'an authority without evidence must not clear a hold either');

  await page.locator('#hold_reason').fill('Weld ground out and re-run; PT accepted on reinspection.');
  await page.evaluate(() => submitHoldRelease());
  await page.waitForFunction((no) =>
    WorkshopData.listQualityHolds().find((h) => h.no === no).status === 'released', hold.no);

  const released = await page.evaluate((no) =>
    WorkshopData.listQualityHolds().find((h) => h.no === no), hold.no);
  assert.equal(released.releaseAuthority, 'E2E Quality Manager');
  assert.ok(released.releaseReason.includes('PT accepted'));
  assert.ok(released.releaseDate, 'a released hold must record when');
  step('Quality: releasing a hold demands a named authority and written evidence');

  const gate = await page.evaluate(() => WorkshopData.getJobcardQualityGate('JC-2026-0002'));
  assert.equal(gate.blocked, false, 'releasing the hold must unblock the jobcard');
  step('Quality: the released hold stops blocking the work it named');
}

async function releaseSurvivesReload(page, hold) {
  await page.reload({ waitUntil: 'load' });
  await page.locator('.sideitem[data-section="holds"]').click();
  const table = await page.locator('#holdsBody').innerText();
  assert.ok(table.includes(hold.no));
  assert.ok(/Released/i.test(table), 'the released hold should still be on the register, marked released');
  assert.equal(await page.evaluate(() => document.getElementById('hold-released').textContent !== '0'), true);
  step('Quality: a released hold stays on the record after reload');
}

async function ncrRegister(page) {
  await page.locator('.sideitem[data-section="ncr"]').click();
  await page.evaluate(() => openNewNcrModal());
  await page.locator('#ncr_project').selectOption('P-2026-014');
  await page.locator('#ncr_title').fill(NCR_TITLE);
  await page.locator('#ncr_category').selectOption('welding');
  await page.locator('#ncr_severity').selectOption('major');
  await page.locator('#ncr_description').fill('Found during E2E run.');
  await page.locator('#ncr_responsible').fill('E2E Quality Manager');
  await page.locator('#ncr_due').fill('2026-12-01');
  await page.evaluate(() => submitNcr());
  await page.waitForFunction((title) =>
    WorkshopData.listQualityNcrs().some((n) => n.title === title), NCR_TITLE);

  const ncr = await page.evaluate((title) =>
    WorkshopData.listQualityNcrs().find((n) => n.title === title), NCR_TITLE);
  assert.ok((await page.locator('#ncr-list-body').innerText()).includes(ncr.no));

  const shown = await page.evaluate(() => Number(document.getElementById('ncr-total').textContent));
  const held = await page.evaluate(() => WorkshopData.listQualityNcrs().length);
  assert.equal(shown, held, 'the NCR count on the page must be the NCR count in the data');
  step('Quality: a new NCR reaches the register and the register counts it');
}

async function overviewMatchesRecords(page) {
  await page.locator('.sideitem[data-section="overview"]').click();
  const strip = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#section-overview .kpistrip .kpi')];
    const tops = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top)));
    return { count: cards.length, rows: tops.size };
  });
  assert.equal(strip.count, 6);
  assert.equal(strip.rows, 1, 'the overview figures should sit on one flush row');

  const shown = await page.evaluate(() => ({
    failed: Number(document.getElementById('kpi-failed').textContent),
    openNcr: Number(document.getElementById('kpi-open-ncr').textContent),
    holds: Number(document.getElementById('kpi-active-holds').textContent)
  }));
  const truth = await page.evaluate(() => ({
    failed: WorkshopData.listQualityInspections().filter((i) => i.result === 'failed').length,
    openNcr: WorkshopData.listQualityNcrs().filter((n) => !['closed', 'rejected'].includes(n.status)).length,
    holds: WorkshopData.getActiveQualityHolds().length
  }));
  assert.deepEqual(shown, truth, 'every figure on the overview must come from a record');
  step('Quality: the overview reports the records, not a fixed picture');
}

async function emptySystemShowsNothing(page) {
  await page.evaluate(() => WorkshopData.reset());
  await page.reload({ waitUntil: 'load' });
  await page.locator('.sideitem[data-section="overview"]').click();
  const values = await page.evaluate(() =>
    [...document.querySelectorAll('#section-overview .kpistrip .kv')].map((e) => e.textContent.trim()));
  assert.deepEqual(values, ['0', '0', '0', '0', '0', '0'], 'an empty system must not show a figure it does not have');

  await page.locator('.sideitem[data-section="holds"]').click();
  assert.match(await page.locator('#holdsBody').innerText(), /no quality holds/i);
  step('Quality: an empty system reads as empty on every page');
}

async function main() {
  const harness = await startBrowserHarness();
  const page = await harness.context.newPage();
  const monitor = monitorPage(page, harness.baseUrl);
  try {
    await page.goto(`${harness.baseUrl}/quality-desktop.html`, { waitUntil: 'load' });
    await loadDemoData(page);
    await navigation(page);
    const hold = await inspectionToHold(page);
    await holdsPage(page, hold);
    await holdBlocksWork(page, hold);
    await releaseNeedsEvidence(page, hold);
    await releaseSurvivesReload(page, hold);
    await ncrRegister(page);
    await overviewMatchesRecords(page);
    await emptySystemShowsNothing(page);
    monitor.assertClean();
    console.log('\nQuality browser E2E passed.');
  } finally {
    await page.close();
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
