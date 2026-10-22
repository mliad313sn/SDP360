'use strict';
// Step 3 (SDP-DASH-2.0) — shared pure formulas, so one figure is computed in ONE place.

/** Inspection conformity: findings "ok" ÷ applicable findings (N/A excluded); null when nothing applicable. */
function conformityPct(findingStatus) {
  const fs = Array.isArray(findingStatus) ? findingStatus : [];
  const applicable = fs.filter(x => x.status !== 'na').reduce((a, x) => a + (Number(x.n) || 0), 0);
  const ok = fs.filter(x => x.status === 'ok').reduce((a, x) => a + (Number(x.n) || 0), 0);
  return applicable > 0 ? Math.round((100 * ok) / applicable) : null;
}

/**
 * Survey satisfaction from overall scores (0-100): satisfied = score ≥ 80 (the rule /api/survey/kpis has always
 * used). Returns the numerators so a group total is Σsatisfied ÷ Σn, never a mean of percentages.
 */
function csatFromScores(scores) {
  let n = 0, satisfied = 0, promoters = 0, passives = 0, detractors = 0, sum = 0;
  for (const raw of scores || []) {
    const s = Number(raw);
    if (raw == null || !Number.isFinite(s)) continue;
    n++; sum += s;
    if (s >= 80) satisfied++;
    if (s >= 90) promoters++; else if (s >= 70) passives++; else detractors++;
  }
  const npsBase = promoters + passives + detractors;
  return {
    n, satisfied, promoters, passives, detractors, sum,
    csat_pct: n > 0 ? Math.round((satisfied / n) * 100) : null,
    nps: npsBase > 0 ? Math.round(((promoters - detractors) / npsBase) * 100) : null,
    avg: n > 0 ? Math.round((sum / n) * 10) / 10 : null,
  };
}

module.exports = { conformityPct, csatFromScores };
