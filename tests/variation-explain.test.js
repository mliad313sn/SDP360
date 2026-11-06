'use strict';
// E-K04 — deterministic variation explanation: pure engine + GET /api/metrics/:key/explain on a stubbed router.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const fetch = require('./_http-fetch');
const VX = require('../services/variationExplain');

test('count: contributions sum to the delta and are sorted by size, with both sides', () => {
  const x = VX.explainCount({ metric: 'helpdesk.inbound', a: '2026-09', b: '2026-10', parts: [
    { key: 1, label: 'Hounde', a: 100, b: 130 }, { key: 2, label: 'Mana', a: 50, b: 40 }, { key: 3, label: 'Ity', a: 20, b: 22 }] });
  assert.equal(x.state, 'OK'); assert.equal(x.total_a, 170); assert.equal(x.total_b, 192); assert.equal(x.delta, 22);
  assert.equal(x.contributions.reduce((s, c) => s + c.delta, 0), x.delta);
  assert.deepEqual(x.contributions.map((c) => c.label), ['Hounde', 'Mana', 'Ity']);
  assert.deepEqual(x.contributions[1], { key: 2, label: 'Mana', a: 50, b: 40, delta: -10, share_pct: -45.5 });
});

test('count: a part missing one window is UNKNOWN and left out of the sum; nothing measured → UNKNOWN, never 0', () => {
  const x = VX.explainCount({ parts: [{ key: 1, label: 'A', a: 10, b: 12 }, { key: 2, label: 'B', a: null, b: 5 }] });
  assert.equal(x.state, 'PARTIAL'); assert.equal(x.delta, 2); assert.equal(x.unknown_parts[0].state, 'UNKNOWN');
  const n = VX.explainCount({ parts: [{ key: 1, label: 'A', a: null, b: null }] });
  assert.equal(n.state, 'UNKNOWN'); assert.equal(n.delta, null); assert.equal(n.total_a, null);
  assert.equal(VX.explainCount({ parts: [{ key: 1, a: 4, b: 4 }] }).contributions[0].share_pct, null, 'no share of a zero delta');
});

test('ratio: decomposed into numerator and denominator changes, never explained; missing term = null', () => {
  const r = VX.explainRatio({ a: '2026-09', b: '2026-10', sideA: { value: 80, num: 80, den: 100 }, sideB: { value: 75, num: 90, den: 120 } });
  assert.equal(r.delta_pts, -5); assert.deepEqual(r.numerator, { a: 80, b: 90, delta: 10 }); assert.deepEqual(r.denominator, { a: 100, b: 120, delta: 20 });
  assert.ok(!('contributions' in r));
  const u = VX.explainRatio({ sideA: { value: null }, sideB: { value: 70 } });
  assert.equal(u.state, 'UNKNOWN'); assert.equal(u.delta_pts, null); assert.equal(u.numerator.delta, null);
});

test('the data note cites the figures, is labelled data-generated and asserts no cause', () => {
  const x = VX.explainCount({ a: '2026-09', b: '2026-10', parts: [{ key: 1, label: 'Hounde', a: 100, b: 130 }, { key: 2, label: 'Mana', a: 50, b: 40 }] });
  const n = VX.dataNote(x, 'Inbound tickets');
  assert.equal(n.kind, 'data_note'); assert.equal(n.generated, 'data');
  assert.match(n.text, /Inbound tickets: 150 → 170 \(\+20\) between 2026-09 and 2026-10; largest contribution Hounde \+30 — measured change — no cause asserted\.$/);
  assert.ok(!/\b(because|due to|caused|driven by|owing to)\b/i.test(n.text));
  assert.match(VX.dataNote(VX.explainCount({ parts: [] }), 'X').text, /not measured on both windows/);
  assert.match(VX.dataNote(VX.explainRatio({ a: 'a', b: 'b', sideA: { value: 80, num: 8, den: 10 }, sideB: { value: 90, num: 9, den: 10 } }), 'Closure').text, /numerator \+1, denominator 0/);
});

// ── route (stub registry / rdb / config) ──
const SITES = [{ id: 1, name: 'Hounde', active: 1 }, { id: 2, name: 'Mana', active: 1 }];
const DATA = { 1: { '2026-09': { inbound: 100, closed: 80, close_pct: 80 }, '2026-10': { inbound: 130, closed: 117, close_pct: 90 } },
  2: { '2026-09': { inbound: 50, closed: 40, close_pct: 80 }, '2026-10': { inbound: 40 } } };
const reg = { get: (k) => ({ 'helpdesk.inbound': { key: k, name: 'Inbound tickets', unit: 'count', reader: 'x' }, 'helpdesk.closure_pct': { key: k, name: 'Closure rate', unit: '%', reader: 'x' }, 'helpdesk.avg_h': { key: k, name: 'Avg', unit: 'hours', reader: 'x' } })[k] || null,
  resolve: async (key, { site, window }) => { const rec = (DATA[site] || {})[window] || null; const f = key === 'helpdesk.inbound' ? 'inbound' : 'close_pct';
    return { key, window: { label: window }, value: rec && rec[f] != null ? rec[f] : null, record: rec, base: rec ? { n: rec.inbound } : null }; } };
let server, base, cfgOn = '0';
const users = { admin: { id: 1, roles: ['admin'] }, hounde: { id: 2, roles: ['viewer'], site_id: 1, site_ids: [1] } };
test.before(async () => {
  const app = express();
  const requireReportSession = (req, res, next) => { req.reportUser = users[req.get('x-user')]; return req.reportUser ? next() : res.status(401).end(); };
  const rdb = { db: {}, userHasRole: (u, r) => r === 'admin' && (u.roles || []).includes('admin'), listSites: async () => SITES };
  app.use(require('../routes/metrics')({ express, requireReportSession, registry: reg, rdb, readerDeps: {}, reportConfig: { getConfig: async () => ({ metric_explain_enabled: cfgOn }) } }));
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server && server.close());
const get = (p, u) => fetch(base + p, { headers: { 'x-user': u } });

test('route: switch 0 → 404; switch 1 → per-site contributions within the caller\'s scope', async () => {
  assert.equal((await get('/api/metrics/helpdesk.inbound/explain?a=2026-09&b=2026-10', 'admin')).status, 404);
  cfgOn = '1';
  const j = await (await get('/api/metrics/helpdesk.inbound/explain?a=2026-09&b=2026-10', 'admin')).json();
  assert.equal(j.delta, 20); assert.equal(j.contributions.reduce((s, c) => s + c.delta, 0), 20); assert.equal(j.data_note.kind, 'data_note');
  const h = await (await get('/api/metrics/helpdesk.inbound/explain?a=2026-09&b=2026-10', 'hounde')).json();
  assert.deepEqual(h.contributions.map((c) => c.label), ['Hounde'], 'a site user only sees their own sites');
});

test('route: another site 403; missing window 400; null window → UNKNOWN; ratio needs one site; non-additive unit not decomposed', async () => {
  assert.equal((await get('/api/metrics/helpdesk.inbound/explain?site=2&a=2026-09&b=2026-10', 'hounde')).status, 403);
  assert.equal((await get('/api/metrics/helpdesk.inbound/explain?a=2026-09', 'admin')).status, 400);
  const u = await (await get('/api/metrics/helpdesk.inbound/explain?site=1&a=2025-01&b=2026-10', 'admin')).json();
  assert.equal(u.state, 'UNKNOWN'); assert.equal(u.delta, null);
  assert.equal((await get('/api/metrics/helpdesk.closure_pct/explain?a=2026-09&b=2026-10', 'admin')).status, 400);
  const r = await (await get('/api/metrics/helpdesk.closure_pct/explain?site=1&a=2026-09&b=2026-10', 'admin')).json();
  assert.equal(r.kind, 'ratio'); assert.equal(r.delta_pts, 10); assert.deepEqual(r.numerator, { a: 80, b: 117, delta: 37 }); assert.deepEqual(r.denominator, { a: 100, b: 130, delta: 30 });
  const m = await (await get('/api/metrics/helpdesk.closure_pct/explain?site=2&a=2026-09&b=2026-10', 'admin')).json();
  assert.equal(m.state, 'UNKNOWN', 'Mana has no October closure rate');
  assert.equal((await (await get('/api/metrics/helpdesk.avg_h/explain?site=1&a=2026-09&b=2026-10', 'admin')).json()).kind, 'not_decomposable');
});
