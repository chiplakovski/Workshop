'use strict';

// The HTTP layer, and deliberately almost nothing.
//
// Every workflow lives in api.sql as a database function, for the reason BACKEND.md §4 gives: a
// workflow written in the server holds until somebody adds a second caller. So this file carries
// requests to those functions and does not decide anything. It contains no INSERT, UPDATE or
// DELETE, no branch on a role, no check that could be got around by talking to the database another
// way — and test-server.js asserts that by reading this file, because a rule like that decays the
// moment it is only a comment.
//
// What it does do is the one thing that cannot live in SQL: turn a bearer token into a session.
//
//   1. Ask the database who the token belongs to (session_identity, the only thing the pool's own
//      role may call).
//   2. Open a transaction, SET LOCAL ROLE to that person's role and SET LOCAL app.user_id to their
//      id — both LOCAL, so they cannot leak to the next request that borrows the connection.
//   3. Call the requested function.
//
// The role comes from the row the database returned, never from anything the client sent. A request
// with no token gets a connection that has become nobody and can read nothing.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const companyLookup = require('./company-lookup');
const OrgNumber = require('../org-number.js');

const PORT = Number(process.env.PORT || 8787);
// Every interface by default, because the usual case is a container whose port is published. Behind a
// reverse proxy on the same machine set HOST=127.0.0.1, so the only way in is through the proxy that
// terminates TLS — otherwise the plain-HTTP port is reachable from the network as well.
const HOST = process.env.HOST || '0.0.0.0';

// The pages are served from here too, and the endpoints live under /api. One origin, which means no
// CORS anywhere — not as a shortcut, but because a second origin is a whole class of problem (a
// preflight for every write, a header list to keep in step, a token that has to survive a redirect)
// bought in exchange for nothing this workshop needs. The app is sixteen files in one directory.
const SITE = path.resolve(__dirname, '..');
const SERVABLE = new Set(['.html', '.js', '.css', '.svg', '.png', '.ico', '.woff2', '.webmanifest']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json'
};

// Only files sitting directly in the site directory, and only these extensions. Both halves matter:
// the extension list keeps backend/*.sql out, and refusing anything with a directory in it keeps
// backend/server.js, node_modules and .git out — all of which are .js or would resolve happily.
// A containment check alone would have served every one of them.
function servableFile(pathname) {
  let decoded;
  // A malformed escape (`/%E0%A4%A`) is a request for no page, not a fault at our end.
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const name = pathname === '/' ? 'login.html' : decoded.replace(/^\/+/, '');
  if (name.includes('/') || name.includes('\\') || name.startsWith('.')) return null;
  if (!SERVABLE.has(path.extname(name))) return null;
  const resolved = path.join(SITE, name);
  try {
    return fs.statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

// Where the database is, and how much of it may be trusted on the way there.
//
// Two shapes, because the two places this runs are genuinely different. On a development machine it
// is a unix socket in /tmp with trust authentication and no password to leak. On a hosted database —
// Supabase, or anything else — it is a TCP connection across a network somebody else owns, and then
// two things become non-negotiable: a password, and TLS that is actually verified.
//
// DATABASE_URL is the whole connection in one string because that is what a hosted database hands
// you. It must name varmak_api as the user: the pool's role is what holds the system's privileges
// apart, and connecting as the database owner would make every GRANT in auth.sql decoration.
function databaseSettings() {
  const url = process.env.DATABASE_URL;
  const max = Number(process.env.PGPOOL || 8);
  if (!url) {
    return {
      host: process.env.PGHOST || '/tmp',
      port: Number(process.env.PGPORT || 5433),
      user: process.env.VARMAK_API_USER || 'varmak_api',
      password: process.env.PGPASSWORD || undefined,
      database: process.env.PGDATABASE || 'varmak',
      ssl: process.env.PGSSLROOTCERT ? { ca: fs.readFileSync(process.env.PGSSLROOTCERT, 'utf8') } : undefined,
      max
    };
  }
  // Verified, not merely encrypted. `sslmode=require` in a connection string means "encrypt" and
  // nothing about who is on the other end — so anyone who can answer for that hostname reads every
  // row and every session token. PGSSLROOTCERT is the project's CA certificate, downloaded from the
  // database's own dashboard; without it the system's trust store is used, which is correct when the
  // certificate is from a public CA and fails loudly rather than quietly when it is not.
  const ssl = { rejectUnauthorized: true };
  if (process.env.PGSSLROOTCERT) ssl.ca = fs.readFileSync(process.env.PGSSLROOTCERT, 'utf8');
  // `sslmode` is taken out of the string on purpose, and this is not tidiness. node-postgres parses
  // that parameter and the settings it derives REPLACE the ones passed here — certificate authority
  // and all — so a connection string copied from a database's own dashboard, which is exactly how
  // anybody gets one, quietly undoes the verification set up two lines above. TLS here is not
  // configurable: it is always on and always verified, and the string does not get a vote.
  const parsed = new URL(url);
  parsed.searchParams.delete('sslmode');
  parsed.searchParams.delete('ssl');
  return { connectionString: parsed.toString(), ssl, max };
}

// The two ways to deploy this and be wrong about it, refused at startup rather than found later.
//
// Neither is hypothetical. A TCP connection with no password is a database anyone who can reach the
// host can open; a connection as the owning role is one where every GRANT and every policy in
// auth.sql applies to nobody, because the owner is not subject to them — and the system would look
// exactly as it does when it is working, right up until a welder reads a price.
function refuseToStartIf(settings) {
  const url = settings.connectionString ? new URL(settings.connectionString) : null;
  const host = url ? url.hostname : settings.host;
  const user = url ? decodeURIComponent(url.username || '') : settings.user;
  const password = url ? url.password : settings.password;
  const local = !url && String(host || '').startsWith('/');
  if (!local && !password) {
    return `the database is at ${host} over the network and no password is set. `
      + 'Set DATABASE_URL (or PGPASSWORD) — a database reachable without one is a database anyone '
      + 'who can reach that host can open.';
  }
  if (user && user !== 'varmak_api' && !process.env.VARMAK_ALLOW_ANY_DB_USER) {
    return `connecting as ${user} rather than varmak_api. The pool's role is what holds this system's `
      + 'privileges apart: as the owner, every GRANT and every policy in auth.sql applies to nobody '
      + 'and nothing would look wrong until somebody read a price they should not see.';
  }
  return null;
}

const settings = databaseSettings();
const pool = new Pool(settings);
// A connection that drops while it sits idle in the pool — a hosted database restarting, a network
// blip, a pooler closing quiet connections — is reported here. Without a listener node treats it as
// an unhandled error and the whole server exits, taking every request in flight with it. The pool
// has already thrown that connection away; the next request simply opens a fresh one.
pool.on('error', (error) => {
  console.error(`database connection dropped while idle: ${error.message}`);
});

// The only functions reachable over HTTP, and the order their arguments go in. An allow-list rather
// than "call whatever they name": without it this is a remote SQL console, and the roles would be
// the only thing standing between a welder and every function in the database.
const RPC = {
  send_estimate: ['estimate_id', 'valid_days'],
  accept_estimate: ['estimate_id'],
  receive_goods: ['line_id', 'quantity', 'note'],
  convert_lead: ['lead_id', 'org_no', 'vat_no'],

  // Customers. The order is the function's parameter order, which is what this list is for.
  save_customer: ['id', 'name', 'status', 'city', 'country', 'org_no', 'vat_no', 'email', 'phone',
    'website', 'industry', 'customer_since', 'customer_type', 'is_preferred', 'preferred_contact',
    'notes',
    'credit_limit', 'currency', 'payment_terms_days', 'price_list', 'delivery_terms',
    'discount_agreement', 'billing_address', 'shipping_address'],
  set_customer_contacts: ['customer_id', 'contacts'],

  // Work. save_jobcard has no customer parameter on purpose — it comes from the project.
  save_project: ['id', 'name', 'customer_id', 'status', 'planned_hours', 'progress', 'deadline',
    'description', 'phase', 'work_types', 'po_number', 'workshop', 'responsible', 'material_status',
    'notes', 'planned_start', 'planned_completion', 'expected_completion', 'deliver_on',
    'hold_reason', 'hold_comment', 'expected_resume', 'cancel_reason', 'quoted_value'],
  save_jobcard: ['id', 'project_id', 'title', 'status', 'item', 'quantity', 'drawing_no', 'revision',
    'planned_hours', 'planned_start', 'planned_completion', 'delivery_target', 'work_type',
    'location', 'priority', 'responsible', 'material_readiness', 'heat_no', 'material_cert_ref',
    'notes', 'progress', 'inspection_required'],
  set_jobcard_operations: ['jobcard_id', 'operations'],

  // The store. save_stock_item has no stock parameter on purpose — steel arrives through a movement.
  // The machines. The register is the office's; recording what happened to one is the floor's as well,
  // and the database decides which is which rather than this list.
  save_equipment: ['id', 'ref', 'name', 'category', 'status', 'manufacturer', 'model', 'serial_no',
    'asset_no', 'year_of_manufacture', 'description', 'current_location', 'home_location',
    'department', 'responsible_person', 'operator', 'condition', 'criticality', 'safety_warnings',
    'certification_expiry', 'purchase_date', 'purchase_supplier', 'purchase_price',
    'warranty_expiry', 'operating_hours', 'service_interval_hours', 'qr_code',
    'pre_use_check_required', 'notes'],
  record_equipment_event: ['equipment_id', 'kind', 'result', 'happened_on', 'next_due_on', 'cost',
    'note', 'jobcard_id', 'resolves_event_id', 'event_id'],
  assign_equipment: ['equipment_id', 'jobcard_id', 'event_id'],
  return_equipment: ['equipment_id', 'note', 'event_id'],

  save_stock_item: ['id', 'code', 'description', 'unit', 'group_id', 'subgroup_id', 'location_id',
    'sublocation_id', 'bin_code', 'category', 'grade', 'dimensions', 'base_unit', 'size_per_unit',
    'weight_per_base', 'unit_weight', 'min_stock', 'reorder_quantity', 'heat_no',
    'material_cert_ref', 'avg_cost', 'last_price'],
  receive_stock: ['item_id', 'quantity', 'unit_price', 'supplier', 'delivery_note', 'heat_no',
    'material_cert_ref', 'bin_code', 'note'],
  record_stocktake: ['item_id', 'counted', 'note'],

  // The sales pipeline, all of it the office's — every record in it carries a figure somebody is quoting
  // or hoping for.
  save_lead: ['id', 'company', 'contact', 'email', 'phone', 'city', 'country', 'industry',
    'company_size', 'source', 'service_wanted', 'estimated_value', 'priority', 'status', 'owner',
    'last_contact_on', 'next_follow_up_on', 'contact_preference', 'do_not_contact', 'notes'],
  save_opportunity: ['id', 'title', 'customer_id', 'lead_id', 'stage', 'value', 'probability',
    'contact', 'industry', 'services', 'scope', 'owner', 'expected_close', 'expected_decision_on',
    'required_delivery_on', 'competitor', 'decision_reason', 'next_action', 'follow_up_on', 'currency'],
  save_tender: ['id', 'title', 'opportunity_id', 'customer_id', 'status', 'due_on', 'submitted_on',
    'value', 'company', 'customer_ref', 'source', 'industry', 'description', 'requirements',
    'responsible', 'bid_decision', 'reminder_on'],
  record_prospect_finding: ['lead_id', 'finding', 'source'],
  act_on_prospect_finding: ['finding_id', 'take_it', 'why'],

  // The merchants. The price list is money, so the database keeps all four of these to the office.
  save_supplier: ['id', 'name', 'category', 'status', 'org_no', 'vat_no', 'email', 'phone', 'website',
    'address', 'city', 'country', 'supplier_type', 'established', 'delivery_terms', 'minimum_order',
    'currency', 'rating', 'payment_terms_days', 'notes'],
  set_supplier_contacts: ['supplier_id', 'contacts'],
  add_supplier_note: ['supplier_id', 'text'],
  save_supplier_item: ['supplier_id', 'stock_item_id', 'price', 'article_no', 'currency', 'pack_size',
    'lead_time_days', 'is_preferred'],

  // Quality. place_hold and release_hold are both here and the database decides who may call them:
  // releasing is the office's, and it is the decision that lets work leave the building.
  place_hold: ['project_id', 'jobcard_id', 'reason', 'severity', 'required_action', 'related_ref'],
  release_hold: ['hold_id', 'authority', 'reason'],
  save_inspection: ['id', 'project_id', 'jobcard_id', 'kind', 'operation', 'component', 'drawing_no',
    'drawing_rev', 'method', 'acceptance_criteria', 'customer_witness', 'material_traceability_ok',
    'planned_date', 'inspector', 'status', 'notes'],
  complete_inspection: ['id', 'result', 'findings', 'critical', 'checks', 'actual_date', 'event_id'],
  // The lines an inspection is to be checked against, set before it is done. Reachable on its own
  // because the plan and the result are written at different times by different people: an inspection
  // and test plan says what will be measured, and the inspector then answers it. Nothing in the app
  // writes a plan yet — the ITP register has no table — so today this is how an imported or
  // office-prepared checklist reaches a request.
  replace_inspection_checks: ['inspection_id', 'lines'],
  create_reinspection: ['id'],
  save_ncr: ['id', 'title', 'project_id', 'jobcard_id', 'category', 'severity', 'description',
    'responsible', 'due_on', 'operation', 'component', 'material', 'supplier_id', 'notes'],
  record_ncr_step: ['id', 'step', 'text', 'ref'],
  add_quality_note: ['entity', 'entity_id', 'text'],

  // The document register. No storage key and no file parameter anywhere in this list, deliberately:
  // there is nowhere to put a file yet, and an endpoint that accepted a key would be an endpoint that
  // could be handed one pointing at nothing.
  save_document: ['id', 'title', 'kind', 'module', 'record', 'category', 'status', 'expires_on',
    'revision', 'author', 'notes'],
  link_document: ['id', 'module', 'record'],
  supersede_document: ['id', 'by_id'],
  remove_document_file: ['document_id'],
  add_document_note: ['id', 'text'],

  // The welding registers. `record_weld` takes no welder: the database takes it from the session, so a
  // weld cannot be logged in somebody else's name over HTTP any more than it can in SQL.
  record_weld: ['jobcard_id', 'process', 'component', 'wps_id', 'welder_qual_id', 'welded_on',
    'operation_id', 'drawing_no', 'weld_map_position', 'joint_type', 'base_material', 'material_grade',
    'thickness', 'filler_material', 'consumable_batch', 'shielding_gas', 'preheat_required',
    'interpass_temp_req', 'visual_required', 'ndt_required', 'ndt_method', 'notes'],
  record_weld_repair: ['weld_id', 'reason', 'notes'],
  record_ndt: ['weld_id', 'method', 'result', 'findings', 'procedure_ref', 'inspection_percent',
    'inspection_area', 'external_company', 'technician_cert_ref', 'inspected_on', 'acceptance_criteria',
    'repair_required', 'reinspection_required', 'notes'],
  accept_weld: ['weld_id', 'accepted', 'why'],
  save_wps: ['id', 'ref', 'process', 'revision', 'material_group', 'thickness_range', 'diameter_range',
    'joint_type', 'position', 'filler_material', 'shielding_gas', 'preheat_interpass', 'supporting_wpqr',
    'document_id', 'notes'],
  approve_wps: ['id', 'approve'],
  save_welder_qual: ['id', 'welder_id', 'qual_no', 'process', 'issued_by', 'issued_on', 'expires_on',
    'material_group', 'thickness_range', 'position', 'status', 'document_id', 'notes'],
  add_welding_note: ['entity', 'id', 'text'],

  book_hours: ['jobcard_id', 'operation_id', 'hours', 'worked_on', 'note', 'event_id'],
  record_operation: ['operation_id', 'status', 'event_id'],
  issue_material_offline: ['item_id', 'quantity', 'jobcard_id', 'note', 'event_id', 'heat_no'],

  // People. Without these a workshop has no way to give anybody access at all, which is the state
  // this system was in until now: adding somebody meant opening psql.
  bootstrap_first_admin: ['email', 'display_name', 'password'],
  add_person: ['email', 'display_name', 'role'],
  set_person_pin: ['user_id', 'pin'],
  set_person_password: ['user_id', 'password'],
  set_person_role: ['user_id', 'role'],
  set_person_active: ['user_id', 'active'],
  change_my_password: ['current', 'new'],

  // The letterhead. The database keeps it to an admin; this list only says what the call is shaped like.
  save_company: ['name', 'address', 'postcode', 'city', 'country', 'email', 'phone', 'website', 'org_no',
    'vat_no', 'f_skatt', 'bankgiro', 'iban', 'bic']
};

// The one call that works without a session, because at that moment there is nobody to sign in as.
// It refuses the instant the system has anybody in it, which the database checks — this list only
// decides whether the HTTP layer demands a token first.
const WITHOUT_A_SESSION = new Set(['bootstrap_first_admin']);

// The first administrator is the one account made with nobody signed in, and the database makes it
// for whoever asks first. Between the server going up and the owner opening /admin.html, that is
// anybody who finds the address. So the server holds a setup code, set where it runs and never in
// git, and the first-run form has to carry it. Long enough that guessing it is not a plan; compared
// in constant time; and with no code set, nobody can make the first administrator over HTTP at all —
// a server deployed without one is closed, not open. Once the first administrator exists the
// database refuses the bootstrap regardless, and the code stops mattering.
const SETUP_CODE_MINIMUM = 16;
function setupCodeRefusal(given) {
  const expected = process.env.VARMAK_SETUP_CODE || '';
  if (expected.length < SETUP_CODE_MINIMUM) {
    return 'this server has no setup code, so the first administrator cannot be made through it. '
      + `Set VARMAK_SETUP_CODE (${SETUP_CODE_MINIMUM} characters or more) where the server runs, restart it, and enter that code here.`;
  }
  const a = crypto.createHash('sha256').update(String(given == null ? '' : given)).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b) ? null : 'that is not this server\'s setup code';
}

// Reads. Same idea as RPC and the same reason for the list: without it this is a remote SQL console.
// Both are plain function calls — the snapshot is built in SQL because renaming a field in the
// browser is sixteen edits, and renaming it here is one.
const READS = {
  snapshot: 'workspace_snapshot',
  money: 'workspace_money',
  people: 'people',
  // What there is to bill for, computed on every read out of the hours and the material. Granted to the
  // office only, like the money, and refused to the floor by the database rather than by a branch here.
  invoice_basis: 'invoice_basis'
};

const ROLE_FOR = { admin: 'varmak_admin', office: 'varmak_office', workshop: 'varmak_workshop' };

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store'
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      // A body this size is not a workshop entering hours. Refused, and then no longer read: rejecting
      // alone left the stream running and every further chunk still appended, so one request that
      // never ended could take the server's memory with it.
      if (raw.length > 64 * 1024) {
        raw = '';
        req.removeAllListeners('data');
        req.removeAllListeners('end');
        req.pause();
        reject(Object.assign(new Error('request too large'), { status: 413 }));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('body is not JSON')); }
    });
    req.on('error', reject);
  });
}

// A document's file, which is the one body this server takes that is not JSON and not small. Read to
// its limit and no further, for the same reason as readBody above.
const FILE_LIMIT = 10 * 1024 * 1024;
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        req.removeAllListeners('data');
        req.removeAllListeners('end');
        req.pause();
        reject(Object.assign(new Error('request too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function bearer(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+([0-9a-f]{64})$/i.exec(header.trim());
  return match ? match[1] : null;
}

// Everything a signed-in request does happens inside this, so the role and the identity are set and
// unset together with the transaction. SET LOCAL rather than SET: a pooled connection is handed to
// the next request afterwards, and a role left behind on it would be somebody else's authority.
async function asSignedIn(token, work) {
  const client = await pool.connect();
  try {
    const who = await client.query('SELECT * FROM session_identity($1)', [token]);
    if (!who.rows.length) return { status: 401, body: { refused: 'sign in again' } };
    const { user_id: userId, user_role: role, display_name: name } = who.rows[0];

    await client.query('BEGIN');
    // The role is chosen from a fixed map, so a role string from the database can never be
    // interpolated into SQL even if the column somehow held something unexpected.
    await client.query(`SET LOCAL ROLE ${ROLE_FOR[role]}`);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', String(userId)]);
    const result = await work(client, { userId, role, name });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// A refusal from the database is the answer, not a crash. The database writes its refusals for the
// person who will read them — "cannot issue 500 KG of S355-10: only 120 in stock" — so they are
// passed through rather than replaced with something this layer made up.
function refusalFrom(error) {
  const code = error.code || '';
  if (code === '42501') return { status: 403, body: { refused: 'that is not yours to do' } };
  if (['23514', '23505', '23503', '23502', 'P0001'].includes(code)) {
    return { status: 422, body: { refused: error.message } };
  }
  return null;
}

const routes = {
  'POST /auth/sign-in': async (req, res, body) => {
    const { email, secret, door, device } = body;
    if (!email || !secret || !['password', 'pin'].includes(door)) {
      return send(res, 400, { refused: 'email, secret and door are required' });
    }
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        'SELECT token, refused FROM sign_in($1, $2, $3::session_door, $4)', [email, secret, door, device || null]);
      const answer = rows[0] || {};
      if (!answer.token) return send(res, 401, { refused: answer.refused || 'that is not a login we recognise' });
      return send(res, 200, { token: answer.token });
    } finally {
      client.release();
    }
  },

  'POST /auth/sign-out': async (req, res) => {
    const token = bearer(req);
    if (!token) return send(res, 401, { refused: 'no token' });
    const client = await pool.connect();
    try {
      await client.query('SELECT sign_out($1)', [token]);
      return send(res, 200, { signed_out: true });
    } finally {
      client.release();
    }
  },

  'GET /health': async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return send(res, 200, { ok: true });
    } finally {
      client.release();
    }
  }
};

async function handleRead(req, res, name) {
  const fn = READS[name];
  if (!fn) return send(res, 404, { refused: `nothing called ${name} to read` });
  const token = bearer(req);
  if (!token) return send(res, 401, { refused: 'sign in first' });

  // No branch on the role here, and that is the point: a welder asking for the money is refused by
  // the database, because EXECUTE on workspace_money() was never granted to them. The server does
  // not know which of these two carries a price.
  const result = await asSignedIn(token, async (client) => {
    const { rows } = await client.query(`SELECT ${fn}() AS data`);
    return { status: 200, body: rows[0].data };
  });
  return send(res, result.status, result.body);
}

async function handleRpc(req, res, name, body) {
  const parameters = RPC[name];
  if (!parameters) return send(res, 404, { refused: `no workflow called ${name}` });
  // A list or an object is serialised here rather than passed through, and that is transport rather
  // than a decision: the only parameter type in this database that takes one is jsonb, and `pg`
  // would otherwise send a JS array as a Postgres ARRAY literal — which jsonb cannot parse, so a
  // perfectly well-formed contact list came back as "something went wrong at our end" instead of as
  // whatever the function had to say about it.
  const args = parameters.map((key) => {
    const given = body[key];
    if (given === undefined) return null;
    return (given !== null && typeof given === 'object') ? JSON.stringify(given) : given;
  });
  const placeholders = parameters.map((_, i) => `$${i + 1}`).join(', ');
  const token = bearer(req);

  if (WITHOUT_A_SESSION.has(name)) {
    const notThisCode = setupCodeRefusal(body.setup_code);
    if (notThisCode) return send(res, 403, { refused: notThisCode });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT ${name}(${placeholders}) AS result`, args);
      return send(res, 200, { result: rows[0].result });
    } finally {
      client.release();
    }
  }

  if (!token) return send(res, 401, { refused: 'sign in first' });

  const result = await asSignedIn(token, async (client) => {
    const { rows } = await client.query(`SELECT ${name}(${placeholders}) AS result`, args);
    return { status: 200, body: { result: rows[0].result } };
  });
  return send(res, result.status, result.body);
}

// The headers a page needs once it is on the open internet rather than on a laptop.
//
// The content-security-policy is the one that earns its place: it says which origins this app may
// load anything from, so an injected <script src> has nowhere to load from even if something does get
// injected. It has to allow inline scripts and inline styles, because these pages are written that
// way — sixteen self-contained files — and a policy that broke every page would be turned off within
// a day. Blocking foreign origins is most of the value and costs nothing here.
//
// The typefaces are the one exception, and they are named rather than allowed in general: the pages
// ask fonts.googleapis.com for them, which is also a request that will never arrive in a steel hall
// with no internet. Self-hosting them is a separate, better job.
// A firm's registered name and address from Bolagsverket, for the supplier and customer forms. Behind a
// session like every read — the lookup spends this firm's Bolagsverket quota and should not be open to
// whoever finds the address — though it touches no table. The credentials stay here, on the server.
async function handleLookup(req, res, given) {
  const token = bearer(req);
  if (!token) return send(res, 401, { refused: 'sign in first' });
  const session = await asSignedIn(token, async () => ({ status: 200 }));
  if (session.status !== 200) return send(res, session.status, session.body);
  if (!companyLookup.configured()) {
    return send(res, 501, { refused: 'the Bolagsverket lookup is not set up on this server' });
  }
  const checked = OrgNumber.check(given);
  if (!checked.ok) return send(res, 400, { refused: 'that is not a valid Swedish organisation number' });
  try {
    const found = await companyLookup.lookup(checked.digits);
    if (!found) return send(res, 404, { refused: 'Bolagsverket has no organisation with that number' });
    return send(res, 200, found);
  } catch (error) {
    if (error.lookup) return send(res, 502, { refused: error.message });
    if (error.name === 'TimeoutError' || error.name === 'AbortError' || error.cause) {
      return send(res, 502, { refused: 'Bolagsverket could not be reached just now' });
    }
    throw error;
  }
}

// The file behind a document. Stored and read through the database functions, which decide who may
// do either; this only carries the bytes. A file is always handed back as a download, with a type that
// cannot run: a page on this origin that rendered an uploaded HTML or SVG file would be a page anybody
// who could upload a document could write, with every session token in reach.
async function handleFile(req, res, given) {
  const token = bearer(req);
  if (!token) return send(res, 401, { refused: 'sign in first' });
  if (!/^[0-9]{1,18}$/.test(given)) return send(res, 404, { refused: 'no such document' });
  const id = Number(given);
  if (req.method === 'POST') {
    const content = await readRaw(req, FILE_LIMIT);
    let filename = '';
    try { filename = decodeURIComponent(String(req.headers['x-filename'] || '')); } catch { filename = ''; }
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim() || null;
    const result = await asSignedIn(token, async (client) => {
      const { rows } = await client.query('SELECT store_document_file($1, $2, $3, $4) AS result',
        [id, filename, mime, content]);
      return { status: 200, body: { result: rows[0].result } };
    });
    return send(res, result.status, result.body);
  }
  if (req.method !== 'GET') return send(res, 405, { refused: 'not allowed' });
  const result = await asSignedIn(token, async (client) => {
    const { rows } = await client.query('SELECT * FROM document_file_content($1)', [id]);
    return rows.length ? { status: 200, file: rows[0] }
      : { status: 404, body: { refused: 'no file is stored for that document' } };
  });
  if (!result.file) return send(res, result.status, result.body);
  const { filename, mime_type: type, content } = result.file;
  const runnable = /html|xml|svg|javascript|ecmascript/i.test(type || '');
  res.writeHead(200, {
    'content-type': !type || runnable ? 'application/octet-stream' : type,
    'content-length': content.length,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename || 'file')}`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'",
    'cache-control': 'no-store'
  });
  return res.end(content);
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  // The hub's radio plays a broadcaster's stream from wherever that broadcaster serves it, and
  // streams move between hosts; audio is all this allows, never a script or a page.
  "media-src 'self' https:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'"
].join('; ');

function pageSafety(req) {
  const headers = {
    'content-security-policy': CSP,
    // The pages are typed in three languages and hold the workshop's prices; a browser guessing the
    // type of a response it was handed is a way to have one of them run as something else.
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY'
  };
  // Only when the request actually arrived over TLS, which behind a reverse proxy is what this header
  // says. Sending it over plain HTTP would tell a browser to refuse the only address that works,
  // which on a development machine means locking yourself out of your own laptop.
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (proto === 'https') headers['strict-transport-security'] = 'max-age=31536000';
  return headers;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    // Anything not under /api is a page or its script.
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { refused: 'not allowed' });
      const file = servableFile(url.pathname);
      if (!file) return send(res, 404, { refused: 'no such page' });
      const body = fs.readFileSync(file);
      res.writeHead(200, Object.assign({
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
        'content-length': body.length,
        // The pages are edited constantly in a prototype; a cached stale one wastes an afternoon.
        'cache-control': 'no-cache'
      }, pageSafety(req)));
      return res.end(req.method === 'HEAD' ? undefined : body);
    }

    const route = url.pathname.slice(4);
    const key = `${req.method} ${route}`;
    // Before the JSON body is read, because a file is neither.
    if (route.startsWith('/files/')) return await handleFile(req, res, route.slice(7));
    const body = req.method === 'POST' ? await readBody(req) : {};

    if (routes[key]) return await routes[key](req, res, body);
    if (req.method === 'POST' && route.startsWith('/rpc/')) {
      return await handleRpc(req, res, route.slice(5), body);
    }
    if (req.method === 'GET' && route.startsWith('/read/')) {
      return await handleRead(req, res, route.slice(6));
    }
    if (req.method === 'GET' && route.startsWith('/lookup/company/')) {
      return await handleLookup(req, res, decodeURIComponent(route.slice(16)));
    }
    return send(res, 404, { refused: 'no such endpoint' });
  } catch (error) {
    if (error.status === 413) {
      res.setHeader('connection', 'close');
      return send(res, 413, { refused: 'that request is too large' });
    }
    if (error.message === 'body is not JSON') return send(res, 400, { refused: 'that request is not JSON' });
    const refusal = refusalFrom(error);
    if (refusal) return send(res, refusal.status, refusal.body);
    // Anything not recognised as a refusal is this layer's fault, and the caller is told nothing
    // about the inside of the database.
    console.error(error);
    return send(res, 500, { refused: 'something went wrong at our end' });
  }
});

if (require.main === module) {
  const wrong = refuseToStartIf(settings);
  if (wrong) {
    console.error(`Refusing to start: ${wrong}`);
    process.exit(1);
  }
  if ((process.env.VARMAK_SETUP_CODE || '').length < SETUP_CODE_MINIMUM) {
    console.log(`No VARMAK_SETUP_CODE of ${SETUP_CODE_MINIMUM}+ characters: the first administrator cannot be made over HTTP until one is set.`);
  }
  server.listen(PORT, HOST, () => {
    const where = settings.connectionString
      ? new URL(settings.connectionString).hostname
      : `${settings.host}/${settings.database}`;
    console.log(`Varmak Workshop on http://${HOST}:${PORT} — database ${where}`);
  });
}

module.exports = { server, pool, RPC, READS, WITHOUT_A_SESSION, databaseSettings, refuseToStartIf, setupCodeRefusal };
