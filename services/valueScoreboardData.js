'use strict';
// D2 (P10) — Value scoreboard readers (I/O half). Every reading is best-effort: a reader that throws or whose module is
// off leaves its metric UNKNOWN with the reason in `why` — never 0, never a 500. All SQL is read-only.
//   gather(deps, { allowed, today, cfg }) → readings for services/valueScoreboard.assemble
//   allowed = null (every site — super_admin) or an array of site ids (the reader's perimeter).

const V = require('./valueScoreboard');
const DAY = 864e5;
const _iso = (ms) => new Date(ms).toISOString().slice(0, 10);

async function _safe(why, key, fn) {
  try { return await fn(); } catch (e) { why[key] = 'source unreadable: ' + String(e && e.message || e).slice(0, 120); return null; }
}

async function gather(deps, { allowed = null, today = _iso(Date.now()), cfg = {} } = {}) {
  const rdb = deps.rdb; const H = rdb.pgHandle();
  const why = {};
  const t = Date.parse(today + 'T00:00:00Z');
  const from90 = _iso(t - 90 * DAY);

  const report = await _safe(why, 'report', async () => {
    const WV = require('./weeklyReportValue');
    const { timingRows } = await WV.loadWeeklyValue(H, { from: from90, to: today, siteIds: allowed });
    const tm = WV.composeTiming(timingRows, { dueDays: cfg.weekly_report_due_days, now: t });
    if (!tm.overall.reports) { why.report = 'no weekly report in the last 90 days'; return null; }
    return { ...tm.overall, by_site: tm.by_site.map((s) => ({ site_id: s.site_id, site_name: s.site_name, reports: s.reports, on_time_pct: s.on_time_pct, median_minutes: s.median_minutes })) };
  });

  const actions = await _safe(why, 'actions', async () => {
    const codes = async (module) => new Map(((await rdb.listSiteModuleCodes(module)) || []).map((r) => [String(r.code), { id: Number(r.site_id), name: r.name }]));
    const mc = await codes('meetings'), ic = await codes('inspection');
    const { TERMINAL } = require('./siteActionsRegister');
    const md = await H.prepare(`SELECT m.site_code, a.status, a.target_date AS due, a.created_at FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id`).all();
    const ins = await H.prepare(`SELECT i.site_code, a.status, a.due_date AS due, a.created_at FROM insp_actions a JOIN insp_inspections i ON i.id = a.inspection_id WHERE i.deleted_at IS NULL`).all();
    const rows = [];
    const open = (src, st) => !TERMINAL[src].has(String(st || '').trim().toLowerCase());
    for (const r of md) { const s = mc.get(String(r.site_code)); rows.push({ site_id: s ? s.id : null, site_name: s ? s.name : null, open: open('meetings', r.status), due: r.due, created_at: r.created_at }); }
    for (const r of ins) { const s = ic.get(String(r.site_code)); rows.push({ site_id: s ? s.id : null, site_name: s ? s.name : null, open: open('inspection', r.status), due: r.due, created_at: r.created_at }); }
    // a site-less action (code mapped to no site) only counts in the super_admin fleet figure
    return V.actionMetrics(allowed == null ? rows : rows.filter((r) => r.site_id != null), { today, allowed });
  });

  const money = await _safe(why, 'money', async () => {
    const h = await require('../assets-db').getHygieneSummary({});
    const total = Number(h && h.total) || 0;
    if (!total) { why.money = 'no asset synchronised'; return null; }
    const noCost = Number(h.by_kind && h.by_kind.no_cost) || 0;
    return { total, coverage_pct: V.pct(total - noCost, total), unknown_pct: V.pct(noCost, total) };
  });

  const repeat = await _safe(why, 'repeat', async () => {
    if (String(cfg.insp_repeat_findings) !== '1') { why.repeat = 'repeat findings are off (report_config insp_repeat_findings = 0)'; return null; }
    const IR = require('./inspectionRepeat');
    const n = IR.parseWindow(cfg.insp_repeat_window);
    if (n == null) { why.repeat = 'no repeat window decided (insp_repeat_window empty)'; return null; }
    const ic = new Map(((await rdb.listSiteModuleCodes('inspection')) || []).map((r) => [String(r.code), { id: Number(r.site_id), name: r.name }]));
    const sites = allowed == null ? null : [...ic.entries()].filter(([, v]) => allowed.includes(v.id)).map(([k]) => k);
    const out = IR.computeRepeatFindings(await require('../inspection-db').listRecentFindings({ sites }), n);
    const list = Object.entries(out.sites || {});
    if (!list.length) { why.repeat = 'no submitted inspection'; return null; }
    const by_site = list.map(([code, s]) => ({ site_id: ic.get(code) ? ic.get(code).id : null, site_name: ic.get(code) ? ic.get(code).name : code, repeats: (s.repeats || []).length }));
    return { n: list.length, value: V.pct(by_site.filter((s) => s.repeats > 0).length, list.length), by_site };
  });

  const decisions = await _safe(why, 'decisions', async () => {
    const decs = await H.prepare(`SELECT id, ref, status, created_at, closed_at FROM decisions ORDER BY id`).all();
    const ev = await H.prepare(`SELECT entity_id, MIN(at) AS done_at FROM ppm_events WHERE entity='decision' AND new_value='done' GROUP BY entity_id`).all();
    const doneAt = new Map(ev.map((e) => [Number(e.entity_id), e.done_at]));
    const rows = decs.map((x) => ({ id: Number(x.id), ref: x.ref, created_at: x.created_at,
      adopted_at: doneAt.get(Number(x.id)) || (x.status === 'done' ? x.closed_at || null : null), adopted_source: doneAt.has(Number(x.id)) ? 'ppm_events' : 'closed_at' }));
    return require('./decisionCycle').cycle(rows, { from: from90, to: today });
  });

  const plans = await _safe(why, 'plans', async () => {
    const projects = await H.prepare(`SELECT id FROM portfolio_projects WHERE deleted_at IS NULL AND COALESCE(status,'') NOT IN ('done','cancelled','closed')`).all();
    if (!projects.length) { why.plans = 'no open project'; return null; }
    const FR = require('./ppm/planFreshness');
    const at = await FR.planUpdatedAt(H, projects.map((p) => p.id));
    return V.planFreshShare(projects.map((p) => FR.freshness(at[Number(p.id)], today)));
  });

  const wau = await _safe(why, 'wau', async () => {
    const rows = await H.prepare(`SELECT actor_id, details FROM system_log WHERE category = 'ux' AND action = 'page_viewed' AND ts >= ?`).all(new Date(t - 6 * DAY).toISOString().slice(0, 10));
    const PU = require('./pageUsage');
    const tierOf = (d) => { try { const o = typeof d === 'string' ? JSON.parse(d) : d; return (o && (PU.TIERS.includes(o.tier) || o.tier === 'feature-only')) ? o.tier : 'unknown'; } catch (_) { return 'unknown'; } };
    const w = V.wauByTier(rows, { tierOf });
    if (!w.total) { why.wau = 'no page_viewed event in the last 7 days'; return null; }
    return w;
  });

  const csat = await _safe(why, 'csat', async () => {
    const d = new Date(t); const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear(); const m = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
    const r = await rdb.getSurveyKpisDB({ yr: y, mo: m });
    const c = V.csat(((r && r.rows1) || []).map((x) => x.overall_score));
    if (!c.n) { why.csat = 'no scored survey reply in the last complete month'; return null; }
    return c;
  });

  const claims = await _safe(why, 'claims', async () => {
    if (String(cfg.wan_sla_claims_enabled) !== '1') { why.claims = 'WAN SLA claims are off (report_config wan_sla_claims_enabled = 0)'; return null; }
    const W = require('./wanSlaClaims');
    const list = await require('./wanSlaClaimsStore').makeClaimsStore(H).list({});
    const { parseRates } = require('./currency');
    return V.claimsValue(W.valueTotals(list, { rates: parseRates(cfg.asset_currency_rates, cfg.xof_usd_rate), nowMs: t }));
  });

  return { report, actions, money, repeat, decisions, plans, wau, csat, claims, why, perimeter: allowed == null ? { all: true } : { all: false, site_ids: allowed } };
}

module.exports = { gather };
