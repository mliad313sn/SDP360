'use strict';
// P11 round 3 N-06 — /ready had no query timeout. With an ACCESS EXCLUSIVE lock held on a readiness table, every
// anonymous /ready call hung on a pooled connection; a dozen retrying probes drained the pool and sign-in hung for
// everyone. Now: statement/lock timeout on the probe, one probe in flight shared by all callers, 503 on timeout.
process.env.SDP_READY_STATEMENT_TIMEOUT_MS = '500';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const fetch = require('./_http-fetch');

async function serve(rdb, sync) {
  const app = express();
  app.use(require('../routes/health')({ express, getRdb: () => rdb, requireReportSession: (q, r, n) => n(), sync }));
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no answer within ${ms} ms`)), ms))]);

test('a held table lock: 12 concurrent /ready answer 503 quickly, one DB probe at a time, the pool stays usable', async () => {
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  const sync = require('../services/sync');
  await sync.ensureReady();
  let probes = 0;
  const counted = { getSyncStatus: (...a) => { probes++; return rdb.getSyncStatus(...a); }, pgHandle: () => rdb.pgHandle() };
  const { server, base } = await serve(counted, sync);
  const { Client } = require('pg');
  const locker = new Client({ connectionString: process.env.PG_URL }); await locker.connect();
  try {
    await locker.query('BEGIN'); await locker.query('LOCK TABLE sync_metadata IN ACCESS EXCLUSIVE MODE');
    const t0 = Date.now();
    const answers = await within(Promise.all(Array.from({ length: 12 }, async () => {
      const r = await fetch(base + '/ready'); return { status: r.status, json: await r.json() };
    })), 5000);
    assert.ok(Date.now() - t0 < 4000, 'answered within the bound, not after the lock is released');
    for (const a of answers) { assert.equal(a.status, 503); assert.equal(a.json.ok, false); assert.equal(a.json.error, 'timeout'); }
    assert.ok(probes <= 1, `at most one database probe for 12 concurrent callers (saw ${probes})`);
    // a sign-in during the lock still gets a pool connection
    const row = await within(rdb.pgHandle().prepare('SELECT 1 AS ok').get(), 2000);
    assert.equal(row.ok, 1);
  } finally {
    await locker.query('ROLLBACK').catch(() => {}); await locker.end(); server.close();
  }
});

test('lock released: /ready is 200 again (a fresh router carries no cached failure)', async () => {
  const rdb = require('../reports-db');
  const { server, base } = await serve(rdb, require('../services/sync'));
  try {
    const r = await fetch(base + '/ready');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(await r.json()).sort(), ['db', 'last_job_at', 'ok']);
  } finally { server.close(); }
});

test('concurrent healthy callers share one probe', async () => {
  let calls = 0; let release;
  const gate = new Promise((r) => { release = r; });
  const rdb = {
    getSyncStatus: async () => { calls++; await gate; return []; },
    pgHandle: () => ({ prepare: (sql) => ({ get: async () => (/pg_is_in_recovery/.test(sql) ? { rec: false, ro: 'off' } : { ok: 1 }) }) }),
  };
  const { server, base } = await serve(rdb, { ensureReady: async () => {}, getStore: () => ({}) });
  try {
    const all = Promise.all(Array.from({ length: 5 }, () => fetch(base + '/ready')));
    await new Promise((r) => setTimeout(r, 50)); release();
    const res = await all;
    assert.deepEqual(res.map((r) => r.status), [200, 200, 200, 200, 200]);
    assert.equal(calls, 1);
  } finally { server.close(); }
});
