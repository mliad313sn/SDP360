'use strict';
// Personal Roadmap Manager — store + REST routes (super_admin, per-user).
// Two halves, sqlite-pinned, --test-force-exit:
//  (a) reports-db readers direct against a temp sqlite — lazy-seed returns the 4 default
//      objectives; deliverable add/update/delete round-trip; update/delete are user-scoped.
//  (b) a tiny express harness mounting routes/roadmap.js with fake requireReportSession /
//      requireSuperAdmin to assert GET returns the 4 seeded objectives + the super_admin gate.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'roadmap-smoke-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'roadmap-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'roadmap-pass-0000';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');

const rdb = require('../reports-db');

// ── Part A: readers direct ─────────────────────────────────────────────
test('lazy-seed: a fresh user gets the 4 default objectives (35/25/25/15)', () => {
  const rm = rdb.getRoadmap(999);
  assert.ok(rm && Array.isArray(rm.objectives), 'shape { objectives, deliverables }');
  assert.equal(rm.objectives.length, 4, 'exactly 4 seeded objectives');
  assert.deepEqual(rm.objectives.map((o) => o.weight), [35, 25, 25, 15], 'weights in sort_order');
  assert.deepEqual(rm.objectives.map((o) => o.obj_key), ['catalogue', 'platform', 'incidents', 'knowledge']);
  // Deliverables are now pre-filled (realised 'done' + upcoming 'todo'), lazy-seeded once.
  assert.equal(rm.deliverables.length, 21, '21 default deliverables seeded');
  assert.equal(rm.deliverables.filter((d) => d.status === 'done').length, 10, '10 realised (done)');
  assert.ok(rm.deliverables.every((d) => d.status === 'todo' || d.status === 'done'), 'status vocabulary todo|done');
  assert.ok(rm.deliverables.every((d) => ['catalogue', 'platform', 'incidents', 'knowledge'].includes(d.obj_key)), 'every deliverable maps to an objective');
});

test('lazy-seed is idempotent — second call still returns exactly 4', () => {
  const rm = rdb.getRoadmap(999);
  assert.equal(rm.objectives.length, 4);
});

test('upsertRoadmapObjective updates an editable field', () => {
  rdb.upsertRoadmapObjective(999, 'catalogue', { progress_pct: 90, status: 'green' });
  const rm = rdb.getRoadmap(999);
  const cat = rm.objectives.find((o) => o.obj_key === 'catalogue');
  assert.equal(cat.progress_pct, 90);
});

test('deliverable add → uid, then update, then user-scoped guards, then delete', () => {
  const uid = rdb.addRoadmapDeliverable(999, { obj_key: 'catalogue', label: 'Publish adoption metric', delivery_date: '2026-09-30', status: 'open' });
  assert.ok(uid && typeof uid === 'string' && uid.length >= 8, 'server-minted uid');
  let rm = rdb.getRoadmap(999);
  const d = rm.deliverables.find((x) => x.uid === uid);
  assert.ok(d, 'deliverable persisted');
  assert.equal(d.label, 'Publish adoption metric');

  rdb.updateRoadmapDeliverable(999, uid, { status: 'executed' });
  rm = rdb.getRoadmap(999);
  assert.equal(rm.deliverables.find((x) => x.uid === uid).status, 'executed');

  // user-scoped: a different user cannot touch this row.
  rdb.updateRoadmapDeliverable(888, uid, { status: 'HACKED' });
  rm = rdb.getRoadmap(999);
  assert.equal(rm.deliverables.find((x) => x.uid === uid).status, 'executed', 'update is user-scoped');
  rdb.deleteRoadmapDeliverable(888, uid);
  rm = rdb.getRoadmap(999);
  assert.ok(rm.deliverables.find((x) => x.uid === uid), 'delete is user-scoped');

  rdb.deleteRoadmapDeliverable(999, uid);
  rm = rdb.getRoadmap(999);
  assert.ok(!rm.deliverables.find((x) => x.uid === uid), 'deleted by owner');
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

function req(method, path, { role, uid } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (role) headers['x-test-role'] = role;
    if (uid) headers['x-test-uid'] = String(uid);
    const r = http.request(base + path, { method, headers }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    r.on('error', reject); r.end();
  });
}

test('GET /api/roadmap: super_admin gets 4 seeded objectives', async () => {
  const r = await req('GET', '/api/roadmap', { role: 'super_admin', uid: 7 });
  assert.equal(r.status, 200);
  assert.equal(r.body.objectives.length, 4);
});

test('GET /api/roadmap: admin (non-super) is 403', async () => {
  const r = await req('GET', '/api/roadmap', { role: 'admin', uid: 7 });
  assert.equal(r.status, 403);
});
