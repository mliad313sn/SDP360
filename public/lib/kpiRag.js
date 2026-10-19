/* Step 3 (SDP-DASH-2.0) — the single registry of RAG colour policies (UMD: Node + browser).
 *
 * This file DOES NOT CHANGE ANY COLOUR. Each policy reproduces, value for value, a scale that
 * already exists in the code (the `source` field says where). Server modules read their
 * thresholds from here; the fidelity / golden tests prove nothing moved.
 * Merging these 10 scales into ≤ 3 is a COMMITTEE decision (docs/design/ETAPE-03-kpi.md,
 * impact table: tools/metrics/rag-impact.js) — never edit a value here without that decision.
 *
 * Kinds:
 *   fixed   green ≥ g, amber ≥ a (value in the policy's own scale: 0-100 or 0-1)
 *   target  green ≥ target, amber ≥ target × ratio      (target given per call)
 *   margin  green ≥ target, amber ≥ target − margin     (target given per call)
 * classify() returns 'green' | 'amber' | 'red', or null when there is nothing to colour
 * (no value, or a target policy without a usable target). Callers map to their own vocabulary
 * (GREEN / orange …) — that vocabulary is part of each screen's contract.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KpiRag = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var POLICIES = {
    programme_score:     { kind: 'fixed', g: 70, a: 45, scale: 100, source: 'services/siteScore.js (IT Review sbDims, authoritative)' },
    composite:           { kind: 'fixed', g: 75, a: 55, scale: 100, source: 'services/siteComposite.js (IT Review composite, authoritative)' },
    scoreboard:          { kind: 'fixed', g: 75, a: 55, scale: 100, source: 'services/siteScoreboard.js' },
    meetings_compliance: { kind: 'fixed', g: 0.80, a: 0.60, scale: 1, source: 'public/meetings-insights.html (5 Engagements heatmap / leaderboard)' },
    tracker_site:        { kind: 'fixed', g: 65, a: 55, scale: 100, source: 'public/activity-tracker/App.jsx (site leaderboard) — frozen file, documented only' },
    tracker_activity:    { kind: 'fixed', g: 0.90, a: 0.75, scale: 1, source: 'public/activity-tracker/engine.js + tracker-pptx.js — frozen; PROD still runs g = 1.00 until the unfreeze' },
    sla_pct:             { kind: 'fixed', g: 90, a: 85, scale: 100, source: 'public/analyze-lite.js (slaCompGood / slaCompWarn)' },
    availability_target: { kind: 'target', ratio: 0.9, source: 'services/merakiWanQuality.js statusColor (WAN % time up, report cell + WAN Health)' },
    opm_availability:    { kind: 'margin', margin: 2, source: 'services/opmAvailability.js statusColor (LAN / Wi-Fi / servers)' },
    wan_sla:             { kind: 'target', ratio: 1, source: 'services/wanSla.js (contract target, e.g. SILVER 97 %: met or not)' },
  };

  function classify(policyKey, value, target) {
    var p = POLICIES[policyKey];
    if (!p) throw new Error('unknown RAG policy: ' + policyKey);
    if (value == null || value === '' || !isFinite(Number(value))) return null;
    var v = Number(value);
    if (p.kind === 'fixed') return v >= p.g ? 'green' : v >= p.a ? 'amber' : 'red';
    if (target == null || target === '') return null;
    var t = Number(target);
    if (!isFinite(t)) return null;
    if (p.kind === 'target') {
      if (t <= 0) return null;
      return v >= t ? 'green' : v >= t * p.ratio ? 'amber' : 'red';
    }
    if (p.kind === 'margin') return v >= t ? 'green' : v >= t - p.margin ? 'amber' : 'red';
    throw new Error('unknown policy kind: ' + p.kind);
  }

  /** Thresholds of a fixed policy, for screens that print them ("G≥70 A45"). */
  function bands(policyKey) {
    var p = POLICIES[policyKey];
    if (!p) throw new Error('unknown RAG policy: ' + policyKey);
    return p.kind === 'fixed' ? { green: p.g, amber: p.a, scale: p.scale } : null;
  }

  return { POLICIES: POLICIES, classify: classify, bands: bands };
}));
