'use strict';
// Step 3 (SDP-DASH-2.0) — GET /api/metrics/:key serves a registry entry by calling the EXISTING
// reader named in its `serve` field (no formula re-implemented here). Readers are injected so the
// dispatch is testable without a database. Every reader may return a Promise (postgres) — awaited.
//
// Step 6 (lot 6.2) adds three things on the same readers:
//   • GROUP scope — the figure for the whole fleet, rebuilt from each site's NUMERATORS and
//     DENOMINATORS (Σ on-time ÷ Σ closed). A mean of site percentages would weight a 3-ticket site
//     like a 300-ticket one, so it is never used where a ratio exists (GROUP_RULE says which rule).
//   • SERIES — the same figure over N consecutive weeks or months (13-week trends).
//   • rag — the colour from public/lib/kpiRag.js, computed here so every screen agrees.
const registry = require('./registry');
const { conformityPct, csatFromScores } = require('./formulas');
const KpiRag = require('../../public/lib/kpiRag');

const pad2 = n => String(n).padStart(2, '0');
function monthBounds(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { year: y, month: mo, from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${pad2(last)}` };
}
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/** Window from the query: ?month=YYYY-MM (default: current month) or ?from=&to=. */
function resolveWindow(q, now = new Date()) {
  if (q && (q.from || q.to)) {
    if (!isDate(q.from) || !isDate(q.to) || q.from > q.to) return { error: 'from/to must be YYYY-MM-DD with from <= to' };
    return { from: q.from, to: q.to, year: Number(q.to.slice(0, 4)), month: Number(q.to.slice(5, 7)) };
  }
  const mon = q && q.month ? q.month : `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}`;
  const b = monthBounds(mon);
  return b || { error: 'month must be YYYY-MM' };
}

const FIELD = {
  'helpdesk.inbound': 'inbound', 'helpdesk.closed': 'closed', 'helpdesk.close_pct': 'close_pct',
  'helpdesk.sla_res_pct': 'sla_res_pct', 'helpdesk.sla_reply_pct': 'sla_reply_pct',
  'helpdesk.backlog': 'backlog', 'helpdesk.sla_overdue': 'sla_overdue', 'helpdesk.major_incidents': 'major_incidents',
  'changes.total': 'total', 'changes.success_pct': 'success_pct',
  'meetings.pvs_held': 'pvs_held', 'meetings.depts_with_pv': 'depts_with_pv', 'meetings.open_issues': 'open_issues',
  'meetings.high_open': 'high_open', 'meetings.resolved_month': 'resolved_month', 'meetings.escalations_open': 'escalations_open',
  'inspections.done': 'done', 'inspections.open_actions': 'open_actions', 'inspections.overdue_actions': 'overdue_actions',
};
const val = v => (v === undefined ? null : v);
const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : null);
const mean = xs => { const v = xs.filter(x => x != null && Number.isFinite(Number(x))).map(Number); return v.length ? Math.round((10 * v.reduce((a, x) => a + x, 0)) / v.length) / 10 : null; };

// The helpdesk "month" figures have a window-shaped twin, so they also exist per week (series). The
// first-response SLA has no window reader (the window block carries no response timestamps).
const HELPDESK_WINDOW_TWIN = {
  'helpdesk.inbound': r => r.created, 'helpdesk.closed': r => r.resolved,
  'helpdesk.close_pct': r => pct(num(r.resolved), num(r.created)), 'helpdesk.sla_res_pct': r => r.sla_res_pct,
};

/** How each served figure is totalled for the whole fleet — shown in the KPI dictionary. */
const GROUP_RULE = {
  helpdesk_month: 'Σ over sites; percentages rebuilt from the summed numerators and denominators.',
  helpdesk_window: 'Σ over sites; the resolution SLA rebuilt from Σ on-time ÷ Σ closed.',
  changes_window: 'Σ over sites; success rate = Σ successful ÷ Σ executed.',
  meetings_month: 'Σ over sites.',
  inspections_window: 'Σ over sites; conformity = Σ compliant ÷ Σ applicable findings.',
  assets_effort: 'Mean of the measured site scores (scores carry no asset count to weight by).',
  survey_month: 'Σ satisfied ÷ Σ rated responses over every site’s support groups.',
  meetings_engagements: 'Mean of the measured site scores (each site’s engagements are scored on its own PVs).',
  wan_period: 'Mean % time up of every measured uplink of every site.',
};

/** The site-level component record of a served figure (raw reader output, normalised). */
async function fetchRecord(def, site, w, deps) {
  switch (def.serve) {
    case 'helpdesk_month': return (await deps.getCalendarMonthlyHelpdesk(site.site_id, w.year, w.month)) || null;
    case 'helpdesk_window': return (await deps.getSiteHelpdeskWindow(site.site_id, w.from, w.to)) || null;
    case 'changes_window': return (await deps.getSiteChangesWindow(site.site_id, w.from, w.to)) || null;
    case 'meetings_month': {
      if (!site.code) return null;
      const r = await deps.getSiteMonthlyMeetingSummary(site.code, w.year, w.month);
      return r && r.kpis ? r.kpis : null;
    }
    case 'inspections_window': {
      if (!site.code) return null;
      return (await deps.getInspectionAggregate({ site: site.code, from: w.from, to: w.to })) || {};
    }
    case 'assets_effort': {
      if (!site.code) return null;
      const board = await deps.getEffortLeaderboard({ asOf: w.to });
      const e = deps.effortForSite(site.code, { leaderboard: board });
      return { score: e ? e.score : null };
    }
    case 'survey_month': {
      const groups = await deps.getSiteGroups(site.site_id);
      if (!groups.length) return null;   // a site with no support group has no survey scope
      const r = await deps.getSurveyKpisDB({ yr: w.year, mo: w.month, groups });
      return csatFromScores(((r && r.rows1) || []).map(x => x.overall_score));
    }
    case 'meetings_engagements': {
      if (!site.code) return null;
      const r = await deps.meetingsInsights({ from: w.from, to: w.to, site: site.code });
      const row = ((r && r.site_leaderboard) || []).find(x => x.site === site.code);
      return { score: row && row.score != null ? Math.round(1000 * row.score) / 10 : null };   // 0-1 → %
    }
    case 'wan_period': {
      const monthly = w.from.slice(8) === '01' && monthBounds(w.from.slice(0, 7)).to === w.to;
      const rows = (await deps.getWanSnapshots({ site_id: site.site_id, period_type: monthly ? 'month' : 'week' })) || [];
      // A Meraki week starts on Sunday (Zoho week): it covers a Monday window when it starts the day before.
      const dayBefore = new Date(Date.parse(w.from + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
      const hit = rows.filter(r => (monthly ? r.period_start === w.from : r.period_start >= dayBefore && r.period_start <= w.to));
      return { uplinks: hit.map(r => (r.availability_pct == null ? null : Number(r.availability_pct))) };
    }
    default: throw new Error('no reader for ' + def.serve);
  }
}

/** The site value of a figure from its record (null = not measured). */
function siteValue(key, def, r) {
  if (!r) return null;
  switch (def.serve) {
    case 'inspections_window':
      if (key === 'inspections.conformity_pct') return conformityPct(r.findingStatus);
      if (key === 'inspections.done') return r.counts ? val(r.counts.total) : null;
      return val(r[FIELD[key]]);
    case 'assets_effort': case 'meetings_engagements': return r.score;
    case 'survey_month': return key === 'helpdesk.nps' ? r.nps : r.csat_pct;
    case 'wan_period': return mean(r.uplinks);
    case 'helpdesk_window': if (r.__twin) return val(HELPDESK_WINDOW_TWIN[key](r)); return val(r[FIELD[key]]);
    default: return val(r[FIELD[key]]);
  }
}

/** The group value of a figure from every site's record. */
function groupValue(key, def, recs) {
  const R = recs.filter(Boolean);
  if (!R.length) return null;
  const S = f => R.reduce((a, r) => a + num(f(r)), 0);
  switch (def.serve) {
    case 'helpdesk_month': {
      const inbound = S(r => r.inbound), closed = S(r => r.closed);
      switch (key) {
        case 'helpdesk.inbound': return inbound;
        case 'helpdesk.closed': return closed;
        case 'helpdesk.close_pct': return pct(closed, inbound);
        case 'helpdesk.sla_res_pct': return pct(S(r => r.sla_res_ok), closed);
        case 'helpdesk.sla_reply_pct': return pct(S(r => r.sla_reply_ok), S(r => r.sla_reply_total));
      }
      return null;
    }
    case 'helpdesk_window': {
      if (R[0].__twin) {
        const created = S(r => r.created), resolved = S(r => r.resolved);
        if (key === 'helpdesk.inbound') return created;
        if (key === 'helpdesk.closed') return resolved;
        if (key === 'helpdesk.close_pct') return pct(resolved, created);
        return pct(S(r => r.sla_res_ok), resolved);
      }
      return S(r => r[FIELD[key]]);
    }
    case 'changes_window':
      return key === 'changes.success_pct' ? pct(S(r => r.successful), S(r => r.executed)) : S(r => r.total);
    case 'meetings_month': return S(r => r[FIELD[key]]);
    case 'inspections_window': {
      if (key === 'inspections.conformity_pct') {
        const by = {};
        for (const r of R) for (const x of r.findingStatus || []) by[x.status] = (by[x.status] || 0) + num(x.n);
        return conformityPct(Object.entries(by).map(([status, n]) => ({ status, n })));
      }
      if (key === 'inspections.done') return S(r => (r.counts ? r.counts.total : 0));
      return S(r => r[FIELD[key]]);
    }
    case 'survey_month': {
      const n = S(r => r.n);
      if (key === 'helpdesk.nps') {
        const base = S(r => r.promoters) + S(r => r.passives) + S(r => r.detractors);
        return base > 0 ? Math.round((100 * (S(r => r.promoters) - S(r => r.detractors))) / base) : null;
      }
      return pct(S(r => r.satisfied), n);
    }
    case 'assets_effort': case 'meetings_engagements': return mean(R.map(r => r.score));
    case 'wan_period': return mean([].concat(...R.map(r => r.uplinks || [])));
    default: return null;
  }
}

/** RAG colour of a value under the figure's policy (null when the figure is not coloured). */
function ragFor(def, value, targets) {
  if (!def.policy || value == null) return null;
  const p = KpiRag.POLICIES[def.policy];
  if (!p) return null;
  const scaled = p.kind === 'fixed' && p.scale === 1 && def.unit === '%' ? value / 100 : value;
  let target = null;
  if (p.kind !== 'fixed') target = def.policy === 'availability_target' ? (targets && targets.wan) : (targets && targets[def.key]);
  return KpiRag.classify(def.policy, scaled, target);
}

function windowOf(def, w) {
  if (def.serve === 'helpdesk_month' || def.serve === 'meetings_month' || def.serve === 'survey_month') {
    const b = monthBounds(`${w.year}-${pad2(w.month)}`); return { from: b.from, to: b.to };
  }
  return { from: w.from, to: w.to };
}

function served(key) {
  const def = registry.get(key);
  if (!def) return { status: 404, error: 'unknown metric' };
  if (!def.serve) return { status: 422, error: 'documented only — this figure is shown by its own screen (see source)', metric: def };
  return { def };
}

/**
 * One figure for one site.
 * @param {{site:{site_id,code}, window}} ctx   site already resolved (meetings code + site_id)
 */
async function computeMetric(key, ctx, deps) {
  const s = served(key); if (!s.def) return s;
  const { def } = s, { site, window: w } = ctx;
  const value = siteValue(key, def, await fetchRecord(def, site, w, deps));
  return { status: 200, key, site: site.code, window: windowOf(def, w), value, unit: def.unit, policy: def.policy,
    rag: ragFor(def, value, ctx.targets), measured: value != null };
}

/**
 * One figure for the whole fleet. `sites` = every active site {site_id, code|null} — a site without a
 * code in the meetings namespace still counts for the helpdesk / changes / WAN figures.
 */
async function computeGroupMetric(key, ctx, deps) {
  const s = served(key); if (!s.def) return s;
  const { def } = s, { sites, window: w } = ctx;
  const recs = [];
  for (const site of sites) recs.push(await fetchRecord(def, site, w, deps));
  const value = groupValue(key, def, recs);
  return { status: 200, key, scope: 'group', sites: sites.length, measured_sites: recs.filter(r => r && siteValue(key, def, r) != null).length,
    window: windowOf(def, w), value, unit: def.unit, policy: def.policy, rag: ragFor(def, value, ctx.targets),
    group_rule: GROUP_RULE[def.serve] || null, measured: value != null };
}

/** The N windows of a series ending with the week / month that contains `asOf` (UTC, Monday weeks). */
function seriesWindows(grain, points, asOf) {
  const out = [], d = new Date(Date.parse(String(asOf).slice(0, 10) + 'T00:00:00Z'));
  if (grain === 'month') {
    for (let i = points - 1; i >= 0; i--) {
      const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
      const b = monthBounds(`${m.getUTCFullYear()}-${pad2(m.getUTCMonth() + 1)}`);
      out.push({ ...b, label: b.from.slice(0, 7), partial: i === 0 });
    }
    return out;
  }
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  for (let i = points - 1; i >= 0; i--) {
    const a = new Date(monday); a.setUTCDate(monday.getUTCDate() - 7 * i);
    const b = new Date(a); b.setUTCDate(a.getUTCDate() + 6);
    const from = a.toISOString().slice(0, 10), to = b.toISOString().slice(0, 10);
    // ISO week number of the Thursday of that week.
    const th = new Date(a); th.setUTCDate(a.getUTCDate() + 3);
    const y0 = new Date(Date.UTC(th.getUTCFullYear(), 0, 1));
    const wk = Math.ceil(((th - y0) / 86400000 + 1) / 7);
    out.push({ from, to, year: Number(to.slice(0, 4)), month: Number(to.slice(5, 7)), label: `W${pad2(wk)}`, partial: i === 0 });
  }
  return out;
}

/** Can this figure be computed on an arbitrary week? (monthly-only readers cannot) */
function seriesPlan(key, def, grain) {
  if (grain === 'month') return { def };
  if (def.serve === 'helpdesk_month') {
    if (!HELPDESK_WINDOW_TWIN[key]) return { error: 'this figure exists per month only (no weekly reader)' };
    return { def: { ...def, serve: 'helpdesk_window' }, twin: true };
  }
  if (def.serve === 'meetings_month' || def.serve === 'survey_month' || def.serve === 'assets_effort')
    return { error: 'this figure exists per month only (no weekly reader)' };
  return { def };
}

/**
 * The same figure over consecutive windows. ctx: { scope:'site'|'group', site | sites, grain, points, asOf, targets }.
 */
async function computeSeries(key, ctx, deps) {
  const s = served(key); if (!s.def) return s;
  const plan = seriesPlan(key, s.def, ctx.grain);
  if (plan.error) return { status: 422, error: plan.error };
  const { def } = plan, wins = seriesWindows(ctx.grain, ctx.points, ctx.asOf);
  const points = [];
  for (const w of wins) {
    const mark = r => (r && plan.twin ? { ...r, __twin: true } : r);
    let value;
    if (ctx.scope === 'group') {
      const recs = [];
      for (const site of ctx.sites) recs.push(mark(await fetchRecord(def, site, w, deps)));
      value = groupValue(key, def, recs);
    } else value = siteValue(key, def, mark(await fetchRecord(def, ctx.site, w, deps)));
    points.push({ label: w.label, from: w.from, to: w.to, partial: w.partial, value, rag: ragFor(s.def, value, ctx.targets) });
  }
  return { status: 200, key, scope: ctx.scope, site: ctx.scope === 'site' ? ctx.site.code : undefined, grain: ctx.grain,
    unit: s.def.unit, policy: s.def.policy, points, measured: points.some(p => p.value != null) };
}

module.exports = {
  computeMetric, computeGroupMetric, computeSeries, seriesWindows, resolveWindow, monthBounds, ragFor,
  fetchRecord, siteValue, groupValue, FIELD, GROUP_RULE,
};
