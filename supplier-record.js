'use strict';

// A merchant, between the register on screen and the columns underneath.
//
// Four of the six fields the coverage meter called missing here were renames — `type`, `payment`,
// `delivery` and `minimum` are `supplier_type`, `payment_terms_days`, `delivery_terms` and
// `minimum_order` — so most of this file is a map. Three things in it are not:
//
// **The payment terms.** On screen they are the words "30 days"; in the database they are a count of
// days. The same translation customer-record.js already makes, and the same reason: a workshop writes
// "30 days", "30 dagar", "Net 30" and "30", and the column has to hold one of them.
//
// **The rating.** It is a judgement about somebody's company, out of five, and NULL means nobody has
// made it. Absence has to survive the round trip in both directions — the screen printed four stars
// beside every supplier's name because a missing rating was being read as 4, and `coalesce` on the way
// down would mean a rating given could never be taken away.
//
// **What is NOT sent.** Six figures used to be saved onto the supplier record: a performance object, the
// spend to date and its change, the count of open orders and their value, and overdue deliveries and
// theirs. Every one is an answer computed from rows elsewhere. A stored answer has to be kept in step
// with what it came from, and this one was not being computed at all — the numbers were written into the
// page.
(function (root) {
  const said = (v, fallback) => {
    if (v === undefined || v === null || v === '' || v === '—') {
      return fallback === undefined ? null : fallback;
    }
    return v;
  };
  const trimmed = (v) => {
    const kept = said(v);
    return kept === null ? null : String(kept).trim() || null;
  };

  // "30 days" → 30. Digits from anywhere in the text, because the words around them are in whichever
  // language the person was using. A count already given as a number comes through unchanged.
  function paymentDays(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
    const digits = String(value).match(/\d+/);
    if (!digits) return null;
    const days = Number(digits[0]);
    return Number.isFinite(days) && days >= 0 ? days : null;
  }

  // And back, in the words the screen shows. The unit comes from the caller because it is a word in a
  // dictionary, not a fact about the supplier.
  function paymentWords(days, unit) {
    if (days === undefined || days === null || days === '') return null;
    const count = Number(days);
    if (!Number.isFinite(count)) return null;
    return `${count} ${unit || 'days'}`;
  }

  // Out of five, or nobody has said. Not rounded and not defaulted: 4.5 is a rating somebody gave and
  // 4 is a different one, and absence is neither.
  function rating(value) {
    if (value === undefined || value === null || value === '') return null;
    const score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 5) return null;
    return score;
  }

  // A contact on screen is a five-element row: initials, name, role, email, telephone. The initials are
  // computed from the name for the avatar, so they are not stored — a stored initial is one that can
  // disagree with the name beside it.
  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).map((part) => part[0])
      .slice(0, 2).join('').toUpperCase();
  }

  function contactsToServer(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map((row, at) => {
      const given = Array.isArray(row)
        ? { name: row[1], role: row[2], email: row[3], phone: row[4] }
        : (row || {});
      const name = trimmed(given.name);
      if (name === null) return null;
      return {
        name: name,
        role: trimmed(given.role),
        email: trimmed(given.email),
        phone: trimmed(given.phone),
        // The first in the list is the main one, which is what the screen shows a chip beside. An object
        // that says so outright wins over the position.
        primary: Array.isArray(row) ? at === 0 : !!given.primary
      };
    }).filter(Boolean);
  }

  function contactsFromServer(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => [
      initials(row.name), row.name, row.role || '', row.email || '', row.phone || ''
    ]);
  }

  // What the register form and the edit form between them may set. Neither the reference nor the figures
  // computed elsewhere are in it.
  // `description` rather than `notes`, and the difference is not cosmetic. On this screen `notes` is the
  // dated list in the Notes panel — one row per thing somebody wrote, with a date and an author. In the
  // database `notes` is the standing description of the merchant, one text column. Two different things
  // under one word, which showed up the first time a round trip was tested: the note list arrived, was
  // put in `notes`, and went back down as the description — so the standing text was replaced by
  // "2026-09-01,Lead time up to three weeks,Anna Berg".
  //
  // So the column is called `description` on this side of the wire, the dated list keeps `notes`, and
  // the two can never be each other again. The dated entries go through add_supplier_note, into the
  // append-only trail, where a note nobody can quietly edit belongs.
  const SETTABLE = [
    'name', 'category', 'status', 'org', 'vat', 'email', 'phone', 'website', 'address', 'city',
    'country', 'type', 'established', 'delivery', 'minimum', 'currency', 'rating', 'payment',
    'description'
  ];

  // The overlay rule, fourth screen running: the New Supplier form asks for four fields and
  // save_supplier replaces the record, so everything it does not show has to ride along as the database
  // already holds it. Without this, correcting a supplier's category would clear their VAT number.
  function toServer(payload, lookup) {
    const kept = (payload && payload._server) || {};
    const whole = {};
    SETTABLE.forEach((field) => {
      whole[field] = (payload && Object.prototype.hasOwnProperty.call(payload, field))
        ? payload[field] : kept[field];
    });
    return {
      id: (() => {
        const given = payload && (payload.sharedId !== undefined ? payload.sharedId : payload.id);
        const at = Number(given !== undefined && given !== null ? given : kept.id);
        return Number.isFinite(at) && at > 0 ? Math.trunc(at) : null;
      })(),
      name: trimmed(whole.name),
      category: trimmed(whole.category),
      status: said(whole.status, 'active'),
      org_no: trimmed(whole.org),
      vat_no: trimmed(whole.vat),
      email: trimmed(whole.email),
      phone: trimmed(whole.phone),
      website: trimmed(whole.website),
      address: trimmed(whole.address),
      city: trimmed(whole.city),
      country: trimmed(whole.country),
      supplier_type: trimmed(whole.type),
      established: trimmed(whole.established),
      delivery_terms: trimmed(whole.delivery),
      minimum_order: trimmed(whole.minimum),
      currency: said(whole.currency, 'SEK'),
      rating: rating(whole.rating),
      payment_terms_days: paymentDays(whole.payment),
      notes: trimmed(whole.description)
    };
  }

  // Back the other way. The snapshot already speaks the screen's names; what it cannot do is turn a
  // count of days into the words above a label reading "Payment terms", rebuild the avatar initials, or
  // carry `_server` for the overlay rule.
  function fromServer(record, words) {
    const given = record || {};
    const shaped = Object.assign({}, given);
    shaped.sharedId = given.id;
    shaped.sharedNo = given.no;
    shaped.contacts = contactsFromServer(given.contacts);
    shaped.activity = Array.isArray(given.activity) ? given.activity : [];
    // The column, under the name it keeps on this side of the wire. See SETTABLE above for why it is not
    // called `notes` here.
    shaped.description = given.notes === undefined ? undefined : given.notes;
    // And the dated entries, out of the append-only trail. These are what the Notes panel walks.
    shaped.notes = shaped.activity.filter((entry) => entry.note)
      .map((entry) => [String(entry.date || '').slice(0, 10), entry.text || '', entry.author || '']);
    shaped.rating = rating(given.rating);
    shaped.docs = [];
    shaped.purchaseOrders = [];
    // `items` on this screen is a rollup of what has been bought from a merchant — total quantity and
    // total spend — which needs the invoices this system does not keep. It stays empty rather than being
    // filled with something else that happens to be a list of items.
    shaped.items = [];
    // What they quote, which IS answerable, in the rows the panel walks: the item, the merchant's own
    // article number, their price and their lead time. Only the office has it — a price list is a price.
    shaped.priceList = Array.isArray(given.priceList)
      ? given.priceList.map((line) => [
        [line.code, line.description].filter(Boolean).join(' — '),
        line.articleNo || '—',
        [line.price, line.currency].filter(Boolean).join(' '),
        line.leadTime ? `${line.leadTime} d` : '—'
      ])
      : [];
    shaped._server = Object.assign({}, given);
    // Filled in only when the office has the money payload — a welder's snapshot has no terms at all,
    // and an empty field is the truthful thing for them to see rather than a guess.
    if (words && words.terms !== undefined) {
      shaped.payment = paymentWords(words.terms, words.unit);
    }
    return shaped;
  }

  const api = {
    toServer, fromServer, contactsToServer, contactsFromServer,
    paymentDays, paymentWords, rating, initials, trimmed, said, SETTABLE
  };
  root.SupplierRecord = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
