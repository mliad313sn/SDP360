'use strict';
// UX committee ia-value 8 (DATA RULE): the Executive Scorecard must not show "Resolution SLA 100%" (green) for a period
// with 0 tickets. The month rows carry null rates when nothing was raised, and the headline helper returns null —
// so the tile keeps its "—" placeholder and no colour.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'executive.html'), 'utf8').replace(/\r\n/g, '\n');

test('month rows: 0 inbound → null SLA rates, never 100 / 0', () => {
  assert.match(SRC, /slaCompliancePct: m\.inbound>0 \? [^:]+ : null,/);
  assert.match(SRC, /slaViolatedPct:\s+m\.inbound>0 \? [^:]+ : null,/);
  assert.match(SRC, /slaViolatedPct: m\.inbound>0\?[^:]+:null,/);
  assert.ok(!/slaCompliancePct: m\.inbound>0 \? [^:]+ : 100,/.test(SRC), 'no 100% default left');
});

test('headline helper: a zero-ticket row and a row without the violated % both read null', () => {
  const start = SRC.indexOf('    const _slaZeroBase = function(row) {');
  const end = SRC.indexOf('    if (sumRows.length > 0) {', start);
  assert.ok(start > 0 && end > start, 'helper found');
  const run = (row, prebuilt) => { const ctx = { row, isPrebuiltView: prebuilt, _slaUseIO: false, _SLA_IO: 'x' };
    vm.runInNewContext(SRC.slice(start, end) + '\nthis.out = _slaComplianceFromRow(row);', ctx); return ctx.out; };
  assert.strictEqual(run({ month: 'Nov 2026', inbound: 0, closed: 0, slaViolatedPct: null, slaCompliancePct: null }, false), null);
  assert.strictEqual(run({ Requests: 0, '% of SLA Violated': '' }, true), null);
  assert.strictEqual(run({ Requests: 12, '% of SLA Violated': '' }, true), null, 'no rate in the source = unknown, not 100');
  assert.strictEqual(run({ Requests: 12, '% of SLA Violated': '25' }, true), 75);
  assert.strictEqual(run({ inbound: 10, slaCompliancePct: 90 }, false), 90);
});

test('the static markup ships "—", never demo figures (a11y-fr F9)', () => {
  for (const id of ['kv-tickets', 'kv-sla']) assert.match(SRC, new RegExp('id="' + id + '">—<'), id);
  assert.ok(!/1,629|Dec: 1,472|▲ \+11%/.test(SRC.slice(SRC.indexOf('<body'), SRC.indexOf('<script', SRC.indexOf('<body') + 2000))), 'no demo figure in the first screen');
});
