'use strict';
// E-F03 — field task timing, server half + pilot report.
//   * bootstrap carries review_step / task_timing ONLY when the switch is on (unchanged otherwise);
//   * an applied envelope with meta.task_ms: switch off → the field_*_applied row is exactly today's ({device},
//     actor = username); switch on → details carry task_ms + site + role tier, actor = u<id>, no IP, no name;
//   * services/pilotMetrics field_task_time: median / p75 per site × kind × week, no sample → no row ("no data").
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const fetch = require('./_http-fetch');
const P = require('../services/pilotMetrics');

let rdb, cfg, srv, base, user, site;
before(async () => {
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  site = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name));
  try { await rdb.createUser({ username: 'tt_tech', full_name: 'Timed Tech', password: 'tt_techpass1234', role: 'viewer', roles: ['viewer', 'field-tech'], site_id: site.id }); } catch (_) { /* exists */ }
  user = await rdb.validateSession((await rdb.login('tt_tech', 'tt_techpass1234')).token);
  const app = express();
  app.use(require('../routes/field')({ express, store: require('../routes/field').createStore(rdb), rdb, requireReportSession: (req, res, next) => { req.reportUser = user; next(); } }));
  await new Promise((r) => { srv = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + srv.address().port;
});
after(() => srv && srv.close());

const U = (n) => `3a1e4c3a-9b7d-4e21-a3f5-0c8d1e2f3a${String(n).padStart(2, '0')}`;
const env = (id) => ({ kind: 'inspection', meta: { task_ms: 95000 }, payload: { meta: { f_id: id, f_site: `${site.name} (HGO)`, f_date: '2026-11-05', f_area: 'dc', f_inspector: 'T', f_type: 'routine' }, items: {}, actions: [] } });
const put = (n, body) => fetch(base + '/api/field/outbox/' + U(n), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
// the route logs fire-and-forget: poll briefly for the row
async function logRow(uuid) {
  for (let i = 0; i < 40; i++) { const r = (await rdb.listSystemLog({ category: 'field' }, { limit: 100 })).rows.find((x) => x.target === uuid); if (r) return r; await new Promise((w) => setTimeout(w, 50)); }
  return undefined;
}

test('bootstrap: no shadow feature keys while off; review_step / task_timing true when on', async () => {
  const off = await (await fetch(base + '/api/field/bootstrap')).json();
  assert.deepStrictEqual(Object.keys(off.features), ['ticket']);
  await cfg.setConfig(rdb.db, { field_review_step: '1', field_task_timing: '1' }, 'test');
  try {
    const on = await (await fetch(base + '/api/field/bootstrap')).json();
    assert.strictEqual(on.features.review_step, true); assert.strictEqual(on.features.task_timing, true);
  } finally { await cfg.setConfig(rdb.db, { field_review_step: '0', field_task_timing: '0' }, 'test'); }
});

test('switch off: the applied row is today\'s (no timing, actor = username); on: task_ms + site + tier, actor u<id>, no name', async () => {
  const r1 = await (await put(1, env('EM-IT-20261105-0101'))).json(); assert.strictEqual(r1.ok, true);
  const off = await logRow(U(1));
  assert.deepStrictEqual(JSON.parse(off.details), { device: null }); assert.strictEqual(off.actor, 'tt_tech');
  await cfg.setConfig(rdb.db, { field_task_timing: '1' }, 'test');
  try {
    const r2 = await (await put(2, env('EM-IT-20261105-0102'))).json(); assert.strictEqual(r2.ok, true);
    const on = await logRow(U(2));
    const d = JSON.parse(on.details);
    assert.strictEqual(d.task_ms, 95000); assert.strictEqual(d.site, 'HGO'); assert.ok(d.tier);
    assert.strictEqual(on.actor, 'u' + user.id); assert.strictEqual(Number(on.actor_id), Number(user.id)); assert.ok(on.ip == null);
    assert.ok(!JSON.stringify(on).includes('Timed Tech') && !JSON.stringify(on).includes('tt_tech'), 'no name in the timing row');
    const bad = await (await put(3, { ...env('EM-IT-20261105-0103'), meta: { task_ms: 'abc' } })).json(); assert.strictEqual(bad.ok, true);
    assert.deepStrictEqual(JSON.parse((await logRow(U(3))).details), { device: null }, 'an invalid time is ignored');
  } finally { await cfg.setConfig(rdb.db, { field_task_timing: '0' }, 'test'); }
});

test('pilot report: field_task_time median / p75 per site × kind × week; no sample → no data', () => {
  const users = [];
  const rep = P.buildReport({ from: '2026-11-02', to: '2026-11-08', users, nowMs: Date.parse('2026-11-09T00:00:00Z'),
    fieldTiming: [
      { site: 'HGO', kind: 'inspection', ts: '2026-11-03T08:00:00Z', task_ms: 60000 },
      { site: 'HGO', kind: 'inspection', ts: '2026-11-04T08:00:00Z', task_ms: 120000 },
      { site: 'HGO', kind: 'inspection', ts: '2026-11-05T08:00:00Z', task_ms: 180000 },
      { site: 'HGO', kind: 'inspection', ts: '2026-11-05T09:00:00Z', task_ms: 240000 },
      { site: 'HGO', kind: 'tracker', ts: '2026-11-05T09:00:00Z', task_ms: 30000 },
      { site: 'HGO', kind: 'tracker', ts: '2026-10-01T09:00:00Z', task_ms: 999999 },   // outside the window
      { site: 'HGO', kind: 'tracker', ts: '2026-11-05T09:00:00Z', task_ms: 'x' },      // not a number
    ] });
  const rows = rep.sections.field_task_time.rows;
  assert.deepStrictEqual(rows.map((r) => [r.site, r.persona, r.week, r.n, r.median_s, r.p75_s]), [
    ['HGO', 'inspection', '2026-W45', 4, 150, 195],
    ['HGO', 'tracker', '2026-W45', 1, 30, 30],
  ]);
  assert.match(P.toMarkdown(rep), /Field task time[\s\S]*\| HGO \| inspection \| 2026-W45 \| 4 \| 150 \| 195 \|/);
  const empty = P.buildReport({ from: '2026-11-02', to: '2026-11-08', users, nowMs: 0 });
  assert.deepStrictEqual(empty.sections.field_task_time.rows, []);
  assert.match(P.toMarkdown(empty).split('## Field task time')[1], /\nno data\n/);
  assert.strictEqual(P.quantile([], 0.75), null);
});
