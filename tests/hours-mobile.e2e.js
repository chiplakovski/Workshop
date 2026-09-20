'use strict';

// This is the screen the workshop actually touches every day: a welder, standing up, logging the
// hours they just worked. If it takes a minute it does not get done, and a time system nobody
// feeds is worse than no time system — every figure downstream quietly becomes a guess.
//
// So the promise this suite holds is a short one. Three presses: which job, how many hours, save.
// Everything the screen shows afterwards has to be the worker's own entry read back, because that
// is the only thing that makes a time sheet trustworthy to the person filling it in.

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness, loadDemoData } = require('./helpers/browser-harness');

const PHONE = { width: 390, height: 800 };
const TOUCH_MINIMUM = 44;

function step(message) {
  console.log(`OK   ${message}`);
}

async function threeTapsToLogTime(page) {
  const before = await page.evaluate(() => (WorkshopData.get().hours || []).length);

  await page.locator('.jobpick').first().click();
  const picked = await page.evaluate(() => ({
    project: document.getElementById('project').value,
    jobcard: document.getElementById('item').options[document.getElementById('item').selectedIndex]?.dataset.jobcard,
    lit: document.querySelectorAll('.jobpick.on').length
  }));
  assert.ok(picked.project, 'pressing a job should fill the project in');
  assert.ok(picked.jobcard, 'pressing a job should select one of its operations');
  assert.equal(picked.lit, 1, 'exactly one job can be the one being booked against');
  step('Hours on a phone: pressing an open job fills in the project and the operation');

  await page.locator('.qh[data-h="4"]').click();
  assert.equal(await page.locator('#hours').inputValue(), '4');

  await page.locator('#saveEntry').click();
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const yes = document.querySelector('.waskyes,.waskbtns button');
    if (yes) yes.click();
  });
  await page.waitForFunction((n) => (WorkshopData.get().hours || []).length > n, before);

  const entry = await page.evaluate(() => (WorkshopData.get().hours || [])[0]);
  assert.equal(Number(entry.hours), 4);
  assert.equal(entry.jobcard, picked.jobcard, 'the entry must name the jobcard that was pressed');
  assert.ok(entry.worker, 'an entry with no name on it cannot be a time sheet');
  step('Hours on a phone: job, hours, save — three presses and the entry is real');
}

// Workshops book time in halves. Typing 6.5 on a phone keyboard with a glove half off is the
// slowest part of the screen, so the common answers are buttons and the rest moves in half hours.
async function halfHourSteps(page) {
  await page.locator('.qh[data-h="2"]').click();
  assert.equal(await page.locator('#hours').inputValue(), '2');
  await page.locator('#hrsUp').click();
  assert.equal(await page.locator('#hours').inputValue(), '2.5');
  await page.locator('#hrsDown').click();
  await page.locator('#hrsDown').click();
  assert.equal(await page.locator('#hours').inputValue(), '1.5');

  // Hours cannot go negative: an entry of minus two hours is not a correction, it is nonsense.
  for (let i = 0; i < 6; i += 1) await page.locator('#hrsDown').click();
  assert.equal(await page.locator('#hours').inputValue(), '');
  step('Hours on a phone: halves by button, and the count never falls below nothing');
}

async function yesterdayIsOnePress(page) {
  const before = await page.locator('#date2').inputValue();
  await page.locator('#dayBack').click();
  const after = await page.locator('#date2').inputValue();
  const gap = (new Date(before) - new Date(after)) / 86400000;
  assert.equal(gap, 1, 'Yesterday should move the date back exactly one day');
  step('Hours on a phone: yesterday — the correction people actually need — is one press');
}

async function theDayReadsBack(page) {
  await page.evaluate(() => {
    document.getElementById('date2').valueAsDate = new Date();
    renderToday();
  });
  const panel = await page.locator('#todayList').innerText();
  const truth = await page.evaluate(() => {
    const who = document.getElementById('whoName').textContent.trim();
    const day = document.getElementById('date2').value;
    const mine = (WorkshopData.get().hours || []).filter((h) => h.date === day && (h.worker === who || h.user === who));
    return { count: mine.length, total: mine.reduce((a, h) => a + (Number(h.hours) || 0), 0) };
  });
  assert.ok(truth.count > 0, 'the entry just saved should belong to today');
  assert.ok(panel.includes(`${truth.total} h`), `the day's total should read ${truth.total} h — panel said: ${panel}`);
  step("Hours on a phone: the day reads back the worker's own entries and their total");
}

// A 34px target is a target you miss with a glove half off. Everything on the logging path is
// held to the size a thumb actually needs.
async function targetsAreThumbSized(page) {
  const small = await page.evaluate((minimum) => [...document.querySelectorAll(
    '.jobpick,.qh,.step,#hours,#date2,#project,#item,#saveEntry,#saveNewEntry,#moreChip')]
    .filter((el) => el.offsetParent)
    .map((el) => ({ id: el.id || el.className, h: Math.round(el.getBoundingClientRect().height) }))
    .filter((el) => el.h < minimum), TOUCH_MINIMUM);
  assert.deepEqual(small, [], `controls too small to press: ${small.map((s) => `${s.id} ${s.h}px`).join(', ')}`);
  step('Hours on a phone: every control on the logging path is thumb-sized');
}

// The detail is the exception, not the rule. It used to be three chips that only turned blue.
async function detailFoldsAway(page) {
  assert.equal(await page.evaluate(() => document.getElementById('moreWrap').hidden), true,
    'equipment, material and notes start folded away');
  await page.locator('#moreChip').click();
  assert.equal(await page.evaluate(() => document.getElementById('moreWrap').hidden), false);
  assert.equal(await page.evaluate(() => document.getElementById('moreChip').getAttribute('aria-expanded')), 'true');
  await page.locator('#moreChip').click();
  assert.equal(await page.evaluate(() => document.getElementById('moreWrap').hidden), true);
  step('Hours on a phone: the detail folds away, and the button that opens it really opens it');
}

// Two buttons on this screen only ever toggled their own colour, and the photographs the third
// collected were never read by anything. Nothing here may promise what it does not do.
async function nothingPretends(page) {
  const decorative = await page.evaluate(() =>
    [...document.querySelectorAll('button[onclick]')]
      .filter((b) => /classList\.toggle\('on'\)\s*$/.test(b.getAttribute('onclick').trim()))
      .map((b) => b.textContent.trim()));
  assert.deepEqual(decorative, [], `buttons that only change their own colour: ${decorative.join(', ')}`);
  assert.equal(await page.locator('#picsChip').count(), 0,
    'the picture button collected files nothing ever read — photographs need the backend');
  step('Hours on a phone: no button promises something the screen cannot do');
}

async function main() {
  const harness = await startBrowserHarness();
  const page = await harness.context.newPage();
  await page.setViewportSize(PHONE);
  const monitor = monitorPage(page, harness.baseUrl);
  page.on('dialog', (dialog) => dialog.dismiss());
  try {
    await page.goto(`${harness.baseUrl}/hours-mobile.html`, { waitUntil: 'load' });
    await loadDemoData(page);
    await targetsAreThumbSized(page);
    await nothingPretends(page);
    await threeTapsToLogTime(page);
    await theDayReadsBack(page);
    await halfHourSteps(page);
    await yesterdayIsOnePress(page);
    await detailFoldsAway(page);
    monitor.assertClean();
    console.log('\nHours on a phone browser E2E passed.');
  } finally {
    await page.close();
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
