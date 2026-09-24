'use strict';

// The quality register's translation, and the four places it can lose something.
//
// Most of this module is a rename and a rename is only worth testing where something can go missing.
// Four things here can:
//
//   * The checklist. It is the evidence, and an unanswered line has to stay unanswered — '' on the way
//     down, '' on the way back. A blank verdict that arrives as a pass is the worst bug this file
//     could have.
//   * The subset rule, third screen running: save_inspection and save_ncr replace the record, and both
//     forms show less than one.
//   * The refs. The screen works in INS-/NCR-/HOLD- numbers and every function takes an id, so a
//     lookup that comes back empty must send nothing rather than a guess.
//   * detected_by, which is NOT in the payload. The screen had a name written into the page.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE = process.env.VARMAK_QUALITY_RECORD
  || path.join(__dirname, '..', 'quality-record.js');
delete require.cache[require.resolve(MODULE)];
const QualityRecord = require(MODULE);

// The lookups the screen hands in: a ref on screen, a row id underneath.
const LOOKUP = {
  project: (no) => (no === 'P-2026-004' ? 12 : null),
  jobcard: (no) => (no === 'JC-2026-0011' ? 34 : null),
  supplier: (name) => (name === 'Stål & Metall AB' ? 5 : null),
  inspection: (no) => (no === 'INS-2026-001' ? 71 : null),
  ncr: (no) => (no === 'NCR-2026-002' ? 83 : null),
  hold: (no) => (no === 'HOLD-2026-003' ? 90 : null)
};

// An inspection as the snapshot sends it, with the fields the request form never shows filled in.
const inspectionFromTheServer = () => ({
  id: '71', no: 'INS-2026-001', type: 'welding', status: 'requested', result: 'pending',
  projectNo: 'P-2026-004', jobcard: 'JC-2026-0011', operation: 'Nozzle N2 root pass',
  component: 'Nozzle N2', drawingNo: 'BR-4410', drawingRev: 'C', method: 'visual + PT',
  acceptanceCriteria: 'ISO 5817 level B', customerWitness: true, materialTraceabilityOk: true,
  critical: false, plannedDate: '2026-09-24', actualDate: null, inspector: 'Marko Ilic',
  findings: null, notes: 'Customer attending', reinspectionOf: null,
  checklist: [
    { item: 'Weld cap profile', resultItem: 'pass', nominal: null, lower: null, upper: null, actual: null, note: null },
    { item: 'Root penetration', resultItem: null, nominal: null, lower: null, upper: null, actual: null, note: null },
    { item: 'Overall length', resultItem: null, nominal: 2400, lower: -2, upper: 2, actual: 2401.5, note: null }
  ],
  activity: [{ timestamp: '2026-09-24T08:00:00Z', action: 'raised', reason: 'INS-2026-001 — welding' }]
});

test('an unanswered checklist line stays unanswered in both directions', () => {
  const shaped = QualityRecord.inspectionFromServer(inspectionFromTheServer());
  assert.equal(shaped.checklist[1].resultItem, '',
    'a null verdict renders as the word null in the page’s dropdown');
  const back = QualityRecord.checklistToServer(shaped.checklist);
  assert.equal(back[1].result, '',
    'and it has to arrive as nothing rather than as a verdict nobody gave');
  assert.equal(back[0].result, 'pass');
});

test('the screen’s marker for a measured row is never sent as a verdict', () => {
  // The page writes resultItem:'measurement' on a row that holds a reading rather than a judgement.
  // The database allows pass, fail and na; 'measurement' among them would be refused, and the whole
  // inspection result would be lost with it.
  const [line] = QualityRecord.checklistToServer([
    { item: 'Bore', resultItem: 'measurement', nominal: 40, lower: -0.1, upper: 0.1, actual: 40.05 }
  ]);
  assert.equal(line.result, '');
  assert.equal(line.nominal, 40, 'and the row is still recognisably a measured one');
  assert.equal(line.actual, 40.05);
});

test('a line with no name is dropped rather than sent as a check of nothing', () => {
  const lines = QualityRecord.checklistToServer([
    { item: 'Weld cap profile', resultItem: 'pass' },
    { item: '   ', resultItem: 'pass' },
    { item: null, resultItem: 'fail' }
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].item, 'Weld cap profile');
});

test('a nominal with no tolerance goes across as typed, for the database to refuse', () => {
  // Filling the band in with zeroes would make the save succeed by writing a tolerance nobody agreed
  // to into the evidence. The refusal is the right outcome.
  const [line] = QualityRecord.checklistToServer([{ item: 'Bore', nominal: 40, actual: 40.1 }]);
  assert.equal(line.nominal, 40);
  assert.equal(line.lower, null);
  assert.equal(line.upper, null);
});

test('a form that shows less than an inspection does not clear the rest of it', () => {
  const held = QualityRecord.inspectionFromServer(inspectionFromTheServer());
  // The request form, reopened and saved with one field changed.
  const sent = QualityRecord.inspectionToServer(
    Object.assign({}, held, { component: 'Nozzle N3' }), LOOKUP);
  assert.equal(sent.component, 'Nozzle N3');
  assert.equal(sent.acceptance_criteria, 'ISO 5817 level B',
    'the standard the work is judged against cannot be lost by editing the component');
  assert.equal(sent.drawing_rev, 'C');
  assert.equal(sent.customer_witness, true);
  assert.equal(sent.material_traceability_ok, true);
  assert.equal(sent.id, 71);
  assert.equal(sent.project_id, 12);
  assert.equal(sent.jobcard_id, 34);
});

test('the screen says type and the column says kind', () => {
  const sent = QualityRecord.inspectionToServer(
    { projectNo: 'P-2026-004', type: 'pressure', plannedDate: '2026-10-01' }, LOOKUP);
  assert.equal(sent.kind, 'pressure');
  assert.equal('type' in sent, false, 'nothing called type reaches the database');
});

test('the result is not something a request form can set', () => {
  assert.equal(QualityRecord.INSPECTION_SETTABLE.includes('result'), false,
    'an inspection request that could arrive already passed is a form for passing work unlooked at');
  assert.equal(QualityRecord.INSPECTION_SETTABLE.includes('findings'), false);
  assert.equal(QualityRecord.INSPECTION_SETTABLE.includes('critical'), false);
  const sent = QualityRecord.inspectionToServer(
    { projectNo: 'P-2026-004', type: 'visual', plannedDate: '2026-10-01', result: 'passed' }, LOOKUP);
  assert.equal('result' in sent, false);
});

test('a verdict carries the five things a verdict is, and nothing else', () => {
  const sent = QualityRecord.resultToServer('INS-2026-001', {
    result: 'failed', findings: 'Porosity beyond level B', critical: true,
    inspector: 'Somebody Else', actualDate: '2026-09-24',
    checklist: [{ item: 'Root penetration', resultItem: 'fail' }]
  }, LOOKUP);
  assert.deepEqual(Object.keys(sent).sort(),
    ['actual_date', 'checks', 'critical', 'findings', 'id', 'result']);
  assert.equal(sent.id, 71);
  assert.equal(sent.critical, true);
  assert.equal(sent.checks.length, 1);
  // The name is not sent. On a completed inspection that column is who is answerable for the result,
  // and the database takes it from the session — a result somebody else's name can be put on is not
  // a result.
  assert.equal('inspector' in sent, false);
});

test('an inspection nobody can find is sent as nothing, not as a guess', () => {
  const sent = QualityRecord.resultToServer('INS-1999-999', { result: 'passed' }, LOOKUP);
  assert.equal(sent.id, null);
});

test('who found a non-conformance is never in the payload', () => {
  const sent = QualityRecord.ncrToServer({
    title: 'Porosity', projectNo: 'P-2026-004', jobcard: 'JC-2026-0011', category: 'welding',
    severity: 'major', description: 'In the root pass', responsiblePerson: 'Lars Holm',
    dueDate: '2026-10-08', detectedBy: 'Aleksandar C.', supplier: 'Stål & Metall AB'
  }, LOOKUP);
  assert.equal('detected_by' in sent, false,
    'the screen had one name written into the page — every NCR would have been found by that person');
  assert.equal(sent.responsible, 'Lars Holm', 'the screen says responsiblePerson');
  assert.equal(sent.due_on, '2026-10-08', 'and dueDate');
  assert.equal(sent.supplier_id, 5, 'the merchant is offered by name and stored by row');
});

test('a merchant nobody has heard of is sent as nothing rather than guessed at', () => {
  const sent = QualityRecord.ncrToServer({
    title: 'X', projectNo: 'P-2026-004', category: 'material', severity: 'minor',
    description: 'Y', responsiblePerson: 'Z', supplier: 'Somebody Steel Ltd'
  }, LOOKUP);
  assert.equal(sent.supplier_id, null);
});

test('the raise form cannot set a containment, a disposition or a closure', () => {
  for (const step of ['containment', 'disposition', 'verificationResult', 'closureApproval',
    'correctiveActionRef', 'status']) {
    assert.equal(QualityRecord.NCR_SETTABLE.includes(step), false,
      `${step} is a step with its own refusal, not a field on a form`);
  }
});

test('a non-conformance keeps what the raise form does not show', () => {
  const held = QualityRecord.ncrFromServer({
    id: '83', no: 'NCR-2026-002', title: 'Porosity', projectNo: 'P-2026-004',
    jobcard: 'JC-2026-0011', category: 'welding', severity: 'major', description: 'In the root',
    responsiblePerson: 'Lars Holm', dueDate: '2026-10-08', operation: 'Nozzle N2',
    component: 'Nozzle N2', material: 'S355J2 10mm', supplier: 'Stål & Metall AB',
    containment: 'Quarantined', status: 'under-investigation'
  });
  const sent = QualityRecord.ncrToServer(Object.assign({}, held, { severity: 'critical' }), LOOKUP);
  assert.equal(sent.severity, 'critical');
  assert.equal(sent.material, 'S355J2 10mm', 'the material cannot be lost by raising the severity');
  assert.equal(sent.operation, 'Nozzle N2');
  assert.equal(sent.id, 83);
});

test('the screen’s six methods are the database’s six steps', () => {
  assert.deepEqual(Object.values(QualityRecord.STEPS).sort(), [
    'close', 'containment', 'corrective-action', 'disposition', 'reopen', 'verify'
  ]);
  const sent = QualityRecord.stepToServer('setNcrDisposition', 'NCR-2026-002', 'use-as-is',
    'CONC-2026-03', LOOKUP);
  assert.deepEqual(sent, { id: 83, step: 'disposition', text: 'use-as-is', ref: 'CONC-2026-03' });
});

test('a step on a non-conformance nobody can find sends no id', () => {
  const sent = QualityRecord.stepToServer('closeNcr', 'NCR-1999-999', 'QM-1', null, LOOKUP);
  assert.equal(sent.id, null);
  assert.equal(sent.step, 'close');
});

test('a release carries the authority and the evidence, both as typed', () => {
  const sent = QualityRecord.releaseToServer('HOLD-2026-003',
    { releaseAuthority: 'Lars Holm', releaseReason: 'Re-run and PT accepted' }, LOOKUP);
  assert.deepEqual(sent, {
    hold_id: 90, authority: 'Lars Holm', reason: 'Re-run and PT accepted'
  });
  // Blank stays blank rather than becoming null: the database's own message about an authorised
  // approval and written evidence is the one the person needs, and it reads the empty string.
  const empty = QualityRecord.releaseToServer('HOLD-2026-003', { releaseAuthority: '  ' }, LOOKUP);
  assert.equal(empty.authority, '  ');
  assert.equal(empty.reason, '');
});

test('a note names one of the three tables a quality note can go on', () => {
  assert.deepEqual(
    QualityRecord.noteToServer('inspection', 'INS-2026-001', { text: 'Rang the customer' }, LOOKUP),
    { entity: 'inspection', entity_id: 71, text: 'Rang the customer' });
  assert.deepEqual(
    QualityRecord.noteToServer('qualityNcrs', 'NCR-2026-002', { text: 'Reported' }, LOOKUP),
    { entity: 'ncr', entity_id: 83, text: 'Reported' });
  const nowhere = QualityRecord.noteToServer('jobcards', 'JC-2026-0011', { text: 'Hello' }, LOOKUP);
  assert.equal(nowhere.entity, null, 'a collection with no quality table is refused here, not sent');
  assert.equal(nowhere.entity_id, null);
});

test('the lists the page walks are lists, never absent', () => {
  const bare = QualityRecord.inspectionFromServer({ no: 'INS-2026-009' });
  assert.deepEqual(bare.checklist, []);
  assert.deepEqual(bare.activity, []);
  assert.deepEqual(bare.notes, []);
  const hold = QualityRecord.holdFromServer({ no: 'HOLD-2026-009' });
  assert.deepEqual(hold.activity, []);
  const ncr = QualityRecord.ncrFromServer({ no: 'NCR-2026-009' });
  assert.deepEqual(ncr.activity, []);
});

test('the notes column arrives as the one note it is', () => {
  // The inspection request form has a Notes box and the column holds what was typed in it. The panel
  // that shows notes walks an array, so one text column has to arrive as one entry rather than as a
  // string the page would render a character at a time.
  const shaped = QualityRecord.inspectionFromServer(inspectionFromTheServer());
  assert.equal(shaped.notes.length, 1);
  assert.equal(shaped.notes[0].text, 'Customer attending');
});

test('a date is a date or it is nothing', () => {
  assert.equal(QualityRecord.day('2026-09-24T08:00:00Z'), '2026-09-24');
  assert.equal(QualityRecord.day(''), null);
  assert.equal(QualityRecord.day('not a date'), null);
  assert.equal(QualityRecord.day(undefined), null);
});
