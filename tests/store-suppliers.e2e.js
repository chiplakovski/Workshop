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

  // The overview reads as a board of groups, and a card can be refiled by
  // dragging it - within a group directly, across groups after confirming.
  await page.evaluate(() => showView('inventory'));
  await page.waitForTimeout(120);
  const board = await page.evaluate(() => ({
    columns: [...document.querySelectorAll('#stockBoard .kcol')].map((c) => c.dataset.group),
    lanes: [...document.querySelectorAll('#stockBoard .kcol[data-group="materials"] .ksub')].map((l) => l.dataset.sub),
    tableHidden: document.getElementById('stockTable').hidden
  }));
  assert.deepEqual(board.columns, ['materials', 'consumables', 'hardware', 'tooling'],
    'the overview must show one column per group');
  assert.ok(board.lanes.includes('copper'), 'an empty subgroup must still be a lane you can drop into');
  assert.equal(board.tableHidden, true, 'the board is the overview; the table is the other tab');

  const dragCard = async (fromSel, toSel) => {
    const a = await page.locator(fromSel).boundingBox();
    const b = await page.locator(toSel).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + 12);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 20, a.y + 20, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  };

  const moving = await page.getAttribute('#stockBoard .kcol[data-group="materials"] .kcard >> nth=0', 'data-code');
  const numberBefore = await page.evaluate((c) => WorkshopData.get().inventory.find((x) => x.code === c).itemNo, moving);
  // The board re-renders after every move, so the card is found by its code
  // rather than by where it happened to sit a moment ago.
  const cardFor = (code) => `#stockBoard .kcard[data-code="${code}"]`;
  await dragCard(cardFor(moving), '#stockBoard .kcol[data-group="materials"] .ksub[data-sub="copper"]');
  let after = await page.evaluate((c) => WorkshopData.get().inventory.find((x) => x.code === c), moving);
  assert.equal(after.subgroup, 'copper', 'a drag within a group refiles the item straight away');
  assert.equal(after.itemNo, numberBefore, 'refiling must not change the number');

  await dragCard(cardFor(moving), '#stockBoard .kcol[data-group="tooling"]');
  const asked = await page.locator('.wask .waskmsg').innerText();
  assert.match(asked, /keeps its number/i, 'a cross-group move must say what happens to the number');
  await page.locator('.wask .waskyes').click();
  await page.waitForTimeout(200);
  after = await page.evaluate((c) => WorkshopData.get().inventory.find((x) => x.code === c), moving);
  assert.equal(after.group, 'tooling');
  assert.equal(after.itemNo, numberBefore);
  await page.evaluate((c) => WorkshopData.setItemGroup(c, 'materials', 'stainless-steel'), moving);
  await page.evaluate(() => refreshStoreView());
  step('Store: the overview is a board by group, and a card can be refiled by dragging it');

  await page.locator('#segList').click();
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => document.getElementById('stockBoard').hidden), true);
  assert.ok(await page.evaluate(() => document.querySelectorAll('#stockRows tr').length) > 0,
    'the list tab must show the same items as rows');
  await page.locator('#segBoard').click();
  await page.waitForTimeout(120);
  step('Store: board and list are two views of the same stock');

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

  // An invoice line for something the store has never held: create it on the
  // receipt, book it in, then pull it for a job.
  await page.evaluate(() => showView('receiving'));
  await page.locator('#receiveSupplier').fill('Nordic Steel');
  await page.locator('#receiveLocation').fill('E2E-PIPE-01');
  await page.locator('#receivePrice').fill('845');
  await page.locator('#receiveHeat').fill('E2E-H-PIPE');
  await page.locator('#receiving button:has-text("New item from this invoice")').click();
  await page.waitForTimeout(120);
  assert.equal(await page.locator('#newSupplier').inputValue(), 'Nordic Steel',
    'the create form must carry what the receipt already knows');
  assert.equal(await page.locator('#newLocation').inputValue(), 'E2E-PIPE-01');
  await page.locator('#newGroup').selectOption('materials');
  await page.locator('#newSubgroup').selectOption('pipe-fittings');
  const pipeNo = await page.locator('#newItemNo').inputValue();
  await page.locator('#newDescription').fill('Pipe DN100 SCH40');
  await page.locator('#newUnit').fill('M');
  await page.locator('#newItemModal .primary').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#receiveItem').inputValue(), pipeNo,
    'saving from a receipt must come back with the new item selected');

  await page.locator('#autoLabel').uncheck();
  await page.locator('#receiveQty').fill('24');
  await page.locator('#receiveDn').fill('E2E-INV-88231');
  await page.locator('#receivePo').fill('E2E-INV-88231');
  await page.locator('#confirmReceipt').click();
  await page.waitForTimeout(120);
  const pipe = await page.evaluate(() => WorkshopData.get().inventory.find((x) => x.description === 'Pipe DN100 SCH40'));
  assert.equal(String(pipe.itemNo), pipeNo);
  assert.equal(pipe.group, 'materials');
  assert.equal(pipe.subgroup, 'pipe-fittings');
  assert.equal(pipe.stock, 24);
  step('Store: an invoice line becomes a numbered item and is booked in on the same receipt');

  await page.evaluate(() => showView('issuing'));
  await page.waitForTimeout(80);
  const label = await page.evaluate(() => {
    const o = [...document.querySelectorAll('#issueItem option')].find((x) => x.textContent.includes('Pipe DN100'));
    return o ? o.textContent : null;
  });
  assert.ok(label && label.startsWith(pipeNo), 'the issue picker must lead with the item number');
  await page.evaluate(() => {
    const o = [...document.querySelectorAll('#issueItem option')].find((x) => x.textContent.includes('Pipe DN100'));
    document.getElementById('issueItem').value = o.value;
  });
  await page.locator('#issueQty').fill('6');
  await page.locator('#issueJobcard').fill('JC-1456');
  await page.locator('#confirmIssue').click();
  await page.waitForTimeout(150);
  const afterIssue = await page.evaluate(() => {
    const i = WorkshopData.get().inventory.find((x) => x.description === 'Pipe DN100 SCH40');
    return { stock: i.stock, issued: WorkshopData.get().movements.filter((m) => m.code === i.code && m.action === 'ISSUED') };
  });
  assert.equal(afterIssue.stock, 18, 'issuing for a job must come off the shelf');
  assert.equal(afterIssue.issued.length, 1);
  assert.equal(afterIssue.issued[0].jobcard, 'JC-1456');
  step('Store: material pulled for a job comes off the shelf against that jobcard');

  // The standards table suggests the weight, and the form shows what a count
  // of whole lengths actually amounts to before anything is saved.
  await page.evaluate(() => openNewItemForm());
  await page.locator('#newGroup').selectOption('materials');
  await page.locator('#newSubgroup').selectOption('pipe-fittings');
  await page.locator('#newWarehouse').selectOption('warehouse');
  await page.locator('#newSublocation').selectOption('wh2-rack');
  await page.locator('#newDescription').fill('Pipe DN80 SCH40');
  await page.locator('#newGrade').fill('S235JR');
  await page.locator('#newDimensions').fill('DN80 SCH40');
  await page.waitForTimeout(120);
  const suggested = Number(await page.locator('#newWeightPerBase').inputValue());
  // 3" SCH40 pipe: 88.9 mm outside, 5.49 mm wall, 11.29 kg/m in the tables.
  assert.ok(Math.abs(suggested - 11.29) / 11.29 < 0.02,
    `DN80 SCH40 in steel should suggest about 11.29 kg/m, got ${suggested}`);
  assert.equal(await page.locator('#newBaseUnit').inputValue(), 'm', 'a pipe is measured in metres');
  assert.match(await page.locator('#measureHint').innerText(), /DN80 SCH40/,
    'the form must say which standard section it matched');

  await page.locator('#newSizePerUnit').fill('6');
  await page.locator('#newStock').fill('3');
  await page.locator('#newLocation').fill('E2E-RACK-01');
  const preview = await page.locator('#measurePreview .measurecalc').innerText();
  assert.match(preview, /3 EA/);
  assert.match(preview, /18 m/, 'three 6 m lengths must read as 18 m');
  assert.match(preview, /kg/, 'and as a weight');
  await page.locator('#newItemModal .primary').click();
  await page.waitForTimeout(150);
  const dn80 = await page.evaluate(() => WorkshopData.get().inventory.find((x) => x.description === 'Pipe DN80 SCH40'));
  assert.equal(dn80.locationGroup, 'warehouse');
  assert.equal(dn80.locationSub, 'wh2-rack');
  assert.equal(dn80.sizePerUnit, 6);
  assert.equal(await page.evaluate((c) => WorkshopData.itemMeasure(c, 3).baseQty, dn80.code), 18);
  step('Store: the standards table suggests the weight and the form shows what the count amounts to');

  // Edit keeps identity; delete is refused while anything points at the item.
  await page.evaluate((c) => openEditItemForm(c), dn80.code);
  await page.waitForTimeout(120);
  assert.equal(await page.locator('#newCode').inputValue(), dn80.code);
  assert.equal(await page.locator('#newCode').getAttribute('readonly'), '',
    'the code identifies the item and is not edited here');
  await page.locator('#newMinStock').fill('2');
  await page.locator('#newItemModal .primary').click();
  await page.waitForTimeout(150);
  const edited = await page.evaluate((c) => WorkshopData.get().inventory.find((x) => x.code === c), dn80.code);
  assert.equal(edited.minStock, 2);
  assert.equal(edited.itemNo, dn80.itemNo, 'editing must not renumber the item');

  await page.evaluate((c) => removeInventoryItem(c), ITEM_CODE);
  await page.waitForTimeout(150);
  const refusal = await page.locator('.wask .waskmsg').innerText();
  assert.match(refusal, /cannot be deleted/i);
  assert.match(refusal, /Stock movements|Stock on the shelf/, 'the refusal must say where the item is used');
  await page.locator('.wask .waskyes').click();
  await page.waitForTimeout(120);
  assert.ok(await page.evaluate((c) => WorkshopData.get().inventory.some((x) => x.code === c), ITEM_CODE),
    'a refused delete must leave the item alone');
  step('Store: an item in use cannot be deleted, and the refusal names where it is used');
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
