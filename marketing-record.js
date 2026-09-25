'use strict';

// The sales pipeline, between the board on screen and the columns underneath.
//
// This one is almost entirely a rename, and that is the finding rather than the code. The coverage meter
// reported twelve fields across leads and enquiries as needing a column, README and BACKEND.md both said
// the remaining schema width was "concentrated on estimating, purchasing and the sales pipeline" — and
// every one of the twelve has had a column since the pipeline was written, under the longer name the
// schema uses for a date or a figure. `size` is `company_size`, `value` is `estimated_value`,
// `nextFollowUp` is `next_follow_up_on`, and so on down the list.
//
// Three things here are not a rename:
//
// **do-not-contact.** It is the law, and the screen holds it as `dnc` with a contact preference beside it.
// Both travel; neither is ever guessed at. A lead with no preference recorded is not a lead who prefers
// email.
//
// **The status the screen calls `disqualified`.** A lead is disqualified because it was never going to be
// work — wrong trade, wrong country, no budget. An opportunity is lost, to somebody. The schema had only
// `lost` and the filter has offered both since it was written.
//
// **What is NOT sent.** A lead's `linkedCustomerId` and its converted status are read-only here: a lead
// becomes a customer through convert_lead, which makes the customer and ties the two together in one
// transaction. A form that could set the status by itself could mark a lead converted to nobody.
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
  const amount = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const parsed = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const percent = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const parsed = Number(v);
    if (!Number.isFinite(parsed)) return null;
    return Math.min(100, Math.max(0, Math.trunc(parsed)));
  };
  const day = (v) => {
    if (!v) return null;
    const match = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[0] : null;
  };
  const yes = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
  const id = (v) => {
    const parsed = Number(v);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  };

  // The screen's own word for a priority, against the three the column allows. 'medium' is what the
  // prospect queue writes for a finding it is unsure about, and the column says 'normal'.
  const PRIORITY = { medium: 'normal', normal: 'normal', high: 'high', low: 'low' };
  function priority(value) {
    const given = said(value);
    return given === null ? null : (PRIORITY[String(given).toLowerCase()] || null);
  }

  const LEAD_SETTABLE = [
    'company', 'contact', 'email', 'phone', 'city', 'country', 'industry', 'size', 'source',
    'service', 'value', 'priority', 'status', 'owner', 'lastContact', 'nextFollowUp', 'commPref',
    'dnc', 'notes'
  ];

  // The overlay rule, fifth screen running. The lead form shows about half a lead.
  function leadToServer(payload) {
    const kept = (payload && payload._server) || {};
    const whole = {};
    LEAD_SETTABLE.forEach((field) => {
      whole[field] = (payload && Object.prototype.hasOwnProperty.call(payload, field))
        ? payload[field] : kept[field];
    });
    return {
      id: id(payload && (payload.id !== undefined ? payload.id : kept.id)),
      company: trimmed(whole.company),
      contact: trimmed(whole.contact),
      email: trimmed(whole.email),
      phone: trimmed(whole.phone),
      city: trimmed(whole.city),
      country: trimmed(whole.country),
      industry: trimmed(whole.industry),
      company_size: trimmed(whole.size),
      source: trimmed(whole.source),
      service_wanted: trimmed(whole.service),
      estimated_value: amount(whole.value),
      priority: priority(whole.priority),
      // A converted lead keeps its status: it became a customer through convert_lead, and this form
      // cannot undo that. The workflow refuses to change it too, so this is belt and braces on the one
      // field where a wrong answer loses the link between a company and the customer it became.
      status: said(whole.status) === 'converted' ? null : said(whole.status, 'new'),
      owner: trimmed(whole.owner),
      last_contact_on: day(whole.lastContact),
      // A follow-up is not sent for somebody who has asked not to be contacted. The database refuses it
      // and says so, which is the message somebody needs — but sending it at all would mean a save that
      // fails for a reason the person did not choose, on a field they may not have touched.
      next_follow_up_on: yes(whole.dnc) ? null : day(whole.nextFollowUp),
      contact_preference: said(whole.commPref),
      do_not_contact: yes(whole.dnc),
      notes: leadNotes(whole.notes)
    };
  }

  // The lead screen's notes are a list of dated entries; the column is one block of text. Joined rather
  // than dropped, because a lead's notes are most of what is known about them early on — and the
  // supplier register's version of this mistake is what the comment in supplier-record.js is about.
  function leadNotes(notes) {
    if (typeof notes === 'string') return trimmed(notes);
    if (!Array.isArray(notes) || !notes.length) return null;
    return notes.map((entry) => {
      if (typeof entry === 'string') return entry;
      const when = String((entry && entry.date) || '').slice(0, 10);
      const who = (entry && entry.author) || '';
      const what = (entry && entry.text) || '';
      return [when, who && `(${who})`, what].filter(Boolean).join(' ');
    }).filter(Boolean).join('\n') || null;
  }

  // Every reference to a row, as a number.
  //
  // This screen puts ids straight into its own markup — `onclick="openLeadForm(${l.id})"` — so what comes
  // back is the number 1, and `getLead` compares it with `===`. The snapshot sends ids as text, for the
  // reason everything shaped like a figure does. Left as text, every "open this lead" button on the wired
  // page found nothing and threw on the next line: the list rendered, and not one row in it could be
  // opened. Converted here rather than in the page, because it is the same three keys on every record.
  function numberedIds(shaped, keys) {
    keys.forEach((key) => {
      if (shaped[key] === undefined || shaped[key] === null || shaped[key] === '') {
        shaped[key] = null;
        return;
      }
      const at = Number(shaped[key]);
      shaped[key] = Number.isFinite(at) ? at : shaped[key];
    });
    return shaped;
  }

  function leadFromServer(record) {
    const given = record || {};
    const shaped = Object.assign({}, given);
    numberedIds(shaped, ['id', 'linkedCustomerId', 'linkedOpportunityId']);
    shaped.activity = Array.isArray(given.activity) ? given.activity : [];
    shaped.findings = Array.isArray(given.findings) ? given.findings : [];
    // One text column, one list on screen. Split on newlines, which is how the join above wrote it.
    shaped.notes = typeof given.notes === 'string' && given.notes.trim()
      ? given.notes.split(/\n+/).map((line) => ({ date: '', author: '', text: line.trim() }))
      : [];
    shaped.value = given.value === null || given.value === undefined ? null : Number(given.value);
    shaped._server = Object.assign({}, given);
    return shaped;
  }

  const OPPORTUNITY_SETTABLE = [
    'title', 'customerId', 'leadId', 'stage', 'value', 'probability', 'contact', 'industry',
    'services', 'scope', 'owner', 'expectedClose', 'expectedDecision', 'requiredDelivery',
    'competitor', 'decisionReason', 'nextAction', 'followUpDate', 'currency'
  ];

  function opportunityToServer(payload) {
    const kept = (payload && payload._server) || {};
    const whole = {};
    OPPORTUNITY_SETTABLE.forEach((field) => {
      whole[field] = (payload && Object.prototype.hasOwnProperty.call(payload, field))
        ? payload[field] : kept[field];
    });
    return {
      id: id(payload && (payload.id !== undefined ? payload.id : kept.id)),
      title: trimmed(whole.title),
      customer_id: id(whole.customerId),
      lead_id: id(whole.leadId),
      stage: said(whole.stage, 'discovery'),
      value: amount(whole.value),
      probability: percent(whole.probability),
      contact: trimmed(whole.contact),
      industry: trimmed(whole.industry),
      services: trimmed(whole.services),
      scope: trimmed(whole.scope),
      owner: trimmed(whole.owner),
      expected_close: day(whole.expectedClose),
      expected_decision_on: day(whole.expectedDecision),
      required_delivery_on: day(whole.requiredDelivery),
      competitor: trimmed(whole.competitor),
      decision_reason: trimmed(whole.decisionReason),
      next_action: trimmed(whole.nextAction),
      follow_up_on: day(whole.followUpDate),
      currency: said(whole.currency, 'SEK')
      // `company` is not sent. An enquiry belongs to a customer or to a lead and the name lives on that
      // record; a copy here is a copy that can disagree with whoever it points at.
    };
  }

  function opportunityFromServer(record) {
    const given = record || {};
    const shaped = Object.assign({}, given);
    numberedIds(shaped, ['id', 'leadId', 'customerId']);
    shaped.activity = Array.isArray(given.activity) ? given.activity : [];
    shaped.tenders = Array.isArray(given.tenders) ? given.tenders : [];
    shaped.value = given.value === null || given.value === undefined ? null : Number(given.value);
    shaped._server = Object.assign({}, given);
    return shaped;
  }

  // `ref` here is the customer's own reference for the tender, which is what every email about it
  // quotes. Our own is allocated by the database and is not something a form sets.
  const TENDER_SETTABLE = [
    'title', 'opportunityId', 'customerId', 'status', 'due', 'deadline', 'submitted', 'value',
    'company', 'ref', 'source', 'industry', 'description', 'requirements', 'responsible',
    'bidDecision', 'reminderDate'
  ];

  function tenderToServer(payload) {
    const kept = (payload && payload._server) || {};
    const whole = {};
    TENDER_SETTABLE.forEach((field) => {
      whole[field] = (payload && Object.prototype.hasOwnProperty.call(payload, field))
        ? payload[field] : kept[field];
    });
    const status = said(whole.status, 'in-progress');
    return {
      id: id(payload && (payload.id !== undefined ? payload.id : kept.id)),
      // The tender form has no title field. It identifies a tender by the customer's own reference and
      // the company — 'HH-2026-441, Helsingborgs Hamn AB' is how somebody asks about it — and `title` is
      // NOT NULL, so without this every tender saved from that form was refused for a box the screen does
      // not have. Their reference is what the record is called, and nothing is invented: it falls back to
      // what was actually typed, in the order somebody would say it.
      title: trimmed(whole.title) || trimmed(whole.ref) || trimmed(whole.company),
      opportunity_id: id(whole.opportunityId),
      customer_id: id(whole.customerId),
      status: status,
      // The screen's field is `deadline`; the column is `due_on`. Both names are read, because the
      // snapshot sends the date under each and a tender saved from the form carries only the one the
      // form put on it.
      due_on: day(whole.deadline) || day(whole.due),
      company: trimmed(whole.company),
      customer_ref: trimmed(whole.ref),
      source: trimmed(whole.source),
      industry: trimmed(whole.industry),
      description: trimmed(whole.description),
      requirements: trimmed(whole.requirements),
      responsible: trimmed(whole.responsible),
      bid_decision: said(whole.bidDecision, 'pending'),
      reminder_on: day(whole.reminderDate),
      // A tender recorded as gone in gets today's date if none is on the record. The database refuses it
      // without one, and the refusal would be about a field the form does not show — whereas the date a
      // tender was marked as submitted IS the day somebody marked it, which is the honest answer.
      submitted_on: day(whole.submitted)
        || (['submitted', 'awarded', 'declined'].indexOf(status) === -1
          ? null : new Date().toISOString().slice(0, 10)),
      value: amount(whole.value)
    };
  }

  function tenderFromServer(record) {
    const given = record || {};
    const shaped = Object.assign({}, given);
    numberedIds(shaped, ['id', 'opportunityId', 'customerId']);
    shaped.activity = Array.isArray(given.activity) ? given.activity : [];
    shaped.value = given.value === null || given.value === undefined ? null : Number(given.value);
    shaped._server = Object.assign({}, given);
    return shaped;
  }

  const api = {
    leadToServer, leadFromServer, leadNotes, numberedIds,
    opportunityToServer, opportunityFromServer,
    tenderToServer, tenderFromServer,
    priority, amount, percent, day, yes, id, trimmed, said,
    LEAD_SETTABLE, OPPORTUNITY_SETTABLE, TENDER_SETTABLE, PRIORITY
  };
  root.MarketingRecord = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
