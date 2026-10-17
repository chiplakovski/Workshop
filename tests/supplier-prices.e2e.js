'use strict';

// Store and Suppliers, joined by what a merchant charges for an item. Each screen used to know half of
// it: the store kept a typed name on the item, and a supplier's "Items & Prices" was empty on a copy with
// no server. Asked from both ends, the way the office goes about it: a price entered on the supplier
// shows on the item; an item opened from the price list shows who sells it; a second merchant added from
// the store becomes the one it is bought from; a name in the store's list opens that merchant.

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
    await page.goto(`${harness.baseUrl}/suppliers-desktop.html`, { waitUntil: 'load' });
    await loadDemoData(page);
    await page.goto(`${harness.baseUrl}/suppliers-desktop.html?supplier=${encodeURIComponent('TestKappa Steel')}`, { waitUntil: 'load' });
    await page.waitForSelector('#itemsTable');
    const table = () => page.locator('#itemsTable').textContent();
    assert.match(await table(), /MS-TUBE-25SQ-1\.6[\s\S]*no price recorded/,
      'an item the store says is bought here shows on the merchant, with the price missing said out loud');
    step('Suppliers: the store items bought from this merchant show on its price list, unpriced ones marked');

    await page.click('button[data-i="add_price"]');
    await page.selectOption('.spform select[name="code"]', 'ER70S-6-1.0');
    await page.click('.spform .waskyes');
    assert.match(await page.locator('.spform .sperr').textContent(), /A price is needed/);
    await page.fill('.spform input[name="price"]', '14.5');
    await page.fill('.spform input[name="articleNo"]', 'KS-ER70');
    await page.fill('.spform input[name="leadTime"]', '5');
    await page.check('.spform input[name="preferred"]');
    await page.click('.spform .waskyes');
    await page.waitForSelector('.spform', { state: 'detached' });
    assert.match(await table(), /★[\s\S]*ER70S-6-1\.0[\s\S]*KS-ER70[\s\S]*14,50 SEK/);
    step('Suppliers: a price is added from the merchant\'s page, refused first without a price, and listed with its star');

    await page.click('#itemsTable a.itemlink:has-text("ER70S-6-1.0")');
    await page.waitForURL(/store-desktop\.html\?item=ER70S-6-1\.0/);
    await page.waitForSelector('#infoModal.show', { timeout: 8000 });
    const info = () => page.locator('#infoBody').textContent();
    assert.match(await info(), /Suppliers and prices[\s\S]*TestKappa Steel[\s\S]*bought from here[\s\S]*14,50 SEK/);
    step('Store: the item opened from the price list shows who sells it, at what, and who it is bought from');

    await page.click('#infoBody button:has-text("+ Add supplier price")');
    await page.selectOption('.spform select[name="supplier"]', 'TestLambda');
    await page.fill('.spform input[name="price"]', '13.9');
    await page.check('.spform input[name="preferred"]');
    await page.click('.spform .waskyes');
    await page.waitForSelector('.spform', { state: 'detached' });
    const rows = await page.locator('#infoBody .infosec').first().locator('.inforow').allTextContents();
    assert.equal(rows.length, 2);
    assert.match(rows[0], /★[\s\S]*TestLambda[\s\S]*bought from here[\s\S]*13,90/, 'the merchant now bought from comes first');
    assert.doesNotMatch(rows[1], /bought from here/, 'and only one is');
    assert.equal(await page.evaluate(() => WorkshopData.get().inventory.find((i) => i.code === 'ER70S-6-1.0').supplier), 'TestLambda',
      'the item\'s own "bought from" follows');
    step('Store: a second merchant added from the item becomes the one it is bought from, and the first is not any more');

    await page.click('#infoBody a.suplink:has-text("TestLambda")');
    await page.waitForURL(/suppliers-desktop\.html\?supplier=TestLambda/);
    await page.waitForFunction(() => /TestLambda/.test(document.getElementById('profile').textContent));
    assert.match(await table(), /ER70S-6-1\.0[\s\S]*13,90 SEK/);
    step('Suppliers: the merchant\'s name in the store opens that merchant, at its price list');

    await page.click('#itemsTable button:has-text("Change")');
    await page.click('.spform .spremove');
    await page.waitForSelector('.spform', { state: 'detached' });
    assert.doesNotMatch(await table(), /13,90/);
    step('Suppliers: a price taken off the list is gone from it');

    await page.click('#langtoggle').catch(() => {});
    await page.evaluate(() => setLang('mk'));
    await page.click('button[data-i="add_price"]');
    assert.match(await page.locator('.spform .waskmsg').textContent(), /Цена од добавувач/);
    await page.click('.spform .waskno');
    step('The price form speaks the page\'s language');

    assert.deepEqual(thrown, [], `a page threw: ${thrown.join(' / ')}`);
    console.log(`\n${checks} checks: store items and suppliers are joined by what each merchant charges.`);
  } finally {
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
