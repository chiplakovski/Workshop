'use strict';

// The project, in the two shapes it has to exist in.
//
// The estimating screen is the one that creates projects — it is the "Project / Estimator" module —
// and its record is wider than the project table in one direction and narrower in another. Wider:
// it holds work items, options, terms, exclusions, a revision history and a priced bill of materials,
// none of which has a column yet. Narrower: it never sets the hold reason or the material state,
// which the database does hold and the planning screen writes.
//
// Which makes the rule from customer-record.js the important one here too:
//
//   A page that shows a subset of a record must not save a subset of it.
//
// save_project replaces the record, so what the screen does not show rides along in `_server`.
(function (root) {
  const amount = (v, fallback) => {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const whole = (v, fallback) => {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  };
  const said = (v, fallback) => {
    if (v === undefined || v === null || v === '' || v === '—') {
      return fallback === undefined ? null : fallback;
    }
    return v;
  };

  // The screen keeps the kinds of work as a list and the column is one text field, which is right:
  // nothing queries it, it is read back and shown. Joined and split on the same separator so a round
  // trip is lossless for anything that does not itself contain a comma.
  function kinds(text) {
    if (!text) return [];
    return String(text).split(',').map((k) => k.trim()).filter(Boolean);
  }

  function fromServer(p) {
    return {
      _server: p,
      id: p.id,
      no: p.no,
      name: p.name,
      customerId: p.customerId,
      customer: p.customer,
      status: p.status,
      phase: p.phase || '',
      progress: whole(p.progress, 0),
      plannedHours: amount(p.plannedHours, 0),
      usedHours: amount(p.usedHours, 0),
      deadline: p.deadline || '',
      plannedStart: p.plannedStart || '',
      actualStart: p.actualStart || '',
      plannedCompletion: p.plannedCompletion || '',
      expectedCompletion: p.expectedCompletion || '',
      actualCompletion: p.actualCompletion || '',
      closedDate: p.closedDate || '',
      responsible: p.responsible || '',
      materialStatus: p.materialStatus || '',
      poNumber: p.poNumber || '',
      workshop: p.workshop || '',
      description: p.description || '',
      holdReason: p.holdReason || '',
      holdComment: p.holdComment || '',
      expectedResume: p.expectedResume || '',
      cancelReason: p.cancelReason || '',
      // The money only arrives for a session that may see it; for everybody else it stays zero and the
      // screen shows nothing rather than something invented.
      quotedValue: amount(p.quotedValue, 0),
      types: kinds(p.workTypes),
      // Lists this screen holds and the database has nowhere for. Empty, never invented.
      activity: [],
      revisionSnapshots: []
    };
  }

  function toServer(p) {
    const kept = p._server || {};
    return {
      id: p.id ? Number(p.id) : null,
      name: p.name,
      customer_id: p.customerId ? Number(p.customerId) : null,
      // 'active' and 'draft' are the frontend's other names for 'production' and 'quotation'.
      // save_project translates them, which is where that belongs — the vocabulary is the database's
      // business and a second copy of the aliases here is a second thing to keep in step.
      status: said(p.status, 'quotation'),
      planned_hours: amount(p.plannedHours, amount(kept.plannedHours, 0)),
      progress: whole(p.progress, whole(kept.progress, 0)),
      deadline: said(p.deadline, said(kept.deadline)),
      description: said(p.description, said(kept.description)),
      phase: said(p.phase, said(kept.phase)),
      work_types: (p.types && p.types.length) ? p.types.join(', ') : said(kept.workTypes),
      po_number: said(p.poNumber, said(kept.poNumber)),
      workshop: said(p.workshop, said(kept.workshop)),
      // The estimating screen calls this the project manager and writes it as `pm`.
      responsible: said(p.responsible, said(p.pm, said(kept.responsible))),
      material_status: said(p.materialStatus, said(kept.materialStatus)),
      notes: said(p.notes, said(kept.notes)),
      planned_start: said(p.plannedStart, said(kept.plannedStart)),
      planned_completion: said(p.plannedCompletion, said(kept.plannedCompletion)),
      expected_completion: said(p.expectedCompletion, said(kept.expectedCompletion)),
      deliver_on: said(p.actualCompletion, said(kept.actualCompletion)),
      hold_reason: said(p.holdReason, said(kept.holdReason)),
      hold_comment: said(p.holdComment, said(kept.holdComment)),
      expected_resume: said(p.expectedResume, said(kept.expectedResume)),
      cancel_reason: said(p.cancelReason, said(kept.cancelReason)),
      // A project with nothing priced yet has no quoted value, and zero is not the same answer as
      // "nobody has quoted it" — the column allows NULL for exactly that difference.
      quoted_value: amount(p.quotedValue, 0) > 0 ? amount(p.quotedValue, 0)
        : (amount(kept.quotedValue, 0) > 0 && !('quotedValue' in p) ? amount(kept.quotedValue, 0) : null)
    };
  }

  const api = { fromServer, toServer, kinds, amount, whole };
  root.ProjectRecord = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
