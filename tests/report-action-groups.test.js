'use strict';
// Weekly report actions — groups (2026-10-15). An action followed over several weeks is a
// CHAIN of rows sharing one group key (lineage || uid). These pure helpers decide what the
// import window may offer, how many actions each past week really still has, and the short
// visible identity of a group. Plan: docs/superpowers/plans/2026-10-06-report-actions-import-merge-identity.md
const test = require('node:test');
const assert = require('node:assert');
const G = require('../services/reportActionGroups');

// Site rows: report 24 → 25 → 28 → 29 → 30 (current). Chain A: typed W24, carried W25, closed W28.
// Chain B: typed W28 (open), carried W29. Chain C: W29 only, cancelled. Chain D: W29 open, already
// carried into the current report W30.
const row = (uid, lineage, report_id, w, status, task) => ({ uid, lineage, report_id, year: 2026, week_number: w, week_label: `W${w} 2026`, status, task: task || uid });
const SITE = [
  row('a24', null, 24, 24, 'open', 'Protection foudre'),
  row('a25', 'a24', 25, 25, 'on_hold'),
  row('a28', 'a24', 28, 28, 'closed'),
  row('b28', null, 28, 28, 'in_progress', 'Radio upgrade'),
  row('b29', 'b28', 29, 29, 'open'),
  row('c29', null, 29, 29, 'cancelled'),
  row('d29', null, 29, 29, 'open', 'VSAT'),
  row('d30', 'd29', 30, 30, 'open'),
];

test('groupKey = lineage || uid', () => {
  assert.equal(G.groupKey({ uid: 'x', lineage: 'root' }), 'root');
  assert.equal(G.groupKey({ uid: 'x', lineage: null }), 'x');
  assert.equal(G.groupKey(null), '');
});

test('shortCode is stable, short and differs between keys', () => {
  assert.equal(G.shortCode('a24'), G.shortCode('a24'));
  assert.match(G.shortCode('a24'), /^#[0-9A-Z]{4}$/);
  assert.notEqual(G.shortCode('a24'), G.shortCode('b28'));
  const h = G.hue('a24'); assert.ok(h >= 0 && h < 360);
});

test('summarizeGroups: newest row, first week and number of weeks per group', () => {
  const s = G.summarizeGroups(SITE);
  const a = s.get('a24');
  assert.equal(a.weeks, 3);
  assert.equal(a.first_week, 'W24 2026');
  assert.equal(a.newest.status, 'closed');
  assert.equal(a.newest.week_label, 'W28 2026');
  assert.equal(s.get('b28').weeks, 2);
  assert.match(a.code, /^#/);
});

test('classifySourceRows: importable or not, with the reason', () => {
  // Importing from W29 into the current report W30.
  const src = SITE.filter(r => r.report_id === 29);
  const out = G.classifySourceRows({ sourceRows: src, siteRows: SITE, currentReportId: 30 });
  const by = Object.fromEntries(out.map(r => [r.uid, r]));
  assert.equal(by.b29.importable, true);
  assert.equal(by.b29.group.key, 'b28');
  assert.equal(by.b29.group.first_week, 'W28 2026');
  assert.equal(by.c29.importable, false); assert.equal(by.c29.reason, 'cancelled');
  assert.equal(by.d29.importable, false); assert.equal(by.d29.reason, 'in_current');
});

test('classifySourceRows: a group closed in a later week is not offered', () => {
  const src = SITE.filter(r => r.report_id === 25);
  const [a25] = G.classifySourceRows({ sourceRows: src, siteRows: SITE, currentReportId: 30 });
  assert.equal(a25.importable, false);
  assert.equal(a25.reason, 'closed_since');
  assert.equal(a25.closed_week, 'W28 2026');
});

test('classifySourceRows: rows already typed in the editor (not saved) count as in the report', () => {
  const src = SITE.filter(r => r.report_id === 29);
  const out = G.classifySourceRows({ sourceRows: src, siteRows: SITE, currentReportId: 99, extraCurrentKeys: ['b28'] });
  assert.equal(out.find(r => r.uid === 'b29').reason, 'in_current');
});

test('weekCounts: only actions still worth importing are counted', () => {
  const c = G.weekCounts(SITE, 30);
  assert.equal(c.get(24) || 0, 0, 'W24: chain A closed since');
  assert.equal(c.get(25) || 0, 0, 'W25: chain A closed since');
  assert.equal(c.get(28) || 0, 1, 'W28: only chain B (A is closed there)');
  assert.equal(c.get(29) || 0, 1, 'W29: B yes, C cancelled, D already in the current report');
});
