'use strict';

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness } = require('./helpers/browser-harness');

const CUSTOMER_NAME = 'E2E Nordic Fabrication AB';
const CUSTOMER_EDITED_NAME = 'E2E Nordic Fabrication Group AB';

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

  // An Estimation must reference an existing Project (Projects owns the item list; Estimations only
  // ever prices what Projects says exists) — seed a project with one item, the way Projects' own
  // "Add item" flow would (see projects-desktop.html's projectItemJobcardPayload: a fresh item always
  // starts at plannedHours:0/estimatedMaterialCost:0, unestimated).
  const { projectNo, jobcardNo } = await page.evaluate((name) => {
    const cust = WorkshopData.getCustomers().find((c) => c.name === name);
    const project = WorkshopData.upsertProject({ name: 'E2E Guard Platform Project', customerId: cust.id, status: 'draft' });
    const jobcard = WorkshopData.upsertJobcard({ projectId: project.id, projectNo: project.no, customerId: cust.id, title: 'Cut guard rail stock', item: 'Cut guard rail stock', plannedHours: 0, estimatedMaterialCost: 0, status: 'draft' });
    return { projectNo: project.no, jobcardNo: jobcard.no };
  }, CUSTOMER_EDITED_NAME);
  step('Estimations: seeded a project with one unpriced item to estimate');

  // Opening a project directly IS pricing it now — there is no separate "New Estimation" step or
  // document identity (no EST-number, no status workflow). The project just-created via WorkshopData
  // above already appears as a row in the left list (live, no reload needed).
  await page.locator(`.estrow[data-project-no="${projectNo}"]`).click();

  let estimation = await page.evaluate((no) => WorkshopData.listEstimations().find((item) => item.projectNo === no), projectNo);
  assert.ok(estimation, 'opening the project did not create/find its pricing record');
  assert.equal(estimation.customer, CUSTOMER_EDITED_NAME);
  assert.equal(estimation.projectNo, projectNo, 'estimation must be linked to the selected project');
  const pulledItem = estimation.workItems.find((item) => item.no === jobcardNo);
  assert.ok(pulledItem && pulledItem.fromProjectItem, "the project's own item was not pulled in automatically");
  step('Estimations: opening a project auto-creates/finds its pricing record, populated from its items');

  await page.evaluate(() => openEditEst(selectedId));
  await page.locator('#eeOppRef').fill('E2E-OPP-39');
  await page.locator('#eeRfq').fill('E2E-RFQ-0039');
  await page.locator('#eeDelivery').fill('4 weeks');
  await page.locator('#eeTerms').fill('45 days');
  await saveModal(page);
  estimation = await page.evaluate((no) => WorkshopData.listEstimations().find((item) => item.projectNo === no), projectNo);
  assert.equal(estimation.opportunityRef, 'E2E-OPP-39');
  assert.equal(estimation.customerRfq, 'E2E-RFQ-0039');
  assert.equal(estimation.deliveryTime, '4 weeks');
  step('Estimations: commercial edit persists');

  // Price the project's own item: a labour line (drives plannedHours) plus setting the crew size.
  // Manually adding a brand-new work item stays possible too (contingency/delivery-style extras),
  // and must never feed into the project's crew-size average.
  const pulledIndex = await page.evaluate((no) => getEst(selectedId).workItems.findIndex((item) => item.no === no), jobcardNo);
  assert.ok(pulledIndex >= 0);
  await page.evaluate((index) => openAddLine(selectedId, index), pulledIndex);
  await page.locator('#aiDesc').fill('Guard rail cutting labour');
  await page.locator('#aiCat').selectOption('labour');
  await page.locator('#aiQty').fill('4');
  await page.locator('#aiUnit').fill('h');
  await page.locator('#aiSell').fill('500');
  await page.locator('#aiCost').fill('300');
  await saveModal(page);
  await page.evaluate((index) => setWorkItemPeople(selectedId, index, '3'), pulledIndex);

  estimation = await page.evaluate((no) => WorkshopData.listEstimations().find((item) => item.projectNo === no), projectNo);
  const pricedItem = estimation.workItems.find((item) => item.no === jobcardNo);
  assert.ok(pricedItem && pricedItem.lines.some((line) => line.desc === 'Guard rail cutting labour' && line.qty === 4));
  assert.equal(pricedItem.peopleRequired, 3);
  assert.ok(estimation.sellingPrice > 0, 'cost line did not update the shared estimation total');
  step('Estimations: pricing and crew size on the project\'s own item persist');

  const jobcardAfterPricing = await page.evaluate((no) => WorkshopData.listJobcards().find((item) => item.no === no), jobcardNo);
  assert.equal(jobcardAfterPricing.plannedHours, 4, 'labour hours were not pushed onto the shared Jobcard');
  assert.equal(jobcardAfterPricing.requiredWorkers, 3, 'crew size was not pushed onto the shared Jobcard');
  const projectAfterPricing = await page.evaluate((no) => WorkshopData.findProject(no), projectNo);
  assert.ok(projectAfterPricing.quotedValue > 0, 'quoted value was not pushed onto the shared Project');
  assert.equal(projectAfterPricing.requiredManpower, 3, 'required manpower was not pushed onto the shared Project');
  step('Estimations → Projects: pricing, hours and crew size flow back automatically');

  // Locking an item freezes its price (lines + crew size) against further edits in Estimations, but
  // must not stop the automatic desc sync from Projects — proven by the very next block, which
  // renames this same item while it stays locked.
  await page.evaluate((index) => toggleWorkItemLock(selectedId, index), pulledIndex);
  let lockedItem = await page.evaluate((no) => getEst(selectedId).workItems.find((item) => item.no === no), jobcardNo);
  assert.equal(lockedItem.locked, true, 'lock toggle did not mark the item locked');
  await page.evaluate((index) => openAddLine(selectedId, index), pulledIndex);
  const modalOpenWhileLocked = await page.evaluate(() => document.getElementById('fov').classList.contains('show'));
  assert.equal(modalOpenWhileLocked, false, 'a locked item must refuse to open the add-line form');
  await page.evaluate((index) => setWorkItemPeople(selectedId, index, '9'), pulledIndex);
  lockedItem = await page.evaluate((no) => getEst(selectedId).workItems.find((item) => item.no === no), jobcardNo);
  assert.equal(lockedItem.peopleRequired, 3, 'a locked item must ignore an attempt to change its crew size');
  step('Estimations: locking an item freezes its price against further edits');

  // Renaming the item in Projects (simulated directly here) must be picked up automatically the next
  // time this page renders — no manual "sync" action of any kind — even while the item stays locked.
  await page.evaluate((no) => { WorkshopData.updateJobcard(no, { title: 'Cut guard rail stock — revised', item: 'Cut guard rail stock — revised' }); renderAll(); }, jobcardNo);
  const renamedItem = await page.evaluate((no) => getEst(selectedId).workItems.find((item) => item.no === no), jobcardNo);
  assert.equal(renamedItem.desc, 'Cut guard rail stock — revised', "the project's rename was not reconciled automatically");
  assert.equal(renamedItem.peopleRequired, 3, 'reconciling a rename must not lose already-entered pricing/crew size');
  assert.equal(renamedItem.locked, true, 'reconciling a rename must not silently unlock a locked item');
  step('Projects → Estimations: a renamed item updates here automatically, staying locked');

  await page.evaluate(() => openAddWorkItem(selectedId));
  await page.locator('#awNo').fill('E2E-WI-01');
  await page.locator('#awDesc').fill('Contingency');
  await saveModal(page);
  const manualIndex = await page.evaluate(() => getEst(selectedId).workItems.findIndex((item) => item.no === 'E2E-WI-01'));
  assert.ok(manualIndex >= 0, 'manually-added work item was not added');
  const manualItem = await page.evaluate((index) => getEst(selectedId).workItems[index], manualIndex);
  assert.ok(!manualItem.fromProjectItem, 'a manually-added work item must not be treated as a project item');
  const manpowerAfterManual = await page.evaluate((no) => WorkshopData.findProject(no).requiredManpower, projectNo);
  assert.equal(manpowerAfterManual, 3, 'a manually-added work item must not skew the crew-size average');
  step('Estimations: a manually-added work item stays independent of the project item list');

  await page.reload({ waitUntil: 'load' });
  const restored = await page.evaluate((no) => {
    const shared = WorkshopData.listEstimations().find((item) => item.projectNo === no);
    if (shared) { selectedId = shared.id; renderAll(); }
    return shared;
  }, projectNo);
  assert.ok(restored, 'project pricing record is missing from shared data after reload');
  assert.ok((await page.locator('body').innerText()).includes(projectNo), 'project pricing view disappeared after reload');
  step('Estimations: project pricing record survives reload');
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
