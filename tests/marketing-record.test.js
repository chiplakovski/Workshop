'use strict';

// The pipeline's two shapes, and the four places the translation can lose something.
//
// This module is almost all rename, which is itself the finding: twelve fields the coverage meter called
// missing across leads and enquiries all had columns already, and both README and BACKEND.md said the
// remaining schema width was concentrated here. What is worth testing is the four things that are not a
// rename:
//
//   * do-not-contact, which is the law and never guessed at.
//   * The converted status, which this form cannot set — a lead becomes a customer through convert_lead,
//     and a form that could set the status alone could mark one converted to nobody.
//   * The notes: a list of dated entries on screen, one block of text in the column. The supplier
//     register's version of this collapse is what its own comment is about.
//   * The subset rule, fifth screen running.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE = process.env.VARMAK_MARKETING_RECORD
  || path.join(__dirname, '..', 'marketing-record.js');
delete require.cache[require.resolve(MODULE)];
const MarketingRecord = require(MODULE);

const leadFromTheServer = () => ({
  id: '11', no: 'L-0011', company: 'Nordic Fabrication AB', contact: 'Petra Lind',
  email: 'petra@nordfab.se', phone: '+46 42 555 90 10', city: 'Helsingborg', country: 'Sweden',
  industry: 'Marine', size: '50-200', source: 'Trade fair', service: 'Stainless fabrication',
  value: '480000.00', priority: 'high', status: 'qualified', owner: 'Lars Holm',
  lastContact: '2026-09-20', nextFollowUp: '2026-09-30', commPref: 'email', dnc: false,
  linkedCustomerId: null, linkedOpportunityId: '4',
  notes: '2026-09-20 (Lars Holm) Met at the Malmö show\nAsked for a price on ten duct runs',
  created: '2026-09-20T09:00:00Z',
  activity: [{ timestamp: '2026-09-20T09:00:00Z', action: 'added', reason: 'L-0011 Nordic Fabrication AB' }],
  findings: [{ id: '3', finding: 'Planning application filed', source: 'kommun', foundBy: 'Lars Holm' }]
});

test('a form that shows half a lead does not clear the other half', () => {
  const held = MarketingRecord.leadFromServer(leadFromTheServer());
  const sent = MarketingRecord.leadToServer(Object.assign({}, held, { priority: 'low' }));
  assert.equal(sent.priority, 'low');
  assert.equal(sent.company_size, '50-200', 'the company size cannot be lost by changing the priority');
  assert.equal(sent.service_wanted, 'Stainless fabrication');
  assert.equal(sent.estimated_value, 480000);
  assert.equal(sent.contact_preference, 'email');
  assert.equal(sent.last_contact_on, '2026-09-20');
  assert.equal(sent.id, 11);
});

test('every one of the twelve the meter called missing is a rename', () => {
  const sent = MarketingRecord.leadToServer({
    company: 'X', size: '10-50', service: 'Welding', value: '120 000', lastContact: '2026-09-01',
    nextFollowUp: '2026-09-08', commPref: 'phone', dnc: false
  });
  assert.equal(sent.company_size, '10-50');
  assert.equal(sent.service_wanted, 'Welding');
  assert.equal(sent.estimated_value, 120000, 'a figure typed with a space in it is still a figure');
  assert.equal(sent.last_contact_on, '2026-09-01');
  assert.equal(sent.next_follow_up_on, '2026-09-08');
  assert.equal(sent.contact_preference, 'phone');
  assert.equal(sent.do_not_contact, false);
  for (const gone of ['size', 'service', 'value', 'lastContact', 'nextFollowUp', 'commPref', 'dnc']) {
    assert.equal(gone in sent, false, `nothing called ${gone} reaches the database`);
  }
});

test('a follow-up is not sent for somebody who has asked not to be contacted', () => {
  // The database refuses that combination and says so. Sending it anyway would mean a save failing for a
  // reason the person did not choose, on a field they may not have touched.
  const sent = MarketingRecord.leadToServer({
    company: 'Nordic Fabrication AB', dnc: true, nextFollowUp: '2026-09-30'
  });
  assert.equal(sent.do_not_contact, true);
  assert.equal(sent.next_follow_up_on, null);
  // And it is never inferred the other way: no preference recorded is not a preference for email.
  assert.equal(MarketingRecord.leadToServer({ company: 'X' }).contact_preference, null);
  assert.equal(MarketingRecord.leadToServer({ company: 'X' }).do_not_contact, false);
});

test('this form cannot mark a lead converted', () => {
  const sent = MarketingRecord.leadToServer({ company: 'X', status: 'converted' });
  assert.equal(sent.status, null,
    'a lead becomes a customer through convert_lead, which ties the two together in one transaction');
  assert.equal(MarketingRecord.LEAD_SETTABLE.includes('linkedCustomerId'), false);
  assert.equal('customer_id' in sent, false);
  // The one the schema had no word for until now. A lead is disqualified because it was never going to be
  // work; an opportunity is lost, to somebody.
  assert.equal(MarketingRecord.leadToServer({ company: 'X', status: 'disqualified' }).status,
    'disqualified');
});

test('the priority the prospect queue writes is the one the column allows', () => {
  // The queue writes 'medium' for a finding it is unsure about and the column says 'normal'. Unmapped,
  // every lead accepted from the sweep would have been refused.
  assert.equal(MarketingRecord.priority('medium'), 'normal');
  assert.equal(MarketingRecord.priority('high'), 'high');
  assert.equal(MarketingRecord.priority('low'), 'low');
  assert.equal(MarketingRecord.priority('urgent'), null, 'a word the column has no value for is nothing');
  assert.equal(MarketingRecord.priority(''), null);
});

test('the notes are a list on screen and one block of text underneath', () => {
  const held = MarketingRecord.leadFromServer(leadFromTheServer());
  assert.equal(held.notes.length, 2);
  assert.equal(held.notes[0].text, '2026-09-20 (Lars Holm) Met at the Malmö show');
  assert.equal(held.notes[1].text, 'Asked for a price on ten duct runs');
  // Round trip: the list goes back as text rather than as "[object Object]", which is what a naive join
  // of the same list produces and what the supplier register's own version of this bug did.
  const back = MarketingRecord.leadToServer(held);
  assert.equal(typeof back.notes, 'string');
  assert.match(back.notes, /Met at the Malmö show/);
  assert.equal(/object Object/.test(back.notes), false);
  // A note typed as an object with a date and an author reads as one line.
  assert.equal(MarketingRecord.leadNotes([{ date: '2026-09-25', author: 'Anna', text: 'Rang them' }]),
    '2026-09-25 (Anna) Rang them');
  assert.equal(MarketingRecord.leadNotes([]), null);
  assert.equal(MarketingRecord.leadNotes('Just text'), 'Just text');
});

test('an enquiry does not carry a copy of whose it is', () => {
  const sent = MarketingRecord.opportunityToServer({
    title: 'Stainless duct run', company: 'Nordic Fabrication AB', leadId: '11', stage: 'rfq',
    value: '420000', probability: 40
  });
  assert.equal('company' in sent, false,
    'an enquiry belongs to a customer or to a lead, and the name lives on that record');
  assert.equal(sent.lead_id, 11);
  assert.equal(sent.stage, 'rfq');
  assert.equal(sent.probability, 40);
});

test('a probability is a whole percentage inside nought and a hundred', () => {
  assert.equal(MarketingRecord.percent('40'), 40);
  assert.equal(MarketingRecord.percent(40.7), 40);
  assert.equal(MarketingRecord.percent(140), 100, 'clamped rather than refused — the column refuses it');
  assert.equal(MarketingRecord.percent(-5), 0);
  assert.equal(MarketingRecord.percent(''), null);
});

test('the three date fields on an enquiry are the three the schema already had', () => {
  const sent = MarketingRecord.opportunityToServer({
    title: 'X', leadId: '11', expectedDecision: '2026-10-15', requiredDelivery: '2026-12-01',
    followUpDate: '2026-09-28'
  });
  assert.equal(sent.expected_decision_on, '2026-10-15');
  assert.equal(sent.required_delivery_on, '2026-12-01');
  assert.equal(sent.follow_up_on, '2026-09-28');
});

test('a tender marked as gone in carries the day it was marked', () => {
  const today = new Date().toISOString().slice(0, 10);
  const sent = MarketingRecord.tenderToServer({ title: 'Duct run tender', status: 'submitted' });
  assert.equal(sent.submitted_on, today,
    'the database refuses one without a date, and the day it was marked is the honest answer');
  // Awarded and declined both mean it went in.
  assert.equal(MarketingRecord.tenderToServer({ title: 'X', status: 'awarded' }).submitted_on, today);
  assert.equal(MarketingRecord.tenderToServer({ title: 'X', status: 'declined' }).submitted_on, today);
  // And the two states before it goes anywhere do not get one.
  assert.equal(MarketingRecord.tenderToServer({ title: 'X', status: 'in-progress' }).submitted_on, null);
  assert.equal(MarketingRecord.tenderToServer({ title: 'X', status: 'reviewing' }).submitted_on, null);
  // A date already on the record is kept rather than moved to today.
  assert.equal(MarketingRecord.tenderToServer({
    title: 'X', status: 'awarded', submitted: '2026-09-01'
  }).submitted_on, '2026-09-01');
});

test('the tender screen\u2019s nine extra fields all reach the database', () => {
  // The tender form asks for the customer's own reference, the source, the industry, a description, the
  // requirements, who is responsible, whether we are bidding and when to be reminded — nine fields the
  // table had nowhere to keep until this pass, so a tender saved from that form lost all of them.
  const sent = MarketingRecord.tenderToServer({
    title: 'Harbour gantry', company: 'Helsingborgs Hamn AB', ref: 'HH-2026-441',
    source: 'Public procurement', industry: 'Marine', description: 'Two gantry frames',
    requirements: 'EN 1090-2 EXC3', responsible: 'Lars Holm', bidDecision: 'pending',
    reminderDate: '2026-11-20', deadline: '2026-11-30', value: '1250000'
  });
  assert.equal(sent.company, 'Helsingborgs Hamn AB');
  assert.equal(sent.customer_ref, 'HH-2026-441', 'the screen\u2019s `ref` is THEIR reference for it');
  assert.equal(sent.source, 'Public procurement');
  assert.equal(sent.industry, 'Marine');
  assert.equal(sent.description, 'Two gantry frames');
  assert.equal(sent.requirements, 'EN 1090-2 EXC3');
  assert.equal(sent.responsible, 'Lars Holm');
  assert.equal(sent.bid_decision, 'pending');
  assert.equal(sent.reminder_on, '2026-11-20');
  assert.equal(sent.due_on, '2026-11-30', 'the screen says deadline and the column says due_on');
  assert.equal(sent.value, 1250000);
  // And the date under either name, because the snapshot sends it as both.
  assert.equal(MarketingRecord.tenderToServer({ title: 'X', due: '2026-12-01' }).due_on, '2026-12-01');
});

test('a tender names itself with what was typed, because the form has no title box', () => {
  // `title` is NOT NULL and the tender form has no title field — it identifies a tender by the customer's
  // own reference and the company, which is how somebody asks about one. Without a fallback every tender
  // saved from that form was refused for a box the screen does not have.
  assert.equal(MarketingRecord.tenderToServer({ ref: 'HH-2026-441', company: 'Helsingborgs Hamn AB' })
    .title, 'HH-2026-441');
  assert.equal(MarketingRecord.tenderToServer({ company: 'Helsingborgs Hamn AB' }).title,
    'Helsingborgs Hamn AB', 'and the company when there is no reference either');
  assert.equal(MarketingRecord.tenderToServer({ title: 'Harbour gantry', ref: 'HH-2026-441' }).title,
    'Harbour gantry', 'a real title wins over both');
  // Nothing is invented: with neither, it stays empty and the database says what is missing.
  assert.equal(MarketingRecord.tenderToServer({ status: 'in-progress' }).title, null);
});

test('a tender does not carry the project it became', () => {
  const sent = MarketingRecord.tenderToServer({
    title: 'X', status: 'awarded', projectNo: 'P-2026-014'
  });
  assert.equal('project_id' in sent, false,
    'that link is the chain back from a running project, and a form cannot type it in');
  assert.equal(MarketingRecord.TENDER_SETTABLE.includes('projectNo'), false);
});

test('a reference to a row comes back as a number, because the page compares it with one', () => {
  // This screen puts ids into its own markup — onclick="openLeadForm(1)" — and getLead compares with
  // `===`. The snapshot sends them as text. Left as text, the list rendered and not one row in it could
  // be opened: every button found nothing and threw on the next line.
  const held = MarketingRecord.leadFromServer(leadFromTheServer());
  assert.equal(held.id, 11);
  assert.equal(typeof held.id, 'number');
  assert.equal(held.linkedOpportunityId, 4);
  assert.equal(held.linkedCustomerId, null, 'and nothing stays nothing rather than becoming zero');

  const opp = MarketingRecord.opportunityFromServer({ id: '4', leadId: '11', customerId: null });
  assert.equal(opp.id, 4);
  assert.equal(opp.leadId, 11);
  assert.equal(opp.customerId, null);
  const tender = MarketingRecord.tenderFromServer({ id: '2', opportunityId: '4', customerId: '7' });
  assert.deepEqual([tender.id, tender.opportunityId, tender.customerId], [2, 4, 7]);
});

test('the lists the page walks are lists, never absent', () => {
  const lead = MarketingRecord.leadFromServer({ id: '9', no: 'L-0009', company: 'Somebody AB' });
  for (const list of ['activity', 'findings', 'notes']) {
    assert.ok(Array.isArray(lead[list]), `${list} has to be a list`);
    assert.equal(lead[list].length, 0);
  }
  const opp = MarketingRecord.opportunityFromServer({ id: '9', no: 'OPP-2026-009' });
  assert.deepEqual(opp.tenders, []);
  assert.deepEqual(opp.activity, []);
  const tender = MarketingRecord.tenderFromServer({ id: '9', no: 'T-2026-009' });
  assert.deepEqual(tender.activity, []);
});

test('a figure crosses as text and arrives as a number the page can add up', () => {
  const held = MarketingRecord.leadFromServer(leadFromTheServer());
  assert.equal(held.value, 480000, 'the pipeline totals are summed on screen');
  assert.equal(MarketingRecord.leadFromServer({ company: 'X', value: null }).value, null,
    'and nothing is nothing rather than zero — a lead nobody has valued is not a lead worth nothing');
});
