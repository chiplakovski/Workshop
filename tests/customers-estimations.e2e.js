'use strict';

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness } = require('./helpers/browser-harness');

const CUSTOMER_NAME = 'E2E Nordic Fabrication AB';
const CUSTOMER_EDITED_NAME = 'E2E Nordic Fabrication Group AB';
const ESTIMATION_TITLE = 'E2E Guard Platform Fabrication';

async function saveModal(page) {
  await page.locator('#fcard .fbtns .primary').click();
  await page.waitForTimeout(60);
}

function step(message) {
  console.log(`OK   ${message}`);
}

async function customerWorkflow(page) {
  await page.locator('button[onclick="openNewCustomer()"]').first().click();
  await page.locator('#ncName').fill(CUSTOMER_NAME);
  await page.locator('#ncCity').fill('Malmö');
  await page.locator('#ncOrg').fill('559999-1234');
  await page.locator('#ncEmail').fill('e2e-customer@example.test');
  await page.locator('#ncPhone').fill('+46 40 555 0101');
  await page.locator('#ncCredit').fill('250000');
  await page.locator('#ncBilling').fill('E2E Nordic Fabrication AB\nTestgatan 12\n211 00 Malmö');
  await saveModal(page);

  let customer = await page.evaluate((name) => WorkshopData.getCustomers().find((item) => item.name === name), CUSTOMER_NAME);
  assert.ok(customer, 'new customer was not persisted');
  assert.equal(customer.city, 'Malmö');
  assert.equal(customer.credit, 250000);
  assert.ok((await page.locator('body').innerText()).includes(CUSTOMER_NAME), 'new customer is not visible in Customers');
  step('Customers: create persists and renders');

  await page.evaluate(() => openEditCustomer(selectedId));
  await page.locator('#ecName').fill(CUSTOMER_EDITED_NAME);
  await page.locator('#ecCity').fill('Lund');
  await page.locator('#ecTerms').fill('45 days');
  await saveModal(page);
  customer = await page.evaluate((name) => WorkshopData.getCustomers().find((item) => item.name === name), CUSTOMER_EDITED_NAME);
  assert.ok(customer, 'edited customer name was not persisted');
  assert.equal(customer.city, 'Lund');
  assert.equal(customer.terms, '45 days');
  step('Customers: edit updates the same shared record');

  await page.evaluate(() => openAddContact(selectedId));
  await page.locator('#acName').fill('E2E Contact');
  await page.locator('#acRole').fill('Purchasing Manager');
  await page.locator('#acEmail').fill('contact@example.test');
  await page.locator('#acPrimary').check();
  await saveModal(page);

  await page.evaluate(() => openAddNote(selectedId));
  await page.locator('#anText').fill('E2E customer note persisted from the browser workflow.');
  await saveModal(page);
  customer = await page.evaluate((name) => WorkshopData.getCustomers().find((item) => item.name === name), CUSTOMER_EDITED_NAME);
  assert.ok(customer.contacts.some((contact) => contact.name === 'E2E Contact' && contact.primary));
  assert.ok(customer.notes.some((note) => note.text.includes('E2E customer note')));
  step('Customers: contact and note persist');

  await page.evaluate(() => openNewQuote(selectedId));
  await page.locator('#nqDesc').fill('E2E cross-module quote');
  await page.locator('#nqValue').fill('12500');
  await saveModal(page);
  const quote = await page.evaluate((name) => WorkshopData.listEstimations().find((item) => item.customer === name && item.title === 'E2E cross-module quote'), CUSTOMER_EDITED_NAME);
  assert.ok(quote, 'customer quote did not create a shared estimation');
  assert.equal(quote.status, 'sent');
  assert.equal(quote.sellingPrice, 12500);
  step('Customers → Estimations: quote creates a shared estimation');

  await page.evaluate(() => openNewInvoice(selectedId));
  await page.locator('#niValue').fill('9875.50');
  await page.locator('#niStatus').selectOption('pending');
  await page.locator('#niReference').fill('E2E-INV-REF');
  await saveModal(page);
  const invoice = await page.evaluate((name) => WorkshopData.listInvoices().find((item) => item.customer === name && item.reference === 'E2E-INV-REF'), CUSTOMER_EDITED_NAME);
  assert.ok(invoice, 'customer invoice was not persisted');
  assert.equal(invoice.value, 9875.5);
  step('Customers → Invoices: invoice creates a shared commercial record');

  await page.reload({ waitUntil: 'load' });
  await page.locator('#search').fill(CUSTOMER_EDITED_NAME);
  await page.waitForTimeout(60);
  assert.ok((await page.locator('body').innerText()).includes(CUSTOMER_EDITED_NAME), 'customer disappeared after reload');
  step('Customers: persisted record survives reload');
}

async function estimationWorkflow(page) {
  const quoteVisible = await page.evaluate((name) => WorkshopData.listEstimations().some((item) => item.customer === name && item.title === 'E2E cross-module quote'), CUSTOMER_EDITED_NAME);
  assert.equal(quoteVisible, true, 'quote created in Customers is not visible to Estimations data');
  step('Estimations: sees the quote created by Customers');

  // The module is project-first: every card is a project, and picking one is how you start pricing.
  const rowCount = await page.locator('.kcard').count();
  assert.ok(rowCount > 0, 'the project board is empty');
  const listedProject = await page.locator('.kcard').first().getAttribute('data-project-no');
  assert.ok(listedProject, 'a card must name the project it prices');
  await page.locator('.kcard').first().click();
  const selected = await page.evaluate(() => { const e = getEst(selectedId); return { project: e.projectNo, ref: estRef(e) }; });
  assert.equal(selected.project, listedProject, 'clicking a project must select that project');
  assert.equal(selected.ref, listedProject, "the estimate's reference is the project's own number");
  step('Estimations: the board is projects, and picking one selects its estimate');

  // A card's column IS its status, and every project is on the board somewhere.
  const board = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.kcard')];
    const active = ESTIMATIONS.filter((e) => !e.archived && e.projectNo && PROJECTS[e.projectNo]);
    const misplaced = cards.filter((c) => {
      const e = getEst(Number(c.dataset.estId));
      const col = c.closest('.kcol').dataset.stage;
      return !KCOLS.find((k) => k.k === col).has.includes(e.status);
    }).map((c) => c.dataset.projectNo);
    return { cards: cards.length, active: active.length, misplaced,
      lanes: [...document.querySelectorAll('.kcol')].map((c) => c.dataset.stage) };
  });
  assert.equal(board.cards, board.active, 'every project must be on the board, none dropped');
  assert.deepEqual(board.misplaced, [], 'a card must sit in the column its status names');
  assert.deepEqual(board.lanes, ['draft', 'review', 'sent', 'accepted', 'declined'], 'the board covers every stage');
  step('Estimations: the board shows every project in the lane its status names');

  // Dragging a card is the stepper by another name: it obeys the same transition rules.
  const moved = await page.evaluate(async () => {
    const before = ESTIMATIONS.find((e) => e.status === 'accepted' && e.projectNo);
    const drop = (id, stage) => {
      const card = document.querySelector(`.kcard[data-est-id="${id}"]`);
      const col = document.querySelector(`.kcol[data-stage="${stage}"]`);
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      col.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
      col.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    };
    drop(before.id, 'draft');
    return getEst(before.id).status;
  });
  assert.equal(moved, 'accepted', 'a closed stage must refuse a drop, exactly as the stepper does');
  step('Estimations: the board refuses a move the transition rules forbid');

  // The offer is the whole project as one customer-facing document, produced from the top bar.
  const offer = await page.evaluate(() => {
    const e = getEst(selectedId);
    window.print = () => { window.__printed = (window.__printed || 0) + 1; };
    printOffer(e.id);
    const sheet = document.getElementById('printSheet');
    const base = baseAndIncludedLines(e).filter((l) => !l.fromOption);
    return {
      ref: document.querySelector('.offerbar .offerref').textContent.trim(),
      off: document.querySelector('.offerbar').classList.contains('off'),
      dialogs: window.__printed,
      missing: base.filter((l) => !sheet.textContent.includes(l.desc)).map((l) => l.desc),
      carriesTotal: sheet.textContent.includes(computeTotals(e).grandTotal.toFixed(2)),
      leaksInternal: /overhead|contingency|margin/i.test(sheet.textContent),
      deadOpenProject: [...document.querySelectorAll('.dbtns .tbtn')].some((b) => /Open Project|Convert to Project/.test(b.textContent)),
    };
  });
  assert.equal(offer.off, false, 'a selected project must have its offer actions live');
  assert.equal(offer.ref, listedProject, 'the offer bar must name the project it produces');
  assert.equal(offer.dialogs, 1, 'Print must open the print dialog exactly once');
  assert.deepEqual(offer.missing, [], 'the offer must carry every priced line of the project');
  assert.equal(offer.carriesTotal, true, 'the offer must carry the grand total');
  assert.equal(offer.leaksInternal, false, 'a customer-facing offer must not print internal cost or margin');
  assert.equal(offer.deadOpenProject, false, 'Open Project led back to this same page and is gone');
  step('Estimations: the top bar produces the whole project as one offer');

  // The items being priced are the project's items - not a second list kept here.
  const items = await page.evaluate(() => {
    const e = getEst(selectedId);
    return { estimate: e.workItems.map((w) => w.no), project: projectItems(e.projectNo).map((i) => i.no) };
  });
  assert.deepEqual(items.estimate, items.project, "the estimate must price exactly the project's items, in the project's order");
  assert.ok(items.project.length > 0, 'the selected project has no items to price');
  step('Estimations: work items are the project items themselves');

  // References are read off the project: <project no>-<item position>.
  const refs = await page.evaluate(() => Array.from(document.querySelectorAll('.itemref')).map((x) => x.textContent));
  assert.equal(refs[0], `${listedProject}-01`);
  if (refs.length > 1) assert.equal(refs[1], `${listedProject}-02`);
  step('Estimations: item references are numbered from the project');

  await page.evaluate(() => openEditEst(selectedId));
  await page.locator('#eeRfq').fill('E2E-RFQ-0039');
  await page.locator('#eeDelivery').fill('4 weeks');
  await page.locator('#eeTerms').fill('45 days');
  await saveModal(page);
  let estimation = await page.evaluate(() => WorkshopData.listEstimations().find((item) => item.id === getEst(selectedId).sharedId));
  assert.equal(estimation.customerRfq, 'E2E-RFQ-0039');
  assert.equal(estimation.deliveryTime, '4 weeks');
  step('Estimations: commercial edit persists');

  // Pricing is what this module owns: a line lands on a real project item.
  await page.evaluate(() => openAddLine(selectedId, 0));
  await page.locator('#aiDesc').fill('Stainless guard rail');
  await page.locator('#aiCat').selectOption('material');
  await page.locator('#aiQty').fill('2');
  await page.locator('#aiUnit').fill('pcs');
  await page.locator('#aiSell').fill('1500');
  await page.locator('#aiCost').fill('900');
  await page.locator('#aiWaste').fill('5');
  await saveModal(page);
  estimation = await page.evaluate(() => WorkshopData.listEstimations().find((item) => item.id === getEst(selectedId).sharedId));
  const pricedItem = estimation.workItems.find((item) => item.no === items.project[0]);
  assert.ok(pricedItem && pricedItem.lines.some((line) => line.desc === 'Stainless guard rail' && line.qty === 2),
    'the priced line must be stored against the project item it was added to');
  assert.ok(estimation.sellingPrice > 0, 'cost line did not update the shared estimation total');
  step('Estimations: a priced line attaches to a real project item');

  // The estimate is the project's price, so the project must carry the same figure.
  const rolled = await page.evaluate(() => {
    const e = getEst(selectedId);
    const p = WorkshopData.getProjects().find((x) => x.no === e.projectNo);
    return { quoted: p.quotedValue, net: computeTotals(e).netSellingPrice, customer: p.customer };
  });
  assert.equal(rolled.quoted, rolled.net, "the project's quoted value must follow the estimate");
  assert.ok(rolled.customer, 'writing the price back must not blank the project customer');
  step('Estimations: totals roll back onto the project');

  // An item removed from the project stops being priced, but its pricing is reported, not lost.
  const retired = await page.evaluate(() => {
    const e = getEst(selectedId);
    const first = projectItems(e.projectNo)[0];
    const jc = WorkshopData.listJobcards().find((j) => j.no === first.no);
    WorkshopData.upsertJobcard(Object.assign({}, jc, { archived: true }));
    syncWorkItemsToProject(e);
    return { priced: e.workItems.map((w) => w.no), retired: (e.retiredWorkItems || []).map((w) => w.no) };
  });
  assert.equal(retired.priced.includes(items.project[0]), false, 'an archived item must stop being priced');
  assert.ok(retired.retired.includes(items.project[0]), 'its pricing must be retired and reported, never silently dropped');
  step('Estimations: pricing for a removed item is retired, not lost');

  await page.reload({ waitUntil: 'load' });
  const restored = await page.evaluate((no) => {
    const local = ESTIMATIONS.find((item) => item.projectNo === no);
    if (local) { selectedId = local.id; renderAll(); }
    return local ? { ref: estRef(local), rfq: local.customerRfq } : null;
  }, listedProject);
  assert.ok(restored, 'the project estimate is missing after reload');
  assert.equal(restored.ref, listedProject, 'the project reference must survive a reload');
  assert.equal(restored.rfq, 'E2E-RFQ-0039', 'the commercial edit must survive a reload');
  step('Estimations: the project estimate survives reload');
}

async function main() {
  const harness = await startBrowserHarness();
  const page = await harness.context.newPage();
  const monitor = monitorPage(page, harness.baseUrl);
  try {
    await page.goto(`${harness.baseUrl}/customers-desktop.html`, { waitUntil: 'load' });
    await customerWorkflow(page);
    await page.goto(`${harness.baseUrl}/estimations-desktop.html`, { waitUntil: 'load' });
    await estimationWorkflow(page);
    monitor.assertClean();
    console.log('\nCustomers/Estimations browser E2E passed.');
  } finally {
    await page.close();
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
