'use strict';

// The customer record, in the two shapes it has to exist in.
//
// BACKEND.md §5 said the sixteen pages would not change when they were pointed at the database. That
// was already known to be wrong about writes; the customer screen shows it is also wrong about
// shapes. The page has always held `terms` as the words "30 days", the billing address as an array of
// lines, and the customer type as "Company". The database holds a count of days, one block of text,
// and one of four words. Neither side is wrong — a column called payment_terms_days should be a
// number, and a line on a screen should read "30 days" — so something has to translate, and this is
// it, in one file rather than in each page, and testable without a browser.
//
// One rule here matters more than the translation and will matter for every other screen wired after
// this one:
//
//   **A page that shows a subset of a record must not save a subset of it.**
//
// save_customer replaces the record rather than patching it, which is right for a screen that holds
// the whole thing — but the customer screen does not show the customer type, the VAT number's
// validity, or half a dozen other fields it would then blank on every save. So fromServer() keeps the
// server's record as it arrived, and toServer() starts from that and overlays only what the page
// actually edits. Without that, saving a telephone number would quietly clear the price list.
(function (root) {
  // The four the column accepts, and how they read on a screen. A value the map does not know is
  // carried through untouched rather than dropped: the page did not choose it, the database did, and
  // a translation layer that silently discards what it does not recognise is worse than one that
  // does not translate at all.
  const TYPE_WORDS = { direct: 'Direct', reseller: 'Reseller', oem: 'OEM', public: 'Public sector' };

  function lines(text) {
    if (text === null || text === undefined || text === '') return [];
    return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }

  // "30 days" → 30. Also "30", "net 30", "30 dagar". Anything with no number in it → null, which is
  // what an empty column means: nobody has said.
  function days(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
    const found = String(value).match(/-?\d+/);
    return found ? Number(found[0]) : null;
  }

  // Money arrives as text on purpose — a JSON number is a double in a browser, which is the mistake
  // numeric(12,2) exists to avoid. It becomes a number here only because the page formats it with
  // Intl.NumberFormat, and only for showing. A credit limit in kronor cannot reach the point where a
  // double loses a öre (that is around 90 billion), and nothing is computed from it.
  function figure(value) {
    if (value === null || value === undefined || value === '') return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // The server's record → the shape customers-desktop.html has always read.
  function fromServer(c, pageId) {
    const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);
    return {
      id: pageId,
      sharedId: c.id,
      sharedNo: c.no,
      _server: c,                       // kept whole, see the note at the top of this file
      name: c.name,
      status: c.status || 'active',
      city: dash(c.city),
      country: c.country || 'Sweden',
      org: dash(c.org),
      vat: dash(c.vat),
      email: dash(c.email),
      phone: dash(c.phone),
      website: dash(c.website),
      since: c.since || '',
      industry: dash(c.industry),
      ctype: c.type ? (TYPE_WORDS[c.type] || c.type) : '—',
      preferred: dash(c.preferred),
      notes: Array.isArray(c.notes) ? c.notes : [],
      contacts: Array.isArray(c.contacts) ? c.contacts : [],
      // The commercial half only arrives for a session that may see it. For everybody else these
      // stay at their empty values rather than at something invented, and the page shows a dash —
      // which is the truth: this session was not given them.
      terms: c.terms === undefined || c.terms === null ? '—' : `${days(c.terms)} days`,
      credit: figure(c.credit),
      currency: c.currency || 'SEK',
      pricelist: dash(c.priceList),
      deliveryTerms: dash(c.deliveryTerms),
      discountAgreement: dash(c.discountAgreement),
      billing: lines(c.billing).length ? lines(c.billing) : [c.name],
      // Where the steel goes, which is not always where the invoice goes. The screen has shown the
      // two side by side since it was written, and until shipping_address existed the shipping card
      // was showing the billing address under a heading that said otherwise. Falls back to the
      // billing address when nobody has given a separate one, which is the usual case and is what
      // the screen did before — the difference is that now it can be told apart.
      shipping: lines(c.shipping).length ? lines(c.shipping)
        : (lines(c.billing).length ? lines(c.billing) : [c.name]),
      quotes: [],
      invoices: [],
      documents: [],
      seesMoney: c.terms !== undefined || c.credit !== undefined
    };
  }

  // The page's record → the arguments save_customer takes. A dash is how this page writes "nothing",
  // so it goes back as nothing rather than as the character.
  function toServer(c) {
    const kept = c._server || {};
    // Does this record carry its own commercial half?
    //
    // For one that came from the server, only if the granted second call was merged into it — a
    // welder's copy has no credit limit and no terms at all, and sending the screen's empty values
    // back would blank the columns rather than leave them. For one typed in on this screen there is
    // no server record to fall back to, and whoever typed it is somebody the database lets write, so
    // what they typed is the whole truth about it.
    const knows = c._server ? c.seesMoney === true : true;
    const said = (v, fallback) => {
      if (v === undefined || v === null || v === '' || v === '—') return fallback === undefined ? null : fallback;
      return v;
    };
    return {
      id: c.sharedId ? Number(c.sharedId) : null,
      name: c.name,
      status: c.status || 'active',
      city: said(c.city),
      country: said(c.country),
      org_no: said(c.org),
      vat_no: said(c.vat),
      email: said(c.email),
      phone: said(c.phone),
      website: said(c.website),
      industry: said(c.industry),
      customer_since: said(c.since),
      // Not edited on this screen, so it goes back exactly as it came rather than as the word the
      // screen displays — "Direct" is not a value the column accepts.
      customer_type: said(kept.type),
      is_preferred: kept.isPreferred === true,
      preferred_contact: said(c.preferred),
      notes: null,
      credit_limit: knows ? said(c.credit, null) : said(kept.credit),
      currency: c.currency || 'SEK',
      payment_terms_days: knows ? days(c.terms) : days(kept.terms),
      price_list: knows ? said(c.pricelist) : said(kept.priceList),
      delivery_terms: knows ? said(c.deliveryTerms) : said(kept.deliveryTerms),
      discount_agreement: knows ? said(c.discountAgreement) : said(kept.discountAgreement),
      billing_address: (c.billing || []).filter((l) => l && l !== '—').join('\n') || null,
      // Only when it differs. Sending a copy of the billing address as the shipping address would
      // make "they are the same" indistinguishable from "somebody typed it twice", and the first is
      // a fact worth keeping.
      shipping_address: sameAddress(c) ? null
        : ((c.shipping || []).filter((l) => l && l !== '—').join('\n') || null)
    };
  }

  function sameAddress(c) {
    const one = (c.billing || []).filter((l) => l && l !== '—').join('\n');
    const other = (c.shipping || []).filter((l) => l && l !== '—').join('\n');
    return one === other;
  }

  // The contacts, which go through their own call because they are a list. Only the four fields the
  // table has; `department` is on the page's records and has no column, so sending it would be
  // sending something nothing reads.
  function contactsToServer(c) {
    return (c.contacts || []).map((k) => ({
      name: k.name,
      role: k.role === '—' ? null : (k.role || null),
      email: k.email === '—' ? null : (k.email || null),
      phone: k.phone === '—' ? null : (k.phone || null),
      primary: k.primary === true
    }));
  }

  const api = { fromServer, toServer, contactsToServer, days, lines, figure, sameAddress, TYPE_WORDS };
  root.CustomerRecord = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
