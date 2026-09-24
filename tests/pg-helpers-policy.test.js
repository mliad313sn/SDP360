'use strict';
// G-02 (audit 2026-09-24) — the skip policy behind the PostgreSQL test half.
//
// The audit found 75 tests — the whole pg parity, on a production that is 100 %
// PostgreSQL — sitting in `skipped` with nothing said out loud. provisionTestDb()
// returned null, every consumer skipped, and the suite reported itself green. The
// default admin URL even points at a Docker cluster (5433) that does not exist on this
// machine, while the real PostgreSQL 17 listens on 5432.
//
// Two things are pinned here, both pure (no database needed):
//   - the reason is stated, and the connection string is REDACTED (it carries a
//     password — a diagnostic must never leak it);
//   - PG_TESTS_REQUIRED=1 turns the silent skip into a hard failure, so a
//     pre-deploy run cannot pass while half the code was never executed.
const test = require('node:test');
const assert = require('node:assert');
const { redactUrl, pgUnavailable } = require('./pg-helpers');

test('redactUrl hides the password but keeps host, port and database', () => {
  const out = redactUrl('postgres://postgres:s3cr3t@localhost:5433/postgres');
  assert.ok(!out.includes('s3cr3t'), 'the password is gone');
  assert.match(out, /localhost:5433/, 'the host and port survive — that is the diagnostic');
  assert.match(out, /\/postgres$/, 'the database name survives');
  assert.match(out, /postgres:\*+@/, 'the user survives, the secret is masked');
});

test('redactUrl never throws and never echoes garbage back verbatim', () => {
  assert.strictEqual(typeof redactUrl(''), 'string');
  assert.strictEqual(typeof redactUrl(undefined), 'string');
  assert.ok(!redactUrl('not a url at all: hunter2').includes('hunter2'),
    'an unparseable value is not echoed — it could be a password too');
});

test('by default an unreachable PostgreSQL returns null, so local runs still skip', () => {
  const env = {};
  assert.strictEqual(pgUnavailable(new Error('connect ECONNREFUSED'), { env, log: () => {} }), null);
});

test('PG_TESTS_REQUIRED=1 turns the skip into a failure, naming the fix', () => {
  const env = { PG_TESTS_REQUIRED: '1' };
  assert.throws(
    () => pgUnavailable(new Error('connect ECONNREFUSED'), { env, log: () => {} }),
    (e) => /PG_TESTS_REQUIRED/.test(e.message) && /PG_ADMIN_URL/.test(e.message),
  );
});

test('the reason is logged once, with the cause and no password', () => {
  const lines = [];
  const env = {};
  const opts = { env, log: (m) => lines.push(m), url: 'postgres://postgres:s3cr3t@localhost:5433/postgres',
    state: { warned: false } };   // its own state: the module's is shared across a run
  pgUnavailable(new Error('connect ECONNREFUSED 127.0.0.1:5433'), opts);
  pgUnavailable(new Error('connect ECONNREFUSED 127.0.0.1:5433'), opts);
  assert.strictEqual(lines.length, 1, 'one line per process, however many suites ask');
  assert.match(lines[0], /ECONNREFUSED/, 'says why');
  assert.match(lines[0], /PG_ADMIN_URL/, 'says how to fix it');
  assert.ok(!lines[0].includes('s3cr3t'), 'and never prints the password');
});

// `new Client().connect()` rejects with an AggregateError whose own .message is empty,
// so the first version of this diagnostic said "unknown error" — defeating the point of
// saying why. And in the REQUIRED branch the text still claimed the suites "will be
// SKIPPED", which is exactly what is not happening.
test('an AggregateError still yields a usable cause', () => {
  const lines = [];
  const agg = new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:5433')], '');
  pgUnavailable(agg, { env: {}, log: (m) => lines.push(m), state: { warned: false } });
  assert.match(lines[0], /ECONNREFUSED/, 'the inner cause is surfaced');
  assert.ok(!/unknown error/.test(lines[0]));
});

test('a bare error code is enough of a cause', () => {
  const lines = [];
  const e = new Error(''); e.code = 'ETIMEDOUT';
  pgUnavailable(e, { env: {}, log: (m) => lines.push(m), state: { warned: false } });
  assert.match(lines[0], /ETIMEDOUT/);
});

test('the required branch does not claim the suites are being skipped', () => {
  assert.throws(
    () => pgUnavailable(new Error('nope'), { env: { PG_TESTS_REQUIRED: '1' }, log: () => {} }),
    (e) => !/will be SKIPPED/i.test(e.message),
  );
});
