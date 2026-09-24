'use strict';

// The translation between the customer screen's shapes and the database's, tested without a browser
// because it is arithmetic and string handling and neither needs one.
//
// The case that matters most is the last one: a screen that shows a subset of a record must not save
// a subset of it, because save_customer replaces rather than patches. Correcting a telephone number
// has to leave the price list alone.

const test = require('node:test');
const assert = require('node:assert/strict');
const CustomerRecord = require('../customer-record.js');

const SERVED = {
  id: '7', no: 'C-007', name: 'Höganäs Mekaniska AB', status: 'active', city: 'Höganäs',
  country: 'Sweden', org: '556677-8899', vat: 'SE556677889901', email: 'order@hoganas-mek.se',
  phone: '+46 42 33 44 55', website: 'hoganas-mek.se', industry: 'Food processing',
  since: '2026-02-01', type: 'direct', preferred: 'Email', notes: null,
  contacts: [{ name: 'Erik Lund', role: 'Purchasing', email: 'erik@hoganas-mek.se', phone: null, primary: true }],
  // What the second, granted call merges in, record by record.
  credit: '180000.00', currency: 'SEK', terms: '30', priceList: 'Standard 2026',
  deliveryTerms: 'Ex Works', discountAgreement: '4% over 200k',
  billing: 'Höganäs Mekaniska AB\nBox 12\n263 21 Höganäs'
};

test('a count of days becomes words on the screen and a number on the way back', () => {
  assert.equal(CustomerRecord.fromServer(SERVED, 1).terms, '30 days');
  assert.equal(CustomerRecord.days('30 days'), 30);
  assert.equal(CustomerRecord.days('net 30'), 30);
  assert.equal(CustomerRecord.days('30'), 30);
  assert.equal(CustomerRecord.days(45), 45);
  // Nothing in it means nobody has said, which is what an empty column means — not zero, which
  // would mean payment on the day of delivery.
  assert.equal(CustomerRecord.days('on delivery'), null);
  assert.equal(CustomerRecord.days(''), null);
  assert.equal(CustomerRecord.days(null), null);
});

test('the billing address is one block of text and several lines on screen', () => {
  const page = CustomerRecord.fromServer(SERVED, 1);
  assert.deepEqual(page.billing, ['Höganäs Mekaniska AB', 'Box 12', '263 21 Höganäs']);
  assert.equal(CustomerRecord.toServer(page).billing_address,
    'Höganäs Mekaniska AB\nBox 12\n263 21 Höganäs');
  // A customer with no address shows its own name rather than an empty card, and that placeholder
  // must not travel back as if somebody had typed it.
  const bare = CustomerRecord.fromServer({ ...SERVED, billing: null }, 1);
  assert.deepEqual(bare.billing, ['Höganäs Mekaniska AB']);
});

test('the shipping address is only stored when it differs from the billing one', () => {
  // Same address is the usual case, and a copy of the billing address stored as the shipping address
  // makes "they are the same" indistinguishable from "somebody typed it twice" — the first is a fact
  // worth keeping and the second is a maintenance problem.
  const same = CustomerRecord.fromServer(SERVED, 1);
  assert.deepEqual(same.shipping, same.billing, 'the screen still shows an address in both cards');
  assert.equal(CustomerRecord.toServer(same).shipping_address, null);

  const apart = CustomerRecord.fromServer({ ...SERVED, shipping: 'Gate 4\nIndustrivägen 8\n263 21 Höganäs' }, 1);
  assert.deepEqual(apart.shipping, ['Gate 4', 'Industrivägen 8', '263 21 Höganäs']);
  assert.notDeepEqual(apart.shipping, apart.billing);
  assert.equal(CustomerRecord.toServer(apart).shipping_address, 'Gate 4\nIndustrivägen 8\n263 21 Höganäs');
});

test('money crosses as text and is only turned into a number to be formatted', () => {
  assert.equal(typeof SERVED.credit, 'string', 'the wire keeps its scale');
  assert.equal(CustomerRecord.fromServer(SERVED, 1).credit, 180000);
  assert.equal(CustomerRecord.figure('14.50'), 14.5);
  assert.equal(CustomerRecord.figure(null), 0);
  assert.equal(CustomerRecord.figure('nonsense'), 0);
});

test('the customer type reads as a word and goes back as the one the column accepts', () => {
  assert.equal(CustomerRecord.fromServer(SERVED, 1).ctype, 'Direct');
  assert.equal(CustomerRecord.toServer(CustomerRecord.fromServer(SERVED, 1)).customer_type, 'direct',
    '"Direct" is not a value the column accepts — what came in is what goes back');
  // Something the map has not heard of is carried through rather than dropped. The page did not
  // choose it; the database did.
  const odd = CustomerRecord.fromServer({ ...SERVED, type: 'framework' }, 1);
  assert.equal(odd.ctype, 'framework');
  assert.equal(CustomerRecord.toServer(odd).customer_type, 'framework');
});

test('a dash is how this screen writes nothing, and nothing is what goes back', () => {
  const page = CustomerRecord.fromServer({ ...SERVED, city: null, website: '', org: null }, 1);
  assert.equal(page.city, '—');
  assert.equal(page.website, '—');
  const out = CustomerRecord.toServer(page);
  assert.equal(out.city, null);
  assert.equal(out.website, null);
  assert.equal(out.org_no, null, 'or the database ends up holding the character —');
});

test('the preferred contact is the method, not a flag', () => {
  assert.equal(CustomerRecord.fromServer(SERVED, 1).preferred, 'Email');
  assert.equal(CustomerRecord.toServer(CustomerRecord.fromServer(SERVED, 1)).preferred_contact, 'Email');
  // The flag is a different fact and is not what that field means. It rides along untouched.
  const flagged = CustomerRecord.fromServer({ ...SERVED, isPreferred: true }, 1);
  assert.equal(flagged.preferred, 'Email');
  assert.equal(CustomerRecord.toServer(flagged).is_preferred, true);
});

test('the contacts go back as the four fields the table has, and nothing else', () => {
  const page = CustomerRecord.fromServer(SERVED, 1);
  page.contacts[0].department = 'Purchasing';       // on the page's records, no column anywhere
  const out = CustomerRecord.contactsToServer(page);
  assert.deepEqual(Object.keys(out[0]).sort(), ['email', 'name', 'phone', 'primary', 'role']);
  assert.equal(out[0].primary, true);
  assert.equal(out[0].phone, null, 'an empty telephone number is nothing, not the empty string');
});

test('correcting a telephone number does not blank the fields the screen never showed', () => {
  const page = CustomerRecord.fromServer(SERVED, 1);
  page.phone = '+46 42 99 88 77';
  const out = CustomerRecord.toServer(page);
  assert.equal(out.phone, '+46 42 99 88 77');
  // Every one of these would have been sent as null by a page that saved only what it displays,
  // and save_customer replaces the record — so the correction would have cleared them.
  assert.equal(out.customer_type, 'direct');
  assert.equal(out.price_list, 'Standard 2026');
  assert.equal(out.discount_agreement, '4% over 200k');
  assert.equal(out.delivery_terms, 'Ex Works');
  assert.equal(out.payment_terms_days, 30);
  assert.equal(out.credit_limit, 180000);
  assert.equal(out.id, 7, 'and it is a correction, not a second customer');
});

test('a record typed in on this screen carries its own commercial half', () => {
  // Nothing to fall back to, and nobody to fall back for: a page record with no _server was made by
  // somebody using this screen, and only a session the database lets write gets that far. Taking the
  // commercial fields from the (absent) server record instead dropped the terms and the credit limit
  // of every customer created through the form — which is exactly what happened first time.
  const typed = {
    name: 'Lomma Svets AB', status: 'active', city: 'Lomma', country: 'Sweden',
    email: 'order@lomma-svets.se', phone: '—', website: '—', org: '—', vat: '—',
    industry: '—', since: '2026-09-23', ctype: 'Company', preferred: 'Email',
    terms: '45 days', credit: 90000, currency: 'SEK', pricelist: '—',
    deliveryTerms: '—', discountAgreement: '—', billing: ['Lomma Svets AB'], contacts: []
  };
  const out = CustomerRecord.toServer(typed);
  assert.equal(out.id, null, 'no id means make one');
  assert.equal(out.payment_terms_days, 45);
  assert.equal(out.credit_limit, 90000);
  assert.equal(out.customer_type, null, '"Company" is not a value the column takes, and was not chosen here');
});

test('a session that was never given the commercial half cannot blank it either', () => {
  // A welder's snapshot arrives without the money call, so none of these fields is there at all.
  const withoutMoney = { ...SERVED };
  for (const key of ['credit', 'terms', 'priceList', 'deliveryTerms', 'discountAgreement']) {
    delete withoutMoney[key];
  }
  const page = CustomerRecord.fromServer(withoutMoney, 1);
  assert.equal(page.seesMoney, false);
  assert.equal(page.terms, '—', 'the screen says it was not given this, rather than inventing a value');
  const out = CustomerRecord.toServer(page);
  // Nothing to preserve and nothing to invent: these go back as they arrived, which is absent. The
  // database refuses the write anyway — a welder holds no privilege on the table — but a screen that
  // sent zeroes would have been one server bug away from wiping every price list in the building.
  assert.equal(out.payment_terms_days, null);
  assert.equal(out.price_list, null);
  assert.equal(out.credit_limit, null);
});
