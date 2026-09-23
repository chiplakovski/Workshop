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

const pool = new Pool({
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT || 5433),
  user: process.env.VARMAK_API_USER || 'varmak_api',
  database: process.env.PGDATABASE || 'varmak',
  max: Number(process.env.PGPOOL || 8)
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
    'discount_agreement', 'billing_address'],
  set_customer_contacts: ['customer_id', 'contacts'],

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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    // Anything not under /api is a page or its script.
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { refused: 'not allowed' });
      const file = servableFile(url.pathname);
      if (!file) return send(res, 404, { refused: 'no such page' });
      const body = fs.readFileSync(file);
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
        'content-length': body.length,
        // The pages are edited constantly in a prototype; a cached stale one wastes an afternoon.
        'cache-control': 'no-cache'
      });
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
  server.listen(PORT, () => {
    console.log(`Varmak Workshop on http://localhost:${PORT} — database ${pool.options.database}`);
  });
}

module.exports = { server, pool, RPC, READS, WITHOUT_A_SESSION };
