'use strict';

// The machine's two shapes, and the three fields that are not a rename.
//
// Most of this module is a rename between the register on screen and the columns underneath, and a
// rename is only worth testing where it can lose something. Three things here can:
//
//   * The subset rule. save_equipment replaces the record, and the form shows about two thirds of a
//     machine — so anything the form does not show has to ride along rather than be cleared.
//   * The three dates the form types in, which become events. A re-save must not record a second
//     service for a date that has not changed, and a date in the future must not be recorded at all.
//   * `pre_use_check_required`, which is the flag every safety gate in the app reads.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE = process.env.VARMAK_EQUIPMENT_RECORD
  || path.join(__dirname, '..', 'equipment-record.js');
delete require.cache[require.resolve(MODULE)];
const EquipmentRecord = require(MODULE);

// A machine as the snapshot sends it, with every field the form never shows filled in.
const fromTheServer = () => ({
  id: '7', equipmentId: 'EQ-0100', name: 'Plasma 120', category: 'cutting', status: 'Available',
  manufacturer: 'Hypertherm', model: 'Powermax 120', serial: 'SN-99812', assetNumber: 'A-0100',
  yearOfManufacture: 2022, description: 'Handheld plasma cutter',
  currentLocation: 'Bay 2', homeLocation: 'Bay 2', department: 'Fabrication',
  responsiblePerson: 'Anna Berg', operator: 'Marko Ilic', condition: 'good', criticality: 'high',
  safetyWarnings: 'Eye protection and gloves', certificationExpiry: '2027-04-01',
  purchaseDate: '2022-06-01', purchaseSupplier: 'Nordic Machines', purchasePrice: '84000.00',
  warrantyExpiry: '2026-06-01', operatingHourMeter: 120.5, serviceInterval: 500,
  maintenanceDate: '2026-06-14', inspectionDate: '2026-08-01', calibrationDate: null,
  qrCode: 'QR-0100', assignedProject: 'P-2026-004', assignedJobcard: 'JC-0031',
  notes: 'Bought with the press',
  requirements: { preUseCheckRequired: true },
  preUseChecks: [{ id: 'E-9', result: 'passed', date: '2026-09-24', jobcardNo: 'JC-0031', resolved: false }],
  maintenance: [{ id: 'E-4', kind: 'service', date: '2026-06-14', result: 'done' }],
  calibrations: [], inspections: [{ id: 'E-6', kind: 'inspection', date: '2026-08-01', result: 'passed' }],
  downtimeRecords: [],
  activity: [{ id: 'E-9', kind: 'pre-use-check', date: '2026-09-24', result: 'passed' }]
});

test('the register reads the machine the snapshot sent, under its own names', () => {
  const on = EquipmentRecord.fromServer(fromTheServer());
  assert.equal(on.equipmentId, 'EQ-0100');
  assert.equal(on.serial, 'SN-99812');
  assert.equal(on.assetNumber, 'A-0100');
  assert.equal(on.operatingHourMeter, 120.5);
  assert.equal(on.serviceInterval, 500);
  assert.equal(on.maintenanceDate, '2026-06-14');
  assert.equal(on.assignedJobcard, 'JC-0031', 'where it is, from the assignment rather than a column');
  assert.equal(on.requirements.preUseCheckRequired, true);
  // The money arrives as a string on the wire, because a JSON number is a double in a browser.
  assert.equal(on.purchasePrice, 84000);
});

test('the lists the safety gate reads are lists, never absent', () => {
  const thin = EquipmentRecord.fromServer({ id: '1', equipmentId: 'EQ-1', name: 'Grinder', category: 'other', status: 'available' });
  // equipment-gates.js reads these with Array.isArray, and a missing list reads as "nothing has ever
  // been checked" — the same answer as "no check passed", and only one of those is ever true.
  ['preUseChecks', 'maintenance', 'calibrations', 'inspections', 'downtimeRecords', 'activity']
    .forEach((name) => assert.deepEqual(thin[name], [], `${name} must be a list`));
  assert.equal(thin.requirements.preUseCheckRequired, false,
    'a machine nobody has said needs a check does not need one');
  assert.equal(thin.lastActivity, null, 'and nothing has happened to it yet');
});

test('the newest event is what "last activity" means', () => {
  const on = EquipmentRecord.fromServer(fromTheServer());
  assert.equal(on.lastActivity, '2026-09-24',
    'derived from the newest event, because a column would have to be kept in step with the rows');
});

test('a form that shows two thirds of a machine does not clear the other third', () => {
  const on = EquipmentRecord.fromServer(fromTheServer());
  // The form the office fills in: eight fields, and nothing else on screen.
  const edited = Object.assign({}, on, {
    name: 'Plasma 120 XL', currentLocation: 'Bay 3', condition: 'fair',
    // The fields the form does not show, deliberately absent from what it sends.
    safetyWarnings: undefined, qrCode: undefined, notes: undefined, purchaseSupplier: undefined
  });
  const sent = EquipmentRecord.toServer(edited);
  assert.equal(sent.name, 'Plasma 120 XL');
  assert.equal(sent.current_location, 'Bay 3');
  assert.equal(sent.condition, 'fair');
  assert.equal(sent.safety_warnings, 'Eye protection and gloves', 'the warning must survive a rename');
  assert.equal(sent.qr_code, 'QR-0100');
  assert.equal(sent.notes, 'Bought with the press');
  assert.equal(sent.purchase_supplier, 'Nordic Machines');
  assert.equal(sent.id, 7, 'and it is the same machine, not a second one');
});

test('the three dates the form types in become the events they actually are', () => {
  const on = EquipmentRecord.fromServer(fromTheServer());
  // Nothing changed: re-saving must not claim a second service.
  assert.deepEqual(EquipmentRecord.datesAsEvents(on, '2026-09-24'), [],
    're-saving a machine whose dates are already what the register says records nothing');

  const serviced = Object.assign({}, on, { maintenanceDate: '2026-09-20' });
  const events = EquipmentRecord.datesAsEvents(serviced, '2026-09-24');
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'service');
  assert.equal(events[0].result, 'done');
  assert.equal(events[0].happened_on, '2026-09-20');
  assert.match(events[0].note, /rather than from a report/,
    'and the record says where the date came from, so nobody reads it as an engineer\'s report');

  // A machine being registered for the first time, with what the office knows about it.
  const fresh = { equipmentId: 'EQ-2', name: 'Press', category: 'forming',
    maintenanceDate: '2026-05-01', inspectionDate: '2026-05-02', calibrationDate: '2026-05-03' };
  const three = EquipmentRecord.datesAsEvents(fresh, '2026-09-24');
  assert.deepEqual(three.map((e) => e.kind), ['service', 'inspection', 'calibration']);
  assert.deepEqual(three.map((e) => e.result), ['done', 'pass', 'pass'],
    'a date typed into the register means it happened and it was fine — a failure is not a date');
});

test('the safety warning is a list on screen and one text column underneath', () => {
  // The screen renders item.safetyWarnings[0] and calls .join on it. The column is one text field, so a
  // machine arriving from the database threw "item.safetyWarnings.join is not a function" on the one
  // screen whose job is showing what is dangerous about it.
  const one = EquipmentRecord.fromServer({ id: '1', equipmentId: 'EQ-1', name: 'Press', category: 'forming',
    safetyWarnings: 'Eye protection and gloves' });
  assert.deepEqual(one.safetyWarnings, ['Eye protection and gloves']);
  const two = EquipmentRecord.fromServer({ id: '1', equipmentId: 'EQ-1', name: 'Press', category: 'forming',
    safetyWarnings: 'Eye protection; Two people to lift' });
  assert.deepEqual(two.safetyWarnings, ['Eye protection', 'Two people to lift']);
  assert.deepEqual(EquipmentRecord.fromServer({ id: '1', equipmentId: 'EQ-1', name: 'P', category: 'f' })
    .safetyWarnings, [], 'and nothing written down is an empty list, never a string to index into');
  // And back, so a round trip does not multiply the separators.
  assert.equal(EquipmentRecord.toServer(two).safety_warnings, 'Eye protection; Two people to lift');
  assert.equal(EquipmentRecord.toServer(EquipmentRecord.fromServer(
    { id: '1', equipmentId: 'EQ-1', name: 'P', category: 'f', safetyWarnings: 'A\nB' })).safety_warnings,
    'A; B', 'a warning written on two lines comes back as two warnings');
});

test('a date in the future is not recorded at all', () => {
  const fresh = { equipmentId: 'EQ-3', name: 'Saw', category: 'cutting', maintenanceDate: '2027-01-01' };
  assert.deepEqual(EquipmentRecord.datesAsEvents(fresh, '2026-09-24'), [],
    'record_equipment_event refuses a future date, and a date picker will meet one');
});

test('the status the register may set does not include where the machine is', () => {
  // 'In Use' would make the safety gates read the wrong question: they ask whether a machine may be run
  // at all, not whether somebody has it.
  assert.equal(EquipmentRecord.SETTABLE.includes('In Use'), false);
  assert.equal(EquipmentRecord.SETTABLE.includes('Available'), true,
    'and the list has to be in the words the register offers, or the fallback below replaces every status');
  const on = EquipmentRecord.fromServer(fromTheServer());
  const sent = EquipmentRecord.toServer(Object.assign({}, on, { status: 'In Use' }));
  assert.equal(sent.status, 'Available', 'and a form that sent it anyway keeps what the machine had');
});

test('the flag every safety gate reads survives the round trip', () => {
  const on = EquipmentRecord.fromServer(fromTheServer());
  assert.equal(EquipmentRecord.toServer(on).pre_use_check_required, true);
  const off = EquipmentRecord.toServer(Object.assign({}, on, { requirements: { preUseCheckRequired: false } }));
  assert.equal(off.pre_use_check_required, false, 'and it can be turned off, which is a decision');
  // A form that does not carry the requirements at all keeps what the machine had, rather than quietly
  // switching a required check off.
  const silent = Object.assign({}, on);
  delete silent.requirements;
  assert.equal(EquipmentRecord.toServer(silent).pre_use_check_required, true);
});

test('an interval of zero is nobody having said, not an interval', () => {
  const fresh = { equipmentId: 'EQ-4', name: 'Drill', category: 'other', serviceInterval: 0 };
  assert.equal(EquipmentRecord.toServer(fresh).service_interval_hours, null,
    'the column allows NULL because zero hours between services is not an answer');
  assert.equal(EquipmentRecord.toServer({ equipmentId: 'EQ-4', name: 'Drill', category: 'other', serviceInterval: 250 })
    .service_interval_hours, 250);
});
