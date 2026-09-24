'use strict';

// The jobcard translation. Thinner than the customer's, because views.sql hands the pages the field
// names they already read — so what is tested here is the handful of places where the screen and the
// column genuinely disagree, and the rule that a partial form must not save a partial record.

const test = require('node:test');
const assert = require('node:assert/strict');
const JobcardRecord = require('../jobcard-record.js');

const SERVED = {
  id: '12', no: 'JC-2026-0004', title: 'Frame weldment', item: 'Frame',
  projectId: '3', projectNo: 'P-2026-002', customerId: '5', customer: 'MarineVent AB',
  quantity: 2, revision: 1, drawingNo: 'BR-4410-A', workType: 'fabrication',
  location: 'workshop', priority: 'high', responsible: 'Marko Ilic',
  status: 'in-progress', progress: 45, plannedHours: 24,
  plannedStart: '2026-09-28', plannedCompletion: '2026-10-09',
  actualStart: '2026-09-29', actualCompletion: null, deliveryTarget: '2026-10-12',
  materialReadiness: 'partial', inspectionRequired: true,
  heatNo: 'H240516-S534', materialCertRef: 'MTC_H240516.pdf', notes: 'Two off, mirrored',
  archived: false, created: '2026-09-20T08:14:22.108Z', createdBy: 'Lars Holm',
  operations: [
    { id: '30', no: 1, desc: 'Cut and prepare', plannedHours: 8, loggedHours: 8, status: 'completed' },
    { id: '31', no: 2, desc: 'Weld out', plannedHours: 16, loggedHours: 6.5, status: 'in-progress' }
  ]
};

test('a timestamp becomes the date the screen shows', () => {
  assert.equal(JobcardRecord.day('2026-09-20T08:14:22.108Z'), '2026-09-20');
  assert.equal(JobcardRecord.day(null), null);
  assert.equal(JobcardRecord.day(''), null);
});

test('"not checked" is a real answer and survives the round trip', () => {
  // The screen writes 'not-checked' when nobody has looked at the material yet, and the column holds
  // that word — they agree, which is the point of having adopted the screen's vocabulary. Only an
  // empty value means nothing was said at all.
  const fresh = JobcardRecord.fromServer({ ...SERVED, materialReadiness: null }, 1);
  assert.equal(fresh.materialReadiness, 'not-checked');
  assert.equal(JobcardRecord.toServer(fresh).material_readiness, 'not-checked');
  const partial = JobcardRecord.fromServer(SERVED, 1);
  assert.equal(JobcardRecord.toServer(partial).material_readiness, 'partial');
});

test('the steps arrive in the screen\'s own shape and go back with their ids', () => {
  const page = JobcardRecord.fromServer(SERVED, 1);
  assert.equal(page.operations.length, 2);
  assert.equal(page.operations[1].desc, 'Weld out');
  assert.equal(page.operations[1].loggedHours, 6.5);
  const out = JobcardRecord.operationsToServer(page);
  assert.deepEqual(out.map((o) => o.id), ['30', '31'],
    'the id is what makes a step that moved the same step, instead of a new one with the hours lost');
  assert.equal(out[0].plannedHours, 8);
});

test('a step added on screen has no id, which is how the database knows to make one', () => {
  const page = JobcardRecord.fromServer(SERVED, 1);
  page.operations.push({ desc: 'Dress and paint', plannedHours: 6 });
  const out = JobcardRecord.operationsToServer(page);
  assert.equal(out.length, 3);
  assert.equal(out[2].id, null);
  assert.equal(out[2].desc, 'Dress and paint');
});

test('there is no customer to send — the jobcard takes it from the project', () => {
  const out = JobcardRecord.toServer(JobcardRecord.fromServer(SERVED, 1));
  assert.ok(!('customer_id' in out),
    'a jobcard carrying a customer of its own is one that can disagree with its project');
  assert.equal(out.project_id, 3);
});

test('the lists the database has nowhere for are left empty, never invented', () => {
  const page = JobcardRecord.fromServer(SERVED, 1);
  for (const list of ['workers', 'machines', 'bom', 'documents', 'history', 'problems']) {
    assert.deepEqual(page[list], [], `${list} must be empty rather than filled with anything`);
  }
});

test('editing the plan does not clear the fields the form never showed', () => {
  const page = JobcardRecord.fromServer(SERVED, 1);
  page.plannedHours = 30;                      // what somebody changed on the form
  const out = JobcardRecord.toServer(page);
  assert.equal(out.planned_hours, 30);
  // The form has no box for any of these, and save_jobcard replaces the record.
  assert.equal(out.heat_no, 'H240516-S534');
  assert.equal(out.material_cert_ref, 'MTC_H240516.pdf');
  assert.equal(out.notes, 'Two off, mirrored');
  assert.equal(out.progress, 45);
  assert.equal(out.status, 'in-progress', 'and an edit is not a status change');
  assert.equal(out.inspection_required, true);
  assert.equal(out.id, 12, 'it is a correction, not a second jobcard');
});

test('a jobcard typed in on the screen has no id and carries its own values', () => {
  const typed = {
    projectId: '3', title: 'Hopper weldment', item: 'Hopper', quantity: 1, revision: 0,
    drawingNo: '', workType: 'fabrication', location: 'workshop', priority: 'normal',
    responsible: 'Marko Ilic', plannedHours: 18, plannedStart: '2026-10-01',
    plannedCompletion: '2026-10-10', deliveryTarget: null, materialReadiness: 'not-checked',
    inspectionRequired: false, operations: []
  };
  const out = JobcardRecord.toServer(typed);
  assert.equal(out.id, null);
  assert.equal(out.project_id, 3);
  assert.equal(out.planned_hours, 18);
  assert.equal(out.status, 'draft', 'a new jobcard starts as a draft, which is the database default too');
  assert.equal(out.progress, 0);
  assert.equal(out.heat_no, null, 'nothing to preserve and nothing to invent');
});
