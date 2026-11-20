'use strict';
// PORTFOLIO LOT 3 (IT portfolio reconstruction spec §21, §23.1, §24.5, §30) — the register + executive dashboard engine.
// PURE: no I/O, no config read; the clock is passed in. Used by routes/governancePortfolioRegister.js only while
// report_config ppm_portfolio_dashboard_v2_enabled = '1' (PROPOSED, default '0'). ADR: docs/ai-decisions/ADR-PORTFOLIO-LOT3-register-dashboard.md
//
// Inputs are the projects the reader may already read (the route passes the A-15 / B3 / W4-filtered portfolio view,
// NOT yet stripped of money) + the reader's money right. Output rows carry ONLY the register columns, and the money
// columns (budget, currency, budget status) only for an amount reader — the engine is the whitelist, so nothing else
// of the project row can leave through this view.
//
// No second formula: data quality = services/ppm/dataQuality.js (evaluate, siteScores, ragOf); high risk =
// services/ppm/riskExposure.isHigh (P11 F-23: residual first, unknown score never "low"); the planned duration = the
// Lot 1 rule (end − start + 1).
//
// P11 F-21 — drill-through rule: every KPI card and standard report carries `drill`, the exact filter patch its link
// merges into the current address (Object.assign(filters, drill), lib/portfolioRegisterPage.merge), and its count is
// computed on THAT merged state, so count == rows of the opened list, always. A list key the card narrows (priority,
// decision_required) is INTERSECTED with the active selection; an empty intersection = no link and a count of 0. The
// report slot is a single choice: a report link selects its report in place of the active one (the other filters
// stay), and its count is computed with that choice.
//
// RULES BELOW ARE PROPOSED (a PMO decision, not approved policy):
//   unfunded            budget status not_budgeted | requested | tbc (no approved funding); unknown status is NOT unfunded
//   without owners      IT owner OR business sponsor blank (a 'na' state counts as answered)
//   high risk           declared risk exposure high | critical OR at least one open high-severity risk in the register
//   stalled in stage    more than STALLED_DAYS days in the current stage (stage entry = the last stage move in the
//                       ledger; a project still in 'proposal' with no move = its creation date; otherwise unknown)
//   in approval, not started  stage 'approval' and no actual start
//   active in a month   planned dates overlap the month, status not cancelled
// UNKNOWN stays null with a reason (never 0, never green): intake switch off, DQ switch off, money hidden, no FTE, no
// stage-entry date. Currencies are never added together (per-currency maps only).

const DQ = require('./dataQuality');
const RX = require('./riskExposure');
const UI = require('../../public/lib/portfolioRegister');

const STALLED_DAYS = 90;
const UNFUNDED = ['not_budgeted', 'requested', 'tbc'];
const HIGH = ['high', 'critical'];
const CLOSED_STAGES = ['closure', 'closed'];
const CLOSED_STATUS = ['done', 'cancelled'];
const DAY = 864e5;
const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s.slice(0, 10) + 'T00:00:00Z'));
const ts = (s) => (s ? Date.parse(String(s).length === 10 ? s + 'T00:00:00Z' : s) : NaN);
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const parse = (v, d) => { if (v == null) return d; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (_) { return d; } };
const round2 = (n) => Math.round(n * 100) / 100;

function stageAge(p, entries, now) {
  if (CLOSED_STAGES.includes(p.stage) || CLOSED_STATUS.includes(p.status)) return null;
  const e = entries && entries[p.id] != null ? entries[p.id] : (blank(p.stage) || p.stage === 'proposal') ? p.created_at : null;
  const t = ts(e);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / DAY)) : null;
}

/** One register row per project (whitelist). */
function rowOf(p, ctx) {
  const { siteName, risks, entries, now, money, intake, dqOn } = ctx;
  const highRisks = (risks || []).filter((r) => Number(r.project_id) === Number(p.id) && RX.isHigh(r)).length;
  const states = parse(p.value_states, {}) || {};
  const iv = (k) => (intake ? (p[k] === undefined ? null : p[k]) : null);
  const dur = isDay(p.start_date) && isDay(p.end_date) && p.end_date >= p.start_date
    ? Math.round((ts(p.end_date.slice(0, 10)) - ts(p.start_date.slice(0, 10))) / DAY) + 1 : null;
  const dq = dqOn ? DQ.evaluate(p, { risks: (risks || []).filter((r) => Number(r.project_id) === Number(p.id)), money }) : null;
  const row = {
    id: p.id, ref: !blank(p.project_ref) ? p.project_ref : p.key, key: p.key, name: p.name, site_id: p.site_id == null ? null : Number(p.site_id),
    site: p.site_id == null ? null : (siteName.get(Number(p.site_id)) || null),
    project_type: iv('project_type'), priority: iv('priority'), status: p.status || null, stage: p.stage || null, stage_age_days: stageAge(p, entries, now),
    risk_exposure: iv('risk_exposure'), high_risks: highRisks,
    owner: p.owner || null, sponsor: p.sponsor || null, delivery_lead: iv('delivery_lead'), decision_required: iv('decision_required'),
    avg_fte: intake ? numOrNull(p.avg_fte) : null, delivery_effort: iv('delivery_effort'),
    start_date: p.start_date || null, end_date: p.end_date || null, duration_days: dur, actual_start: p.actual_start || null,
    indicative_quarter: iv('indicative_quarter'), tags: intake && Array.isArray(parse(p.tags, null)) ? parse(p.tags, null) : null,
    baselined: !blank(p.baseline_start) && !blank(p.baseline_end),
    dq_score: dq ? dq.score : null, dq_rag: dq ? dq.rag : null, _dq: dq,
    _na: { owner: states.owner === 'na', sponsor: states.sponsor === 'na', delivery_lead: states.delivery_lead === 'na' },
  };
  if (money) { row.budget_status = iv('budget_status'); row.budget = numOrNull(p.budget); row.currency = row.budget == null ? null : (p.currency || 'USD'); }
  return row;
}

const isUnfunded = (r) => r.budget_status != null && UNFUNDED.includes(r.budget_status);
const isHighRisk = (r) => HIGH.includes(r.risk_exposure) || r.high_risks > 0;
const isOnHold = (r) => r.status === 'on_hold' || r.stage === 'on_hold';
const withoutOwner = (r) => (blank(r.owner) && !r._na.owner) || (blank(r.sponsor) && !r._na.sponsor);
const isOpen = (r) => !CLOSED_STAGES.includes(r.stage) && !CLOSED_STATUS.includes(r.status);
const REPORT_RULES = {
  unfunded: { money: true, test: isUnfunded },
  without_owners: { test: withoutOwner },
  on_hold: { test: isOnHold },
  high_risk: { test: isHighRisk },
  data_quality: { test: (r) => r.dq_score != null && r.dq_rag !== 'GREEN' },
  not_baselined: { test: (r) => !r.baselined && isOpen(r) },
};

function quarterOf(r) {
  if (isDay(r.start_date)) return r.start_date.slice(0, 4) + '-Q' + (Math.floor((Number(r.start_date.slice(5, 7)) - 1) / 3) + 1);
  return r.indicative_quarter || null;
}
function inYear(r, y) {
  if (isDay(r.start_date) && isDay(r.end_date)) return r.start_date.slice(0, 4) <= y && r.end_date.slice(0, 4) >= y;
  if (isDay(r.start_date)) return r.start_date.slice(0, 4) === y;
  return !!(r.indicative_quarter && r.indicative_quarter.slice(0, 4) === y);
}

/** Filters (parsed with lib/urlFilters + lib/portfolioRegister.SCHEMA). Money filters are ignored for a money-hidden reader. */
function applyFilters(rows, f = {}, { money = false } = {}) {
  const list = (k) => (Array.isArray(f[k]) && f[k].length ? f[k] : null);
  const fields = { site: 'site_id', project_type: 'project_type', priority: 'priority', status: 'status', risk: 'risk_exposure', owner: 'owner', delivery_lead: 'delivery_lead', sponsor: 'sponsor', decision_required: 'decision_required' };
  if (money) fields.budget_status = 'budget_status';
  const years = list('year') ? f.year.filter((y) => /^\d{4}$/.test(y)) : null;
  const q = list('q') ? f.q.join(' ').toLowerCase().split(/\s+/).filter(Boolean) : null;
  const rule = f.report && REPORT_RULES[f.report] && (!REPORT_RULES[f.report].money || money) ? REPORT_RULES[f.report] : null;
  return (rows || []).filter((r) => {
    for (const [k, col] of Object.entries(fields)) { const l = list(k); if (l && !l.includes(r[col] == null ? '' : String(r[col]))) return false; }
    if (years && years.length && !years.some((y) => inYear(r, y))) return false;
    if (q) {
      const hay = [r.ref, r.key, r.name, r.site, r.owner, r.sponsor, r.delivery_lead, r.project_type, r.risk_exposure, ...(r.tags || [])].filter((x) => x != null).join(' ').toLowerCase();
      if (!q.every((tok) => hay.includes(tok))) return false;
    }
    if (rule && !rule.test(r)) return false;
    if (f.dq === 'scored' && r.dq_score == null) return false;
    if (f.budget === 'identified' && money && !(r.budget != null && r.budget > 0)) return false;
    return true;
  });
}

const SORTABLE = new Set(UI.COLUMNS.map((c) => c.key));
/** Sort by a register column; unknown values always last; ties by ref. An unknown key sorts by ref. */
function sortRows(rows, key, dir = 'asc') {
  const k = SORTABLE.has(key) ? key : 'ref'; const s = dir === 'desc' ? -1 : 1;
  const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'en', { numeric: true }));
  return [...(rows || [])].sort((a, b) => {
    const x = a[k], y = b[k];
    const nx = x == null || x === '', ny = y == null || y === '';
    if (nx || ny) return nx === ny ? cmp(a.ref, b.ref) : (nx ? 1 : -1);
    return cmp(x, y) * s || cmp(a.ref, b.ref);
  });
}

/** { CUR: sum } of known amounts (never across currencies); {} when none. */
function perCurrency(rows, pred = () => true) {
  const out = {};
  for (const r of rows) if (r.budget != null && pred(r)) out[r.currency] = round2((out[r.currency] || 0) + r.budget);
  return out;
}
function fteOf(rows) {
  const known = rows.filter((r) => r.avg_fte != null);
  return { fte: known.length ? round2(known.reduce((a, r) => a + r.avg_fte, 0)) : null, fte_unknown: rows.length - known.length };
}
function dqOf(rows) {
  const scored = rows.filter((r) => r._dq);
  if (!scored.length) return null;
  const s = DQ.siteScores(scored.map((r) => ({ site_id: null, dq: r._dq })))[0];
  return s ? s.score : null;
}

/** P11 F-21 — the link's filter patch: list keys intersected with the active selection (null = empty intersection). */
function linkPatch(f, patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (Array.isArray(v)) {
      const cur = Array.isArray(f[k]) && f[k].length ? f[k] : null;
      const vals = cur ? v.filter((x) => cur.includes(x)) : v;
      if (!vals.length) return null;
      out[k] = vals;
    } else out[k] = v;
  }
  return out;
}

function kpis(all, f, filtered, { money, intake, dqOn }) {
  const drilled = (patch) => { const d = linkPatch(f, patch); return d ? { drill: d, count: applyFilters(all, Object.assign({}, f, d), { money }).length } : { drill: null, count: 0 }; };
  const dqScore = dqOn ? dqOf(filtered) : null;
  const dq = dqOn ? drilled({ dq: 'scored' }) : { drill: null, count: null };
  const card = (key, patch, extra) => { const d = drilled(patch); return { key, unit: 'count', value: d.count, count: d.count, drill: d.drill, reason: null, ...(extra || {}) }; };
  return [
    { key: 'total_projects', unit: 'count', value: filtered.length, count: filtered.length, drill: {}, reason: null },
    { key: 'data_quality', unit: '%', value: dqScore, count: dq.count, drill: dq.drill,
      reason: !dqOn ? 'DQ_DISABLED' : dqScore == null ? 'NO_SCORE' : null, rag: dqScore == null ? 'NA' : DQ.ragOf(dqScore, false), proposed: true,
      scope: money ? 'with_budget_checks' : 'without_budget_checks' },
    intake ? card('critical_high', { priority: ['critical', 'high'] })
      : { key: 'critical_high', unit: 'count', value: null, count: null, drill: null, reason: 'INTAKE_DISABLED' },
    money ? (() => { const d = drilled({ budget: 'identified' }); return { key: 'budget_identified', unit: 'money', value: perCurrency(filtered, (r) => r.budget > 0), count: d.count, drill: d.drill, reason: null }; })()
      : { key: 'budget_identified', unit: 'money', value: null, count: null, drill: null, reason: 'MONEY_HIDDEN' },
    intake ? card('decisions_required', { decision_required: ['yes'] })
      : { key: 'decisions_required', unit: 'count', value: null, count: null, drill: null, reason: 'INTAKE_DISABLED' },
  ];
}

function groupBy(rows, keyOf) {
  const m = new Map();
  for (const r of rows) { const k = keyOf(r); const kk = k == null || k === '' ? '' : String(k); if (!m.has(kk)) m.set(kk, []); m.get(kk).push(r); }
  return m;
}
const riskGroup = (rows, keyOf) => [...groupBy(rows, keyOf)].map(([key, list]) => ({ key, projects: list.length, high_risk: list.filter(isHighRisk).length })).sort((a, b) => b.high_risk - a.high_risk || a.key.localeCompare(b.key));

function analyses(rows, { money, intake, dqOn }) {
  const n = rows.length;
  const by_site = [...groupBy(rows, (r) => r.site_id)].map(([k, list]) => ({
    site_id: k === '' ? null : Number(k), site: list[0].site, count: list.length,
    critical_high: intake ? list.filter((r) => HIGH.includes(r.priority)).length : null,
    high_risk: list.filter(isHighRisk).length, ...fteOf(list), dq: dqOn ? dqOf(list) : null,
    ...(money ? { budget: perCurrency(list) } : {}),
  })).sort((a, b) => b.count - a.count || String(a.site).localeCompare(String(b.site)));
  const by_priority = intake ? [...groupBy(rows, (r) => r.priority)].map(([k, list]) => ({
    priority: k || null, count: list.length, pct: n ? Math.round((list.length * 100) / n) : null, ...fteOf(list),
    sites: new Set(list.map((r) => r.site_id).filter((x) => x != null)).size,
    unfunded: money ? list.filter(isUnfunded).length : null, ...(money ? { budget: perCurrency(list) } : {}),
  })) : [];
  const ages = rows.filter((r) => r.stage_age_days != null);
  const status = {
    by_status: [...groupBy(rows, (r) => r.status)].map(([k, list]) => ({ key: k, count: list.length })),
    by_stage: [...groupBy(rows, (r) => r.stage)].map(([k, list]) => ({ key: k, count: list.length })),
    avg_stage_age_days: ages.length ? Math.round(ages.reduce((a, r) => a + r.stage_age_days, 0) / ages.length) : null,
    stage_age_known: ages.length, stage_age_unknown: rows.filter(isOpen).length - ages.length,
    stalled: ages.filter((r) => r.stage_age_days > STALLED_DAYS).length, stalled_days: STALLED_DAYS,
    approved_not_started: rows.filter((r) => r.stage === 'approval' && blank(r.actual_start)).length,
    in_progress_without_lead: intake ? rows.filter((r) => (r.stage === 'in_progress' || r.status === 'active') && blank(r.delivery_lead) && !r._na.delivery_lead).length : null,
    on_hold: rows.filter(isOnHold).length,
  };
  const risk = {
    by_site: riskGroup(rows, (r) => r.site_id), by_type: intake ? riskGroup(rows, (r) => r.project_type) : null, by_owner: riskGroup(rows, (r) => r.owner),
    by_quarter: riskGroup(rows, quarterOf), ...(money && intake ? { by_budget_status: riskGroup(rows, (r) => r.budget_status) } : {}),
  };
  let budget = null;
  if (money) {
    const by_currency = {};
    for (const [cur, list] of groupBy(rows.filter((r) => r.budget != null), (r) => r.currency)) {
      by_currency[cur] = { projects: list.length, total: round2(list.reduce((a, r) => a + r.budget, 0)),
        approved: round2(list.filter((r) => r.budget_status === 'approved').reduce((a, r) => a + r.budget, 0)),
        requested: round2(list.filter((r) => r.budget_status === 'requested').reduce((a, r) => a + r.budget, 0)) };
    }
    const dim = (keyOf) => [...groupBy(rows, keyOf)].map(([key, list]) => ({ key, budget: perCurrency(list) })).filter((g) => Object.keys(g.budget).length);
    budget = { by_currency, budget_unknown: rows.filter((r) => r.budget == null).length,
      not_budgeted: intake ? rows.filter((r) => r.budget_status === 'not_budgeted').length : null, tbc: intake ? rows.filter((r) => r.budget_status === 'tbc').length : null,
      by_site: dim((r) => r.site), by_type: intake ? dim((r) => r.project_type) : null, by_priority: intake ? dim((r) => r.priority) : null, by_quarter: dim(quarterOf) };
  }
  return { by_site, by_priority, status, risk, ...(money ? { budget } : { budget_reason: 'MONEY_HIDDEN' }) };
}

/** §23.1 — per month of `year`: active projects, total FTE (known only), critical, high-risk, very large. */
function monthlyLoad(rows, year, { intake }) {
  const dated = rows.filter((r) => isDay(r.start_date) && isDay(r.end_date) && r.status !== 'cancelled');
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    const from = `${year}-${mm}-01`, to = `${year}-${mm}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const act = dated.filter((r) => r.start_date.slice(0, 10) <= to && r.end_date.slice(0, 10) >= from);
    const f = fteOf(act);
    months.push({ month: `${year}-${mm}`, active: act.length, fte: intake ? f.fte : null, fte_unknown: intake ? f.fte_unknown : null,
      critical: intake ? act.filter((r) => r.priority === 'critical').length : null, high_risk: act.filter(isHighRisk).length,
      very_large: intake ? act.filter((r) => r.delivery_effort === 'very_large').length : null });
  }
  return { year, months, undated: rows.filter((r) => !isDay(r.start_date) || !isDay(r.end_date)).length };
}

/**
 * Build the whole register view over the readable projects.
 *   opts: { sites [{id,name}], risks, stageEntries {projectId: iso}, now, money, intake, dqOn, year, filters, sort, dir }
 * Returns { rows (filtered + sorted, public fields only), total, kpis, analyses, load, reports } — the KPI cards,
 * analyses and load are computed over the FILTERED rows (the dashboard follows the filters).
 */
function build(projects, opts = {}) {
  const now = opts.now || new Date();
  const ctx = { siteName: new Map((opts.sites || []).map((s) => [Number(s.id), s.name])), risks: opts.risks || [], entries: opts.stageEntries || {}, now,
    money: !!opts.money, intake: !!opts.intake, dqOn: !!opts.dqOn };
  const all = (projects || []).map((p) => rowOf(p, ctx));
  const filtered = applyFilters(all, opts.filters || {}, { money: ctx.money });
  const rows = sortRows(filtered, opts.sort, opts.dir);
  const year = Number.isInteger(opts.year) ? opts.year : now.getUTCFullYear();
  const reports = UI.REPORTS.map((r) => {
    if (REPORT_RULES[r.key].money && !ctx.money) return { key: r.key, count: null, drill: null, reason: 'MONEY_HIDDEN' };
    if (r.key === 'data_quality' && !ctx.dqOn) return { key: r.key, count: null, drill: null, reason: 'DQ_DISABLED' };
    const drill = { report: r.key };   // P11 F-21: the count of exactly the list the link opens
    return { key: r.key, count: applyFilters(all, Object.assign({}, opts.filters || {}, drill), { money: ctx.money }).length, drill };
  });
  return { rows: rows.map(publicRow), total: all.length, options: optionsOf(all, ctx), kpis: kpis(all, opts.filters || {}, filtered, ctx), analyses: analyses(filtered, ctx), load: monthlyLoad(filtered, year, ctx), reports, stalled_days: STALLED_DAYS, proposed: true };
}
/** Filter choices from the readable rows (before filtering): distinct known values; money fields only for an amount reader. */
function optionsOf(rows, { money, intake }) {
  const distinct = (k) => [...new Set(rows.map((r) => r[k]).filter((v) => v != null && v !== ''))].map(String).sort((a, b) => a.localeCompare(b));
  const sites = [...new Map(rows.filter((r) => r.site_id != null).map((r) => [r.site_id, r.site])).entries()].map(([value, label]) => ({ value: String(value), label: label || String(value) })).sort((a, b) => a.label.localeCompare(b.label));
  const years = new Set();
  for (const r of rows) { if (isDay(r.start_date)) { const a = Number(r.start_date.slice(0, 4)), b = isDay(r.end_date) ? Number(r.end_date.slice(0, 4)) : a; for (let y = a; y <= Math.min(b, a + 20); y++) years.add(String(y)); } else if (r.indicative_quarter) years.add(r.indicative_quarter.slice(0, 4)); }
  return { site: sites, year: [...years].sort(), status: distinct('status'), owner: distinct('owner'), sponsor: distinct('sponsor'),
    ...(intake ? { project_type: distinct('project_type'), priority: distinct('priority'), risk: distinct('risk_exposure'), decision_required: distinct('decision_required'), delivery_lead: distinct('delivery_lead') } : {}),
    ...(money && intake ? { budget_status: distinct('budget_status') } : {}) };
}
function publicRow(r) { const { _dq, _na, actual_start, indicative_quarter, tags, ...rest } = r; return rest; }   // eslint-disable-line no-unused-vars

module.exports = { build, applyFilters: (rows, f, o) => applyFilters(rows.map(withNa), f, o), sortRows, REPORT_RULES, STALLED_DAYS, UNFUNDED, _rowOf: rowOf };
function withNa(r) { return r._na ? r : { ...r, _na: { owner: false, sponsor: false, delivery_lead: false } }; }
