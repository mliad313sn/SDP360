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

  const ordered = [...folded.entries()]
    .filter(([, s]) => s != null)
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const rank = ordered.findIndex(([c]) => c === code) + 1;
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

  return { score, rank, of, delta };
}

module.exports = { effortForSite };
