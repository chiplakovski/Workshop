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
