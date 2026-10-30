// tests/asset-leaderboard-fairness.test.js — G-04 (audit 2026-09-24).
//
// The effort leaderboard ranked by score alone, so the production board read:
//
//     1. Ouagadougou 100  (1 actif)      ...      3. MANA 57  (474 actifs)
//
// and carried FOURTEEN rows for eleven sites with assets, because `Ouaga` and
// `Ouagadougou`, and `Dakar` and `Dakar Office`, are the same places spelled twice.
// The whole point of this board is "nobody wants to be last" — an incentive that dies
// the moment someone can answer it with one sentence.
//
// So: a site too small to compare is kept, shown, and NOT ranked; the fleet size travels
// with the score; and the known label drift is folded by SUMMING the underlying counts
// and recomputing the score — never by averaging two scores.
'use strict';
// Top-level async setup, run IN ORDER before the first test (PostgreSQL-only conversion, PO-08).
const __bootChain = (() => { let p = Promise.resolve(), hooked = false;
  return (fn) => { p = p.then(fn); if (!hooked) { hooked = true; require('node:test').beforeEach(() => p); } }; })();
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lbfair-'));
const adb = require('../assets-db');

const cols = ['snapshot_date', 'site', 'total', 'no_cost', 'no_age', 'no_owner',
  'never_scanned', 'no_asset_tag', 'discovered', 'ghost', 'cost_pct', 'age_pct', 'owner_pct',
  'scan_pct', 'tag_pct', 'enrolled_pct', 'effort_score'];

// A row with explicit counts; the six pcts + score are derived exactly as snapshotEffort
// derives them, so a folded row can be checked against the same arithmetic.
function row(date, site, total, gaps = {}, scoreOverride) {
  const g = {
    no_cost: 0, no_age: 0, no_owner: 0, never_scanned: 0, no_asset_tag: 0,
    discovered: 0, ghost: 0, ...gaps,
  };
  const c = (x) => Math.max(0, Math.min(1, 1 - x / total));
  const pcts = {
    cost_pct: c(g.no_cost), age_pct: c(g.no_age), owner_pct: c(g.no_owner),
    scan_pct: c(g.never_scanned), tag_pct: c(g.no_asset_tag), enrolled_pct: c(g.discovered),
  };
  const score = Math.round(100 * (pcts.cost_pct + pcts.age_pct + pcts.owner_pct
    + pcts.scan_pct + pcts.tag_pct + pcts.enrolled_pct) / 6);
  return { snapshot_date: date, site, total, ...g, ...pcts,
    effort_score: scoreOverride == null ? score : scoreOverride };
}

const iso = (daysAgo) => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};
const OLD = iso(30), NOW = iso(0);

__bootChain(async () => { (await adb.replaceTable('asset_effort_history', cols, [
  // Big sites — ranked.
  row(OLD, 'MANA', 474, { no_cost: 300 }), row(NOW, 'MANA', 474, { no_cost: 245 }),
  row(OLD, 'HOUNDE', 388, { no_cost: 340 }), row(NOW, 'HOUNDE', 388, { no_cost: 297 }),
  // Tiny site with the biggest jump in the fleet: must never win "most improved".
  row(OLD, 'Massawa', 2, { no_cost: 2, no_age: 2 }), row(NOW, 'Massawa', 2, { no_cost: 0 }),
  // A one-asset site scoring 100: the row that discredited the board.
  row(NOW, 'Tanda Exploration Office', 1),
  row(NOW, 'Ouagadougou', 1),
  // Label drift: same place, two spellings. Folded by counts, not by averaging.
  row(NOW, 'Dakar', 10), row(NOW, 'Dakar Office', 90, { no_cost: 90 }),
  // Tiny AND falling: must not be picked as "needs attention" either.
  row(OLD, 'Ouaga', 1), row(NOW, 'Ouaga', 1, { no_cost: 1, no_age: 1, no_owner: 1 }),
])); });

let lb;
__bootChain(async () => { lb = (await adb.getEffortLeaderboard({ asOf: NOW })); });
const bySite = (s) => lb.rows.find(r => r.site === s);

test('a site too small to compare is kept and shown, but not ranked', () => {
  const tiny = bySite('Tanda Exploration Office');
  assert.ok(tiny, 'the site is not dropped — hiding it would be its own lie');
  assert.strictEqual(tiny.ranked, false);
  assert.strictEqual(tiny.rank, null, 'no rank at all, rather than a flattering one');
  assert.strictEqual(tiny.effort_score, 100, 'its score is still reported');
  assert.strictEqual(tiny.total, 1, 'and the number that explains it travels with it');
});

test('ranked sites are numbered among themselves, contiguously', () => {
  const ranked = lb.rows.filter(r => r.ranked);
  assert.deepStrictEqual(ranked.map(r => r.rank), ranked.map((_, i) => i + 1));
  assert.strictEqual(lb.ranked_count, ranked.length);
  assert.ok(ranked.every(r => r.total >= lb.min_assets), 'every ranked site clears the bar');
  assert.ok(ranked.some(r => r.site === 'MANA') && ranked.some(r => r.site === 'HOUNDE'));
});

test('every row carries its fleet size, ranked or not', () => {
  for (const r of lb.rows) assert.strictEqual(typeof r.total, 'number', `${r.site} has a total`);
});

test('"most improved" is never a site that is not ranked', () => {
  // Massawa jumps ~33 points on two machines; HOUNDE moves ~11 on 388.
  assert.ok(lb.most_improved, 'someone did improve');
  assert.strictEqual(lb.most_improved.ranked, true);
  assert.notStrictEqual(lb.most_improved.site, 'Massawa');
});

test('"needs attention" is never a site that is not ranked', () => {
  if (lb.needs_attention) {
    assert.strictEqual(lb.needs_attention.ranked, true);
    assert.notStrictEqual(lb.needs_attention.site, 'Ouaga');
  }
});

test('known label drift is folded onto one site', () => {
  assert.ok(!bySite('Dakar Office'), 'the duplicate spelling is gone');
  assert.ok(!bySite('Ouaga'), 'so is the short form of Ouagadougou');
  const dakar = bySite('Dakar');
  assert.ok(dakar, 'the canonical spelling survives');
  assert.strictEqual(dakar.total, 100, 'fleet sizes add up (10 + 90)');
  // Ouaga (1 asset, three gaps) folded into Ouagadougou (1 asset, clean): two machines,
  // three gaps between them — round(100 * (0.5+0.5+0.5+1+1+1) / 6) = 75, not 100.
  assert.strictEqual(bySite('Ouagadougou').total, 2);
  assert.strictEqual(bySite('Ouagadougou').effort_score, 75);
});

test('a folded score is recomputed from the summed counts, never averaged', () => {
  // Dakar 10 assets, nothing missing -> 100. Dakar Office 90 assets, all without cost -> 83.
  // Averaging the two scores gives 92; the truth is 100 assets with 90 missing a cost:
  // cost_pct 0.1, the five others 1 -> round(100 * 5.1 / 6) = 85.
  assert.strictEqual(bySite('Dakar').effort_score, 85);
});

test('the threshold is stated, not hidden in the code', () => {
  assert.strictEqual(typeof lb.min_assets, 'number');
  assert.ok(lb.min_assets > 1, 'a bar of 1 would rank a single machine');
});
