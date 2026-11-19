'use strict';
// P08 §2 — each disputed definition, computed both ways on ONE fictitious dataset through the production code.
// The numbers below are the committee evidence (docs/agent-execution/P08-kpi-dossiers.md); nothing is chosen.
const test = require('node:test');
const assert = require('node:assert/strict');
const SBS = require('../tools/kpi/side-by-side');

const rows = SBS.run();
const get = (f) => rows.find((r) => r.figure === f);

test('D-01 change success: deck 50 % vs ITSM 64 % — the gap is exactly the cancelled changes', () => {
  const r = get('Change success rate');
  assert.equal(r.a.value, 50); assert.equal(r.b.value, 64);
  assert.equal(r.a.basis, '7 / 14'); assert.equal(r.b.basis, '7 / 11');
});

test('resolution SLA: stale Zoho flag vs timestamps differ on the stale ticket only', () => {
  const r = get('Resolution SLA — what "missed" means');
  assert.equal(r.a.value, 88.9); assert.equal(r.b.value, 77.8);
});

test('resolution SLA headline: closed-only vs closed + open breached', () => {
  const r = get('Resolution SLA — which tickets count');
  assert.equal(r.a.value, 88.9); assert.equal(r.b.value, 66.7);
});

test('fleet aggregation: mean of percentages ≠ pooled ratio when volumes differ', () => {
  const r = get('Any rate across sites (fleet figure)');
  assert.equal(r.a.value, 87.5); assert.equal(r.b.value, 75.6);
});

test('D-02: the two site scores can disagree in colour on the same site', () => {
  const b = get('Site score — FX-B');
  assert.match(b.a.basis, /RED/); assert.match(b.b.basis, /green/);
});

test('D-03: tracker fleet vs weighted roadmap objectives', () => {
  const r = get('Strategic roadmap progress');
  assert.equal(r.a.value, 22); assert.equal(r.b.value, 53);
});

test('every pair states the consequence of each choice and chooses nothing', () => {
  for (const r of rows) { assert.ok(r.consequence.length > 40, r.figure); assert.ok(r.decision, r.figure); }
  assert.ok(!/recommend|we choose|official/i.test(SBS.markdown(rows)));
});
