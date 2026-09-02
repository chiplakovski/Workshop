'use strict';

const assert = require('node:assert/strict');
const { appPages, monitorPage, startBrowserHarness } = require('./helpers/browser-harness');

const SAFE_NAV_SELECTOR = [
  'button[data-lang]',
  'button[data-filter]',
  'button[data-section]:not(.actionitem)',
  'button[data-view]:not([data-view="new-equipment"])',
  'button[data-tab]'
].join(',');

async function smokePage(context, baseUrl, file) {
  const page = await context.newPage();
  const monitor = monitorPage(page, baseUrl);
  page.on('dialog', (dialog) => dialog.dismiss());

  try {
    await page.goto(`${baseUrl}/${file}`, { waitUntil: 'load' });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('body').isVisible(), true, 'body is not visible');
    assert.ok((await page.locator('body').innerText()).trim().length > 0, 'page rendered no visible text');

    const navCount = await page.locator(SAFE_NAV_SELECTOR).count();
    for (let index = 0; index < navCount; index += 1) {
      const button = page.locator(SAFE_NAV_SELECTOR).nth(index);
      if (await button.isVisible() && await button.isEnabled()) {
        await button.click();
        await page.waitForTimeout(20);
      }
    }

    monitor.assertClean();
  } finally {
    await page.close();
  }
}

async function main() {
  const pages = appPages();
  const harness = await startBrowserHarness();
  try {
    for (const file of pages) {
      await smokePage(harness.context, harness.baseUrl, file);
      console.log(`OK   ${file}`);
    }
    console.log(`\nBrowser smoke passed for ${pages.length} pages.`);
  } finally {
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
