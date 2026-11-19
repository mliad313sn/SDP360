#!/usr/bin/env node
'use strict';
// P05 — compares measured latencies with the PROPOSED performance budgets of docs/ops/perf-budgets.json.
//
//   node tools/test/perf-budget-check.js --load=<load.js --json output>     API route classes
//   node tools/test/perf-budget-check.js --e2e=<e2e-artifacts dir>          browser pages (first usable p95)
//
// WARN MODE by default: every "over" row is printed and the exit code stays 0. The budgets are a proposal
// until the SRE owner approves them (status / approved_by in the JSON); setting the repository variable
// PERF_BUDGETS_BLOCKING=1 makes an over-budget row fail the build. A class with no sample is "no_sample",
// never "within".
const fs = require('fs');
const path = require('path');

const BUDGETS = path.join(__dirname, '..', '..', 'docs', 'ops', 'perf-budgets.json');

/** Pure: observed { class: { p95, error_rate_pct, five_xx, n } } vs budgets { class: { p95_ms, … } } → rows. */
function check(observed, budgets) {
  const rows = [];
  for (const [k, b] of Object.entries(budgets || {})) {
    const o = (observed || {})[k];
    if (!o || !o.n || o.p95 == null) { rows.push({ class: k, status: 'no_sample', budget_p95_ms: b.p95_ms }); continue; }
    const over = [];
    if (b.p95_ms != null && o.p95 > b.p95_ms) over.push(`p95 ${o.p95} ms > ${b.p95_ms} ms`);
    if (b.error_rate_pct != null && o.error_rate_pct != null && o.error_rate_pct > b.error_rate_pct) over.push(`errors ${o.error_rate_pct} % > ${b.error_rate_pct} %`);
    if (b.five_xx_max != null && o.five_xx != null && o.five_xx > b.five_xx_max) over.push(`5xx ${o.five_xx} > ${b.five_xx_max}`);
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
  const get = (k) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
  const file = JSON.parse(fs.readFileSync(get('budgets') || BUDGETS, 'utf8'));
  const blocking = String(env.PERF_BUDGETS_BLOCKING || '') === '1';
  out(`[perf-budgets] ${blocking ? 'BLOCKING' : 'WARN'} mode · status: ${file.status} · approved_by: ${file.approved_by || 'nobody yet'}`);
  let rows = [];
  if (get('load')) { const l = JSON.parse(fs.readFileSync(get('load'), 'utf8')); rows = rows.concat(check(l.classes || {}, file.api_route_classes)); }
  if (get('e2e')) rows = rows.concat(check(pageClass(get('e2e')), file.page_classes));
  if (!get('load') && !get('e2e')) { out('[perf-budgets] nothing to check (pass --load=<json> and/or --e2e=<dir>)'); return 0; }
  for (const r of rows) out(`[perf-budgets] ${r.status === 'over' ? 'OVER  ' : r.status === 'within' ? 'within' : 'no sample'} ${r.class}${r.detail ? ' — ' + r.detail : ''}${r.observed_p95_ms != null ? ` (p95 ${r.observed_p95_ms} ms, budget ${r.budget_p95_ms} ms)` : ''}`);
  const over = rows.filter((r) => r.status === 'over').length;
  if (over && !blocking) out(`[perf-budgets] ${over} class(es) over budget — warning only (PERF_BUDGETS_BLOCKING is not 1)`);
  return over && blocking ? 1 : 0;
}

module.exports = { check, pageClass, main, BUDGETS };
if (require.main === module) process.exit(main());
