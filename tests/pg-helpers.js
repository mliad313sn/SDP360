'use strict';
const { Client } = require('pg');
// The admin connection used to CREATE/DROP a throwaway database per run. The default
// points at the Docker dev cluster; the 4MyPeople-managed PostgreSQL 17 this repo
// actually runs against listens on 5432, and the application role `sdp_app` has no
// CREATEDB, so PG_ADMIN_URL normally has to be set. See tools/pg/README.md.
const ADMIN = process.env.PG_ADMIN_URL || 'postgres://postgres:devpass@localhost:5433/postgres';

// A connection string carries a password. Anything that reaches a console goes through
// here first: the host, the port and the database are the diagnostic, the secret is not.
function redactUrl(url) {
  const raw = String(url == null ? '' : url);
  if (!raw) return '(unset)';
  try {
    const u = new URL(raw);
    if (u.password) u.password = '****';
    return u.toString();
  } catch (_) {
    return '(unparseable connection string)';   // never echo it — it may BE the password
  }
}

// G-02 — what happens when PostgreSQL cannot be reached.
//
// Default: return null, the caller skips, local work carries on without a database.
// That is convenient and it is also how 75 tests — the entire pg parity, on a production
// that is 100 % PostgreSQL — went unexecuted for weeks behind a green suite. So the
// reason is now said out loud, and PG_TESTS_REQUIRED=1 (CI, pre-deploy) turns the skip
// into a hard failure. Note the node test runner forks a process per FILE, so the line
// appears once per pg suite (13 today), not once per run — noisy on purpose: this is a
// condition that hid for weeks.
// The "say it once" state is a parameter with a module-level default, so a test can
// bring its own instead of reaching into module internals.
const _warnState = { warned: false };
// `new Client().connect()` rejects with an AggregateError whose own .message is empty,
// so the cause has to be dug out of its errors[] (or off .code) — otherwise the
// diagnostic reads "unknown error", which tells the reader nothing at all.
function _cause(err) {
  if (!err) return 'unknown error';
  if (err.message) return err.message;
  if (Array.isArray(err.errors) && err.errors.length) return _cause(err.errors[0]);
  if (err.code) return String(err.code);
  return err.name || 'unknown error';
}

function pgUnavailable(err, { env = process.env, log = console.warn, url = ADMIN, state = _warnState } = {}) {
  const why = _cause(err);
  const fix = 'Set PG_ADMIN_URL to a connection with CREATEDB rights (see tools/pg/README.md).';
  const head = `[pg-tests] PostgreSQL unreachable at ${redactUrl(url)} — ${why}.`;
  if (String(env.PG_TESTS_REQUIRED || '') === '1') {
    throw new Error(`PG_TESTS_REQUIRED=1 but ${head} ${fix}`);
  }
  const msg = `${head} These suites will be SKIPPED, which means the pg half of the code `
    + `is not being tested. ${fix} Or run with PG_TESTS_REQUIRED=1 to make this an error `
    + 'instead of a skip.';
  if (!state.warned) { state.warned = true; log(msg); }
  return null;
}

// Returns a connection context for a fresh per-run DB, or null if Postgres is unreachable.
async function provisionTestDb() {
  let admin;
  try { admin = new Client({ connectionString: ADMIN }); await admin.connect(); }
  catch (e) { return pgUnavailable(e); }          // → null (skip) or throw if required
  const name = 'sdp_tracker_test_' + Math.random().toString(36).slice(2, 8);
  await admin.query(`CREATE DATABASE ${name}`);     // can't run inside a transaction — bare conn
  await admin.end();
  return { url: ADMIN.replace(/\/postgres$/, '/' + name), name, adminUrl: ADMIN };
}
async function dropTestDb(ctx) {
  if (!ctx) return;
  const admin = new Client({ connectionString: ctx.adminUrl }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${ctx.name} WITH (FORCE)`);
  await admin.end();
}
module.exports = { provisionTestDb, dropTestDb, redactUrl, pgUnavailable };
