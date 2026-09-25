'use strict';

// Can this system actually be installed onto a hosted database?
//
// Every other suite runs against the Postgres on this machine: a unix socket, trust authentication,
// and a superuser. A hosted database — Supabase, or any of them — is none of those three, and each
// difference turned out to break the install outright:
//
//   * **Not a superuser.** The most privileged role you are given has CREATEROLE and BYPASSRLS and
//     nothing more. `ALTER ROLE ... NOSUPERUSER` is refused from such a role even when it changes
//     nothing, so the install stopped four lines into the roles. And a CREATEROLE role that creates
//     another role gets ADMIN OPTION without the right to *become* it, so every
//     `ALTER FUNCTION ... OWNER TO varmak_engine` was refused after that — which is what makes the
//     functions allowed to step around row security belong to the role that may.
//   * **pgcrypto lives in its own schema.** `app_session.token` has
//     `DEFAULT encode(gen_random_bytes(32), 'hex')`, and a column default is parsed as the table is
//     created, so the install died three tables in on "function gen_random_bytes does not exist". The
//     quieter half of the same problem: `crypt()` is resolved when a function body runs, so an install
//     that finished could still be a system nobody can sign in to.
//   * **`public` no longer grants CREATE.** On PostgreSQL 15 and later the incoming owner of a
//     function needs CREATE on its schema and does not have it, so the ownership changes were refused
//     after the tables, the policies and every grant had already gone in.
//
// None of those are hypothetical and none were visible from this machine. So this suite builds a
// second Postgres that has the same shape — TLS only, a password, a non-superuser owner, pgcrypto in a
// schema of its own — runs `install.sh` against it exactly as a deployment would, and then drives the
// whole stack through it: the first administrator, a welder with a PIN, a job, hours booked and read
// back out of the database. The thing being tested is the deployment, not the workflows.
//
// The last question it asks is the one worth the most: on that hosted install, **can a welder read a
// price?** If the privileges did not survive, everything above still passes and that one does not.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BIN = process.env.VARMAK_PG_BIN || '/usr/lib/postgresql/16/bin';
const HOME = process.env.VARMAK_DEPLOY_DIR || '/var/lib/postgresql/varmak-deploy';
const PORT = process.env.VARMAK_DEPLOY_PGPORT || '5434';
const HTTP_PORT = Number(process.env.VARMAK_DEPLOY_PORT || 8941);
const DB = 'varmak_hosted';
// Throwaway, for a cluster that exists for the length of this file and listens only on loopback. The
// point of them is that they are checked at all, not what they are.
const SUPER = 'a-superuser-password';
const OWNER = 'owner-pw';
const API = 'an-api-password-long-enough';

let checks = 0;
const step = (message) => { checks += 1; console.log(`OK   ${message}`); };

const CERT = path.join(HOME, 'server.crt');
const as = (role, password, db) =>
  `postgresql://${role}:${password}@localhost:${PORT}/${db || DB}?sslmode=require`;
const psql = (url, args, input) => execFileSync('psql', [url, '-qtAX', '-v', 'ON_ERROR_STOP=1', ...args],
  { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const value = (text) => psql(as('postgres', SUPER, DB), ['-c', text]).split('\n')[0].trim();

// A Postgres shaped like a hosted one: TLS on, password authentication over TCP, loopback only.
//
// Its own cluster rather than the one the other suites use, because every difference from that cluster
// is the point — a suite that reused it would be testing the machine this was written on again.
function aHostedDatabase() {
  const data = path.join(HOME, 'data');
  const up = () => {
    try {
      execFileSync('psql', [as('postgres', SUPER, 'postgres'), '-qtAX', '-c', 'SELECT 1'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return true;
    } catch { return false; }
  };
  if (up()) return;

  fs.rmSync(HOME, { recursive: true, force: true });
  execFileSync('install', ['-d', '-o', 'postgres', '-g', 'postgres', HOME]);
  const pwfile = path.join(HOME, 'pw');
  execFileSync('su', ['postgres', '-c',
    `printf '%s' '${SUPER}' > ${pwfile} && ${BIN}/initdb -D ${data} --auth=scram-sha-256 -U postgres --pwfile=${pwfile}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  // Self-signed, and used as its own certificate authority — which is exactly the shape of a hosted
  // database's own CA certificate, so the server's TLS verification is tested rather than skipped.
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-keyout', path.join(HOME, 'server.key'), '-out', CERT,
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('chown', ['postgres:postgres', path.join(HOME, 'server.key'), CERT]);
  execFileSync('chmod', ['600', path.join(HOME, 'server.key')]);

  execFileSync('su', ['postgres', '-c',
    `${BIN}/pg_ctl -D ${data} -l ${path.join(HOME, 'log')} -o '-k /tmp -p ${PORT} `
    + `-c listen_addresses=127.0.0.1 -c ssl=on -c ssl_cert_file=${CERT} `
    + `-c ssl_key_file=${path.join(HOME, 'server.key')}' start -w -t 30`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!up()) throw new Error('the hosted-shaped Postgres did not come up');
}

// The database as a managed service hands it over: an owner that is not a superuser, and pgcrypto
// already installed in a schema of its own that the owner does not own either.
function anEmptyProject() {
  const root = as('postgres', SUPER, 'postgres');
  psql(root, ['-c', `DROP DATABASE IF EXISTS ${DB};`, '-c', `DROP DATABASE IF EXISTS ${DB}_strict;`]);
  // The roles are the cluster's, not the database's, so dropping the database leaves all five of them
  // standing — along with the membership the installer granted itself last time. A second run then
  // inherits a cluster that is already half set up, and every assertion about what the install created
  // passes on the leftovers. Found by a mutation that removed the membership grant and went unnoticed.
  psql(root, ['-c', `DROP ROLE IF EXISTS varmak_engine, varmak_api, varmak_admin,
    varmak_office, varmak_workshop;`]);
  psql(root, ['-c', `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deploy_owner') THEN
        CREATE ROLE deploy_owner LOGIN CREATEROLE CREATEDB BYPASSRLS NOSUPERUSER PASSWORD '${OWNER}';
      END IF;
    END $$;`]);
  psql(root, ['-c', `CREATE DATABASE ${DB} OWNER deploy_owner;`]);
  // Owned by nobody we are, with USAGE granted broadly — which is how a managed database presents its
  // extension schema, and the reason auth.sql checks the grant it makes rather than trusting it.
  psql(as('postgres', SUPER, DB), [
    '-c', 'CREATE SCHEMA extensions;',
    '-c', 'CREATE EXTENSION pgcrypto WITH SCHEMA extensions;',
    '-c', 'GRANT USAGE ON SCHEMA extensions TO PUBLIC;',
    '-c', 'GRANT ALL ON SCHEMA public TO deploy_owner;'
  ]);
  assert.equal(value(`SELECT rolsuper::text FROM pg_roles WHERE rolname = 'deploy_owner';`), 'false',
    'the role this is installed with must not be a superuser, or the suite proves nothing');
  assert.equal(value(`SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pgcrypto';`), 'extensions');
}

// install.sh reads the four files from beside itself, which is right for an installer and means a
// mutation of one of them would never reach it. So the installer and the four files are staged into a
// directory of their own first, with any file mutation-check.js has damaged put in place of the
// original. install.sh itself runs completely unmodified — it is the thing being tested, and a hook
// inside it for tests to use would be a hook a deployment could trip over.
const MUTATED = {
  schema: process.env.VARMAK_SCHEMA, auth: process.env.VARMAK_AUTH,
  api: process.env.VARMAK_API, views: process.env.VARMAK_VIEWS
};

function install(into) {
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'varmak-install-'));
  fs.copyFileSync(path.join(__dirname, 'install.sh'), path.join(staged, 'install.sh'));
  for (const name of ['schema', 'auth', 'api', 'views']) {
    fs.copyFileSync(MUTATED[name] || path.join(__dirname, `${name}.sql`), path.join(staged, `${name}.sql`));
  }
  try {
    return execFileSync('sh', [path.join(staged, 'install.sh')], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: as('deploy_owner', OWNER, into || DB), VARMAK_API_PASSWORD: API },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
}

async function main() {
  aHostedDatabase();
  step('Deploy: a Postgres with TLS, password authentication and a non-superuser owner is standing in for a hosted one');
  anEmptyProject();
  step('Deploy: and it is handed over the way a managed database hands one over — pgcrypto in its own schema');

  // ── The install ─────────────────────────────────────────────────────────────────────────
  const said = install();
  assert.match(said, /varmak_api can sign in/,
    `install.sh has to prove the server's own role can connect: ${said}`);
  assert.equal(value(`SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`), '36');
  assert.equal(value(`SELECT count(*) FROM pg_policies WHERE schemaname = 'public';`), '82');
  assert.equal(value(`SELECT string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles
    WHERE rolname LIKE 'varmak%';`), 'varmak_admin,varmak_api,varmak_engine,varmak_office,varmak_workshop');
  step('Deploy: all four files install as a non-superuser owner — 36 tables, 82 policies, five roles');

  // The attributes, because an install that finishes with the wrong ones is the failure that looks
  // like success. varmak_api holding BYPASSRLS would make every policy above decoration.
  assert.equal(value(`SELECT (rolsuper OR rolbypassrls)::text FROM pg_roles WHERE rolname = 'varmak_api';`),
    'false', 'the role the server connects as must be subject to every policy');
  assert.equal(value(`SELECT rolcanlogin::text FROM pg_roles WHERE rolname = 'varmak_api';`), 'true');
  assert.equal(value(`SELECT rolinherit::text FROM pg_roles WHERE rolname = 'varmak_api';`), 'false',
    'NOINHERIT: a connection that has not chosen a role can do nothing at all');
  assert.equal(value(`SELECT bool_and(NOT rolcanlogin) FROM pg_roles
    WHERE rolname IN ('varmak_admin', 'varmak_office', 'varmak_workshop', 'varmak_engine');`), 't',
    'the three roles and the engine are things to become, never things to connect as');
  assert.equal(value(`SELECT rolbypassrls::text FROM pg_roles WHERE rolname = 'varmak_engine';`), 'true');
  // Granted for the ownership changes and taken back: a standing CREATE would serve nobody.
  assert.equal(value(`SELECT has_schema_privilege('varmak_engine', 'public', 'CREATE')::text;`), 'false',
    'the CREATE granted for the ownership changes has to have gone back');
  assert.equal(value(`SELECT count(*) FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE r.rolname = 'varmak_engine';`), '18',
    'and the functions allowed to step around row security belong to the role that may');
  step('Deploy: the roles came out with the attributes that hold this system apart, and nothing more');

  // The path that a search_path gets wrong, asked directly: hashing a password needs pgcrypto, which
  // is not in public here.
  assert.equal(value(`SELECT s.setconfig[1] FROM pg_db_role_setting s
      JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'varmak_api';`),
    'search_path=public, extensions',
    'the connecting role has to be able to find crypt(), or nobody can sign in');
  step('Deploy: the connecting role searches the schema pgcrypto actually went into');

  // ── The stack, against that database ────────────────────────────────────────────────────
  process.env.DATABASE_URL = as('varmak_api', API, DB);
  process.env.PGSSLROOTCERT = CERT;
  process.env.PORT = String(HTTP_PORT);
  // Normally the file next door. mutation-check.js hands a damaged copy in through VARMAK_SERVER, the
  // same way the SQL suites are handed a damaged schema, so the two refusals below can be checked for
  // being checked at all.
  const { server, pool, refuseToStartIf, databaseSettings } = require(process.env.VARMAK_SERVER || './server');
  await new Promise((resolve) => server.listen(HTTP_PORT, resolve));
  const site = `http://127.0.0.1:${HTTP_PORT}`;
  const call = async (name, body, token) => {
    const response = await fetch(`${site}/api/rpc/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const signIn = async (email, secret, door) => {
    const response = await fetch(`${site}/api/auth/sign-in`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, secret, door })
    });
    return (await response.json()).token;
  };
  const read = async (what, token) => {
    const response = await fetch(`${site}/api/read/${what}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };

  try {
    const encrypted = await pool.query(
      `SELECT s.ssl, s.version FROM pg_stat_ssl s WHERE s.pid = pg_backend_pid();`);
    assert.equal(encrypted.rows[0].ssl, true,
      'the server\'s own connection to the database has to be encrypted, not merely possible to encrypt');
    assert.match(encrypted.rows[0].version, /^TLSv1\.[23]$/);
    step(`Deploy: the server reaches that database over verified ${encrypted.rows[0].version}, as varmak_api`);

    // Nobody can get in yet, which is the state an install leaves behind on purpose.
    assert.equal(value(`SELECT count(*) FROM app_user;`), '0');
    const first = await call('bootstrap_first_admin',
      { email: 'anna@varmak.se', display_name: 'Anna Berg', password: 'correct horse battery staple' });
    assert.equal(first.status, 200, `the first administrator has to be makeable: ${JSON.stringify(first.body)}`);
    const admin = await signIn('anna@varmak.se', 'correct horse battery staple', 'password');
    assert.ok(admin, 'and then sign in — which is the crypt() path, and the one a search_path breaks');
    step('Deploy: the first administrator is made and signs in — the hashing works where pgcrypto actually is');

    // A welder, a job, and hours booked against it: the chain the workshop uses every day, on the
    // hosted install rather than on this machine's socket.
    const marko = await call('add_person', { email: 'marko@varmak.se', display_name: 'Marko Ilic', role: 'workshop' }, admin);
    assert.equal(marko.status, 200);
    const markoId = value(`SELECT id FROM app_user WHERE email = 'marko@varmak.se';`);
    assert.equal((await call('set_person_pin', { user_id: Number(markoId), pin: '8472' }, admin)).status, 200);
    const customer = await call('save_customer', { name: 'MarineVent AB', city: 'Malmö', credit_limit: '250000' }, admin);
    assert.equal(customer.status, 200, JSON.stringify(customer.body));
    const customerId = value(`SELECT id FROM customer WHERE name = 'MarineVent AB';`);
    assert.equal((await call('save_project',
      { name: 'Conveyor frame', customer_id: Number(customerId), status: 'production', planned_hours: 40 }, admin)).status, 200);
    const projectId = value(`SELECT id FROM project WHERE name = 'Conveyor frame';`);
    const jobcard = await call('save_jobcard',
      { project_id: Number(projectId), title: 'Frame weldment', status: 'in-progress', planned_hours: 24 }, admin);
    assert.equal(jobcard.status, 200, JSON.stringify(jobcard.body));
    const jobcardId = value(`SELECT id FROM jobcard WHERE title = 'Frame weldment';`);

    const welder = await signIn('marko@varmak.se', '8472', 'pin');
    assert.ok(welder, 'a PIN on the shop tablet is the other door, and it hashes the same way');
    const booked = await call('book_hours',
      { jobcard_id: Number(jobcardId), hours: 6.5, event_id: 'deploy-once' }, welder);
    assert.equal(booked.status, 200, JSON.stringify(booked.body));
    assert.equal(value(`SELECT worker || '|' || hours::text FROM hours_entry;`), 'Marko Ilic|6.50',
      'in the name the PIN belonged to, taken from the session rather than from the request');
    // Asked twice, as a tablet flushing a queue does.
    assert.equal((await call('book_hours',
      { jobcard_id: Number(jobcardId), hours: 6.5, event_id: 'deploy-once' }, welder)).status, 200);
    assert.equal(value(`SELECT count(*) FROM hours_entry;`), '1', 'and asking twice is still harmless here');
    step('Deploy: a welder signs in with a PIN on that database and books hours that arrive once');

    // The question this whole suite is for. If the install connected as the owner, or if varmak_api
    // had come out with BYPASSRLS, everything above would pass and this would not.
    const money = await read('money', welder);
    assert.equal(money.status, 403, 'a welder must not be able to read the money view on a hosted install');
    const theirs = await read('snapshot', welder);
    assert.equal(theirs.status, 200);
    assert.ok(!JSON.stringify(theirs.body).includes('250000'),
      'and the credit limit must not be anywhere in what the tablet was sent');
    step('Deploy: and on that same install a welder still cannot read a price — the privileges survived');

    // ── The two deployments that are wrong, refused before they start ─────────────────────
    assert.match(refuseToStartIf({ host: 'db.example.com', user: 'varmak_api' }) || '',
      /no password is set/, 'a database over the network with no password has to be refused');
    assert.equal(refuseToStartIf({ host: '/tmp', user: 'varmak_api', database: 'varmak' }), null,
      'and a local socket with trust authentication is how this is developed, so it must still start');
    assert.match(refuseToStartIf({ connectionString: as('postgres', SUPER, DB) }) || '',
      /rather than varmak_api/,
      'connecting as the owner makes every grant and policy in auth.sql apply to nobody');
    assert.equal(refuseToStartIf({ connectionString: as('varmak_api', API, DB) }), null);
    step('Deploy: a deployment with no database password, or one connecting as the owner, refuses to start');

    // TLS verification is on by default, and the one place it could quietly not be is here.
    const settings = databaseSettings();
    assert.equal(settings.ssl.rejectUnauthorized, true,
      'sslmode=require encrypts and verifies nothing; the certificate has to be checked');
    assert.ok(settings.ssl.ca && settings.ssl.ca.includes('BEGIN CERTIFICATE'));
    step('Deploy: the database certificate is verified rather than merely accepted');

    // ── What a browser is told, once this is on the open internet ─────────────────────────
    const plain = await fetch(`${site}/hours-mobile.html`);
    assert.equal(plain.status, 200);
    assert.match(plain.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.equal(plain.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(plain.headers.get('strict-transport-security'), null,
      'not over plain HTTP: it would tell a browser to refuse the only address that works');
    const behindTls = await fetch(`${site}/hours-mobile.html`, { headers: { 'x-forwarded-proto': 'https' } });
    assert.match(behindTls.headers.get('strict-transport-security') || '', /max-age=\d+/,
      'and behind a proxy that terminated TLS, it is sent');
    step('Deploy: the pages carry a content policy, and HSTS exactly when the request arrived over TLS');

    // ── A database where the grant cannot be made ─────────────────────────────────────────
    //
    // The shape above is the common one: the extension schema belongs to somebody else but USAGE is
    // granted broadly, so auth.sql's GRANT comes back as a WARNING and everything still works. The
    // other shape is a database where that schema is closed, and there the install MUST stop — because
    // the alternative is a WARNING nobody reads followed by a system nobody can sign in to, on the
    // morning the workshop meant to start using it. Asked here, with the refusal's own wording.
    const root = as('postgres', SUPER, 'postgres');
    psql(root, ['-c', `CREATE DATABASE ${DB}_strict OWNER deploy_owner;`]);
    psql(as('postgres', SUPER, `${DB}_strict`), [
      '-c', 'CREATE SCHEMA extensions;',
      '-c', 'CREATE EXTENSION pgcrypto WITH SCHEMA extensions;',
      '-c', 'REVOKE ALL ON SCHEMA extensions FROM PUBLIC;',
      '-c', 'GRANT ALL ON SCHEMA public TO deploy_owner;',
      '-c', 'GRANT USAGE ON SCHEMA extensions TO deploy_owner;'
    ]);
    let refused = null;
    try {
      install(`${DB}_strict`);
    } catch (error) {
      refused = `${error.stdout || ''}${error.stderr || ''}`;
    }
    assert.ok(refused, 'an install that cannot let the engine reach pgcrypto has to stop, not warn');
    assert.match(refused, /varmak_engine cannot use schema extensions/);
    assert.match(refused, /GRANT USAGE ON SCHEMA extensions TO varmak_engine/,
      'and hand over the one line somebody has to run');
    step('Deploy: a database that cannot let the engine reach pgcrypto is refused at install, with the fix in it');
  } finally {
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(`\n${checks} checks: this system installs onto a hosted database as a non-superuser, over`);
  console.log('verified TLS, and a welder still cannot read a price on the result.');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
