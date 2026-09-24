'use strict';

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness, loadDemoData } = require('./helpers/browser-harness');

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

// A supplier entered with the four fields the form asks for, and nothing else about them known.
//
// This page used to fill the rest in. Not as placeholders — as the record: an address on Industrial
// Road in Malmö, a VAT number of SE556700000001, a telephone number, an order-desk contact, two
// documents called "Supplier agreement.pdf" and "Current price list.xlsx", a note saying an annual
// supplier review had been completed, a performance panel scoring them 4.3 out of 5 on four invented
// percentages, four stars beside their name in the list, and three activity rows about a delivery
// against DEL-0038. Every one of them was a statement about somebody else's company that nobody had
// made, printed in the same type as the name.
//
// So this check reads the whole screen and asserts none of it is there. It is written as a list of
// strings rather than a structural check on purpose: the failure was not a broken panel, it was
// plausible content, and the only thing that distinguishes plausible content from a record is knowing
// what was never entered.
async function nothingIsInventedAboutASupplier(page) {
  await page.locator('#listSearch').fill(SUPPLIER);
  const found = await page.evaluate((name) => {
    const at = suppliers.findIndex((s) => s.name === name);
    if (at < 0) return false;
    selectSupplier(at);
    return true;
  }, SUPPLIER);
  assert.ok(found, `${SUPPLIER} should be in the list to be looked at`);
  const shown = await page.locator('#mainContent').innerText();

  const invented = [
    'Industrial Road', 'SE556700000001', '+46 40 555 01 20',
    'Order Desk', 'Supplier agreement.pdf', 'Current price list.xlsx',
    'Annual supplier review', '4.3 / 5', 'DEL-0038', '1.2 days', '★'
  ].filter((text) => shown.includes(text));
  assert.deepEqual(invented, [],
    `the supplier screen states these about a supplier nobody entered them for: ${invented.join(', ')}`);

  // And the three metric cards that need records this system does not keep say which records, rather
  // than printing a percentage. "88%" under "On-time delivery" is a judgement about a real merchant.
  const metrics = await page.locator('#metrics').innerText();
  assert.match(metrics, /not kept yet/, `the metrics that cannot be answered must say so: ${metrics}`);
  assert.equal(/\d+%/.test(metrics), false, `a percentage reached the metrics: ${metrics}`);
  const performance = await page.locator('#performance').innerText();
  assert.match(performance, /does not keep yet/, performance);
  assert.match(performance, /not saying the supplier scores nothing/,
    'and say plainly that it is not scoring them zero');

  // What it does know, it shows: the four fields that were actually typed in.
  assert.ok(shown.includes(SUPPLIER) && shown.includes('Stainless steel') && shown.includes('Sweden'),
    'what somebody did enter has to be on the screen');
  assert.ok(shown.includes('—'), 'and what they did not is a dash');
  step('Suppliers: nothing is stated about a supplier that nobody entered — and the blanks read as blank');
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

  // The drop target is measured AFTER the drag has begun, never before. The page's heading font
  // arrives over the network, and when it swaps in the toolbar buttons change width enough to
  // wrap the top bar onto a second row and move the whole board down the page. Aiming at where
  // a lane was a moment ago then lands a lane out — which read for a long time as a flaky drag
  // and was really a font arriving late. A person aims at where the lane is now; so does this.
  const dragCard = async (fromSel, toSel) => {
    const a = await page.locator(fromSel).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + 12);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 20, a.y + 20, { steps: 4 });
    const b = await page.locator(toSel).boundingBox();
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

  // The information panel answers "where is it, where did it come from, where did it go" from the
  // movements themselves — the same question the issue above just wrote an answer to.
  const infoCode = await page.evaluate(() => WorkshopData.get().movements.find((m) => m.action === 'ISSUED').code);
  await page.evaluate((c) => openItemInfo(c), infoCode);
  await page.locator('#infoModal.show').waitFor();
  await page.waitForTimeout(120);
  const panel = (await page.locator('#infoBody').innerText()).replace(/\s+/g, ' ');
  const item = await page.evaluate((c) => WorkshopData.itemHistory(c), infoCode);
  assert.ok(panel.includes(item.where.bin), `the bin it sits in must be on the panel: ${panel.slice(0, 160)}`);
  assert.ok(panel.includes(item.where.warehouse), 'and the warehouse, by name rather than by id');
  assert.ok(item.issued.length > 0, 'the issue above must be in the history');
  assert.ok(panel.includes(item.issued[0].projectNo), 'the job it went to is named');
  assert.ok(panel.includes(String(item.issued[0].qty)), 'with how much went');
  assert.ok(item.received.length === 0 || panel.includes(item.received[0].from),
    'and where it came from, when anything was ever booked in');
  step('Store: the information panel answers where an item is, came from and went');

  // An item with no past says so, rather than showing blank dates and empty places.
  const quiet = await page.evaluate(() => WorkshopData.createInventoryItem({ description: 'No history yet',
    group: 'materials', subgroup: 'mild-steel', unit: 'EA', location: 'ZZ-01' }).code);
  await page.evaluate((c) => openItemInfo(c), quiet);
  await page.waitForTimeout(120);
  const empty = (await page.locator('#infoBody').innerText()).replace(/\s+/g, ' ');
  assert.match(empty, /never been issued|aldrig tagits ut|никогаш не е издаден/i);
  assert.match(empty, /Nothing has ever been booked in|Inget har någonsin bokats in|Ништо никогаш не е примено/i);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(empty.split('Where it went')[0].replace(/ZZ-01/g, '')),
    `no date may be shown for an item nothing has happened to: ${empty.slice(0, 200)}`);
  await page.evaluate(() => closeItemInfo());
  step('Store: an item with no past says so rather than showing blanks');

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

  // The catalogue fills a whole item rather than having it typed out.
  await page.evaluate(() => openNewItemForm());
  await page.waitForTimeout(120);
  const families = await page.evaluate(() => [...document.querySelectorAll('#catFamily option')].map((o) => o.value).filter(Boolean));
  ['plate', 'pipe', 'valve', 'welding', 'abrasive', 'gas', 'fastener'].forEach((f) =>
    assert.ok(families.includes(f), `the catalogue must offer ${f}`));

  await page.locator('#catFamily').selectOption('plate');
  await page.locator('#catSearch').fill('5 mm s235 1500x3000');
  await page.waitForTimeout(150);
  assert.match(await page.locator('#catProduct option').first().innerText(), /^Plate 5 mm/,
    'a size typed with x must find the plate written with ×');
  await page.locator('.catpick .btn').click();
  await page.waitForTimeout(150);
  const filled = await page.evaluate(() => ({
    group: document.getElementById('newGroup').value,
    sub: document.getElementById('newSubgroup').value,
    desc: document.getElementById('newDescription').value,
    base: document.getElementById('newBaseUnit').value,
    size: Number(document.getElementById('newSizePerUnit').value),
    kg: Number(document.getElementById('newWeightPerBase').value)
  }));
  assert.equal(filled.group, 'materials');
  assert.equal(filled.sub, 'mild-steel', 'a steel plate is filed under mild steel, not the family default');
  assert.match(filled.desc, /Plate 5 mm/);
  assert.equal(filled.base, 'm2');
  assert.equal(filled.size, 4.5, 'a 1500×3000 sheet is 4.5 m²');
  assert.ok(Math.abs(filled.kg - 39.25) < 0.5, 'and 5 mm steel is 39.25 kg per m²');

  // A valve carries a maker-dependent weight, and says so.
  await page.locator('#catFamily').selectOption('valve');
  await page.locator('#catSearch').fill('ball dn50 pn16');
  await page.waitForTimeout(150);
  assert.match(await page.locator('#catHint').innerText(), /indicative/i,
    'a manufactured weight must be flagged as indicative');

  // A gas bottle is measured in cubic metres, which the form must offer.
  await page.locator('#catFamily').selectOption('gas');
  await page.locator('#catSearch').fill('argon 50');
  await page.waitForTimeout(150);
  await page.locator('.catpick .btn').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#newBaseUnit').inputValue(), 'm3');
  await page.locator('#newLocation').fill('E2E-GAS-01');
  await page.locator('#newStock').fill('2');
  await page.waitForTimeout(120);
  assert.match(await page.locator('#measurePreview .measurecalc').innerText(), /20 m³/,
    'two 50 l bottles are about 20 m³ of gas');
  await page.locator('#newItemModal .actions .primary').click();
  await page.waitForTimeout(150);
  const gas = await page.evaluate(() => WorkshopData.get().inventory.find((x) => /Argon/.test(x.description)));
  assert.equal(gas.group, 'consumables');
  assert.equal(gas.subgroup, 'gases');
  assert.equal(gas.baseUnit, 'm3');
  assert.ok(gas.itemNo >= 2000 && gas.itemNo < 3000, 'and it takes a consumables number');
  step('Store: the catalogue fills an item whole, from plate to gas bottle');

  // The shell is fixed: the window never scrolls, the sidebar stands full
  // height, and the user badge stays at its foot while the nav scrolls.
  const shell = await page.evaluate(() => {
    const user = document.querySelector('.user').getBoundingClientRect();
    const main = document.querySelector('.main');
    const scroller = document.querySelector('.sidescroll');
    scroller.scrollTop = 9999;
    return {
      windowScrolls: document.documentElement.scrollHeight - window.innerHeight,
      sidebarFixed: getComputedStyle(document.querySelector('.sidebar')).position === 'fixed',
      mainScrollable: getComputedStyle(main).overflowY === 'auto',
      userAtFoot: window.innerHeight - user.bottom,
      userAfterNavScroll: Math.round(document.querySelector('.user').getBoundingClientRect().bottom)
    };
  });
  assert.ok(shell.windowScrolls <= 2, 'the window itself must not scroll');
  assert.ok(shell.sidebarFixed, 'the sidebar must stand fixed');
  assert.ok(shell.mainScrollable, 'the page body is what scrolls');
  assert.ok(shell.userAtFoot >= 0 && shell.userAtFoot < 30, 'the user badge sits at the foot of the sidebar');
  assert.equal(shell.userAfterNavScroll, Math.round(await page.evaluate(() => document.querySelector('.user').getBoundingClientRect().bottom)),
    'and stays there while the nav scrolls under it');

  const type = await page.evaluate(() => ({
    navgroup: getComputedStyle(document.querySelector('.navgroup')),
    phead: getComputedStyle(document.querySelector('.phead h3'))
  })).then(() => page.evaluate(() => ({
    navgroupSize: parseFloat(getComputedStyle(document.querySelector('.navgroup')).fontSize),
    navgroupWeight: Number(getComputedStyle(document.querySelector('.navgroup')).fontWeight),
    pheadSize: parseFloat(getComputedStyle(document.querySelector('.phead h3')).fontSize),
    pheadWeight: Number(getComputedStyle(document.querySelector('.phead h3')).fontWeight)
  })));
  assert.ok(type.navgroupSize >= 11 && type.navgroupWeight >= 700, 'the nav group labels are set bigger and bold');
  assert.ok(type.pheadSize >= 17 && type.pheadWeight >= 800, 'and so are the panel headings');
  step('Store: the shell is fixed, with the user badge at the foot and the headings set bolder');
}

async function main() {
  const harness = await startBrowserHarness();
  const page = await harness.context.newPage();
  const monitor = monitorPage(page, harness.baseUrl);
  try {
    await page.goto(`${harness.baseUrl}/suppliers-desktop.html`, { waitUntil: 'load' });
    await loadDemoData(page);
    await createSupplier(page);
    await nothingIsInventedAboutASupplier(page);
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
