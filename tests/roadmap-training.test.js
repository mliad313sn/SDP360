'use strict';
// Personal Roadmap Manager — Obj-4 (Transfert de connaissance) ITAM training tracker.
// Store + REST routes (super_admin, per-user), sqlite-pinned, --test-force-exit:
//  (a) reports-db readers direct against a temp sqlite — lazy-seed returns the 9 default
//      rows (3 sessions × 3 sites, technicians null → technicians_total 0); add/update/delete
//      round-trip + user-scoped; technicians_total recomputes in JS.
//  (b) a tiny express harness mounting routes/roadmap.js with fake requireReportSession /
//      requireSuperAdmin to assert GET returns the 9 seeded rows + the super_admin gate.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'roadmap-training-'));
process.env.DASH_USER = process.env.DASH_USER || 'roadmap-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'roadmap-pass-0000';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');

const rdb = require('../reports-db');

// ── Part A: readers direct ─────────────────────────────────────────────
test('lazy-seed: a fresh user gets the 9 default training rows (3 sessions × 3 sites)', async () => {
  const t = (await rdb.getRoadmapTraining(999));
  assert.ok(t && Array.isArray(t.entries), 'shape { entries, stats }');
  assert.equal(t.entries.length, 9, 'exactly 9 seeded rows');
  assert.equal(t.stats.entries_count, 9, 'entries_count');
  assert.equal(t.stats.sessions_count, 3, 'distinct session dates');
  assert.equal(t.stats.sites_count, 3, 'distinct sites');
  assert.equal(t.stats.technicians_total, 0, 'technicians null → total 0, NOT a fabricated count');
  assert.ok(t.entries.every((e) => e.module === 'Module ITAM SDP'), 'module seeded');
  assert.ok(t.entries.every((e) => e.technicians == null), 'technicians seeded blank (null)');
});

test('lazy-seed is idempotent — second call still returns exactly 9', async () => {
  const t = (await rdb.getRoadmapTraining(999));
  assert.equal(t.entries.length, 9);
});

test('updateRoadmapTraining sets technicians → technicians_total recomputes in JS', async () => {
  const t0 = (await rdb.getRoadmapTraining(999));
  const one = t0.entries[0];
  (await rdb.updateRoadmapTraining(999, one.uid, { technicians: 3 }));
  const t1 = (await rdb.getRoadmapTraining(999));
  assert.equal(t1.entries.find((e) => e.uid === one.uid).technicians, 3);
  assert.equal(t1.stats.technicians_total, 3, 'SUM of non-null technicians');
});

test('training add → uid, user-scoped update/delete guards, then owner delete', async () => {
  const uid = (await rdb.addRoadmapTraining(999, { session_date: '2026-08-05', module: 'Module ITAM SDP', site: 'HGO', technicians: 4, notes: 'extra' }));
  assert.ok(uid && typeof uid === 'string' && uid.length >= 8, 'server-minted uid');
  let t = (await rdb.getRoadmapTraining(999));
  const added = t.entries.find((x) => x.uid === uid);
  assert.ok(added, 'training row persisted');
  assert.equal(added.site, 'HGO');

  // user-scoped: a foreign user cannot mutate this row.
  (await rdb.updateRoadmapTraining(888, uid, { site: 'HACKED' }));
  t = (await rdb.getRoadmapTraining(999));
  assert.equal(t.entries.find((x) => x.uid === uid).site, 'HGO', 'update is user-scoped');
  (await rdb.deleteRoadmapTraining(888, uid));
  t = (await rdb.getRoadmapTraining(999));
  assert.ok(t.entries.find((x) => x.uid === uid), 'delete is user-scoped');

  (await rdb.deleteRoadmapTraining(999, uid));
  t = (await rdb.getRoadmapTraining(999));
  assert.ok(!t.entries.find((x) => x.uid === uid), 'deleted by owner');
});

// ── Part B: routes with fake middlewares ───────────────────────────────
let server, base;

before(async () => {
  const app = express();
  const fakeSession = (req, res, next) => {
    req.reportUser = { id: Number(req.get('x-test-uid') || 1), role: req.get('x-test-role') || 'super_admin' };
    next();
  };
  const fakeSuper = (req, res, next) =>
    req.reportUser.role === 'super_admin' ? next() : res.status(403).json({ error: 'super_admin only' });
  app.use(require('../routes/roadmap')({ express, requireReportSession: fakeSession, requireSuperAdmin: fakeSuper }));
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

function req(method, path, { role, uid, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (role) headers['x-test-role'] = role;
    if (uid) headers['x-test-uid'] = String(uid);
    let payload = null;
    if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const r = http.request(base + path, { method, headers }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    r.on('error', reject);
    if (payload != null) r.write(payload);
    r.end();
  });
}

test('GET /api/roadmap/training: super_admin gets 9 seeded rows', async () => {
  const r = await req('GET', '/api/roadmap/training', { role: 'super_admin', uid: 42 });
  assert.equal(r.status, 200);
  assert.equal(r.body.entries.length, 9);
  assert.equal(r.body.stats.sessions_count, 3);
  assert.equal(r.body.stats.sites_count, 3);
});

test('GET /api/roadmap/training: admin (non-super) is 403', async () => {
  const r = await req('GET', '/api/roadmap/training', { role: 'admin', uid: 42 });
  assert.equal(r.status, 403);
});

test('POST/PUT/DELETE /api/roadmap/training round-trip through routes', async () => {
  const add = await req('POST', '/api/roadmap/training', { role: 'super_admin', uid: 43, body: { session_date: '2026-08-06', site: 'MGO', technicians: 2 } });
  assert.equal(add.status, 200);
  assert.ok(add.body.ok && add.body.uid);
  const upd = await req('PUT', '/api/roadmap/training/' + add.body.uid, { role: 'super_admin', uid: 43, body: { technicians: 5 } });
  assert.equal(upd.status, 200);
  const del = await req('DELETE', '/api/roadmap/training/' + add.body.uid, { role: 'super_admin', uid: 43 });
  assert.equal(del.status, 200);
});
