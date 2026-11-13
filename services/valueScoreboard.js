'use strict';
// D2 (P10) — Value scoreboard, PURE half (no database, no clock unless passed, no I/O).
// One row per metric: { key, label, unit, value, n, state, missing, definition, source, scope, by_site? }.
// Rules (SDP360 boundaries): a metric with no source / no observation is null with state UNKNOWN and a reason —
// never 0; nothing here is a target or a verdict; site rows are filtered to the reader's perimeter by the caller's
// allowed site list (null = every site = super_admin). Amounts (SLA credits) travel only as USD-indicative totals with
// the per-currency note, for the admin-only page.

const DAY = 864e5;
const _ms = (v) => { if (v == null || v === '') return null; const t = v instanceof Date ? v.getTime() : Date.parse(String(v)); return Number.isFinite(t) ? t : null; };
function median(xs) {
  const a = (xs || []).filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round(((a[m - 1] + a[m]) / 2) * 10) / 10;
}
const pct = (a, b) => (b > 0 ? Math.round((1000 * a) / b) / 10 : null);

function row(o) {
  const v = o.value == null || (typeof o.value === 'number' && !Number.isFinite(o.value)) ? null : o.value;
  return { key: o.key, label: o.label, unit: o.unit || null, value: v, n: o.n == null ? null : o.n,
    state: v == null ? 'UNKNOWN' : 'MEASURED', missing: v == null ? (o.missing || 'no observation in the window') : null,
    definition: o.definition, source: o.source, scope: o.scope || 'fleet', ...(o.by_site ? { by_site: o.by_site } : {}), ...(o.extra ? { extra: o.extra } : {}) };
}

/** Open meeting / inspection actions → median age (days) and % overdue, per site and over the allowed perimeter. */
function actionMetrics(rows, { today, allowed = null } = {}) {
  const t = _ms(String(today).slice(0, 10) + 'T00:00:00Z');
  const keep = (rows || []).filter((r) => r && r.open && (allowed == null || allowed.includes(Number(r.site_id))));
  const ages = (list) => list.map((r) => { const c = _ms(r.created_at); return c == null || t == null ? null : Math.max(0, Math.floor((t - c) / DAY)); }).filter((x) => x != null);
  const withDue = (list) => list.filter((r) => /^\d{4}-\d{2}-\d{2}/.test(String(r.due || '')));
  const over = (list) => withDue(list).filter((r) => String(r.due).slice(0, 10) < String(today).slice(0, 10)).length;
  const bySite = new Map();
  for (const r of keep) { const k = r.site_id == null ? null : Number(r.site_id); if (!bySite.has(k)) bySite.set(k, []); bySite.get(k).push(r); }
  const by_site = [...bySite.entries()].filter(([k]) => k != null).map(([site_id, list]) => ({ site_id, site_name: list[0].site_name || null, open: list.length,
    median_age_days: median(ages(list)), overdue_pct: pct(over(list), withDue(list).length) })).sort((a, b) => String(a.site_name).localeCompare(String(b.site_name)));
  return { open: keep.length, median_age_days: median(ages(keep)), overdue_pct: pct(over(keep), withDue(keep).length), with_due: withDue(keep).length, by_site };
}

/** page_viewed rows of the last 7 days → distinct users per role tier (the tier recorded on the day of the view). */
function wauByTier(rows, { tierOf }) {
  const tiers = {}; const all = new Set();
  for (const r of rows || []) {
    if (r.actor_id == null) continue;
    const t = tierOf(r.details); (tiers[t] || (tiers[t] = new Set())).add(Number(r.actor_id)); all.add(Number(r.actor_id));
  }
  const by_tier = {}; for (const [k, s] of Object.entries(tiers)) by_tier[k] = s.size;
  return { total: all.size, by_tier };
}

/** Survey replies (overall_score 0-100) → CSAT % = replies ≥ 80 ÷ replies (the voice-tiles rule). */
function csat(scores) {
  const s = (scores || []).map(Number).filter(Number.isFinite);
  return { n: s.length, value: s.length ? pct(s.filter((x) => x >= 80).length, s.length) : null };
}

/** Open projects with their plan's last update (planFreshness) → % updated within 30 days. */
function planFreshShare(projects) {
  const known = (projects || []).filter((p) => p.plan_updated_days != null);
  return { n: (projects || []).length, known: known.length, value: known.length ? pct(known.filter((p) => p.plan_updated_days < 30).length, known.length) : null };
}

/** wanSlaClaims.valueTotals quarters → summed USD-indicative due / claimed / recovered (null when no rate or no claim). */
function claimsValue(quarters) {
  const q = quarters || [];
  if (!q.length) return { claims: 0, usd: null };
  if (q.some((x) => !x.usd_indicative)) return { claims: q.reduce((t, x) => t + x.claims, 0), usd: null };
  const usd = { due: 0, claimed: 0, recovered: 0 };
  for (const x of q) for (const f of Object.keys(usd)) usd[f] += x.usd_indicative[f];
  for (const f of Object.keys(usd)) usd[f] = Math.round(usd[f] * 100) / 100;
  return { claims: q.reduce((t, x) => t + x.claims, 0), usd };
}

/**
 * readings: each optional — a missing reading becomes UNKNOWN with `why[key]` (or a generic reason).
 * { report, actions, money, repeat, decisions, plans, wau, csat, claims, why, perimeter }
 */
function assemble(rd = {}) {
  const why = rd.why || {};
  const scope = rd.perimeter && rd.perimeter.all ? 'fleet' : 'perimeter';
  const m = [];
  const rep = rd.report;
  m.push(row({ key: 'report_on_time_pct', label: 'Weekly reports on time', unit: '%', value: rep ? rep.on_time_pct : null, n: rep ? rep.on_time_den : null,
    missing: rep ? 'no on-time rule decided (report_config weekly_report_due_days is empty)' : why.report, scope, by_site: rep ? rep.by_site : null,
    definition: 'reports submitted by week end + weekly_report_due_days ÷ reports whose deadline is known (last 90 days)', source: 'services/weeklyReportValue.js (weekly_reports + audit trail)' }));
  m.push(row({ key: 'report_median_minutes', label: 'Weekly report completion time (median)', unit: 'minutes', value: rep ? rep.median_minutes : null, n: rep ? rep.timed : null,
    missing: rep ? 'no report with a first edit and a submission in the window' : why.report, scope,
    definition: 'median minutes from the first edit to the first submission (proxy, not effort)', source: 'services/weeklyReportValue.js' }));
  const ac = rd.actions;
  m.push(row({ key: 'action_median_age_days', label: 'Open actions — median age', unit: 'days', value: ac ? ac.median_age_days : null, n: ac ? ac.open : null,
    missing: ac ? 'no open meeting / inspection action' : why.actions, scope, by_site: ac ? ac.by_site : null,
    definition: 'median days since creation of open meeting + inspection actions (report follow-ups carry no creation time and are left out)', source: 'md_actions + insp_actions (services/siteActionsRegister TERMINAL vocabulary)' }));
  m.push(row({ key: 'action_overdue_pct', label: 'Open actions — overdue', unit: '%', value: ac ? ac.overdue_pct : null, n: ac ? ac.with_due : null,
    missing: ac ? 'no open action carries a due date' : why.actions, scope,
    definition: 'open actions past their due date ÷ open actions with a due date', source: 'md_actions.target_date + insp_actions.due_date' }));
  const mo = rd.money;
  m.push(row({ key: 'asset_cost_coverage_pct', label: 'Assets with a purchase cost', unit: '%', value: mo ? mo.coverage_pct : null, n: mo ? mo.total : null,
    missing: mo ? 'no asset synchronised' : why.money, scope: 'fleet',
    definition: 'assets whose purchase cost is recorded ÷ assets (the rest is UNKNOWN, never valued at 0) — no amount shown', source: 'assets-db getHygieneSummary (no_cost)', extra: mo ? { unknown_pct: mo.unknown_pct } : null }));
  const re = rd.repeat;
  m.push(row({ key: 'repeat_finding_rate', label: 'Inspections with a repeat finding', unit: '%', value: re ? re.value : null, n: re ? re.n : null,
    missing: re ? 'no submitted inspection in the window' : why.repeat, scope, by_site: re ? re.by_site : null,
    definition: 'sites × item codes rated minor / major / critical in ≥ 2 of the site\'s last N inspections ÷ sites with inspections (N = insp_repeat_window)', source: 'services/inspectionRepeat.js' }));
  const de = rd.decisions;
  m.push(row({ key: 'decision_cycle_days', label: 'Decision cycle time (mean)', unit: 'days', value: de ? de.value : null, n: de ? de.n : null,
    missing: de ? 'no decision adopted in the last 90 days' : why.decisions, scope: 'fleet',
    definition: 'mean days from a decision\'s creation to its first move to done (metric governance.decision_cycle_days, DRAFT)', source: 'services/decisionCycle.js (decisions + ppm_events)', extra: de ? { median: de.median } : null }));
  const pl = rd.plans;
  m.push(row({ key: 'plans_updated_30d_pct', label: 'Project plans updated in the last 30 days', unit: '%', value: pl ? pl.value : null, n: pl ? pl.known : null,
    missing: pl ? 'no open project with a readable plan date' : why.plans, scope: 'fleet',
    definition: 'open projects whose plan (ledger or plan rows) changed < 30 days ago ÷ open projects with a known plan date', source: 'services/ppm/planFreshness.js' }));
  const wa = rd.wau;
  m.push(row({ key: 'wau', label: 'Weekly active users (page views)', unit: 'users', value: wa ? wa.total : null, n: wa ? wa.total : null,
    missing: wa ? 'no page_viewed event in the last 7 days' : why.wau, scope: 'fleet', extra: wa ? { by_tier: wa.by_tier } : null,
    definition: 'distinct users with ≥ 1 page_viewed in the last 7 days, by role tier recorded on the day', source: 'system_log page_viewed (C-09 telemetry)' }));
  const cs = rd.csat;
  m.push(row({ key: 'csat_pct', label: 'CSAT (last complete month)', unit: '%', value: cs ? cs.value : null, n: cs ? cs.n : null,
    missing: cs ? 'no scored survey reply in the month' : why.csat, scope: 'fleet',
    definition: 'survey replies scoring ≥ 80 ÷ scored replies (voice-tiles rule), fleet', source: 'survey_results' }));
  const cl = rd.claims;
  m.push(row({ key: 'sla_credits_recovered_usd', label: 'WAN SLA credits recovered (USD indicative)', unit: 'USD', value: cl && cl.usd ? cl.usd.recovered : null, n: cl ? cl.claims : null,
    missing: cl ? (cl.claims ? 'a currency has no rate — per-currency totals on the claims page' : 'no claim recorded') : why.claims, scope: 'fleet',
    extra: cl && cl.usd ? { due: cl.usd.due, claimed: cl.usd.claimed } : null,
    definition: 'credited amounts of WAN SLA claims, converted with report_config rates (indicative, never certified)', source: 'routes/wanSlaClaims value metric (services/wanSlaClaims.valueTotals)' }));
  return { metrics: m, perimeter: rd.perimeter || { all: true } };
}

/** Before / after per switch flip: the latest snapshot at or before the event and the first after it (≤ windowDays). */
function compareRollouts(events, snapshots, { windowDays = 30 } = {}) {
  const snaps = (snapshots || []).map((s) => ({ ...s, t: _ms(s.taken_at) })).filter((s) => s.t != null).sort((a, b) => a.t - b.t);
  const W = Math.max(1, Number(windowDays) || 30) * DAY;
  return (events || []).map((e) => {
    const t = _ms(e.ts);
    const before = t == null ? null : [...snaps].reverse().find((s) => s.t <= t && t - s.t <= W) || null;
    const after = t == null ? null : snaps.find((s) => s.t > t && s.t - t <= W) || null;
    const bm = before ? before.metrics || {} : {}, am = after ? after.metrics || {} : {};
    const keys = [...new Set([...Object.keys(bm), ...Object.keys(am)])].sort();
    return { event_id: e.id == null ? null : Number(e.id), key: e.key, from: e.from == null ? null : e.from, to: e.to == null ? null : e.to, ts: e.ts,
      before_snapshot: before ? Number(before.id) : null, after_snapshot: after ? Number(after.id) : null,
      state: !before ? 'no snapshot before the change' : (!after ? 'no snapshot after the change' : 'compared'),
      deltas: before && after ? keys.map((k) => ({ metric: k, before: bm[k] == null ? null : bm[k], after: am[k] == null ? null : am[k],
        delta: bm[k] == null || am[k] == null ? null : Math.round((am[k] - bm[k]) * 10) / 10 })) : [] };
  });
}

/** The fleet values of a scoreboard, keyed by metric (what a snapshot stores). */
function snapshotValues(board) { const o = {}; for (const m of (board && board.metrics) || []) o[m.key] = m.value; return o; }

module.exports = { median, pct, actionMetrics, wauByTier, csat, planFreshShare, claimsValue, assemble, compareRollouts, snapshotValues };
