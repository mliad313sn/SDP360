'use strict';
// W1-INTEGRITY (W0 engine matrix stub scan, routes/governance.js:138) — the governance agenda's tracker facts.
// A tracker whose scoring THROWS used to be dropped silently from the list (catch {}), so a meeting saw fewer trackers
// and no hint why. It now stays in the list as NOT MEASURED: score null, rag 'NA', reason 'scoring_failed' (+ the
// correlation id of the logged error). A tracker the scorer returns nothing for is not measured either (reason
// 'no_score'). PURE except for the injected functions.
//   trackers  [{ key, name }]
//   deps      { score(key) → { units, fleet } | null (may throw), unitCode: string|null, rag(mean) → string, onError(e) → id }
async function trackerFacts(trackers, { score, unitCode = null, rag = () => 'NA', onError = () => null } = {}) {
  const out = [];
  for (const t of trackers || []) {
    let r;
    try { r = await score(t.key); } catch (e) { out.push({ key: t.key, name: t.name, score: null, rag: 'NA', not_measured: true, reason: 'scoring_failed', correlation_id: onError(e) || null }); continue; }
    if (!r) { out.push({ key: t.key, name: t.name, score: null, rag: 'NA', not_measured: true, reason: 'no_score' }); continue; }
    const u = unitCode && r.units ? r.units[unitCode] : null;
    const mean = r.fleet ? r.fleet.mean : null;
    out.push({ key: t.key, name: t.name, score: u ? u.score : (mean == null ? null : mean), rag: u ? u.rag : (mean == null ? 'NA' : rag(mean)) });
  }
  return out;
}
module.exports = { trackerFacts };
