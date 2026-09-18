'use strict';

const assert = require('node:assert/strict');
const { monitorPage, startBrowserHarness, loadDemoData } = require('./helpers/browser-harness');

const COMPANY = 'E2E Skane Process Systems AB';
const CONTACT = 'Elin Andersson';
const SERVICE = 'E2E stainless process platform';
const OPPORTUNITY_VALUE = 285000;
const FINDING_COMPANY = 'E2E Eslovs Entreprenad AB';

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

// The findings queue, driven the way a person drives it: run the sweep, read the top card, accept
// one and reject one, and check that what the page claims matches what the shop actually owns.
async function runFindingsQueue(page) {
  await page.evaluate(() => setView('findings'));
  await page.waitForTimeout(60);
  assert.equal(await page.locator('.fdcard').count(), 0, 'nothing has been swept yet');
  assert.match(await page.textContent('.swwhen'), /No sweep has run yet/);
  step('Findings: an unrun sweep shows an empty queue rather than made-up leads');

  await page.evaluate(() => fdRunSweep());
  await page.waitForTimeout(700);
  await page.locator('.waskyes').click();
  await page.waitForTimeout(120);

  const tally = await page.evaluate(() => WorkshopData.prospectQueueSummary());
  const sweep = await page.evaluate(() => WorkshopData.lastProspectSweep());
  assert.equal(sweep.source, 'stub');
  assert.ok(sweep.tally.dropped > 0, 'the sample deliberately contains a finding with no source');
  assert.equal(await page.locator('.fdcard').count(), tally.waiting);
  assert.ok(await page.locator('.swdemo').isVisible(), 'a stubbed sweep says so above the queue');
  step('Findings: running the sweep fills the queue and says it is a sample');

  // The morning is read top down, so what deserves the first call has to be on top.
  const order = await page.evaluate(() => fdVisible().map((f) => f.verdict));
  const rank = { go: 0, maybe: 1, skip: 2 };
  order.forEach((v, i) => {
    if (i) assert.ok(rank[v] >= rank[order[i - 1]], `queue is out of order at ${i}: ${order.join(',')}`);
  });
  step('Findings: the queue puts the calls to make above the judgement calls');

  // No card may offer a machine the register does not carry, in any status.
  const offered = await page.evaluate(() => {
    const known = new Set(WorkshopData.get().equipment.map((e) => e.equipmentId || e.id));
    return WorkshopData.getProspectFindings()
      .flatMap((f) => f.match.machines.map((m) => m.id))
      .filter((id) => !known.has(id));
  });
  assert.deepEqual(offered, [], 'a finding offered a machine that is not in the equipment register');
  step('Findings: every machine a card offers is one the shop really owns');

  // 100-ton pressing is the thing the shop must never claim.
  const press = await page.evaluate(() =>
    WorkshopData.getProspectFindings().find((f) => /100 ton/.test(f.title)));
  assert.equal(press.verdict, 'skip', 'work outside the trade must not come back as a lead to chase');
  assert.deepEqual(press.match.outside, ['pressing']);
  step('Findings: work the shop cannot do is marked skip, not dressed up');

  const before = await page.evaluate(() => WorkshopData.getMarketingLeads().length);
  const top = await page.evaluate(() => fdVisible()[0].id);
  await page.locator('.fdcard').first().locator('.fdacts button.tbtn.primary').click();
  await page.waitForTimeout(120);
  await page.locator('#fdCompany').fill(FINDING_COMPANY);
  await page.locator('#fcard .fbtns .primary').click();
  await page.waitForTimeout(200);
  await page.locator('.waskyes').click();
  await page.waitForTimeout(120);

  const lead = await page.evaluate((company) =>
    WorkshopData.getMarketingLeads().find((l) => l.company === company), FINDING_COMPANY);
  assert.ok(lead, 'accepting a finding must create a real lead');
  assert.equal(await page.evaluate(() => WorkshopData.getMarketingLeads().length), before + 1);
  assert.equal(lead.source, 'prospect');
  // The one thing a lead off a public post must never carry is a figure nobody quoted.
  assert.equal(lead.value, null);
  assert.equal(lead.email, '');
  assert.equal(lead.phone, '');
  assert.equal(await page.evaluate((id) => WorkshopData.findProspectFinding(id).leadNo, top), lead.no);
  step('Findings: accepting creates a lead carrying only what the finding actually said');

  // ...and an unknown value is shown as unknown, not as nothing.
  await page.evaluate(() => setView('leads'));
  await page.waitForTimeout(120);
  const shown = await page.evaluate((company) => {
    const row = [...document.querySelectorAll('.leadrow')]
      .find((r) => r.textContent.includes(company));
    return row ? row.querySelector('.lrval').textContent.trim() : null;
  }, FINDING_COMPANY);
  assert.equal(shown, '—', 'a lead with no estimated value must not read as 0 kr');
  step('Findings: a lead with no value yet reads as unknown, never as worth nothing');

  await page.evaluate(() => setView('findings'));
  await page.waitForTimeout(120);
  const waiting = await page.evaluate(() => WorkshopData.prospectQueueSummary().waiting);
  const rejected = await page.evaluate(() => fdVisible()[0].fingerprint);
  await page.locator('.fdcard').first().locator('.fdacts button.tbtn:not(.primary)').click();
  await page.waitForTimeout(120);
  await page.locator('.waskyes').click();
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => WorkshopData.prospectQueueSummary().waiting), waiting - 1);
  step('Findings: rejecting takes it out of the queue');

  // The whole point of remembering: the second sweep of the same morning is not a second morning.
  await page.evaluate(() => fdRunSweep());
  await page.waitForTimeout(700);
  await page.locator('.waskyes').click();
  await page.waitForTimeout(150);
  const second = await page.evaluate(() => WorkshopData.lastProspectSweep());
  assert.equal(second.tally.ready, 0, 'the same findings came back as new');
  const again = await page.evaluate((fp) =>
    WorkshopData.getProspectFindings().filter((f) => f.fingerprint === fp).length, rejected);
  assert.equal(again, 1, 'a rejected finding must not reappear');
  step('Findings: a second sweep repeats nothing, not even what was rejected');
}

async function main() {
  const harness = await startBrowserHarness();
  const page = await harness.context.newPage();
  const monitor = monitorPage(page, harness.baseUrl);
  try {
    await page.goto(`${harness.baseUrl}/marketing-desktop.html`, { waitUntil: 'load' });
    await loadDemoData(page);
    await runFindingsQueue(page);
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
