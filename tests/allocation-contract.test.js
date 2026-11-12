'use strict';
// F-PRODUCT-01 (gap E07) — ONE allocation contract (public/lib/allocationContract.js) read by the server
// (services/projectSchedule.js) and by the pages (public/lib/ppmVisuals.js). Fictitious tasks. No DB.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const AC = require('../public/lib/allocationContract');
const SCH = require('../services/projectSchedule');
const PV = require('../public/lib/ppmVisuals');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

const base = { owner: 'Ana', start_date: '2026-11-02', end_date: '2026-11-06' };
const pair = (second) => [{ id: 1, ...base, allocation_pct: 60 }, { id: 2, ...base, ...second }];

// case → [label, second task, state of the second task, conflicts, unknown, invalid, possible conflicts, known peak]
const CASES = [
  ['60 + null', { allocation_pct: null }, 'unknown', 0, 1, 0, 1, 60],
  ['60 + omitted', {}, 'unknown', 0, 1, 0, 1, 60],
  ["60 + ''", { allocation_pct: '' }, 'unknown', 0, 1, 0, 1, 60],
  ['60 + 0', { allocation_pct: 0 }, 'known', 0, 0, 0, 0, 60],
  ['60 + 120 (legacy)', { allocation_pct: 120 }, 'invalid', 0, 0, 1, 1, 60],
  ['60 − 50 (legacy)', { allocation_pct: -50 }, 'invalid', 0, 0, 1, 1, 60],
  ['70 + 40', { allocation_pct: 40 }, 'known', 1, 0, 0, 0, 110],
];

test('classify: null / empty / omitted / text are unknown, 0..100 known, outside invalid, closed / no owner / no dates excluded', () => {
  assert.deepEqual(AC.classify({ ...base, allocation_pct: null }), { state: 'unknown', pct: null, reason: null });
  assert.equal(AC.classify({ ...base, allocation_pct: 'half' }).state, 'unknown');
  assert.equal(AC.classify({ ...base, allocation_pct: true }).state, 'unknown', 'a boolean is not a percentage');
  assert.deepEqual(AC.classify({ ...base, allocation_pct: '40' }), { state: 'known', pct: 40, reason: null });
  assert.deepEqual(AC.classify({ ...base, allocation_pct: 0 }), { state: 'known', pct: 0, reason: null });
  assert.equal(AC.classify({ ...base, allocation_pct: 100 }).state, 'known');
  assert.equal(AC.classify({ ...base, allocation_pct: 100.5 }).state, 'invalid');
  assert.equal(AC.classify({ ...base, allocation_pct: -1 }).state, 'invalid');
  assert.equal(AC.classify({ ...base, allocation_pct: 50, status: 'done' }).reason, 'closed');
  assert.equal(AC.classify({ ...base, allocation_pct: 50, status: 'cancelled' }).reason, 'closed');
  assert.equal(AC.classify({ ...base, owner: '  ', allocation_pct: 50 }).reason, 'unassigned');
  assert.equal(AC.classify({ owner: 'Ana', allocation_pct: 50 }).reason, 'undated');
  assert.equal(AC.classify({ owner: 'Ana', start_date: '2026-11-06', end_date: '2026-11-02', allocation_pct: 50 }).reason, 'undated', 'inverted dates');
});

for (const [label, second, state, nConf, unknown, invalid, possible, peak] of CASES) {
  test(`${label}: the server and the page give the same verdict`, () => {
    const tasks = label.startsWith('70') ? [{ id: 1, ...base, allocation_pct: 70 }, { id: 2, ...base, ...second }] : pair(second);
    assert.equal(AC.classify(tasks[1]).state, state);
    const conf = SCH.resourceConflicts(tasks), cov = SCH.resourceCoverage(tasks);
    const cell = PV.resourcePressure(tasks, { today: '2026-11-02' }).people[0].cells[0];
    assert.equal(conf.length, nConf, 'server conflicts');
    assert.equal(cell.over, nConf > 0, 'page: over');
    assert.equal(cell.peak_pct, peak, 'page: known peak');
    if (nConf) assert.equal(conf[0].peak_pct, peak, 'server: same peak');
    assert.equal(cov.unknown, unknown); assert.equal(cell.unknown, unknown, 'page: unknown');
    assert.equal(cov.invalid, invalid); assert.equal(cell.invalid, invalid, 'page: invalid');
    assert.equal(cov.possible_conflicts.length, possible, 'possible conflicts');
    if (possible) assert.equal(cov.possible_conflicts[0].known_peak_pct, 60, 'the known load is shown, the rest is not guessed');
    assert.equal(cov.known + cov.unknown + cov.invalid + cov.unassigned + cov.undated, cov.tasks, 'coverage adds up');
  });
}

test('an omitted allocation is no longer read as 100 % (60 + omitted was a 160 % conflict), null is no longer read as 0', () => {
  assert.deepEqual(SCH.resourceConflicts(pair({})), []);
  assert.equal(SCH.resourceCoverage(pair({ allocation_pct: null })).unknown, 1);
});

test('coverage: counts add up, a lone unknown task is not a possible conflict, two unknown tasks are (known peak null)', () => {
  const tasks = [
    { id: 1, ...base, allocation_pct: null },
    { id: 2, owner: 'Bob', start_date: '2026-11-02', end_date: '2026-11-03' },
    { id: 3, owner: 'Bob', start_date: '2026-11-03', end_date: '2026-11-05', allocation_pct: '' },
    { id: 4, owner: null, start_date: '2026-11-02', end_date: '2026-11-03', allocation_pct: 50 },
    { id: 5, owner: 'Cy', allocation_pct: 50 },
    { id: 6, ...base, allocation_pct: 90, status: 'done' },
  ];
  const c = AC.coverage(tasks);
  assert.deepEqual([c.tasks, c.known, c.unknown, c.invalid, c.unassigned, c.undated, c.closed], [5, 0, 3, 0, 1, 1, 1]);
  assert.deepEqual(c.possible_conflicts, [{ owner: 'Bob', from: '2026-11-03', to: '2026-11-03', known_peak_pct: null, unknown_task_ids: [2, 3], invalid_task_ids: [] }]);
});

test('a real conflict is not also listed as possible; a 0 % task is not named in a conflict', () => {
  const tasks = [{ id: 1, ...base, allocation_pct: 70 }, { id: 2, ...base, allocation_pct: 50 }, { id: 3, ...base, allocation_pct: 0 }, { id: 4, ...base, allocation_pct: null }];
  const conf = AC.conflicts(tasks);
  assert.deepEqual(conf, [{ owner: 'Ana', from: '2026-11-02', to: '2026-11-06', peak_pct: 120, task_ids: [1, 2] }]);
  assert.deepEqual(AC.coverage(tasks).possible_conflicts, []);
});

test('coverageText never says "none" when an allocation is not known', () => {
  assert.equal(AC.coverageText({ unknown: 0, invalid: 0 }, 0), 'none');
  assert.equal(AC.coverageText({ unknown: 2, invalid: 0 }, 0), 'none known · 2 unknown');
  assert.equal(AC.coverageText({ unknown: 1, invalid: 1 }, 3), '3 · 1 unknown · 1 invalid');
  assert.doesNotMatch(AC.coverageText({ unknown: 2, invalid: 0 }, 0), /0 %/);
});

test('one rule, three readers: the server and the page module both delegate to the contract; the pages load it first', () => {
  const sch = read('services/projectSchedule.js');
  assert.match(sch, /require\('\.\.\/public\/lib\/allocationContract'\)/);
  assert.doesNotMatch(sch, /Number\(t\.allocation_pct\)/, 'no second allocation rule on the server');
  const pv = read('public/lib/ppmVisuals.js');
  assert.match(pv, /AC\.classify\(t\)/);
  assert.doesNotMatch(pv, /Number\(t\.allocation_pct\)/, 'no second allocation rule in the page module');
  for (const f of ['public/portfolio.html', 'public/project.html']) {
    const h = read(f);
    assert.ok(h.indexOf('src="lib/allocationContract.js"') > 0 && h.indexOf('src="lib/allocationContract.js"') < h.indexOf('src="lib/ppmVisuals.js"'), f);
  }
  for (const f of ['services/portfolioAccess.js', 'routes/governance.js']) assert.match(read(f), /resource_coverage: SCH\.resourceCoverage\(/, f);
});
