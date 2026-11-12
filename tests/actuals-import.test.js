'use strict';
// B8 — Pronto actuals FILE import, pure: mapping validation, row errors, aggregation, reconciliation.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const AI = require('../services/actualsImport');

const CSV = fs.readFileSync(path.join(__dirname, 'fixtures', 'pronto', 'actuals-sample.csv'));
const MAP = { columns: { project_key: 'Job Code', period: 'GL Period', currency: 'Curr', amount: 'Amount' }, date_format: 'DMY' };
const PROJECTS = new Map([['wan-2', { id: 11, key: 'WAN-2' }], ['erp-1', { id: 12, key: 'ERP-1' }]]);

test('parseFile reads a CSV (header row + data rows) with its file fingerprint', () => {
  const p = AI.parseFile(CSV, 'actuals-sample.csv');
  assert.deepEqual(p.headers, ['Job Code', 'GL Period', 'Curr', 'Amount', 'Description']);
  assert.equal(p.rows.length, 7); assert.match(p.sha256, /^[0-9a-f]{64}$/);
});

test('validateMapping names the missing column (never a silent empty import)', () => {
  const p = AI.parseFile(CSV, 'x.csv');
  assert.equal(AI.validateMapping(p.headers, MAP), null);
  const e = AI.validateMapping(p.headers, { columns: { ...MAP.columns, amount: 'Montant' } });
  assert.match(e, /Montant/);
  assert.match(AI.validateMapping(p.headers, { columns: { project_key: 'Job Code' } }), /period/);
});

test('parseAmount / parsePeriod: locale forms; an ambiguous slash date is refused without a declared format', () => {
  assert.equal(AI.parseAmount('1,234.50'), 1234.5); assert.equal(AI.parseAmount('1 234,50'), 1234.5);
  assert.equal(AI.parseAmount('1.234,50'), 1234.5); assert.equal(AI.parseAmount('-250'), -250); assert.equal(AI.parseAmount('abc'), null);
  assert.equal(AI.parsePeriod('2026-10').value, '2026-10'); assert.equal(AI.parsePeriod('2026-10-31').value, '2026-10');
  assert.equal(AI.parsePeriod('10/2026').value, '2026-10');
  assert.equal(AI.parsePeriod('05/10/2026').error, 'AMBIGUOUS_DATE');
  assert.equal(AI.parsePeriod('05/10/2026', 'DMY').value, '2026-10');
  assert.equal(AI.parsePeriod('05/10/2026', 'MDY').value, '2026-05');
  assert.equal(AI.parsePeriod('25/10/2026').value, '2026-10', 'day > 12 is not ambiguous');
});

test('dryRun: row-level errors, lines aggregated per project × period × currency (credits netted)', () => {
  const p = AI.parseFile(CSV, 'x.csv');
  const d = AI.dryRun(p.rows, MAP, PROJECTS);
  assert.equal(d.rows_total, 7);
  assert.deepEqual(d.errors.map((e) => [e.row, e.field]), [[6, 'project_key'], [7, 'currency']]);
  assert.equal(d.rows_ok, 5);
  const wan = d.aggregates.find((a) => a.project_key === 'WAN-2' && a.period === '2026-10' && a.currency === 'XOF');
  assert.equal(wan.amount, 1250000); assert.equal(wan.lines, 3, 'three GL lines, one credit, netted');
  assert.ok(!d.aggregates.some((a) => a.amount < 0));
});

test('dryRun: a key whose lines net below zero is an error, not a negative actual', () => {
  const rows = [{ 'Job Code': 'WAN-2', 'GL Period': '2026-10', Curr: 'USD', Amount: '-5' }];
  const d = AI.dryRun(rows, MAP, PROJECTS);
  assert.equal(d.aggregates.length, 0); assert.equal(d.errors[0].field, 'amount');
});

test('reconcile: new / changed / unchanged per key, existing actuals not in the file listed, totals per currency', () => {
  const agg = [{ project_id: 11, project_key: 'WAN-2', period: '2026-10', currency: 'XOF', amount: 1250000, lines: 3 },
    { project_id: 12, project_key: 'ERP-1', period: '2026-10', currency: 'USD', amount: 900, lines: 1 },
    { project_id: 12, project_key: 'ERP-1', period: '2026-09', currency: 'USD', amount: 400, lines: 1 }];
  const existing = [
    { project_id: 11, period: '2026-10', currency: 'XOF', kind: 'baseline', amount: 1000000 },
    { project_id: 11, period: '2026-10', currency: 'XOF', kind: 'actual', amount: 1000000 },
    { project_id: 12, period: '2026-09', currency: 'USD', kind: 'actual', amount: 400 },
    { project_id: 12, period: '2026-08', currency: 'USD', kind: 'actual', amount: 50 },
  ];
  const r = AI.reconcile(agg, existing);
  const st = (k, p) => r.lines.find((l) => l.project_key === k && l.period === p).status;
  assert.equal(st('WAN-2', '2026-10'), 'changed'); assert.equal(st('ERP-1', '2026-10'), 'new'); assert.equal(st('ERP-1', '2026-09'), 'unchanged');
  const w = r.lines.find((l) => l.project_key === 'WAN-2');
  assert.equal(w.baseline, 1000000); assert.equal(w.existing_actual, 1000000); assert.equal(w.delta, 250000);
  assert.equal(r.summary.to_write, 2);
  assert.deepEqual(r.not_in_file.map((x) => x.period), ['2026-08']);
  assert.deepEqual(r.totals.map((t) => t.currency), ['USD', 'XOF']);
  assert.equal(r.totals.find((t) => t.currency === 'USD').imported, 1300);
  assert.equal(r.never_summed_across_currencies, true);
});
