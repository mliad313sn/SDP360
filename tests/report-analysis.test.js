'use strict';
// Step 9 — pure analysis of a resolved widget set: never invents a figure, null stays "not measured", bilingual, ordering.
const { test } = require('node:test');
const assert = require('node:assert');
const { analyse, trendDirection, canonicalNumbers } = require('../services/reportAnalysis');

const widgets = {
  w1: { mode: 'single', metric: 'helpdesk.resolution_sla_pct', title: 'Resolution SLA', value: 71.4, unit: '%', rag: 'RED', window: { label: '2026-09' }, fleet: { mean: 88 } },
  w2: { mode: 'single', metric: 'assets.completeness_pct', title: 'Completeness', value: null, unit: '%', rag: 'NA' },
  w3: { mode: 'series', metric: 'helpdesk.first_reply_sla_pct', title: 'First reply', unit: '%', points: [{ label: 'W36', value: 90 }, { label: 'W37', value: 91 }, { label: 'W38', value: 89 }, { label: 'W39', value: 80 }] },
  w4: { mode: 'per-site', metric: 'tracker.site_score_pct', title: 'Tracker', unit: '%', rows: [{ site: 'Hounde', value: 40, rag: 'RED' }, { site: 'Mana', value: 85, rag: 'GREEN' }, { site: 'Ity', value: null, rag: 'NA' }] },
  w5: { mode: 'actions', title: 'Actions', totals: { open: 7 }, items: [{ overdue: true, age_days: 12 }, { overdue: false, age_days: 3 }] },
};
const registry = { get: (k) => (k ? { higher_is_better: true } : null) };

test('analyse: coverage counts measured vs total, null is a finding "unmeasured" never a 0', () => {
  const a = analyse({ widgets, audience: 'site', lang: 'en', siteName: 'Hounde', window: '2026-09', registry });
  assert.deepEqual(a.coverage, { measured: 1, total: 2 });
  const un = a.findings.find(f => f.kind === 'unmeasured'); assert.equal(un.id, 'w2');
  assert.ok(a.bullets.some(b => /not measured/.test(b)));
  assert.ok(!JSON.stringify(a.figures.find(f => f.id === 'w2')).includes('"value":0'));
});

test('analyse: red first, worsening, sites_red, below_fleet, overdue actions; headline quotes the counts', () => {
  const a = analyse({ widgets, audience: 'site', lang: 'en', siteName: 'Hounde', registry });
  assert.equal(a.findings[0].kind, 'red');
  assert.deepEqual(['red', 'sites_red', 'worsening'], a.findings.slice(0, 3).map(f => f.kind));
  assert.ok(a.findings.some(f => f.kind === 'below_fleet' && f.gap === -16.6));
  assert.ok(a.findings.some(f => f.kind === 'overdue_actions' && f.n === 1 && f.oldest === 12));
  assert.match(a.headline, /Hounde: 2 red indicator\(s\) and 1 worsening trend\(s\) across 1\/2 measured/);
  assert.equal(a.tone, 'operational');
});

test('analyse: French output and executive tone adds the spread sentence', () => {
  const a = analyse({ widgets, audience: 'executive', lang: 'fr', siteName: 'Hounde', registry });
  assert.equal(a.lang, 'fr'); assert.equal(a.tone, 'direction');
  assert.match(a.headline, /indicateur\(s\) en rouge/);
  assert.ok(a.bullets.some(b => /Tracker : de 40 % \(Hounde\) à 85 % \(Mana\)/.test(b)), 'spread for executives');
  const site = analyse({ widgets, audience: 'site', lang: 'fr', registry });
  assert.ok(!site.bullets.some(b => /Tracker : de/.test(b)), 'spread hidden for the site audience');
});

test('trendDirection: dead band for %, needs 3 points, improving when higher is better', () => {
  assert.equal(trendDirection([{ value: 90 }, { value: 91 }], '%').dir, 'flat');
  assert.equal(trendDirection([{ value: 90 }, { value: 91 }, { value: 90.5 }], '%').dir, 'flat');
  assert.equal(trendDirection([{ value: 10 }, { value: 10 }, { value: 20 }], 'count').dir, 'up');
  const a = analyse({ widgets: { s: { mode: 'series', metric: 'x', title: 'X', unit: 'count', points: [{ value: 10 }, { value: 10 }, { value: 20 }] } }, registry: { get: () => ({ higher_is_better: false }) } });
  assert.equal(a.findings[0].kind, 'worsening', 'up on a lower-is-better metric is worsening');
});

test('canonicalNumbers: every quoted figure in all its display forms, nothing else', () => {
  const a = analyse({ widgets, registry });
  const c = canonicalNumbers(a.figures);
  for (const n of ['71.4', '88', '40', '85', '80', '7', '1', '90', '91', '89']) assert.ok(c.has(n), n);
  assert.ok(!c.has('42'));
  assert.equal(canonicalNumbers([]).size, 0);
});

// ── F-DATA-04 — a report run keeps the truths the screen shows (partial period, sample, withdrawn colour) ──
test('F-DATA-04 trendDirection: a trailing partial point is never the "last" value; 3 COMPLETE points are needed', () => {
  // running month of a count metric: 3 on day 5 against a base of 40 used to read "down"
  const pts = [{ label: '2026-08', value: 40 }, { label: '2026-09', value: 41 }, { label: '2026-10', value: 39 }, { label: '2026-11', value: 3, partial: true }];
  const t = trendDirection(pts, 'count');
  assert.equal(t.dir, 'flat'); assert.equal(t.last, 39); assert.equal(t.partial_excluded, 1);
  // two complete points + the running one is not a trend
  assert.equal(trendDirection([{ value: 10 }, { value: 10 }, { value: 30, partial: true }], 'count').dir, 'flat');
  // the complete points still give a direction
  assert.equal(trendDirection([{ value: 10 }, { value: 10 }, { value: 20 }, { value: 1, partial: true }], 'count').dir, 'up');
  const a = analyse({ widgets: { s: { mode: 'series', metric: 'x', title: 'X', unit: 'count', partial: true, points: pts } }, registry: { get: () => ({ higher_is_better: false }) } });
  assert.ok(!a.findings.some(f => f.kind === 'improving' || f.kind === 'worsening'), 'a partial month never yields improving/worsening');
  assert.equal(a.figures[0].partial, true);
  assert.deepEqual(a.figures[0].series[3], { label: '2026-11', value: 3, partial: true });
});

test('F-DATA-04 figures carry partial, n, low_sample, target and freshness; absent truths add no key', () => {
  const a = analyse({ registry, widgets: {
    t: { mode: 'single', metric: 'm', title: 'T', value: 50, unit: '%', rag: 'NA', rag_if_fresh: 'RED', freshness: 'STALE', partial: true, n: 4, low_sample: true, target: 90, window: { label: '2026-11' } },
    u: { mode: 'single', metric: 'm', title: 'U', value: 99, unit: '%', rag: 'GREEN', freshness: 'FRESH', partial: false, n: null, low_sample: false, target: null },
  } });
  const t = a.figures.find(f => f.id === 't');
  assert.deepEqual({ partial: t.partial, n: t.n, low_sample: t.low_sample, target: t.target, freshness: t.freshness, rag: t.rag, rag_if_fresh: t.rag_if_fresh }, { partial: true, n: 4, low_sample: true, target: 90, freshness: 'STALE', rag: 'NA', rag_if_fresh: 'RED' });
  const u = a.figures.find(f => f.id === 'u');
  for (const k of ['partial', 'n', 'low_sample', 'target', 'freshness', 'rag_if_fresh']) assert.ok(!(k in u), k + ' absent when nothing to say');
  assert.ok(!a.findings.some(f => f.kind === 'red'), 'no red finding on a withdrawn colour');
  const st = a.findings.find(f => f.kind === 'stale_source'); assert.equal(st.id, 't');
  assert.ok(a.bullets.some(b => /colour withdrawn, source stale/.test(b)));
});

test('F-DATA-04 per-site: a low-sample row is listed but never named best or worst', () => {
  const w = { mode: 'per-site', metric: 'm', title: 'G', unit: '%', rows: [{ site: 'A', value: 0, rag: 'RED', n: 1, low_sample: true }, { site: 'B', value: 80, rag: 'AMBER', n: 40 }, { site: 'C', value: 95, rag: 'GREEN', n: 50 }] };
  const a = analyse({ widgets: { g: w }, audience: 'executive', registry });
  const sp = a.findings.find(f => f.kind === 'spread');
  assert.equal(sp.worst, 'B'); assert.equal(sp.best, 'C');
  assert.equal(a.figures[0].rows.length, 3); assert.deepEqual(a.figures[0].rows[0], { site: 'A', value: 0, rag: 'RED', n: 1, low_sample: true });
});
