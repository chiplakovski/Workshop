'use strict';

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness } = require('./helpers/browser-harness');

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
  page.once('dialog', async (dialog) => dialog.accept(RENAMED_REPORT));
  await row.getByRole('button', { name: 'Rename' }).click();
  const renamed = await page.evaluate((id) => WorkshopData.getSavedReports().find((report) => report.id === id), copy.id);
  assert.equal(renamed.name, RENAMED_REPORT, 'report name was stored as HTML-encoded text');
  assert.ok((await page.locator('#saved-list-body').innerText()).includes(RENAMED_REPORT));

  row = page.locator('#saved-list-body tr').filter({ hasText: RENAMED_REPORT });
  const definitionDownload = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Export' }).click();
  assert.equal((await definitionDownload).suggestedFilename(), `saved-report-${copy.id}.json`);
  step('Reports: favourite, duplicate, rename, and definition export use real shared records');

  row = page.locator('#saved-list-body tr').filter({ hasText: REPORT_NAME }).filter({ hasNotText: RENAMED_REPORT });
  page.once('dialog', async (dialog) => dialog.accept());
  await row.getByRole('button', { name: 'Archive' }).click();
  assert.equal((await page.evaluate((id) => WorkshopData.getSavedReports().find((report) => report.id === id), reportId)).archived, true);

  await page.reload({ waitUntil: 'load' });
  await page.locator('[data-section="saved"]').click();
  const tableText = await page.locator('#saved-list-body').innerText();
  assert.ok(tableText.includes(RENAMED_REPORT));
  assert.ok(!tableText.includes(`${REPORT_NAME}\tDocuments`), 'archived original report remains visible');
  assert.equal((await page.evaluate((name) => WorkshopData.getDocuments().find((doc) => doc.name === name), DOCUMENT_NAME)).record, 'P-2026-014');
  step('Reports/Documents: archive and linked document state survive reload');
}

async function main() {
  const harness = await startBrowserHarness();
  const page = await harness.context.newPage();
  const monitor = monitorPage(page, harness.baseUrl);
  try {
    await page.goto(`${harness.baseUrl}/documents-desktop.html`, { waitUntil: 'load' });
    const reportId = await documentsWorkflow(page);
    await page.goto(`${harness.baseUrl}/reports-desktop.html`, { waitUntil: 'load' });
    await reportsWorkflow(page, reportId);
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
