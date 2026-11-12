'use strict';
// G4-CI — the e2e runner must not crash on a non-journey JSON (uat-<seat>.json) in the artefact directory.
// CI run 43227102787: all 40 journeys passed, then run-e2e.js threw on `a.external.unexpected_count`.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { kindOf, collectRun } = require('../tools/test/e2e-artefacts');
const { aggregate } = require('../tools/test/perf-baseline');

const journey = (name, extra) => Object.assign({ journey: name, status: 'passed', external: { unexpected_count: 0, allowlisted_count: 2, unexpected: [] }, pages: [], page_errors: [] }, extra || {});
const uat = { seat: 'S1', simulation: 'AI-simulated', results: [{ id: 'a', pass: 'A', status: 'PASS' }, { id: 'b', pass: 'B', status: 'OFF' }] };

test('kindOf separates journey artefacts from UAT side records', () => {
  assert.strictEqual(kindOf(journey('T1')), 'journey');
  assert.strictEqual(kindOf(uat), 'uat');
  assert.strictEqual(kindOf({ foo: 1 }), 'other');
});

test('a UAT record next to journeys is summarised, not counted as a journey, and does not throw', () => {
  const s = {};
  const problems = collectRun(1, [{ file: 'T1.json', data: journey('T1') }, { file: 'uat-S1.json', data: uat }], s);
  assert.deepStrictEqual(problems, []);
  assert.deepStrictEqual(Object.keys(s.journeys), ['T1']);
  assert.deepStrictEqual(s.side_records['uat-S1.json'], [{ run: 1, kind: 'uat', seat: 'S1', flows: 2, by_status: { PASS: 1, OFF: 1 } }]);
});

test('a journey artefact without the gate fields is a problem, never a pass or a crash', () => {
  const p = collectRun(2, [{ file: 'X.json', data: { journey: 'X', status: 'passed' } }], {});
  assert.strictEqual(p.length, 1);
  assert.match(p[0], /run 2: X\.json \(X\) is not a judgeable journey artefact/);
});

test('failed status and unexpected external requests still turn the run red', () => {
  const p = collectRun(1, [{ file: 'A.json', data: journey('A', { status: 'failed' }) }, { file: 'B.json', data: journey('B', { external: { unexpected_count: 1, unexpected: ['https://cdn.example'] } }) }], {});
  assert.strictEqual(p.length, 2);
});

test('perf baseline ignores UAT side records', () => {
  const agg = aggregate([Object.assign(journey('T1'), { __run: 1 }), Object.assign({}, uat, { __run: 1 })]);
  assert.deepStrictEqual(Object.keys(agg.journeys), ['T1']);
});

test('run-e2e.js delegates artefact handling to the classifier (no raw a.external access)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'test', 'run-e2e.js'), 'utf8');
  assert.match(src, /require\('\.\/e2e-artefacts'\)/);
  assert.doesNotMatch(src, /a\.external\./);
});
