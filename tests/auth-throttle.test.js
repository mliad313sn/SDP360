'use strict';
// Step 4 (SDP-DASH-2.0) — persistent login throttle: counts survive (they live in the DB, not in
// the process), windows expire, a reset clears an account, buckets are normalised.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'auth-throttle-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'thr-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'thr-admin-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../services/authThrottle');

test('hits accumulate in a window, expire after it, and reset clears the bucket', async () => {
  const W = 1000, b = T.bucketForUser('  Alice ');
  assert.equal(b, 'user:alice');
  for (let i = 1; i <= 3; i++) assert.equal((await T.hit(b, { windowMs: W, now: 10_000 + i })).hits, i);
  const p = await T.peek(b, { windowMs: W, now: 10_500 });
  assert.equal(p.hits, 3);
  assert.ok(p.retryAfterSec >= 1);
  assert.equal((await T.peek(b, { windowMs: W, now: 20_000 })).hits, 0, 'expired window reads 0');
  assert.equal((await T.hit(b, { windowMs: W, now: 20_000 })).hits, 1, 'a new window restarts at 1');
  await T.reset(b);
  assert.equal((await T.peek(b, { windowMs: W, now: 20_001 })).hits, 0);
});

test('the counter is stored in the database (a restart does not forget it)', async () => {
  const b = T.bucketForIp('10.0.0.9');
  await T.hit(b, { windowMs: 60_000, now: 1000 });
  const row = require('../reports-db').db.prepare('SELECT hits FROM auth_throttle WHERE bucket = ?').get(b);
  assert.equal(row.hits, 1);
  await T.purge({ windowMs: 60_000, now: 1_000_000 });
  assert.equal(require('../reports-db').db.prepare('SELECT COUNT(*) AS n FROM auth_throttle WHERE bucket = ?').get(b).n, 0);
});
