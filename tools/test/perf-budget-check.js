#!/usr/bin/env node
'use strict';
// P05 — compares measured latencies with the PROPOSED performance budgets of docs/ops/perf-budgets.json.
//
//   node tools/test/perf-budget-check.js --load=<load.js --json output>     API route classes (a bare path = --load)
//   node tools/test/perf-budget-check.js --e2e=<e2e-artifacts dir>          browser pages (first usable p95)
//
// WARN MODE by default: every "over" row is printed and the exit code stays 0. The budgets are a proposal
// until the SRE owner approves them (status / approved_by in the JSON); setting the repository variable
// PERF_BUDGETS_BLOCKING=1 makes an over-budget row fail the build. A class with no sample is "no_sample",
// never "within" — and in blocking mode one unsampled class fails the check (P11 r7 O-5). P11 r8 O-5 residual: a class
// measured with fewer than the minimum sample count (min_samples_per_class in the JSON, default 5 — PROPOSED, the SRE
// owner decides) is "insufficient_sample", never "within": one request is not evidence. An over-budget row stays "over".
const fs = require('fs');
const path = require('path');

const BUDGETS = path.join(__dirname, '..', '..', 'docs', 'ops', 'perf-budgets.json');

const MIN_SAMPLES_DEFAULT = 5;   // PROPOSED (P11 r8 O-5 residual) — not an approved figure
/** Pure: observed { class: { p95, error_rate_pct, five_xx, n } } vs budgets { class: { p95_ms, min_samples?, … } } → rows. */
function check(observed, budgets, { minSamples = MIN_SAMPLES_DEFAULT } = {}) {
  const rows = [];
  for (const [k, b] of Object.entries(budgets || {})) {
    const o = (observed || {})[k];
    if (!o || !o.n || o.p95 == null) { rows.push({ class: k, status: 'no_sample', budget_p95_ms: b.p95_ms }); continue; }
    const over = [];
    if (b.p95_ms != null && o.p95 > b.p95_ms) over.push(`p95 ${o.p95} ms > ${b.p95_ms} ms`);
    if (b.error_rate_pct != null && o.error_rate_pct != null && o.error_rate_pct > b.error_rate_pct) over.push(`errors ${o.error_rate_pct} % > ${b.error_rate_pct} %`);
    if (b.five_xx_max != null && o.five_xx != null && o.five_xx > b.five_xx_max) over.push(`5xx ${o.five_xx} > ${b.five_xx_max}`);
    const min = Number.isFinite(Number(b.min_samples)) && Number(b.min_samples) > 0 ? Number(b.min_samples) : minSamples;
    if (!over.length && !(Number(o.n) >= min))   /* P11 r9 R9-A5: a non-numeric n is not evidence */ { rows.push({ class: k, status: 'insufficient_sample', observed_p95_ms: o.p95, budget_p95_ms: b.p95_ms, n: o.n, min_samples: min, detail: `${o.n} sample(s) < minimum ${min}` }); continue; }
    rows.push({ class: k, status: over.length ? 'over' : 'within', observed_p95_ms: o.p95, budget_p95_ms: b.p95_ms, n: o.n, detail: over.join('; ') });
  }
  return rows;
}

/** Browser pages: one "page" class sample per page = its first-usable p95 (load p95 when absent). */
function pageClass(dir) {
  const PB = require('./perf-baseline');
  const agg = PB.aggregate(PB.loadArtefacts(dir));
  const rows = Object.entries(agg.pages).map(([k, s]) => ({ path: k, p95: (s.first_usable_ms && s.first_usable_ms.p95) != null ? s.first_usable_ms.p95 : s.load_ms.p95 }))
    .filter((x) => x.p95 != null);
  if (!rows.length) return { page: { n: 0, p95: null } };
  const worst = rows.reduce((a, b) => (b.p95 > a.p95 ? b : a));
  return { page: { n: rows.length, p95: worst.p95, worst_path: worst.path } };
}

function main(argv = process.argv.slice(2), env = process.env, out = (s) => process.stdout.write(s + '\n')) {
  // P11 r5 F-07b — a bare path (no --load=) is the load file: in blocking mode it used to print "nothing to check" and pass.
  const positional = argv.filter((x) => !x.startsWith('--'));
  const get = (k) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); if (a) return a.slice(k.length + 3); return k === 'load' && positional.length ? positional[0] : null; };
  const file = JSON.parse(fs.readFileSync(get('budgets') || BUDGETS, 'utf8'));
  const blocking = String(env.PERF_BUDGETS_BLOCKING || '') === '1';
  out(`[perf-budgets] ${blocking ? 'BLOCKING' : 'WARN'} mode · status: ${file.status} · approved_by: ${file.approved_by || 'nobody yet'}`);
  let rows = [];
  const opt = { minSamples: Number.isFinite(Number(file.min_samples_per_class)) && Number(file.min_samples_per_class) > 0 ? Number(file.min_samples_per_class) : MIN_SAMPLES_DEFAULT };
  if (get('load')) { const l = JSON.parse(fs.readFileSync(get('load'), 'utf8')); rows = rows.concat(check(l.classes || {}, file.api_route_classes, opt)); }
  if (get('e2e')) rows = rows.concat(check(pageClass(get('e2e')), file.page_classes, opt));
  if (!get('load') && !get('e2e')) { out('[perf-budgets] nothing to check (pass --load=<json> and/or --e2e=<dir>)'); return blocking ? 1 : 0; }
  for (const r of rows) out(`[perf-budgets] ${r.status === 'over' ? 'OVER  ' : r.status === 'within' ? 'within' : r.status === 'insufficient_sample' ? 'too few samples' : 'no sample'} ${r.class}${r.detail ? ' — ' + r.detail : ''}${r.observed_p95_ms != null ? ` (p95 ${r.observed_p95_ms} ms, budget ${r.budget_p95_ms} ms)` : ''}`);
  const over = rows.filter((r) => r.status === 'over').length;
  // P11 r6 O-5 — a load file that measured nothing ("no sample" everywhere) is not a pass in blocking mode.
  const measured = rows.filter((r) => r.status === 'within' || r.status === 'over' || r.status === 'insufficient_sample').length;
  if (!measured) { out(`[perf-budgets] no class was measured (${rows.length} class(es), all "no sample")${blocking ? ' — blocking mode fails' : ''}`); if (blocking) return 1; }
  // P11 r7 O-5 — no data is not a pass: in blocking mode EVERY budget class checked must have a sample
  const unsampled = rows.filter((r) => r.status === 'no_sample');
  if (measured && unsampled.length) {
    out(`[perf-budgets] ${unsampled.length} of ${rows.length} budget class(es) have no sample (${unsampled.map((r) => r.class).join(', ')})${blocking ? ' — blocking mode fails' : ' — warning only'}`);
    if (blocking) return 1;
  }
  // P11 r8 O-5 residual — too few samples is not evidence: blocking mode fails
  const thin = rows.filter((r) => r.status === 'insufficient_sample');
  if (thin.length) {
    out(`[perf-budgets] ${thin.length} budget class(es) measured with fewer samples than the minimum (${thin.map((r) => `${r.class} n=${r.n} < ${r.min_samples}`).join(', ')})${blocking ? ' — blocking mode fails' : ' — warning only'}`);
    if (blocking) return 1;
  }
  if (over && !blocking) out(`[perf-budgets] ${over} class(es) over budget — warning only (PERF_BUDGETS_BLOCKING is not 1)`);
  return over && blocking ? 1 : 0;
}

module.exports = { check, pageClass, main, BUDGETS, MIN_SAMPLES_DEFAULT };
if (require.main === module) process.exit(main());
