'use strict';
// F-DATA-12 — widget catalogue with a decision column (docs/ops/WIDGET-CATALOGUE.md).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../tools/agent/widget-catalogue');
const { SEED_DASHBOARDS } = require('../services/dashboardSeeds');

test('the committed catalogue is up to date (node tools/agent/widget-catalogue.js)', () => {
  assert.strictEqual(W.main(['--check']), 0);
});

test('--check detects a stale file', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wcat-')), 'WIDGET-CATALOGUE.md');
  fs.writeFileSync(tmp, W.build().markdown + '\nhand edit\n');
  const err = console.error; console.error = () => {};
  try { assert.strictEqual(W.main(['--check'], { out: tmp }), 1); } finally { console.error = err; }
  fs.writeFileSync(tmp, W.build().markdown);
  assert.strictEqual(W.main(['--check'], { out: tmp }), 0);
});

test('one row per shipped widget; decision blank ("not stated") and nothing invented', () => {
  const { rows, markdown } = W.build();
  const shipped = SEED_DASHBOARDS.reduce((n, d) => n + d.widgets.length, 0);
  assert.ok(rows.filter((r) => !r.draft).length === shipped);
  for (const r of rows) {
    assert.ok(r.decision === 'not stated', `${r.dashboard}#${r.widget} carries a decision nobody wrote`);
    assert.ok(r.question === 'not stated');
    if (r.metric) assert.ok(r.owner === 'to be named' || r.owner.length > 0);
    assert.ok(!/unknown render/.test(r.states), `${r.type} has no states entry`);
  }
  assert.match(markdown, /kpi-dictionary\.html.*retire or redirect — decision pending/);
  assert.match(markdown, /publication\.html.*retire or redirect — decision pending/);
});

test('stated fields flow through; a source job and a threshold source are named', () => {
  const { rows } = W.build();
  const sla = rows.find((r) => r.dashboard === 'exec-home' && r.widget === 'k-sla');
  assert.match(sla.source, /zoho\.requests/);
  assert.match(sla.threshold, /sla-percent/);
  const text = rows.find((r) => r.type === 'text');
  assert.strictEqual(text.metric, '');
  assert.strictEqual(text.threshold, '—');
});
