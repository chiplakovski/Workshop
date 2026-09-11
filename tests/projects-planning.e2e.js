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

// The Projects module is gone; a project is created and driven from the Estimating module now, so
// this covers the part that survived - creation, the status workflow, and the handover to Planning.
async function projectWorkflow(page) {
  await page.locator('button[onclick="openNewProject()"]').first().click();
  await page.locator('#npName').fill(PROJECT_NAME);
  await page.locator('#npCust').selectOption({ label: 'MarineVent AB' });
  await page.locator('#npKind').selectOption('offer');
  await page.locator('#npDeadline').fill('2026-11-05');
  // The work a job is made of is described up front; it is what the estimate then prices.
  for (const item of ['Fabricate frame', 'Install on site']) {
    await page.locator('#npItemDesc').fill(item);
    await page.locator('button[onclick="addNewProjItem()"]').click();
  }
  assert.equal(await page.locator('.npitem').count(), 2);
  await saveModal(page);

  let project = await page.evaluate((name) => WorkshopData.getProjects().find((item) => item.name === name), PROJECT_NAME);
  assert.ok(project, 'new project was not persisted');
  assert.equal(project.customer, 'MarineVent AB');
  assert.equal(project.quoteKind, 'offer');
  assert.equal(project.status, 'quotation', 'a new project is the quotation it is being priced for');
  assert.equal(project.quotedValue, 0, 'no price is typed at creation — the estimate produces it');
  step('Estimating: a new project persists with its customer and work type');

  const items = await page.evaluate((no) => WorkshopData.listJobcards().filter((j) => j.projectNo === no).map((j) => j.title), project.no);
  assert.deepEqual(items, ['Fabricate frame', 'Install on site'], 'the items described at creation must become real project items');
  const est = await page.evaluate((no) => { const e = ESTIMATIONS.find((x) => x.projectNo === no); return e ? e.workItems.map((w) => w.desc) : null; }, project.no);
  assert.deepEqual(est, items, 'the estimate prices exactly those items');
  step('Estimating: the items given at creation are what gets priced');

  // Duration and crew are estimated per item; the project's figures are derived from them.
  await page.evaluate((no) => { const e = ESTIMATIONS.find((x) => x.projectNo === no); selectedId = e.id; renderAll(); }, project.no);
  for (const [i, d, p] of [[0, '10', '1'], [1, '1', '6']]) {
    await page.evaluate((idx) => openItemEffort(selectedId, idx), i);
    await page.locator('#efDays').fill(d);
    await page.locator('#efPeople').fill(p);
    await saveModal(page);
  }
  const effort = await page.evaluate(() => {
    const e = getEst(selectedId);
    return EstimationRules.effortTotals(e.workItems);
  });
  assert.equal(effort.totalDays, 11, 'start to finish is the sum of the items');
  assert.equal(effort.personDays, 16);
  assert.equal(effort.peakPeople, 6);
  assert.ok(effort.avgPeople > 1.4 && effort.avgPeople < 1.5, 'the average crew is weighted by duration, not a plain average');
  step('Estimating: duration and crew roll up from the items');

  // The workflow ported from the Projects module drives the project from here.
  await page.evaluate((no) => { const e = ESTIMATIONS.find((x) => x.projectNo === no); selectedId = e.id; renderAll(); }, project.no);
  await page.locator('.pstep[data-status="approved"]').click();
  await saveModal(page);
  project = await page.evaluate((no) => WorkshopData.findProject(no), project.no);
  assert.equal(project.status, 'approved');
  step('Workflow: quotation advances to approved');

  await page.locator('.pstep[data-status="planned"]').click();
  await page.locator('#wfStart').fill('2026-10-01');
  await page.locator('#wfDl').fill('2026-11-08');
  await saveModal(page);
  project = await page.evaluate((no) => WorkshopData.findProject(no), project.no);
  assert.equal(project.status, 'planned');
  assert.equal(project.plannedStart, '2026-10-01');
  assert.equal(project.deadline, '2026-11-08');
  step('Workflow: scheduling records both dates on the shared project');

  const trail = (project.activity || []).map((a) => a.action).join(' | ');
  assert.ok(/APPROVED/.test(trail) && /PLANNED/.test(trail), 'each transition must leave a line on the project');
  step('Workflow: every transition is recorded on the project');

  // page.evaluate runs in the browser, so the new name has to be passed in rather than closed over.
  await page.evaluate(([no, name]) => { const p = WorkshopData.findProject(no); p.name = name; p.expectedCompletion = '2026-11-01'; WorkshopData.upsertProject(p); }, [project.no, PROJECT_EDITED_NAME]);
  project = await page.evaluate((no) => WorkshopData.findProject(no), project.no);
  assert.equal(project.name, PROJECT_EDITED_NAME);
  return project;
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
    await page.goto(`${harness.baseUrl}/estimations-desktop.html`, { waitUntil: 'load' });
    const project = await projectWorkflow(page);
    await page.goto(`${harness.baseUrl}/planning-desktop.html`, { waitUntil: 'load' });
    await planningWorkflow(page, project);
    monitor.assertClean();
    console.log('\nEstimating/Planning browser E2E passed.');
  } finally {
    await page.close();
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
