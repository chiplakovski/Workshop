'use strict';

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness } = require('./helpers/browser-harness');

const COMPANY = 'E2E Skane Process Systems AB';
const CONTACT = 'Elin Andersson';
const SERVICE = 'E2E stainless process platform';
const OPPORTUNITY_VALUE = 285000;

function step(message) {
  console.log(`OK   ${message}`);
}

async function saveMarketingModal(page) {
  await page.locator('#fcard .fbtns .primary').click();
  await page.waitForTimeout(70);
}

async function createAndQualifyLead(page) {
  await page.evaluate(() => openLeadForm());
  await page.locator('#lfCompany').fill(COMPANY);
  await page.locator('#lfContact').fill(CONTACT);
  await page.locator('#lfEmail').fill('elin@e2e-skane.example');
  await page.locator('#lfPhone').fill('+46 40 555 4433');
  await page.locator('#lfCity').fill('Malmo');
  await page.locator('#lfCountry').fill('Sweden');
  await page.locator('#lfIndustry').fill('Food-production equipment');
  await page.locator('#lfSize').fill('20-50');
  await page.locator('#lfSource').selectOption('referral');
  await page.locator('#lfService').fill(SERVICE);
  await page.locator('#lfValue').fill(String(OPPORTUNITY_VALUE));
  await page.locator('#lfPriority').selectOption('high');
  await page.locator('#lfOwner').selectOption('Aleksandar C.');
  await page.locator('#lfFollowup').fill('2026-09-18');
  await saveMarketingModal(page);

  let state = await page.evaluate((company) => ({
    shared: WorkshopData.getMarketingLeads().filter((lead) => lead.company === company),
    rendered: LEADS.filter((lead) => lead.company === company)
  }), COMPANY);
  assert.equal(state.shared.length, 1);
  assert.equal(state.rendered.length, 1, 'new lead was duplicated in the page-local list');
  const leadId = state.shared[0].id;
  step('Marketing: lead creation persists once without a duplicate rendered row');

  await page.evaluate((id) => openQualifyLead(id), leadId);
  await page.locator('#qualNote').fill('Budget, decision maker, scope and delivery window confirmed.');
  await saveMarketingModal(page);

  state = await page.evaluate((id) => {
    const lead = WorkshopData.findMarketingLead(id);
    const opportunity = WorkshopData.findMarketingOpportunity(lead.linkedOpportunityId);
    return { lead, opportunity, renderedCount: OPPORTUNITIES.filter((entry) => entry.leadId === id).length };
  }, leadId);
  assert.equal(state.lead.status, 'qualified');
  assert.ok(state.lead.linkedOpportunityId);
  assert.ok(state.opportunity, 'qualification did not create a linked opportunity');
  assert.equal(state.opportunity.leadId, leadId);
  assert.equal(state.opportunity.stage, 'qualified');
  assert.equal(state.opportunity.value, OPPORTUNITY_VALUE);
  assert.equal(state.renderedCount, 1, 'qualified opportunity was duplicated in the page-local list');
  step('Marketing: qualification creates one real, bidirectionally linked opportunity');
  return { leadId, opportunityId: state.opportunity.id };
}

async function convertLead(page, leadId, opportunityId) {
  await page.evaluate((id) => openConvertLead(id), leadId);
  await saveMarketingModal(page);
  const state = await page.evaluate(({ leadId: id, opportunityId: oppId, company }) => {
    const lead = WorkshopData.findMarketingLead(id);
    const opportunity = WorkshopData.findMarketingOpportunity(oppId);
    const customers = WorkshopData.getCustomers().filter((customer) => customer.name === company);
    return { lead, opportunity, customers };
  }, { leadId, opportunityId, company: COMPANY });
  assert.equal(state.customers.length, 1);
  assert.equal(state.lead.status, 'converted');
  assert.equal(state.lead.linkedCustomerId, state.customers[0].id);
  assert.equal(state.opportunity.customerId, state.customers[0].id);
  assert.equal(state.customers[0].contacts[0].name, CONTACT);

  await page.reload({ waitUntil: 'load' });
  const restored = await page.evaluate((id) => WorkshopData.findMarketingLead(id), leadId);
  assert.equal(restored.status, 'converted');
  assert.ok(restored.linkedCustomerId);
  step('Marketing → Customers: conversion links lead, opportunity, and one persisted customer');
}

async function verifyCustomer(page) {
  await page.locator('#search').fill(COMPANY);
  await page.waitForTimeout(70);
  await page.locator('.custrow').filter({ hasText: COMPANY }).click();
  const body = await page.locator('body').innerText();
  assert.ok(body.includes(COMPANY));
  assert.ok(body.includes(CONTACT));
  step('Customers: converted Marketing record hydrates with its contact data');
}

async function openEstimateFromOpportunity(page, opportunityId) {
  await page.evaluate((id) => openOppDetail(id), opportunityId);
  await Promise.all([
    page.waitForURL(/estimations-desktop\.html\?estimation=/, { timeout: 5000 }),
    page.getByRole('button', { name: 'Open Estimation' }).click()
  ]);
  await page.waitForLoadState('load');

  const state = await page.evaluate((opportunityId) => {
    const opportunity = WorkshopData.findMarketingOpportunity(opportunityId);
    const matches = WorkshopData.listEstimations().filter((estimation) => estimation.opportunityRef === opportunity.no);
    return { opportunity, matches, selectedNo: getEst(selectedId).no };
  }, opportunityId);
  assert.equal(state.matches.length, 1);
  assert.equal(state.opportunity.linkedEstimateNo, state.matches[0].no);
  assert.equal(state.matches[0].customer, COMPANY);
  assert.equal(state.matches[0].customerId, state.opportunity.customerId);
  assert.equal(state.matches[0].sellingPrice, OPPORTUNITY_VALUE);
  assert.equal(state.matches[0].status, 'draft');
  assert.equal(state.selectedNo, state.matches[0].no, 'Estimation deep link did not select the created record');

  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.evaluate(() => getEst(selectedId).no), state.matches[0].no);
  step('Marketing → Estimations: Open Estimation creates, links, selects, and restores one draft');
  return state.matches[0].no;
}

async function verifyIdempotentEstimateAndWin(page, baseUrl, opportunityId, estimationNo) {
  const salesPage = await page.context().newPage();
  const salesMonitor = monitorPage(salesPage, baseUrl);
  try {
    await salesPage.goto(`${baseUrl}/marketing-desktop.html`, { waitUntil: 'load' });
    await salesPage.evaluate((id) => openOppDetail(id), opportunityId);
    await salesPage.getByRole('button', { name: 'Mark won' }).click();
    let opportunity = await salesPage.evaluate((id) => WorkshopData.findMarketingOpportunity(id), opportunityId);
    assert.equal(opportunity.stage, 'won');
    assert.equal(opportunity.probability, 100);
    assert.equal(opportunity.linkedEstimateNo, estimationNo);

    await salesPage.evaluate((id) => openOppDetail(id), opportunityId);
    await Promise.all([
      salesPage.waitForURL(/estimations-desktop\.html\?estimation=/, { timeout: 5000 }),
      salesPage.getByRole('button', { name: 'Open Estimation' }).click()
    ]);
    const count = await salesPage.evaluate((no) => WorkshopData.listEstimations().filter((estimation) => estimation.no === no).length, estimationNo);
    assert.equal(count, 1, 'reopening an opportunity created a duplicate estimation');
    opportunity = await salesPage.evaluate((id) => WorkshopData.findMarketingOpportunity(id), opportunityId);
    assert.equal(opportunity.linkedEstimateNo, estimationNo);
    salesMonitor.assertClean();
    step('Marketing: won transition persists and reopening reuses the linked draft');
  } finally {
    await salesPage.close();
  }
}

async function main() {
  const harness = await startBrowserHarness();
  const page = await harness.context.newPage();
  const monitor = monitorPage(page, harness.baseUrl);
  try {
    await page.goto(`${harness.baseUrl}/marketing-desktop.html`, { waitUntil: 'load' });
    const { leadId, opportunityId } = await createAndQualifyLead(page);
    await convertLead(page, leadId, opportunityId);
    await page.goto(`${harness.baseUrl}/customers-desktop.html`, { waitUntil: 'load' });
    await verifyCustomer(page);
    await page.goto(`${harness.baseUrl}/marketing-desktop.html`, { waitUntil: 'load' });
    const estimationNo = await openEstimateFromOpportunity(page, opportunityId);
    await verifyIdempotentEstimateAndWin(page, harness.baseUrl, opportunityId, estimationNo);
    monitor.assertClean();
    console.log('\nMarketing/Customers/Estimations browser E2E passed.');
  } finally {
    await page.close();
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
