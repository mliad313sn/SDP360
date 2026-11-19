'use strict';
// P11 AUD-8 — the end-of-run sweep of tools/test/run-all.js dropped EVERY idle sdp_tracker_test_* database,
// including those of another runner working at the same time (its busy check is a race). The databases a run
// provisions now carry the run id (SDP_TEST_RUN_ID, set by run-all.js) and run-all sweeps only that id.
// The standalone tool (no --run) keeps sweeping every idle test database.
const { test } = require('node:test');
const assert = require('node:assert');
const { Client } = require('pg');
const { sweep, namePattern } = require('../tools/test/drop-test-dbs');

const ADMIN = process.env.PG_ADMIN_URL;

test('AUD-8: test database names carry the run id when SDP_TEST_RUN_ID is set', () => {
  const { testDbName } = require('./pg-helpers');
  const prev = process.env.SDP_TEST_RUN_ID;
  try {
    process.env.SDP_TEST_RUN_ID = 'r1a2b3';
    assert.match(testDbName(), /^sdp_tracker_test_r1a2b3_[a-z0-9]+$/);
    delete process.env.SDP_TEST_RUN_ID;
    assert.match(testDbName(), /^sdp_tracker_test_[a-z0-9]+$/);
    process.env.SDP_TEST_RUN_ID = 'BAD;drop';
    assert.match(testDbName(), /^sdp_tracker_test_[a-z0-9]+$/, 'an unsafe run id is ignored');
  } finally { if (prev === undefined) delete process.env.SDP_TEST_RUN_ID; else process.env.SDP_TEST_RUN_ID = prev; }
  assert.ok(namePattern('r1a2b3').test('sdp_tracker_test_r1a2b3_xyz'));
  assert.ok(!namePattern('r1a2b3').test('sdp_tracker_test_r9_xyz'));
  assert.ok(!namePattern('r1a2b3').test('sdp_tracker_test_abcdef'));
  assert.ok(namePattern(null).test('sdp_tracker_test_abcdef') && namePattern(null).test('sdp_tracker_test_r1a2b3_xyz'), 'standalone = every test database');
  assert.throws(() => namePattern('x;y'), /run id/);
});

test('AUD-8: a run-scoped sweep drops only this run\'s idle databases', async (t) => {
  if (!ADMIN) return t.skip('no PG_ADMIN_URL');
  const run = 'aud8' + Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, '');
  const other = 'aud8o' + Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, '');
  const mine = `sdp_tracker_test_${run}_a1`, theirs = `sdp_tracker_test_${other}_b2`, legacy = `sdp_tracker_test_${other}x9`;
  const c = new Client({ connectionString: ADMIN }); await c.connect();
  const exists = async (n) => (await c.query('SELECT 1 FROM pg_database WHERE datname=$1', [n])).rowCount === 1;
  try {
    for (const n of [mine, theirs, legacy]) await c.query(`CREATE DATABASE ${n}`);
    const dropped = await sweep(ADMIN, { runId: run });
    assert.strictEqual(dropped, 1);
    assert.strictEqual(await exists(mine), false, 'this run\'s database is dropped');
    assert.strictEqual(await exists(theirs), true, 'another run\'s idle database is kept');
    assert.strictEqual(await exists(legacy), true, 'an untagged idle database is kept');
  } finally {
    for (const n of [mine, theirs, legacy]) await c.query(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`);
    await c.end();
  }
});

test('AUD-8: run-all tags its run and sweeps only that run', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../tools/test/run-all.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /SDP_TEST_RUN_ID/);
  assert.match(src, /drop-test-dbs\.js'\), '--run=' \+ runId/);
});
