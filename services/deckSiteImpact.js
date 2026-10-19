'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Slide 7 — "Site Impact Analysis" (which sites move the needle).
//
// PURE composer. Turns per-site helpdesk counts for the report month into the
// two charts + four highlight cards of the OPS manager's board deck:
//   • Chart 1 "Missed deadlines vs workload": each site's SHARE of fleet missed
//     resolution-SLA vs its SHARE of fleet tickets (a site missing far more than
//     its workload share is the stretched one — Sabodala 44% of misses / 20% load).
//   • Chart 2 "Incidents as share of site tickets": incident% per site vs the
//     fleet average (Ity 99.3% on-time is the proof-it-can-be-done site).
//   • Four cards: most-stretched · under-dual-pressure · proof · the-prize.
//
// The QUANTITATIVE part is auto-derived here; the human framing (card captions,
// operating context, footer prose) is editorial (deck decision: deterministic
// defaults + editable). `asOf`/counts are injected → unit-testable without a DB.
// ─────────────────────────────────────────────────────────────────────────────

function _pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : null; }   // 1-decimal %
function _median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param {Array} perSite  [{code, name, tickets, missed, closed, on_time, incidents}]
 *   missed = missed-resolution-SLA count; on_time = closed within SLA count.
 * @param {object} [opts]  { prizeDeltaPP } — fleet on-time Δ vs prev month (editorial).
 * @returns {object} { rows, missBars, incidentBars, fleet_incident_pct, cards }
 */
function buildSiteImpact(perSite, opts = {}) {
  const sites = (perSite || []).filter((s) => s && (s.tickets || 0) > 0);
  const fleetTickets = sites.reduce((a, s) => a + (s.tickets || 0), 0);
  const fleetMissed = sites.reduce((a, s) => a + (s.missed || 0), 0);
  const fleetIncidents = sites.reduce((a, s) => a + (s.incidents || 0), 0);

  const rows = sites.map((s) => ({
    code: s.code, name: s.name || s.code,
    tickets: s.tickets || 0,
    workload_pct: _pct(s.tickets || 0, fleetTickets) || 0,
    miss_pct: _pct(s.missed || 0, fleetMissed) || 0,
    ontime_pct: (s.closed || 0) ? _pct(s.on_time || 0, s.closed || 0) : null,
    incident_pct: _pct(s.incidents || 0, s.tickets || 0) || 0,
  }));

  const fleet_incident_pct = _pct(fleetIncidents, fleetTickets) || 0;
  const missBars = [...rows].sort((a, b) => b.miss_pct - a.miss_pct)
    .map((r) => ({ code: r.code, name: r.name, miss_pct: r.miss_pct, workload_pct: r.workload_pct }));
  const incidentBars = [...rows].sort((a, b) => b.incident_pct - a.incident_pct)
    .map((r) => ({ code: r.code, name: r.name, incident_pct: r.incident_pct, above: r.incident_pct > fleet_incident_pct }));

  // Card auto-selection.
  const medVol = _median(rows.map((r) => r.tickets));
  const stretched = missBars[0] || null;                                   // biggest miss share
  const dual = incidentBars[0] || null;                                    // highest incident share
  const eligProof = rows.filter((r) => r.ontime_pct != null && r.tickets >= medVol);
  const proof = eligProof.sort((a, b) => b.ontime_pct - a.ontime_pct)[0] || null;   // best on-time at scale

  const cards = {
    most_stretched: stretched && {
      code: stretched.code, name: stretched.name,
      caption: stretched.miss_pct + '% of misses on ' + stretched.workload_pct + '% of workload',
    },
    under_dual_pressure: dual && {
      code: dual.code, name: dual.name,
      caption: dual.incident_pct + '% of its tickets are incidents (fleet ' + fleet_incident_pct + '%)',
    },
    proof: proof && {
      code: proof.code, name: proof.name,
      caption: proof.tickets + ' tickets · ' + proof.ontime_pct + '% on time',
    },
    the_prize: {
      value: (opts.prizeDeltaPP != null ? (opts.prizeDeltaPP >= 0 ? '+' : '') + opts.prizeDeltaPP + 'pp' : '—'),
      caption: 'fleet on-time month-over-month',
    },
  };

  return { rows, missBars, incidentBars, fleet_incident_pct, cards };
}

module.exports = { buildSiteImpact };
