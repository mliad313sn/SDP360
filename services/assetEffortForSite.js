'use strict';

/**
 * effortForSite — shared, PURE, SYNCHRONOUS resolver of a site code's asset
 * effort standing out of an already-fetched leaderboard.
 *
 *   effortForSite(code, { leaderboard, aliases }) → { score, rank, of, delta } | null
 *
 * The leaderboard is resolved by the CALLER (getEffortLeaderboard is async under
 * PostgreSQL); this helper never touches a DB, so it stays synchronous and unit-
 * testable. The weekly loader maps { score, rank } onto its own contract; the
 * monthly report reuses the same figures plus `of` (how many codes are ranked)
 * and `delta` (~30-day lookback).
 *
 * ⚠ leaderboard.rows[].site is an AP LABEL ('Sabodala', 'MASSAWA', or a code used
 * literally like 'HGO') — NOT necessarily the meetings code. foldEffortByCode
 * resolves the mine names via ALIAS (unaliased labels are ignored) and means the
 * score across every label folding to one code; rank cannot survive that (a mean
 * of ranks is meaningless), so it is re-derived as this code's position among all
 * folded codes, score-descending with code-ascending tie-break for determinism.
 */

const _defaultAliases = () => require('./scoreboardAliases.js');

function effortForSite(code, { leaderboard, aliases } = {}) {
  aliases = aliases || _defaultAliases();
  const rows = (leaderboard && leaderboard.rows) || [];

  const folded = aliases.foldEffortByCode(rows);   // Map<code, score|null>

  const score = folded.get(code);
  if (score == null) return null;                  // never a zeros object

  // G-04 — a code counts in the ranking only if at least one of its labels is ranked
  // (the leaderboard leaves a site under the asset bar unranked). A board built before
  // that flag existed has no `ranked` key at all: absent means ranked, so older callers
  // and fixtures behave exactly as before.
  const rankedCodes = new Set();
  for (const row of rows) {
    if (row.ranked === false) continue;
    const c = aliases.assetLabelToCode(row.site);
    if (c) rankedCodes.add(c);
  }
  const ranked = rankedCodes.has(code);

  const ordered = [...folded.entries()]
    .filter(([c, s]) => s != null && rankedCodes.has(c))
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  // Not ranked → no rank at all, rather than a position among sites it cannot be
  // compared with. The score and the delta still stand: the site did the work.
  const idx = ordered.findIndex(([c]) => c === code);
  const rank = ranked && idx >= 0 ? idx + 1 : null;
  const of = ordered.length;

  // delta = the delta of the FIRST row whose label folds to this code. A mean of
  // deltas is as meaningless as a mean of ranks; missing/absent → null (0 stays 0).
  let delta = null;
  for (const row of rows) {
    if (aliases.assetLabelToCode(row.site) === code) {
      delta = row.delta != null ? row.delta : null;
      break;
    }
  }

  return { score, rank, of, delta, ranked };
}

module.exports = { effortForSite };
