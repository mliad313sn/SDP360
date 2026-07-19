// tests/assets-effort-readers.test.js — seeds asset_effort_history DIRECTLY (control
// the scores precisely; do NOT go through snapshotEffort) and exercises the READERS
// getEffortLeaderboard + getEffortTrend that the Progress dashboard consumes
// (Task 2, sub-project "asset-manager effort trend").
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'effr-'));
const adb = require('../assets-db');

// Full column set for a direct seed of the history table.
const cols = ['snapshot_date', 'site', 'total', 'no_cost', 'no_age', 'no_owner',
  'never_scanned', 'no_asset_tag', 'discovered', 'ghost', 'cost_pct', 'age_pct', 'owner_pct',
  'scan_pct', 'tag_pct', 'enrolled_pct', 'effort_score'];

// Minimal detail cols — the readers only care about site/date/effort_score (+ pcts for
// the single-site components). Fill the counts with 0 and set the six pcts to a known
// value only where we assert on components.
const mk = (snapshot_date, site, effort_score, pcts) => ({
  snapshot_date, site, total: 10, no_cost: 0, no_age: 0, no_owner: 0, never_scanned: 0,
  no_asset_tag: 0, discovered: 0, ghost: 0,
  cost_pct: (pcts && pcts.cost_pct) ?? 1, age_pct: (pcts && pcts.age_pct) ?? 1,
  owner_pct: (pcts && pcts.owner_pct) ?? 1, scan_pct: (pcts && pcts.scan_pct) ?? 1,
  tag_pct: (pcts && pcts.tag_pct) ?? 1, enrolled_pct: (pcts && pcts.enrolled_pct) ?? 1,
  effort_score,
});

// Dates are RELATIVE to today so the fixture ages with the clock — getEffortTrend
// derives its window from new Date() ("last N months ending today"), so absolute
// seed dates would silently fall out of a 6-month window on a future run. D3 = today
// (= asOf), D1 = today−30d so it sits exactly on the lookback cutoff (asOf−30d) and
// resolves as the baseline for the 3-snapshot sites (the `<= cutoff` boundary is
// inclusive); D2 sits between. All three stay inside the 6-month trend window.
const iso = (daysAgo) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};
const D1 = iso(30), D2 = iso(11), D3 = iso(0), ASOF = D3;
const rows = [
  mk(D1, 'MANA', 40), mk(D2, 'MANA', 60), mk(D3, 'MANA', 70, { cost_pct: 0.9 }), // rising, known D3 pct
  mk(D1, 'HGO', 80), mk(D2, 'HGO', 75), mk(D3, 'HGO', 55),                        // falling
  mk(D3, 'SGO', 30),                                                             // single snapshot
  mk(D1, 'NEEDS', 45), mk(D2, 'NEEDS', 44), mk(D3, 'NEEDS', 40),                 // low + falling
];
adb.replaceTable('asset_effort_history', cols, rows);

test('getEffortLeaderboard — scores, lookback baseline, delta, rank', () => {
  const lb = adb.getEffortLeaderboard({ asOf: ASOF });
  const by = Object.fromEntries(lb.rows.map(r => [r.site, r]));

  assert.strictEqual(by.MANA.effort_score, 70);
  assert.strictEqual(by.MANA.baseline_score, 40, 'D1 baseline (~30d before asOf)');
  assert.strictEqual(by.MANA.delta, 30);

  assert.strictEqual(by.HGO.effort_score, 55);
  assert.strictEqual(by.HGO.baseline_score, 80);
  assert.strictEqual(by.HGO.delta, -25);

  assert.strictEqual(by.SGO.effort_score, 30);
  assert.strictEqual(by.SGO.baseline_score, null, 'single snapshot → null baseline');
  assert.strictEqual(by.SGO.delta, null);

  assert.strictEqual(by.NEEDS.effort_score, 40);
  assert.strictEqual(by.NEEDS.delta, -5);

  // rank = 1-based by score desc: MANA(70)=1, HGO(55)=2, NEEDS(40)=3, SGO(30)=4
  assert.strictEqual(by.MANA.rank, 1);
  assert.strictEqual(by.HGO.rank, 2);
  assert.strictEqual(by.NEEDS.rank, 3);
  assert.strictEqual(by.SGO.rank, 4);
});

test('getEffortLeaderboard — most_improved + needs_attention', () => {
  const lb = adb.getEffortLeaderboard({ asOf: ASOF });
  assert.ok(lb.most_improved, 'most_improved present');
  assert.strictEqual(lb.most_improved.site, 'MANA', 'max positive delta');
  assert.ok(lb.needs_attention, 'needs_attention present');
  assert.strictEqual(lb.needs_attention.site, 'NEEDS', 'score<50 AND delta<=0');
});

test('getEffortLeaderboard — zero history → empty-but-valid', () => {
  // asOf before any snapshot → no rows in scope.
  const lb = adb.getEffortLeaderboard({ asOf: '2020-01-01' });
  assert.deepStrictEqual(lb, { rows: [], most_improved: null, needs_attention: null });
});

test('getEffortTrend — dates ascending + scores aligned with null gaps', () => {
  const tr = adb.getEffortTrend({}, { months: 6 });
  assert.deepStrictEqual(tr.dates, [D1, D2, D3], 'distinct dates ascending');
  const by = Object.fromEntries(tr.sites.map(s => [s.site, s]));
  assert.deepStrictEqual(by.MANA.scores, [40, 60, 70]);
  // SGO only has a D3 snapshot → the two leading positions are null, NOT 0.
  assert.deepStrictEqual(by.SGO.scores, [null, null, 30]);
});

test('getEffortTrend — single-site filter narrows + returns components', () => {
  const tr = adb.getEffortTrend({ site: 'MANA' }, { months: 6 });
  assert.strictEqual(tr.sites.length, 1);
  assert.strictEqual(tr.sites[0].site, 'MANA');
  assert.ok(tr.sites[0].components, 'components present for single-site');
  assert.strictEqual(tr.sites[0].components.cost_pct, 0.9, 'latest-in-window (D3) pct');
});

test('getEffortTrend — no rows in window → empty-but-valid', () => {
  const tr = adb.getEffortTrend({ site: 'NOPE' }, { months: 6 });
  assert.deepStrictEqual(tr, { dates: [], sites: [] });
});
