'use strict';

// The language somebody chooses stays chosen. Every page has its own switch, and each used to start in
// English: Macedonian chosen on the hub, the store opened, and it was English again. Asked the way a
// person does it — chosen once by clicking, then every page opened in turn — and judged by what is on
// the screen rather than by what was stored: Cyrillic text, and next to no Latin outside codes and names.

const assert = require('node:assert/strict');
const { appPages, startBrowserHarness } = require('./helpers/browser-harness');

async function main() {
  const harness = await startBrowserHarness();
  try {
    const page = await harness.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.dismiss());

    await page.goto(`${harness.baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
    await page.click('#langtoggle');
    await page.locator('#langc button[data-lang="mk"]').click();
    console.log('OK   Macedonian chosen on the hub');

    for (const file of appPages()) {
      await page.goto(`${harness.baseUrl}/${file}`, { waitUntil: 'load' });
      await page.waitForFunction(() => document.documentElement.lang === 'mk', null, { timeout: 5000 })
        .catch(() => {});
      const seen = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        cyrillic: (document.body.innerText.match(/[Ѐ-ӿ]/g) || []).length
      }));
      assert.equal(seen.lang, 'mk', `${file} opened in ${seen.lang}, not in the language chosen on the hub`);
      assert.ok(seen.cyrillic > 40, `${file} says it is Macedonian but shows almost no Macedonian text`);
      console.log(`OK   ${file} opens in Macedonian`);
    }

    // And changed back on a page whose switch is a drop-down, not buttons: the next page follows that.
    await page.goto(`${harness.baseUrl}/store-desktop.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.lang === 'mk');
    await page.selectOption('#lang', 'sv');
    await page.goto(`${harness.baseUrl}/hub-desktop.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.lang === 'sv', null, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'sv',
      'Swedish chosen in the store did not follow to the hub');
    console.log('OK   Swedish chosen in the store follows back to the hub');

    assert.deepEqual(errors, [], 'no page threw while switching');
    console.log('\nThe chosen language follows across every page.');
  } finally {
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
