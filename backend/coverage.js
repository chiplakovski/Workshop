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
  marketingTenders: 'tender',
  itemGroups: 'item_group', locationGroups: 'location', activity: 'activity_log',
  // The staff, which the snapshot carries so a form can offer "Responsible" and "Owner" from the people
  // this workshop has rather than three names written into six pages. Measured against app_user, and it
  // will print "(no demo record to compare)": the demonstration state has no staff, because who works at
  // a workshop is not something a fixture can invent. The Access screen's own suite covers these columns.
  people: 'app_user',
  // What a sweep found out about a prospect. `act_on_prospect_finding` already writes against these rows.
  prospectFindings: 'prospect_finding'
};

// Collections this meter deliberately does not measure, and why. Checked against the demonstration state
// below, because the failure this list prevents is the one that has no symptom: a whole module missing
// from the map is a module whose width is reported as neither covered nor missing. `marketingCampaigns`
// was exactly that — four records, eighteen fields, no table, and invisible to every number this file
// prints.
//
// Writing this list is what found them. Eleven collections carry records in the demonstration workshop
// and had no table and no entry here, so every coverage figure this project has printed — 67%, 70%, 73% —
// was about less than the whole app while reading as though it covered all of it. Six of the eleven are
// welding records, which for a fabrication shop is not a small omission.
const NOT_MEASURED = {
  // A campaign has a budget, a spend, channels, and counts of the leads and quotations it produced.
  // There is no table, and whether this workshop runs marketing campaigns at all is a decision for them
  // rather than something to infer from demonstration data.
  marketingCampaigns: 'no table: whether the workshop runs campaigns is their decision, not a gap',

  // The welding records, and this is the real gap in the system. A weld log, the NDT against those welds,
  // the procedure specifications they are welded to, and the welders qualified to each — four tables, and
  // for a pressure-vessel or structural shop they are what a delivery is signed off against. `inspection`
  // and `inspection_check` cover a check and its measurements; none of these four is that. Named here
  // rather than counted as loose fields because each is a register in its own right, and BACKEND.md now
  // carries them as the next schema work rather than as a number at the bottom of this report.
  qualityWelds: 'no table yet: a weld log is a register of its own — see BACKEND.md',
  qualityNdt: 'no table yet: NDT against a weld, distinct from an inspection',
  qualityWps: 'no table yet: the welding procedures welds are made to',
  qualityWelderQuals: 'no table yet: which welder is qualified to which procedure',

  // The rest of the quality screens, each a record with its own rules and its own table to come. The
  // Quality screen refuses all of them out loud today, which is the honest state until somebody asks.
  qualityItps: 'no table yet: the Quality screen refuses it out loud',
  qualityCapas: 'no table yet: the five whys and the fishbone, which the NCR points at',
  qualityDossiers: 'no table yet: the Quality screen refuses it out loud',
  qualityComplaints: 'no table yet: a customer complaint, which createNcr already turns into an NCR',
  supplierQuality: 'a rollup of the NCRs and deliveries against a merchant, not a record',

  // This browser's own conveniences, which have no business in a database: a numbering counter, a
  // counting session that is not a record until it is posted, a saved filter.
  counters: "this browser's own numbering, not a record",
  stockCounts: 'a counting session in progress, which is not a record until it is posted',
  savedReports: 'a report definition, which the Reports screen refuses out loud',

  // ── Nine more, found by fixing this check rather than by reading the code ──────────────────────
  //
  // The test above used to skip a collection the demonstration fixture had left empty, so it only ever
  // complained about collections that carried a record. These nine carry none, and every one of them was
  // invisible to this meter for the same reason `marketingCampaigns` was: not because anybody decided they
  // did not matter, but because nothing asked. Two have a table. Seven do not, and saying so here is the
  // point of this list — the coverage figure means "of the app", and it cannot mean that while a module is
  // missing from the map.
  //
  // The one that matters most is `invoices`. Two screens read it, there is no table, and it is the money
  // going out of the door. It is the largest single gap in this schema and it is not in the 20 fields the
  // figure below calls missing, because a whole register is not a field.
  invoices: 'NO TABLE, and two screens read it: invoicing is the largest gap in this schema',
  supplierInvoices: 'no table: the invoice arriving against a purchase order, the other half of invoicing',
  purchaseRfqs: 'no table: an enquiry to a merchant, which precedes the purchase_order that exists',
  qualityReleases: 'no table yet: a release note, which the Quality screen refuses out loud',
  documentFolders: 'a grouping over document rows rather than a record — document.entity already groups them',
  // A breakdown is an equipment_event with kind 'breakdown', and the data layer keeps this list as a
  // second copy of equipment.downtimeRecords, which its own comment says out loud. Two stored copies of
  // one fact is the bug, not the missing table.
  breakdowns: "equipment_event kind 'breakdown' — this list is a second copy of equipment.downtimeRecords",
  prospectSeen: 'which findings this workshop has looked at; acting on one is written to activity_log',
  prospectSweeps: 'no table: when a sweep last ran, which is this browser\'s bookkeeping rather than a record'
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

  // Per collection, because both words mean something else everywhere else. A customer's `name` is
  // `customer.name`; a person's is `app_user.display_name`. An offcut's `active` is not a column at all;
  // a person's is `is_active`. This is what the per-collection form of an entry is for, and getting it
  // wrong in either direction moves the figure below: a blanket `name: 'display_name'` would have called
  // every customer, project and merchant name stored under a column that is not theirs.
  active: { people: 'is_active' },
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
  // The bin, as opposed to the warehouse and the rack above it.
  location: 'bin_code',

  // The equipment register, and the third time this meter has understated the work by not knowing the
  // schema's own names. Every one of these was checked against the column list in schema.sql: the
  // table has had them since the equipment pass, under the longer names an insurer or an auditor would
  // use. Nine fields, no schema change — and `equipment` was the table this document called the largest
  // remaining gap, at sixteen fields. It is seven.
  serial: 'serial_no', assetNumber: 'asset_no',
  operatingHourMeter: 'operating_hours', serviceInterval: 'service_interval_hours',
  // Dated per collection, because "the maintenance date" on a machine is the date of its last service
  // and means something else anywhere else.
  maintenanceDate: { equipment: 'last_service_date' },
  inspectionDate: { equipment: 'last_inspection_date' },
  calibrationDate: { equipment: 'last_calibration_date' },
  assignedProject: { equipment: 'assigned_project_id' },
  // The movement log. Every one of these is a rename rather than a gap: the store screen asks when,
  // what happened, who did it and where it went; the table says moved_at, kind, moved_by, moved_from
  // and moved_to. The one that is genuinely a lookup is the item's code, which lives on stock_item.
  time: 'moved_at', action: 'kind', user: 'moved_by', from: 'moved_from', to: 'moved_to',
  // The material certificate. The store screen holds a filename ('MTC_H240516-S534.pdf') and the
  // column holds a reference — which is what a filename is, to whoever has to find the certificate.
  // Left unmapped at first on the grounds that the file belongs in the document table, which is true
  // and is also a reason to store nothing today rather than the reference the workshop actually uses.
  certificate: 'material_cert_ref',

  // Two words that mean different columns depending on which record they are on, which a flat map
  // cannot say: a customer's `type` is direct/reseller/oem/public, a document's is
  // Certificate/Drawing/Report. Written per collection rather than picked between, because picking
  // would mean reporting one of them wrongly for ever.
  type: { customers: 'customer_type', documents: 'kind', suppliers: 'supplier_type',
          // An inspection's type is what kind of check it is — visual, dimensional, pressure — which
          // is `kind`, the word this schema uses for the kind of any thing. The screen's word won on
          // the wire (the snapshot sends `type`); the column keeps the schema's.
          qualityInspections: 'kind' },
  name: { documents: 'title', people: 'display_name' },

  // The quality register, and the fourth time this meter has overstated the work by not knowing a
  // column's own name. Five of the seven fields it reported missing across inspections and NCRs were
  // renames, and two of the five had had a column since before this pass started. Checked one by one
  // against the column list in schema.sql.
  responsiblePerson: { qualityNcrs: 'responsible' },
  dueDate: { qualityNcrs: 'due_on' },
  detectionDate: { qualityNcrs: 'detected_on' },
  // Not a rename: the inspection screen's `correctiveActionRef` is read off an NCR and is on the
  // inspection record only because the demo data copies it there. It is a join, below.
  requiredAction: { qualityHolds: 'required_action' },

  // The sales pipeline, and the sixth correction to this meter of the same kind — this time all twelve
  // of the fields it called missing across leads and opportunities. Every one has had a column since the
  // pipeline was written, under the longer name the schema uses for a date or a figure. That mattered:
  // README and BACKEND.md both said the remaining width was "concentrated on estimating, purchasing and
  // the sales pipeline", and the pipeline part of that sentence was a measurement artefact.
  size: { marketingLeads: 'company_size' },
  service: { marketingLeads: 'service_wanted' },
  lastContact: { marketingLeads: 'last_contact_on' },
  nextFollowUp: { marketingLeads: 'next_follow_up_on' },
  commPref: { marketingLeads: 'contact_preference' },
  dnc: { marketingLeads: 'do_not_contact' },
  linkedCustomerId: { marketingLeads: 'customer_id' },
  expectedDecision: { marketingOpportunities: 'expected_decision_on' },
  requiredDelivery: { marketingOpportunities: 'required_delivery_on' },
  followUpDate: { marketingOpportunities: 'follow_up_on' },

  // The supplier register, and the fifth correction to this meter of exactly the same kind. Four of
  // the six fields it reported missing were renames of columns added in the same commit — the screen's
  // `type`, `payment`, `delivery` and `minimum` are `supplier_type`, `payment_terms_days`,
  // `delivery_terms` and `minimum_order`. Written per collection because `type` already means two other
  // things: a customer's is direct/reseller/oem and a document's is Certificate/Drawing/Report.
  payment: { suppliers: 'payment_terms_days' },
  delivery: { suppliers: 'delivery_terms' },
  minimum: { suppliers: 'minimum_order' }
};

// Deliberately NOT mapped, having looked at what they hold:
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
  'estimationId',
  // A movement names its item by code, which is a column on stock_item. A copy of it on the movement
  // is a copy that can disagree with the item it points at.
  'code',
  // Whose enquiry it is. On a lead `company` IS the record — a lead is a company nobody has dealt with
  // yet — and the column is there, so `stored` wins for leads before this line is reached. It bites on an
  // opportunity, where the name belongs to the customer or the lead it points at. Not mapped to `title`,
  // which was the first guess here and was wrong: an opportunity's title is what the work is, not who
  // wants it.
  'company',
  // The jobcard a machine is on right now, which is the current row in `equipment_assignment` — the
  // table whose partial unique index is what makes "one machine, one jobcard" true. A column on
  // equipment would be a second answer to the same question, and the two would disagree the first time
  // an assignment was returned.
  'assignedJobcard',
  // A timestamp derived from the newest event against the machine. Storing it is storing an answer that
  // has to be kept in step with the rows it is computed from, which is how a figure goes stale.
  'lastActivity',
  // The corrective action an inspection's failure was answered by. It belongs to the NCR raised about
  // that failure — ncr.corrective_action_ref — and the inspection reaches it through `ncrRef`. A copy
  // on the inspection is a copy that can disagree with the NCR it names.
  'correctiveActionRef'
]);

// Fields holding a list. These want a child table, not a column, for the reason every other list in
// this schema already has one: a JSON array cannot have a foreign key or a constraint on its rows.
const A_CHILD_TABLE = new Set([
  'workers', 'machines', 'bom', 'contacts', 'items', 'documents', 'subgroups', 'activity',
  // The inspection checklist: a line, a verdict, and for a measured line a nominal, a tolerance band
  // and a reading. `inspection_check` holds it, one row per line, with the constraints a JSON array
  // could not have — a nominal with no band to judge it by is refused there, and would be a silently
  // unjudgeable line here.
  'checklist',
  'operations', 'materials', 'attachments', 'lines', 'events', 'history', 'checks', 'readings',
  // Lists whose child table already exists and is already pointing the right way: jobcard.project_id,
  // hours_entry.jobcard_id, inspection.jobcard_id. They were counted as missing columns, which is
  // the one thing they must never become — a list in a column cannot have a foreign key.
  'jobcards', 'hours', 'inspections',
  // The tenders on an opportunity and the leads on a campaign. `tender.opportunity_id` already exists;
  // campaigns have no table, which is why that collection is named in NOT_MEASURED above.
  'tenders',
  // The orders raised against a merchant and the certificates filed against them. Both already have a
  // table pointing the right way — purchase_order.supplier_id, document.entity/entity_id — and the
  // supplier screen reads them live rather than holding a copy, which is what it should do: a stored
  // list of orders is a list that goes stale the moment one is raised anywhere else.
  'purchaseOrders', 'docs',
  // The opportunity a lead became. `opportunity.lead_id` points the right way already, and a second copy
  // of the link on the lead is a second thing that can be wrong about which is which.
  'linkedOpportunityId',
  // The equipment screen's six logs, every one of them a list of dated events against a machine, and
  // every one of them already a row in `equipment_event` — which has a kind for each: service,
  // calibration, inspection, breakdown, pre-use-check, repair. They were being counted as six missing
  // columns, and six lists in six columns is the shape this schema exists not to have. `usageHistory`
  // is the one that is not an event: it is the assignment record, and `equipment_assignment` holds it.
  'maintenance', 'certifications', 'calibrations', 'notesLog', 'usageHistory', 'downtimeRecords',
  // The pre-use checks a welder signs before running a machine. `equipment_event` has a kind for them,
  // and it is the one list in this app whose rows a safety gate actually reads.
  'preUseChecks'
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

  // Every collection in the demonstration workshop is either measured above or named as deliberately not
  // measured. A collection in neither is one this file is silent about, which is worse than reporting it
  // as a gap: the number at the bottom reads as though it covered everything.
  // Every list in the state, not only the ones the demonstration fixture happens to have filled. The
  // emptiness test used to come first, and `people` slipped past this check on the run it was added:
  // a collection nobody has mapped is unaccounted for whether or not a fixture carries a record of it,
  // and it is newest — least likely to be in the map — exactly when it is still empty.
  const unaccounted = Object.keys(records)
    .filter((name) => Array.isArray(records[name]))
    .filter((name) => !TABLE_FOR[name] && !NOT_MEASURED[name]);
  if (unaccounted.length) {
    console.error(`\nThese collections carry records and this meter says nothing about them, `
      + `so every figure below is about less than the whole app: ${unaccounted.join(', ')}`);
    console.error('Add each to TABLE_FOR, or to NOT_MEASURED with the reason.');
    process.exitCode = 1;
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
  const BASELINE = { stored: 299, needsColumn: 20 };
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
