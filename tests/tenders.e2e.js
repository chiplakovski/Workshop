'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { monitorPage, startBrowserHarness } = require('./helpers/browser-harness');

// Reconstruct the handover's packaging constraints with the real Marketing source and every
// local dependency inlined. No allow-modals or allow-downloads: actions must work in srcdoc.
// This fixture tests that packaging shape; it is not the externally hosted Claude artifact.
function packagedMarketing() {
  const root = path.resolve(__dirname, '..');
  let html = fs.readFileSync(path.join(root, 'marketing-desktop.html'), 'utf8');
  html = html.replace(/<script\s+src="([^":]+\.js)"\s*><\/script>/g, (_, file) =>
    `<script>${fs.readFileSync(path.join(root, file), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`);
  html = html.replace(/<link\s+rel="stylesheet"\s+href="([^":]+\.css)"\s*>/g, (_, file) =>
    `<style>${fs.readFileSync(path.join(root, file), 'utf8')}</style>`);
  const escaped = html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Tender bundle test</title></head>
    <body style="margin:0"><iframe id="app" title="Workshop" sandbox="allow-scripts allow-same-origin"
    style="width:100vw;height:100vh;border:0" srcdoc="${escaped}"></iframe></body></html>`;
}

async function saveModal(app) {
  await app.locator('#fcard .fbtns .primary').click();
  await app.locator('#tfCompany').waitFor({ state: 'hidden' });
}

async function runMode(packaged) {
  const harness = await startBrowserHarness();
  const label = packaged ? 'sandboxed srcdoc' : 'served page';
  const page = await harness.context.newPage();
  const monitor = monitorPage(page, harness.baseUrl);
  const url = `${harness.baseUrl}/${packaged ? '__tender-bundle.html' : 'marketing-desktop.html'}`;
  if (packaged) {
    const body = packagedMarketing();
    await harness.context.route(url, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body }));
  }
  async function appFor(host) {
    const app = packaged ? await host.locator('#app').elementHandle().then(el => el.contentFrame()) : host;
    await app.waitForFunction(() => typeof window.WorkshopData?.getMarketingTenders === 'function');
    await app.evaluate(() => setView('tenders'));
    return app;
  }
  try {
    await page.goto(url, { waitUntil: 'load' });
    let app = await appFor(page);
    await app.getByRole('button', { name: 'New Tender / RFQ', exact: true }).click();
    const ref = await app.locator('#tfRef').inputValue();
    await app.locator('#tfCompany').fill('Tender persistence test');
    await app.locator('#tfDesc').fill('A test request with no stated budget');
    await app.locator('#tfDeadline').fill('2026-12-31');
    await saveModal(app);
    const row = () => app.locator('tbody tr').filter({ hasText: ref });
    assert.equal(await row().count(), 1, `${label}: a save must not duplicate a row`);
    assert.equal(await row().locator('td').nth(4).innerText(), '—');
    const created = await app.evaluate(ref => WorkshopData.getMarketingTenders().find(t => t.ref === ref), ref);
    assert.equal(created.value, null);

    await page.reload({ waitUntil: 'load' });
    app = await appFor(page);
    assert.equal(await row().count(), 1, `${label}: new tender must survive reload`);
    await row().getByRole('button', { name: 'Edit', exact: true }).click();
    await app.locator('#tfCompany').fill('Tender edited after reload');
    await app.locator('#tfValue').fill('0');
    await app.locator('#tfBid').selectOption('no-bid');
    await saveModal(app);
    await page.reload({ waitUntil: 'load' });
    app = await appFor(page);
    assert.match(await row().innerText(), /Tender edited after reload/);
    assert.equal(await row().locator('td').nth(4).innerText(), '0 kr');
    const edited = await app.evaluate(id => WorkshopData.findMarketingTender(id), created.id);
    assert.equal(edited.bidDecision, 'no-bid');
    assert.equal(edited.deadline, '2026-12-31');
    console.log(`PASS ${label}: create/edit, blank versus zero value, and reload persistence`);

    const other = await harness.context.newPage();
    const otherMonitor = monitorPage(other, harness.baseUrl);
    await other.goto(url, { waitUntil: 'load' });
    const otherApp = await appFor(other);
    const otherRow = otherApp.locator('tbody tr').filter({ hasText: ref });
    await otherRow.getByRole('button', { name: 'Edit', exact: true }).click();
    await otherApp.locator('#tfCompany').fill('Updated in the other tab');
    await saveModal(otherApp);
    await app.getByText('Updated in the other tab', { exact: true }).waitFor();
    assert.equal(await row().count(), 1);
    console.log(`PASS ${label}: a second tab's edit refreshes the visible register`);

    // Enter a duplicate reference through the real form. The error must be visible even in
    // the sandbox, the form must remain open, and the existing tender must be untouched.
    await app.getByRole('button', { name: 'New Tender / RFQ', exact: true }).click();
    assert.notEqual(await app.locator('#tfRef').inputValue(), ref);
    await app.locator('#tfRef').fill(ref);
    await app.locator('#tfCompany').fill('Must not overwrite');
    await app.locator('#fcard .fbtns .primary').click();
    await app.getByText('This tender reference is already in use', { exact: true }).waitFor();
    await app.locator('.waskyes').click();
    assert.equal(await app.locator('#tfCompany').inputValue(), 'Must not overwrite');
    await app.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.match(await row().innerText(), /Updated in the other tab/);

    // Import dispatches the same event as an ordinary edit; an explicitly empty register must
    // render empty immediately and stay empty through the next packaged/ordinary load.
    const backup = await app.evaluate(() => WorkshopData.get());
    const imported = await app.evaluate(() => WorkshopData.importBackup({ ...WorkshopData.get(), marketingTenders: [] }));
    assert.equal(imported.success, true);
    await app.getByText('No tenders yet.', { exact: true }).waitFor();
    await page.reload({ waitUntil: 'load' });
    app = await appFor(page);
    await app.getByText('No tenders yet.', { exact: true }).waitFor();
    await app.evaluate(data => WorkshopData.importBackup(data), backup);
    await app.getByText('Updated in the other tab', { exact: true }).waitFor();
    console.log(`PASS ${label}: visible duplicate error and backup/import round trip`);
    otherMonitor.assertClean();
    await other.close();
    monitor.assertClean();
  } finally {
    await page.close();
    await harness.close();
  }
}

(async () => {
  await runMode(false);
  await runMode(true);
  console.log('\nTender persistence browser E2E passed.');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
