'use strict';

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness } = require('./helpers/browser-harness');

const SUPPLIER = 'E2E Nordic Materials AB';
const ITEM_CODE = 'E2E-PLATE-42';
const ITEM_DESCRIPTION = 'E2E stainless plate 5 mm';
const ORDERED_QTY = 12;
const UNIT_PRICE = 125;

function step(message) {
  console.log(`OK   ${message}`);
}

async function createSupplier(page) {
  await page.evaluate(() => openModal('supplier'));
  await page.locator('#supplierName').fill(SUPPLIER);
  await page.locator('#supplierCategory').fill('Stainless steel');
  await page.locator('#supplierCountry').fill('Sweden');
  await page.locator('#supplierStatus').selectOption('preferred');
  await page.locator('#modalForm .primary').click();
  await page.waitForFunction((name) => WorkshopData.listSuppliers().some((item) => item.name === name), SUPPLIER);

  const supplier = await page.evaluate((name) => WorkshopData.listSuppliers().find((item) => item.name === name), SUPPLIER);
  assert.ok(supplier, 'supplier was not persisted to shared data');
  assert.equal(supplier.status, 'preferred');
  await page.reload({ waitUntil: 'load' });
  await page.locator('#listSearch').fill(SUPPLIER);
  assert.equal(await page.locator('#supplierList .supplier').count(), 1);
  assert.ok((await page.locator('#supplierList').innerText()).includes(SUPPLIER));
  step('Suppliers: create persists and hydrates after reload');
}

async function createInventoryAndReorder(page) {
  await page.evaluate(() => openNewItemForm());
  await page.locator('#newCode').fill(ITEM_CODE);
  const shownNumber = await page.locator('#newItemNo').inputValue();
  await page.locator('#newDescription').fill(ITEM_DESCRIPTION);
  await page.locator('#newGroup').selectOption('materials');
  await page.locator('#newSubgroup').selectOption('stainless-steel');
  await page.locator('#newUnit').fill('EA');
  await page.locator('#newLocation').fill('E2E-R1-01');
  await page.locator('#newGrade').fill('AISI 304');
  await page.locator('#newDimensions').fill('2000 x 1000 x 5 mm');
  await page.locator('#newStock').fill('0');
  await page.locator('#newMinStock').fill('5');
  await page.locator('#newReorderQty').fill(String(ORDERED_QTY));
  await page.locator('#newAvgCost').fill('120');
  await page.locator('#newLastPrice').fill(String(UNIT_PRICE));
  await page.locator('#newSupplier').fill(SUPPLIER);
  await page.locator('#newHeat').fill('E2E-HEAT-42');
  await page.locator('#newItemModal .primary').click();
  await page.waitForTimeout(70);

  const item = await page.evaluate((code) => WorkshopData.get().inventory.find((entry) => entry.code === code), ITEM_CODE);
  assert.ok(item, 'inventory item was not persisted');
  // The group hands out the number, and the form shows it before anything is saved.
  assert.equal(String(item.itemNo), shownNumber, 'the number shown on the form is the number the item got');
  assert.equal(item.group, 'materials');
  assert.equal(item.subgroup, 'stainless-steel');
  assert.ok(item.itemNo >= 1000 && item.itemNo < 2000, 'a material must be numbered in the 1000 range');
  assert.equal(item.stock, 0);
  assert.equal(item.supplier, SUPPLIER);

  // The low-stock page reports the shortfall and the quantity that would clear
  // it; raising the order is Purchasing's job, and that is being rebuilt.
  await page.locator('#nav [data-view="reorder"]').click();
  await page.waitForTimeout(70);
  const reorderText = await page.locator('#reorderCards').innerText();
  assert.ok(reorderText.includes(ITEM_CODE), 'the low-stock page must list the item that is below minimum');
  assert.ok(new RegExp(String(ORDERED_QTY)).test(reorderText), 'the low-stock page must name the quantity to order');
  step('Store: the low-stock page reports the shortfall and the quantity to order');

  // The purchase order itself comes from the shared register, which the
  // Purchasing rebuild will write to.
  const poNo = await page.evaluate(({ code, supplier, qty, price }) => WorkshopData.upsertPurchaseOrder({
    supplier, project: null, itemCode: code, description: 'E2E stainless sheet',
    items: `Reorder: E2E stainless sheet (${code})`,
    orderedQty: qty, receivedQty: 0, value: qty * price, unitPrice: price,
    date: new Date().toISOString().slice(0, 10),
    expected: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    buyer: 'Aleksandar C.', status: 'Confirmed'
  }).no, { code: ITEM_CODE, supplier: SUPPLIER, qty: ORDERED_QTY, price: UNIT_PRICE });
  const orders = await page.evaluate((code) => WorkshopData.getPurchaseOrders().filter((po) => po.itemCode === code), ITEM_CODE);
  assert.equal(orders.length, 1, 'the shared register did not hold exactly one purchase order');
  assert.equal(orders[0].orderedQty, ORDERED_QTY);
  step('Store: a purchase order for the shortfall persists in the shared register');
  return poNo;
}

async function verifySupplierOrder(page, poNo, expectedStatus) {
  await page.locator('#listSearch').fill(SUPPLIER);
  await page.locator('#supplierList .supplier').click();
  await page.evaluate(() => switchTab('purchase orders'));
  const text = await page.locator('#poTable').innerText();
  assert.ok(text.includes(poNo));
  assert.ok(text.includes(ITEM_CODE));
  assert.ok(text.includes(expectedStatus));
}

async function receiveGoods(page, poNo) {
  await page.locator('#nav [data-view="receiving"]').click();
  await page.locator('#autoLabel').uncheck();
  await page.locator('#receiveItem').selectOption(ITEM_CODE);
  await page.locator('#receiveSupplier').fill(SUPPLIER);
  await page.locator('#receivePo').fill(poNo);
  await page.locator('#receiveDn').fill('E2E-DN-PART');
  await page.locator('#receiveQty').fill('5');
  await page.locator('#receiveLocation').fill('E2E-R1-02');
  await page.locator('#receiveHeat').fill('E2E-HEAT-42');
  await page.locator('#receivePrice').fill(String(UNIT_PRICE));
  await page.locator('#confirmReceipt').click();
  await page.waitForTimeout(70);

  let state = await page.evaluate(({ code, no }) => ({
    item: WorkshopData.get().inventory.find((entry) => entry.code === code),
    po: WorkshopData.findPurchaseOrder(no)
  }), { code: ITEM_CODE, no: poNo });
  assert.equal(state.item.stock, 5);
  assert.equal(state.po.receivedQty, 5);
  assert.equal(state.po.status, 'Partially Received');

  await page.locator('#receiveDn').fill('E2E-DN-FINAL');
  await page.locator('#receiveQty').fill('7');
  await page.locator('#confirmReceipt').click();
  await page.waitForTimeout(70);

  state = await page.evaluate(({ code, no }) => ({
    item: WorkshopData.get().inventory.find((entry) => entry.code === code),
    po: WorkshopData.findPurchaseOrder(no),
    movements: WorkshopData.get().movements.filter((entry) => entry.purchaseOrderNo === no)
  }), { code: ITEM_CODE, no: poNo });
  assert.equal(state.item.stock, ORDERED_QTY);
  assert.equal(state.item.location, 'E2E-R1-02');
  assert.equal(state.po.receivedQty, ORDERED_QTY);
  assert.equal(state.po.receivedValue, ORDERED_QTY * UNIT_PRICE);
  assert.equal(state.po.status, 'Received');
  assert.equal(state.movements.length, 2);
  assert.equal(state.movements[0].deliveryNote, 'E2E-DN-FINAL');

  await page.reload({ waitUntil: 'load' });
  const restored = await page.evaluate(({ code, no }) => ({
    stock: WorkshopData.get().inventory.find((entry) => entry.code === code).stock,
    po: WorkshopData.findPurchaseOrder(no)
  }), { code: ITEM_CODE, no: poNo });
  assert.equal(restored.stock, ORDERED_QTY);
  assert.equal(restored.po.status, 'Received');
  step('Store receiving: partial/final receipts update stock, PO status, evidence, and reload persistence');

  // Each nav item is its own page: the module no longer stacks eleven panels on one long scroll.
  const pages = await page.evaluate(() => {
    const out = [];
    STORE_VIEWS.forEach((v) => {
      showView(v);
      const shown = [...document.querySelectorAll('[data-panel]:not([hidden])')].map((p) => p.dataset.panel);
      out.push({ view: v, shown: [...new Set(shown)], crumb: document.getElementById('viewName').textContent });
    });
    showView('inventory');
    return out;
  });
  pages.forEach(({ view, shown, crumb }) => {
    assert.deepEqual(shown, [view], `the ${view} page must show only its own panels`);
    assert.ok(crumb && crumb.trim(), `the ${view} page must name itself in the header`);
  });
  assert.equal(pages.length, 12, 'every nav item must have a page of its own');
  assert.ok(pages.some((p) => p.view === 'groups'), 'the module must carry the groups page');
  ['orders', 'rfq', 'invoices', 'approvals', 'deliveries', 'comparison'].forEach((v) =>
    assert.ok(!pages.some((p) => p.view === v), `the removed ${v} page must not be back`));
  step('Store: each nav item opens its own page rather than scrolling one long one');

  // Every Store page reads in all three languages, and switching language must
  // never rewrite a record.
  const beforeLang = await page.evaluate(() => WorkshopData.getPurchaseOrders().map((po) => po.status));
  for (const lang of ['sv', 'mk']) {
    const leaked = await page.evaluate((l) => {
      setLang(l);
      const out = [];
      STORE_VIEWS.forEach((v) => {
        showView(v);
        if (/undefined/.test(document.querySelector(`[data-panel="${v}"]`).innerText)) out.push(v);
      });
      return out;
    }, lang);
    assert.deepEqual(leaked, [], `every Store page must be translated into ${lang}`);
  }
  const afterLang = await page.evaluate(() => WorkshopData.getPurchaseOrders().map((po) => po.status));
  assert.deepEqual(afterLang, beforeLang, 'changing language must not rewrite a stored record');
  await page.evaluate(() => { setLang('en'); showView('inventory'); });
  step('Store: every page reads in all three languages without touching stored data');

  await page.goto(page.url().split('#')[0] + '#stockcount', { waitUntil: 'load' });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => storeView), 'stockcount',
    'a Store page must be reachable by its own link');
  step('Store: a page can be opened directly by link');
}

async function main() {
  const harness = await startBrowserHarness();
  const page = await harness.context.newPage();
  const monitor = monitorPage(page, harness.baseUrl);
  try {
    await page.goto(`${harness.baseUrl}/suppliers-desktop.html`, { waitUntil: 'load' });
    await createSupplier(page);
    await page.goto(`${harness.baseUrl}/store-desktop.html`, { waitUntil: 'load' });
    const poNo = await createInventoryAndReorder(page);
    await page.goto(`${harness.baseUrl}/suppliers-desktop.html`, { waitUntil: 'load' });
    await verifySupplierOrder(page, poNo, 'Confirmed');
    step('Suppliers: live PO is visible in supplier purchase history');
    await page.goto(`${harness.baseUrl}/store-desktop.html`, { waitUntil: 'load' });
    await receiveGoods(page, poNo);
    assert.equal(await page.evaluate((no) => WorkshopData.findPurchaseOrder(no).status, poNo), 'Received');
    await page.goto(`${harness.baseUrl}/suppliers-desktop.html`, { waitUntil: 'load' });
    await verifySupplierOrder(page, poNo, 'Received');
    step('Store/Suppliers: final received state is shared across both subsystems');
    monitor.assertClean();
    console.log('\nStore/Suppliers browser E2E passed.');
  } finally {
    await page.close();
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
