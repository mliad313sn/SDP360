'use strict';

// Pure: rows = [{ site, open_incidents, has_active_mi, overdue_open }] →
// exception-only list [{ code, name, status, open_incidents }], major first,
// max 4. Only major/degraded are emitted (operational sites are omitted).
function deriveSiteStatus(rows, opts = {}) {
  const cap = opts.cap || 4;
  const out = [];
  for (const r of rows || []) {
    let status = 'operational';
    if (r.has_active_mi) status = 'major';
    else if ((r.overdue_open || 0) >= 1) status = 'degraded';
    if (status === 'operational') continue;
    out.push({ code: r.code || r.site, name: r.name || r.site, status, open_incidents: r.open_incidents || 0 });
  }
  const rank = { major: 0, degraded: 1 };
  out.sort((a, b) => rank[a.status] - rank[b.status] || b.open_incidents - a.open_incidents);
  return out.slice(0, cap);
}

function buildExecSummary(d) {
  const sites = deriveSiteStatus(d.siteRows || []);
  const level = d.activeMajorIncidents > 0 || sites.some(s => s.status === 'major')
    ? 'major'
    : (sites.some(s => s.status === 'degraded') ? 'degraded' : 'operational');
  const hl = (d.editorial && d.editorial.highlights) || [];
  const fc = (d.editorial && d.editorial.focus) || [];
  const pick = (o, keys) => { const r = {}; for (const k of keys) if (o && o[k] != null) r[k] = o[k]; return r; };
  return {
    data_as_of: d.dataAsOf || null,
    period: d.period,
    status: { level, active_major_incidents: d.activeMajorIncidents || 0 },
    kpis: {
      requests_resolved: pick(d.helpdesk.requests_resolved, ['value','delta_pct']),
      sla_compliance:    pick(d.helpdesk.sla_compliance,    ['value_pct','delta_pp']),
      avg_resolution_h:  pick(d.helpdesk.avg_resolution_h,  ['value','delta_h']),
      csat:              pick(d.helpdesk.csat,              ['value_pct','delta_pp']),
      change_success:    pick(d.helpdesk.change_success,    ['value_pct','delta_pp']),
      spark: { sla: (d.spark && d.spark.sla) || [], csat: (d.spark && d.spark.csat) || [] },
    },
    sites_attention: sites,
    all_sites_ok: sites.length === 0,
    planned_maintenance: (d.upcomingMaintenance || []).slice(0, 3).map(m =>
      pick(m, ['date','title','window','impact','scope'])),
    strategic_progress: d.strategic || { overall_pct: 0, pillars: [] },
    highlights: hl.length ? hl : null,
    focus_areas: fc.length ? fc : null,
  };
}

// ── Live-data glue (Task 5) ─────────────────────────────────────────────────
// loadExecSummary(deps) wires the pure buildExecSummary assembler to the REAL
// readers in reports-db.js + the faithful tracker scorers in tracker-pptx.js.
// Dependencies are INJECTED (deps.rdb / deps.trackerDb / deps.trackerScore) so
// the mappers below stay unit-testable against stubs.
//
// PII discipline: every mapper carries forward ONLY the whitelisted, aggregate
// fields the assembler needs. Ticket subjects, requester/technician names,
// verbatims, raw survey scores etc. are consumed here and NEVER forwarded.

// --- period math -----------------------------------------------------------
function _ym(y, m) { return `${y}-${String(m).padStart(2, '0')}`; }
function _monthStart(y, m) { return `${_ym(y, m)}-01`; }
function _prevMonth(y, m) { return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }; }
function _num(v) { return (v == null || isNaN(v)) ? null : Number(v); }
function _round(v) { return v == null ? null : Math.round(v); }

// mapHelpdeskKpis — fleet-wide monthly helpdesk history + change + survey +
// avg-resolution readers → the assembler's helpdesk{...} sub-objects.
function mapHelpdeskKpis(rdb, now) {
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const prev = _prevMonth(y, m);
  const out = {
    requests_resolved: {},
    sla_compliance: {},
    avg_resolution_h: {},
    csat: {},
    change_success: {},
  };

  // ── Requests resolved + SLA compliance (fleet-wide, month-over-month) ─────
  // getMonthlyHelpdeskHistory rows carry 'Requests', 'Closed Requests Count',
  // and '% of SLA Violated' per calendar month, oldest→newest. The last two
  // rows are current + previous month.
  try {
    const hist = rdb.getMonthlyHelpdeskHistory(13) || [];
    const cur = hist[hist.length - 1] || {};
    const pv  = hist[hist.length - 2] || {};
    const curClosed = _num(cur['Closed Requests Count']);
    const pvClosed  = _num(pv['Closed Requests Count']);
    out.requests_resolved.value = curClosed;
    if (curClosed != null && pvClosed != null && pvClosed > 0) {
      out.requests_resolved.delta_pct = Math.round((curClosed - pvClosed) / pvClosed * 100);
    }
    // SLA compliance % = 100 - violation%
    const curSla = _num(cur['% of SLA Violated']);
    const pvSla  = _num(pv['% of SLA Violated']);
    if (curSla != null) out.sla_compliance.value_pct = _round(100 - curSla);
    if (curSla != null && pvSla != null) {
      out.sla_compliance.delta_pp = _round((100 - curSla) - (100 - pvSla));
    }
  } catch (e) { console.warn('[execSummary] helpdesk history failed:', e.message); }

  // ── Avg resolution hours (fleet-wide) — two point-in-month reads ──────────
  // getRequestMetrics({since}) returns avg_resolution_hrs for closed tickets
  // created since the given date. We approximate a month value with a
  // since=<month-1st> read; delta_h = current - previous.
  try {
    const curM = rdb.getRequestMetrics({ since: _monthStart(y, m) }) || {};
    const pvM  = rdb.getRequestMetrics({ since: _monthStart(prev.y, prev.m) }) || {};
    const cur = _num(curM.avg_resolution_hrs);
    const pv  = _num(pvM.avg_resolution_hrs);
    if (cur != null) out.avg_resolution_h.value = _round(cur);
    if (cur != null && pv != null) out.avg_resolution_h.delta_h = _round(cur - pv);
  } catch (e) { console.warn('[execSummary] avg resolution failed:', e.message); }

  // ── CSAT % (fleet) — satisfied (overall_score>=80) / responses ────────────
  // getSurveyKpisDB({yr,mo}).rows1 = current-period scores;
  // .rows2 = trailing window with responded_on (YYYY-MM-DD). We compute the
  // current-month CSAT from rows1 and the previous-month CSAT from rows2.
  try {
    const cur = _csatFromRows1(rdb.getSurveyKpisDB({ yr: y, mo: m }));
    const pvKey = _ym(prev.y, prev.m);
    const pvPct = _csatForMonthFromRows2(rdb.getSurveyKpisDB({ yr: y, mo: m }), pvKey);
    if (cur != null) out.csat.value_pct = cur;
    if (cur != null && pvPct != null) out.csat.delta_pp = cur - pvPct;
  } catch (e) { console.warn('[execSummary] csat failed:', e.message); }

  // ── Change success rate (fleet) — current vs previous month ───────────────
  try {
    const curC = rdb.getChangeMetrics({ since: _monthStart(y, m) }) || {};
    const pvC  = rdb.getChangeMetrics({ since: _monthStart(prev.y, prev.m) }) || {};
    const cur = _num(curC.change_success_rate);
    const pv  = _num(pvC.change_success_rate);
    if (cur != null) out.change_success.value_pct = _round(cur);
    if (cur != null && pv != null) out.change_success.delta_pp = _round(cur - pv);
  } catch (e) { console.warn('[execSummary] change success failed:', e.message); }

  return out;
}

// CSAT % from rows1 (period-scoped raw scores). Returns rounded % or null.
function _csatFromRows1(kpi) {
  const rows = (kpi && kpi.rows1) || [];
  let n = 0, sat = 0;
  for (const r of rows) { const s = _num(r.overall_score); if (s == null) continue; n++; if (s >= 80) sat++; }
  return n > 0 ? Math.round(sat / n * 100) : null;
}
// CSAT % for a specific YYYY-MM bucket from rows2 (trend window).
function _csatForMonthFromRows2(kpi, ymKey) {
  const rows = (kpi && kpi.rows2) || [];
  let n = 0, sat = 0;
  for (const r of rows) {
    const mon = r.responded_on ? String(r.responded_on).substring(0, 7) : null;
    if (mon !== ymKey) continue;
    const s = _num(r.overall_score); if (s == null) continue;
    n++; if (s >= 80) sat++;
  }
  return n > 0 ? Math.round(sat / n * 100) : null;
}

// mapSpark — trailing sparkline arrays for the KPI mini-charts.
//  spark.sla  = last 6 months of (100 - SLA-violated%)  from getSlaTrendDB
//  spark.csat = last 6 months of monthly CSAT%           from getSurveyKpisDB rows2
function mapSpark(rdb, now) {
  const out = { sla: [], csat: [] };
  const y = now.getFullYear(), m = now.getMonth() + 1;
  try {
    const trend = rdb.getSlaTrendDB(6) || [];
    out.sla = trend.slice(-6).map(r => _round(100 - _num(r['% of SLA Violated']))).filter(v => v != null);
  } catch (e) { console.warn('[execSummary] spark sla failed:', e.message); }
  try {
    const kpi = rdb.getSurveyKpisDB({ yr: y, mo: m });
    const byMonth = {};
    for (const r of (kpi && kpi.rows2) || []) {
      const mon = r.responded_on ? String(r.responded_on).substring(0, 7) : null;
      const s = _num(r.overall_score);
      if (!mon || s == null) continue;
      if (!byMonth[mon]) byMonth[mon] = { n: 0, sat: 0 };
      byMonth[mon].n++; if (s >= 80) byMonth[mon].sat++;
    }
    out.csat = Object.keys(byMonth).sort()
      .map(k => Math.round(byMonth[k].sat / byMonth[k].n * 100))
      .slice(-6);
  } catch (e) { console.warn('[execSummary] spark csat failed:', e.message); }
  return out;
}

// mapSiteRows — per-site point-in-time open/overdue counts + active-MI flag →
// the assembler's siteRows[] (deriveSiteStatus then emits exception-only).
function mapSiteRows(rdb, now) {
  const rows = [];
  let sites = [];
  try { sites = rdb.listSites() || []; } catch (e) { console.warn('[execSummary] listSites failed:', e.message); }

  // Sites carrying an active (open) Major Incident — union across all groups.
  const miSites = new Set();
  try {
    const allGroups = [];
    for (const s of sites) {
      if (!s.zoho_group) continue;
      s.zoho_group.split(',').map(g => g.trim()).filter(Boolean).forEach(g => allGroups.push(g));
    }
    const mis = allGroups.length ? (rdb.getActiveMajorIncidentsForSite(allGroups) || []) : [];
    for (const mi of mis) { if (mi && mi.site) miSites.add(String(mi.site).trim().toLowerCase()); }
  } catch (e) { console.warn('[execSummary] active MI failed:', e.message); }

  for (const s of sites) {
    let open = 0, overdue = 0;
    try {
      // Point-in-time (no `since`): currently-open + backlog (open AND overdue).
      const m = rdb.getRequestMetrics({ site: s.name }) || {};
      open    = _num(m.incident_count) != null ? _num(m.incident_count) : (_num(m.open_count) || 0);
      overdue = _num(m.backlog_count) || 0;
    } catch (e) { console.warn('[execSummary] site metrics failed for', s.name, e.message); }
    rows.push({
      site: s.name,
      code: s.name,
      name: s.name,
      open_incidents: open || 0,
      has_active_mi: miSites.has(String(s.name).trim().toLowerCase()),
      overdue_open: overdue || 0,
    });
  }
  return rows;
}

// mapActiveMi — total count of currently-open Major Incidents across the fleet.
function mapActiveMi(rdb) {
  try {
    const sites = rdb.listSites() || [];
    const allGroups = [];
    for (const s of sites) {
      if (!s.zoho_group) continue;
      s.zoho_group.split(',').map(g => g.trim()).filter(Boolean).forEach(g => allGroups.push(g));
    }
    if (!allGroups.length) return 0;
    const mis = rdb.getActiveMajorIncidentsForSite(allGroups) || [];
    return mis.length;
  } catch (e) { console.warn('[execSummary] mapActiveMi failed:', e.message); return 0; }
}

// mapStrategic — faithful tracker scoring (tracker-pptx.js fleetStats/ps2) →
// { overall_pct, pillars:[{name, pct}] } for the current period across active
// sites. fleetStats.avg / ps2 return 0-1 fractions → ×100 to percent.
function mapStrategic(trackerDb, trackerScore, now) {
  const out = { overall_pct: 0, pillars: [] };
  if (!trackerDb || !trackerScore) return out;
  try {
    const D = trackerDb.loadTracker();
    if (!D) return out;
    const sites = (D.activeSites && D.activeSites.length) ? D.activeSites : (D.sites || []);
    if (!sites.length) return out;
    // Score the CURRENT period. The tracker is a manually-entered dataset whose
    // own current period is D.year/D.currentMonth; prefer that over the wall
    // clock so we score the latest month operators actually filled in.
    const yr = D.year || now.getFullYear();
    const mo = D.currentMonth || (now.getMonth() + 1);

    const fleet = trackerScore.fleetStats(D, sites, yr, mo);
    out.overall_pct = Math.round((fleet && fleet.avg != null ? fleet.avg : 0) * 100);

    // Pillar list: prefer gP(D) (activities-derived), else pillarWeights keys.
    let pillars = [];
    if (typeof trackerScore.gP === 'function') {
      try { pillars = trackerScore.gP(D) || []; } catch (_) { pillars = []; }
    }
    if (!pillars.length && D.pillarWeights) pillars = Object.keys(D.pillarWeights);

    for (const p of pillars) {
      // ps2 is per-site; average across active sites for the fleet pillar score.
      let sum = 0, n = 0;
      for (const s of sites) { const v = trackerScore.ps2(D, s, p, yr, mo); if (v != null && !isNaN(v)) { sum += v; n++; } }
      out.pillars.push({ name: p, pct: n > 0 ? Math.round(sum / n * 100) : 0 });
    }
  } catch (e) { console.warn('[execSummary] strategic failed:', e.message); }
  return out;
}

function loadExecSummary(deps) {
  const now = deps.now || new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let dataAsOf = null;
  try { dataAsOf = deps.rdb.getLastSyncAt('requests'); } catch (_) { dataAsOf = null; }
  const helpdesk = mapHelpdeskKpis(deps.rdb, now);
  const spark = mapSpark(deps.rdb, now);
  const siteRows = mapSiteRows(deps.rdb, now);
  const activeMajorIncidents = mapActiveMi(deps.rdb, now);
  let upcomingMaintenance = [];
  try { upcomingMaintenance = deps.rdb.getUpcomingChanges(7) || []; } catch (_) { upcomingMaintenance = []; }
  const strategic = mapStrategic(deps.trackerDb, deps.trackerScore, now);
  let editorial = { highlights: [], focus: [] };
  try { editorial = deps.rdb.getExecEditorial(period) || editorial; } catch (_) {}
  return buildExecSummary({
    period, dataAsOf, helpdesk, spark, siteRows,
    activeMajorIncidents, upcomingMaintenance, strategic, editorial,
  });
}

module.exports = {
  deriveSiteStatus,
  buildExecSummary,
  loadExecSummary,
  // exported to ease unit testing
  mapHelpdeskKpis,
  mapSpark,
  mapSiteRows,
  mapActiveMi,
  mapStrategic,
};
