'use strict';

// The jobcard, in the two shapes it has to exist in.
//
// Thinner than customer-record.js, and that is not an accident: views.sql was written to hand the
// pages the field names they already read, so most of a jobcard needs no translation at all. What is
// left is the handful of places where the screen and the column genuinely disagree, plus the rule that
// applies to every screen wired this way:
//
//   A page that shows a subset of a record must not save a subset of it.
//
// save_jobcard replaces the record. The form shows the job's identity and its plan; it does not show
// the heat number, the material certificate, the notes, the progress or the status. Sending those back
// as empty because the form did not display them would clear them on every edit.
(function (root) {
  // What the screen writes when nobody has looked yet. The column allows NULL for exactly that, so
  // the two say the same thing in different words and this is where they meet.
  const UNCHECKED = 'not-checked';

  function day(value) {
    if (!value) return null;
    return String(value).slice(0, 10);
  }
  function whole(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }
  function amount(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function fromServer(j, pageId) {
    return {
      id: pageId,
      sharedId: j.id,
      no: j.no,
      _server: j,
      projectId: j.projectId,
      projectNo: j.projectNo,
      customerId: j.customerId,
      customer: j.customer,
      title: j.title,
      item: j.item || '',
      quantity: whole(j.quantity, 1),
      revision: whole(j.revision, 0),
      drawingNo: j.drawingNo || '',
      workType: j.workType || '',
      location: j.location || '',
      priority: j.priority || 'normal',
      responsible: j.responsible || '',
      status: j.status,
      progress: whole(j.progress, 0),
      plannedHours: amount(j.plannedHours, 0),
      plannedStart: day(j.plannedStart),
      plannedCompletion: day(j.plannedCompletion),
      actualStart: day(j.actualStart),
      actualCompletion: day(j.actualCompletion),
      deliveryTarget: day(j.deliveryTarget),
      materialReadiness: j.materialReadiness || UNCHECKED,
      inspectionRequired: j.inspectionRequired === true,
      heatNo: j.heatNo || '',
      materialCertRef: j.materialCertRef || '',
      notes: j.notes || '',
      archived: j.archived === true,
      // The steps arrive already in the screen's shape, nested by views.sql — `no`, `desc`,
      // `plannedHours`, `loggedHours`, `status`, and the id that makes editing the list possible
      // without losing the hours booked against a step.
      operations: Array.isArray(j.operations) ? j.operations : [],
      // Lists the screen holds and the database has nowhere for yet. Left EMPTY rather than filled
      // with anything: a screen showing three real workers beside two invented ones is worse than one
      // showing three and nothing else, because nobody can tell which is which.
      workers: [],
      machines: [],
      bom: [],
      documents: [],
      history: [],
      problems: []
    };
  }

  function toServer(j) {
    const kept = j._server || {};
    const said = (v, fallback) => {
      if (v === undefined || v === null || v === '' || v === '—') {
        return fallback === undefined ? null : fallback;
      }
      return v;
    };
    return {
      id: j.sharedId ? Number(j.sharedId) : null,
      // The customer is deliberately absent: save_jobcard takes it from the project, so a jobcard can
      // never carry one that disagrees with the project it is on.
      project_id: j.projectId ? Number(j.projectId) : null,
      title: j.title,
      status: said(j.status, kept.status || 'draft'),
      item: said(j.item),
      quantity: whole(j.quantity, 1),
      drawing_no: said(j.drawingNo),
      revision: whole(j.revision, 0),
      planned_hours: amount(j.plannedHours, 0),
      planned_start: said(j.plannedStart),
      planned_completion: said(j.plannedCompletion),
      delivery_target: said(j.deliveryTarget),
      work_type: said(j.workType),
      location: said(j.location),
      priority: said(j.priority),
      responsible: said(j.responsible),
      // 'not-checked' is a real answer — somebody has not looked — and the column holds it. It is only
      // an empty string that means nothing was said.
      material_readiness: said(j.materialReadiness, UNCHECKED),
      // Not on the form, so they come back as they arrived rather than as nothing.
      heat_no: said(j.heatNo, said(kept.heatNo)),
      material_cert_ref: said(j.materialCertRef, said(kept.materialCertRef)),
      notes: said(j.notes, said(kept.notes)),
      progress: whole(j.progress, whole(kept.progress, 0)),
      inspection_required: j.inspectionRequired === true
    };
  }

  // The steps, for their own call. The id goes back so a step that moved is the same step — without
  // it every hour ever booked on it would be detached from it, which the database refuses outright.
  function operationsToServer(j) {
    return (j.operations || []).map((o) => ({
      id: o.id ? String(o.id) : null,
      desc: o.desc,
      instructions: o.instructions || null,
      plannedHours: amount(o.plannedHours, 0),
      plannedStart: day(o.plannedStart),
      inspectionCheckpoint: o.inspectionCheckpoint === true,
      notes: o.notes || null
    }));
  }

  const api = { fromServer, toServer, operationsToServer, day, whole, amount, UNCHECKED };
  root.JobcardRecord = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
