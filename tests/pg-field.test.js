'use strict';
// Step 10 — field app on PostgreSQL: uploads, quick actions, field saves (022_field.sql) and an offline inspection
// saved into the PostgreSQL Inspections module (photo refs, updated_at, retry without false conflict).
process.env.REPORTS_BACKEND = 'postgres';
process.env.INSPECTION_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pgfd-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: uploads, offline inspection, quick actions', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  const idb = require('../inspection-db');
  await idb.initPgInspection();
  const uploads = require('../services/field/uploads');
  const fins = require('../services/field/inspections');
  const quick = require('../services/field/quickActions');
  try {
    const jpeg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(3000, 1)]);
    await uploads.begin({ id: 'pg-photo-0001', mime: 'image/jpeg', size: jpeg.length, chunks: 1 }, 'tech');
    await uploads.putChunk('pg-photo-0001', 0, jpeg.toString('base64'), 'tech');
    assert.deepStrictEqual(await uploads.complete('pg-photo-0001', 'tech'), { ok: true });
    const st = () => ({ meta: { f_id: 'FLD-pg-0001', f_site: 'MANA (MGO)', f_date: '2026-10-20' }, items: { env__0: { status: 'minor', photos: [{ upload: 'pg-photo-0001' }] } }, actions: [], status: 'draft' });
    const opts = { username: 'tech', userId: 1, userCodes: ['MGO'], base_updated_at: null, inspectionDb: idb };
    const a = await fins.save(st(), opts);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.ok(a.body.updated_at, 'updated_at read back on PostgreSQL');
    assert.equal(a.body.stored_photos.env__0.length, 1);
    const b = await fins.save(st(), opts);
    assert.equal(b.status, 200, 'a resent save is not a conflict');
    assert.equal(b.body.stored_photos.env__0[0].__blob, a.body.stored_photos.env__0[0].__blob);
    assert.equal((await uploads.stateOf('pg-photo-0001', 'tech')).status, 'attached');
    const v = quick.validate({ id: 'pg-qa-0001', kind: 'sdp_ticket', site: 'MGO', subject: 'S' });
    assert.equal((await quick.submit(v.action, 'tech', { enabled: false })).action.status, 'pending_manual');
    assert.equal((await quick.list({ status: 'pending_manual' })).length, 1);
    assert.equal((await quick.markDone('pg-qa-0001', 'coord', 'ok')).status, 'done');
  } finally {
    try { await rdb.pgHandle().close(); } catch {}
    try { await idb.pgHandle().close(); } catch {}
    await dropTestDb(ctx);
  }
});
