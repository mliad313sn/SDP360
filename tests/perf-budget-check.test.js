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
  assert.strictEqual(PB.main([`--budgets=${budgets}`, `--e2e=${path.join(dir, 'none')}`], { PERF_BUDGETS_BLOCKING: '1' }, () => {}), 0);
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
