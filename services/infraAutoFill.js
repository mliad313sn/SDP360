'use strict';
// V1b-C (moved out of server.js for P4/B9) — the weekly report's infrastructure prefill, computed for ONE report:
// the OPManager/Meraki snapshots of the report's site and Zoho week → fill descriptors. Shared by
// GET /api/reports/:id/infra-auto (what the editor shows) and PUT /api/reports/:id/infra (what the server
// verifies before it records a "Meraki"/"OpManager" provenance). Nothing is persisted here.
//
// WAN availability in the report cell = the snapshot's CALIBRATED "% Time Up" (loss >= 5 % per sample = down,
// calibrated against Meraki on 2026-09-04) — the SAME primary figure the WAN Health dashboard shows (audit
// 2026-09-05 F9, decision 2026-09-06). The poller's EVENT-based figure rides along as `event_pct` only.

async function computeInfraAuto(rdb, report, cfg) {
  const { buildFills } = require('./opmReportFill');
  const staleDays = parseInt(cfg.opm_stale_days, 10) || 9;
  const start = report.start_date;                       // Zoho Sunday = weeks.start_date
  const wan = await rdb.getWanSnapshots({ site_id: report.site_id, period_type: 'week', period_start: start });
  const infra = await rdb.getInfraSnapshots({ site_id: report.site_id, period_type: 'week', period_start: start });

  // The report cell covers the report's OWN week (fixed & reproducible). Exposed so the editor can cross-check
  // Meraki without Custom: "Past Week" opened the day AFTER this week ends is the same period.
  let winFrom = null, winTo = null;
  for (const u of wan) {
    const ps = u.period_start || null, pe = u.period_end || u.period_start || null;
    if (ps && (!winFrom || ps < winFrom)) winFrom = ps;
    if (pe && (!winTo || pe > winTo)) winTo = pe;
  }
  const window = (winFrom && winTo)
    ? { from: winFrom, to: winTo, days: Math.round((Date.parse(winTo) - Date.parse(winFrom)) / 86400000) + 1 }
    : null;

  for (const u of wan) { u.avail_event_pct = null; if (u.availability_pct != null) u.basis = 'timeup'; }
  if (wan.length && cfg.wan_poll_last_run) {
    let wanTarget = 98; try { const t = JSON.parse(cfg.opm_targets || '{}'); if (t && t.wan != null) wanTarget = Number(t.wan); } catch (_) { /* default */ }
    let minFrom = null, maxTo = null;
    for (const u of wan) {
      const f = (u.period_start || '') + 'T00:00:00Z'; if (u.period_start && (!minFrom || f < minFrom)) minFrom = f;
      const end = u.period_end || u.period_start; const tt = (end || '') + 'T23:59:59Z'; if (end && (!maxTo || tt > maxTo)) maxTo = tt;
    }
    let outages = [];
    if (minFrom && maxTo) { try { outages = (await rdb.getWanOutagesOverlapping(minFrom, maxTo)) || []; } catch (_) { outages = []; } }
    const wanFirstRunMs = cfg.wan_poll_first_run ? Date.parse(cfg.wan_poll_first_run) : null;
    // the event figure is computed on CLONES so the snapshot's primary %/colour/trend stay untouched
    const clones = wan.map(u => ({ ...u }));
    require('./wanEventAvailability').applyEventAvailability(clones, outages, {
      target: wanTarget, minFromMs: (wanFirstRunMs && Number.isFinite(wanFirstRunMs)) ? wanFirstRunMs : undefined });
    clones.forEach((c, i) => { wan[i].avail_event_pct = (c.availability_pct == null) ? null : c.availability_pct; });
  }

  const fills = buildFills({ wan, infra, staleDays, nowMs: Date.now() });
  // Per-site sub-site tokens (Exploration) — the client token-gates its line matching with them.
  const tokens = ((await rdb.listWanSubsiteNetworks()) || []).filter(r => r.site_id === report.site_id).map(r => r.sub_site);
  // data_as_of (A-18a): when the snapshots were COLLECTED, null when there is none — never today's date.
  const data_as_of = require('./opmanagerAvailability').dataAsOf(wan, infra);
  return { week_label: report.week_label, period_start: start, window, data_as_of, fills, tokens };
}

module.exports = { computeInfraAuto };
