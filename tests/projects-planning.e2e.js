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
  // Planning keeps no project list of its own: it reads the shared records, so the project that
  // Estimating just scheduled has to appear on the board with the dates Estimating wrote.
  const card = page.locator(`#planBoard .kcard[data-no="${project.no}"]`);
  await card.waitFor();
  const lane = await page.evaluate((no) => {
    const el = [...document.querySelectorAll('#planBoard .kcol')].find((c) => c.querySelector(`[data-no="${no}"]`));
    return el && el.dataset.lane;
  }, project.no);
  assert.equal(lane, 'planned', 'a planned project belongs in the Planned lane');
  const cardText = (await card.innerText()).replace(/\s+/g, ' ');
  assert.ok(cardText.includes(project.no), cardText);
  assert.ok(cardText.includes(PROJECT_EDITED_NAME), cardText);
  // Estimating writes plannedStart/plannedCompletion; the board must read that as a real schedule
  // rather than reporting the project as missing its dates.
  assert.ok(/01 Oct.*08 Nov/.test(cardText), `the card must carry the dates Estimating set: ${cardText}`);
  const waiting = await page.evaluate(() => document.getElementById('waitList').innerText);
  assert.ok(!waiting.includes(project.no), 'a project with both dates is not waiting to be scheduled');
  step('Estimating → Planning: the project appears on the board with its real schedule');

  // It is drawn on the schedule from its own dates, and its expected completion is ahead of the
  // deadline, so no overrun may be marked on it.
  await page.evaluate(() => showView('schedule'));
  await page.waitForTimeout(120);
  const bar = await page.evaluate((no) => {
    const row = [...document.querySelectorAll('#gantt .grow')].find((r) => r.querySelector('.glabel .gno').textContent === no);
    if (!row) return null;
    return { label: row.querySelector('.glabel').innerText.replace(/\s+/g, ' '), over: !!row.querySelector('.gover') };
  }, project.no);
  assert.ok(bar, 'the project must be drawn on the schedule');
  assert.ok(/39 d/.test(bar.label), `the bar spans its own dates: ${bar.label}`);
  assert.equal(bar.over, false, 'expected completion before the deadline is not an overrun');
  step('Planning: the schedule draws the project from its own dates');

  // Dragging a card is how a stage is changed, and it writes through to the shared project.
  await page.evaluate(() => showView('board'));
  await page.waitForTimeout(120);
  const from = await card.boundingBox();
  const to = await page.locator('#planBoard .kcol[data-lane="progress"] .kcbody').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 24, { steps: 10 });
  await page.mouse.up();
  await page.locator('.wask .waskmsg').waitFor();
  const question = await page.locator('.wask .waskmsg').innerText();
  assert.ok(question.includes(project.no) && question.includes('In progress'), `the move must be confirmed by name: ${question}`);
  await page.locator('.wask .waskyes').click();
  await page.waitForTimeout(150);
  let updated = await page.evaluate((no) => WorkshopData.findProject(no), project.no);
  assert.equal(updated.status, 'production', 'the lane is the project status');
  assert.equal(updated.phase, 'production', 'the stage the work is at moves with it');
  step('Planning → Projects: moving a card writes the stage to the shared project');

  // A project missing a date is asked about, never given one silently.
  await page.evaluate((no) => WorkshopData.updateProject(no, { deadline: '', plannedCompletion: '', expectedCompletion: '' }), project.no);
  await page.evaluate(() => renderAll());
  await page.waitForTimeout(120);
  const waitRow = await page.evaluate((no) => {
    const row = [...document.querySelectorAll('#waitList .waitrow')].find((r) => r.innerText.includes(no));
    return row && row.innerText.replace(/\s+/g, ' ');
  }, project.no);
  assert.ok(waitRow, 'a project with no deadline must be listed as waiting to be scheduled');
  assert.ok(/deadline/i.test(waitRow), `the row must say which date is missing: ${waitRow}`);
  const drawn = await page.evaluate((no) => {
    showView('schedule');
    return [...document.querySelectorAll('#gantt .grow')].some((r) => r.querySelector('.glabel .gno').textContent === no);
  }, project.no);
  assert.equal(drawn, false, 'no bar may be drawn for a project without both dates');
  step('Planning: a missing date is reported, not invented');

  // Giving it the date puts it back on the schedule, written where every module reads it.
  await page.evaluate(() => showView('board'));
  await page.waitForTimeout(120);
  await page.evaluate((no) => openDateForm(no), project.no);
  await page.locator('#dateModal.show').waitFor();
  await page.locator('#dfDeadline').fill('2026-11-20');
  await page.locator('#dfHours').fill('96');
  await page.locator('#dateModal .primary').click();
  await page.waitForTimeout(200);
  updated = await page.evaluate((no) => WorkshopData.findProject(no), project.no);
  assert.equal(updated.deadline, '2026-11-20');
  assert.equal(updated.plannedCompletion, '2026-11-20', 'both spellings are written, so no module loses sight of it');
  assert.equal(updated.plannedHours, 96);
  step('Planning: the dates given here are written to the shared project');

  // The project is made of items, and each one is planned on its own. The items here are the
  // jobcards Estimating created from the work described at creation.
  await page.evaluate((no) => openDateForm(no), project.no);
  await page.locator('#dateModal.show').waitFor();
  await page.waitForTimeout(120);
  const items = await page.evaluate(() => [...document.querySelectorAll('#itemRows .itemrow')]
    .map((r) => ({ no: r.dataset.no, source: r.dataset.source, title: r.querySelector('b').textContent })));
  assert.equal(items.length, 2, 'both items described at creation must be listed');
  assert.deepEqual(items.map((i) => i.title), ['Fabricate frame', 'Install on site']);
  assert.ok(items.every((i) => i.source === 'jobcard'), 'items created through Estimating are registered jobcards');
  step('Planning: opening a project lists the work it is made of');

  // An item that runs past the project's own deadline is said out loud, not silently accepted.
  await page.locator('#itStart0').fill('2026-10-05');
  await page.locator('#itEnd0').fill('2026-10-30');
  await page.locator('#itStart1').fill('2026-11-02');
  await page.locator('#itEnd1').fill('2026-12-04');
  await page.waitForTimeout(150);
  const flagged = await page.evaluate(() => [...document.querySelectorAll('#itemRows .itemrow')]
    .map((r) => r.classList.contains('flag') && r.querySelector('.itemnote').textContent));
  assert.equal(flagged[0], false, 'an item inside the project span is not flagged');
  assert.match(String(flagged[1]), /after the deadline|efter deadline|по рокот/i);
  step('Planning: an item running past its project is reported, not accepted in silence');

  // The span the items describe can be taken as the project's own.
  await page.locator('#itemSpan .mini').click();
  await page.waitForTimeout(150);
  assert.equal(await page.inputValue('#dfStart'), '2026-10-05');
  assert.equal(await page.inputValue('#dfDeadline'), '2026-12-04');
  assert.equal(await page.evaluate(() => !!document.querySelector('#itemRows .itemrow.flag')), false,
    'once the project covers its items, nothing is out of range');
  await page.locator('#dateModal .primary').click();
  await page.waitForTimeout(250);
  const planned = await page.evaluate((no) => WorkshopData.listJobcards()
    .filter((j) => j.projectNo === no)
    .map((j) => `${j.title} ${j.plannedStart}→${j.plannedCompletion}`), project.no);
  assert.deepEqual(planned, ['Fabricate frame 2026-10-05→2026-10-30', 'Install on site 2026-11-02→2026-12-04'],
    'each item\'s dates are written to its own jobcard');
  step('Planning: each item keeps its own start and finish, on its own record');

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(200);
  const restored = await page.evaluate((no) => {
    const p = WorkshopData.findProject(no);
    const el = [...document.querySelectorAll('#planBoard .kcol')].find((c) => c.querySelector(`[data-no="${no}"]`));
    return { status: p.status, deadline: p.deadline, hours: p.plannedHours, lane: el && el.dataset.lane };
  }, project.no);
  assert.deepEqual(restored, { status: 'production', deadline: '2026-12-04', hours: 96, lane: 'progress' });
  step('Planning: stage and dates survive reload');

  // Capacity states what it is measured against, or says nothing rather than a made-up percentage.
  await page.evaluate(() => showView('capacity'));
  await page.waitForTimeout(150);
  const blank = await page.evaluate(() => ({
    note: document.getElementById('supplyNote').innerText,
    load: [...document.querySelectorAll('#loadRows .loadrow .loadnums b')].length,
    hours: [...document.querySelectorAll('#loadRows .loadrow')].some((r) => /\d/.test(r.innerText))
  }));
  assert.match(blank.note, /No hours per week stated|Inga timmar per vecka|Не се внесени часови/i);
  assert.equal(blank.load, 0, 'with no hours per week stated, no load percentage may be shown');
  assert.ok(blank.hours, 'the hours the projects owe are still real and still shown');
  await page.locator('#hoursPerWeek').fill('160');
  await page.waitForTimeout(200);
  const stated = await page.evaluate(() => [...document.querySelectorAll('#loadRows .loadrow .loadnums b')].map((b) => b.textContent));
  assert.ok(stated.length > 0 && stated.every((v) => /%$/.test(v)), `a stated supply produces real percentages: ${stated.join()}`);
  step('Planning: weekly load is a percentage only of a supply somebody stated');
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
