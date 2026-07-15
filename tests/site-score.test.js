'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeSiteScore } = require('../services/siteScore');

const perfect = {
  meetings: { pvs_held: 3, pvs_target: 3, resolved: 10, open_issues: 0, overdue_actions_count: 0, signoff_pct: 100 },
  inspection: { inspections_done: 1, findings_critical_major: 0 },
};

test('perfect inputs → 100 / green', () => {
  const r = computeSiteScore(perfect.meetings, perfect.inspection);
  assert.strictEqual(r.composite, 100);
  assert.strictEqual(r.rag, 'green');
});

test('weights sum to 1.0 (composite never exceeds 100)', () => {
  const r = computeSiteScore(perfect.meetings, perfect.inspection);
  assert.ok(r.composite <= 100);
});

test('RAG cutoffs at 45 and 70', () => {
  assert.strictEqual(computeSiteScore(
    { pvs_held: 3, pvs_target: 3, resolved: 7, open_issues: 3, overdue_actions_count: 0, signoff_pct: 100 },
    { inspections_done: 1, findings_critical_major: 0 }).rag, 'green');
  const amber = computeSiteScore(
    { pvs_held: 1, pvs_target: 3, resolved: 3, open_issues: 3, overdue_actions_count: 2, signoff_pct: 50 },
    { inspections_done: 1, findings_critical_major: 1 });
  assert.ok(amber.composite >= 45 && amber.composite < 70, `expected amber, got ${amber.composite}`);
  assert.strictEqual(amber.rag, 'amber');
  const red = computeSiteScore(
    { pvs_held: 0, pvs_target: 3, resolved: 0, open_issues: 5, overdue_actions_count: 5, signoff_pct: 0 },
    { inspections_done: 0, findings_critical_major: 3 });
  assert.ok(red.composite < 45, `expected red, got ${red.composite}`);
  assert.strictEqual(red.rag, 'red');
});

test('resolution_pct is 100 when there are no issues at all', () => {
  const r = computeSiteScore(
    { pvs_held: 3, pvs_target: 3, resolved: 0, open_issues: 0, overdue_actions_count: 0, signoff_pct: 100 },
    { inspections_done: 1, findings_critical_major: 0 });
  assert.strictEqual(r.dimensions.resolution_pct, 100);
});

test('two_moves ranks by weight × recoverable gap, with template text + gain_pts', () => {
  const r = computeSiteScore(
    { pvs_held: 0, pvs_target: 3, resolved: 5, open_issues: 5, overdue_actions_count: 0, signoff_pct: 100 },
    { inspections_done: 1, findings_critical_major: 0 });
  assert.strictEqual(r.two_moves.length, 2);
  assert.match(r.two_moves[0].text, /PV|department|review/i);
  assert.ok(r.two_moves[0].gain_pts >= r.two_moves[1].gain_pts);
  assert.strictEqual(typeof r.two_moves[0].gain_pts, 'number');
});

test('trend_pts is null when no previous composite is supplied', () => {
  const r = computeSiteScore(perfect.meetings, perfect.inspection, null);
  assert.strictEqual(r.trend_pts, null);
});

test('trend_pts = composite − previous when supplied', () => {
  const r = computeSiteScore(perfect.meetings, perfect.inspection, 80);
  assert.strictEqual(r.trend_pts, 20);
});
