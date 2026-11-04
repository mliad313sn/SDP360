'use strict';
// C-05 — dashboard time truth (F05 F06 F21 F22 F30, Annex B #3 #6, G07 G08 G29): series anchored on the
// selected window, targets read at the period's end (ended versions honoured), partial periods flagged and
// never compared with full ones, computed-at vs data-through, a stale-response guard in the viewer, and a
// bounded-concurrency resolver that returns exactly what the sequential one does.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const R = require('../public/lib/dashboardRender');
const DD = require('../services/dashboardData');
const KT = require('../services/kpiTargets');
const MR = require('../services/metricRegistry');

const NOW = new Date('2026-11-04T10:00:00Z');

// ── pure helpers ────────────────────────────────────────────────────────────────────────
test('periodBounds / isPartial: ISO week, month, day; partial = the period has not ended yet', () => {
  assert.deepEqual(R.periodBounds('2026-W10'), { from: '2026-03-02', to: '2026-03-08' });
  assert.deepEqual(R.periodBounds('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(R.periodBounds('2026-11-04'), { from: '2026-11-04', to: '2026-11-04' });
  assert.equal(R.periodBounds('latest'), null);
  assert.equal(R.isPartial('2026-11', NOW), true, 'current month');
  assert.equal(R.isPartial('2026-10', NOW), false);
  assert.equal(R.isPartial('2026-W45', NOW), true, 'current ISO week (2 Nov – 8 Nov)');
  assert.equal(R.isPartial('2026-W44', NOW), false);
  assert.equal(R.isPartial('nope', NOW), false);
  assert.equal(R.windowPartial({ to: '2026-11-30' }, NOW), true);
  assert.equal(R.windowPartial({ to: '2026-11-04' }, NOW), false, 'a window ending today (rolling/current) is complete as of today');
  assert.equal(R.windowPartial(null, NOW), false);
});

test('F05/G07: the series ends on the SELECTED window, not on today', () => {
  const wk = (w) => R.windowSeries('week', 4, R.seriesAnchor(w, 'week', NOW));
  assert.deepEqual(wk('2026-W10'), ['2026-W07', '2026-W08', '2026-W09', '2026-W10']);
  assert.deepEqual(wk('2026-W01'), ['2025-W50', '2025-W51', '2025-W52', '2026-W01']);
  assert.equal(wk('2026-05').slice(-1)[0], '2026-W22', 'a month window → the last full week inside it (25–31 May)');
  const mo = (w) => R.windowSeries('month', 3, R.seriesAnchor(w, 'month', NOW));
  assert.deepEqual(mo('2026-05'), ['2026-03', '2026-04', '2026-05']);
  assert.equal(mo('2026-W10').slice(-1)[0], '2026-03', 'a week window → its month');
  // no window = today's behaviour (previous full week, current month)
  assert.deepEqual(R.windowSeries('week', 2, R.seriesAnchor(null, 'week', NOW)), R.windowSeries('week', 2, NOW));
  assert.deepEqual(R.windowSeries('month', 2, R.seriesAnchor('', 'month', NOW)), R.windowSeries('month', 2, NOW));
});

test('F06/G08: a target is read at the period end — ended versions count for the dates they covered', () => {
  const rows = [
    { id: 1, metric_key: 'm', site_id: null, target: 90, effective_from: '2026-01-01', ended_at: '2026-06-01T09:00:00.000Z' },
    { id: 2, metric_key: 'm', site_id: null, target: 95, effective_from: '2026-06-01', ended_at: null }];
  assert.equal(KT.targetFor(rows, 'm', null, '2026-05-31').target, 90, 'window 2026-05 → 90');
  assert.equal(KT.targetFor(rows, 'm', null, '2026-06-30').target, 95);
  const t = KT.targetFor(rows, 'm', null, '2026-05-31');
  assert.equal(t.id, 1); assert.equal(t.effective_from, '2026-01-01'); assert.equal(t.ended_at, '2026-06-01T09:00:00.000Z');
  assert.equal(KT.targetFor(rows, 'm', null, '2025-12-31').target, null, 'before any target');
  // a target ended with no successor: nothing after its end date
  assert.equal(KT.targetFor([rows[0]], 'm', null, '2026-07-01').target, null);
});

test('F06: the store exposes ended versions through listAll(); list() stays live-only', async () => {
  const seen = [];
  const db = { prepare: (sql) => ({ all: async () => { seen.push(sql); return []; } }) };
  const st = KT.makeKpiTargetStore(db);
  await st.list(); await st.listAll();
  assert.match(seen[0], /ended_at IS NULL/);
  assert.ok(!/ended_at IS NULL/.test(seen[1]), 'listAll keeps the ended rows');
});

test('F30: the tile says "not comparable" instead of a delta when the period is partial', () => {
  const c = R.kpiContext({ value: 40, unit: '%', partial: true, previous: { label: '2026-10', value: 90, delta: null, comparable: false } });
  assert.match(c, /not comparable/); assert.ok(!/▼|▲/.test(c));
  assert.match(R.partialNote({ partial: true, window: { label: '2026-11', to: '2026-11-30' } }, NOW), /partial.*4 Nov/);
  assert.equal(R.partialNote({ partial: false }, NOW), '');
});

test('F06: the series table shows the target of each period with its version', () => {
  const h = R.seriesTableHtml({ unit: '%', title: 'SLA', target: 95, points: [
    { label: '2026-05', value: 88, target: 90, target_from: '2026-01-01' }, { label: '2026-06', value: 96, target: 95, target_from: '2026-06-01', partial: true }] });
  assert.match(h, /2026-05<\/th><td class="num">88 %<\/td><td class="num" title="target version from 2026-01-01">90 %/);
  assert.match(h, /2026-06 \(partial\)/);
});

// ── resolver ─────────────────────────────────────────────────────────────────────────────
function fakeReg(delays) {
  const reg = MR.createRegistry([
    { key: 'a.pct', name: 'A', unit: '%', window_kind: 'month', reader: 'ctt', field: 'a', status: 'published' },
    { key: 'w.pct', name: 'W', unit: '%', window_kind: 'week', reader: 'ctt', field: 'a', status: 'published' }]);
  let inflight = 0; const stats = { max: 0, calls: [] };
  MR.READERS.ctt = async (d, { site, win }) => {
    inflight++; stats.max = Math.max(stats.max, inflight); stats.calls.push(win.label);
    await new Promise((r) => setTimeout(r, delays ? Math.floor(Math.random() * 8) : 0));
    inflight--;
    const mo = Number(String(win.label).slice(5, 7)) || 1;
    return { a: Number(site || 0) * 10 + mo };
  };
  return { reg, stats };
}
const SITES = [{ id: 1, name: 'Hounde' }, { id: 2, name: 'Ity' }, { id: 3, name: 'Mana' }, { id: 4, name: 'Lafigue' }, { id: 5, name: 'Sabodala' }, { id: 6, name: 'Dakar' }];
const TARGETS = [
  { id: 1, metric_key: 'a.pct', site_id: null, target: 90, effective_from: '2026-01-01', ended_at: '2026-06-01T09:00:00.000Z' },
  { id: 2, metric_key: 'a.pct', site_id: null, target: 95, effective_from: '2026-06-01', ended_at: null }];
const rdbT = { pgHandle: () => ({ prepare: (sql) => ({ all: async () => (/ended_at IS NULL/.test(sql) ? TARGETS.filter((t) => !t.ended_at) : TARGETS) }) }) };

test('F05+F06: a trend on window 2026-06 ends on June, each point carries the target of its period', async () => {
  const { reg } = fakeReg();
  try {
    const out = await DD.resolveWidgets({ def: { widgets: [{ id: 't', type: 'trend', metric: 'a.pct', window: '3m' }] }, sites: SITES, site: 1, window: '2026-06', reg, dd: {}, rdb: rdbT, now: NOW });
    assert.deepEqual(out.t.points.map((p) => p.label), ['2026-04', '2026-05', '2026-06']);
    assert.deepEqual(out.t.points.map((p) => p.target), [90, 90, 95], 'the May point is judged on the May target (ended 1 Jun)');
    assert.deepEqual(out.t.points.map((p) => p.target_from), ['2026-01-01', '2026-01-01', '2026-06-01']);
    assert.equal(out.t.window_end, '2026-06-30');
    assert.equal(out.t.target, 95, 'series target = the one at the window end');
    assert.ok(out.t.points.every((p) => p.partial === false));
  } finally { delete MR.READERS.ctt; }
});

test('F30: the current month is flagged partial in the series and the tile; its delta is not compared', async () => {
  const { reg } = fakeReg();
  try {
    const out = await DD.resolveWidgets({ def: { widgets: [{ id: 't', type: 'trend', metric: 'a.pct', window: '2m' }, { id: 'k', type: 'kpi', metric: 'a.pct' }] }, sites: SITES, site: 1, reg, dd: {}, rdb: rdbT, now: NOW });
    assert.deepEqual(out.t.points.map((p) => [p.label, p.partial]), [['2026-10', false], ['2026-11', true]]);
    assert.equal(out.t.window_end, '2026-11-04', 'the window of a partial period ends today');
    assert.equal(out.k.partial, true); assert.equal(out.k.window.label, '2026-11');
    assert.equal(out.k.previous.label, '2026-10'); assert.equal(out.k.previous.value, 20);
    assert.equal(out.k.previous.delta, null); assert.equal(out.k.previous.comparable, false);
    assert.equal(out.k.target, 95); assert.equal(out.k.target_from, '2026-06-01');
    // a closed window is full: the delta is back
    const past = await DD.resolveWidgets({ def: { widgets: [{ id: 'k', type: 'kpi', metric: 'a.pct' }] }, sites: SITES, site: 1, window: '2026-05', reg, dd: {}, rdb: rdbT, now: NOW });
    assert.equal(past.k.partial, false); assert.equal(past.k.previous.delta, 1); assert.equal(past.k.previous.comparable, true);
    assert.equal(past.k.target, 90, 'a May KPI uses the target live in May (since ended)');
  } finally { delete MR.READERS.ctt; }
});

test('F22/G29: bounded concurrency (≤ 4 in flight) returns exactly what the sequential resolver returns; timings per widget', async () => {
  const def = { widgets: [
    { id: 'k', type: 'kpi', metric: 'a.pct', compare: 'fleet' }, { id: 't', type: 'trend', metric: 'w.pct', window: '8w' },
    { id: 'g', type: 'ragGrid', metric: 'a.pct' }, { id: 'tb', type: 'table', metric: 'a.pct' }, { id: 'x', type: 'text', markdown: 'hi' }] };
  const { reg, stats } = fakeReg(true);
  try {
    const seq = await DD.resolveWidgets({ def, sites: SITES, site: 2, window: '2026-06', reg, dd: {}, rdb: rdbT, now: NOW, concurrency: 1 });
    assert.equal(stats.max, 1, 'sequential baseline');
    stats.max = 0; const timings = {};
    const par = await DD.resolveWidgets({ def, sites: SITES, site: 2, window: '2026-06', reg, dd: {}, rdb: rdbT, now: NOW, onTiming: (id, ms) => { timings[id] = ms; } });
    assert.ok(stats.max > 1 && stats.max <= DD.RESOLVE_CONCURRENCY, `in flight ${stats.max}`);
    assert.equal(DD.RESOLVE_CONCURRENCY, 4);
    assert.deepEqual(par, seq);
    assert.deepEqual(par.g.rows.map((r) => r.site_id).sort(), [1, 2, 3, 4, 5, 6], 'the caller scope only');
    assert.deepEqual(Object.keys(timings).sort(), ['g', 'k', 't', 'tb', 'x']);
    assert.ok(Object.values(timings).every((ms) => Number.isFinite(ms) && ms >= 0));
  } finally { delete MR.READERS.ctt; }
});

test('mapLimit keeps input order and the cap', async () => {
  let n = 0, max = 0;
  const out = await DD.mapLimit([5, 1, 4, 2, 3, 0], 2, async (x) => { n++; max = Math.max(max, n); await new Promise((r) => setTimeout(r, x)); n--; return x * 2; });
  assert.deepEqual(out, [10, 2, 8, 4, 6, 0]); assert.ok(max <= 2);
  assert.deepEqual(await DD.mapLimit([], 4, async (x) => x), []);
});

// ── viewer (static) ──────────────────────────────────────────────────────────────────────
const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboards.html'), 'utf8').replace(/\r\n/g, '\n');
test('F21: the viewer says "Computed at" for the response time and "Data through" per source', () => {
  assert.ok(!/'Data as of '/.test(page), 'the response time is not presented as the data date');
  assert.match(page, /'Computed at '/);
  assert.match(page, /Data through/);
  assert.match(page, /d\.sources/);
});
test('Annex B #6: loadData ignores a late response (request sequence)', () => {
  const body = page.slice(page.indexOf('function loadData'), page.indexOf('function renderWidgets'));
  assert.match(body, /var seq = \+\+loadSeq/);
  assert.match(body, /if \(seq !== loadSeq\) return/);
  assert.ok((body.match(/seq !== loadSeq/g) || []).length >= 2, 'both success and failure paths are guarded');
});
