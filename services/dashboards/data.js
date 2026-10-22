'use strict';
// Step 6 (lot 6.4) — computes the data of every widget of a dashboard definition, for ONE viewer context.
//
//   ctx = { scope: 'group'|'site', site: {site_id, code, name}|null, sites: [{site_id, code, name}], month: 'YYYY-MM',
//           asOf: 'YYYY-MM-DD', targets }
//   deps = { metrics (dispatch readers, services/metrics/liveDeps), readers: {...} }
//
// The scope is decided by the route from the viewer's rights, NEVER by the definition. Every figure comes from
// the KPI dictionary (services/metrics/dispatch) or from an existing reader; each widget is computed apart, so
// one failing widget answers { error } and the others still render. null stays null (not measured ≠ 0).
const registry = require('../metrics/registry');
const D = require('../metrics/dispatch');
const { domainOf } = require('../metrics/freshness');
const KpiRag = require('../../public/lib/kpiRag');

const pad2 = n => String(n).padStart(2, '0');
function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
}
const label = (key) => { const m = registry.get(key); return m ? { fr: m.fr, en: m.en } : { fr: key, en: key }; };
const meta = (key) => { const m = registry.get(key) || {}; return { key, label: label(key), unit: m.unit || '', direction: m.direction || 'higher', policy: m.policy || null, domain: domainOf(m) }; };
const round1 = v => (v == null ? null : Math.round(v * 10) / 10);
const DONE_ISSUE = ['resolved', 'cancelled', 'closed', 'demand', 'helpdesk_ticket'];
const daysBetween = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);

async function one(key, ctx, site, month, deps) {
  const window = D.resolveWindow({ month });
  const c = { site, sites: ctx.sites, window, targets: ctx.targets };
  return site ? D.computeMetric(key, c, deps.metrics) : D.computeGroupMetric(key, c, deps.metrics);
}
const visibleSites = (ctx) => (ctx.scope === 'site' ? [ctx.site] : ctx.sites);

const RESOLVERS = {
  async kpi(w, ctx, deps) {
    const items = [];
    for (const key of w.metrics) {
      const cur = await one(key, ctx, ctx.scope === 'site' ? ctx.site : null, ctx.month, deps);
      const prev = w.compare ? await one(key, ctx, ctx.scope === 'site' ? ctx.site : null, prevMonth(ctx.month), deps) : null;
      const value = cur.status === 200 ? cur.value : null;
      const pv = prev && prev.status === 200 ? prev.value : null;
      items.push({ ...meta(key), value, prev: pv, delta: value != null && pv != null ? round1(value - pv) : null,
        rag: cur.rag || null, window: cur.window || null, error: cur.status === 200 ? null : cur.error });
    }
    return { items, month: ctx.month, prev_month: prevMonth(ctx.month) };
  },

  async trend(w, ctx, deps) {
    const series = [];
    for (const key of w.metrics) {
      const base = { grain: w.grain, points: w.points, asOf: ctx.asOf, targets: ctx.targets };
      const s = ctx.scope === 'site'
        ? await D.computeSeries(key, { ...base, scope: 'site', site: ctx.site }, deps.metrics)
        : await D.computeSeries(key, { ...base, scope: 'group', sites: ctx.sites }, deps.metrics);
      series.push({ ...meta(key), points: s.status === 200 ? s.points : [], error: s.status === 200 ? null : s.error });
    }
    return { grain: w.grain, series };
  },

  async bars(w, ctx, deps) {
    const key = w.metrics[0], rows = [];
    for (const s of visibleSites(ctx)) {
      const r = await one(key, ctx, s, ctx.month, deps);
      rows.push({ code: s.code, name: s.name, value: r.status === 200 ? r.value : null, rag: r.rag || null });
    }
    rows.sort((a, b) => (b.value == null) - (a.value == null) || (b.value || 0) - (a.value || 0) || String(a.name).localeCompare(String(b.name)));
    return { ...meta(key), rows };
  },

  async table(w, ctx, deps) {
    const columns = w.metrics.map(meta);
    const rows = [];
    for (const s of visibleSites(ctx)) {
      const cells = [];
      for (const key of w.metrics) { const r = await one(key, ctx, s, ctx.month, deps); cells.push({ value: r.status === 200 ? r.value : null, rag: r.rag || null }); }
      rows.push({ code: s.code, name: s.name, cells });
    }
    // Order by the first column, measured first.
    rows.sort((a, b) => (b.cells[0].value == null) - (a.cells[0].value == null) || (b.cells[0].value || 0) - (a.cells[0].value || 0));
    let total = null;
    if (ctx.scope === 'group') {
      total = [];
      for (const key of w.metrics) { const r = await one(key, ctx, null, ctx.month, deps); total.push({ value: r.status === 200 ? r.value : null, rag: r.rag || null }); }
    }
    return { columns, rows, total };
  },

  async 'rag-grid'(w, ctx, deps) { return RESOLVERS.table(w, ctx, deps); },

  async heatmap(w, ctx, deps) {
    const key = w.metrics[0], rows = [];
    let labels = null;
    for (const s of visibleSites(ctx)) {
      const r = await D.computeSeries(key, { scope: 'site', site: s, grain: 'month', points: w.points, asOf: ctx.asOf, targets: ctx.targets }, deps.metrics);
      if (r.status !== 200) return { ...meta(key), error: r.error, labels: [], rows: [] };
      labels = labels || r.points.map(p => p.label);
      rows.push({ code: s.code, name: s.name, cells: r.points.map(p => ({ value: p.value, rag: p.rag })) });
    }
    return { ...meta(key), labels: labels || [], rows };
  },

  async tracker(w, ctx, deps) {
    const { trackerDb, trackerScore } = deps.readers;
    const T = await trackerDb.loadTracker();
    if (!T || !Array.isArray(T.activities) || !T.activities.length) return { pillars: [], overall: null, note: 'tracker empty' };
    const all = (T.activeSites && T.activeSites.length) ? T.activeSites : (T.sites || []);
    let sites = all;
    if (ctx.scope === 'site') {
      const row = (await deps.readers.listSites()).find(x => x.id === ctx.site.site_id);
      const code = row ? trackerDb.siteToCode(row) : null;
      sites = code && all.includes(code) ? [code] : [];
    }
    const [y, m] = ctx.month.split('-').map(Number);
    if (!sites.length) return { pillars: [], overall: null, note: 'site not in the tracker' };
    const pillars = [...new Set(T.activities.map(a => a.pillar))];
    const pw = T.pillarWeights || {};
    const pctOf = (p, mo) => mo < 1 ? null : Math.round(100 * sites.reduce((a, s) => a + trackerScore.ps2(T, s, p, y, mo), 0) / sites.length);
    const fleet = trackerScore.fleetStats(T, sites, y, m), fleetPrev = m > 1 ? trackerScore.fleetStats(T, sites, y, m - 1) : null;
    return {
      year: y, month: m,
      overall: fleet ? Math.round(fleet.avg * 100) : null,
      overall_delta: fleet && fleetPrev ? Math.round(fleet.avg * 100) - Math.round(fleetPrev.avg * 100) : null,
      attainment: fleet ? Math.round(fleet.attainment * 100) : null,
      pillars: pillars.map(p => {
        const cur = pctOf(p, m), prev = pctOf(p, m - 1);
        return { name: String(p).replace(/^P\d+\s*-\s*/, ''), weight: pw[p] == null ? null : Number(pw[p]) <= 1 ? Math.round(100 * Number(pw[p])) : Number(pw[p]), pct: cur,   // weights are fractions in the tracker
          rag: cur == null ? null : KpiRag.classify('tracker_site', cur), delta: cur != null && prev != null ? cur - prev : null };
      }),
    };
  },

  async text(w) { return { markdown: w.markdown || '' }; },

  async actions(w, ctx, deps) {
    const { meetingsDb, inspectionDb } = deps.readers, today = ctx.asOf;
    const codes = new Set(visibleSites(ctx).map(s => s.code).filter(Boolean));
    const nameOf = new Map(ctx.sites.map(s => [s.code, s.name]));
    const md = ((await meetingsDb.listActions({ overdue: true })) || []).filter(a => codes.has(String(a.site_code || '').toUpperCase()));
    const ins = ((await inspectionDb.listActions({ overdue: true })) || []).filter(a => codes.has(String(a.site_code || '').toUpperCase()));
    const items = [
      ...md.map(a => ({ source: 'meetings', site: String(a.site_code).toUpperCase(), title: a.description || a.title || '—', due: a.target_date })),
      ...ins.map(a => ({ source: 'inspection', site: String(a.site_code).toUpperCase(), title: a.description || '—', due: a.due_date })),
    ].map(a => ({ ...a, site_name: nameOf.get(a.site) || a.site, days_late: a.due ? Math.max(0, daysBetween(String(a.due).slice(0, 10), today)) : null }));
    const bySite = {};
    for (const a of items) { const b = bySite[a.site] || (bySite[a.site] = { code: a.site, name: a.site_name, overdue: 0, over30: 0 }); b.overdue++; if ((a.days_late || 0) > 30) b.over30++; }
    items.sort((a, b) => (b.days_late || 0) - (a.days_late || 0));
    return { total: items.length, over30: items.filter(a => (a.days_late || 0) > 30).length,
      by_site: Object.values(bySite).sort((a, b) => b.over30 - a.over30 || b.overdue - a.overdue), oldest: items.slice(0, 8) };
  },

  async events(w, ctx, deps) {
    const r = deps.readers;
    const siteRows = await r.listSites();
    const vis = new Set(visibleSites(ctx).map(s => s.site_id));
    const groups = [];
    for (const s of siteRows || []) if (vis.has(s.id) && s.zoho_group) String(s.zoho_group).split(',').map(g => g.trim()).filter(Boolean).forEach(g => groups.push(g));
    const groupSite = new Map();
    for (const s of siteRows || []) String(s.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean).forEach(g => groupSite.set(g, s.name));

    if (w.source === 'incidents') {
      const act = groups.length ? ((await r.getActiveMajorIncidentsForSite(groups)) || []) : [];
      const items = act.map(m => {
        let udf = {}; try { udf = m.udf_json ? JSON.parse(m.udf_json) : {}; } catch (_) {}
        const rca = Object.entries(udf).some(([k, v]) => /root cause/i.test(k) && String(v || '').trim());
        return { state: 'open', title: m.subject || '—', site: groupSite.get(m.tech_group) || m.site || '—', impact: m.impact || null,
          status: m.request_status || null, opened: m.created_time || null,
          age_hours: m.created_time ? Math.max(0, Math.round((Date.parse(ctx.asOf + 'T23:59:59Z') - Date.parse(m.created_time)) / 3600000)) : null,
          rca_done: rca };
      });
      return { open: items.length, items };
    }
    // decisions: Council escalations still open, changes waiting for CAB, actions late by more than 30 days.
    const codes = new Set(visibleSites(ctx).map(s => s.code).filter(Boolean));
    const nameOf = new Map(ctx.sites.map(s => [s.code, s.name]));
    const esc = ((await r.meetingsDb.listIssues({ escalate: true })) || [])
      .filter(i => !DONE_ISSUE.includes(i.status) && codes.has(String(i.site_code || '').toUpperCase()))
      .map(i => ({ kind: 'council', title: i.title || '—', site: nameOf.get(String(i.site_code).toUpperCase()) || i.site_code,
        detail: [i.council_theme, i.department].filter(Boolean).join(' · '), since: i.meeting_date || null,
        age_days: i.meeting_date ? Math.max(0, daysBetween(String(i.meeting_date).slice(0, 10), ctx.asOf)) : null }));
    const groupSet = new Set(groups);
    const cab = ((await r.getPendingCabDecisions()) || []).filter(c => ctx.scope === 'group' || groupSet.has(c.group_name))
      .map(c => ({ kind: 'cab', title: c.subject || c.display_id || '—', site: groupSite.get(c.group_name) || null,
        detail: [c.display_id, c.risk, Number(c.emergency) === 1 ? 'emergency' : null].filter(Boolean).join(' · '),
        since: c.requested_at || null, age_days: c.requested_at ? Math.max(0, daysBetween(String(c.requested_at).slice(0, 10), ctx.asOf)) : null }));
    const late = await RESOLVERS.actions(w, ctx, deps);
    const lateItems = late.by_site.filter(b => b.over30 > 0).map(b => ({ kind: 'late', title: `${b.over30} action(s) late by more than 30 days`,
      site: b.name, detail: `${b.overdue} overdue in all`, since: null, age_days: null, count: b.over30 }));
    const items = [...esc, ...cab, ...lateItems].sort((a, b) => (b.age_days || 0) - (a.age_days || 0));
    return { pending: items.length, council: esc.length, cab: cab.length, late_sites: lateItems.length, items: items.slice(0, 12) };
  },
};

/** Freshness domains a widget reads (to stamp it). */
function domainsOf(w) {
  const set = new Set();
  for (const k of w.metrics || []) { const d = domainOf(registry.get(k)); if (d) set.add(d); }
  if (w.type === 'events') set.add(w.source === 'incidents' ? 'helpdesk' : 'meetings');
  if (w.type === 'events' && w.source === 'decisions') set.add('changes');
  if (w.type === 'actions') { set.add('meetings'); set.add('inspections'); }
  return [...set];
}

/** Every widget's data. Returns { widgets: { [id]: data | {error} } }. */
async function resolveAll(definition, ctx, deps) {
  const widgets = {};
  for (const w of definition.widgets) {
    try { widgets[w.id] = { domains: domainsOf(w), ...(await RESOLVERS[w.type](w, ctx, deps)) }; }
    catch (e) { widgets[w.id] = { domains: domainsOf(w), error: 'This block could not be computed: ' + String(e && e.message || e).slice(0, 200) }; }
  }
  return { widgets };
}

module.exports = { resolveAll, RESOLVERS, prevMonth, domainsOf };
