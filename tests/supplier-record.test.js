'use strict';

// The merchant's two shapes, and the four places the translation can lose something.
//
// Most of this module is a rename, and four of the six fields the coverage meter called missing here
// turned out to be exactly that. What is worth testing is the rest:
//
//   * The payment terms. "30 days" on screen, a count of days underneath, and the words are in whichever
//     language the person was using.
//   * The rating. A judgement about somebody's company, where absent has to stay absent in both
//     directions — the screen printed four stars beside every supplier because a missing rating was
//     being read as 4, and a coalesce on the way down would mean one could never be withdrawn.
//   * The subset rule, fourth screen running. The New Supplier form asks for four fields.
//   * What is NOT sent: six figures that are answers computed from rows elsewhere.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE = process.env.VARMAK_SUPPLIER_RECORD
  || path.join(__dirname, '..', 'supplier-record.js');
delete require.cache[require.resolve(MODULE)];
const SupplierRecord = require(MODULE);

// A merchant as the snapshot sends it, with everything the New Supplier form never asks for filled in.
const fromTheServer = () => ({
  id: '5', no: 'S-001', name: 'Nordic Steel', category: 'Steel & plate', status: 'preferred',
  org: '556123-4567', vat: 'SE556123456701', email: 'order@nordicsteel.se',
  phone: '+46 42 555 10 20', website: 'www.nordicsteel.se',
  address: 'Hamngatan 14, 252 21 Helsingborg', city: 'Helsingborg', country: 'Sweden',
  type: 'Company', established: '1994', delivery: 'DAP', minimum: '5 000 SEK', currency: 'SEK',
  rating: '4.5', notes: 'Cuts to length on request',
  contacts: [
    { name: 'Erik Lund', role: 'Order desk', email: 'order@nordicsteel.se', phone: '+46 42 555 10 20', primary: true },
    { name: 'Ann Ek', role: 'Accounts', email: 'ann@nordicsteel.se', phone: null, primary: false }
  ],
  activity: [
    { timestamp: '2026-09-01T09:00:00Z', action: 'note', text: 'Lead time up to three weeks',
      author: 'Anna Berg', date: '2026-09-01', note: true },
    { timestamp: '2026-08-20T09:00:00Z', action: 'added', text: 'S-001 Nordic Steel',
      author: 'Anna Berg', date: '2026-08-20', note: false }
  ]
});

test('a form that asks for four fields does not clear the other fifteen', () => {
  const held = SupplierRecord.fromServer(fromTheServer(), { terms: '30', unit: 'days' });
  // The New Supplier form, reopened to correct the category.
  const sent = SupplierRecord.toServer(Object.assign({}, held, { category: 'Steel, plate and tube' }));
  assert.equal(sent.category, 'Steel, plate and tube');
  assert.equal(sent.vat_no, 'SE556123456701', 'correcting the category cannot lose the VAT number');
  assert.equal(sent.address, 'Hamngatan 14, 252 21 Helsingborg');
  assert.equal(sent.minimum_order, '5 000 SEK');
  assert.equal(sent.delivery_terms, 'DAP');
  assert.equal(sent.supplier_type, 'Company');
  assert.equal(sent.id, 5, 'and it is the same merchant, by the id the snapshot sent');
});

test('the screen’s words are the schema’s longer names', () => {
  const sent = SupplierRecord.toServer({
    name: 'WeldSupply', type: 'Company', delivery: 'EXW', minimum: '1 500 SEK', org: '556987-1122',
    vat: 'SE556987112201'
  });
  assert.equal(sent.supplier_type, 'Company');
  assert.equal(sent.delivery_terms, 'EXW');
  assert.equal(sent.minimum_order, '1 500 SEK');
  assert.equal(sent.org_no, '556987-1122');
  assert.equal(sent.vat_no, 'SE556987112201');
  for (const gone of ['type', 'delivery', 'minimum', 'org', 'vat', 'payment']) {
    assert.equal(gone in sent, false, `nothing called ${gone} reaches the database`);
  }
});

test('the payment terms are words on screen and a count of days underneath', () => {
  assert.equal(SupplierRecord.paymentDays('30 days'), 30);
  assert.equal(SupplierRecord.paymentDays('30 dagar'), 30, 'in whichever language somebody was using');
  assert.equal(SupplierRecord.paymentDays('Net 30'), 30);
  assert.equal(SupplierRecord.paymentDays('14'), 14);
  assert.equal(SupplierRecord.paymentDays(45), 45);
  assert.equal(SupplierRecord.paymentDays(''), null);
  assert.equal(SupplierRecord.paymentDays('on delivery'), null,
    'terms with no number in them are not a count of days, and inventing one would be worse');
  assert.equal(SupplierRecord.paymentWords(30, 'days'), '30 days');
  assert.equal(SupplierRecord.paymentWords(30, 'dagar'), '30 dagar');
  assert.equal(SupplierRecord.paymentWords(null, 'days'), null);

  // And through the save, which is where it matters: the column is an int, so the words arriving
  // untranslated are not a wrong figure, they are a refused save — and the screen was reporting a
  // success either way until the form learned to wait for the answer.
  const sent = SupplierRecord.toServer({ name: 'Nordic Steel', payment: '30 days' });
  assert.equal(sent.payment_terms_days, 30);
  assert.equal(typeof sent.payment_terms_days, 'number');
  assert.equal(SupplierRecord.toServer({ name: 'X', payment: 'on delivery' }).payment_terms_days, null);
  // Both ways round, on one record: the words come back out of the count.
  const held = SupplierRecord.fromServer(fromTheServer(), { terms: '45', unit: 'days' });
  assert.equal(held.payment, '45 days');
  assert.equal(SupplierRecord.toServer(held).payment_terms_days, 45);
});

test('nobody having rated a merchant is not the same as rating them zero', () => {
  assert.equal(SupplierRecord.rating(null), null);
  assert.equal(SupplierRecord.rating(''), null);
  assert.equal(SupplierRecord.rating(0), 0, 'and zero is a rating somebody gave');
  assert.equal(SupplierRecord.rating('4.5'), 4.5, 'kept as given rather than rounded to a star count');
  assert.equal(SupplierRecord.rating(6), null, 'out of five means out of five');
  assert.equal(SupplierRecord.rating(-1), null);

  // Both directions. The screen showed four stars beside every supplier's name because a missing rating
  // was read as 4; sending a coalesce the other way would mean a rating could never be withdrawn.
  const unrated = SupplierRecord.fromServer(Object.assign(fromTheServer(), { rating: null }));
  assert.equal(unrated.rating, null);
  assert.equal(SupplierRecord.toServer(unrated).rating, null);
  const withdrawn = SupplierRecord.toServer(
    Object.assign({}, SupplierRecord.fromServer(fromTheServer()), { rating: null }));
  assert.equal(withdrawn.rating, null, 'a rating given has to be removable');
});

test('the six figures that are answers computed elsewhere are not saved', () => {
  const sent = SupplierRecord.toServer({
    name: 'Nordic Steel', performance: { delivery: 88, quality: 90 }, spendYtd: '240 000 SEK',
    spendYtdChange: '+12%', openPOs: 3, openPOsValue: '84 000 SEK',
    overdueDeliveries: 1, overdueDeliveriesValue: '12 000 SEK'
  });
  for (const answer of ['performance', 'spendYtd', 'spendYtdChange', 'openPOs', 'openPOsValue',
    'overdueDeliveries', 'overdueDeliveriesValue']) {
    assert.equal(answer in sent, false,
      `${answer} is computed from rows elsewhere — a stored answer goes stale the moment one changes`);
    assert.equal(SupplierRecord.SETTABLE.includes(answer), false);
  }
});

test('a contact is a row on screen and a record underneath, and the initials are neither', () => {
  const held = SupplierRecord.fromServer(fromTheServer());
  assert.deepEqual(held.contacts[0],
    ['EL', 'Erik Lund', 'Order desk', 'order@nordicsteel.se', '+46 42 555 10 20']);
  assert.deepEqual(held.contacts[1], ['AE', 'Ann Ek', 'Accounts', 'ann@nordicsteel.se', '']);

  const back = SupplierRecord.contactsToServer(held.contacts);
  assert.equal(back.length, 2);
  assert.equal(back[0].primary, true, 'the first in the list is the one the screen chips as main');
  assert.equal(back[1].primary, false);
  // The initials are not sent. A stored initial is one that can disagree with the name beside it.
  assert.equal('initials' in back[0], false);
  assert.equal(back[1].phone, null, 'an empty box is nothing rather than an empty string');
});

test('a contact with no name is dropped rather than sent as somebody', () => {
  const sent = SupplierRecord.contactsToServer([
    ['EL', 'Erik Lund', 'Order desk', 'order@nordicsteel.se', ''],
    ['', '   ', 'Sales', 'nobody@example.com', ''],
    ['', null, '', '', '']
  ]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].name, 'Erik Lund');
});

test('a contact given as an object says for itself which one is main', () => {
  const sent = SupplierRecord.contactsToServer([
    { name: 'Ann Ek', role: 'Accounts', email: 'ann@nordicsteel.se' },
    { name: 'Erik Lund', role: 'Order desk', phone: '+46 42 555 10 20', primary: true }
  ]);
  assert.equal(sent[0].primary, false);
  assert.equal(sent[1].primary, true);
});

test('the dated notes and the standing description are two things, not one word', () => {
  // The bug this test was written for: `notes` on screen is the dated list in the Notes panel, and
  // `notes` in the database is the standing description of the merchant. One round trip put the list
  // where the description belongs, so the text became "2026-09-01,Lead time up to three weeks,Anna
  // Berg". The column is `description` on this side of the wire now.
  const held = SupplierRecord.fromServer(fromTheServer());
  assert.deepEqual(held.notes, [['2026-09-01', 'Lead time up to three weeks', 'Anna Berg']],
    'only the entries marked as notes — the rest of the trail is what happened, not what somebody wrote');
  assert.equal(held.description, 'Cuts to length on request');
  assert.equal(SupplierRecord.toServer(held).notes, 'Cuts to length on request',
    'and the description goes back as the description, whatever is in the notes panel');
  // Even when the caller hands back the list under its own name, which is what the screen does.
  const edited = SupplierRecord.toServer(Object.assign({}, held, {
    notes: [['2026-09-02', 'Another note', 'Anna Berg'], ...held.notes]
  }));
  assert.equal(edited.notes, 'Cuts to length on request',
    'a note added on screen cannot overwrite the merchant\u2019s description');
  assert.equal(SupplierRecord.SETTABLE.includes('notes'), false);
});

test('the lists the page walks are lists, never absent', () => {
  const bare = SupplierRecord.fromServer({ id: '9', no: 'S-009', name: 'Somebody Steel' });
  for (const list of ['contacts', 'activity', 'notes', 'docs', 'purchaseOrders', 'items']) {
    assert.ok(Array.isArray(bare[list]), `${list} has to be a list`);
    assert.equal(bare[list].length, 0);
  }
});

test('what a merchant quotes is not the same list as what has been bought from them', () => {
  // One word, two questions. `items` is a rollup of purchases — total quantity, total spend — and needs
  // the invoices this system does not keep. `priceList` is what they quote, which is answerable. Sent
  // under one name, a list of price lines renders into a column headed "Total spend".
  const held = SupplierRecord.fromServer(Object.assign(fromTheServer(), {
    priceList: [
      { code: 'S355-10', description: 'Plate S355J2 10mm', articleNo: 'ST-10-S355', price: '13.90',
        currency: 'SEK', packSize: '1.000', leadTime: '5', preferred: true },
      { code: 'S355-12', description: 'Plate S355J2 12mm', articleNo: null, price: '15.40',
        currency: 'SEK', packSize: '1.000', leadTime: null, preferred: false }
    ]
  }));
  assert.deepEqual(held.items, [], 'what has been bought cannot be answered, so it stays empty');
  assert.deepEqual(held.priceList, [
    ['S355-10 \u2014 Plate S355J2 10mm', 'ST-10-S355', '13.90 SEK', '5 d'],
    ['S355-12 \u2014 Plate S355J2 12mm', '\u2014', '15.40 SEK', '\u2014']
  ], 'and what they quote arrives as the four columns the panel walks');
  // The price is text all the way through: an exact decimal out of a numeric column, and a JSON number
  // parsed in a browser is a double.
  assert.equal(typeof held.priceList[0][2], 'string');
});

test('a welder’s record carries no payment terms at all, rather than a guess', () => {
  const floor = SupplierRecord.fromServer(fromTheServer());
  assert.equal('payment' in floor, false,
    'what this workshop is paid on is a commercial term, and the floor is not shown one');
  const office = SupplierRecord.fromServer(fromTheServer(), { terms: '30', unit: 'days' });
  assert.equal(office.payment, '30 days');
});

test('the reference is the one the register shows, and it is not something a form sets', () => {
  const held = SupplierRecord.fromServer(fromTheServer());
  assert.equal(held.sharedNo, 'S-001');
  assert.equal(held.sharedId, '5');
  assert.equal(SupplierRecord.SETTABLE.includes('no'), false,
    'the reference is the database’s to allocate');
  assert.equal('ref' in SupplierRecord.toServer(held), false);
});
