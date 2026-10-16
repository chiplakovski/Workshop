'use strict';

// The crew view on Planning, on a copy with no server: who works on what, day by day. Asked the way the
// office uses it — people added by name, a week planned from one form, a day away, an entry dragged to
// somebody else, a copy made with Ctrl held, last week copied forward — and judged by what is on screen
// and what is stored, not by what the functions say about themselves.

const assert = require('node:assert/strict');
const { startBrowserHarness, loadDemoData } = require('./helpers/browser-harness');

let checks = 0;
const step = (message) => { checks += 1; console.log(`OK   ${message}`); };

async function main() {
  const harness = await startBrowserHarness();
  try {
    const page = await harness.context.newPage();
    const thrown = [];
    page.on('pageerror', (e) => thrown.push(e.message));
    await page.goto(`${harness.baseUrl}/planning-desktop.html#crew`, { waitUntil: 'load' });
    await loadDemoData(page);
    await page.goto(`${harness.baseUrl}/planning-desktop.html#crew`, { waitUntil: 'load' });
    await page.waitForSelector('#crewGrid');
    const stored = () => page.evaluate(() => WorkshopData.crewEntries());
    const days = await page.evaluate(() => crewDays());
    const job = await page.evaluate(() => WorkshopData.listJobcards().find((j) => !['completed', 'closed', 'cancelled'].includes(j.status)).no);

    for (const name of ['Anna Test', 'Bo Test']) {
      await page.click('#crewAddPerson');
      await page.fill('.waskinput', name);
      await page.click('.waskyes');
    }
    assert.equal(await page.locator('#crewGrid td.cell[data-worker="Anna Test"]').count(), 5, 'a row of five weekdays for a person added by name');
    step('Crew: people are added by name, each with a row of weekdays');

    await page.locator('#crewGrid td.cell[data-worker="Anna Test"]').first().click();
    await page.selectOption('#cfWhat', `job:${job}`);
    await page.fill('#cfHours', '8');
    await page.check('#cfRepeat');
    await page.click('#crewModal .btn.primary');
    let plan = await stored();
    assert.deepEqual(plan.map((e) => e.day), days, 'one form, Monday to Friday');
    assert.ok(plan.every((e) => e.worker === 'Anna Test' && e.jobcard === job && e.hours === 8));
    assert.equal(await page.locator('#crewGrid td.cell[data-worker="Anna Test"] .cchip').count(), 5);
    step('Crew: one form plans a person onto a job for the whole week');

    await page.locator('#crewGrid td.cell[data-worker="Anna Test"]').nth(1).click({ position: { x: 4, y: 50 } });
    await page.selectOption('#cfWhat', `job:${job}`);
    await page.click('#crewModal .btn.primary');
    assert.match(await page.locator('#cfError').textContent(), /Already planned on that job that day/);
    await page.fill('#cfHours', '0');
    await page.selectOption('#cfWhat', 'away:course');
    await page.click('#crewModal .btn.primary');
    assert.match(await page.locator('#cfError').textContent(), /more than zero/);
    await page.fill('#cfHours', '17');
    await page.click('#crewModal .btn.primary');
    assert.match(await page.locator('#cfError').textContent(), /more than 24 hours/, '8 on the job and 17 away is a 25-hour day');
    await page.click('#crewModal .btn:not(.primary):not(.danger)');
    assert.equal((await stored()).length, 5, 'nothing refused was stored');
    step('Crew: a duplicate job, zero hours and a 25-hour day are refused in the form, and nothing is stored');

    await page.locator('#crewGrid td.cell[data-worker="Bo Test"]').nth(2).click();
    await page.selectOption('#cfWhat', 'away:sick');
    await page.click('#crewModal .btn.primary');
    const annaWednesday = page.locator(`#crewGrid td.cell[data-worker="Anna Test"][data-day="${days[2]}"] .cchip`);
    await annaWednesday.dragTo(page.locator(`#crewGrid td.cell[data-worker="Bo Test"][data-day="${days[2]}"]`));
    plan = await stored();
    assert.equal(plan.filter((e) => e.worker === 'Bo Test').length, 2, 'the dragged day moved to Bo');
    assert.equal(plan.filter((e) => e.worker === 'Anna Test').length, 4);
    const boWednesday = page.locator(`#crewGrid td.cell[data-worker="Bo Test"][data-day="${days[2]}"]`);
    assert.match(await boWednesday.textContent(), /Away \(Sick\) and planned on a job/, 'sick and on a job the same day is marked');
    step('Crew: dragging an entry moves it to another person, and sick-and-planned is marked on that day');

    const annaMonday = page.locator(`#crewGrid td.cell[data-worker="Anna Test"][data-day="${days[0]}"] .cchip`);
    await page.keyboard.down('Control');
    await annaMonday.dragTo(page.locator(`#crewGrid td.cell[data-worker="Bo Test"][data-day="${days[0]}"]`));
    await page.keyboard.up('Control');
    plan = await stored();
    assert.equal(plan.filter((e) => e.day === days[0]).length, 2, 'with Ctrl held the entry is copied, not moved');
    step('Crew: dragging with Ctrl held copies the entry instead');

    await page.click('#crewGrid .grangebar button[aria-label="Later"], .grangebar button[onclick="crewShift(1)"]');
    const next = await page.evaluate(() => crewDays());
    assert.equal(next[0] > days[0], true, 'the next week is shown');
    await page.click('button[onclick="crewCopyLastWeek()"]');
    await page.click('.waskyes');
    plan = await stored();
    const copied = plan.filter((e) => e.day >= next[0]);
    assert.equal(copied.length, 6, 'every job entry of last week copied forward');
    assert.ok(copied.every((e) => e.jobcard && !e.absence), 'the day Bo was sick is not copied');
    step('Crew: last week\'s jobs are copied into the next week, and days away are not');

    await page.click('button[onclick="crewThisWeek()"]');
    await page.locator('#crewGrid td.who .rm').first().click();
    await page.click('.waskyes');
    assert.ok((await stored()).some((e) => e.worker === 'Anna Test'), 'taking a person off the list keeps their planned days');
    assert.equal(await page.locator('#crewGrid td.cell[data-worker="Anna Test"]').count(), 5, 'and the week they are planned in still shows them');
    step('Crew: taking a person off the list keeps the days already planned for them');

    await page.selectOption('#lang', 'mk');
    const head = await page.locator('#crewGrid thead').textContent();
    assert.match(head, /пон/i, 'Macedonian day names, not the browser\'s English');
    assert.doesNotMatch(head, /\b(Mon|Oct)\b/);
    assert.match(await page.locator('#crewWeekLabel').textContent(), /^Недела \d+/);
    step('Crew: in Macedonian the week and its days read in Macedonian');

    assert.deepEqual(thrown, [], `the page threw: ${thrown.join(' / ')}`);
    console.log(`\n${checks} checks: the crew plan is drawn, changed and refused the way the office uses it.`);
  } finally {
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
