'use strict';
// W1-EVM (E-EVM-1, PPM parity W0 rows E1–E7, E9, E10) — earned value engine. PURE: no DB, no clock, no I/O; the
// caller passes every row and the status date. ADR: docs/ai-decisions/ADR-W1-EVM-earned-value.md.
//
// Rules (each one is pinned by tests/ppm-evm.test.js, a hand-computed reference project):
//   • UNKNOWN is null, never 0: a missing input makes the measure null, and a division by zero or by an unknown is
//     null (never 0, never Infinity). A rollup is null for a measure as soon as one contributor is null for it.
//   • PV is TIME-PHASED FROM THE BASELINE: each leaf task spreads its baseline cost linearly over the WORKING DAYS
//     (Mon–Fri — there is no calendar model yet, W2) of its BASELINE window. A linear spread of the whole project
//     budget over the project window is NOT used (W0 calls that a stub). When the project carries monthly baseline
//     budget periods for a currency, those months ARE the PV of that currency (the status month prorated by working
//     days), and the task costs only weight the earned value.
//   • EV per task by its method: '0_100' · '50_50' · 'percent_complete' (default, today-compatible) · 'physical_pct'.
//   • AC: the project's monthly ACTUAL budget periods (months ≤ the status month) when it has any in that currency,
//     otherwise costed time entries (hours × the task's hourly rate, days ≤ the status date). An entry on a task with
//     no rate makes AC unknown (never "free hours").
//   • Indicators: SV=EV−PV · CV=EV−AC · SPI=EV/PV · CPI=EV/AC · EAC=BAC/CPI (default) with variants AC+(BAC−EV) and
//     AC+(BAC−EV)/(CPI×SPI) and the budget-period forecast · ETC=EAC−AC · VAC=BAC−EAC · TCPI=(BAC−EV)/(BAC−AC).
//   • Currencies are never added together. A converted view exists only when an explicit rate table is supplied, and
//     it is flagged `converted: true` with the rates used.
//   • Nothing here is certified: every result carries CERTIFICATION ("non certifié" — Finance certifies, a human).

const CERTIFICATION = 'non certifié — earned value computed from figures entered in the dashboard; Finance has not certified them';
const EV_METHODS = ['percent_complete', '0_100', '50_50', 'physical_pct'];
const DEFAULT_EV_METHOD = 'percent_complete';
const COST_CLASSES = ['capex', 'opex'];
const MEASURES = ['bac', 'pv', 'ev', 'ac'];
const DAY = 86400000;

const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10)) && !Number.isNaN(Date.parse(v.slice(0, 10) + 'T00:00:00Z'));
const day = (v) => (v == null || v === '' ? null : (isDay(String(v)) ? String(v).slice(0, 10) : null));
const ms = (d) => Date.parse(d + 'T00:00:00Z');
const iso = (t) => new Date(t).toISOString().slice(0, 10);
/** a finite number, or null (null / '' / NaN / ±Infinity are unknown). */
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const r4 = (v) => (v == null ? null : Math.round(v * 10000) / 10000);
/** a / b, or null when either is unknown or b is 0 (never Infinity, never 0 by default). */
const div = (a, b) => (a == null || b == null || b === 0 ? null : a / b);
const sub = (a, b) => (a == null || b == null ? null : a - b);
const month = (d) => d.slice(0, 7);

/** Working days (Mon–Fri) from a to b inclusive. Empty array when the window has no working day; null when a > b or a date is bad. */
function workingDays(a, b) {
  const x = day(a), y = day(b);
  if (!x || !y || ms(x) > ms(y)) return null;
  const out = [];
  for (let t = ms(x); t <= ms(y); t += DAY) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) out.push(iso(t)); }
  return out;
}

/**
 * The days a baseline cost is spread over: the working days of the window; a window of weekend days only spreads over
 * its calendar days (so a cost is never lost). Null when the window is unknown or inverted.
 */
function spreadDays(a, b) {
  const wd = workingDays(a, b);
  if (wd == null) return null;
  if (wd.length) return wd;
  const out = []; for (let t = ms(day(a)); t <= ms(day(b)); t += DAY) out.push(iso(t));
  return out;
}

/** Linear time-phasing of `cost` over the spread days of [a, b] → { 'YYYY-MM-DD': amount }; null when unknown. */
function timePhase(cost, a, b) {
  const c = num(cost), days = spreadDays(a, b);
  if (c == null || days == null) return null;
  const per = c / days.length, out = {};
  for (const d of days) out[d] = per;
  return out;
}

/** Σ of the phased amounts on days ≤ statusDate (null when the phasing is unknown). */
const cumulativeTo = (phased, statusDate) => (phased == null ? null : Object.keys(phased).reduce((s, d) => (d <= statusDate ? s + phased[d] : s), 0));
/** phased amounts summed per month → { 'YYYY-MM': amount }. */
function byMonth(phased) { const out = {}; for (const d of Object.keys(phased || {})) out[month(d)] = (out[month(d)] || 0) + phased[d]; return out; }

/** The fraction of a month's working days that are ≤ statusDate (0 before the month, 1 after it). */
function monthFractionTo(period, statusDate) {
  const first = period + '-01';
  const last = iso(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0));
  if (statusDate < first) return 0;
  if (statusDate >= last) return 1;
  const all = spreadDays(first, last), done = all.filter((d) => d <= statusDate);
  return done.length / all.length;
}

/** the EV method of a task (unknown values fall back to the default). */
const evMethod = (f) => (f && EV_METHODS.includes(f.ev_method) ? f.ev_method : DEFAULT_EV_METHOD);

function _started(t, statusDate) {
  const as = day(t.actual_start);
  return (as != null && as <= statusDate) || ['in_progress', 'blocked', 'done'].includes(t.status) || (num(t.progress_pct) || 0) > 0;
}
function _complete(t, statusDate) {
  const ae = day(t.actual_end);
  return t.status === 'done' || num(t.progress_pct) === 100 || (ae != null && ae <= statusDate);
}
/** A reported percentage, or the one the status proves (done → 100 %, not started → 0 %), else null. */
function _pct(value, t, statusDate) {
  const p = num(value);
  if (p != null) return Math.min(100, Math.max(0, p)) / 100;
  if (t.status === 'done') return 1;
  if (!_started(t, statusDate)) return 0;   // explicit "not started": status todo, no actual start, no progress
  return null;                               // started but no figure: UNKNOWN, never 0 (W0 E-NULL-1)
}

/**
 * Earned fraction (0..1) of a task under its method, or null when it cannot be known.
 * @param {object} t task row (status, progress_pct, actual_start, actual_end)
 * @param {object} f EVM fields (ev_method, physical_pct)
 */
function earnedFraction(t, f, statusDate) {
  const m = evMethod(f);
  if (m === '0_100') return _complete(t, statusDate) ? 1 : 0;
  if (m === '50_50') return _complete(t, statusDate) ? 1 : _started(t, statusDate) ? 0.5 : 0;
  if (m === 'physical_pct') return _pct(f && f.physical_pct, t, statusDate);
  return _pct(t.progress_pct, t, statusDate);
}

/**
 * The standard indicator set from BAC / PV / EV / AC (+ an optional forecast EAC). Every unknown input or zero divisor
 * yields null. Money rounded to 2 decimals, indices to 4 — rounding happens on the OUTPUT only.
 */
function indicators({ bac = null, pv = null, ev = null, ac = null, eac_forecast = null } = {}) {
  const sv = sub(ev, pv), cv = sub(ev, ac), spi = div(ev, pv), cpi = div(ev, ac);
  const eac = div(bac, cpi);
  const remaining = sub(bac, ev);
  const eac_atypical = ac == null || remaining == null ? null : ac + remaining;
  const ci = cpi == null || spi == null ? null : cpi * spi;
  const eac_cpi_spi = ac == null || remaining == null ? null : (div(remaining, ci) == null ? null : ac + div(remaining, ci));
  const etc = sub(eac, ac), vac = sub(bac, eac), tcpi = div(remaining, sub(bac, ac));
  return {
    bac: r2(bac), pv: r2(pv), ev: r2(ev), ac: r2(ac),
    sv: r2(sv), cv: r2(cv), spi: r4(spi), cpi: r4(cpi),
    eac: r2(eac), etc: r2(etc), vac: r2(vac), tcpi: r4(tcpi),
    eac_variants: { bac_over_cpi: r2(eac), ac_plus_remaining: r2(eac_atypical), ac_plus_remaining_over_cpi_spi: r2(eac_cpi_spi), budget_period_forecast: r2(num(eac_forecast)) },
    pct_complete: r4(div(ev, bac)), pct_spent: r4(div(ac, bac)),
  };
}

/** Σ of one measure over contributors: null as soon as one contributor is null for it (or there is none). */
function sumOf(list, k) {
  if (!list.length) return null;
  let s = 0;
  for (const x of list) { const v = x[k]; if (v == null) return null; s += v; }
  return s;
}

/**
 * Bottom-up rollup of per-currency measures: `items` = [{ currency, bac, pv, ev, ac, eac_forecast? }]. Returns one
 * row per currency (never across currencies), indicators recomputed from the sums (indices are never averaged), with
 * the number of contributors and which of them are unknown for each measure.
 */
function rollupByCurrency(items) {
  const by = {};
  for (const it of items || []) { if (!it || !it.currency) continue; (by[it.currency] = by[it.currency] || []).push(it); }
  return Object.keys(by).sort().map((cur) => {
    const xs = by[cur];
    const m = {}; for (const k of MEASURES) m[k] = sumOf(xs, k);
    const fc = xs.every((x) => x.eac_forecast != null) ? sumOf(xs, 'eac_forecast') : null;
    const unknown = {}; for (const k of MEASURES) unknown[k] = xs.filter((x) => x[k] == null).length;
    return { currency: cur, contributors: xs.length, unknown, ...indicators({ ...m, eac_forecast: fc }) };
  });
}

/**
 * Converted view: every currency row multiplied by an explicit rate to `target`. Null totals when one currency has no
 * rate or an unknown measure. Flagged — a converted figure is never mistaken for a native one.
 * @param {Array} rows rollupByCurrency rows
 * @param {{target:string, rates:Object<string,number>, as_of?:string, source?:string}} table rate to the target per currency
 */
function convert(rows, table) {
  if (!table || !/^[A-Z]{3}$/.test(String(table.target || '')) || !table.rates) return null;
  const rate = (c) => (c === table.target ? 1 : num(table.rates[c]));
  const missing = (rows || []).filter((r) => rate(r.currency) == null || !(rate(r.currency) > 0)).map((r) => r.currency);
  const m = {};
  for (const k of MEASURES) m[k] = missing.length || !(rows || []).length ? null : (rows.some((r) => r[k] == null) ? null : rows.reduce((s, r) => s + r[k] * rate(r.currency), 0));
  return { converted: true, target: table.target, rates_used: Object.fromEntries((rows || []).map((r) => [r.currency, rate(r.currency)])), rates_as_of: table.as_of || null, rates_source: table.source || null, missing_rates: missing, ...indicators(m), certification: CERTIFICATION };
}

/**
 * AC of a set of leaves from their time entries (≤ cut-off day): the leaves WITH entries are the measured set; one of
 * them without a rate makes the whole figure unknown; no entry at all is unknown (never 0).
 */
function _acFromHours(leaves, upTo = null) {
  const withHours = leaves.filter((l) => l._entries && l._entries.length);
  if (!withHours.length || withHours.some((l) => l._rate == null)) return null;
  return withHours.reduce((s, l) => s + l._entries.filter((e) => !upTo || day(e.day) <= upTo).reduce((h, e) => h + (num(e.hours) || 0), 0) * l._rate, 0);
}

/** live leaves and summaries of a task list (cancelled tasks are out of the earned value: no budget, no work). */
function _tree(tasks) {
  const live = (tasks || []).filter((t) => t && t.status !== 'cancelled');
  const ids = new Set(live.map((t) => Number(t.id)));
  const kids = new Map();
  for (const t of live) { const p = t.parent_id == null ? null : Number(t.parent_id); if (p != null && ids.has(p)) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(Number(t.id)); } }
  return { live, kids, isLeaf: (id) => !kids.has(Number(id)) };
}

/**
 * Earned value of one project.
 * @param {object} a
 * @param {object} a.project             { id, currency }
 * @param {Array}  a.tasks               task rows (id, parent_id, status, progress_pct, actual_start, actual_end, baseline_start, baseline_end)
 * @param {Object} [a.evmFields]         task_id → { ev_method, physical_pct, baseline_cost, cost_currency, cost_rate, capex_opex }
 * @param {object} [a.baselinePayload]   latest portfolio_baselines payload; its frozen task dates fill a task with no baseline dates
 * @param {Array}  [a.budgetPeriods]     ppm_budget_periods rows { period, currency, kind, amount }
 * @param {Array}  [a.timeEntries]       ppm_time_entries rows { task_id, day, hours }
 * @param {string} a.statusDate          'YYYY-MM-DD' (the cut-off; EV reads the progress reported at that date)
 */
function projectEvm({ project = {}, tasks = [], evmFields = {}, baselinePayload = null, budgetPeriods = [], timeEntries = [], statusDate } = {}) {
  const sd = day(statusDate);
  if (!sd) throw Object.assign(new Error('statusDate must be YYYY-MM-DD'), { code: 'INVALID' });
  const F = (id) => evmFields[id] || evmFields[String(id)] || {};
  const frozen = new Map(((baselinePayload && baselinePayload.tasks) || []).map((t) => [Number(t.id), t]));
  const { live, kids, isLeaf } = _tree(tasks);
  const entries = new Map();
  for (const e of timeEntries || []) { if (!e) continue; const k = Number(e.task_id); if (!entries.has(k)) entries.set(k, []); entries.get(k).push(e); }

  // ── leaves ────────────────────────────────────────────────────────────────────────────────────────────────────
  const taskRows = new Map();
  for (const t of live) {
    if (!isLeaf(t.id)) continue;
    const f = F(t.id), fz = frozen.get(Number(t.id));
    const bs = day(t.baseline_start) || (fz ? day(fz.baseline_start || fz.start_date) : null);
    const be = day(t.baseline_end) || (fz ? day(fz.baseline_end || fz.end_date) : null);
    const bac = num(f.baseline_cost);
    const currency = f.cost_currency && /^[A-Z]{3}$/.test(f.cost_currency) ? f.cost_currency : null;
    const phased = bac == null ? null : timePhase(bac, bs, be);
    const pv = cumulativeTo(phased, sd);
    const frac = earnedFraction(t, f, sd);
    const ev = bac == null || frac == null ? null : bac * frac;
    // AC from this task's time entries (≤ status date): none → unknown; hours without a rate → unknown
    const es = (entries.get(Number(t.id)) || []).filter((e) => day(e.day) && day(e.day) <= sd);
    const rate = num(f.cost_rate), hours = es.reduce((s, e) => s + (num(e.hours) || 0), 0);
    const ac = !es.length || rate == null ? null : hours * rate;
    const reasons = [];
    if (bac == null) reasons.push('no_baseline_cost');
    else if (!currency) reasons.push('no_cost_currency');
    if (bac != null && phased == null) reasons.push('no_baseline_dates');
    if (frac == null) reasons.push('progress_unknown');
    if (es.length && rate == null) reasons.push('hours_without_rate');
    const capex = COST_CLASSES.includes(f.capex_opex) ? f.capex_opex : null;
    taskRows.set(Number(t.id), { id: Number(t.id), parent_id: t.parent_id == null ? null : Number(t.parent_id), name: t.name || null, leaf: true, currency, capex_opex: capex, ev_method: evMethod(f), earned_fraction: r4(frac), baseline_start: bs, baseline_end: be, hours_to_date: es.length ? r2(hours) : null, phased, _entries: es, _rate: rate, bac, pv, ev, ac, reasons });
  }
  // ── summaries (leaf → summary, per currency; a summary's own figures are never added to its children's) ──────
  const summaryOf = (id) => {
    const leaves = [], stack = [...(kids.get(Number(id)) || [])];
    while (stack.length) { const c = stack.pop(); if (kids.has(c)) stack.push(...kids.get(c)); else if (taskRows.has(c)) leaves.push(taskRows.get(c)); }
    return leaves;
  };
  const summaries = live.filter((t) => !isLeaf(t.id)).map((t) => {
    const leaves = summaryOf(t.id);
    const uncosted = leaves.filter((l) => !l.currency).length;
    return { id: Number(t.id), name: t.name || null, leaves: leaves.length, uncosted_leaves: uncosted, currencies: uncosted ? [] : rollupByCurrency(leaves) };
  });

  // ── project, per currency ───────────────────────────────────────────────────────────────────────────────────
  const leaves = [...taskRows.values()];
  const uncosted = leaves.filter((l) => !l.currency).map((l) => l.id);
  const bp = (budgetPeriods || []).filter((r) => r && /^\d{4}-\d{2}$/.test(String(r.period)) && /^[A-Z]{3}$/.test(String(r.currency)) && num(r.amount) != null);
  const currencies = [...new Set([...leaves.map((l) => l.currency).filter(Boolean), ...bp.map((r) => r.currency)])].sort();
  const BP = require('../ppmBudgetPeriods');
  const forecastView = BP.view(bp, { asOf: sd });
  const results = currencies.map((cur) => {
    const ls = leaves.filter((l) => l.currency === cur);
    const base = bp.filter((r) => r.currency === cur && r.kind === 'baseline');
    const acts = bp.filter((r) => r.currency === cur && r.kind === 'actual');
    const sources = {}, reasons = [];
    // task-derived figures are usable only when EVERY live leaf is costed (an uncosted leaf has an unknown share)
    const tasksComplete = uncosted.length === 0 && ls.length > 0;
    const taskBac = tasksComplete ? sumOf(ls, 'bac') : null;
    const taskEv = tasksComplete ? sumOf(ls, 'ev') : null;
    let bac, pv, ev;
    if (base.length) {
      bac = base.reduce((s, r) => s + num(r.amount), 0);
      pv = base.reduce((s, r) => s + num(r.amount) * monthFractionTo(r.period, sd), 0);
      ev = taskBac == null || taskEv == null ? null : (taskBac === 0 ? null : bac * (taskEv / taskBac));
      sources.bac = sources.pv = 'budget_periods';
      sources.ev = 'task_progress_weighted_by_baseline_cost';
    } else {
      bac = taskBac; pv = tasksComplete ? sumOf(ls, 'pv') : null; ev = taskEv;
      sources.bac = sources.pv = 'task_baseline'; sources.ev = 'task_progress';
    }
    if (uncosted.length) reasons.push('uncosted_tasks');
    if (!ls.length && !base.length) reasons.push('no_baseline');
    if (ev == null && tasksComplete) reasons.push('progress_unknown');
    let ac;
    if (acts.length) {
      ac = acts.filter((r) => r.period <= month(sd)).reduce((s, r) => s + num(r.amount), 0);
      sources.ac = 'budget_periods';
    } else {
      const withHours = ls.filter((l) => l.hours_to_date != null);
      const noRate = withHours.filter((l) => l.ac == null);
      ac = _acFromHours(ls);
      sources.ac = 'time_entries';
      if (!withHours.length) reasons.push('no_actuals');
      if (noRate.length) reasons.push('hours_without_rate');
    }
    const fv = (forecastView.currencies || []).find((c) => c.currency === cur);
    const eac_forecast = fv && fv.remaining_forecast != null ? fv.eac : null;
    const split = {};
    for (const cls of [...COST_CLASSES, 'unclassified']) {
      const xs = ls.filter((l) => (l.capex_opex || 'unclassified') === cls);
      split[cls] = xs.length ? { tasks: xs.length, bac: r2(sumOf(xs, 'bac')), pv: r2(sumOf(xs, 'pv')), ev: r2(sumOf(xs, 'ev')), ac: acts.length ? null : r2(_acFromHours(xs)) } : null;
    }
    const raw = { currency: cur, bac, pv, ev, ac, eac_forecast };
    return { currency: cur, ...indicators(raw), sources, reasons, coverage: { leaves: leaves.length, costed_in_currency: ls.length, uncosted_task_ids: uncosted }, capex_opex: split, s_curve: sCurve({ leaves: ls, base, acts, sd, tasksComplete, bac, ev }), _raw: raw };
  });
  return {
    project_id: project.id == null ? null : Number(project.id), status_date: sd, ev_methods: EV_METHODS,
    pv_rule: 'baseline cost of each leaf task spread linearly over the working days (Mon–Fri) of its baseline window; monthly baseline budget periods, when present for a currency, are the PV of that currency (status month prorated by working days)',
    currencies: results.map(({ _raw, ...r }) => r),
    rollup_input: results.map((r) => r._raw),
    tasks: leaves.map(({ phased, _entries, _rate, bac, pv, ev, ac, ...t }) => ({ ...t, bac: r2(bac), pv: r2(pv), ev: r2(ev), ac: r2(ac) })),
    summaries, certification: CERTIFICATION, never_summed_across_currencies: true,
  };
}

/**
 * Cumulative PV / EV / AC per month (S-curve). PV is known for every month of the baseline; EV is only known at the
 * status month (progress has no history — a past EV point is null, never interpolated); AC is known up to the status
 * month and null after it.
 */
function sCurve({ leaves, base, acts, sd, tasksComplete, bac, ev }) {
  const pvByMonth = {};
  if (base.length) for (const r of base) pvByMonth[r.period] = (pvByMonth[r.period] || 0) + num(r.amount);
  else if (tasksComplete) for (const l of leaves) { const m = byMonth(l.phased); for (const k of Object.keys(m)) pvByMonth[k] = (pvByMonth[k] || 0) + m[k]; }
  const acByMonth = {};
  if (acts.length) for (const r of acts) acByMonth[r.period] = (acByMonth[r.period] || 0) + num(r.amount);
  const months = [...new Set([...Object.keys(pvByMonth), ...Object.keys(acByMonth), month(sd)])].sort();
  if (!months.length || (base.length === 0 && !tasksComplete && !acts.length)) return [];
  const all = [], first = months[0], last = months[months.length - 1];
  for (let y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7)); `${y}-${String(m).padStart(2, '0')}` <= last; m === 12 ? (y++, m = 1) : m++) all.push(`${y}-${String(m).padStart(2, '0')}`);
  const acFromTasks = !acts.length;
  let cpv = 0, cac = 0;
  return all.map((p) => {
    cpv += pvByMonth[p] || 0;
    let acv = null;
    if (p <= month(sd)) {
      if (acFromTasks) {
        const end = iso(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0));
        acv = _acFromHours(leaves, end < sd ? end : sd);
      } else { cac += acByMonth[p] || 0; acv = cac; }
    }
    return { period: p, pv: r2(base.length || tasksComplete ? cpv : null), ev: p === month(sd) ? r2(ev) : null, ac: r2(acv), bac: r2(bac) };
  });
}

/**
 * Programme / portfolio rollup from project results (projectEvm(...).rollup_input). Never across currencies; a
 * converted total only with `rates`.
 * @param {Array<{project_id, programme_id, rollup_input}>} projects
 */
function portfolioEvm(projects, { rates = null } = {}) {
  const ps = projects || [];
  const progs = {};
  for (const p of ps) { const k = p.programme_id == null ? 'none' : String(p.programme_id); (progs[k] = progs[k] || []).push(p); }
  const flat = (xs) => xs.flatMap((p) => (p.rollup_input || []));
  const programmes = Object.keys(progs).sort().map((k) => ({ programme_id: k === 'none' ? null : Number(k), projects: progs[k].length, currencies: rollupByCurrency(flat(progs[k])) }));
  const currencies = rollupByCurrency(flat(ps));
  return { programmes, currencies, converted: rates ? convert(currencies, rates) : null, never_summed_across_currencies: true, certification: CERTIFICATION };
}

module.exports = { CERTIFICATION, EV_METHODS, DEFAULT_EV_METHOD, COST_CLASSES, workingDays, spreadDays, timePhase, monthFractionTo, earnedFraction, indicators, rollupByCurrency, convert, projectEvm, portfolioEvm, sCurve };
