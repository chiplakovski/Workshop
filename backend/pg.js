'use strict';

// Start the throwaway Postgres if it is not up, once, and say so.
//
// Not a convenience: in a container the server dies whenever the container restarts, which happened
// often enough that four suites in a row failed with "connection refused" — a message about the
// harness that reads exactly like a message about the code under test. A suite that cannot tell the
// difference between "the rule broke" and "the database is not running" wastes the time of whoever
// is reading it.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const HOST = process.env.PGHOST || '/tmp';
const PORT = process.env.PGPORT || '5433';
const USER = process.env.PGUSER || 'postgres';

function reachable() {
  try {
    execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', 'postgres', '-qtAX', '-c', 'SELECT 1'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function ensureUp() {
  if (reachable()) return;
  try {
    execFileSync('sh', [path.join(__dirname, 'pg-up.sh')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    console.error(`Postgres is not running on ${HOST}:${PORT} and could not be started.`);
    console.error('These suites run against a real database on purpose — locks, partial unique');
    console.error('indexes and row-level security cannot be tested against a mock.');
    console.error(String(error.stderr || error.message).trim());
    process.exit(1);
  }
  if (!reachable()) {
    console.error(`Started Postgres but still cannot reach it on ${HOST}:${PORT}.`);
    process.exit(1);
  }
  console.log(`(started Postgres on ${PORT})`);
}

module.exports = { ensureUp };
