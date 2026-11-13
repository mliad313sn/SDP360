'use strict';
// W3-GOVERNANCE (PPM parity G2 / T9) — composite project RAG with HYSTERESIS. PURE: no I/O, no clock, no database.
// ADR: docs/ai-decisions/ADR-W3-GOVERNANCE-executive-governance.md.
//
// Four measured inputs, each coloured on its own with an ENTER and an EXIT threshold (the hysteresis band keeps a
// project that hovers around a limit from flipping colour every day):
//   spi        schedule performance index (EV / PV, W1-EVM)            lower is worse
//   slip_wd    forecast finish − baseline finish, in WORKING days      higher is worse
//   cpi        cost performance index (EV / AC, W1-EVM)                lower is worse
//   risk_score highest probability × impact (1..3 × 1..3) of an OPEN risk or issue   higher is worse
// Components: schedule = worse of spi / slip_wd · cost = cpi · risk = risk_score. Composite = the worst component.
// UNKNOWN is null, never green: a metric with no value is null and is left out; a component with no measured metric
// is null. The composite is null unless the schedule or the cost is measured — an empty risk register alone never
// makes a project green (a measured RED / AMBER risk still colours it).
//
// Threshold semantics (each pinned by a boundary test in tests/ppm-w3-pure.test.js):
//   lower-is-worse   red when v < red_enter; a RED metric stays RED until v >= red_exit; then AMBER until
//                    v >= amber_exit. amber when v < amber_enter. Green otherwise.
//   higher-is-worse  red when v > red_enter; a RED metric stays RED until v <= red_exit; then AMBER until
//                    v <= amber_exit. amber when v > amber_enter.
// The DEFAULT thresholds are PROPOSED (taken from the W0 matrix row G2: RED if SPI < 0.90 or CPI < 0.90 or slip > 10
// working days or an open severe risk; AMBER 0.90–0.95 / slip ≤ 10 d / a high risk). They are NOT approved by the PMO;
// report_config ppm_rag_thresholds overrides them (JSON, same shape).

const PROPOSED_STATUS = 'PROPOSED — thresholds not approved by the PMO; set report_config ppm_rag_thresholds once they are';
const DEFAULT_THRESHOLDS = Object.freeze({
  spi: Object.freeze({ dir: 'low', red_enter: 0.90, red_exit: 0.92, amber_enter: 0.95, amber_exit: 0.97 }),
  cpi: Object.freeze({ dir: 'low', red_enter: 0.90, red_exit: 0.92, amber_enter: 0.95, amber_exit: 0.97 }),
  slip_wd: Object.freeze({ dir: 'high', red_enter: 10, red_exit: 8, amber_enter: 0, amber_exit: 0 }),
  risk_score: Object.freeze({ dir: 'high', red_enter: 8, red_exit: 8, amber_enter: 5, amber_exit: 5 }),
});
const METRICS = Object.keys(DEFAULT_THRESHOLDS);
const RANK = { green: 0, amber: 1, red: 2 };
const RAGS = ['green', 'amber', 'red'];
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** A threshold set is coherent when its band edges are ordered (red band inside the amber band, exit beyond enter). */
function _coherent(t) {
  const k = ['red_enter', 'red_exit', 'amber_enter', 'amber_exit'];
  if (!t || !['low', 'high'].includes(t.dir) || k.some((x) => num(t[x]) == null)) return false;
  return t.dir === 'low'
    ? t.red_enter <= t.red_exit && t.red_enter <= t.amber_enter && t.amber_enter <= t.amber_exit && t.red_exit <= t.amber_exit
    : t.red_enter >= t.red_exit && t.red_enter >= t.amber_enter && t.amber_enter >= t.amber_exit && t.red_exit >= t.amber_exit;
}

/**
 * report_config ppm_rag_thresholds (JSON, partial allowed) merged over the PROPOSED defaults. An incoherent or
 * unparseable entry keeps the default and is listed in `problems` (never a silent half-applied threshold).
 */
function parseThresholds(raw) {
  const out = {}; const problems = [];
  let given = {};
  if (raw != null && String(raw).trim() !== '') {
    try { given = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { problems.push('ppm_rag_thresholds is not valid JSON — the PROPOSED defaults apply'); given = {}; }
  }
  for (const m of METRICS) {
    const d = DEFAULT_THRESHOLDS[m];
    if (given && given[m] != null) {
      const t = { dir: d.dir };
      for (const k of ['red_enter', 'red_exit', 'amber_enter', 'amber_exit']) t[k] = num(given[m][k] != null ? given[m][k] : d[k]);
      if (_coherent(t)) { out[m] = t; continue; }
      problems.push(`${m}: thresholds are not ordered (red band inside the amber band, exit beyond enter) — the PROPOSED default applies`);
    }
    out[m] = { ...d };
  }
  const configured = !!(given && METRICS.some((m) => given[m] != null)) && !problems.length;
  return { thresholds: out, problems, status: configured ? 'configured in report_config ppm_rag_thresholds' : PROPOSED_STATUS };
}

/**
 * One metric's colour given its previous colour (hysteresis). v null → null (not measured).
 * @param {number|null} v
 * @param {{dir:'low'|'high', red_enter:number, red_exit:number, amber_enter:number, amber_exit:number}} t
 * @param {'green'|'amber'|'red'|null} prev
 */
function metricRag(v, t, prev) {
  const x = num(v);
  if (x == null) return null;
  const worse = t.dir === 'low' ? (a, b) => a < b : (a, b) => a > b;           // "x is beyond limit b, worse side"
  const atLeast = t.dir === 'low' ? (a, b) => a >= b : (a, b) => a <= b;       // "x has recovered to limit b"
  if (worse(x, t.red_enter)) return 'red';
  if (prev === 'red') { if (!atLeast(x, t.red_exit)) return 'red'; return atLeast(x, t.amber_exit) ? 'green' : 'amber'; }
  if (worse(x, t.amber_enter)) return 'amber';
  if (prev === 'amber' && !atLeast(x, t.amber_exit)) return 'amber';
  return 'green';
}

const worst = (list) => { const k = list.filter((r) => r != null); return k.length ? k.reduce((a, b) => (RANK[b] > RANK[a] ? b : a)) : null; };

/**
 * @param {{spi?:number|null, cpi?:number|null, slip_wd?:number|null, risk_score?:number|null}} inputs
 * @param {{metrics?:Object<string,string|null>}|null} prev  the previously stored state (hysteresis memory)
 * @param {object} [thresholds]  parseThresholds(...).thresholds; defaults to the PROPOSED set
 * @returns {{rag:string|null, components:object, state:{metrics:object, rag:string|null}, measured:string[]}}
 */
function computeRag(inputs, prev, thresholds) {
  const T = thresholds || parseThresholds(null).thresholds;
  const pm = (prev && prev.metrics) || {};
  const metrics = {};
  for (const m of METRICS) metrics[m] = { value: num((inputs || {})[m]), rag: metricRag((inputs || {})[m], T[m], RAGS.includes(pm[m]) ? pm[m] : null) };
  const components = {
    schedule: { rag: worst([metrics.spi.rag, metrics.slip_wd.rag]), spi: metrics.spi, slip_wd: metrics.slip_wd },
    cost: { rag: metrics.cpi.rag, cpi: metrics.cpi },
    risk: { rag: metrics.risk_score.rag, risk_score: metrics.risk_score },
  };
  let rag;
  if (components.schedule.rag == null && components.cost.rag == null) rag = components.risk.rag === 'red' || components.risk.rag === 'amber' ? components.risk.rag : null;
  else rag = worst([components.schedule.rag, components.cost.rag, components.risk.rag]);
  const state = { rag, metrics: Object.fromEntries(METRICS.map((m) => [m, metrics[m].rag])) };
  return { rag, components, state, measured: METRICS.filter((m) => metrics[m].value != null) };
}

module.exports = { computeRag, metricRag, parseThresholds, DEFAULT_THRESHOLDS, METRICS, PROPOSED_STATUS };
