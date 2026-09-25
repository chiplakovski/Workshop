'use strict';

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness, loadDemoData } = require('./helpers/browser-harness');

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

  // ── Nobody signed in ────────────────────────────────────────────────────────────────────────
  //
  // This screen books the signed-in person's own time: the server takes the worker from the session and
  // ignores any name sent with it, so the badge IS the field, and the screen reads that label back as the
  // worker. The name used to be written into the page — "Marko K." — so it could never be missing, and an
  // hours entry always had somebody on it by accident. It is painted from the snapshot now, and this suite
  // runs with no session at all, so the badge holds an em dash. Booking against that would write hours
  // nobody can be asked about.
  await page.locator('#saveEntry').click();
  await page.waitForTimeout(150);
  const refusedBadge = await page.locator('.wask .waskmsg').first().textContent();
  assert.match(refusedBadge, /nobody is signed in/i,
    `hours with no session must be refused, and the screen said: ${refusedBadge}`);
  await page.locator('.wask .waskyes').click();
  await page.waitForTimeout(70);
  assert.equal(await page.evaluate((no) => (WorkshopData.get().hours || [])
    .filter((h) => h.jobcard === no).length), 0, 'and nothing was written while it was refused');

  // Now with a session, which on a real screen means the painter in workshop-ui.js has filled the badge
  // from the snapshot. Setting the element is exactly what that does, and it is set rather than assumed so
  // the rest of this suite depends on a name somebody put there instead of one baked into the page.
  await page.evaluate(() => { document.querySelector('[data-session-name]').textContent = 'Marko K.'; });

  await page.locator('#saveEntry').click();
  await page.waitForTimeout(150);
  // The app tells you in its own markup: a native alert() is invisible in a sandboxed frame.
  const saidSaved = await page.locator('.wask .waskmsg').first().textContent();
  assert.match(saidSaved, /saved|sparad|začuvan/i);
  await page.locator('.wask .waskyes').click();
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

  // Only projects with an open jobcard are offered: hours are logged against a jobcard, so a project
  // without one is not a choice a person can act on.
  const offered = await page.evaluate(() => {
    const open = new Set((WorkshopData.listJobcards() || [])
      .filter((j) => !j.archived && !['completed', 'closed', 'cancelled'].includes(j.status))
      .map((j) => j.projectNo));
    const listed = [...document.querySelectorAll('#project option')].map((o) => o.value).filter(Boolean);
    return { listed, withoutJobcard: listed.filter((no) => !open.has(no)) };
  });
  assert.ok(offered.listed.length > 0, 'the project list must offer the projects that have work open');
  assert.deepEqual(offered.withoutJobcard, [], 'a project with no open jobcard must not be offered');
  step('Hours: only projects with an open jobcard can be picked');

  // A machine that was used but never linked to the jobcard is attached on save, through the same
  // assignEquipment() call the Jobcard module makes - the safety gate still decides.
  const spare = await page.evaluate((used) => {
    const jc = WorkshopData.listJobcards().find((j) => j.no === document.querySelector('#item').selectedOptions[0].dataset.jobcard);
    const onJob = new Set((jc.machines || []).map((m) => m.equipmentId));
    const free = (WorkshopData.getEquipment() || []).find((e) => {
      if (onJob.has(e.equipmentId) || e.equipmentId === used) return false;
      const gate = WorkshopData.getEquipmentSafetyGate(e.equipmentId, { requirePreUseCheck: true, jobcardNo: jc.no, projectNo: jc.projectNo });
      return JobcardEquipmentRules.canAddEquipmentToJobcard(e, jc.machines || [], jc.no, gate).allowed;
    });
    return free ? { equipmentId: free.equipmentId, jobcard: jc.no } : null;
  }, EQUIPMENT_ID);

  if (spare) {
    await page.locator('#hours').fill('2');
    await page.locator('#equipList .eqsel').selectOption(spare.equipmentId);
    await page.locator('#equipList .eqhrs').fill('1');
    await page.locator('#matList .matname').fill('E2E consumable');
    await page.locator('#matList .matqty').fill('4');
    await page.locator('#matList .matunit').fill('pcs');
    await page.locator('#saveEntry').click();
    await page.waitForTimeout(200);
    await page.locator('.wask .waskyes').click();
    await page.waitForTimeout(150);

    const linked = await page.evaluate(({ no, equipmentId }) => {
      const jc = WorkshopData.findJobcard(no);
      const eq = WorkshopData.getEquipment().find((e) => e.equipmentId === equipmentId);
      return {
        onJobcard: (jc.machines || []).some((m) => m.equipmentId === equipmentId),
        assignedTo: eq.assignedJobcard,
        usedHere: (eq.usageHistory || []).some((u) => u.jobcard === no),
        material: (jc.materials || []).find((m) => m.description === 'E2E consumable')
      };
    }, { no: spare.jobcard, equipmentId: spare.equipmentId });
    assert.equal(linked.onJobcard, true, 'a machine used in Hours must end up on the jobcard');
    assert.equal(linked.assignedTo, spare.jobcard, 'and assigned to it in the equipment register');
    assert.equal(linked.usedHere, true, 'with its usage logged against the jobcard');
    assert.ok(linked.material, 'material used in Hours must reach the jobcard');
    assert.equal(linked.material.issued, 4, 'with the quantity that was consumed');
    assert.equal(linked.material.unit, 'pcs');
    step('Hours → Jobcards: an unlinked machine is attached and material lands on the jobcard');
  }

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

// The list used to be seven sidebar entries over one table, with a status dropdown beside it
// that could contradict whichever entry was picked - two controls answering the same question,
// and an empty list with nothing on screen to explain it. It is one chip row now, and these
// tests hold it to the two things that makes it worth having: the count on a chip is the
// number of rows that chip shows, and only one status control is ever in force.
async function jobcardScopeChips(page) {
  await page.evaluate(() => setView('list'));
  const scopes = await page.evaluate(() => SCOPES);
  assert.deepEqual(scopes, ['all', 'ready', 'inprogress', 'blocked', 'inspection', 'completed', 'archived']);

  const chips = await page.evaluate(() =>
    [...document.querySelectorAll('.scopechip')].map((c) => c.querySelector('.scopen').textContent));
  assert.equal(chips.length, scopes.length, 'every scope should have a chip');

  for (let i = 0; i < scopes.length; i += 1) {
    await page.evaluate((s) => setScope(s), scopes[i]);
    const shown = await page.evaluate(() => ({
      rows: document.querySelector('.empty3') ? 0 : document.querySelectorAll('tbody tr').length,
      onChip: Number(document.querySelector('.scopechip.on .scopen').textContent),
      onScope: document.querySelector('.scopechip.on span').textContent
    }));
    assert.equal(shown.rows, shown.onChip,
      `the ${scopes[i]} chip says ${shown.onChip} but the list shows ${shown.rows}`);
  }
  step('Jobcards: every chip counts exactly the rows it shows');

  await page.evaluate(() => setScope('ready'));
  await page.evaluate(() => {
    const sel = document.querySelector('.filterbar select');
    sel.value = 'completed';
    sel.dispatchEvent(new Event('change'));
  });
  assert.equal(await page.evaluate(() => jcScope), 'all', 'picking a raw status must release the chip');
  assert.equal(await page.evaluate(() => jcFilterStatus), 'completed');

  await page.evaluate(() => setScope('blocked'));
  assert.equal(await page.evaluate(() => jcFilterStatus), 'all', 'picking a chip must release the raw status');
  assert.equal(await page.evaluate(() => jcScope), 'blocked');
  step('Jobcards: the chip and the status dropdown never hold two answers at once');

  await page.evaluate(() => clearJcFilters());
  assert.deepEqual(await page.evaluate(() => ({ scope: jcScope, status: jcFilterStatus, q: jcQuery })),
    { scope: 'all', status: 'all', q: '' });
  step('Jobcards: clearing the filters clears the chip too');
}

// A jobcard on paper is not a report, it is a form. It goes to the machine, the work gets done,
// and someone writes on it what it actually took, then signs. A sheet with nowhere to write comes
// back exactly as it left, and the hours get reconstructed from memory at the end of the week —
// which is how planned hours quietly become the only hours anybody has.
async function theJobcardPrintsAsAForm(page) {
  await page.evaluate(() => printJobcard(WorkshopData.listJobcards()[0].id));
  await page.waitForTimeout(200);

  const sheet = await page.locator('#sheet').innerText();
  const jobcard = await page.evaluate(() => WorkshopData.listJobcards()[0]);
  assert.ok(sheet.includes(jobcard.no), 'the sheet must name the jobcard it is');
  assert.ok(sheet.includes('Varmak AB'), 'and who it came from');
  for (const operation of jobcard.operations || []) {
    assert.ok(sheet.includes(operation.desc), `the operation "${operation.desc}" must be on the paper`);
  }
  for (const material of jobcard.materials || []) {
    assert.ok(sheet.includes(material.code), `material ${material.code} must be on the paper`);
    if (material.heat) assert.ok(sheet.includes(material.heat), 'and the heat number it is traced by');
  }
  step('Jobcard on paper: the sheet carries the job, its operations and its material');

  // Every operation gets its own ruled boxes, and they are left empty for a pen.
  const pen = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#sheet .opstbl tbody tr')];
    return {
      rows: rows.length,
      boxesPerRow: [...new Set(rows.map((r) => r.querySelectorAll('td.wr').length))],
      anythingPrinted: rows.some((r) => [...r.querySelectorAll('td.wr')].some((c) => c.textContent.trim()))
    };
  });
  assert.equal(pen.rows, (jobcard.operations || []).length);
  assert.deepEqual(pen.boxesPerRow, [3], 'each operation needs actual hours, the date done, and initials');
  assert.equal(pen.anythingPrinted, false, 'a column to write in must be printed empty');
  step('Jobcard on paper: every operation has ruled boxes for hours, date and a signature');

  // Nothing may go to the floor showing a stored code where a name belongs. Checked against the
  // records themselves rather than by pattern: drawing numbers and item codes are full of
  // hyphens and belong on the sheet exactly as they are stored. 'visual-weld' did print as
  // itself for a while, because the status lookup stripped the hyphen and the type lookup did not.
  const rawCodes = await page.evaluate(() => {
    const j = WorkshopData.listJobcards()[0];
    const printed = [...document.querySelectorAll('#sheet td')].map((c) => c.textContent.trim());
    return (j.inspections || []).map((i) => i.type).filter((type) => printed.includes(type));
  });
  assert.deepEqual(rawCodes, [], `printed as a stored code instead of a name: ${rawCodes.join(', ')}`);
  step('Jobcard on paper: a checkpoint prints its name, never its stored code');

  const signoffs = await page.evaluate(() => document.querySelectorAll('#sheet .signbox').length);
  assert.equal(signoffs, 4, 'worker, supervisor, inspector and the date it was finished');
  step('Jobcard on paper: four lines to sign, so the sheet can come back as evidence');
}

// The sheet comes back from the machine filled in with a pen. Getting that into the system used
// to mean opening each operation's edit form, changing one number among twelve fields, saving,
// and again — about thirty interactions for eight operations. Nobody does that at five o'clock,
// and hours that never get entered turn every figure downstream into a guess.
//
// What this holds to: one screen, one save, and the same records the Hours module writes. Not a
// second way of recording an hour — the same way, driven from the paper.
async function enteringTheReturnedSheet(page) {
  const jobcard = await page.evaluate(() => {
    const free = WorkshopData.listJobcards().find((j) => !WorkshopData.getJobcardQualityGate(j.no).blocked);
    return free ? { id: free.id, no: free.no } : null;
  });
  assert.ok(jobcard, 'the demo needs one jobcard that is not on hold');

  const before = await page.evaluate((no) => {
    const j = WorkshopData.findJobcard(no);
    return {
      entries: (WorkshopData.get().hours || []).length,
      logged: (j.operations || []).map((o) => ({ id: o.id, h: Number(o.loggedHours) || 0, status: o.status }))
    };
  }, jobcard.no);

  await page.evaluate((id) => openReturnedSheet(id), jobcard.id);
  const rows = await page.locator('#rsBody tr').count();
  assert.equal(rows, before.logged.filter((o) => o.status !== 'skipped').length,
    'the sheet on screen must have the same rows as the sheet on paper');

  // Two rows of hours, and finish whichever one can still be finished.
  const filled = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#rsBody tr')];
    const hoursRows = rows.slice(0, 2);
    hoursRows.forEach((r, i) => { r.querySelector('.rshrs').value = i === 0 ? '7.5' : '2.25'; });
    const finishable = rows.find((r) => r.querySelector('.rsfin'));
    let finishedOp = null;
    if (finishable) {
      finishable.querySelector('.rsfin').checked = true;
      if (!Number(finishable.querySelector('.rshrs').value)) finishable.querySelector('.rshrs').value = '3';
      finishedOp = Number(finishable.dataset.op);
    }
    return { finishedOp, ids: hoursRows.map((r) => Number(r.dataset.op)) };
  });

  await page.evaluate((id) => saveReturnedSheet(id), jobcard.id);
  await page.waitForTimeout(250);

  const after = await page.evaluate((no) => {
    const j = WorkshopData.findJobcard(no);
    const hours = WorkshopData.get().hours || [];
    return {
      entries: hours.length,
      ids: hours.map((h) => h.id),
      mine: hours.filter((h) => h.jobcard === no).map((h) => ({ hours: h.hours, op: h.operation, worker: h.worker })),
      logged: (j.operations || []).map((o) => ({ id: o.id, h: Number(o.loggedHours) || 0, status: o.status })),
      activity: (j.activity || [])[0] && (j.activity || [])[0].action
    };
  }, jobcard.no);

  // One hours record per row with time on it, written the same way the Hours module writes them.
  assert.ok(after.entries > before.entries, 'entering the sheet must create real hours records');
  assert.equal(new Set(after.ids).size, after.ids.length,
    'every hours record needs its own id — a whole sheet saves inside one millisecond');
  assert.ok(after.mine.every((h) => h.worker), 'an hours record with nobody on it is not a time sheet');

  // And the operation totals go up by exactly what was typed, never replaced by it.
  filled.ids.forEach((opId, i) => {
    const was = before.logged.find((o) => o.id === opId).h;
    const now = after.logged.find((o) => o.id === opId).h;
    const typed = i === 0 ? 7.5 : 2.25;
    assert.ok(Math.abs(now - (was + typed)) < 0.001,
      `operation ${opId}: ${was}h + ${typed}h should be ${was + typed}h, got ${now}h`);
  });
  step('Returned sheet: hours from the paper become the same records the Hours screen writes');

  if (filled.finishedOp) {
    const op = after.logged.find((o) => o.id === filled.finishedOp);
    assert.equal(op.status, 'completed', 'a ticked operation must actually close');
  }
  assert.ok(/logged/i.test(after.activity || ''), 'the jobcard history must say the sheet was entered');
  step('Returned sheet: a ticked operation closes, and the jobcard records that it happened');
}

// A hold stops work leaving the building. It does not stop the truth about what the work cost, so
// the sheet still records the hours — and rather than let somebody tick boxes and then refuse
// them, it says so before the form is filled in.
async function theReturnedSheetRespectsAHold(page) {
  const held = await page.evaluate(() => {
    const j = WorkshopData.listJobcards().find((x) => WorkshopData.getJobcardQualityGate(x.no).blocked);
    return j ? { id: j.id, no: j.no } : null;
  });
  if (!held) return;

  await page.evaluate((id) => openReturnedSheet(id), held.id);
  const shown = await page.evaluate(() => ({
    explained: !!document.querySelector('#fcard .lockbanner'),
    tickable: document.querySelectorAll('#rsBody .rsfin').length,
    rows: document.querySelectorAll('#rsBody tr').length
  }));
  assert.ok(shown.explained, 'the sheet must say why nothing can be closed, before anything is filled in');
  assert.equal(shown.tickable, 0, 'a held jobcard offers no box to tick');
  assert.ok(shown.rows > 0, 'but the hours columns are still there — the work was done either way');

  const before = await page.evaluate((no) =>
    (WorkshopData.get().hours || []).filter((h) => h.jobcard === no).length, held.no);
  await page.evaluate(() => { document.querySelector('#rsBody .rshrs').value = '4'; });
  await page.evaluate((id) => saveReturnedSheet(id), held.id);
  await page.waitForTimeout(250);
  const now = await page.evaluate((no) =>
    (WorkshopData.get().hours || []).filter((h) => h.jobcard === no).length, held.no);
  assert.equal(now, before + 1, 'a hold must not swallow the hours that were actually worked');
  step('Returned sheet: a Quality Hold is explained up front, and never costs the hours already worked');
}

async function main() {
  const harness = await startBrowserHarness();
  const page = await harness.context.newPage();
  const monitor = monitorPage(page, harness.baseUrl);
  try {
    await page.goto(`${harness.baseUrl}/jobcard-desktop.html`, { waitUntil: 'load' });
    await loadDemoData(page);
    const jobcard = await jobcardWorkflow(page);
    await jobcardScopeChips(page);
    await theJobcardPrintsAsAForm(page);
    await enteringTheReturnedSheet(page);
    await theReturnedSheetRespectsAHold(page);
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
