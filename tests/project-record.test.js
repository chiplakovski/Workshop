'use strict';

// The project translation. The estimating screen is where projects are made, and its record is wider
// than the table in one direction — work items, options, a revision history — and narrower in another:
// it never sets the hold reason or the material state, which the planning screen writes. So the rule
// that a partial form must not save a partial record matters here as much as anywhere.

const test = require('node:test');
const assert = require('node:assert/strict');
const ProjectRecord = require('../project-record.js');

const SERVED = {
  id: '4', no: 'P-2026-002', name: 'Conveyor frame', customerId: '5', customer: 'MarineVent AB',
  status: 'production', phase: 'fabrication', progress: 35, plannedHours: 80, usedHours: 28.5,
  deadline: '2026-11-30', plannedStart: '2026-10-01', actualStart: '2026-10-02',
  plannedCompletion: '2026-11-20', expectedCompletion: '2026-11-25', actualCompletion: null,
  closedDate: null, responsible: 'Lars Holm', materialStatus: 'ordered', poNumber: 'PO-77',
  workshop: 'Marieholm', description: 'Two frames and a hopper',
  holdReason: null, holdComment: null, expectedResume: null, cancelReason: null,
  workTypes: 'Fabrication, Coating', quotedValue: '420000.00'
};

test('the kinds of work are a list on screen and one field in the column', () => {
  const page = ProjectRecord.fromServer(SERVED);
  assert.deepEqual(page.types, ['Fabrication', 'Coating']);
  assert.equal(ProjectRecord.toServer(page).work_types, 'Fabrication, Coating');
  assert.deepEqual(ProjectRecord.kinds(null), []);
  assert.deepEqual(ProjectRecord.kinds('Service'), ['Service']);
});

test('the used hours are read and never sent', () => {
  const page = ProjectRecord.fromServer(SERVED);
  assert.equal(page.usedHours, 28.5, 'the screen shows what the hours entries added up to');
  assert.ok(!('used_hours' in ProjectRecord.toServer(page)),
    'a screen that could set this could make a project claim work nobody did');
});

test('the estimating screen calls the responsible person the pm', () => {
  const typed = { name: 'Hopper frame', customerId: '5', status: 'quotation', pm: 'Aleksandar' };
  assert.equal(ProjectRecord.toServer(typed).responsible, 'Aleksandar');
  // And an explicit responsible wins, because that is the field the planning screen writes.
  assert.equal(ProjectRecord.toServer({ ...typed, responsible: 'Lars Holm' }).responsible, 'Lars Holm');
});

test('a project with nothing priced yet has no quoted value, which is not zero', () => {
  const fresh = { name: 'Hopper frame', customerId: '5', status: 'quotation', quotedValue: 0 };
  assert.equal(ProjectRecord.toServer(fresh).quoted_value, null,
    'nobody has quoted it, which the column says with NULL and would say wrongly with 0');
  const priced = ProjectRecord.fromServer(SERVED);
  assert.equal(ProjectRecord.toServer(priced).quoted_value, 420000);
});

test('the status is passed through for the database to translate', () => {
  // 'active' is the estimating screen's word for production and 'draft' for quotation. save_project
  // translates them; a second copy of the aliases here is a second thing to keep in step.
  assert.equal(ProjectRecord.toServer({ name: 'x', customerId: '1', status: 'active' }).status, 'active');
  assert.equal(ProjectRecord.toServer({ name: 'x', customerId: '1' }).status, 'quotation');
});

test('changing the status does not clear what the estimating screen never shows', () => {
  const page = ProjectRecord.fromServer({
    ...SERVED, status: 'hold', holdReason: 'Waiting for drawings', holdComment: 'Rev B on Friday'
  });
  page.status = 'production';                   // what somebody pressed
  const out = ProjectRecord.toServer(page);
  assert.equal(out.status, 'production');
  // Every one of these would have gone back as null from a screen that saved only what it displays.
  assert.equal(out.hold_reason, 'Waiting for drawings');
  assert.equal(out.material_status, 'ordered');
  assert.equal(out.po_number, 'PO-77');
  assert.equal(out.phase, 'fabrication');
  assert.equal(out.progress, 35);
  assert.equal(out.planned_hours, 80);
  assert.equal(out.id, 4, 'and it is a correction, not a second project');
});

test('the lists the database has nowhere for are left empty', () => {
  const page = ProjectRecord.fromServer(SERVED);
  assert.deepEqual(page.activity, []);
  assert.deepEqual(page.revisionSnapshots, []);
});
