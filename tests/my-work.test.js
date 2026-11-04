'use strict';
// A-10 — "My work": what each of the user's sites owes today. services/myWork.js is PURE: the route
// injects the readers; each block is computed on its own and is null (not measured) when its reader
// is missing or throws — never 0.
const test = require('node:test');
const assert = require('node:assert');
const { buildMyWork, weeklyLabel, trackerEmptyCells } = require('../services/myWork');

const ASOF = '2026-11-04';
const S1 = { site_id: 1, code: 'HGO', name: 'Hounde' };
const S2 = { site_id: 2, code: 'MGO', name: 'Mana' };

const readers = (over = {}) => Object.assign({
  actions: async () => ({ meetings: [], inspection: [], report: { actions: [] } }),
  weeklyReport: async () => ({ year: 2026, week: 44, week_label: 'W44 2026', report: { id: 7, status: 'submitted' } }),
  unsignedPvs: async () => ({ count: 0, items: [] }),
  lastInspection: async () => ({ inspection_date: '2026-10-25' }),
  trackerEmpty: async () => ({ month: 11, empty_cells: 3, total_cells: 20 }),
}, over);

test('a block whose reader throws is null; the others are still computed', async () => {
  const w = await buildMyWork({ user: { id: 1 }, sites: [S1], asOf: ASOF, readers: readers({ unsignedPvs: async () => { throw new Error('db down'); } }) });
  const s = w.sites[0];
  assert.strictEqual(s.unsigned_pvs, null);
  assert.ok(s.actions && s.weekly_report && s.last_inspection && s.tracker_empty);
  assert.deepStrictEqual(s.last_inspection, { date: '2026-10-25', days_since: 10 });
});

test('a missing reader gives null, never 0', async () => {
  const r = readers(); delete r.trackerEmpty; delete r.actions;
  const s = (await buildMyWork({ user: { id: 1 }, sites: [S1], asOf: ASOF, readers: r })).sites[0];
  assert.strictEqual(s.tracker_empty, null);
  assert.strictEqual(s.actions, null);
});

test("weekly report 'ready' reads 'Complete but not submitted'; no row reads 'Not started'", async () => {
  assert.strictEqual(weeklyLabel('ready'), 'Complete but not submitted');
  assert.strictEqual(weeklyLabel('draft'), 'In progress');
  assert.strictEqual(weeklyLabel('in_progress'), 'In progress');
  assert.strictEqual(weeklyLabel('submitted'), 'Submitted');
  assert.strictEqual(weeklyLabel(null), 'Not started');
  const ready = (await buildMyWork({ user: {}, sites: [S1], asOf: ASOF, readers: readers({ weeklyReport: async () => ({ year: 2026, week: 44, week_label: 'W44 2026', report: { id: 9, status: 'ready' } }) }) })).sites[0];
  assert.deepStrictEqual(ready.weekly_report, { week_label: 'W44 2026', status: 'ready', label: 'Complete but not submitted', report_id: 9 });
  const none = (await buildMyWork({ user: {}, sites: [S1], asOf: ASOF, readers: readers({ weeklyReport: async () => ({ year: 2026, week: 44, report: null }) }) })).sites[0];
  assert.deepStrictEqual(none.weekly_report, { week_label: 'W44 2026', status: null, label: 'Not started', report_id: null });
});

test('overdue = open actions past due as of asOf (injected)', async () => {
  const meetings = [
    { id: 1, description: 'late', status: 'open', target_date: '2026-11-01', created_at: '2026-10-01' },
    { id: 2, description: 'due today', status: 'open', target_date: '2026-11-04', created_at: '2026-10-30' },
    { id: 3, description: 'closed late', status: 'resolved', target_date: '2026-10-01' },
  ];
  const inspection = [{ id: 4, description: 'insp late', status: 'Open', due_date: '2026-10-20', created_at: '2026-09-05' }];
  const r = readers({ actions: async () => ({ meetings, inspection, report: { actions: [{ uid: 'u1', task: 'follow', status: 'open', due_date: '2026-12-01', first_logged: '2026-10-26' }] } }) });
  const s = (await buildMyWork({ user: {}, sites: [S1], asOf: ASOF, readers: r })).sites[0];
  assert.strictEqual(s.actions.open, 4);
  assert.strictEqual(s.actions.overdue, 2);
  assert.strictEqual(s.actions.oldest_days, 60);
  // the same data a week earlier: nothing is overdue yet
  const early = (await buildMyWork({ user: {}, sites: [S1], asOf: '2026-10-15', readers: r })).sites[0];
  assert.strictEqual(early.actions.overdue, 0);
});

test('no site → empty list and a message, never a fleet-wide list', async () => {
  let called = false;
  const w = await buildMyWork({ user: { id: 1 }, sites: [], asOf: ASOF, readers: readers({ actions: async () => { called = true; return {}; } }) });
  assert.deepStrictEqual(w.sites, []);
  assert.match(w.message, /not attached to a site/i);
  assert.strictEqual(called, false);
});

test('a two-site editor gets two site cards, in the order given; more than 12 are capped', async () => {
  const w = await buildMyWork({ user: {}, sites: [S1, S2], asOf: ASOF, readers: readers() });
  assert.deepStrictEqual(w.sites.map((s) => s.code), ['HGO', 'MGO']);
  assert.strictEqual(w.message, null);
  const many = Array.from({ length: 15 }, (_, i) => ({ site_id: i + 1, code: 'S' + i, name: 'Site ' + i }));
  const c = await buildMyWork({ user: {}, sites: many, asOf: ASOF, readers: readers() });
  assert.strictEqual(c.sites.length, 12); assert.strictEqual(c.truncated, 3);
});

test('unsigned PVs: count kept, at most 10 items listed', async () => {
  const items = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, reference: 'R' + i, meeting_date: '2026-10-0' + ((i % 9) + 1), extra: 'x' }));
  const s = (await buildMyWork({ user: {}, sites: [S1], asOf: ASOF, readers: readers({ unsignedPvs: async () => ({ count: 14, items }) }) })).sites[0];
  assert.strictEqual(s.unsigned_pvs.count, 14); assert.strictEqual(s.unsigned_pvs.items.length, 10);
  assert.deepStrictEqual(Object.keys(s.unsigned_pvs.items[0]).sort(), ['id', 'meeting_date', 'reference']);
});

test('no inspection ever is measured (date null), not unknown', async () => {
  const s = (await buildMyWork({ user: {}, sites: [S1], asOf: ASOF, readers: readers({ lastInspection: async () => null }) })).sites[0];
  assert.deepStrictEqual(s.last_inspection, { date: null, days_since: null });
});

test('trackerEmptyCells counts active activities of the month with nothing entered', () => {
  const D = {
    activities: [{ start: 1, end: 12 }, { start: 1, end: 6 }, { start: 1, end: 12 }, { start: 11, end: 12 }],
    targets: { HGO: [{ active: true }, { active: true }, { active: false }, { active: true }] },
    inputs: { 2026: { HGO: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0], [1]] } },
    byYear: { 2026: { activities: [{ start: 1, end: 12 }, { start: 1, end: 6 }, { start: 1, end: 12 }, { start: 11, end: 12 }], targets: { HGO: [{ active: true }, { active: true }, { active: false }, { active: true }] } } },
  };
  // November: activity 0 has 5, activity 1 out of window, 2 inactive, 3 has nothing → 1 empty of 2
  assert.deepStrictEqual(trackerEmptyCells(D, 'HGO', 2026, 11), { month: 11, empty_cells: 1, total_cells: 2 });
  assert.strictEqual(trackerEmptyCells(D, '', 2026, 11), null, 'no tracker code → not measured');
  assert.strictEqual(trackerEmptyCells(null, 'HGO', 2026, 11), null);
});

test('site-actions.html: a single site opens directly; a 403 names the user\'s own sites', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'site-actions.html'), 'utf8');
  assert.match(src, /if \(sites\.length === 1 && !state\.site\) state\.site = sites\[0\]\.code;/);
  assert.match(src, /r\.status === 403/);
  assert.match(src, /This site is not one of yours\. Your sites: /);
});
