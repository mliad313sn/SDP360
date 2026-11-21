'use strict';
// P05 — PROPOSED performance budgets (docs/ops/perf-budgets.json), the warn-mode checker and the load
// harness additions that feed it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PB = require('../tools/test/perf-budget-check');
const L = require('../tools/test/load');

test('check: within, over and no sample', () => {
  const rows = PB.check({ a: { n: 5, p95: 100, error_rate_pct: 0, five_xx: 0 }, b: { n: 5, p95: 900, error_rate_pct: 3, five_xx: 2 } },
    { a: { p95_ms: 800 }, b: { p95_ms: 800, error_rate_pct: 1, five_xx_max: 0 }, c: { p95_ms: 800 } });
  const by = Object.fromEntries(rows.map((r) => [r.class, r]));
  assert.strictEqual(by.a.status, 'within');
  assert.strictEqual(by.b.status, 'over');
  assert.match(by.b.detail, /p95 900 ms > 800 ms.*errors 3 % > 1 %.*5xx 2 > 0/);
  assert.strictEqual(by.c.status, 'no_sample');
});

test('main: warn mode exits 0 on an over-budget class, blocking mode exits 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p05-budget-'));
  const budgets = path.join(dir, 'b.json'); const load = path.join(dir, 'l.json');
  fs.writeFileSync(budgets, JSON.stringify({ status: 'PROPOSED', approved_by: null, api_route_classes: { page_data: { p95_ms: 10 } } }));
  fs.writeFileSync(load, JSON.stringify({ classes: { page_data: { n: 3, p95: 50 } } }));
  const lines = []; const out = (s) => lines.push(s);
  assert.strictEqual(PB.main([`--budgets=${budgets}`, `--load=${load}`], {}, out), 0);
  assert.ok(lines.some((l) => /WARN mode/.test(l)) && lines.some((l) => /OVER/.test(l)));
  assert.strictEqual(PB.main([`--budgets=${budgets}`, `--load=${load}`], { PERF_BUDGETS_BLOCKING: '1' }, () => {}), 1);
  // P11 r6 O-5: an e2e directory with no page measured is "nothing measured" — blocking mode fails (it used to pass)
  assert.strictEqual(PB.main([`--budgets=${budgets}`, `--e2e=${path.join(dir, 'none')}`], { PERF_BUDGETS_BLOCKING: '1' }, () => {}), 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('budgets file: a proposal nobody approved, one entry per load class, each with a basis', () => {
  const b = JSON.parse(fs.readFileSync(PB.BUDGETS, 'utf8'));
  assert.match(b.status, /PROPOSED/);
  assert.strictEqual(b.approved_by, null);
  assert.strictEqual(b.approved_at, null);
  const classes = new Set(Object.values(L.CLASSES));
  for (const c of classes) {
    const e = b.api_route_classes[c];
    assert.ok(e, `no budget for class ${c}`);
    assert.ok(Number.isFinite(e.p95_ms) && e.p95_ms > 0, c);
    assert.ok(typeof e.basis === 'string' && e.basis.length > 10, c);
  }
  assert.ok(Number.isFinite(b.page_classes.page.p95_ms));
});

test('load harness: session cookie, route classes, pool aggregation', () => {
  assert.strictEqual(L.tokenFromSetCookie(['a=1; Path=/', 'report_token=abc%3D; HttpOnly']), 'abc=');
  assert.strictEqual(L.tokenFromSetCookie(undefined), null);
  assert.strictEqual(L.classOf('deck.all_sites_monthly'), 'deck_generation');
  assert.strictEqual(L.classOf('pages.sync_status'), 'sync');
  assert.strictEqual(L.classOf('nope'), 'other');
  const agg = L.aggregate([{ step: 'reports.list', ms: 10, status: 200 }, { step: 'deck.weekly', ms: 400, status: 200 }],
    { conns: [{ total: 4, active: 1, waiting: 0 }, { total: 6, active: 3, waiting: 1 }, null] });
  assert.deepStrictEqual(Object.keys(agg.classes), ['deck_generation', 'page_data']);
  assert.deepStrictEqual(agg.pool, { samples: 2, total_max: 6, active_max: 3, active_p95: 3, waiting_lock_max: 1 });
  assert.strictEqual(L.aggregate([]).pool, null);
});

// P11 r5 F-07 — the write class read OVER (errors 50 %) only because the harness's field envelope is a 400 by design.
test('F-07: designed 4xx leave the budget class (counted apart); a real 4xx/5xx still counts', () => {
  const samples = [
    { step: 'reports.save_section', ms: 100, status: 200 }, { step: 'reports.save_section', ms: 120, status: 200 },
    { step: 'field.envelope', ms: 5000, status: 400 }, { step: 'field.envelope', ms: 5000, status: 400 },
  ];
  const agg = L.aggregate(samples);
  assert.strictEqual(agg.classes.write.n, 2);
  assert.strictEqual(agg.classes.write.error_rate_pct, 0);
  assert.strictEqual(agg.classes.write.designed_4xx_excluded, 2);
  assert.ok(agg.classes.write.p95 < 1000, 'the 5 s designed rejections do not drive the write p95');
  assert.strictEqual(agg.steps['field.envelope'].errors, 2, 'still visible per step');
  assert.strictEqual(agg.overall.errors, 2, 'and overall');
  // P11 r8 O-5 residual: 2 samples is below the default minimum (5) — this test is about the 4xx split, so minimum 1
  const rows = PB.check(agg.classes, { write: { p95_ms: 1000, error_rate_pct: 1, five_xx_max: 0 } }, { minSamples: 1 });
  assert.strictEqual(rows[0].status, 'within');
  assert.strictEqual(PB.check(agg.classes, { write: { p95_ms: 1000, error_rate_pct: 1, five_xx_max: 0 } })[0].status, 'insufficient_sample');
  // a 403 on the same step, or a 500, is not designed: it counts
  const bad = L.aggregate([...samples, { step: 'field.envelope', ms: 50, status: 403 }, { step: 'reports.save_section', ms: 50, status: 500 }]);
  assert.strictEqual(bad.classes.write.errors, 2);
  assert.strictEqual(PB.check(bad.classes, { write: { p95_ms: 1000, error_rate_pct: 1, five_xx_max: 0 } })[0].status, 'over');
  // a class made only of designed answers has no sample, never "within"
  const only = L.aggregate([{ step: 'field.envelope', ms: 10, status: 400 }]);
  assert.strictEqual(only.classes.write.n, 0);
  assert.strictEqual(PB.check(only.classes, { write: { p95_ms: 1000 } })[0].status, 'no_sample');
});

// P11 r5 F-07b — `PERF_BUDGETS_BLOCKING=1 node perf-budget-check.js <json>` printed "nothing to check" and passed.
test('F-07b: a bare path is the load file; blocking mode with nothing to check fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p05-budget-pos-'));
  const budgets = path.join(dir, 'b.json'); const load = path.join(dir, 'l.json');
  fs.writeFileSync(budgets, JSON.stringify({ status: 'PROPOSED', approved_by: null, api_route_classes: { page_data: { p95_ms: 10 } } }));
  fs.writeFileSync(load, JSON.stringify({ classes: { page_data: { n: 3, p95: 50 } } }));
  const lines = [];
  assert.strictEqual(PB.main([`--budgets=${budgets}`, load], { PERF_BUDGETS_BLOCKING: '1' }, (s) => lines.push(s)), 1);
  assert.ok(lines.some((l) => /OVER/.test(l)) && !lines.some((l) => /nothing to check/.test(l)));
  assert.strictEqual(PB.main([`--budgets=${budgets}`], { PERF_BUDGETS_BLOCKING: '1' }, () => {}), 1, 'blocking + nothing to check = fail');
  assert.strictEqual(PB.main([`--budgets=${budgets}`], {}, () => {}), 0, 'warn mode stays 0');
  fs.rmSync(dir, { recursive: true, force: true });
});

// P11 r6 O-5 — a load file whose classes are all "no sample" passed a blocking gate (every missing class passed).
test('r6 O-5: blocking mode fails when no class was measured; warn mode reports it and stays 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p05-budget-empty-'));
  const budgets = path.join(dir, 'b.json'); const empty = path.join(dir, 'e.json'); const some = path.join(dir, 's.json');
  fs.writeFileSync(budgets, JSON.stringify({ status: 'PROPOSED', approved_by: null, api_route_classes: { page_data: { p95_ms: 1000 }, write: { p95_ms: 1000 } } }));
  fs.writeFileSync(empty, JSON.stringify({ classes: {} }));
  fs.writeFileSync(some, JSON.stringify({ classes: { page_data: { n: 3, p95: 50 } } }));
  const lines = [];
  assert.strictEqual(PB.main([`--budgets=${budgets}`, `--load=${empty}`], { PERF_BUDGETS_BLOCKING: '1' }, (s) => lines.push(s)), 1, 'nothing measured = fail');
  assert.ok(lines.some((l) => /no class was measured/.test(l)));
  assert.strictEqual(PB.main([`--budgets=${budgets}`, `--load=${empty}`], {}, () => {}), 0, 'warn mode stays 0');
  assert.strictEqual(PB.main([`--budgets=${budgets}`, `--load=${some}`], { PERF_BUDGETS_BLOCKING: '1' }, () => {}), 1, 'P11 r7 O-5: one class measured, one with no sample — no data is not a pass');
  fs.rmSync(dir, { recursive: true, force: true });
});
