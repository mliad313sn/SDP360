'use strict';
// Step 3 (SDP-DASH-2.0) — shared pure formulas, so one figure is computed in ONE place.

/** Inspection conformity: findings "ok" ÷ applicable findings (N/A excluded); null when nothing applicable. */
function conformityPct(findingStatus) {
  const fs = Array.isArray(findingStatus) ? findingStatus : [];
  const applicable = fs.filter(x => x.status !== 'na').reduce((a, x) => a + (Number(x.n) || 0), 0);
  const ok = fs.filter(x => x.status === 'ok').reduce((a, x) => a + (Number(x.n) || 0), 0);
  return applicable > 0 ? Math.round((100 * ok) / applicable) : null;
}

module.exports = { conformityPct };
