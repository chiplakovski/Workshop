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
  await page.locator('#newDescription').fill(ITEM_DESCRIPTION);
  await page.locator('#newCategory').fill('Sheet metal');
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
  assert.equal(item.stock, 0);
  assert.equal(item.supplier, SUPPLIER);

  await page.evaluate((code) => suggestReorder(code), ITEM_CODE);
  await page.waitForTimeout(70);
  let orders = await page.evaluate(({ code, supplier }) => WorkshopData.getPurchaseOrders().filter((po) => po.itemCode === code && po.supplier === supplier), { code: ITEM_CODE, supplier: SUPPLIER });
  assert.equal(orders.length, 1, 'reorder did not create exactly one purchase order');
  assert.equal(orders[0].status, 'Awaiting Approval');
  assert.equal(orders[0].orderedQty, ORDERED_QTY);
  assert.equal(orders[0].receivedQty, 0);

  await page.evaluate((code) => suggestReorder(code), ITEM_CODE);
  orders = await page.evaluate((code) => WorkshopData.getPurchaseOrders().filter((po) => po.itemCode === code), ITEM_CODE);
  assert.equal(orders.length, 1, 'a repeated reorder created a duplicate purchase order');
  step('Store: low stock creates one quantity-aware PO and blocks duplicates');
  return orders[0].no;
}

async function approveAndVerifyPurchaseOrder(page, poNo) {
  await page.evaluate(() => setView('orders'));
  await page.locator('#search').fill(ITEM_CODE);
  let text = await page.locator('#detailContent').innerText();
  assert.ok(text.includes(poNo));
  assert.ok(text.includes(SUPPLIER));

  await page.locator('#search').fill('');
  await page.evaluate(() => setView('approvals'));
  const approval = page.locator('#detailContent .approval').filter({ hasText: poNo });
  await approval.getByRole('button', { name: 'Approve' }).click();
  const approved = await page.evaluate((no) => WorkshopData.findPurchaseOrder(no), poNo);
  assert.equal(approved.status, 'Confirmed');
  step('Purchasing: reorder is visible and approval changes the shared PO');
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
    await page.goto(`${harness.baseUrl}/purchasing-desktop.html`, { waitUntil: 'load' });
    await approveAndVerifyPurchaseOrder(page, poNo);
    await page.goto(`${harness.baseUrl}/suppliers-desktop.html`, { waitUntil: 'load' });
    await verifySupplierOrder(page, poNo, 'Confirmed');
    step('Suppliers: live PO is visible in supplier purchase history');
    await page.goto(`${harness.baseUrl}/store-desktop.html`, { waitUntil: 'load' });
    await receiveGoods(page, poNo);
    await page.goto(`${harness.baseUrl}/purchasing-desktop.html`, { waitUntil: 'load' });
    await page.evaluate(() => setView('orders'));
    await page.locator('#search').fill(poNo);
    await page.locator('#statusFilter').selectOption('Received');
    assert.ok((await page.locator('#detailContent').innerText()).includes('Received'));
    await page.goto(`${harness.baseUrl}/suppliers-desktop.html`, { waitUntil: 'load' });
    await verifySupplierOrder(page, poNo, 'Received');
    step('Purchasing/Suppliers: final received state is shared across both subsystems');
    monitor.assertClean();
    console.log('\nStore/Purchasing/Suppliers browser E2E passed.');
  } finally {
    await page.close();
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
