'use strict';
// Step 7 — business trackers store on PostgreSQL (db/postgres/reports/019_trackers.sql applied by the migrator):
// versioned definitions, entries (upsert, transaction), month locks.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pgtrk-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: tracker definitions, entries and locks', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  const store = require('../services/trackers/store');
  try {
    const def = { id: 'pg-tracker', year: 2026, title: 'T', units: [{ code: 'A' }], groups: [{ code: 'G', weight: 1 }], items: [{ code: 'I', name: 'i', group: 'G', kpi: 'COUNT', weight: 1 }], targets: {} };
    await store.defs.saveDraft('pg-tracker', def, 'author', 'custom');
    assert.equal(await store.defs.publishDefinition('pg-tracker', def, 'pub', 'v1'), 1);
    assert.equal((await store.defs.getPublished('pg-tracker')).definition.items[0].code, 'I');

    assert.equal(await store.setCells('pg-tracker', 2026, [{ unit: 'A', item: 'I', month: 1, value: 3 }, { unit: 'A', item: 'I', month: 2, value: 4.5 }], 'ed'), 2);
    await store.setCells('pg-tracker', 2026, [{ unit: 'A', item: 'I', month: 2, value: 6 }], 'ed2', 'import');
    const v = await store.getValues('pg-tracker', 2026);
    assert.deepStrictEqual(v.A.I.slice(0, 3), [3, 6, 0], 'upsert, absent = 0');
    const meta = await store.cellsMeta('pg-tracker', 2026);
    assert.equal(meta.find(m => Number(m.month) === 2).source, 'import');
    assert.deepStrictEqual(await store.getValues('pg-tracker', 2025), {}, 'another year is empty');

    assert.deepStrictEqual((await store.setLock('pg-tracker', 2026, 3, true, 'pub')).map(l => l.month), [3]);
    await store.setLock('pg-tracker', 2026, 3, true, 'pub');
    assert.equal((await store.locks('pg-tracker', 2026)).length, 1, 'locking twice is harmless');
    assert.deepStrictEqual(await store.setLock('pg-tracker', 2026, 3, false, 'pub'), []);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
