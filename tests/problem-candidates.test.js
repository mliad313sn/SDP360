'use strict';
// E-I02 (audit I-02) — pure recurring-incident candidate computation (fictitious fixture).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const PC = require('../services/problemCandidates');

const inc = (id, cat, sub, extra = {}) => ({ request_id: String(id), display_id: String(id), request_type: 'Incident', request_status: 'Open', pending_status: 1, category: cat, sub_category: sub, created_time: '2026-10-0' + (1 + (id % 8)) + 'T08:00:00.000Z', ...extra });

test('threshold empty / invalid → feature off, no candidate (no threshold invented)', () => {
  for (const v of ['', null, undefined, 'abc', '0', '1', '-3', '2.5']) assert.equal(PC.parseMin(v), null, String(v));
  assert.equal(PC.parseMin('3'), 3);
  const rows = [inc(1, 'Network', 'WAN'), inc(2, 'Network', 'WAN'), inc(3, 'Network', 'WAN')];
  const out = PC.computeCandidates(rows, { min: PC.parseMin(''), siteId: 4 });
  assert.equal(out.enabled, false); assert.deepEqual(out.candidates, []);
});

test('open AND closed incidents are counted; cancelled are reported apart, not counted; non-incidents ignored', () => {
  const rows = [inc(1, 'Network', 'WAN'), inc(2, 'Network', 'WAN', { pending_status: 0, request_status: 'Closed' }),
    inc(3, 'Network', 'WAN', { pending_status: 1, request_status: 'Resolved' }), inc(4, 'Network', 'WAN', { request_status: 'Cancelled' }),
    inc(5, 'Network', 'WAN', { request_type: 'Service Request' }), inc(6, 'Email', 'Issue with Email')];
  const out = PC.computeCandidates(rows, { min: 3, siteId: 4 });
  assert.equal(out.candidates.length, 1);
  const c = out.candidates[0];
  assert.equal(c.count, 3); assert.equal(c.open, 1); assert.equal(c.closed, 2);
  assert.equal(out.cancelled, 1); assert.equal(out.incidents, 4);
  assert.equal(c.source_key, '4|Network|WAN');
  assert.deepEqual(PC.parseSourceKey(c.source_key), { site_id: 4, category: 'Network', sub_category: 'WAN' });
  assert.match(out.wording, /causality not validated/);
});

test('site with no Zoho group → not measured (null), never 0 candidates', () => {
  const out = PC.computeCandidates([], { min: 2, siteId: 4, scoped: false });
  assert.equal(out.scoped, false); assert.equal(out.candidates, null); assert.equal(out.incidents, null);
});

test('null category / sub-category are grouped under "(none)", groups sorted by count', () => {
  const rows = [inc(1, null, null), inc(2, '', ''), inc(3, 'A', 'B'), inc(4, 'A', 'B'), inc(5, 'A', 'B')];
  const out = PC.computeCandidates(rows, { min: 2, siteId: 1 });
  assert.deepEqual(out.candidates.map((c) => [c.category, c.sub_category, c.count]), [['A', 'B', 3], ['(none)', '(none)', 2]]);
});

test('window days are bounded', () => {
  assert.equal(PC.parseDays(undefined), 90); assert.equal(PC.parseDays('3'), 90); assert.equal(PC.parseDays('30'), 30); assert.equal(PC.parseDays('9999'), 365);
});
