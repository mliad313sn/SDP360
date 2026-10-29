'use strict';
// Step 10 — field store on PostgreSQL (migration reports/020): parity with the sqlite suite.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'fieldpg-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin'; process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const U = '2f1e4c3a-9b7d-4e21-a3f5-0c8d1e2f3a4b';

test('pg: field outbox + uploads parity (idempotent receive, finish, chunk lifecycle, cascade)', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db'); await rdb.initPgReports();
  await require('../db/migrate').migrateAtBoot({ log: () => {} });
  const st = require('../services/fieldStore').makeFieldStore({ prepare: (sql) => rdb.pgHandle().prepare(sql) }, { isPg: true });
  try {
    await st.init();
    const a = await st.receive({ uuid: U, userId: 7, kind: 'inspection', payloadHash: 'h1', device: 'Pixel' }); assert.equal(a.status, 'received');
    assert.equal((await st.receive({ uuid: U, userId: 7, kind: 'inspection', payloadHash: 'h2' })).payload_hash, 'h1');
    const f = await st.finish(U, 'rejected', { error: 'no site' }); assert.equal(f.status, 'rejected'); assert.deepEqual(f.result, { error: 'no site' });
    assert.deepEqual(await st.outboxStats(), { received: 0, applying: 0, applied: 0, rejected: 1, failed: 0 });
    const up = await st.createUpload({ userId: 7, ownerKind: 'inspection', ownerId: 'EM-IT-1', name: 'p.jpg', mime: 'image/jpeg', size: 3, chunkBytes: 2, chunksTotal: 2 });
    assert.ok(up.id > 0);
    await st.putChunk(up.id, 1, Buffer.from([3]).toString('base64')); await st.putChunk(up.id, 0, Buffer.from([1, 2]).toString('base64'));
    assert.deepEqual((await st.getUpload(up.id)).received, [0, 1]); assert.equal((await st.chunksOf(up.id)).length, 2);
    const done = await st.completeUpload(up.id, 'ref/x'); assert.equal(done.status, 'done'); assert.equal((await st.chunksOf(up.id)).length, 0);
    const u2 = await st.createUpload({ userId: 7, ownerKind: 'inspection', ownerId: 'y', name: 'q', mime: 'image/png', size: 1, chunkBytes: 2, chunksTotal: 1 });
    await st.putChunk(u2.id, 0, 'AQ=='); await rdb.pgHandle().prepare('DELETE FROM field_uploads WHERE id=?').run(u2.id);
    assert.equal((await st.chunksOf(u2.id)).length, 0, 'chunks cascade with their upload');
  } finally { await dropTestDb(ctx); }
});
