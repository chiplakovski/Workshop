'use strict';

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness, loadDemoData } = require('./helpers/browser-harness');

const FOLDER_NAME = 'E2E Compliance Evidence';
const DOCUMENT_NAME = 'E2E Inspection & Material Evidence';
const FILE_NAME = 'e2e-inspection-evidence.txt';
const LINKED_RECORD = 'INS-E2E-0043';
const REPORT_NAME = 'E2E Documents & Evidence';
const RENAMED_REPORT = 'E2E Documents & Evidence — reviewed';

function step(message) {
  console.log(`OK   ${message}`);
}

async function documentsWorkflow(page) {
  await page.evaluate(() => openFolder());
  await page.locator('#folderName').fill(FOLDER_NAME);
  await page.locator('#folderModule').selectOption('Quality');
  await page.locator('#folderRecord').fill(LINKED_RECORD);
  await page.locator('#folderForm .primary').click();
  await page.waitForFunction((name) => WorkshopData.getDocumentFolders().some((folder) => folder.name === name), FOLDER_NAME);
  const folder = await page.evaluate((name) => WorkshopData.getDocumentFolders().find((entry) => entry.name === name), FOLDER_NAME);
  assert.equal(folder.module, 'Quality');
  assert.equal(folder.record, LINKED_RECORD);
  step('Documents: folder creation persists in the shared register');

  await page.evaluate(() => openUpload());
  await page.locator('#file').setInputFiles({
    name: FILE_NAME,
    mimeType: 'text/plain',
    buffer: Buffer.from('E2E inspection evidence\nHeat: E2E-HEAT-42\nResult: accepted\n')
  });
  await page.locator('#docName').fill(DOCUMENT_NAME);
  await page.locator('#docType').selectOption('Certificate');
  await page.locator('#docModule').selectOption('Quality');
  await page.locator('#docRecord').fill(LINKED_RECORD);
  await page.locator('#docCategory').fill(FOLDER_NAME);
  await page.locator('#docStatus').selectOption('Approved');
  await page.locator('#docRevision').fill('A');
  await page.locator('#docNotes').fill('Browser-persisted evidence for the stabilization workflow.');
  await page.locator('#uploadForm .primary').click();
  await page.waitForFunction((name) => WorkshopData.getDocuments().some((doc) => doc.name === name), DOCUMENT_NAME);

  let document = await page.evaluate((name) => WorkshopData.getDocuments().find((doc) => doc.name === name), DOCUMENT_NAME);
  assert.equal(document.fileName, FILE_NAME);
  assert.equal(document.mimeType, 'text/plain');
  assert.ok(document.fileData.startsWith('data:text/plain'));
  assert.equal(document.status, 'Approved');

  await page.reload({ waitUntil: 'load' });
  await page.locator('#search').fill(DOCUMENT_NAME);
  assert.ok((await page.locator('#table').innerText()).includes(DOCUMENT_NAME));
  document = await page.evaluate((name) => WorkshopData.getDocuments().find((doc) => doc.name === name), DOCUMENT_NAME);
  assert.ok(document.fileData, 'stored document content did not survive reload');
  step('Documents: metadata and browser-stored file content survive reload');

  await page.evaluate((name) => {
    const doc = WorkshopData.getDocuments().find((entry) => entry.name === name);
    selected = doc.id;
    render();
    openLink();
  }, DOCUMENT_NAME);
  await page.locator('#linkModule').selectOption('Projects');
  await page.locator('#linkRecord').fill('P-2026-014');
  await page.locator('#linkForm .primary').click();
  const linked = await page.evaluate((name) => WorkshopData.getDocuments().find((doc) => doc.name === name), DOCUMENT_NAME);
  assert.equal(linked.module, 'Projects');
  assert.equal(linked.record, 'P-2026-014');
  step('Documents: Link to Record updates the same shared document');

  await page.evaluate(() => openDocumentReport());
  await page.locator('#reportFormat').selectOption('json');
  await page.locator('#reportScope').selectOption('all');
  await page.locator('#reportName').fill(REPORT_NAME);
  const reportDownload = page.waitForEvent('download');
  await page.locator('#reportForm .primary').click();
  const download = await reportDownload;
  assert.equal(download.suggestedFilename(), 'E2E-Documents-Evidence.json');
  await page.waitForFunction((name) => WorkshopData.getSavedReports().some((report) => report.name === name), REPORT_NAME);
  const report = await page.evaluate((name) => WorkshopData.getSavedReports().find((entry) => entry.name === name), REPORT_NAME);
  assert.equal(report.category, 'Documents');
  assert.equal(report.type, 'document-export');
  assert.ok(report.rowCount > 0);
  step('Documents → Reports: generated download creates a real saved report record');
  return report.id;
}

async function reportsWorkflow(page, reportId) {
  await page.locator('[data-section="saved"]').click();
  let row = page.locator('#saved-list-body tr').filter({ hasText: REPORT_NAME });
  assert.equal(await row.count(), 1);

  await row.locator('button').first().click();
  assert.equal((await page.evaluate((id) => WorkshopData.getSavedReports().find((report) => report.id === id), reportId)).favourite, true);

  await row.getByRole('button', { name: 'Duplicate' }).click();
  await page.waitForFunction((id) => WorkshopData.getSavedReports().some((report) => report.name.endsWith('(copy)') && report.id !== id), reportId);
  const copy = await page.evaluate((id) => WorkshopData.getSavedReports().find((report) => report.name.endsWith('(copy)') && report.id !== id), reportId);
  assert.ok(copy);

  row = page.locator('#saved-list-body tr').filter({ hasText: '(copy)' });
  await row.getByRole('button', { name: 'Rename' }).click();
  await page.locator('.wask .waskinput').fill(RENAMED_REPORT);
  await page.locator('.wask .waskyes').click();
  await page.waitForTimeout(150);
  const renamed = await page.evaluate((id) => WorkshopData.getSavedReports().find((report) => report.id === id), copy.id);
  assert.equal(renamed.name, RENAMED_REPORT, 'report name was stored as HTML-encoded text');
  assert.ok((await page.locator('#saved-list-body').innerText()).includes(RENAMED_REPORT));

  row = page.locator('#saved-list-body tr').filter({ hasText: RENAMED_REPORT });
  const definitionDownload = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Export' }).click();
  assert.equal((await definitionDownload).suggestedFilename(), `saved-report-${copy.id}.json`);
  step('Reports: favourite, duplicate, rename, and definition export use real shared records');

  row = page.locator('#saved-list-body tr').filter({ hasText: REPORT_NAME }).filter({ hasNotText: RENAMED_REPORT });
  await row.getByRole('button', { name: 'Archive' }).click();
  await page.locator('.wask .waskyes').click();
  await page.waitForTimeout(150);
  assert.equal((await page.evaluate((id) => WorkshopData.getSavedReports().find((report) => report.id === id), reportId)).archived, true);

  await page.reload({ waitUntil: 'load' });
  await page.locator('[data-section="saved"]').click();
  const tableText = await page.locator('#saved-list-body').innerText();
  assert.ok(tableText.includes(RENAMED_REPORT));
  assert.ok(!tableText.includes(`${REPORT_NAME}\tDocuments`), 'archived original report remains visible');
  assert.equal((await page.evaluate((name) => WorkshopData.getDocuments().find((doc) => doc.name === name), DOCUMENT_NAME)).record, 'P-2026-014');
  step('Reports/Documents: archive and linked document state survive reload');
}

// Six fixed reports replaced fifteen sections and sixty-one tabs, and a seventh joined them: what there
// is to invoice, which is the one report the office takes a figure off to act on. The point of a report is
// that its figures come from records, so that is what these check: every KPI against the same count taken
// from the data layer, and — the part that matters most — that an empty system reports nothing rather than
// a plausible-looking number.
//
// Named rather than counted, because the assertion is that the nav offers exactly these and nothing
// half-built beside them.
const REPORTS = ['won', 'late', 'hours', 'stock', 'bought', 'failed', 'invoice', 'saved'];

async function sixReports(page) {
  const sections = await page.evaluate(() =>
    [...document.querySelectorAll('.sideitem[data-section]')].map((b) => b.dataset.section));
  assert.deepEqual(sections, REPORTS, 'the module is the fixed reports and the saved list');
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-tab]').length), 0,
    'a fixed report has no tabs to hunt through');

  const num = (id) => page.evaluate((i) => {
    const t = document.getElementById(i).textContent.trim();
    return t === 'N/A' ? null : Number(t.replace(/[^\d.-]/g, ''));
  }, id);

  await page.click('[data-section="won"]');
  const won = await page.evaluate(() => {
    const est = WorkshopData.listEstimations().filter((e) => !e.archived);
    return { accepted: est.filter((e) => e.status === 'accepted').length,
             open: est.filter((e) => ['draft', 'sent'].includes(e.status)).length };
  });
  assert.equal(await num('won-count'), won.accepted);
  assert.equal(await num('won-open'), won.open);
  assert.equal((await page.locator('#won-list-body tr').count()), Math.max(won.accepted, 1));
  step('Reports: what we won counts the quotations the customer actually accepted');

  await page.click('[data-section="late"]');
  const overdue = await page.evaluate(() => WorkshopData.getProjects().filter((p) => {
    if (p.status === 'completed') return false;
    const d = p.deadline || p.expectedCompletion;
    return !!d && new Date(d).getTime() < Date.now();
  }).length);
  assert.equal(await num('late-projects'), overdue);
  assert.equal(await page.locator('#late-proj-body tr').count(), Math.max(overdue, 1));
  step('Reports: what is late counts the projects past their promised date');

  await page.click('[data-section="bought"]');
  const po = await page.evaluate(() => WorkshopData.getPurchaseOrders());
  assert.equal(await num('buy-orders'), po.length);
  assert.equal(await num('buy-value'), po.reduce((t, o) => t + (Number(o.value) || 0), 0));
  assert.equal(await num('buy-suppliers'), new Set(po.map((o) => o.supplier).filter(Boolean)).size);
  step('Reports: what we bought totals the purchase orders Suppliers raised');

  await page.click('[data-section="failed"]');
  const q = await page.evaluate(() => ({
    failed: WorkshopData.listQualityInspections().filter((i) => i.result === 'failed').length,
    open: WorkshopData.listQualityNcrs().filter((n) => !['closed', 'rejected'].includes(n.status)).length,
    holds: WorkshopData.getActiveQualityHolds().length
  }));
  assert.equal(await num('fail-insp'), q.failed);
  assert.equal(await num('fail-ncr'), q.open);
  assert.equal(await num('fail-holds'), q.holds);
  step('Reports: what failed inspection agrees with Quality, record for record');

  await page.click('[data-section="hours"]');
  const logged = await page.evaluate(() => (WorkshopData.get().hours || []).length);
  if (logged === 0) {
    assert.equal(await page.locator('#hrs-logged').textContent(), 'N/A',
      'no hours logged must read N/A, never 0 - nobody worked zero hours');
  }
  step('Reports: hours nobody wrote down are reported as unknown, not as none');
}

async function reportsOnAnEmptySystem(page) {
  await page.evaluate(() => WorkshopData.reset());
  await page.reload({ waitUntil: 'load' });
  for (const section of ['won', 'late', 'hours', 'stock', 'bought', 'failed']) {
    await page.click(`[data-section="${section}"]`);
    const shown = await page.evaluate(() => {
      const el = document.querySelector('.section:not([style*="none"])');
      return {
        values: [...el.querySelectorAll('.kv')].map((e) => e.textContent.trim()),
        tables: el.querySelectorAll('tbody').length,
        empties: el.querySelectorAll('.emptyrow').length
      };
    });
    assert.equal(shown.empties, shown.tables, `${section}: every table should say it is empty`);
    const invented = shown.values.filter((v) => v !== 'N/A' && v !== '0');
    assert.deepEqual(invented, [], `${section} shows ${invented.join(', ')} on an empty system`);
  }
  step('Reports: an empty system reports nothing, not a plausible number');
}

async function main() {
  const harness = await startBrowserHarness();
  const page = await harness.context.newPage();
  const monitor = monitorPage(page, harness.baseUrl);
  try {
    await page.goto(`${harness.baseUrl}/documents-desktop.html`, { waitUntil: 'load' });
    await loadDemoData(page);
    const reportId = await documentsWorkflow(page);
    await page.goto(`${harness.baseUrl}/reports-desktop.html`, { waitUntil: 'load' });
    await reportsWorkflow(page, reportId);
    await sixReports(page);
    await reportsOnAnEmptySystem(page);
    monitor.assertClean();
    console.log('\nDocuments/Reports browser E2E passed.');
  } finally {
    await page.close();
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
