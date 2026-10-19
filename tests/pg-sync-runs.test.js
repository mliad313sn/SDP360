'use strict';
// Step 1 (SDP-DASH-2.0) — sync runner store + reconciliation guard, PostgreSQL parity (015_sync_runs.sql).
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'syncruns-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: run log, job state, stats, purge, and the reconciliation guard', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  const store = require('../services/sync/store');
  const { createRunner } = require('../services/sync/runner');
  try {
    let fail = true;
    const r = createRunner({ store, alert: async () => ({}), logEvent: () => {} });
    r.register({ key: 'pg.job', fn: async () => { if (fail) throw new Error('HTTP 400'); return { n: 1 }; } });
    await r.run('pg.job'); await r.run('pg.job');
    let s = await store.getState('pg.job');
    assert.equal(Number(s.consecutive_failures), 2);
    assert.ok(s.failure_alerted_at, 'alert latched');
    fail = false;
    await r.run('pg.job', { trigger: 'manual' });
    s = await store.getState('pg.job');
    assert.equal(Number(s.consecutive_failures), 0);
    assert.equal(s.failure_alerted_at, null);
    const runs = await store.recentRuns({ jobKey: 'pg.job' });
    assert.deepEqual(runs.map(x => x.status).sort(), ['error', 'error', 'ok']);
    assert.ok(runs.some(x => x.run_trigger === 'manual'));
    const st = await store.successStats('2000-01-01');
    assert.equal(Number(st[0].ok), 1); assert.equal(Number(st[0].failed), 2);
    const h = await r.health();
    assert.equal(h.jobs[0].status, 'ok');
    await rdb.pgHandle().prepare(`UPDATE sync_runs SET started_at = '2000-01-01T00:00:00.000Z'`).run();
    assert.equal(await store.purge(30), 3);

    const H = rdb.pgHandle();
    for (let i = 0; i < 40; i++) await H.prepare('INSERT INTO change_records (change_id) VALUES (?)').run('CH' + i);
    await assert.rejects(() => rdb.reconcileChangeRecords(new Set(['CH0', 'CH1'])), /refused/);
    assert.equal(Number((await H.prepare('SELECT COUNT(*) AS n FROM change_records').get()).n), 40, 'nothing deleted');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
