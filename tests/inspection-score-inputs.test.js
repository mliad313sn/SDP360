'use strict';

// inspection-db.getSiteScoreInputs — the windowed measurements behind 2 of the
// 6 sbDims dimensions (inspections / findings). The pure core is tested
// directly; ONE integration test proves the REAL sqlite reader agrees with it.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-insp-score-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';

const test = require('node:test');
const assert = require('node:assert');
const idb = require('../inspection-db');
const { _computeInspectionScoreInputs } = idb;

const W = { from: '2026-04-14', to: '2026-07-14' };

test('counts inspections in the window only', () => {
  const r = _computeInspectionScoreInputs({
    inspections: [{ inspection_date: '2026-05-01' }, { inspection_date: '2026-06-01' }, { inspection_date: '2026-01-01' }, { inspection_date: '2026-08-01' }],
    findings: [],
  }, W);
  assert.strictEqual(r.inspections, 2);
});

test('counts only critical+major findings, in the window only', () => {
  const r = _computeInspectionScoreInputs({
    inspections: [],
    findings: [
      { inspection_date: '2026-05-01', status: 'critical' },
      { inspection_date: '2026-05-01', status: 'major' },
      { inspection_date: '2026-05-01', status: 'minor' },   // not counted
      { inspection_date: '2026-05-01', status: 'opp' },     // not counted
      { inspection_date: '2026-05-01', status: 'ok' },      // not counted
      { inspection_date: '2026-01-01', status: 'critical' },// out of window
    ],
  }, W);
  assert.strictEqual(r.findings, 2);
});

// STRICT equality, exactly like the source (`f.status === 'critical' || f.status === 'major'`).
// Being case-insensitive here would be an UNDECLARED deviation: on a mixed-case
// row our score would silently disagree with the dashboard the user is looking
// at — the precise failure this sub-project exists to prevent. If mixed case
// ever appears, fix the DATA, not the comparison.
test('status matching is strict, like the source', () => {
  const r = _computeInspectionScoreInputs({ inspections: [], findings: [
    { inspection_date: '2026-05-01', status: 'CRITICAL' },   // NOT counted — strict, like theirs
    { inspection_date: '2026-05-01', status: null },
    { inspection_date: '2026-05-01', status: 'critical' },   // counted
  ] }, W);
  assert.strictEqual(r.findings, 1);
});

test('empty → zeros', () => {
  assert.deepStrictEqual(_computeInspectionScoreInputs({ inspections: [], findings: [] }, W), { inspections: 0, findings: 0 });
});

// ── Integration: the REAL sqlite reader must agree with the pure core ──────
// A stub proves the contract, never the wiring: this seeds a real inspection.db
// and asserts getSiteScoreInputs() returns exactly what the pure core returns
// for the same rows — so a lost JOIN (findings losing their inspection's date)
// or a leaked site fails here rather than reading zeros in prod.
test('getSiteScoreInputs: seeded sqlite DB agrees with the pure core', async () => {
  (await idb.loadLookups());
  const conn = idb.getDB();
  const insp = conn.prepare(
    'INSERT INTO insp_inspections (id, site_code, inspection_date, status) VALUES (?,?,?,?)');
  const find = conn.prepare(
    'INSERT INTO insp_findings (inspection_id, category, item_index, status) VALUES (?,?,?,?)');

  // HGO — 2 in-window inspections, 1 before the window.
  (await insp.run('HGO-1', 'HGO', '2026-05-01', 'submitted'));
  (await insp.run('HGO-2', 'HGO', '2026-06-01', 'submitted'));
  (await insp.run('HGO-0', 'HGO', '2026-01-01', 'submitted'));   // before the window
  // Another site → must never leak in.
  (await insp.run('MGO-1', 'MGO', '2026-05-01', 'submitted'));

  (await find.run('HGO-1', 'net', 1, 'critical'));   // counted
  (await find.run('HGO-1', 'net', 2, 'major'));      // counted
  (await find.run('HGO-1', 'net', 3, 'minor'));      // not counted
  (await find.run('HGO-2', 'srv', 1, 'major'));      // counted
  (await find.run('HGO-2', 'srv', 2, 'ok'));         // not counted
  (await find.run('HGO-0', 'net', 1, 'critical'));   // out of window
  (await find.run('MGO-1', 'net', 1, 'critical'));   // other site

  const got = (await idb.getSiteScoreInputs('HGO', W.from, W.to));

  // The same rows, hand-mirrored, through the pure core.
  const expected = _computeInspectionScoreInputs({
    inspections: [
      { inspection_date: '2026-05-01' },
      { inspection_date: '2026-06-01' },
      { inspection_date: '2026-01-01' },
    ],
    findings: [
      { inspection_date: '2026-05-01', status: 'critical' },
      { inspection_date: '2026-05-01', status: 'major' },
      { inspection_date: '2026-05-01', status: 'minor' },
      { inspection_date: '2026-06-01', status: 'major' },
      { inspection_date: '2026-06-01', status: 'ok' },
      { inspection_date: '2026-01-01', status: 'critical' },
    ],
  }, W);

  assert.deepStrictEqual(got, expected);
  // Pin the numbers too, so a matching-but-wrong core can't hide behind the diff.
  assert.strictEqual(got.inspections, 2, 'the 2 in-window HGO inspections; MGO must not leak');
  assert.strictEqual(got.findings, 3, 'critical+major on the in-window HGO inspections only');
});
