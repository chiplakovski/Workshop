'use strict';

// How much of what the app holds can the database actually store?
//
// Step 5 of BACKEND.md is "point the frontend at it", and it says the sixteen pages do not change.
// That turned out to assume something nobody had checked: that the schema covers what the app holds.
// It does not. The schema was built from the twenty-five-table plan in §2, which deliberately trimmed
// forty collections down — and the records the pages actually read are far wider than what survived
// that trim. Pointing the frontend at the database today would leave a few hundred fields blank.
//
// So this is the measurement, kept as a script rather than written down once, because the number is
// the progress meter for the rest of step 5 and needs to be re-askable after every pass.
//
// It is deliberately not a test. It reports, and it fails only if the coverage gets worse than the
// baseline recorded at the bottom — a ratchet, so a pass that widens the schema cannot quietly
// narrow it somewhere else.
//
//   node backend/coverage.js            the summary
//   node backend/coverage.js customers  one collection, field by field

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';
const DB = process.env.VARMAK_COVERAGE_DB || 'varmak_coverage';

// Which table a collection would be read from.
const TABLE_FOR = {
  customers: 'customer', projects: 'project', jobcards: 'jobcard', equipment: 'equipment',
  inventory: 'stock_item', movements: 'stock_movement', offcuts: 'offcut', suppliers: 'supplier',
  hours: 'hours_entry', estimations: 'estimate', qualityInspections: 'inspection',
  qualityNcrs: 'ncr', qualityHolds: 'quality_hold', purchaseOrders: 'purchase_order',
  documents: 'document', marketingLeads: 'lead', marketingOpportunities: 'opportunity',
  itemGroups: 'item_group', locationGroups: 'location', activity: 'activity_log'
};

// The same thing under a different word. Every entry here is a judgement, so they are written down
// rather than guessed at by a rule — a rule that turns `no` into `no` and shrugs at `org` would
// quietly overstate the coverage.
const SAME_THING = {
  no: 'ref', org: 'org_no', vat: 'vat_no', credit: 'credit_limit', minStock: 'min_stock',
  avgCost: 'avg_cost', plannedHours: 'planned_hours', drawingNo: 'drawing_no',
  plannedStart: 'planned_start', plannedCompletion: 'planned_completion', heatNo: 'heat_no',
  appliedBy: 'applied_by', appliedDate: 'applied_at', releaseAuthority: 'release_authority',
  releaseDate: 'released_at', releaseReason: 'release_reason', company: 'company',
  equipmentId: 'ref', itemNo: 'code', qty: 'quantity', createdBy: 'inspector',
  customerId: 'customer_id', projectId: 'project_id', estimationId: 'estimate_id',
  sellingPrice: 'total', validUntil: 'valid_until', appliedTo: 'jobcard_id',

  // Found while wiring the customers screen, and they were all measurement rather than schema: the
  // report said five customer fields needed a column while every one of them had had a column since
  // step 5 under a longer name. That mattered more than it sounds — the 86 in "86 fields need a
  // column" was the size of the remaining work, and a number that overstates the work is a number
  // that gets planned around. Every entry below was checked against the column list in schema.sql.
  since: 'customer_since', terms: 'payment_terms_days', billing: 'billing_address',
  shipping: 'shipping_address',
  // NOT is_preferred, which is what this said when it was first written here and was wrong: the
  // customer screen's `preferred` sits under a label reading "Preferred Contact" and holds 'Email'.
  // is_preferred is whether the workshop favours the customer, which nothing reads. Mapping one to
  // the other claimed coverage for a field that had nowhere to go, in the same commit that was about
  // a meter overstating the work. preferred_contact was added for it.
  preferred: 'preferred_contact',
  start: 'planned_start', types: 'work_types', closedDate: 'closed_on',
  created: 'created_at', updated: 'updated_at', expiry: 'expires_on',
  group: 'group_id', subgroup: 'subgroup_id',
  locationGroup: 'location_id', locationSub: 'sublocation_id',
  reorderQty: 'reorder_quantity', heat: 'heat_no',

  // Two words that mean different columns depending on which record they are on, which a flat map
  // cannot say: a customer's `type` is direct/reseller/oem/public, a document's is
  // Certificate/Drawing/Report. Written per collection rather than picked between, because picking
  // would mean reporting one of them wrongly for ever.
  type: { customers: 'customer_type', documents: 'kind' },
  name: { documents: 'title' }
};

// Deliberately NOT mapped, having looked at what they hold:
//   inventory.certificate  — 'MTC_H240516-S534.pdf', a file, not a reference. material_cert_ref is
//                            a reference; the file belongs in the document table and a store with
//                            somewhere to put it. Calling it stored would hide that.
//   inventory.location     — 'A1-01-02', a bin address, and a different thing from locationGroup
//                            ('warehouse') and locationSub ('wh1-shelves'). No column holds it.
//   estimations.plannedHours — a sum of the labour lines rather than a field. Left as a gap because
//                            deciding it is derived needs the page's use of it read, not assumed.

// Fields that are a copy of something on another record. These do not want a column — a copy of a
// name that can drift from the name it copied is worse than a join.
const A_JOIN = new Set([
  'customer', 'projectNo', 'supplier', 'project', 'jobcard', 'customerNo', 'supplierNo',
  'linkedEstimateNo', 'linkedProjectNo', 'relatedRef', 'reference', 'record', 'module',
  // A project does not hold the estimate it came from — the estimate holds project_id, set by
  // accept_estimate. Reading it the other way round is a lookup, and a second copy of the link is
  // a second thing that can be wrong.
  'estimationId'
]);

// Fields holding a list. These want a child table, not a column, for the reason every other list in
// this schema already has one: a JSON array cannot have a foreign key or a constraint on its rows.
const A_CHILD_TABLE = new Set([
  'workers', 'machines', 'bom', 'contacts', 'items', 'documents', 'subgroups', 'activity',
  'operations', 'materials', 'attachments', 'lines', 'events', 'history', 'checks', 'readings',
  // Lists whose child table already exists and is already pointing the right way: jobcard.project_id,
  // hours_entry.jobcard_id, inspection.jobcard_id. They were counted as missing columns, which is
  // the one thing they must never become — a list in a column cannot have a foreign key.
  'jobcards', 'hours', 'inspections'
]);

function dbColumns() {
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', 'postgres', '-qtAX',
    '-c', `DROP DATABASE IF EXISTS ${DB};`, '-c', `CREATE DATABASE ${DB};`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  for (const name of ['schema', 'auth', 'api']) {
    const file = path.join(__dirname, `${name}.sql`);
    if (fs.existsSync(file)) {
      execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', DB, '-qtAX', '-f', file],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    }
  }
  const raw = execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', DB, '-qtAX', '-c',
    `SELECT table_name || ':' || string_agg(column_name, ',' ORDER BY ordinal_position)
       FROM information_schema.columns WHERE table_schema = 'public'
      GROUP BY table_name;`], { encoding: 'utf8' });
  const columns = {};
  for (const line of raw.trim().split('\n')) {
    const [table, list] = line.split(':');
    if (table) columns[table.trim()] = list.split(',');
  }
  return columns;
}

function frontendRecords() {
  global.window = global;
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  require(path.join(ROOT, 'workshop-data.js'));
  global.WorkshopData.loadDemoData();
  return global.WorkshopData.get();
}

// Does any page actually read this field? A field only the demo data carries is width nobody misses.
function pageSource() {
  return fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
}

// The column this field is the same thing as, if any — per collection where the word is ambiguous.
function sameThing(field, collection) {
  const entry = SAME_THING[field];
  if (entry === undefined) return undefined;
  return typeof entry === 'string' ? entry : entry[collection];
}

function classify(field, columns, pages, collection) {
  const snake = field.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  const named = sameThing(field, collection);
  if (columns.includes(field) || (named !== undefined && columns.includes(named))
      || columns.includes(snake)) {
    return 'stored';
  }
  if (A_JOIN.has(field)) return 'join';
  if (A_CHILD_TABLE.has(field)) return 'child table';
  // A property access or a quoted key, followed by anything that is not more of the name. The first
  // version listed the characters it expected afterwards — `['"]\s.,;)=` — and therefore missed every
  // read of the form `j.inspectionRequired?a:b`, because `?` was not on the list. That field is read
  // by three pages and a rules module and was being reported as width nobody misses. A negative
  // lookahead asks the question that was meant: is this word used as a field anywhere.
  const used = new RegExp(`[.\\['"]${field}(?![A-Za-z0-9_])`).test(pages);
  return used ? 'needs a column' : 'unused';
}

function main() {
  const columns = dbColumns();
  const records = frontendRecords();
  const pages = pageSource();
  const only = process.argv[2];

  const tally = { stored: 0, join: 0, 'child table': 0, 'needs a column': 0, unused: 0 };
  const perCollection = [];

  for (const [collection, table] of Object.entries(TABLE_FOR)) {
    const record = (records[collection] || [])[0];
    if (!record) {
      perCollection.push({ collection, table, empty: true });
      continue;
    }
    const counts = { stored: 0, join: 0, 'child table': 0, 'needs a column': 0, unused: 0 };
    const missing = [];
    for (const field of Object.keys(record)) {
      const verdict = classify(field, columns[table] || [], pages, collection);
      counts[verdict] += 1;
      tally[verdict] += 1;
      if (verdict === 'needs a column') missing.push(field);
      if (only === collection) console.log(`  ${verdict.padEnd(16)} ${field}`);
    }
    perCollection.push({ collection, table, counts, missing });
  }

  if (only) {
    if (!perCollection.some((c) => c.collection === only)) {
      console.error(`No collection called ${only}. Try one of: ${Object.keys(TABLE_FOR).join(', ')}`);
      process.exitCode = 1;
    }
    return;
  }

  console.log('Collection               table                  stored  needs column  join  child  unused');
  for (const row of perCollection) {
    if (row.empty) {
      console.log(`${row.collection.padEnd(24)} ${row.table.padEnd(22)} (no demo record to compare)`);
      continue;
    }
    console.log(`${row.collection.padEnd(24)} ${row.table.padEnd(22)}`
      + `${String(row.counts.stored).padStart(6)}`
      + `${String(row.counts['needs a column']).padStart(14)}`
      + `${String(row.counts.join).padStart(6)}`
      + `${String(row.counts['child table']).padStart(7)}`
      + `${String(row.counts.unused).padStart(8)}`);
  }

  const real = tally.stored + tally['needs a column'] + tally.join + tally['child table'];
  const pct = ((tally.stored / real) * 100).toFixed(0);
  console.log(`\n${tally.stored} of ${real} fields the pages use can be stored today — ${pct}%.`);
  console.log(`  ${tally['needs a column']} need a column that does not exist`);
  console.log(`  ${tally.join} are a copy of something on another record and want a join, not a column`);
  console.log(`  ${tally['child table']} hold a list and want a child table`);
  console.log(`  ${tally.unused} more are carried by the demo data and read by no page at all`);

  // The ratchet. These are the numbers as they stood when this was written; a pass that widens the
  // schema should move the first up and the second down, and neither may go the wrong way.
  // Moved when the "is this field read anywhere" test was corrected, not when the schema narrowed:
  // the old regex missed every read written as `j.field ? a : b`, so fourteen fields the pages do read
  // were being reported as width nobody misses. The number got worse because the measurement got
  // better, which is the only reason a ratchet is ever allowed to move backwards.
  const BASELINE = { stored: 235, needsColumn: 70 };
  console.log('');
  if (tally.stored < BASELINE.stored) {
    console.error(`Coverage went backwards: ${tally.stored} stored, was ${BASELINE.stored}.`);
    process.exitCode = 1;
  } else if (tally['needs a column'] > BASELINE.needsColumn) {
    console.error(`More fields are missing a column than before: ${tally['needs a column']}, was ${BASELINE.needsColumn}.`);
    process.exitCode = 1;
  } else if (tally.stored > BASELINE.stored || tally['needs a column'] < BASELINE.needsColumn) {
    console.log(`Better than the recorded baseline (${BASELINE.stored} stored, ${BASELINE.needsColumn} missing).`);
    console.log('Update BASELINE in this file so the ratchet holds the new ground.');
  } else {
    console.log('Unchanged from the recorded baseline.');
  }
}

main();
