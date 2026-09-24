'use strict';

// The store-item translation, and the two things it must never do: send a name where the database
// expects a foreign key, and send a stock figure at all.

const test = require('node:test');
const assert = require('node:assert/strict');
const StockRecord = require('../stock-record.js');

const SERVED = {
  id: '9', code: 'S355-12', itemNo: 'S355-12', description: 'Plate S355J2 12mm', unit: 'KG',
  baseUnit: 'kg', sizePerUnit: 1, weightPerBase: 1, stock: 118, reserved: 12,
  minStock: 500, reorderQty: 1000, category: 'Mild Steel Plate', grade: 'S355J2',
  dimensions: '12 × 1500 × 3000 mm', heat: 'H240516', certificate: 'MTC_H240516.pdf',
  status: 'low', location: 'A1-01-02',
  group: 'Materials', subgroup: 'Mild steel', locationGroup: 'Warehouse', locationSub: 'Rack 2',
  groupId: '3', subgroupId: '7', locationId: '1', sublocationId: '4',
  avgCost: '15.00', lastPrice: '16.00'
};

test('the screen shows names and the save sends the ids behind them', () => {
  const page = StockRecord.fromServer(SERVED);
  assert.equal(page.group, 'Materials', 'a name is what a dropdown shows');
  assert.equal(page.locationSub, 'Rack 2');
  const out = StockRecord.toServer(page);
  // The whole point. A name where a foreign key belongs would move every item it saved out of its own
  // group, and nothing on screen would say so.
  assert.equal(out.group_id, 3);
  assert.equal(out.subgroup_id, 7);
  assert.equal(out.location_id, 1);
  assert.equal(out.sublocation_id, 4);
  assert.ok(!('group' in out) && !('locationSub' in out));
});

test('the stock figure is never sent, in either direction', () => {
  const page = StockRecord.fromServer(SERVED);
  assert.equal(page.stock, 118, 'the screen reads it');
  const out = StockRecord.toServer(page);
  assert.ok(!('stock' in out),
    'steel arrives through a receipt, leaves through an issue and is corrected through a count — '
    + 'each of which writes the movement that explains the change');
  assert.ok(!('reserved' in out));
});

test('the bin is a different thing from the warehouse and the rack', () => {
  const page = StockRecord.fromServer(SERVED);
  assert.equal(page.location, 'A1-01-02');
  assert.equal(StockRecord.toServer(page).bin_code, 'A1-01-02');
});

test('money arrives as text, is read as a number, and is not wiped by a session that has none', () => {
  const page = StockRecord.fromServer(SERVED);
  assert.equal(page.avgCost, 15);
  assert.equal(StockRecord.toServer(page).avg_cost, 15);
  // A welder's copy carries no cost at all. Sending the zero the screen shows would wipe what the
  // store paid for the steel.
  const blind = StockRecord.fromServer({ ...SERVED, avgCost: undefined, lastPrice: undefined });
  assert.equal(blind.avgCost, 0);
  const out = StockRecord.toServer(blind);
  assert.equal(out.avg_cost, null, 'nothing to preserve and nothing to invent');
  assert.equal(out.last_price, null);
});

test('correcting a description leaves everything the form did not touch', () => {
  const page = StockRecord.fromServer(SERVED);
  page.description = 'Plate S355J2 12mm, prime';
  const out = StockRecord.toServer(page);
  assert.equal(out.description, 'Plate S355J2 12mm, prime');
  assert.equal(out.grade, 'S355J2');
  assert.equal(out.dimensions, '12 × 1500 × 3000 mm');
  assert.equal(out.heat_no, 'H240516');
  assert.equal(out.material_cert_ref, 'MTC_H240516.pdf');
  assert.equal(out.min_stock, 500);
  assert.equal(out.reorder_quantity, 1000);
  assert.equal(out.id, 9, 'a correction, not a second item');
});

test('an item typed in on the screen has no id and no group to preserve', () => {
  const typed = { code: 'ms-tube-40', description: 'Square tube 40×40×2.0', unit: 'EA',
                  location: 'B2-01', minStock: 30, reorderQty: 60, grade: 'S235JR' };
  const out = StockRecord.toServer(typed);
  assert.equal(out.id, null);
  assert.equal(out.code, 'ms-tube-40', 'the workflow upper-cases it, because labels are upper case');
  assert.equal(out.group_id, null);
  assert.equal(out.bin_code, 'B2-01');
  assert.equal(out.avg_cost, null, 'a new item has cost nothing until something arrives with a price');
});
