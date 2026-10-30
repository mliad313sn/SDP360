'use strict';
// Step 6 — dashboard store on PostgreSQL (migration 016): draft/publish/versions/seed parity with sqlite.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'dashpg-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: dashboard store draft → publish → versions → retire, seeds once', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  await require('../db/migrate').migrateAtBoot({ log: () => {} });
  const { makeDashboardStore } = require('../services/dashboardStore');
  const { SEED_DASHBOARDS } = require('../services/dashboardSeeds');
  const { SEED } = require('../services/metricRegistry');
  const s = makeDashboardStore({ prepare: (sql) => rdb.pgHandle().prepare(sql) }, { isPg: true });
  try {
    await s.init();
    const added = await s.seed(SEED_DASHBOARDS); assert.equal(added.length, SEED_DASHBOARDS.length);
    assert.deepEqual(await s.seed(SEED_DASHBOARDS), []);
    const pub = await s.published('exec-home'); assert.equal(pub.version, 1); assert.ok(pub.definition.widgets.length > 5);
    const doc = { key: 'pgk', title: 'PG', audience: 'site', grid: { columns: 12 }, widgets: [{ id: 'a', type: 'kpi', metric: 'assets.total', layout: { x: 0, y: 0, w: 3, h: 2 } }] };
    const d = await s.saveDraft(doc, { user: { id: 1 }, siteId: 3, metrics: SEED.map(m => m.key) });
    assert.equal(d.status, 'draft'); assert.equal(Number(d.site_id), 3); assert.equal(await s.published('pgk'), null);
    const p = await s.publish('pgk', { user: { id: 1 }, note: 'n' }); assert.equal(p.version, 1); assert.equal(p.status, 'published');
    await s.saveDraft({ ...doc, title: 'PG2' }, { metrics: SEED.map(m => m.key) }); assert.equal((await s.published('pgk')).definition.title, 'PG');
    assert.equal((await s.publish('pgk')).version, 2);
    assert.deepEqual((await s.versions('pgk')).map(v => v.version), [2, 1]);
    assert.deepEqual((await s.list({ status: 'published', siteIds: [3] })).map(x => x.key).sort(), ['assets-hygiene', 'exec-home', 'field-site', 'governance', 'pgk', 'site-weekly']);
    assert.deepEqual((await s.list({ status: 'published', siteIds: [4] })).map(x => x.key).includes('pgk'), false);
    await s.setStatus('pgk', 'retired'); await assert.rejects(async () => s.remove('pgk'), (e) => e.status === 409); assert.equal((await s.get('pgk')).status, 'retired');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
