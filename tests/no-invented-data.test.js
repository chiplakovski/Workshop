// The app ships no invented records, and the test workshop stays a test workshop.
//
// Every record in the first prototype was made up — customers, contacts, suppliers, the people who
// "did" things — and it lived in the file every page loads. The owner, about to start for real, said
// all of it had to go. It is gone from the app and lives in tests/fixtures/workshop-state.js, which
// the server never serves. This file is what keeps it that way: it reads the names, heat numbers,
// e-mail addresses and registration numbers out of the fixture itself — so there is no second list to
// forget to update — and fails if any of them turns up in a file the system ships or installs.
//
// It exists because the first sweep missed things a list would also have missed: a Store receiving
// form that arrived pre-filled with an invented supplier, heat number, certificate and "John Smith",
// so a real delivery booked without retyping would have carried them into its traceability record;
// and a fallback that recorded "John Smith" as having received any goods nobody named.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { workshopFixture } = require('./fixtures/workshop-state');

const ROOT = path.join(__dirname, '..');

// Everything that reaches a browser or a database: the files the server will serve (directly in the
// site directory, those extensions — backend/server.js decides the same), the four SQL files and the
// one-file installer, the server, and the deployment configuration.
function shippedFiles() {
  const served = fs.readdirSync(ROOT)
    .filter((f) => /\.(html|js|css|svg|webmanifest)$/.test(f))
    .map((f) => path.join(ROOT, f));
  const backend = fs.readdirSync(path.join(ROOT, 'backend'))
    .filter((f) => /\.sql$/.test(f) || f === 'server.js')
    .map((f) => path.join(ROOT, 'backend', f));
  const deploy = fs.readdirSync(path.join(ROOT, 'deploy')).map((f) => path.join(ROOT, 'deploy', f));
  const host = ['Procfile', 'render.yaml', 'railway.json'].map((f) => path.join(ROOT, f));
  return [...served, ...backend, ...deploy, ...host].filter((f) => fs.statSync(f).isFile());
}

// Fields that hold a person or a firm. Manufacturers are deliberately not here: ESAB, Trumpf and
// Makita are real makers of real machines, and naming one is a fact, not an invented record.
const WHO = new Set(['name', 'contact', 'company', 'customer', 'supplier', 'author', 'buyer', 'responsible',
  'responsiblePerson', 'owner', 'inspector', 'detectedBy', 'createdBy', 'user', 'by', 'preparedBy',
  'reviewedBy', 'assignedTo', 'welder', 'approvedBy', 'verifiedBy', 'requestedBy', 'issuedBy', 'receivedBy',
  'operator', 'workers', 'performedBy', 'signedBy', 'closedBy', 'raisedBy', 'estimator']);

function walk(value, key, visit) {
  if (Array.isArray(value)) return value.forEach((v) => walk(v, key, visit));
  if (value && typeof value === 'object') return Object.entries(value).forEach(([k, v]) => walk(v, k, visit));
  if (typeof value === 'string') visit(key, value);
}

// The people and firms in the fixture. A record's own `name` is only a person or a firm on the
// collections that hold people and firms — a project or a machine also has a name.
function whoIsInTheFixture() {
  const f = workshopFixture();
  const found = new Set();
  for (const c of f.customers || []) { found.add(c.name); (c.contacts || []).forEach((x) => found.add(x.name)); }
  for (const s of f.suppliers || []) found.add(s.name);
  for (const p of f.people || []) found.add(p.name);
  walk(f, '', (key, v) => { if (WHO.has(key) && key !== 'name') found.add(v); });
  return [...found].filter((v) => v && /^\p{Lu}/u.test(v) && !/^(—|-)$/.test(v));
}

// Strings that identify an invented record wherever they appear: e-mail addresses, heat numbers,
// Swedish organisation and VAT numbers.
function identifiersInTheFixture() {
  const found = new Set();
  walk(workshopFixture(), '', (_key, v) => {
    for (const m of v.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+|\bH\d{6}-[A-Z0-9]+\b|\b\d{6}-\d{4}\b|\bSE\d{12}\b/g)) found.add(m[0]);
  });
  return [...found];
}

test('every person and firm in the test workshop is plainly a test name', () => {
  // So nobody can mistake one for a real customer — in a screenshot of a test run, or if a fixture
  // value ever does leak into a page.
  const who = whoIsInTheFixture();
  assert.ok(who.length > 20, `the fixture names almost nobody (${who.length}), so this check has nothing to look at`);
  const real = who.filter((n) => !/^Test/.test(n));
  assert.deepEqual(real, [], `these look like real people or firms: ${real.join(', ')}`);
});

test('nothing the system ships or installs names anybody from the test workshop', () => {
  const who = whoIsInTheFixture();
  const files = shippedFiles();
  assert.ok(files.length > 20, 'found almost no shipped files, so this check has nothing to look at');
  const leaks = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const n of who) if (text.includes(n)) leaks.push(`${path.relative(ROOT, file)}: "${n}"`);
  }
  assert.deepEqual(leaks, [], `invented names in shipped files:\n${leaks.join('\n')}`);
});

test('nothing the system ships carries an invented heat number, e-mail or registration number', () => {
  // The heat number is the one that matters most: it is what ties a weld back to a material
  // certificate, and the Store's receiving form arrived with an invented one already typed in.
  const ids = identifiersInTheFixture();
  assert.ok(ids.some((i) => /^H\d{6}/.test(i)) && ids.some((i) => i.includes('@')),
    'the fixture no longer has heat numbers and e-mail addresses, so this check has nothing to look at');
  const leaks = [];
  for (const file of shippedFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const i of ids) if (text.includes(i)) leaks.push(`${path.relative(ROOT, file)}: ${i}`);
  }
  assert.deepEqual(leaks, [], `invented identifiers in shipped files:\n${leaks.join('\n')}`);
});

test('no form in the app arrives pre-filled with a value from the test workshop', () => {
  // Hint text in a placeholder shows a format and is never saved; a value is saved by whoever
  // presses the button without retyping it.
  // Defaults this workshop chose on purpose, which the test data happens to use as well. Named here
  // with the reason so that adding one is a decision somebody makes, not something this check misses.
  const DELIBERATE = new Map([
    ['30 days', 'the payment term a new customer starts on'],
    ['EXW Marieholm', "delivery ex works from Varmak's own address"],
    ['General', 'the folder a document goes in until somebody files it'],
  ]);
  const values = new Set();
  // Short numbers ("0", "1", "100") are quantities and revisions; a barcode or an article number is
  // long, and the receiving form used to arrive with a thirteen-digit one already scanned.
  walk(workshopFixture(), '', (_k, v) => {
    if (v.length >= 4 && !/^\d{1,4}(\.\d+)?$/.test(v) && !DELIBERATE.has(v)) values.add(v);
  });
  const prefilled = [];
  for (const file of fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of html.matchAll(/<(?:input|textarea)\b[^>]*\bvalue="([^"$]+)"/g)) {
      if (values.has(m[1])) prefilled.push(`${file}: value="${m[1]}"`);
    }
  }
  assert.deepEqual(prefilled, [], `fields pre-filled from the invented workshop:\n${prefilled.join('\n')}`);
});

test('the app ships none of the invented prospect findings', () => {
  // Ten made-up forum posts, ads and tenders used to ship as prospect-stub.js and filled Marketing's
  // queue whenever somebody pressed "Run the sweep". They live with the tests now; an unconnected
  // sweep says nothing was searched.
  const { sample } = require('./fixtures/prospect-sample');
  const titles = sample().map((f) => f.title);
  assert.ok(titles.length >= 5, 'the sample has almost no findings, so this check has nothing to look at');
  assert.ok(!fs.existsSync(path.join(ROOT, 'prospect-stub.js')), 'prospect-stub.js is back in the app');
  const leaks = [];
  for (const file of shippedFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const t of titles) if (text.includes(t)) leaks.push(`${path.relative(ROOT, file)}: "${t}"`);
  }
  assert.deepEqual(leaks, [], `invented findings in shipped files:\n${leaks.join('\n')}`);
});
