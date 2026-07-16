'use strict';
// Unit tests for the composite() model port — services/siteComposite.js.
//
// The port's SOURCE is docs/reference/it-review-dashboard.source.js (the boss's
// authoritative dashboard). These tests pin the EDGES and the five known quirks.
// The happy path against real data is tests/composite-fidelity.test.js.
//
// If a test here disagrees with the source, the TEST is wrong. If our code
// disagrees with the source, the CODE is wrong. Never retune the model to make
// a test pass — see docs/reference/README.md.

const test = require('node:test');
const assert = require('node:assert');
const { eMetrics, median, days } = require('../services/siteComposite');

const A = '2026-07-14';
// Minimal D — only the fields eMetrics reads.
const mk = (over = {}) => ({
  site_code: 'HGO', department: 'mining', meeting_date: '2026-05-02',
  submitted_at: '2026-05-02 10:00:00',
  dept_head_signed_at: '2026-05-03 09:00:00', site_it_signed_at: '2026-05-03 09:01:00',
  next_meeting_date: '2026-06-02', priority_1: 'do the thing', ...over,
});

test('median: odd, even, empty', () => {
  assert.strictEqual(median([3, 1, 2]), 2);
  assert.strictEqual(median([4, 1, 2, 3]), 2.5);
  assert.strictEqual(median([]), null);
});

test('days: whole-day UTC difference', () => {
  assert.strictEqual(days('2026-07-14', '2026-07-04'), 10);
  assert.strictEqual(days('2026-07-14', '2026-07-14'), 0);
});

test('eMetrics: no meetings → all zeros', () => {
  assert.deepStrictEqual(eMetrics('HGO', { meetings: [], issues: [] }, A),
    { e1: 0, e2: 0, e3: 0, e5: 0, cov: 0, nextRate: 0 });
});

test('e2: both signatures within 48h counts; beyond 48h does not', () => {
  const D = { meetings: [
    mk({ dept_head_signed_at: '2026-05-03 09:00:00', site_it_signed_at: '2026-05-03 09:00:00' }),          // ~23h → ok
    mk({ dept_head_signed_at: '2026-05-05 11:00:00', site_it_signed_at: '2026-05-05 11:00:00' }),          // ~73h → no
  ], issues: [] };
  assert.strictEqual(eMetrics('HGO', D, A).e2, 50);
});

test('e2: a half-signed PV never counts', () => {
  const D = { meetings: [mk({ site_it_signed_at: null })], issues: [] };
  assert.strictEqual(eMetrics('HGO', D, A).e2, 0);
});

test('e3: share of issues with a non-blank champion', () => {
  const D = { meetings: [mk()], issues: [
    { site_code: 'HGO', meeting_date: '2026-05-02', champion: 'Amina' },
    { site_code: 'HGO', meeting_date: '2026-05-02', champion: '   ' },   // blank → not counted
  ] };
  assert.strictEqual(eMetrics('HGO', D, A).e3, 50);
});

test('e5 needs BOTH next_meeting_date and a non-blank priority_1', () => {
  const D = { meetings: [
    mk(), mk({ priority_1: '  ' }), mk({ next_meeting_date: null }),
  ], issues: [] };
  assert.strictEqual(eMetrics('HGO', D, A).e5, 33);   // 1 of 3
});

test('nextRate counts next_meeting_date alone (no priority_1 requirement)', () => {
  const D = { meetings: [mk({ priority_1: '' }), mk({ next_meeting_date: null })], issues: [] };
  assert.strictEqual(eMetrics('HGO', D, A).nextRate, 50);
});

// QUIRK 1 — documented, not fixed. cov has a hardcoded /12 and no upper clamp.
test('QUIRK: cov = round(100 * depts/12) and is NOT clamped — >12 depts exceeds 100', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(dep => mk({ department: dep }));
  assert.strictEqual(eMetrics('HGO', { meetings: six, issues: [] }, A).cov, 50);   // 6/12
  const fifteen = Array.from({ length: 15 }, (_, i) => mk({ department: 'd' + i }));
  const cov = eMetrics('HGO', { meetings: fifteen, issues: [] }, A).cov;
  assert.strictEqual(cov, 125);   // NOT clamped. This is the source's behaviour — port, don't fix.
});

test('e1: cadence = dept-months held / (depts x months since first meeting)', () => {
  // one dept, meeting every month Apr→Jul, asOf in Jul → 4/4 = 100
  const D = { meetings: ['2026-04-02', '2026-05-02', '2026-06-02', '2026-07-02'].map(dt => mk({ meeting_date: dt })), issues: [] };
  assert.strictEqual(eMetrics('HGO', D, A).e1, 100);
});

test('eMetrics ignores other sites', () => {
  const D = { meetings: [mk(), mk({ site_code: 'MGO', department: 'other' })], issues: [] };
  assert.strictEqual(eMetrics('HGO', D, A).cov, 8);   // 1 dept / 12
});
