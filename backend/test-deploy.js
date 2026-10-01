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
// A dashboard SQL editor sends the whole buffer as one simple query, which psql cannot do: -c has
// an argument-length limit a 7,000-line file goes straight past, and -f splits it into statements.
// So that one path is driven through the driver the server itself uses.
const { Client } = require('pg');

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
  psql(root, ['-c', `DROP DATABASE IF EXISTS ${DB};`, '-c', `DROP DATABASE IF EXISTS ${DB}_strict;`,
    '-c', `DROP DATABASE IF EXISTS ${DB}_editor;`, '-c', `DROP DATABASE IF EXISTS ${DB}_probe;`]);
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
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`), '41');
  assert.equal(value(`SELECT count(*) FROM pg_policies WHERE schemaname = 'public';`), '94');
  assert.equal(value(`SELECT string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles
    WHERE rolname LIKE 'varmak%';`), 'varmak_admin,varmak_api,varmak_engine,varmak_office,varmak_workshop');
  step('Deploy: all four files install as a non-superuser owner — 41 tables, 94 policies, five roles');

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
    WHERE r.rolname = 'varmak_engine';`), '20',
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

    // ── The install with no terminal in it ────────────────────────────────────────────────
    //
    // Everything above installs with install.sh, which needs a shell, psql and four files in the right
    // order. The person this was built for has none of those and should not have to acquire them: a
    // managed database has a SQL editor in its own dashboard, so backend/supabase-install.sql is the four
    // files as one thing to paste. That makes it a second copy of 7,000 lines of schema, and a second
    // copy drifts — silently, and in the direction of a database that is a release behind the code.
    //
    // So: it is generated, and the generation is checked here against the file in the repository, byte for byte.
    // Then it is actually installed, the way a dashboard SQL editor installs it — the whole buffer as ONE
    // statement inside a transaction the editor opened — and the result is compared to the database
    // install.sh just made, down to every grant. A file that installs *something* is not the claim; the
    // claim is that the person who cannot open a terminal gets the same database as the person who can.
    const generated = fs.mkdtempSync(path.join(os.tmpdir(), 'varmak-onefile-'));
    try {
      // Generated from the same four files install.sh was just handed — the mutated one included, when
      // mutation-check.js is driving. That matters: if this pasted a pristine file while install.sh had
      // installed a damaged one, the two databases would differ for a reason that has nothing to do with
      // the rule the mutation damaged, and the mutation would be reported caught by a schema comparison
      // while the check that was supposed to catch it slept.
      const mutated = Object.values(MUTATED).some(Boolean);
      for (const name of ['schema', 'auth', 'api', 'views']) {
        fs.copyFileSync(MUTATED[name] || path.join(__dirname, `${name}.sql`),
          path.join(generated, `${name}.sql`));
      }
      fs.copyFileSync(path.join(__dirname, 'make-supabase-install.sh'),
        path.join(generated, 'make-supabase-install.sh'));
      execFileSync('sh', [path.join(generated, 'make-supabase-install.sh')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const oneFile = fs.readFileSync(path.join(generated, 'supabase-install.sql'), 'utf8');

      // Drift between the generator and the file in the repository is only a question when the four files
      // are the four files. Under a mutation it would fail every time and say nothing.
      if (!mutated) {
        assert.equal(oneFile, fs.readFileSync(path.join(__dirname, 'supabase-install.sql'), 'utf8'),
          'backend/supabase-install.sql is out of date with the four files it is made from. '
          + 'Run `sh backend/make-supabase-install.sh` and commit the result.');
        step('Deploy: the one-file installer is exactly what the generator produces from the four files today');
      }

      // The three properties that make "paste it unchanged" true rather than hopeful.
      const metaCommand = oneFile.split('\n').find((line) => /^\\/.test(line));
      assert.equal(metaCommand, undefined,
        `a SQL editor cannot run psql's own commands, and this file has one: ${metaCommand}`);
      assert.doesNotMatch(oneFile, /^(BEGIN|COMMIT);$/m,
        "the four BEGIN/COMMIT pairs have to come out: the first COMMIT would end the editor's "
        + 'transaction and commit a part of the install on its own');
      assert.doesNotMatch(oneFile, /PASTE-|YOUR-|<[a-z-]+>|CHANGE-ME/,
        'there is nothing to fill in in this file, and anything that looks fillable invites an edit');
      step('Deploy: it holds no psql command, no transaction of its own, and nothing to fill in');

      // An empty database shaped the way a managed one hands it over: the owner is not a superuser and
      // pgcrypto is not in public. Made fresh for each paste below, because the file now refuses a
      // database that is not empty and every one of these pastes is about a different starting state.
      const emptyProject = (database) => {
        psql(root, ['-c', `DROP DATABASE IF EXISTS ${database};`,
          '-c', `CREATE DATABASE ${database} OWNER deploy_owner;`]);
        psql(as('postgres', SUPER, database), [
          '-c', 'CREATE SCHEMA extensions;',
          '-c', 'CREATE EXTENSION pgcrypto WITH SCHEMA extensions;',
          '-c', 'GRANT USAGE ON SCHEMA extensions TO PUBLIC;',
          '-c', 'GRANT ALL ON SCHEMA public TO deploy_owner;'
        ]);
      };

      // What a dashboard does: one simple query, inside a transaction it opened, as the project owner.
      // verify-full with the cluster's own certificate authority, because that is the shape of a
      // dashboard's own connection to its database — and node-postgres now reads a bare sslmode=require
      // as verify-full regardless.
      const paste = async (sql, database) => {
        const client = new Client({ connectionString:
          `postgresql://deploy_owner:${OWNER}@localhost:${PORT}/${database}`
            + `?sslmode=verify-full&sslrootcert=${CERT}` });
        const notices = [];
        client.on('notice', (n) => notices.push(n.message));
        await client.connect();
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('COMMIT');
          return { ok: true, notices };
        } catch (error) {
          return { ok: false, said: error.message, notices };
        } finally {
          await client.end().catch(() => {});
        }
      };
      const tables = (database) => psql(as('postgres', SUPER, database),
        ['-c', `SELECT count(*) FROM information_schema.tables
           WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`]).trim();

      emptyProject(`${DB}_editor`);
      const pasted = await paste(oneFile, `${DB}_editor`);
      assert.ok(pasted.ok, `the one-file install has to go in as one statement: ${pasted.said}`);
      assert.ok(pasted.notices.some((m) => /Varmak Workshop is installed/.test(m)),
        `and say so, because a SQL editor has no exit status to read: ${pasted.notices.join(' | ')}`);
      assert.ok(pasted.notices.some((m) => /supabase-password\.sql/.test(m)),
        'and point at the next thing to run, which is the only other thing to paste');

      // The whole point. --no-owner because install.sh ran as deploy_owner here too and the roles that
      // matter are the varmak_* ones; everything else — tables, constraints, triggers, policies,
      // functions and every GRANT — is compared. The \restrict lines carry a per-dump random token.
      const schemaOf = (database) => execFileSync('pg_dump',
        [`postgresql://deploy_owner:${OWNER}@localhost:${PORT}/${database}`
          + `?sslmode=verify-full&sslrootcert=${CERT}`, '--schema-only', '--no-owner'],
        { encoding: 'utf8' })
        .split('\n').filter((line) => !/^\\(un)?restrict /.test(line)).join('\n');
      assert.equal(schemaOf(`${DB}_editor`), schemaOf(DB),
        'pasting the one file has to leave the same database the four files leave — it does not');
      step('Deploy: pasted as one statement into a SQL editor, it leaves byte for byte the database install.sh leaves');

      // Nothing in those four files is repeatable — not one of the 39 tables or 18 counters is created
      // with IF NOT EXISTS — so pressing Run twice used to stop on `relation "seq_customer" already
      // exists`: true, and useless to the person reading it. And pressing Run again is the first thing
      // anybody does when a dashboard looks like it did nothing. Both shapes of not-empty are asked for
      // here, because they need opposite advice: one is finished, the other has to be thrown away.
      const twice = await paste(oneFile, `${DB}_editor`);
      assert.equal(twice.ok, false, 'a second run over a finished install has to refuse');
      assert.match(twice.said, /already installed in this database/);
      assert.match(twice.said, /supabase-password\.sql/,
        'and send them to the step they have actually reached rather than leaving them stuck');
      assert.doesNotMatch(twice.said, /seq_customer/,
        'and not by letting CREATE SEQUENCE do the explaining 48 lines in');
      assert.equal(tables(`${DB}_editor`), '41', 'and leave the working install exactly as it was');

      emptyProject(`${DB}_probe`);
      psql(as('deploy_owner', OWNER, `${DB}_probe`), ['-c', 'CREATE SEQUENCE seq_customer;']);
      const half = await paste(oneFile, `${DB}_probe`);
      assert.equal(half.ok, false, 'and a database holding part of an install has to refuse too');
      assert.match(half.said, /stopped partway/);
      assert.match(half.said, /new empty database/,
        'because there is nothing else to do with a half-installed database, and guessing is worse');
      step('Deploy: a second paste is refused in words — differently for a finished install and for half of one');

      // A paste that does not finish is the failure worth the most, because it is the one that looks
      // like success: no exit status, a dashboard that says "Success. No rows returned", and a database
      // three quarters built. Both halves of the self-check are handed the thing they exist to catch.
      const cut = oneFile.replace(
        /^GRANT EXECUTE ON FUNCTION workspace_money\(\), invoice_basis\(\) TO varmak_admin, varmak_office;$/m,
        '-- the last line of views.sql, never run');
      assert.notEqual(cut, oneFile, 'the line this plants its failure in has moved — find it again');
      emptyProject(`${DB}_probe`);
      const short = await paste(cut, `${DB}_probe`);
      assert.equal(short.ok, false, 'an install missing its last grant has to raise, not finish quietly');
      assert.match(short.said, /This install is not complete/);
      assert.match(short.said, /views\.sql did not finish/,
        `and name the part that did not finish: ${short.said}`);
      assert.match(short.said, /Nothing was written/, 'and say what state that leaves the database in');
      assert.equal(tables(`${DB}_probe`), '0',
        'which has to be true: the editor transaction covers all four files, which is why the inner '
        + 'BEGIN/COMMIT pairs come out');

      emptyProject(`${DB}_probe`);
      const unguarded = await paste(
        oneFile.replace('DO $selfcheck$', 'ALTER TABLE weld NO FORCE ROW LEVEL SECURITY;\nDO $selfcheck$'),
        `${DB}_probe`);
      assert.equal(unguarded.ok, false,
        'a table that came out without row security is a hole, and finishing on it is worse than failing');
      assert.match(unguarded.said, /without row security: weld/);
      assert.match(unguarded.said, /read every row of them/);
      assert.equal(tables(`${DB}_probe`), '0', 'and that one rolls back too');
      step('Deploy: an unfinished paste and a table left without row security both raise in plain words, and leave nothing behind');

      // ── Seeing that it worked ─────────────────────────────────────────────────────────────
      //
      // The install raises on anything missing, which a dashboard shows in red. What a dashboard may not
      // show at all is a NOTICE — so the success case reads "Success. No rows returned", and that is a
      // thin thing to trust a company's data to. backend/supabase-check.sql asks the questions back and
      // answers them in rows, which a dashboard always shows. Checked against both states it has to tell
      // apart: the install that is there, and the database that is empty. Reading only.
      const report = (database) => psql(
        `postgresql://deploy_owner:${OWNER}@localhost:${PORT}/${database}`
          + `?sslmode=verify-full&sslrootcert=${CERT}`,
        ['-f', path.join(__dirname, 'supabase-check.sql')]);

      const onInstalled = report(`${DB}_editor`);
      assert.match(onInstalled, /Табели \/ Tables\|41\|во ред \/ ok/,
        `the installed database has to read back as installed: ${onInstalled}`);
      assert.match(onInstalled, /no row security\|0\|во ред \/ ok/);
      assert.match(onInstalled, /Rules about who may read what\|94\|во ред \/ ok/);
      assert.match(onInstalled, /varmak_admin, varmak_api, varmak_engine, varmak_office, varmak_workshop\|во ред/);
      assert.match(onInstalled, /Next step\|\|Залепи supabase-password\.sql/,
        'and point at the next thing to paste, which is the only thing left to do in the database');
      assert.doesNotMatch(onInstalled, /ПРОБЛЕМ|PROBLEM/,
        'with nothing in it reading as a problem, or the report is noise');

      // ${DB}_probe is the database the two failed pastes above rolled back out of: empty, and the state
      // somebody is in when a paste did not take. The report has to say so rather than look reassuring.
      const onEmpty = report(`${DB}_probe`);
      assert.match(onEmpty, /Табели \/ Tables\|0\|ПРАЗНО/);
      assert.match(onEmpty, /Next step\|\|Залепи supabase-install\.sql/,
        'and send them back to the file they have not managed to run yet');
      assert.equal(tables(`${DB}_probe`), '0', 'and the report reads without writing anything');
      step('Deploy: the check file reads back an installed database and an empty one, and says which step is next');

      // Only when the four files are the four files: these numbers describe what is shipped, and a
      // mutated install is the wrong thing to hold a guide to.
      if (!mutated) {
        // ── The guide somebody actually follows ──────────────────────────────────────────────
        //
        // SUPABASE.md is the click-by-click version of all of the above, in Macedonian, for somebody who
        // does not have a terminal and should not have to get one. It quotes numbers — how many tables the
        // report will show, which line of the password file to edit, how long the big file is — and every
        // one of those is a thing that goes quietly wrong the next time the schema grows. A guide whose
        // numbers do not match what the screen says is worse than no guide: it is the moment somebody
        // decides the install failed and starts over on a database that was fine.
        const guide = fs.readFileSync(path.join(__dirname, '..', 'SUPABASE.md'), 'utf8');
        const quoted = (label) => {
          const found = guide.match(new RegExp(`\\| ${label} \\| (\\d+) \\|`));
          assert.ok(found, `SUPABASE.md no longer shows a row for ${label} — the table it describes has changed`);
          return found[1];
        };
        const live = (sql) => psql(as('postgres', SUPER, `${DB}_editor`), ['-c', sql]).trim();
        assert.equal(quoted('Табели'), live(`SELECT count(*) FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r';`),
          'the number of tables the guide says the check file will show is not the number it shows');
        assert.equal(quoted('Правила кој што смее да чита'),
          live(`SELECT count(*) FROM pg_policies WHERE schemaname = 'public';`));
        // Excluding what an extension brought with it, exactly as the check file does — otherwise this
        // number is pgcrypto's address rather than a fact about the install.
        assert.equal(quoted('Работни постапки'), live(`SELECT count(*) FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
            AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid
                             AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e');`));
        assert.ok(guide.includes(live(`SELECT string_agg(rolname, ', ' ORDER BY rolname) FROM pg_roles
          WHERE rolname LIKE 'varmak%';`)), 'and the five roles it lists are not the five that exist');

        // The three numbers that are about the files rather than the database, including the one that
        // matters most: the line somebody is told to scroll to and edit.
        const pwLines = fs.readFileSync(path.join(__dirname, 'supabase-password.sql'), 'utf8').split('\n');
        const pwLine = pwLines.findIndex((line) => /pw text :=/.test(line)) + 1;
        const toldToEdit = guide.match(/таа е линија (\d+)/);
        assert.ok(toldToEdit, 'SUPABASE.md no longer says which line of the password file to edit');
        assert.equal(Number(toldToEdit[1]), pwLine,
          'the line SUPABASE.md sends somebody to is not the line they have to change');
        const howLong = guide.match(/околу ([\d.]+) линии/);
        assert.ok(howLong, 'SUPABASE.md no longer says roughly how long the big file is');
        assert.equal(Number(howLong[1].replace('.', '')),
          Math.round(oneFile.split('\n').length / 100) * 100,
          'and the length it quotes is no longer that file rounded to the nearest hundred');
        const shortFile = guide.match(/Тој има (\d+) линии/);
        assert.ok(shortFile, 'SUPABASE.md no longer says how short the password file is');
        assert.equal(Number(shortFile[1]), pwLines.length - 1,
          'the whole argument for a separate password file is that it is short enough to read');
        step('Deploy: the Macedonian guide quotes the numbers this database and these files actually have');

        // And every file it names exists. A guide is read by somebody who cannot check it, so a path that
        // has been renamed is not a typo to them — it is a dead end at the one step they cannot skip.
        // Found by writing this: the guide pointed at RESTORE.md, which this repository does not have.
        const named = [...new Set([...guide.matchAll(/`((?:backend|tools|tests)?\/?[\w.-]+\.(?:sql|js|sh|md|html))`/g)]
          .map((m) => m[1]))];
        assert.ok(named.length >= 6, `the guide names almost no files, which cannot be right: ${named}`);
        const root = path.join(__dirname, '..');
        const absent = named.filter((name) => !fs.existsSync(path.join(root, name))
          && !fs.existsSync(path.join(__dirname, name)));
        assert.deepEqual(absent, [],
          `SUPABASE.md sends somebody to files that are not here: ${absent.join(', ')}`);
        step(`Deploy: and every one of the ${named.length} files it names is where it says`);
      }

      // DEPLOY.md said for a while that install.sh was safe to run again, and it is not: not one of the
      // 39 tables or 18 counters is created with IF NOT EXISTS, so a second run stops twelve lines into
      // schema.sql. That claim was found by this suite trying it, not by reading. What is true is the
      // weaker and more useful thing — it stops *safely*, because each file is one transaction — so both
      // halves are asked here, and the document is held to saying it.
      let twiceOver = null;
      try { install(); } catch (error) { twiceOver = `${error.stdout || ''}${error.stderr || ''}`; }
      assert.ok(twiceOver, 'a second install.sh over a finished install stops; if it stopped doing so, '
        + 'DEPLOY.md and supabase-install.sql both need their wording back');
      assert.match(twiceOver, /seq_customer" already exists/,
        `and this is the unhelpful message the Supabase path exists to replace: ${twiceOver.slice(-200)}`);
      assert.equal(value(`SELECT count(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`), '41',
        'and it has to leave the install it refused to repeat exactly as it was');
      const deploy = fs.readFileSync(path.join(__dirname, '..', 'DEPLOY.md'), 'utf8');
      assert.doesNotMatch(deploy, /`install\.sh` is safe to run again/,
        'DEPLOY.md is claiming a repeatability that the line above just disproved');
      assert.match(deploy, /SUPABASE\.md/,
        'and it has to point at the path for somebody who has no terminal, or they will not find it');
      step('Deploy: install.sh refuses to repeat itself and leaves the install untouched, and DEPLOY.md says so');

      // ── The password, which is the only thing anybody types ───────────────────────────────
      //
      // Kept out of the 7,000-line file on purpose: a file somebody has to edit is a file somebody
      // scrolls through hunting for the line to edit, in a dashboard, at the end of an install. This one
      // is 38 lines and the line is near the top. It refuses the two mistakes that end in a server that
      // cannot connect for a reason nobody can see from the outside.
      const snippet = fs.readFileSync(path.join(__dirname, 'supabase-password.sql'), 'utf8');
      const withPassword = (pw) => snippet.replace("'PASTE-A-LONG-RANDOM-PASSWORD-HERE'", `'${pw}'`);
      assert.notEqual(withPassword('x'), snippet,
        'the line this test replaces has moved — the snippet somebody edits is not the one being checked');

      const untouched = await paste(snippet, `${DB}_editor`);
      assert.equal(untouched.ok, false, 'run unchanged, it must refuse: that placeholder is not a password');
      assert.match(untouched.said, /Nothing was changed/);
      assert.match(untouched.said, /PASTE-A-LONG-RANDOM-PASSWORD-HERE/,
        'and name the text to replace, because the alternative is hunting for it');

      const tooShort = await paste(withPassword('eight-ch'), `${DB}_editor`);
      assert.equal(tooShort.ok, false, 'and refuse one short enough to be worth guessing at');
      assert.match(tooShort.said, /is 8 characters long/, `counting it: ${tooShort.said}`);
      assert.match(tooShort.said, /under 24/);

      const chosen = 'a-chosen-password-long-enough-to-pass';
      const set = await paste(withPassword(chosen), `${DB}_editor`);
      assert.ok(set.ok, `and set a real one: ${set.said}`);
      assert.ok(set.notices.some((m) => /server can now sign in/.test(m)));
      assert.ok(set.notices.some((m) => /DATABASE_URL/.test(m)),
        'and say where the same password has to go, which is the step that gets forgotten');
      // The question the whole snippet exists to answer, asked the way the server asks it: over verified
      // TLS, with a password, as varmak_api. Against the database install.sh built, because the role is
      // the cluster's and this is the install the rest of the suite is using.
      assert.equal(psql(`postgresql://varmak_api:${chosen}@localhost:${PORT}/${DB}`
        + `?sslmode=verify-full&sslrootcert=${CERT}`, ['-c', 'SELECT 1;']).trim(), '1',
        'the server has to be able to sign in with the password that snippet just set');
      step('Deploy: the password snippet refuses a placeholder and a short password, and the one it accepts lets the server in');

      // Put back, because the pool above is holding the password install.sh set and the suite is not
      // finished with it.
      await paste(withPassword(API), `${DB}_editor`);
    } finally {
      fs.rmSync(generated, { recursive: true, force: true });
    }

    // ── The preflight ───────────────────────────────────────────────────────────────────────
    //
    // Asked before anything is written, because install.sh finds out about a wrong database halfway
    // through — after the tables and before the ownership changes, which is a database that looks
    // installed and is not. Every check it makes is a failure this path has actually had.
    //
    // It writes nothing, so it is run here against the same hosted-shaped cluster: once with a URL that
    // encrypts and verifies nothing, which it must refuse, and once with the real certificate authority,
    // which it must pass.
    const preflight = (url, env) => {
      try {
        return { code: 0, out: execFileSync('sh', [path.join(__dirname, 'preflight.sh')],
          { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url, ...(env || {}) },
            stdio: ['ignore', 'pipe', 'pipe'] }) };
      } catch (error) { return { code: error.status || 1, out: `${error.stdout || ''}${error.stderr || ''}` }; }
    };

    const loose = preflight(as('deploy_owner', OWNER, DB));
    assert.notEqual(loose.code, 0, 'a URL that verifies nothing has to be refused before the install');
    assert.match(loose.out, /sslmode=require encrypts and verifies nothing/,
      `and say why, in a sentence somebody can act on: ${loose.out.slice(0, 300)}`);
    assert.match(loose.out, /Nothing was written/, 'and say that it wrote nothing');

    const verified = preflight(
      `postgresql://deploy_owner:${OWNER}@localhost:${PORT}/${DB}`
        + `?sslmode=verify-full&sslrootcert=${CERT}`,
      { VARMAK_API_PASSWORD: API });
    assert.equal(verified.code, 0, `a verified connection to a good database must pass: ${verified.out}`);
    assert.match(verified.out, /sslmode=verify-full/);
    assert.match(verified.out, /CREATEROLE/, 'having checked the one privilege the install cannot do without');
    assert.match(verified.out, /CREATE on schema public/, 'and the one PostgreSQL 15 stopped granting');
    assert.match(verified.out, /pgcrypto is installed, in schema extensions/,
      'and found pgcrypto where a managed database puts it');
    assert.match(verified.out, /already installed here/,
      'and recognised a database that is already installed rather than calling it half done');
    assert.match(verified.out, /Clear to install/);
    step('Deploy: the preflight refuses an unverified connection and passes a verified one, writing nothing');
  } finally {
    server.close();
    await pool.end().catch(() => {});
  }

  // SUPABASE.md tells somebody, in Macedonian, how many checks stand behind the thing they are about to
  // paste into their company's database. That number is a claim, so it is held to the count — otherwise it
  // is one more figure that was true once. Only when the four files are the four files: a mutation run
  // skips two of the steps above on purpose.
  if (!Object.values(MUTATED).some(Boolean)) {
    const guide = fs.readFileSync(path.join(__dirname, '..', 'SUPABASE.md'), 'utf8');
    const claimed = guide.match(/во (\d+) проверки/);
    assert.ok(claimed, 'SUPABASE.md no longer says how many checks stand behind it');
    assert.equal(Number(claimed[1]), checks,
      'SUPABASE.md quotes a number of checks this suite does not run');
  }

  console.log(`\n${checks} checks: this system installs onto a hosted database as a non-superuser, over`);
  console.log('verified TLS — from a terminal and from a dashboard SQL editor, to the same database —');
  console.log('and a welder still cannot read a price on the result.');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
