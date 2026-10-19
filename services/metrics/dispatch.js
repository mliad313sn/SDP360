'use strict';
// Step 3 (SDP-DASH-2.0) — GET /api/metrics/:key serves a registry entry by calling the EXISTING
// reader named in its `serve` field (no formula re-implemented here). Readers are injected so the
// dispatch is testable without a database. Every reader may return a Promise (postgres) — awaited.
const registry = require('./registry');
const { conformityPct } = require('./formulas');

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

/**
 * @param {string} key
 * @param {{site:{site_id,code}, window}} ctx   site already resolved (meetings code + site_id)
 * @param {object} deps  readers: getCalendarMonthlyHelpdesk, getSiteHelpdeskWindow, getSiteChangesWindow,
 *                       getSiteMonthlyMeetingSummary, getInspectionAggregate, getEffortLeaderboard, effortForSite
 */
async function computeMetric(key, ctx, deps) {
  const def = registry.get(key);
  if (!def) return { status: 404, error: 'unknown metric' };
  if (!def.serve) return { status: 422, error: 'documented only — this figure is shown by its own screen (see source)', metric: def };
  const { site, window: w } = ctx;
  let value = null, window = { from: w.from, to: w.to };
  switch (def.serve) {
    case 'helpdesk_month': {
      const r = await deps.getCalendarMonthlyHelpdesk(site.site_id, w.year, w.month);
      const b = monthBounds(`${w.year}-${pad2(w.month)}`); window = { from: b.from, to: b.to };
      value = r ? val(r[FIELD[key]]) : null; break;
    }
    case 'helpdesk_window': { const r = await deps.getSiteHelpdeskWindow(site.site_id, w.from, w.to); value = r ? val(r[FIELD[key]]) : null; break; }
    case 'changes_window': { const r = await deps.getSiteChangesWindow(site.site_id, w.from, w.to); value = r ? val(r[FIELD[key]]) : null; break; }
    case 'meetings_month': {
      const r = await deps.getSiteMonthlyMeetingSummary(site.code, w.year, w.month);
      const b = monthBounds(`${w.year}-${pad2(w.month)}`); window = { from: b.from, to: b.to };
      value = r && r.kpis ? val(r.kpis[FIELD[key]]) : null; break;
    }
    case 'inspections_window': {
      const r = (await deps.getInspectionAggregate({ site: site.code, from: w.from, to: w.to })) || {};
      if (key === 'inspections.conformity_pct') value = conformityPct(r.findingStatus);
      else if (key === 'inspections.done') value = r.counts ? val(r.counts.total) : null;
      else value = val(r[FIELD[key]]);
      break;
    }
    case 'assets_effort': {
      const board = await deps.getEffortLeaderboard({ asOf: w.to });
      const e = deps.effortForSite(site.code, { leaderboard: board });
      value = e ? e.score : null; window = { from: w.to, to: w.to }; break;
    }
    default: return { status: 500, error: 'no reader for ' + def.serve };
  }
  return { status: 200, key, site: site.code, window, value, unit: def.unit, policy: def.policy,
    measured: value != null };
}

module.exports = { computeMetric, resolveWindow, monthBounds, FIELD };
