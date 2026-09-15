// Tests for material-reference.js — the offline standards table Store uses to
// suggest an item's weight. Checked against published section weights, so a
// wrong formula shows up as a wrong kilo rather than as a silent default.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../material-reference.js');

// Published weights, in kg/m unless noted. Tolerance is 1.5%: the tables round
// their dimensions, so an exact match is not the right bar.
const near = (actual, expected, what) => {
  assert.ok(actual != null, `${what}: nothing was suggested`);
  const off = Math.abs(actual - expected) / expected;
  assert.ok(off < 0.015, `${what}: got ${actual}, expected about ${expected} (off by ${(off * 100).toFixed(1)}%)`);
};

test('density resolves a material however it is written', () => {
  assert.equal(M.density('S235JR'), 7850);
  assert.equal(M.density('AISI 304'), 7900);
  assert.equal(M.density('aisi-304'), 7900);
  assert.equal(M.density('AISI 304 2B'), 7900);
  assert.equal(M.density('AISI 316L'), 8000, '316 must not fall through to 304');
  assert.equal(M.density('Aluminium 6082'), 2700);
  assert.equal(M.density('mild steel'), 7850);
  assert.equal(M.density('Copper'), 8960);
  assert.equal(M.density(7850), 7850, 'a density can be given directly');
  assert.equal(M.density('unobtainium'), 0, 'an unknown material suggests nothing');
  assert.equal(M.density(null), 0);
});

test('pipe schedules are read from a description', () => {
  const p = M.parsePipe('Pipe DN100 SCH40');
  assert.equal(p.od, 114.3);
  assert.equal(p.wall, 6.02);
  assert.equal(p.schedule, '40');
  assert.equal(M.parsePipe('dn 50 sch 80').wall, 5.54, 'spacing must not matter');
  assert.equal(M.parsePipe('DN80').schedule, '40', 'schedule 40 is the common default');
  assert.equal(M.parsePipe('Square tube 40x40'), null, 'only pipes parse as pipes');
  assert.equal(M.parsePipe('DN999 SCH40'), null, 'a bore outside the table suggests nothing');
});

test('pipe weight matches the published section weight', () => {
  near(M.suggest('Pipe DN100 SCH40', 'S235JR').weightPerBase, 16.08, 'DN100 SCH40 steel');
  near(M.suggest('Pipe DN50 SCH40', 'S235JR').weightPerBase, 5.44, 'DN50 SCH40 steel');
  near(M.suggest('Pipe DN25 SCH40', 'S235JR').weightPerBase, 2.50, 'DN25 SCH40 steel');
  near(M.suggest('Pipe DN150 SCH80', 'S235JR').weightPerBase, 42.56, 'DN150 SCH80 steel');
  // Same pipe, different metal: the ratio is the ratio of the densities.
  const steel = M.suggest('Pipe DN100 SCH40', 'S235JR').weightPerBase;
  const stainless = M.suggest('Pipe DN100 SCH40', 'AISI 304').weightPerBase;
  near(stainless / steel, 7900 / 7850, 'stainless against steel');
});

test('sections other than pipe weigh what the tables say', () => {
  near(M.weightPerBase('square-tube', { a: 25, wall: 1.6 }, 'S235JR').weightPerBase, 1.12, 'SHS 25x25x1.6');
  near(M.weightPerBase('square-tube', { a: 40, wall: 2.0 }, 'S235JR').weightPerBase, 2.31, 'SHS 40x40x2.0');
  near(M.weightPerBase('rect-tube', { a: 50, b: 30, wall: 2.0 }, 'S235JR').weightPerBase, 2.31, 'RHS 50x30x2.0');
  near(M.weightPerBase('round-bar', { d: 20 }, 'S235JR').weightPerBase, 2.47, 'round bar 20');
  near(M.weightPerBase('flat-bar', { a: 50, b: 10 }, 'S235JR').weightPerBase, 3.93, 'flat 50x10');
  near(M.weightPerBase('angle', { a: 50, b: 50, wall: 5 }, 'S235JR').weightPerBase, 3.77, 'angle 50x50x5');
  const sheet = M.weightPerBase('sheet', { wall: 2 }, 'AISI 304');
  assert.equal(sheet.baseUnit, 'm2', 'sheet is measured per square metre');
  near(sheet.weightPerBase, 15.8, 'stainless sheet 2 mm');
});

test('a suggestion is withheld rather than guessed', () => {
  assert.equal(M.weightPerBase('round-pipe', { od: 100 }, 'S235JR'), null, 'no wall, no weight');
  assert.equal(M.weightPerBase('round-pipe', { od: 20, wall: 20 }, 'S235JR'), null, 'a wall thicker than the bore is not a pipe');
  assert.equal(M.weightPerBase('square-tube', { a: 25, wall: 1.6 }, 'unobtainium'), null, 'unknown material, no weight');
  assert.equal(M.suggest('Just a description', 'S235JR'), null, 'nothing recognisable, nothing suggested');
  assert.equal(M.crossSection('no-such-shape', { a: 1 }), 0);
});

test('dimensions are read out of the usual ways of writing them', () => {
  assert.deepEqual(M.readDimensions('25×25×1.6 mm'), { a: 25, b: 25, wall: 1.6 });
  assert.deepEqual(M.readDimensions('40 x 40 x 2,0'), { a: 40, b: 40, wall: 2.0 }, 'a decimal comma reads too');
  assert.deepEqual(M.readDimensions('2 mm'), { wall: 2 });
  assert.equal(M.readDimensions('no numbers here'), null);
});

// ---- Product catalogue ------------------------------------------------------

const only = (family, query) => {
  const hits = M.catalogueProducts(family, query);
  assert.ok(hits.length, `${family} "${query}": nothing found`);
  return hits[0];
};

test('the catalogue covers the families a workshop buys from', () => {
  const families = M.catalogueFamilies().map(f => f.id);
  ['plate', 'pipe', 'section', 'bar', 'fitting', 'flange', 'valve', 'welding', 'abrasive', 'gas', 'fastener']
    .forEach(id => assert.ok(families.includes(id), `the catalogue must carry ${id}`));
  assert.ok(M.catalogueSize() > 1500, 'each family must actually be populated');
  // Every family files its products under a real item group.
  M.catalogueFamilies().forEach(f => {
    assert.ok(['materials', 'consumables', 'hardware', 'tooling'].includes(f.group), `${f.id} has no group`);
    assert.ok(f.subgroup, `${f.id} has no subgroup`);
  });
});

test('every catalogue product is a complete item template', () => {
  for (const family of M.catalogueFamilies()) {
    for (const p of M.catalogueProducts(family.id)) {
      assert.ok(p.id && p.name && p.description, `${family.id}: an entry is missing its name`);
      assert.ok(['pcs', 'm', 'm2', 'm3', 'kg'].includes(p.baseUnit), `${p.name}: odd base unit ${p.baseUnit}`);
      assert.ok(Number(p.sizePerUnit) > 0, `${p.name}: size per unit must be positive`);
      assert.ok(Number(p.weightPerBase) >= 0, `${p.name}: weight cannot be negative`);
      assert.ok(p.unit, `${p.name}: no stock unit`);
    }
  }
});

test('catalogue weights follow the published figures', () => {
  // Plate: thickness times density, over the area of the sheet.
  const plate = only('plate', 'plate 3 mm s235jr 1500×3000');
  near(plate.weightPerBase, 23.55, '3 mm steel plate per m2');
  assert.equal(plate.sizePerUnit, 4.5, 'a 1500×3000 sheet is 4.5 m2');
  near(plate.weightPerBase * plate.sizePerUnit, 106, 'so one sheet weighs about 106 kg');

  near(only('pipe', 'dn100 sch40 s235').weightPerBase, 16.08, 'DN100 SCH40 pipe');
  near(only('section', 'shs 40×40×2 s235').weightPerBase, 2.31, 'SHS 40x40x2');
  near(only('bar', 'round bar ⌀20 s235').weightPerBase, 2.47, 'round bar 20');
  // A long-radius 90 degree elbow is a quarter turn of 1.5 bore radius.
  near(only('fitting', 'elbow 90 dn100 sch40 s235').weightPerBase, 3.79, 'DN100 SCH40 LR elbow');
  near(only('flange', 'weld neck dn100 pn16 s235').weightPerBase, 6.2, 'DN100 PN16 weld-neck flange');
  near(only('abrasive', 'cutting disc 125×1.6').weightPerBase, 0.046, '125 x 1.6 cutting disc');
  near(only('fastener', 'hex bolt m10×30 8.8').weightPerBase, 0.031, 'M10x30 bolt');
  near(only('fastener', 'hex nut m12 8.8').weightPerBase, 0.0169, 'M12 nut');
});

test('a stainless product weighs more than the same thing in steel', () => {
  const steel = only('pipe', 'dn100 sch40 s235jr').weightPerBase;
  const stainless = only('pipe', 'dn100 sch40 aisi 304').weightPerBase;
  assert.ok(stainless > steel, 'stainless is denser, so the pipe is heavier');
  near(stainless / steel, 7900 / 7850, 'and heavier by exactly the density ratio');
});

test('a manufactured weight is marked as indicative, a calculated one is not', () => {
  assert.equal(only('valve', 'ball valve dn50 pn16').indicative, true, 'a valve weight depends on its maker');
  assert.equal(only('flange', 'weld neck dn100 pn16 s235').indicative, true);
  assert.ok(!only('plate', 'plate 3 mm s235jr 1500×3000').indicative, 'plate follows from its own geometry');
  assert.ok(!only('pipe', 'dn100 sch40 s235').indicative);
  assert.ok(!only('fitting', 'elbow 90 dn100 sch40 s235').indicative);
});

test('a heavier pressure class and a bigger bore both weigh more', () => {
  const pn16 = only('valve', 'ball valve dn50 pn16').weightPerBase;
  const pn40 = only('valve', 'ball valve dn50 pn40').weightPerBase;
  assert.ok(pn40 > pn16, 'PN40 has a heavier body than PN16');
  const dn100 = only('valve', 'ball valve dn100 pn16').weightPerBase;
  assert.ok(dn100 > pn16, 'and DN100 is heavier than DN50');
});

test('consumables carry their pack size as the measure', () => {
  const spool = only('welding', 'er70s-6 ⌀1.0 15 kg');
  assert.equal(spool.baseUnit, 'kg');
  assert.equal(spool.sizePerUnit, 15, 'one spool is 15 kg of wire');
  assert.equal(spool.weightPerBase, 1, 'a kilo of wire weighs a kilo');
  const bottle = only('gas', 'argon 50 l');
  assert.equal(bottle.baseUnit, 'm3');
  near(bottle.sizePerUnit, 10, '50 l at 200 bar is about 10 m3 of free gas');
});

test('search narrows on every word and ignores how a grade is spaced', () => {
  // "3" also appears inside 3000, so a full spec does not reduce to one row -
  // it has to put the right row first.
  assert.equal(M.catalogueProducts('plate', 'plate 3 mm s235jr 1500×3000')[0].name,
    'Plate 3 mm S235JR mild steel 1500×3000', 'a full spec must rank its own plate first');
  const spaced = M.catalogueProducts('plate', '10 mm aisi 304');
  const tight = M.catalogueProducts('plate', '10 mm aisi304');
  assert.deepEqual(tight.map(p => p.id), spaced.map(p => p.id), '"aisi304" and "AISI 304" are one search');
  // A figure standing on its own outranks the same digits inside another number.
  assert.match(M.catalogueProducts('plate', '3 mm s235 1500')[0].name, /^Plate 3 mm/,
    '"3 mm" must find 3 mm plate, not 0.8 mm on a 3000 sheet');
  assert.equal(M.catalogueProducts('plate', 'unobtainium').length, 0);
  assert.equal(M.catalogueProducts('no-such-family').length, 0);
});

test('a product resolves to the group it should be filed under', () => {
  const valve = M.catalogueProducts('valve')[0];
  const pulled = M.catalogueProduct('valve', valve.id);
  assert.equal(pulled.group, 'materials');
  assert.equal(pulled.subgroup, 'pipe-fittings');
  assert.equal(pulled.family, 'valve');
  const wire = M.catalogueProducts('welding')[0];
  const pulledWire = M.catalogueProduct('welding', wire.id);
  assert.equal(pulledWire.group, 'consumables');
  assert.equal(pulledWire.subgroup, 'welding');
  assert.equal(M.catalogueProduct('valve', 'no-such-product'), null);
});

test('a product is filed by what it is made of, not by its family default', () => {
  const filed = (family, query) => {
    const hit = only(family, query);
    return M.catalogueProduct(family, hit.id);
  };
  assert.equal(filed('plate', 'plate 5 mm s235jr 1500x3000').subgroup, 'mild-steel');
  assert.equal(filed('plate', 'plate 5 mm aisi 304 1500x3000').subgroup, 'stainless-steel');
  assert.equal(filed('plate', 'plate 3 mm aluminium 1000x2000').subgroup, 'aluminium');
  assert.equal(filed('bar', 'round bar ⌀20 copper').subgroup, 'copper');
  assert.equal(filed('section', 'shs 40x40x2 s235').subgroup, 'mild-steel');
  // Pipework is filed together whatever it is made of.
  assert.equal(filed('pipe', 'dn100 sch40 s235').subgroup, 'pipe-fittings');
  assert.equal(filed('valve', 'ball valve dn50 pn16').subgroup, 'pipe-fittings');
});

test('a size written with x finds the same product as one written with ×', () => {
  const cross = M.catalogueProducts('plate', 'plate 5 mm s235jr 1500×3000');
  const ex = M.catalogueProducts('plate', 'plate 5 mm s235jr 1500x3000');
  assert.ok(ex.length, 'nobody types the multiplication sign');
  assert.equal(ex[0].id, cross[0].id);
  assert.equal(M.catalogueProducts('section', 'shs 40x40x2 s235')[0].id,
               M.catalogueProducts('section', 'shs 40×40×2 s235')[0].id);
});
