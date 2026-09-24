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
const { Pool } = require('pg');

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
  const name = pathname === '/' ? 'login.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
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

  save_stock_item: ['id', 'code', 'description', 'unit', 'group_id', 'subgroup_id', 'location_id',
    'sublocation_id', 'bin_code', 'category', 'grade', 'dimensions', 'base_unit', 'size_per_unit',
    'weight_per_base', 'unit_weight', 'min_stock', 'reorder_quantity', 'heat_no',
    'material_cert_ref', 'avg_cost', 'last_price'],
  receive_stock: ['item_id', 'quantity', 'unit_price', 'supplier', 'delivery_note', 'heat_no',
    'material_cert_ref', 'bin_code', 'note'],
  record_stocktake: ['item_id', 'counted', 'note'],

  book_hours: ['jobcard_id', 'operation_id', 'hours', 'worked_on', 'note', 'event_id'],
  record_operation: ['operation_id', 'status', 'event_id'],
  issue_material_offline: ['item_id', 'quantity', 'jobcard_id', 'note', 'event_id'],

  // People. Without these a workshop has no way to give anybody access at all, which is the state
  // this system was in until now: adding somebody meant opening psql.
  bootstrap_first_admin: ['email', 'display_name', 'password'],
  add_person: ['email', 'display_name', 'role'],
  set_person_pin: ['user_id', 'pin'],
  set_person_password: ['user_id', 'password'],
  set_person_role: ['user_id', 'role'],
  set_person_active: ['user_id', 'active'],
  change_my_password: ['current', 'new']
};

// The one call that works without a session, because at that moment there is nobody to sign in as.
// It refuses the instant the system has anybody in it, which the database checks — this list only
// decides whether the HTTP layer demands a token first.
const WITHOUT_A_SESSION = new Set(['bootstrap_first_admin']);

// Reads. Same idea as RPC and the same reason for the list: without it this is a remote SQL console.
// Both are plain function calls — the snapshot is built in SQL because renaming a field in the
// browser is sixteen edits, and renaming it here is one.
const READS = {
  snapshot: 'workspace_snapshot',
  money: 'workspace_money',
  people: 'people'
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
      // A body this size is not a workshop entering hours.
      if (raw.length > 64 * 1024) reject(new Error('request too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('body is not JSON')); }
    });
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
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
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
    const body = req.method === 'POST' ? await readBody(req) : {};

    if (routes[key]) return await routes[key](req, res, body);
    if (req.method === 'POST' && route.startsWith('/rpc/')) {
      return await handleRpc(req, res, route.slice(5), body);
    }
    if (req.method === 'GET' && route.startsWith('/read/')) {
      return await handleRead(req, res, route.slice(6));
    }
    return send(res, 404, { refused: 'no such endpoint' });
  } catch (error) {
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
  server.listen(PORT, HOST, () => {
    const where = settings.connectionString
      ? new URL(settings.connectionString).hostname
      : `${settings.host}/${settings.database}`;
    console.log(`Varmak Workshop on http://${HOST}:${PORT} — database ${where}`);
  });
}

module.exports = { server, pool, RPC, READS, WITHOUT_A_SESSION, databaseSettings, refuseToStartIf };
