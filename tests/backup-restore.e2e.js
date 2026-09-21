'use strict';

// Everything this app knows lives in one browser, on one device. Clear its data, change phone,
// or hand the tablet to somebody who clears it, and the workshop's history is gone with no
// warning and nothing to go back to.
//
// The operations that save and restore a copy had been written into the data layer for a long
// time and had a button on no page in the app — which is the same as not having them. This suite
// holds the whole round trip, because a copy you cannot restore is not a copy: save it, wipe the
// system, restore it, and check the records are the ones that went in.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { monitorPage, startBrowserHarness, loadDemoData } = require('./helpers/browser-harness');

function step(message) {
  console.log(`OK   ${message}`);
}

async function thePanelSaysWhereTheWorkIs(page) {
  const shown = await page.evaluate(() => ({
    counts: [...document.querySelectorAll('.ydcount')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
    save: !!document.getElementById('ydBackup'),
    restore: !!document.getElementById('ydRestore')
  }));
  assert.ok(shown.save && shown.restore, 'the front page must offer both halves — a save nobody can restore is not a save');

  // The counts are records, not decoration.
  const truth = await page.evaluate(() => {
    const s = WorkshopData.get();
    return { projects: (s.projects || []).length, jobcards: (s.jobcards || []).length };
  });
  assert.ok(shown.counts.some((c) => c.startsWith(`${truth.projects} `)), `projects should read ${truth.projects}`);
  assert.ok(shown.counts.some((c) => c.startsWith(`${truth.jobcards} `)), `jobcards should read ${truth.jobcards}`);
  step('Your data: the front page says what is kept and how much of it');
}

async function theRoundTrip(page) {
  const before = await page.evaluate(() => {
    const s = WorkshopData.get();
    return {
      projects: (s.projects || []).map((p) => p.no).sort(),
      jobcards: (s.jobcards || []).map((j) => j.no).sort(),
      customers: (s.customers || []).map((c) => c.name).sort()
    };
  });
  assert.ok(before.projects.length, 'the demo must have something worth losing');

  const download = page.waitForEvent('download');
  await page.locator('#ydBackup').click();
  const saved = await download;
  assert.equal(saved.suggestedFilename(), 'varmak-workshop-backup.json');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'varmak-')), 'backup.json');
  await saved.saveAs(file);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const yes = document.querySelector('.waskyes,.waskbtns button');
    if (yes) yes.click();
  });

  // The file has to be readable on its own, by something that is not this app.
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal((parsed.projects || []).length, before.projects.length,
    'the saved file must contain the records, not a reference to them');

  // Now lose everything, the way a cleared browser would.
  await page.evaluate(() => WorkshopData.reset());
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => WorkshopData.isEmpty()), true, 'the system should now be empty');
  assert.equal(await page.locator('.ydnone').count(), 1, 'and should say so rather than showing stale counts');
  step('Your data: a saved copy is a readable file, and clearing really does clear');

  await page.locator('#ydFile').setInputFiles(file);
  await page.waitForTimeout(250);
  const asked = await page.locator('.waskmsg').innerText();
  assert.match(asked, /replaces everything/i, 'restoring must say what it will do before it does it');
  await page.locator('.waskyes').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const ok = document.querySelector('.waskyes,.waskbtns button');
    if (ok) ok.click();
  });

  const after = await page.evaluate(() => {
    const s = WorkshopData.get();
    return {
      projects: (s.projects || []).map((p) => p.no).sort(),
      jobcards: (s.jobcards || []).map((j) => j.no).sort(),
      customers: (s.customers || []).map((c) => c.name).sort()
    };
  });
  assert.deepEqual(after, before, 'what came back must be what went in, record for record');
  step('Your data: restoring brings back exactly what was saved');

  // And it survives the page being closed and reopened, which is the whole point.
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(250);
  const reloaded = await page.evaluate(() => (WorkshopData.get().projects || []).map((p) => p.no).sort());
  assert.deepEqual(reloaded, before.projects, 'a restore that does not survive a reload has restored nothing');
  step('Your data: the restored workshop is still there after a reload');
}

// A file that is not a backup must be refused by name, not swallowed into an empty system.
async function rubbishIsRefused(page) {
  const before = await page.evaluate(() => (WorkshopData.get().projects || []).length);
  const junk = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'varmak-')), 'not-a-backup.json');
  fs.writeFileSync(junk, JSON.stringify({ hello: 'world', rows: [1, 2, 3] }));

  await page.locator('#ydFile').setInputFiles(junk);
  await page.waitForTimeout(250);
  const said = await page.locator('.waskmsg').innerText();
  assert.match(said, /not contain recognisable|not a valid/i, 'the refusal must say what is wrong with the file');
  await page.evaluate(() => {
    const ok = document.querySelector('.waskyes,.waskbtns button');
    if (ok) ok.click();
  });
  await page.waitForTimeout(200);

  assert.equal(await page.evaluate(() => (WorkshopData.get().projects || []).length), before,
    'a refused file must leave the workshop exactly as it was');
  step('Your data: a file that is not a backup is refused by name, and changes nothing');
}

async function main() {
  const harness = await startBrowserHarness();
  const page = await harness.context.newPage();
  const monitor = monitorPage(page, harness.baseUrl);
  try {
    await page.goto(`${harness.baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
    await loadDemoData(page);
    await thePanelSaysWhereTheWorkIs(page);
    await theRoundTrip(page);
    await rubbishIsRefused(page);
    monitor.assertClean();
    console.log('\nBackup/restore browser E2E passed.');
  } finally {
    await page.close();
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
