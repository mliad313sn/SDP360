'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { effortForSite } = require('../services/assetEffortForSite.js');
const aliases = require('../services/scoreboardAliases.js');

// Build a { rows, most_improved, needs_attention } leaderboard like the one
// getEffortLeaderboard returns. rows[].site is the AP LABEL (mine name), not the
// meetings code — that is exactly what the fold has to resolve.
const board = (rows) => ({ rows, most_improved: null, needs_attention: null });

// ── 1 · fold SGO, rank recomputed across ≥3 codes ───────────────────────────
// Two AP labels fold to SGO (Sabodala 70 + MASSAWA 72 → mean 71). HGO 80 and
// MGO 60 give a real 3-code ordering: HGO #1, SGO #2, MGO #3. A single-code
// fixture would make rank trivially 1 and never exercise the recomputation.
test('folds SGO across two labels, recomputes rank and of, keeps the first label delta', () => {
  const r = effortForSite('SGO', {
    leaderboard: board([
      { site: 'Sabodala', effort_score: 70, delta: 5,  rank: 1 },
      { site: 'MASSAWA',  effort_score: 72, delta: 9,  rank: 2 },
      { site: 'Hounde',   effort_score: 80, delta: 1,  rank: 3 },
      { site: 'Mana',     effort_score: 60, delta: -4, rank: 4 },
    ]),
    aliases,
  });
  // HGO 80 (#1) · SGO round((70+72)/2)=71 (#2) · MGO 60 (#3)
  assert.deepStrictEqual(r, { score: 71, rank: 2, of: 3, delta: 5, ranked: true });
});

// ── 2 · code absent from the fold → null, never a zeros object ───────────────
test('a code with no label folding to it returns null', () => {
  const r = effortForSite('KGO', {
    leaderboard: board([
      { site: 'Sabodala', effort_score: 70, delta: 5, rank: 1 },
      { site: 'Hounde',   effort_score: 80, delta: 1, rank: 2 },
      { site: 'Mana',     effort_score: 60, delta: 2, rank: 3 },
    ]),
    aliases,
  });
  assert.strictEqual(r, null);
});

// ── 3 · delta is the FIRST matching row's delta ─────────────────────────────
// Two labels fold to SGO; the delta must come from the first row that resolves
// to SGO, not the second and not an average.
test('delta comes from the first row whose label folds to the code', () => {
  const r = effortForSite('SGO', {
    leaderboard: board([
      { site: 'MASSAWA',  effort_score: 60, delta: 11, rank: 1 },  // first SGO row
      { site: 'Sabodala', effort_score: 82, delta: 99, rank: 2 },  // second — ignored for delta
      { site: 'Hounde',   effort_score: 40, delta: 1,  rank: 3 },
    ]),
    aliases,
  });
  assert.strictEqual(r.delta, 11);
});

// ── 4 · tie-break: equal scores order by code ASC ───────────────────────────
test('codes with equal scores are ranked by code ascending', () => {
  const lb = board([
    { site: 'Hounde',   effort_score: 70, delta: 0, rank: 1 },
    { site: 'Sabodala', effort_score: 70, delta: 0, rank: 2 },
  ]);
  // HGO and SGO tie at 70 → HGO < SGO, so HGO ranks first.
  assert.strictEqual(effortForSite('HGO', { leaderboard: lb, aliases }).rank, 1);
  assert.strictEqual(effortForSite('SGO', { leaderboard: lb, aliases }).rank, 2);
});

// ── 5 · delta absent on the matching row → null ─────────────────────────────
test('a matching row with no delta yields delta:null (0 stays 0)', () => {
  const noDelta = effortForSite('HGO', {
    leaderboard: board([{ site: 'Hounde', effort_score: 70, rank: 1 }]),
    aliases,
  });
  assert.strictEqual(noDelta.delta, null);
  const zeroDelta = effortForSite('HGO', {
    leaderboard: board([{ site: 'Hounde', effort_score: 70, delta: 0, rank: 1 }]),
    aliases,
  });
  assert.strictEqual(zeroDelta.delta, 0);
});

// ── 6 · aliases default to scoreboardAliases when not injected ───────────────
test('aliases is optional — defaults to the real scoreboardAliases module', () => {
  const r = effortForSite('HGO', {
    leaderboard: board([{ site: 'Hounde', effort_score: 65, delta: 3, rank: 1 }]),
  });
  assert.deepStrictEqual(r, { score: 65, rank: 1, of: 1, delta: 3, ranked: true });
});

// ── G-04 (audit 2026-09-24) — the per-site block must not hand out a flattering rank ──
// The weekly report prints "score / rang / Δ30j" for the site it belongs to. A site with
// a handful of assets is not comparable to a 400-machine mine, so the leaderboard stopped
// ranking it — and this resolver, which re-derives its own rank over folded codes, has to
// honour that instead of quietly restoring one.
test('G-04: a site whose labels are all unranked gets no rank, but keeps its score', () => {
  const r = effortForSite('SGO', {
    leaderboard: board([
      { site: 'Sabodala', effort_score: 100, delta: null, rank: null, total: 2, ranked: false },
      { site: 'Hounde',   effort_score: 60,  delta: 3,    rank: 1,    total: 388, ranked: true },
      { site: 'Mana',     effort_score: 57,  delta: 2,    rank: 2,    total: 474, ranked: true },
    ]),
    aliases,
  });
  assert.ok(r, 'the site is not erased');
  assert.strictEqual(r.score, 100, 'its score still stands');
  assert.strictEqual(r.rank, null, 'but it is not ranked against sites 200x its size');
  assert.strictEqual(r.ranked, false);
});

test('G-04: unranked sites do not inflate the "of N" a ranked site is measured against', () => {
  const r = effortForSite('HGO', {
    leaderboard: board([
      { site: 'Sabodala', effort_score: 100, delta: null, rank: null, total: 2, ranked: false },
      { site: 'Hounde',   effort_score: 60,  delta: 3,    rank: 1,    total: 388, ranked: true },
      { site: 'Mana',     effort_score: 57,  delta: 2,    rank: 2,    total: 474, ranked: true },
    ]),
    aliases,
  });
  assert.strictEqual(r.rank, 1);
  assert.strictEqual(r.of, 2, 'two comparable sites, not three');
  assert.strictEqual(r.ranked, true);
});

test('G-04: a board without the flag behaves exactly as before', () => {
  const r = effortForSite('HGO', {
    leaderboard: board([
      { site: 'Hounde', effort_score: 80, delta: 1, rank: 1 },
      { site: 'Mana',   effort_score: 60, delta: -4, rank: 2 },
    ]),
    aliases,
  });
  assert.strictEqual(r.rank, 1);
  assert.strictEqual(r.of, 2);
});
