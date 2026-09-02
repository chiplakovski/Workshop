'use strict';

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness } = require('./helpers/browser-harness');

const PROJECT_NO = 'P-2026-014';
const JOBCARD_TITLE = 'E2E Grinder Production Job';
const OPERATION_NAME = 'E2E deburr welded frame';
const EQUIPMENT_ID = 'E-1007';
const LOGGED_HOURS = 2.5;

function step(message) {
  console.log(`OK   ${message}`);
}

async function saveModal(page) {
  await page.locator('#fcard .fbtns .primary').click();
  await page.waitForTimeout(70);
}

async function jobcardWorkflow(page) {
  await page.evaluate(() => openFromProjectForm());
  await page.locator('#fpProject').selectOption(PROJECT_NO);
  await page.locator('#fpTitle').fill(JOBCARD_TITLE);
  await page.locator('#fpWorktype').selectOption('fabrication');
  await page.locator('#fpPriority').selectOption('high');
  await page.locator('#fpStart').fill('2026-09-02');
  await saveModal(page);

  let jobcard = await page.evaluate((title) => WorkshopData.listJobcards().find((item) => item.title === title), JOBCARD_TITLE);
  assert.ok(jobcard, 'new Jobcard was not persisted');
  assert.equal(jobcard.projectNo, PROJECT_NO);
  assert.equal(jobcard.status, 'draft');
  step('Jobcards: create-from-project persists a real production record');

  await page.evaluate((id) => openOpForm(id), jobcard.id);
  await page.locator('#opDesc').fill(OPERATION_NAME);
  await page.locator('#opWorker').selectOption('Marko K.');
  await page.locator('#opPlannedHours').fill('6');
  await page.locator('#opPlannedStart').fill('2026-09-02');
  await saveModal(page);

  jobcard = await page.evaluate((id) => WorkshopData.findJobcard(id), jobcard.id);
  const operation = jobcard.operations.find((item) => item.desc === OPERATION_NAME);
  assert.ok(operation, 'operation was not persisted on the Jobcard');
  assert.equal(operation.plannedHours, 6);
  step('Jobcards: operation persists with worker and planned hours');

  await page.evaluate(({ id, equipmentId }) => openAddMachineDetails(id, equipmentId), { id: jobcard.id, equipmentId: EQUIPMENT_ID });
  await page.locator('#mcPlanned').fill('4');
  await page.locator('#mcOperator').fill('Marko K.');
  await saveModal(page);

  let equipment = await page.evaluate((equipmentId) => WorkshopData.getEquipment().find((item) => item.equipmentId === equipmentId), EQUIPMENT_ID);
  jobcard = await page.evaluate((id) => WorkshopData.findJobcard(id), jobcard.id);
  assert.equal(equipment.assignedProject, PROJECT_NO);
  assert.equal(equipment.assignedJobcard, jobcard.no);
  assert.ok(jobcard.machines.some((item) => item.equipmentId === EQUIPMENT_ID));
  step('Jobcards → Equipment: safe machine assignment persists on both records');

  await page.evaluate(({ id, equipmentId }) => openPreUseCheckForm(id, equipmentId), { id: jobcard.id, equipmentId: EQUIPMENT_ID });
  await page.locator('#pcDate').fill('2026-09-02');
  await page.locator('#pcCheckedBy').fill('Marko K.');
  await page.locator('#pcResult').selectOption('passed');
  await page.locator('#pcEvidence').fill('Guard, disc and cable inspected before use.');
  await saveModal(page);

  equipment = await page.evaluate((equipmentId) => WorkshopData.getEquipment().find((item) => item.equipmentId === equipmentId), EQUIPMENT_ID);
  assert.equal(equipment.preUseChecks[0].result, 'passed');
  assert.equal(equipment.preUseChecks[0].jobcardNo, jobcard.no);
  step('Jobcards → Equipment: pre-use safety evidence is recorded for the assignment');

  return { id: jobcard.id, no: jobcard.no, operationId: operation.id };
}

async function hoursWorkflow(page, jobcard) {
  await page.locator('#project').selectOption(PROJECT_NO);
  await page.locator('#item').selectOption({ label: OPERATION_NAME });
  await page.locator('#hours').fill(String(LOGGED_HOURS));
  await page.locator('#date2').fill('2026-09-02');
  await page.locator('#notes').fill('E2E production time with grinder usage.');
  await page.locator('#equipList .eqsel').selectOption(EQUIPMENT_ID);
  await page.locator('#equipList .eqhrs').fill(String(LOGGED_HOURS));

  page.once('dialog', async (dialog) => {
    assert.match(dialog.message(), /saved/i);
    await dialog.accept();
  });
  await page.locator('#saveEntry').click();
  await page.waitForTimeout(70);

  const state = await page.evaluate(({ no, operationId, equipmentId, operationName }) => {
    const currentJobcard = WorkshopData.findJobcard(no);
    const equipment = WorkshopData.getEquipment().find((item) => item.equipmentId === equipmentId);
    return {
      hour: WorkshopData.get().hours.find((item) => item.jobcard === no && item.operation === operationName),
      operation: currentJobcard.operations.find((item) => item.id === operationId),
      usage: equipment.usageHistory.find((item) => item.jobcard === no)
    };
  }, { no: jobcard.no, operationId: jobcard.operationId, equipmentId: EQUIPMENT_ID, operationName: OPERATION_NAME });

  assert.ok(state.hour, 'Hours did not persist the labour record');
  assert.equal(state.hour.hours, LOGGED_HOURS);
  assert.equal(state.hour.worker, 'Marko K.');
  assert.equal(state.operation.loggedHours, LOGGED_HOURS);
  assert.ok(state.usage, 'Equipment usage was not persisted');
  assert.equal(state.usage.meterAfter - state.usage.meterBefore, LOGGED_HOURS);
  step('Hours → Jobcards/Equipment: one save updates labour, operation, and machine usage');

  await page.reload({ waitUntil: 'load' });
  const restored = await page.evaluate(({ no, equipmentId, operationName }) => {
    const hour = WorkshopData.get().hours.find((item) => item.jobcard === no && item.operation === operationName);
    const equipment = WorkshopData.getEquipment().find((item) => item.equipmentId === equipmentId);
    return { hour, assignedJobcard: equipment.assignedJobcard, usageCount: equipment.usageHistory.filter((item) => item.jobcard === no).length };
  }, { no: jobcard.no, equipmentId: EQUIPMENT_ID, operationName: OPERATION_NAME });
  assert.equal(restored.hour.hours, LOGGED_HOURS);
  assert.equal(restored.assignedJobcard, jobcard.no);
  assert.equal(restored.usageCount, 1);
  step('Hours: labour and equipment usage survive reload without duplication');
}

async function equipmentWorkflow(page, jobcard) {
  await page.locator('[data-view="all"]').first().click();
  await page.locator(`[data-open-equipment="${EQUIPMENT_ID}"]`).click();
  const body = await page.locator('body').innerText();
  assert.ok(body.includes(EQUIPMENT_ID));
  assert.ok(body.includes(jobcard.no));

  const equipment = await page.evaluate((equipmentId) => WorkshopData.getEquipment().find((item) => item.equipmentId === equipmentId), EQUIPMENT_ID);
  assert.equal(equipment.assignedProject, PROJECT_NO);
  assert.equal(equipment.assignedJobcard, jobcard.no);
  assert.equal(equipment.status, 'In Use');
  assert.equal(equipment.usageHistory.filter((item) => item.jobcard === jobcard.no).length, 1);
  await page.locator('.tab-button[data-tab="usage"]').click();
  const usageText = await page.locator('#detailTabContent').innerText();
  assert.ok(usageText.includes(String(LOGGED_HOURS)), 'Equipment Usage tab did not show the logged duration');
  step('Equipment: detail view reflects the real Jobcard assignment and usage');
}

async function main() {
  const harness = await startBrowserHarness();
  const page = await harness.context.newPage();
  const monitor = monitorPage(page, harness.baseUrl);
  try {
    await page.goto(`${harness.baseUrl}/jobcard-desktop.html`, { waitUntil: 'load' });
    const jobcard = await jobcardWorkflow(page);
    await page.goto(`${harness.baseUrl}/hours-desktop.html`, { waitUntil: 'load' });
    await hoursWorkflow(page, jobcard);
    await page.goto(`${harness.baseUrl}/equipment-machines-desktop.html`, { waitUntil: 'load' });
    await equipmentWorkflow(page, jobcard);
    monitor.assertClean();
    console.log('\nJobcards/Hours/Equipment browser E2E passed.');
  } finally {
    await page.close();
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
