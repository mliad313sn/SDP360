'use strict';
// P04 PPM certification — T4: work-weighted rollups leaf → summary → project and the 100 % rule. Every expected number
// is computed BY HAND in the comments, never by running the engine. Pure, no DB.
const test = require('node:test');
const assert = require('node:assert');
const E = require('../services/ppm/scheduleEngine');
const K = require('../services/ppm/projectKpis');

// Tree:  P (root summary)
//          S (summary)  ─ a 2 d 10 h 100 %   ─ b 2 d 30 h 50 %
//          c 4 d 60 h 0 %
//          x 1 d 100 h 0 % CANCELLED (inactive: never counts)
// S = (10×100 + 30×50) / (10+30) = 2500/40 = 62.5 %
// P = (10×100 + 30×50 + 60×0) / (10+30+60) = 2500/100 = 25 %   (x excluded)
// project card (scheduleComplete) = 25 % — the same number as the root summary row
const tree = () => [
  { id: 1, name: 'P' }, { id: 2, parent_id: 1, name: 'S' },
  { id: 3, parent_id: 2, duration_days: 2, effort_hours: 10, progress_pct: 100, status: 'done' },
  { id: 4, parent_id: 2, duration_days: 2, effort_hours: 30, progress_pct: 50, status: 'in_progress', depends_on: [3] },
  { id: 5, parent_id: 1, duration_days: 4, effort_hours: 60, progress_pct: 0, status: 'todo', depends_on: [2] },
  { id: 6, parent_id: 1, duration_days: 1, effort_hours: 100, progress_pct: 0, status: 'cancelled' },
];
const sch = (t, o = {}) => E.schedule(t, { anchor: '2027-01-04', ...o });
const by = (r) => Object.fromEntries(r.tasks.map((x) => [x.id, x]));

test('T4 work-weighted %: summary and root roll up by work; a cancelled leaf never counts; card = root row', () => {
  const r = sch(tree()); const t = by(r);
  assert.deepStrictEqual([t[2].rollup.progress_pct, t[2].rollup.work_hours, t[2].rollup.progress_basis], [62.5, 40, 'work']);
  assert.deepStrictEqual([t[1].rollup.progress_pct, t[1].rollup.work_hours], [25, 100], 'root = 2500 / 100, the cancelled 100 h excluded');
  assert.deepStrictEqual(K.scheduleComplete(tree(), r), { progress_pct: 25, basis: 'work' }, 'the KPI card reads the same rollup');
});

test('T4 unknown is never 0: an unknown leaf % makes every ancestor unknown; unknown work falls back to duration', () => {
  const t1 = tree(); t1[3].progress_pct = null;   // b unknown
  const r = by(sch(t1));
  assert.deepStrictEqual([r[2].rollup.progress_pct, r[1].rollup.progress_pct], [null, null]);
  assert.equal(r[2].rollup.progress_basis, 'unknown_child');
  // work unknown on b → weight by working-day duration: S = (2×100 + 2×50)/4 = 75 %
  const t2 = tree(); t2[3].effort_hours = null;
  const s2 = by(sch(t2));
  assert.deepStrictEqual([s2[2].rollup.progress_pct, s2[2].rollup.progress_basis, s2[2].rollup.work_hours], [75, 'duration', null]);
});

test('T4 100 % rule: children work = summary work → no warning; mismatch → WBS_100_RULE; cancelled work excluded', () => {
  const ok = tree(); ok[1].effort_hours = 40; ok[0].effort_hours = 100;   // S = 10 + 30, P = 10 + 30 + 60 (x cancelled)
  assert.ok(!sch(ok).warnings.some((w) => w.code === 'WBS_100_RULE'), JSON.stringify(sch(ok).warnings));
  const bad = tree(); bad[1].effort_hours = 45;
  const w = sch(bad).warnings.filter((x) => x.code === 'WBS_100_RULE');
  assert.deepStrictEqual(w.map((x) => x.task_id), [2], '10 + 30 = 40 h ≠ 45 h');
});

test('T4 every leaf cancelled: the summary has no rollup value (null), not 0', () => {
  const t = [{ id: 1, name: 'S' }, { id: 2, parent_id: 1, duration_days: 1, effort_hours: 8, progress_pct: 0, status: 'cancelled' }];
  assert.equal(by(sch(t))[1].rollup.progress_pct, null);
});
