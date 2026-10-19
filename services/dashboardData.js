'use strict';
// Step 6/9 — the ONE widget resolver. Every figure a dashboard, a report pack, an alert rule or an
// external feed shows comes through here → the metric registry → the registered reader. Extracted
// from routes/dashboards.js in Step 9 so report generation reuses exactly the dashboard figures
// (acceptance: "zero figure deviation" between the screen and the pack). No formula here.
const R = require('../public/lib/dashboardRender');

function ragOverride(rag, value) {
  const KpiRag = require('./kpiRag');
  if (value == null) return 'NA';
  try { return typeof rag === 'string' ? KpiRag.rag(Number(value), rag) : (Number(value) >= rag.green ? 'GREEN' : Number(value) >= rag.amber ? 'AMBER' : 'RED'); } catch (_) { return 'NA'; }
}

async function actionsFor(rdb, siteId, plan) {
  const codes = await rdb.listSiteModuleCodes('meetings');
  const row = (codes || []).find(c => Number(c.site_id) === Number(siteId));
  if (!row) return { items: [], totals: { open: 0 }, note: 'site has no meetings/inspection code' };
  const code = row.code;
  const { buildSiteActions } = require('./siteActionsRegister');
  const mdb = require('../meetings-db'), idb = require('../inspection-db');
  const asOf = new Date().toISOString().slice(0, 10);
  const meetings = plan.sources.includes('meetings') ? await mdb.listActions({ site: code }) : [];
  const inspection = plan.sources.includes('inspection') ? await idb.listActions({ site: code }) : [];
  const report = plan.sources.includes('report') ? { actions: (await rdb.getSiteOpenReportActions(siteId)).actions } : null;
  const sa = buildSiteActions({ meetings, inspection, report, asOf });
  const items = [];
  for (const g of ['meetings', 'incubation', 'inspection', 'report']) for (const it of (sa.groups[g] && sa.groups[g].items) || []) if (!plan.onlyOverdue || it.overdue) items.push({ source: g, ...it });
  items.sort((a, b) => (b.overdue - a.overdue) || ((b.age_days || 0) - (a.age_days || 0)));
  return { items: items.slice(0, 50), totals: sa.totals, site_code: code };
}

/**
 * Resolve every widget of a dashboard definition for one site.
 * @param {object} o { def, sites:[{id,name}] (caller's scope), site (id), window, reg, dd (reader deps), rdb, now }
 * @returns {object} widgets keyed by widget id — same shape the viewer renders.
 */
async function resolveWidgets({ def, sites, site, window = null, reg, dd, rdb, now = new Date() }) {
  const out = {};
  for (const w of (def && def.widgets) || []) {
    const m = w.metric ? reg.get(w.metric) : null;
    const plan = R.widgetDataPlan(w, m && m.window_kind);
    try {
      if (plan.mode === 'single' && m) {
        const one = await reg.resolve(w.metric, { site: m.reader === 'tracker.fleet' ? null : site, window, deps: dd, now });
        let fleet = null;
        if (plan.compare && m.reader !== 'tracker.fleet') {
          const vals = [];
          for (const s of sites) { const r = await reg.resolve(w.metric, { site: Number(s.id), window, deps: dd, now }); if (r && r.value != null) vals.push(Number(r.value)); }
          fleet = vals.length ? { mean: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10, n: vals.length } : null;
        }
        out[w.id] = { mode: 'single', metric: w.metric, title: w.title, unit: m.unit, value: one.value, rag: w.rag ? ragOverride(w.rag, one.value) : one.rag, window: one.window, as_of: one.as_of, fleet, error: one.error || null };
      } else if (plan.mode === 'series' && m) {
        const labels = R.windowSeries(plan.kind, plan.n, now);
        const points = [];
        for (const lab of labels) { const r = await reg.resolve(w.metric, { site: m.reader === 'tracker.fleet' ? null : site, window: lab, deps: dd, now }); points.push({ label: lab, value: r ? r.value : null }); }
        out[w.id] = { mode: 'series', metric: w.metric, title: w.title, unit: m.unit, points, as_of: now.toISOString() };
      } else if (plan.mode === 'per-site' && m) {
        const rows = [];
        for (const s of sites) { const r = await reg.resolve(w.metric, { site: Number(s.id), window, deps: dd, now }); rows.push({ site_id: Number(s.id), site: s.name, value: r ? r.value : null, rag: w.rag ? ragOverride(w.rag, r && r.value) : (r ? r.rag : 'NA') }); }
        rows.sort((a, b) => (a.value == null) - (b.value == null) || (a.value - b.value));
        out[w.id] = { mode: 'per-site', metric: w.metric, title: w.title, unit: m.unit, rows, summary: R.summarizeGrid(rows), as_of: now.toISOString() };
      } else if (plan.mode === 'actions') {
        out[w.id] = { mode: 'actions', title: w.title, ...(await actionsFor(rdb, site, plan)) };
      } else out[w.id] = { mode: 'none', title: w.title, markdown: w.markdown };
    } catch (e) { out[w.id] = { mode: plan.mode, title: w.title, error: String(e.message || e).slice(0, 200), value: null }; }
  }
  return out;
}

module.exports = { resolveWidgets, ragOverride, actionsFor };
