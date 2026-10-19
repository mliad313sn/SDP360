'use strict';
// Step 7 — tracker store on PostgreSQL (migration tracker/002): draft/publish/versions, entries upsert, targets, seed parity.
process.env.TRACKER_BACKEND = 'postgres'; process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'trkpg-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin'; process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: tracker store parity (draft → publish → entries upsert → targets → score → rollback → seed once)', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db'); await rdb.initPgReports();
  const tdb = require('../tracker-db'); await tdb.initPgTracker();
  await require('../db/migrate').migrateAtBoot({ log: () => {} });
  const { makeTrackerStore } = require('../services/trackerStore');
  const { TEMPLATES } = require('../services/trackerTemplates');
  const s = makeTrackerStore({ prepare: (sql) => tdb.pgHandle().prepare(sql) }, { isPg: true });
  try {
    await s.init();
    const DEF = { key: 'pgk', name: 'PG', version: 1, period: { kind: 'monthly', start: '2026', count: 12 }, units: [{ code: 'HGO' }], ragPolicy: 'tracker-activity', groups: [{ code: 'G1', name: 'A', weight: 1, items: [{ code: 'G1-01', name: 'x', kpiType: 'COUNT', weight: 1, target: 12, start: 1, end: 12 }] }] };
    const d = await s.saveDraft(DEF, { user: { id: 1 } }); assert.equal(d.status, 'draft'); assert.equal(await s.published('pgk'), null);
    const p = await s.publish('pgk', { user: { id: 1 }, note: 'n' }); assert.equal(p.version, 1); assert.equal(p.status, 'published');
    const r1 = await s.saveEntries('pgk', [{ unit: 'HGO', item: 'G1-01', slot: 3, value: 2 }], { lockClosed: false }); assert.equal(r1.saved, 1);
    const r2 = await s.saveEntries('pgk', [{ unit: 'HGO', item: 'G1-01', slot: 3, value: 5, note: 'fixed' }], { lockClosed: false }); assert.equal(r2.saved, 1);
    const e = await s.entries('pgk'); assert.equal(e.rows.length, 1); assert.equal(e.inputs.HGO['G1-01'][2], 5); assert.equal(e.rows[0].note, 'fixed');
    await s.saveTargets('pgk', [{ unit: 'HGO', item: 'G1-01', target: 6 }]); await s.saveTargets('pgk', [{ unit: 'HGO', item: 'G1-01', target: 3 }]);
    const sc = await s.scoreTracker('pgk', { currentPeriod: 3 }); assert.equal(sc.units.HGO.items['G1-01'].target, 3); assert.equal(sc.units.HGO.score, 1);
    await s.saveDraft({ ...DEF, name: 'PG2' }, {}); await s.publish('pgk', {}); assert.equal((await s.versions('pgk')).length, 2);
    assert.equal((await s.rollback('pgk', 1)).definition.name, 'PG');
    for (const tpl of TEMPLATES) await s.saveDraft(tpl, {});
    assert.equal((await s.list({ status: 'draft' })).length, TEMPLATES.length);
    await s.setStatus('pgk', 'retired'); await s.remove('pgk'); assert.equal(await s.get('pgk'), null);
    assert.equal(Number((await tdb.pgHandle().prepare('SELECT COUNT(*) AS n FROM tracker_entries WHERE key=?').get('pgk')).n), 0, 'cascade');
  } finally { await dropTestDb(ctx); }
});
