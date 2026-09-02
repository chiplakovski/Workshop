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

  await page.locator('button[onclick="openNewEst()"]').first().click();
  await page.locator('#neCustomer').selectOption({ label: CUSTOMER_EDITED_NAME });
  await page.locator('#neTitle').fill(ESTIMATION_TITLE);
  await page.locator('#neOppRef').fill('E2E-OPP-39');
  await page.locator('#neTemplate').selectOption('blank');
  await saveModal(page);

  let estimation = await page.evaluate((title) => WorkshopData.listEstimations().find((item) => item.title === title), ESTIMATION_TITLE);
  assert.ok(estimation, 'new estimation was not persisted');
  assert.equal(estimation.customer, CUSTOMER_EDITED_NAME);
  assert.equal(estimation.status, 'draft');
  step('Estimations: create persists a shared draft');

  await page.evaluate(() => openEditEst(selectedId));
  await page.locator('#eeRfq').fill('E2E-RFQ-0039');
  await page.locator('#eeDelivery').fill('4 weeks');
  await page.locator('#eeTerms').fill('45 days');
  await saveModal(page);
  estimation = await page.evaluate((title) => WorkshopData.listEstimations().find((item) => item.title === title), ESTIMATION_TITLE);
  assert.equal(estimation.customerRfq, 'E2E-RFQ-0039');
  assert.equal(estimation.deliveryTime, '4 weeks');
  step('Estimations: commercial edit persists');

  await page.evaluate(() => openAddWorkItem(selectedId));
  await page.locator('#awNo').fill('E2E-WI-01');
  await page.locator('#awDesc').fill('Guard platform fabrication');
  await saveModal(page);
  const workItemIndex = await page.evaluate(() => getEst(selectedId).workItems.findIndex((item) => item.no === 'E2E-WI-01'));
  assert.ok(workItemIndex >= 0, 'work item was not added');

  await page.evaluate((index) => openAddLine(selectedId, index), workItemIndex);
  await page.locator('#aiDesc').fill('Stainless guard rail');
  await page.locator('#aiCat').selectOption('material');
  await page.locator('#aiQty').fill('2');
  await page.locator('#aiUnit').fill('pcs');
  await page.locator('#aiSell').fill('1500');
  await page.locator('#aiCost').fill('900');
  await page.locator('#aiWaste').fill('5');
  await saveModal(page);
  estimation = await page.evaluate((title) => WorkshopData.listEstimations().find((item) => item.title === title), ESTIMATION_TITLE);
  const workItem = estimation.workItems.find((item) => item.no === 'E2E-WI-01');
  assert.ok(workItem && workItem.lines.some((line) => line.desc === 'Stainless guard rail' && line.qty === 2));
  assert.ok(estimation.sellingPrice > 0, 'cost line did not update the shared estimation total');
  step('Estimations: work item and priced line persist');

  const beforeDuplicate = await page.evaluate(() => WorkshopData.listEstimations().map((item) => item.id));
  await page.evaluate(() => duplicateEst(selectedId));
  const duplicated = await page.evaluate((ids) => WorkshopData.listEstimations().find((item) => !ids.includes(item.id)), beforeDuplicate);
  assert.ok(duplicated, 'duplicate estimation was not created');
  assert.notEqual(duplicated.no, estimation.no);
  step('Estimations: duplicate creates an independent shared record');

  page.once('dialog', (dialog) => dialog.accept());
  await page.evaluate(() => deleteEst(selectedId));
  const duplicateStillExists = await page.evaluate((id) => WorkshopData.listEstimations().some((item) => item.id === id), duplicated.id);
  assert.equal(duplicateStillExists, false, 'deleted duplicate remained in shared data');
  step('Estimations: delete removes the unlinked duplicate from shared data');

  await page.reload({ waitUntil: 'load' });
  const restored = await page.evaluate((title) => {
    const shared = WorkshopData.listEstimations().find((item) => item.title === title);
    const local = shared && ESTIMATIONS.find((item) => item.sharedId === shared.id);
    if (local) { selectedId = local.id; renderAll(); }
    return shared;
  }, ESTIMATION_TITLE);
  assert.ok(restored, 'original estimation is missing from shared data after reload');
  assert.ok((await page.locator('body').innerText()).includes(ESTIMATION_TITLE), 'estimation disappeared after reload');
  step('Estimations: original record survives reload');
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
