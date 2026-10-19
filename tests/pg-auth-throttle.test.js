'use strict';
// Step 4 (SDP-DASH-2.0) — persistent login throttle, PostgreSQL parity (017_auth_throttle.sql).
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pgthrottle-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: throttle upsert, window expiry, reset', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  const T = require('../services/authThrottle');
  try {
    const b = T.bucketForUser('bob');
    assert.equal((await T.hit(b, { windowMs: 1000, now: 5000 })).hits, 1);
    assert.equal((await T.hit(b, { windowMs: 1000, now: 5100 })).hits, 2);
    assert.equal((await T.peek(b, { windowMs: 1000, now: 5200 })).hits, 2);
    assert.equal((await T.hit(b, { windowMs: 1000, now: 9000 })).hits, 1, 'new window');
    await T.reset(b);
    assert.equal((await T.peek(b, { windowMs: 1000, now: 9001 })).hits, 0);
  } finally { try { await rdb.pgHandle().close?.(); } catch {} await dropTestDb(ctx); }
});
