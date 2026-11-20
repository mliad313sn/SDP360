'use strict';
// Vue Groupe (Site Awareness fleet grid) overall verdict, extracted from routes/siteAwareness.js (P11 r6 F-26).
// overall = mean of the scored cells (green 2 · amber 1 · red 0) → ≥ 75 % green, ≥ 50 % amber, else red; 'na' cells are
// not scored. A cell may carry `cap` ('amber' | 'red'): the overall verdict can never read better than that cap — the
// helpdesk cell sets it from its open-overdue band (services/siteHelpdeskSla.fleetCell), so a site drowning in open
// overdue tickets cannot average back to green behind four green modules. Display only (bands PROPOSED, G06).
const ORD = { red: 0, amber: 1, green: 2 };

function rollupRag(cells) {
  const list = Object.values(cells || {});
  const scored = list.map((c) => c && c.rag).filter((r) => r === 'green' || r === 'amber' || r === 'red').map((r) => ORD[r]);
  if (!scored.length) return 'na';
  const pct = (scored.reduce((a, b) => a + b, 0) / scored.length) / 2;
  let rag = pct >= 0.75 ? 'green' : (pct >= 0.5 ? 'amber' : 'red');
  for (const c of list) {
    if (c && (c.cap === 'amber' || c.cap === 'red') && ORD[c.cap] < ORD[rag]) rag = c.cap;
  }
  return rag;
}

module.exports = { rollupRag };
