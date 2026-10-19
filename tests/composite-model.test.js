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
const { eMetrics, median, days, composite } = require('../services/siteComposite');

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

// ── composite() ─────────────────────────────────────────────────────────────

// QUIRK 5
test('composite: empty issue log scores 100 on the odRate term', () => {
  const D = { meetings: [mk()], issues: [], inspections: [], findings: [] };
  const c = composite('HGO', D, A);
  assert.strictEqual(c.open, 0);
  assert.strictEqual(c.odRate, 0);       // empty backlog → 0% overdue → (100-0)*0.4 contributes fully
});

// QUIRK 3
test('QUIRK: mttrIdx defaults to 60 when the site has resolved nothing', () => {
  const D = { meetings: [mk()], issues: [
    { site_code: 'HGO', meeting_date: '2026-05-02', status: 'open', severity: 'LOW' },
  ], inspections: [], findings: [] };
  const c = composite('HGO', D, A);
  // del = (100-0)*0.4 + 60*0.3 + (100-0)*0.3 = 40 + 18 + 30 = 88
  assert.strictEqual(c.del, 88);
});

// QUIRK 2
test('QUIRK: pen is +5 once for a HIGH open >90d, and +3 per stale escalated issue (uncapped)', () => {
  const old = '2026-01-01';   // >90d before A
  const D = { meetings: [mk()], inspections: [], findings: [], issues: [
    { site_code: 'HGO', meeting_date: old, status: 'open', severity: 'HIGH' },
  ] };
  assert.strictEqual(composite('HGO', D, A).pen, 5);

  const D2 = { meetings: [mk()], inspections: [], findings: [], issues: [
    { site_code: 'HGO', meeting_date: old, status: 'open', severity: 'LOW', escalate: '1' },
    { site_code: 'HGO', meeting_date: old, status: 'open', severity: 'LOW', escalate: '1' },
  ] };
  assert.strictEqual(composite('HGO', D2, A).pen, 6);   // 3+3, no HIGH → no +5
});

test('composite: score is floored at 0 but has NO upper clamp', () => {
  // the floor
  const old = '2026-01-01';
  const many = Array.from({ length: 40 }, () => ({ site_code: 'HGO', meeting_date: old, status: 'open', severity: 'HIGH', escalate: '1' }));
  const D = { meetings: [mk()], inspections: [], findings: [], issues: many };
  assert.strictEqual(composite('HGO', D, A).score, 0);   // Math.max(0, ...) — never negative
});

// QUIRK 4 — the fleet dependency. This is why composite() takes the whole D.
// Constructing this test is subtle; get it wrong and it fails against a CORRECT
// port (which, under this plan's "if it disagrees, our code is wrong" doctrine,
// would get the PORT broken to satisfy a broken test). Two traps:
//   a) source line 110 filters allRes with `c && c <= A` — fleet rows closing
//      AFTER asOf never enter the fleet median at all.
//   b) source line 112 clamps: mttrIdx = min(100, 100*fleetMttr/max(mttr,1)).
//      A fleet SLOWER than the site drives the ratio >100 → clamped → no effect.
// So: the site must be SLOW, the fleet FAST, and everything closed on/before asOf.
// Verified against the source: alone.del = 100, withFleet.del = 72.
test('QUIRK: fleetMttr is computed across ALL sites — another site changes this site score', () => {
  const slow = [{ site_code: 'HGO', meeting_date: '2026-01-01', status: 'resolved', closed_at: '2026-04-11', severity: 'LOW' }];  // 100 d
  const fast = (s) => ({ site_code: s, meeting_date: '2026-05-01', status: 'resolved', closed_at: '2026-05-06', severity: 'LOW' }); // 5 d
  const alone = composite('HGO', { meetings: [mk()], issues: slow, inspections: [], findings: [] }, A);
  const withFleet = composite('HGO', { meetings: [mk()], inspections: [], findings: [],
    issues: [...slow, fast('MGO'), fast('SGO')] }, A);
  assert.strictEqual(alone.del, 100);
  assert.strictEqual(withFleet.del, 72);
  assert.notStrictEqual(alone.del, withFleet.del);   // the SAME site, scored differently
});
