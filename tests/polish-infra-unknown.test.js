'use strict';
// VISUAL POLISH 2026-11 / UX committee (site coordinator P1-1): a weekly-report infrastructure KPI row with no value
// typed carries NO verdict. defaultInfraRows() and a fresh addInfraRow() default to status 'none' ("— Not measured",
// « — Non mesuré »), and autoInfraStatusTrend() resets an emptied value to 'none'. Unknown is never green.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fnSource } = require('./_fn-source');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'reports.html'), 'utf8');

test('defaultInfraRows(): every default row is "none", not green', () => {
  const ctx = {}; vm.runInNewContext(fnSource(SRC, 'defaultInfraRows') + '\nthis.rows = defaultInfraRows();', ctx);
  assert.ok(ctx.rows.length >= 7);
  for (const r of ctx.rows) { assert.strictEqual(r.status_color, 'none', r.service); assert.strictEqual(r.status_value, ''); }
});

test('addInfraRow(): a fresh row defaults to "none" and the option reads "— Not measured"', () => {
  const fn = fnSource(SRC, 'addInfraRow');
  assert.match(fn, /k = k \|\| \{[^}]*status_color:'none'/);
  assert.ok(!/status_color:'green'/.test(fn), 'no green default left');
  assert.match(fn, /value="none"[^>]*>— Not measured</);
  const fr = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'i18n', 'reports.fr.js'), 'utf8');
  assert.match(fr, /'— Not measured': '— Non mesuré'/);
});

test('autoInfraStatusTrend(): an empty value resets the status to "none"; a typed value still gets its colour', () => {
  const run = (value, target) => {
    const status = { value: 'green' }, trend = { value: 'stable' };
    const tr = { querySelector: (s) => (s === '.infra-target-input' ? { value: target } : s === '.infra-status-select' ? status : trend) };
    const input = { value, dataset: {}, closest: () => tr };
    vm.runInNewContext(fnSource(SRC, 'autoInfraStatusTrend') + '\nautoInfraStatusTrend(input);', { input, updateStatusDot: () => {} });
    return status.value;
  };
  assert.strictEqual(run('', '98%'), 'none');
  assert.strictEqual(run('99', '98%'), 'green');
  assert.strictEqual(run('80', '98%'), 'red');
});

test('the Infrastructure tab turns green only when every KPI row has a typed value', () => {
  const ctx = {}; vm.runInNewContext(fnSource(SRC, '_infraComplete') + '\nthis.f = _infraComplete;', ctx);
  assert.strictEqual(ctx.f([]), false);
  assert.strictEqual(ctx.f([{ status_value: '99' }, { status_value: '' }]), false, 'one empty row = not complete');
  assert.strictEqual(ctx.f([{ status_value: '99' }, { status_value: '98.5' }]), true);
  assert.strictEqual(ctx.f(null), false);
});
