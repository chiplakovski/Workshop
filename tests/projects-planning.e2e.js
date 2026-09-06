'use strict';

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness } = require('./helpers/browser-harness');

const PROJECT_NAME = 'E2E Packaging Platform';
const PROJECT_EDITED_NAME = 'E2E Packaging Platform Rev B';

async function saveModal(page) {
  await page.locator('#fcard .fbtns .primary').click();
  await page.waitForTimeout(70);
}

function step(message) {
  console.log(`OK   ${message}`);
}

async function projectWorkflow(page) {
  await page.locator('button[onclick="openNewProject()"]').first().click();
  await page.locator('#fName').fill(PROJECT_NAME);
  await page.locator('#fCustomer').selectOption({ label: 'MarineVent AB' });
  await page.locator('#fRef').fill('E2E-CUST-REF-40');
  await page.locator('#fPo').fill('E2E-CUSTOMER-PO');
  await page.locator('#fDesc').fill('Fabricate and install an E2E packaging platform.');
  await page.locator('#fTypes .mchip[data-t="Fabrication"]').click();
  await page.locator('#fTypes .mchip[data-t="Installation"]').click();
  await page.locator('#fPm').selectOption('Aleksandar');
  await page.locator('#fWorkshop').selectOption('Marko');
  await page.locator('#fStart').fill('2026-10-01');
  await page.locator('#fDeadline').fill('2026-11-05');
  await page.locator('#fPlannedC').fill('2026-11-01');
  await saveModal(page);

  let project = await page.evaluate((name) => WorkshopData.getProjects().find((item) => item.name === name), PROJECT_NAME);
  assert.ok(project, 'new project was not persisted');
  assert.equal(project.customer, 'MarineVent AB');
  assert.equal(project.quotedValue, 0, 'a new project has no quoted value until an Estimation prices its items');
  assert.equal(project.plannedStart, '2026-10-01');
  const localRowCount = await page.evaluate((no) => PROJECTS.filter((item) => item.no === no).length, project.no);
  assert.equal(localRowCount, 1, 'creating a project must add exactly one row, not a duplicate with the same number');
  step('Projects: create persists the customer and dates — pricing is never entered here, no duplicate row');

  await page.evaluate(() => openEditProject());
  await page.locator('#fName').fill(PROJECT_EDITED_NAME);
  await page.locator('#fDesc').fill('Updated E2E platform scope after customer review.');
  await page.locator('#fDeadline').fill('2026-11-08');
  await saveModal(page);
  project = await page.evaluate((name) => WorkshopData.getProjects().find((item) => item.name === name), PROJECT_EDITED_NAME);
  assert.ok(project, 'project edit was not persisted');
  assert.equal(project.description, 'Updated E2E platform scope after customer review.');
  assert.equal(project.deadline, '2026-11-08');
  step('Projects: edit updates the same shared project');

  await page.evaluate(() => openJobcardForm());
  await page.locator('#jcDesc').fill('Fabricate platform frame');
  await page.locator('#jcAssigned').selectOption('Marko');
  await saveModal(page);
  const jobcard = await page.evaluate((no) => WorkshopData.listJobcards().find((item) => item.projectNo === no && item.title === 'Fabricate platform frame'), project.no);
  assert.ok(jobcard, 'project item did not create a shared Jobcard');
  assert.equal(jobcard.plannedHours, 0, 'a new item is unestimated until Estimations prices it');
  assert.ok(jobcard.workers.includes('Marko K.'));
  step('Projects → Jobcards: item creates a shared production record, unpriced');

  await page.evaluate(() => openDocForm());
  await page.locator('#docFolder').selectOption('Drawings');
  await page.locator('#docName').fill('E2E Platform Drawing.pdf');
  await page.locator('#docRev').fill('B');
  await saveModal(page);
  const document = await page.evaluate((no) => WorkshopData.getDocuments().find((item) => item.module === 'Projects' && item.record === no && item.name === 'E2E Platform Drawing.pdf'), project.no);
  assert.ok(document, 'project document was not persisted in Documents');
  assert.equal(document.revision, 'B');
  step('Projects → Documents: drawing creates a shared document record');

  await page.evaluate(() => openPoForm());
  await page.locator('#poSupplier').fill('E2E Steel Supply AB');
  await page.locator('#poOrdered').fill('32000');
  await page.locator('#poItems').fill('Stainless profiles and plate');
  await page.locator('#poStatus').selectOption('ordered');
  await page.locator('#poExpected').fill('2026-10-15');
  await saveModal(page);
  const purchaseOrder = await page.evaluate((no) => WorkshopData.getPurchaseOrders().find((item) => item.project === no && item.supplier === 'E2E Steel Supply AB'), project.no);
  assert.ok(purchaseOrder, 'project purchase did not create a shared purchase order');
  assert.equal(purchaseOrder.value, 32000);
  assert.equal(purchaseOrder.status, 'Confirmed');
  step('Projects → Purchasing: purchase creates a shared PO');

  await page.evaluate(() => openNoteForm());
  await page.locator('#noteText').fill('E2E planning handoff is ready.');
  await page.locator('#noteTag').selectOption('workshop');
  await page.locator('#notePin').check();
  await saveModal(page);
  project = await page.evaluate((no) => WorkshopData.findProject(no), project.no);
  assert.ok(project.notes.some((note) => note.text === 'E2E planning handoff is ready.' && note.pinned));
  step('Projects: note persists on the shared project');

  await page.reload({ waitUntil: 'load' });
  const restored = await page.evaluate((no) => {
    const item = WorkshopData.findProject(no);
    if (item) { currentId = item.id; VIEW = 'detail'; activeTab = 'jobcards'; render(); }
    return item;
  }, project.no);
  assert.ok(restored, 'project is missing after reload');
  assert.ok((await page.locator('body').innerText()).includes('Fabricate platform frame'));
  await page.evaluate(() => { activeTab = 'documents'; render(); });
  await page.evaluate(() => toggleFolder('Drawings'));
  assert.ok((await page.locator('body').innerText()).includes('E2E Platform Drawing.pdf'));
  await page.evaluate(() => { activeTab = 'purchases'; render(); });
  assert.ok((await page.locator('body').innerText()).includes('E2E Steel Supply AB'));
  step('Projects: linked records survive reload and render in their tabs');

  // Archive/Delete are exercised on throwaway projects, kept separate from `project` above (which
  // Planning still needs below).
  const throwaway = await page.evaluate(() => WorkshopData.upsertProject({ name: 'E2E Throwaway Project', customerId: 1 }));
  await page.evaluate((id) => { currentId = id; VIEW = 'detail'; activeTab = 'overview'; render(); }, throwaway.id);
  await page.evaluate(() => handleAction('deleteproject'));
  await page.locator('#dpConfirm').fill('wrong-number');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#fcard .fbtns .danger').click();
  await page.waitForTimeout(70);
  let stillThere = await page.evaluate((no) => WorkshopData.getProjects().some((item) => item.no === no), throwaway.no);
  assert.equal(stillThere, true, 'a mismatched confirmation must not delete the project');
  await page.locator('#dpConfirm').fill(throwaway.no);
  await page.locator('#fcard .fbtns .danger').click();
  await page.waitForTimeout(70);
  stillThere = await page.evaluate((no) => WorkshopData.getProjects().some((item) => item.no === no), throwaway.no);
  assert.equal(stillThere, false, 'an unlinked project was not deleted after the matching confirmation');
  step('Projects: Delete project requires a matching confirmation, then removes an unlinked project');

  const linked = await page.evaluate(() => WorkshopData.upsertProject({ name: 'E2E Linked Project', customerId: 1 }));
  await page.evaluate((p) => WorkshopData.upsertJobcard({ projectId: p.id, projectNo: p.no, customerId: 1, title: 'Linked item', item: 'Linked item' }), linked);
  await page.evaluate((id) => { currentId = id; VIEW = 'detail'; activeTab = 'overview'; render(); }, linked.id);
  await page.evaluate(() => handleAction('deleteproject'));
  await page.locator('#dpConfirm').fill(linked.no);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#fcard .fbtns .danger').click();
  await page.waitForTimeout(70);
  const linkedStillThere = await page.evaluate((no) => WorkshopData.getProjects().some((item) => item.no === no), linked.no);
  assert.equal(linkedStillThere, true, 'a project with a linked Jobcard must not be deletable, even with a matching confirmation');
  step('Projects: Delete project refuses a project with a linked item');

  await page.evaluate(() => handleAction('archiveproject'));
  await page.locator('#fcard .fbtns .danger').click();
  await page.waitForTimeout(70);
  const archived = await page.evaluate((no) => WorkshopData.getProjects().find((item) => item.no === no), linked.no);
  assert.equal(archived.archived, true, 'Archive project did not mark the project archived');
  const hiddenFromList = await page.evaluate((no) => !PROJECTS.some((item) => item.no === no && !item.archived), linked.no);
  assert.equal(hiddenFromList, true, 'an archived project must not appear as an active row');
  step('Projects: Archive project hides a linked project from the active list without deleting it');

  return restored;
}

async function planningWorkflow(page, project) {
  const planningRecord = await page.evaluate((no) => PROJECTS.find((item) => item.no === no), project.no);
  assert.ok(planningRecord, 'shared project did not hydrate into Planning');
  assert.equal(planningRecord.name, PROJECT_EDITED_NAME);
  assert.equal(planningRecord.start, '2026-10-01');
  assert.equal(planningRecord.deadline, '2026-11-08');
  assert.equal(planningRecord.updatedCompletion, '2026-11-01');

  await page.evaluate((no) => { setSub('existing'); selectedProjNo = no; renderAll(); }, project.no);
  const body = await page.locator('body').innerText();
  assert.ok(body.includes(`${project.no} — ${PROJECT_EDITED_NAME}`));
  assert.ok(body.includes('2026-10-01'));
  step('Projects → Planning: project hydrates with its real schedule');

  await page.evaluate((no) => setPhase(no, 'production'), project.no);
  const updated = await page.evaluate((no) => WorkshopData.findProject(no), project.no);
  assert.equal(updated.phase, 'production');
  step('Planning → Projects: phase update persists to shared project data');

  await page.reload({ waitUntil: 'load' });
  const restoredPhase = await page.evaluate((no) => {
    const item = PROJECTS.find((candidate) => candidate.no === no);
    if (item) { setSub('existing'); selectedProjNo = no; renderAll(); }
    return item && item.phase;
  }, project.no);
  assert.equal(restoredPhase, 'production');
  step('Planning: project phase survives reload');
}

async function main() {
  const harness = await startBrowserHarness();
  const page = await harness.context.newPage();
  const monitor = monitorPage(page, harness.baseUrl);
  try {
    await page.goto(`${harness.baseUrl}/projects-desktop.html`, { waitUntil: 'load' });
    const project = await projectWorkflow(page);
    await page.goto(`${harness.baseUrl}/planning-desktop.html`, { waitUntil: 'load' });
    await planningWorkflow(page, project);
    monitor.assertClean();
    console.log('\nProjects/Planning browser E2E passed.');
  } finally {
    await page.close();
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
