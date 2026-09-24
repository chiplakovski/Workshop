'use strict';

// The quality register, between the screen's words and the database's.
//
// Three records, and each of them is mostly a rename — but two of the translations are decisions
// rather than spellings, and they are why this file exists rather than an inline map:
//
// **The checklist.** On screen it is an array of lines; in the database it is `inspection_check`, one
// row per line, because a JSON array cannot have a constraint on its rows and this is the one list in
// the app that is evidence. The screen writes a verdict as `resultItem`, and writes the empty string
// for a line nobody has answered. That empty string has to arrive as NULL: '' and "unanswered" are the
// same fact, and two spellings of it is how a blank line gets counted as a pass. It comes back as ''
// again, because the page's dropdown renders a null as the word null.
//
// **The status vocabularies.** Both of them were found to disagree with the schema, and in both cases
// the schema was changed rather than the screen — but the disagreement is worth keeping in mind here,
// because the values pass through this file untranslated and a future rename on either side has to
// happen in both.
//
// What this file does NOT do is decide anything. The refusals — a hold with no evidence behind it, an
// NCR closed on nothing, using a non-conforming part as it is with nobody signing for it — are all in
// the database, where a second caller has to obey them too.
(function (root) {
  const said = (v, fallback) => {
    if (v === undefined || v === null || v === '' || v === '—') {
      return fallback === undefined ? null : fallback;
    }
    return v;
  };
  const amount = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const day = (v) => {
    if (!v) return null;
    const text = String(v).trim();
    if (!text) return null;
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[0] : null;
  };
  const yes = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
  const id = (v) => {
    const parsed = Number(v);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  };

  // ── The checklist ──────────────────────────────────────────────────────────────────────────

  const VERDICTS = ['pass', 'fail', 'na'];

  // One line, on its way to the database. A line with no name is dropped rather than sent: the
  // database refuses it, and the screen's default checklist can carry a blank row.
  function checkToServer(line) {
    // Trimmed before the decision, not after. A line whose name is three spaces is a line with no
    // name: the database drops it and so must this, or the screen counts three lines of evidence and
    // the record holds two.
    const item = said(line && line.item === undefined ? null : String(line.item === null
      || line.item === undefined ? '' : line.item).trim());
    if (item === null) return null;
    const verdict = said(line.resultItem);
    const nominal = amount(line.nominal);
    const lower = amount(line.lower);
    const upper = amount(line.upper);
    return {
      item: item,
      // 'measurement' is the screen's own marker for "this row is a measured one" rather than a
      // verdict, so it must never arrive as one — the database allows three words and that is not
      // among them.
      result: VERDICTS.indexOf(verdict) === -1 ? '' : verdict,
      nominal: nominal,
      // A nominal with no tolerance band goes across exactly as typed, and the database refuses it in
      // its own words. The first version of this filled the missing band in with zeroes so the save
      // would go through — which is a tolerance nobody agreed to, written into the evidence, to avoid
      // an error message. A refusal that says "a nominal with no tolerance to judge it by" is the
      // right outcome: the line is wrong and somebody has to look at it.
      lower: lower,
      upper: upper,
      actual: amount(line.actual),
      note: said(line.note)
    };
  }

  function checklistToServer(lines) {
    if (!Array.isArray(lines)) return [];
    return lines.map(checkToServer).filter(Boolean);
  }

  // ── An inspection ──────────────────────────────────────────────────────────────────────────

  // What the request form may set, in the screen's words. The result is not in this list and cannot
  // be: an inspection request that could arrive already passed is a form for passing work without
  // looking at it, and complete_inspection is the only door to a verdict.
  const INSPECTION_SETTABLE = [
    'projectNo', 'jobcard', 'type', 'operation', 'component', 'drawingNo', 'drawingRev', 'method',
    'acceptanceCriteria', 'customerWitness', 'materialTraceabilityOk', 'plannedDate', 'inspector',
    'status', 'notes'
  ];

  // The overlay rule, third screen running: this form shows a subset of an inspection and
  // save_inspection replaces the record, so anything the form does not show has to be sent back as
  // the database already holds it. `_server` is what the snapshot handed over.
  function inspectionToServer(payload, lookup) {
    const kept = (payload && payload._server) || {};
    const whole = {};
    INSPECTION_SETTABLE.forEach((field) => {
      whole[field] = (payload && Object.prototype.hasOwnProperty.call(payload, field))
        ? payload[field] : kept[field];
    });
    const find = lookup || {};
    return {
      id: id(payload && (payload.id !== undefined ? payload.id : kept.id)),
      project_id: (find.project && find.project(whole.projectNo)) || null,
      jobcard_id: (find.jobcard && find.jobcard(whole.jobcard)) || null,
      // `type` on screen, `kind` in the database — the word this schema uses for the kind of any
      // thing. Nothing else in the record is renamed on the way out.
      kind: said(whole.type),
      operation: said(whole.operation),
      component: said(whole.component),
      drawing_no: said(whole.drawingNo),
      drawing_rev: said(whole.drawingRev),
      method: said(whole.method),
      acceptance_criteria: said(whole.acceptanceCriteria),
      customer_witness: yes(whole.customerWitness),
      material_traceability_ok: yes(whole.materialTraceabilityOk),
      planned_date: day(whole.plannedDate),
      inspector: said(whole.inspector),
      status: said(whole.status, 'requested'),
      notes: said(whole.notes)
    };
  }

  // A result, on its way to complete_inspection. Only the five things a verdict consists of: the
  // rest of the record is not the completing screen's to change, which is also what the floor's
  // column grant allows and no more.
  function resultToServer(no, resultData, lookup) {
    const found = resultData || {};
    const find = lookup || {};
    return {
      id: (find.inspection && find.inspection(no)) || null,
      result: said(found.result),
      findings: said(found.findings),
      critical: yes(found.critical),
      checks: checklistToServer(found.checklist),
      actual_date: day(found.actualDate)
    };
  }

  // Back the other way. The snapshot already speaks the screen's names, so this is the two places it
  // cannot: an unanswered verdict has to be '' rather than null, and `_server` has to ride along for
  // the overlay rule above.
  function inspectionFromServer(record) {
    const shaped = Object.assign({}, record);
    shaped.checklist = (Array.isArray(record && record.checklist) ? record.checklist : [])
      .map((line) => Object.assign({}, line, { resultItem: line.resultItem || '' }));
    shaped.activity = Array.isArray(record && record.activity) ? record.activity : [];
    shaped.notes = Array.isArray(record && record.notes) ? record.notes
      : (record && record.notes ? [{ text: record.notes, author: record.inspector || '' }] : []);
    shaped._server = Object.assign({}, record);
    return shaped;
  }

  // ── A non-conformance ──────────────────────────────────────────────────────────────────────

  // The raise form's fields. Nothing about containment, disposition, verification or closure is here:
  // those are steps, each with its own refusal, and a form that could set them all at once could
  // close a non-conformance by filling in a screen.
  const NCR_SETTABLE = [
    'title', 'projectNo', 'jobcard', 'category', 'severity', 'description', 'responsiblePerson',
    'dueDate', 'operation', 'component', 'material', 'supplier', 'notes'
  ];

  function ncrToServer(payload, lookup) {
    const kept = (payload && payload._server) || {};
    const whole = {};
    NCR_SETTABLE.forEach((field) => {
      whole[field] = (payload && Object.prototype.hasOwnProperty.call(payload, field))
        ? payload[field] : kept[field];
    });
    const find = lookup || {};
    return {
      id: id(payload && (payload.id !== undefined ? payload.id : kept.id)),
      title: said(whole.title),
      project_id: (find.project && find.project(whole.projectNo)) || null,
      jobcard_id: (find.jobcard && find.jobcard(whole.jobcard)) || null,
      category: said(whole.category),
      severity: said(whole.severity, 'major'),
      description: said(whole.description),
      responsible: said(whole.responsiblePerson),
      due_on: day(whole.dueDate),
      operation: said(whole.operation),
      component: said(whole.component),
      material: said(whole.material),
      // The form offers merchants by name, so the name is turned back into the row it came from. A
      // name that matches nothing is sent as nothing rather than guessed at.
      supplier_id: (find.supplier && find.supplier(whole.supplier)) || null,
      notes: said(whole.notes)
      // detected_by is deliberately absent. The screen had 'Aleksandar C.' written into the page, so
      // every non-conformance in the register would have been found by the same person whoever was
      // standing there. save_ncr takes it from the session.
    };
  }

  function ncrFromServer(record) {
    const shaped = Object.assign({}, record);
    shaped.activity = Array.isArray(record && record.activity) ? record.activity : [];
    shaped.notes = Array.isArray(record && record.notes) ? record.notes
      : (record && record.notes ? [{ text: record.notes, author: record.detectedBy || '' }] : []);
    shaped._server = Object.assign({}, record);
    return shaped;
  }

  // ── The steps ──────────────────────────────────────────────────────────────────────────────

  // The screen calls six separate methods; the database has one function with a step, because the six
  // are one state machine and six functions would be six places deciding what follows what. This is
  // the map between them, and the second element is which of the two arguments the step's reference
  // goes in.
  const STEPS = {
    addNcrContainment: 'containment',
    setNcrDisposition: 'disposition',
    assignNcrCorrectiveAction: 'corrective-action',
    verifyNcrCorrective: 'verify',
    closeNcr: 'close',
    reopenNcr: 'reopen'
  };

  function stepToServer(method, no, text, reference, lookup) {
    const find = lookup || {};
    return {
      id: (find.ncr && find.ncr(no)) || null,
      step: STEPS[method] || null,
      text: said(text, ''),
      ref: said(reference)
    };
  }

  // ── A hold ─────────────────────────────────────────────────────────────────────────────────

  function releaseToServer(no, evidence, lookup) {
    const find = lookup || {};
    const given = evidence || {};
    return {
      hold_id: (find.hold && find.hold(no)) || null,
      authority: said(given.releaseAuthority, ''),
      reason: said(given.releaseReason, '')
    };
  }

  function holdFromServer(record) {
    const shaped = Object.assign({}, record);
    shaped.activity = Array.isArray(record && record.activity) ? record.activity : [];
    shaped._server = Object.assign({}, record);
    return shaped;
  }

  // Which of the three tables a note goes on. The screen's word is a collection name; the database
  // takes the table, and a collection it does not know about is refused here rather than sent as a
  // note that would land nowhere.
  const NOTE_ON = {
    qualityInspections: 'inspection',
    inspection: 'inspection',
    qualityNcrs: 'ncr',
    ncr: 'ncr',
    qualityHolds: 'quality_hold',
    hold: 'quality_hold'
  };

  function noteToServer(collection, no, note, lookup) {
    const find = lookup || {};
    const entity = NOTE_ON[collection] || null;
    const which = { inspection: 'inspection', ncr: 'ncr', quality_hold: 'hold' }[entity];
    return {
      entity: entity,
      entity_id: (which && find[which] && find[which](no)) || null,
      text: said(note && note.text, '')
    };
  }

  const api = {
    inspectionToServer, inspectionFromServer, resultToServer,
    ncrToServer, ncrFromServer, stepToServer, releaseToServer, holdFromServer, noteToServer,
    checklistToServer, checkToServer, STEPS, NOTE_ON,
    INSPECTION_SETTABLE, NCR_SETTABLE,
    day, said, amount, yes, id
  };
  root.QualityRecord = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
