'use strict';

/**
 * services/siteScoreboard.js — PURE per-site operational scoreboard composer.
 *
 * A weighted composite of 4 dimensions (helpdesk / inspections / meetings /
 * assets), each a number 0-100 OR null. Weights are renormalized over the
 * dimensions actually PRESENT (non-null), so a partial dataset still yields a
 * fair score rather than being penalised for missing dims. No DB, no I/O —
 * deterministic and unit-testable.
 */

const WEIGHTS = { helpdesk: 0.40, inspections: 0.20, meetings: 0.20, assets: 0.20 };
const DIMS = Object.keys(WEIGHTS);
// Thresholds live in the RAG policy registry (public/lib/kpiRag.js, policy 'scoreboard').
const { bands: _ragBands, classify: _ragClassify } = require('../public/lib/kpiRag');
const { green: G, amber: A } = _ragBands('scoreboard');

const clamp = (v) => (v == null ? null : Math.max(0, Math.min(100, Number(v))));
const ragOf = (s) => (s == null ? null : _ragClassify('scoreboard', s));

/**
 * Score one row over the present dims with renormalized weights.
 * @returns {{score:number|null, dims:object, coverage:{present:number,total:number}, applicable:boolean}}
 */
function scoreOne(row) {
  const present = [];
  const dims = {};
  for (const d of DIMS) {
    const v = clamp(row ? row[d] : null);
    if (v == null) {
      dims[d] = null;
    } else {
      dims[d] = { value: v, rag: ragOf(v) };
      present.push({ d, v });
    }
  }
  let wsum = 0;
  let dot = 0;
  for (const { d, v } of present) {
    wsum += WEIGHTS[d];
    dot += WEIGHTS[d] * v;
  }
  const score = present.length ? Math.round(dot / wsum) : null;
  return {
    score,
    dims,
    coverage: { present: present.length, total: DIMS.length },
    applicable: present.length > 0,
  };
}

/**
 * @param {Array<{code,name,helpdesk,inspections,meetings,assets}>} perSite
 * @param {{prev?:Object}} opts prev = map code → perSite-shaped inputs (previous window)
 * @returns {{rows:Array, fleet_avg:number|null, most_improved:object|null, needs_attention:object|null}}
 */
function buildSiteScoreboard(perSite, { prev } = {}) {
  const prevMap = prev || {};
  const rows = (perSite || []).map((row) => {
    const one = scoreOne(row);
    let delta = null;
    if (Object.prototype.hasOwnProperty.call(prevMap, row.code) && prevMap[row.code]) {
      const prevScore = scoreOne(prevMap[row.code]).score;
      if (one.score != null && prevScore != null) delta = one.score - prevScore;
    }
    return {
      code: row.code,
      name: row.name,
      score: one.score,
      rag: ragOf(one.score),
      applicable: one.applicable,
      dims: one.dims,
      coverage: one.coverage,
      delta,
    };
  });

  // Rank: applicable rows by score desc then code asc; non-applicable appended, rank null.
  const applicable = rows.filter((r) => r.applicable);
  const nonApplicable = rows.filter((r) => !r.applicable);
  applicable.sort((a, b) => (b.score - a.score) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  applicable.forEach((r, i) => { r.rank = i + 1; });
  nonApplicable.forEach((r) => { r.rank = null; });
  const ordered = [...applicable, ...nonApplicable];

  const fleet_avg = applicable.length
    ? Math.round(applicable.reduce((a, r) => a + r.score, 0) / applicable.length)
    : null;

  // most_improved: applicable row with max delta where delta > 0.
  let most_improved = null;
  for (const r of applicable) {
    if (r.delta != null && r.delta > 0) {
      if (!most_improved || r.delta > most_improved.delta) most_improved = r;
    }
  }

  // needs_attention: lowest-scoring applicable row with score < A (red); tie → code asc.
  let needs_attention = null;
  for (const r of applicable) {
    if (r.score != null && r.score < A) {
      if (!needs_attention
        || r.score < needs_attention.score
        || (r.score === needs_attention.score && r.code < needs_attention.code)) {
        needs_attention = r;
      }
    }
  }

  return { rows: ordered, fleet_avg, most_improved, needs_attention };
}

module.exports = { buildSiteScoreboard, WEIGHTS };
