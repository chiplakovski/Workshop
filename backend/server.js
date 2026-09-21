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
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 8787);

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
  book_hours: ['jobcard_id', 'operation_id', 'hours', 'worked_on', 'note', 'event_id'],
  record_operation: ['operation_id', 'status', 'event_id'],
  issue_material_offline: ['item_id', 'quantity', 'jobcard_id', 'note', 'event_id']
};

// Reads. Same idea as RPC and the same reason for the list: without it this is a remote SQL console.
// Both are plain function calls — the snapshot is built in SQL because renaming a field in the
// browser is sixteen edits, and renaming it here is one.
const READS = {
  snapshot: 'workspace_snapshot',
  money: 'workspace_money'
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
  const token = bearer(req);
  if (!token) return send(res, 401, { refused: 'sign in first' });

  const args = parameters.map((key) => (body[key] === undefined ? null : body[key]));
  const placeholders = parameters.map((_, i) => `$${i + 1}`).join(', ');

  const result = await asSignedIn(token, async (client) => {
    const { rows } = await client.query(`SELECT ${name}(${placeholders}) AS result`, args);
    return { status: 200, body: { result: rows[0].result } };
  });
  return send(res, result.status, result.body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const key = `${req.method} ${url.pathname}`;
    const body = req.method === 'POST' ? await readBody(req) : {};

    if (routes[key]) return await routes[key](req, res, body);
    if (req.method === 'POST' && url.pathname.startsWith('/rpc/')) {
      return await handleRpc(req, res, url.pathname.slice(5), body);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/read/')) {
      return await handleRead(req, res, url.pathname.slice(6));
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
  server.listen(PORT, () => console.log(`Varmak API on ${PORT}, database ${pool.options.database}`));
}

module.exports = { server, pool, RPC, READS };
