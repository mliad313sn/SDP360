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

module.exports = { deriveSiteStatus, buildExecSummary };
