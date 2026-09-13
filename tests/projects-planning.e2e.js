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
  // The estimate dialog recalls what the workshop actually spent on work described like this.
  // For work it has never done, it says exactly that rather than offering a neutral-looking figure.
  await page.evaluate(() => openItemEffort(selectedId, 0));
  await page.locator('#fcard .recall').waitFor();
  assert.match(await page.locator('#fcard .recall').innerText(),
    /no finished work described like this|inget avslutat arbete|nema završena rabota/i);
  assert.equal(await page.locator('#fcard .recall .tbtn').count(), 0,
    'with nothing to compare against there is nothing to take');
  await page.evaluate(() => closeModal());
  await page.waitForTimeout(100);

  // Describe the item as work the workshop has finished before, and it recalls that job by name.
  // An item's description lives on the project's own jobcard, so that is what gets renamed.
  await page.evaluate((no) => {
    const card = WorkshopData.listJobcards().filter((j) => j.projectNo === no)[0];
    WorkshopData.updateJobcard(card.no, { title: 'Cutting' });
  }, project.no);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate((no) => { const e = ESTIMATIONS.find((x) => x.projectNo === no); selectedId = e.id; renderAll(); }, project.no);
  await page.evaluate(() => openItemEffort(selectedId, 0));
  await page.locator('#fcard .recall').waitFor();
  const recalled = (await page.locator('#fcard .recall').innerText()).replace(/\s+/g, ' ');
  assert.match(recalled, /1 finished job like this|1 avslutat jobb|1 završena slična/i, recalled);
  assert.ok(recalled.includes('16'), `the estimate that was made must be shown: ${recalled}`);
  assert.ok(recalled.includes('18'), `and what it actually took: ${recalled}`);
  assert.ok(recalled.includes('JC-2026-0001'), `named, so the estimator can open it: ${recalled}`);
  await page.locator('#fcard .recall .tbtn').click();
  await page.waitForTimeout(120);
  assert.equal(await page.inputValue('#efDays'), '2.3', '18 hours is 2.3 days for one person');
  assert.equal(await page.inputValue('#efPeople'), '1', 'the hours say how long one person was busy, not how many people it needs');
  await page.evaluate(() => closeModal());
  await page.evaluate((no) => {
    const card = WorkshopData.listJobcards().filter((j) => j.projectNo === no)[0];
    WorkshopData.updateJobcard(card.no, { title: 'Fabricate frame' });
  }, project.no);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate((no) => { const e = ESTIMATIONS.find((x) => x.projectNo === no); selectedId = e.id; renderAll(); }, project.no);
  step('Estimating: the dialog recalls what work like this actually took, and names the job');

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
  await page.locator('#dfDeadline').fill('2026-11-08');
  await page.waitForTimeout(150);
  const flagged = await page.evaluate(() => [...document.querySelectorAll('#itemRows .itemrow')]
    .map((r) => r.classList.contains('flag') && r.querySelector('.itemnote').textContent));
  assert.equal(flagged[0], false, 'an item inside the project span is not flagged');
  assert.match(String(flagged[1]), /after the deadline|efter deadline|по рокот/i);
  step('Planning: an item running past its project is reported, not accepted in silence');

  // Proposing needs hours on the items: an item nobody has sized cannot be laid out, and the
  // page says so rather than inventing a span for it.
  await page.locator('#proposeBar .mini').click();
  await page.locator('.wask .waskmsg').waitFor();
  assert.match(await page.locator('.wask .waskmsg').innerText(), /no item carries any hours|ingen post har några timmar|ниту една ставка нема часови/i);
  await page.locator('.wask .waskyes').click();
  await page.waitForTimeout(120);
  step('Planning: with no hours on the items there is nothing to lay out, and it says so');

  // The hours an estimator prices land on the jobcard, which is what the proposal reads.
  await page.evaluate((no) => {
    const cards = WorkshopData.listJobcards().filter((j) => j.projectNo === no);
    WorkshopData.updateJobcard(cards[0].no, { plannedHours: 24 });
    WorkshopData.updateJobcard(cards[1].no, { plannedHours: 40 });
  }, project.no);
  await page.evaluate((no) => { closeDateForm(); openDateForm(no); }, project.no);
  await page.locator('#dateModal.show').waitFor();
  await page.waitForTimeout(150);

  // The dates can be proposed from those hours rather than typed one by one.
  // Nothing is written until Save, so the shared record must be untouched until then.
  const beforePropose = await page.evaluate((no) => WorkshopData.listJobcards()
    .filter((j) => j.projectNo === no).map((j) => `${j.plannedStart || '-'}/${j.plannedCompletion || '-'}`), project.no);
  await page.locator('#dfStart').fill('2026-10-05');
  await page.locator('#dfPerDay').fill('8');
  await page.locator('#proposeBar .mini').click();
  await page.waitForTimeout(200);
  const proposed = await page.evaluate(() => [...document.querySelectorAll('#itemRows .itemrow')]
    .map((r) => ({ no: r.dataset.no, start: r.querySelector('input[id^=itStart]').value, end: r.querySelector('input[id^=itEnd]').value })));
  assert.equal(proposed[0].start, '2026-10-05', 'the first item starts where the project does');
  assert.ok(proposed[1].start > proposed[0].end, 'items are laid out one after another, not on top of each other');
  proposed.forEach((p) => assert.ok(new Date(p.start + 'T00:00:00Z').getUTCDay() % 6 !== 0, `${p.no} may not start on a weekend`));
  const afterPropose = await page.evaluate((no) => WorkshopData.listJobcards()
    .filter((j) => j.projectNo === no).map((j) => `${j.plannedStart || '-'}/${j.plannedCompletion || '-'}`), project.no);
  assert.deepEqual(afterPropose, beforePropose, 'proposing fills the form; it must not write anything');
  step('Planning: dates are proposed from the hours the items carry, and written only on Save');

  // Halving the day rate has to stretch the same work over more days.
  await page.locator('#dfPerDay').fill('4');
  await page.locator('#proposeBar .mini').click();
  await page.waitForTimeout(200);
  const slower = await page.evaluate(() => document.querySelector('#itemRows input[id^=itEnd]').value);
  assert.ok(slower > proposed[0].end, `4 h a day must take longer than 8: ${slower} vs ${proposed[0].end}`);
  step('Planning: the hours-a-day figure is what the proposal is measured against');

  // Put the eight-hour proposal back before carrying on.
  await page.locator('#dfPerDay').fill('8');
  await page.locator('#proposeBar .mini').click();
  await page.waitForTimeout(200);

  // The span the items describe can be taken as the project's own.
  await page.locator('#itemSpan .mini').click();
  await page.waitForTimeout(150);
  assert.equal(await page.inputValue('#dfStart'), '2026-10-05');
  assert.equal(await page.inputValue('#dfDeadline'), proposed[proposed.length - 1].end);
  assert.equal(await page.evaluate(() => !!document.querySelector('#itemRows .itemrow.flag')), false,
    'once the project covers its items, nothing is out of range');
  await page.locator('#dateModal .primary').click();
  await page.waitForTimeout(250);
  const planned = await page.evaluate((no) => WorkshopData.listJobcards()
    .filter((j) => j.projectNo === no)
    .map((j) => `${j.plannedStart}→${j.plannedCompletion}`), project.no);
  assert.deepEqual(planned, proposed.map((p) => `${p.start}→${p.end}`),
    'each item\'s dates are written to its own jobcard, exactly as proposed');
  step('Planning: each item keeps its own start and finish, on its own record');

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(200);
  const restored = await page.evaluate((no) => {
    const p = WorkshopData.findProject(no);
    const el = [...document.querySelectorAll('#planBoard .kcol')].find((c) => c.querySelector(`[data-no="${no}"]`));
    return { status: p.status, deadline: p.deadline, hours: p.plannedHours, lane: el && el.dataset.lane };
  }, project.no);
  assert.equal(restored.status, 'production');
  assert.equal(restored.hours, 96);
  assert.equal(restored.lane, 'progress');
  assert.equal(restored.deadline, proposed[proposed.length - 1].end, 'the proposed span survives the reload');
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
