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
  // Active Major Incidents — whitelisted operational detail (title/impact/
  // status/root-cause/corrective-action/downtime). Public per the 2026-07-02
  // decision (option a); personal fields were already dropped in mapMajorIncidents.
  const majorIncidents = (d.majorIncidents || []).map(mi =>
    pick(mi, ['title', 'site', 'status', 'impact', 'root_cause', 'corrective_action', 'downtime_h']));
  return {
    data_as_of: d.dataAsOf || null,
    period: d.period,
    report_month: d.reportMonth || null,   // the last COMPLETE month the KPIs reflect
    status: { level, active_major_incidents: d.activeMajorIncidents || 0 },
    major_incidents: majorIncidents.length ? majorIncidents : null,
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
    // whitelist focus entry keys so the public payload shape is strictly
    // predictable (mirrors planned_maintenance) — admin-authored, not PII.
    focus_areas: fc.length ? fc.map(f => pick(f, ['title', 'subtitle'])) : null,
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
  // Anchor to the LAST COMPLETE calendar month, not the current one: on the
  // 1st of a month the current month has ~1 day of data and reads as -98% /
  // near-empty. "ref" = previous month (last complete); "prev" = the one before.
  const ref  = _prevMonth(now.getFullYear(), now.getMonth() + 1);
  const prev = _prevMonth(ref.y, ref.m);
  const out = {
    requests_resolved: {},
    sla_compliance: {},
    avg_resolution_h: {},
    csat: {},
    change_success: {},
  };

  // ── Requests resolved + SLA compliance (fleet-wide, month-over-month) ─────
  // getMonthlyHelpdeskHistory rows carry 'Requests', 'Closed Requests Count',
  // and '% of SLA Violated' per calendar month, oldest→newest. The LAST row is
  // the current (partial) month, so the last COMPLETE month is [len-2] and the
  // month before it is [len-3].
  try {
    const hist = rdb.getMonthlyHelpdeskHistory(13) || [];
    const cur = hist[hist.length - 2] || {};
    const pv  = hist[hist.length - 3] || {};
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
    const curM = rdb.getRequestMetrics({ since: _monthStart(ref.y, ref.m) }) || {};
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
    const kpi = rdb.getSurveyKpisDB({ yr: ref.y, mo: ref.m });
    const cur = _csatFromRows1(kpi);
    const pvPct = _csatForMonthFromRows2(kpi, _ym(prev.y, prev.m));
    if (cur != null) out.csat.value_pct = cur;
    if (cur != null && pvPct != null) out.csat.delta_pp = cur - pvPct;
  } catch (e) { console.warn('[execSummary] csat failed:', e.message); }

  // ── Change success rate (fleet) — current vs previous month ───────────────
  try {
    const curC = rdb.getChangeMetrics({ since: _monthStart(ref.y, ref.m) }) || {};
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

// Normalise a site label for matching: strip accents + case + surrounding space.
// request_records.site carries free-form mine names with case AND accent drift
// (Houndé vs HOUNDE, Massawa vs MASSAWA), so a plain toLowerCase() would miss a
// real Major Incident and render the site as operational. Accent-fold guards
// the common cases. (One-off suffix drift like "LAFIGUE - SML" remains a known
// limitation — a shared site-alias helper would be the fuller fix.)
const _normSite = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

// _activeMIs — active (open) Major Incidents across all site groups. One fetch
// feeds the MI detail block, the site rollup, and the active count.
function _activeMIs(rdb) {
  try {
    const sites = rdb.listSites() || [];
    const groups = [];
    for (const s of sites) {
      if (!s.zoho_group) continue;
      String(s.zoho_group).split(',').map(g => g.trim()).filter(Boolean).forEach(g => groups.push(g));
    }
    if (!groups.length) return [];
    return rdb.getActiveMajorIncidentsForSite(groups) || [];
  } catch (e) { console.warn('[execSummary] active MI fetch failed:', e.message); return []; }
}

// mapMajorIncidents — whitelist active-MI rows to PUBLIC-SAFE detail for the
// exec page (title/impact/status/root-cause/corrective-action/downtime).
// Personal fields (technician, requester, ids) are DROPPED here.
function mapMajorIncidents(mis) {
  return (mis || []).map(m => ({
    title:             m.subject || '—',
    site:              m.site || '—',
    status:            m.status || 'In progress',
    impact:            m.impact || null,
    root_cause:        (m.rca && String(m.rca).trim()) || null,
    corrective_action: (m.ca && String(m.ca).trim()) || null,
    downtime_h:        (m.downtime && String(m.downtime).trim()) || null,
  }));
}

// mapSiteRows — MAJOR-INCIDENT-centric rollup: a site appears only if it has an
// active Major Incident; open_incidents = count of active MIs there. Raw ticket
// volume is intentionally NOT shown (execs care about MIs, not the full
// backlog). deriveSiteStatus then marks each site 'major'.
function mapSiteRows(mis) {
  const byCode = {};
  for (const m of (mis || [])) {
    const key = _normSite(m.site);
    if (!key) continue;
    if (!byCode[key]) byCode[key] = { code: m.site, name: m.site, count: 0 };
    byCode[key].count++;
  }
  return Object.values(byCode).map(s => ({
    site: s.name, code: s.code, name: s.name,
    open_incidents: s.count, has_active_mi: true, overdue_open: 0,
  }));
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
    const startMo = D.currentMonth || (now.getMonth() + 1);
    // Use the most recent month with real data: walk back from the tracker's
    // current month to the last one with a non-zero fleet score, so a not-yet-
    // filled current month (e.g. the 1st) doesn't render the roadmap as 0%.
    let mo = startMo;
    let fleet = trackerScore.fleetStats(D, sites, yr, startMo);
    if (!(fleet && fleet.avg > 0)) {
      for (let mm = startMo - 1; mm >= 1; mm--) {
        const f = trackerScore.fleetStats(D, sites, yr, mm);
        if (f && f.avg > 0) { fleet = f; mo = mm; break; }
      }
    }
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

// NOTE (v1 = sqlite only): the mappers call reports-db readers synchronously.
// Under REPORTS_BACKEND=postgres those readers return Promises, so this path
// would need a pg fork (await the readers). TODO(pg) when reports.db cuts over.
function loadExecSummary(deps) {
  const now = deps.now || new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const ref = _prevMonth(now.getFullYear(), now.getMonth() + 1);   // last complete month
  const reportMonth = _ym(ref.y, ref.m);
  let dataAsOf = null;
  try { dataAsOf = deps.rdb.getLastSyncAt('requests'); } catch (_) { dataAsOf = null; }
  const helpdesk = mapHelpdeskKpis(deps.rdb, now);
  const spark = mapSpark(deps.rdb, now);
  const mis = _activeMIs(deps.rdb);              // one fetch → detail + rollup + count
  const majorIncidents = mapMajorIncidents(mis);
  const siteRows = mapSiteRows(mis);
  const activeMajorIncidents = mis.length;
  let upcomingMaintenance = [];
  try { upcomingMaintenance = deps.rdb.getUpcomingChanges(7) || []; } catch (_) { upcomingMaintenance = []; }
  const strategic = mapStrategic(deps.trackerDb, deps.trackerScore, now);
  let editorial = { highlights: [], focus: [] };
  try { editorial = deps.rdb.getExecEditorial(period) || editorial; } catch (_) {}
  return buildExecSummary({
    period, reportMonth, dataAsOf, helpdesk, spark, siteRows, majorIncidents,
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
  mapMajorIncidents,
  mapStrategic,
};
