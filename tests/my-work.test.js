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

// ── F-PRODUCT-07 — "Awaiting me" (validator inbox) ─────────────────────────────────────────────────────────────────
const { buildAwaitingMe, AWAITING_SOURCES } = require('../services/myWork');
const ME = { id: 7, username: 'amina', full_name: 'Amina Diallo', email: 'amina@example.test' };
const cmt = (o) => ({ id: 1, uid: 'CMT-1', title: 'Fix UPS', status: 'awaiting_verification', reviewer: 'amina', accountable_owner: 'bob', execution_owners: ['carl'], created_by: 'dora', due_date: '2026-11-01', ...o });
const aw = (over = {}) => Object.assign({ commitments: async () => [], handoffs: async () => [], benefits: async () => [], decisions: async () => [], pvs: async () => [] }, over);

test('awaiting me: absent unless the route passes the readers (switch off = today)', async () => {
  const w = await buildMyWork({ user: ME, sites: [S1], asOf: ASOF, readers: readers() });
  assert.ok(!('awaiting_me' in w));
  const on = await buildMyWork({ user: ME, sites: [], asOf: ASOF, readers: { awaiting: aw() } });
  assert.equal(on.awaiting_me.total, 0, 'a person without a site still has an inbox'); assert.deepEqual(on.awaiting_me.not_measured, []);
});

test('awaiting me: null-not-0 per source — a missing reader, a reader that throws or a non-list answer is "not measured"', async () => {
  const r = aw({ handoffs: async () => { throw new Error('db down'); }, benefits: async () => null }); delete r.pvs;
  const a = await buildAwaitingMe({ user: ME, asOf: ASOF, readers: r });
  assert.strictEqual(a.handoffs, null); assert.strictEqual(a.benefits, null); assert.strictEqual(a.pvs, null);
  assert.deepEqual(a.commitments, { count: 0, items: [] }); assert.deepEqual(a.decisions, { count: 0, items: [] });
  assert.deepEqual(a.not_measured, ['handoffs', 'benefits', 'pvs']); assert.equal(a.total, 0);
  const none = await buildAwaitingMe({ user: ME, asOf: ASOF, readers: {} });
  assert.strictEqual(none.total, null, 'nothing measured → the total is unknown, not 0'); assert.deepEqual(none.not_measured, AWAITING_SOURCES);
});

test('awaiting me: commitments — the named reviewer or the role holder, never my own work (SoD)', async () => {
  const rows = [
    { commitment: cmt({ id: 1 }) },                                                            // I am the named reviewer
    { commitment: cmt({ id: 2, reviewer: 'someone-else' }) },                                  // not mine
    { commitment: cmt({ id: 3, accountable_owner: 'amina' }) },                                // named reviewer but I own it
    { commitment: cmt({ id: 4, execution_owners: ['Amina Diallo'] }) },                        // I executed it
    { commitment: cmt({ id: 5, created_by: 'amina' }) },                                       // I created it
    { commitment: cmt({ id: 6, status: 'in_progress' }) },                                     // not waiting
    { commitment: cmt({ id: 7, reviewer: null }), actor: { ...ME, roleReviewer: true } },      // role holder, no named reviewer
    { commitment: cmt({ id: 8, reviewer: null }), actor: { ...ME, roleReviewer: false } },
    { commitment: cmt({ id: 9, reviewer: 'Amina Diallo' }) },                                  // a full name grants nothing (namesakes)
    { commitment: cmt({ id: 10, reviewer: 'zed', due_date: '2026-12-01' }), actor: { ...ME, principals: [{ id: 3, username: 'zed' }] } },   // deputy of the reviewer
    { commitment: cmt({ id: 11, reviewer: 'zed', accountable_owner: 'zed2' }), actor: { ...ME, principals: [{ id: 4, username: 'zed2' }] } },   // deputy of the OWNER: refused
  ];
  const a = await buildAwaitingMe({ user: ME, asOf: ASOF, readers: aw({ commitments: async () => rows }) });
  assert.deepEqual(a.commitments.items.map((x) => x.id), [1, 7, 10]);
  assert.deepEqual(a.commitments.items[0], { source: 'commitment', id: 1, ref: 'CMT-1', title: 'Fix UPS', due_date: '2026-11-01', overdue: true, evidence_link: null, link: 'commitments.html?id=1' });
  assert.equal(a.commitments.items[2].overdue, false);
});

test('awaiting me: handoffs waiting for MY acceptance; benefits I may verify but did not enter or own', async () => {
  const a = await buildAwaitingMe({ user: ME, asOf: ASOF, readers: aw({
    handoffs: async () => [{ id: 1, ref: 'HND-1', title: 'to me', status: 'requested', receiver_id: 7, requested_by: 2, due_date: null }, { id: 2, ref: 'HND-2', status: 'requested', receiver_id: 9, requested_by: 7 },
      { id: 3, ref: 'HND-3', status: 'accepted', receiver_id: 7, requested_by: 2 }, { id: 4, ref: 'HND-4', status: 'requested', receiver_id: 7, requested_by: 7 }],
    benefits: async () => [{ id: 1, project_id: 5, project_key: 'P5', measure: 'Downtime', realised_by: 2, verified_at: null, review_date: '2026-11-10', evidence_link: 'https://example.test/e' },
      { id: 2, project_id: 5, realised_by: 7, verified_at: null }, { id: 3, project_id: 5, realised_by: 2, owner_user_id: 7, verified_at: null },
      { id: 4, project_id: 5, realised_by: 2, owner: 'Amina Diallo', verified_at: null }, { id: 5, project_id: 5, realised_by: 2, verified_at: '2026-11-01' }, { id: 6, project_id: 5, realised_by: null, verified_at: null }],
  }) });
  assert.deepEqual(a.handoffs.items.map((x) => x.ref), ['HND-1']); assert.strictEqual(a.handoffs.items[0].overdue, null, 'no due date = unknown, never "on time"');
  assert.equal(a.handoffs.items[0].link, 'handoffs.html?id=1');
  assert.deepEqual(a.benefits.items.map((x) => x.id), [1]);
  assert.equal(a.benefits.items[0].evidence_link, 'https://example.test/e'); assert.equal(a.benefits.items[0].link, 'project.html?id=5#benefits');
  assert.equal(a.total, 2);
});

test('awaiting me: decisions I own due within 7 days (late included, undated excluded); PVs naming me as an unsigned signer', async () => {
  const a = await buildAwaitingMe({ user: ME, asOf: ASOF, readers: aw({
    decisions: async () => [{ id: 1, ref: 'DEC-2026-001', title: 'late', owner: 'Amina Diallo', status: 'open', due_date: '2026-10-30', session_id: 4 }, { id: 2, ref: 'DEC-2026-002', owner: 'amina', status: 'in_progress', due_date: '2026-11-11' },
      { id: 3, ref: 'DEC-2026-003', owner: 'amina', status: 'open', due_date: '2026-11-12' }, { id: 4, ref: 'DEC-2026-004', owner: 'amina', status: 'open', due_date: null },
      { id: 5, ref: 'DEC-2026-005', owner: 'bob', status: 'open', due_date: '2026-11-05' }, { id: 6, ref: 'DEC-2026-006', owner: 'amina', status: 'done', due_date: '2026-11-05' },
      { id: 7, ref: 'DEC-2026-007', owner: 'AMINA@example.test', status: 'awaiting_confirmation', due_date: '2026-11-05' }],
    pvs: async () => [{ id: 1, reference: 'HGO_Mining_PV_2026-11', department: 'mining', department_head: 'Amina Diallo', dept_head_signed_at: null, site_it_lead: 'x', site_it_signed_at: null },
      { id: 2, reference: 'r2', department_head: 'Amina Diallo', dept_head_signed_at: '2026-11-02', site_it_lead: 'bob', site_it_signed_at: null },
      { id: 3, reference: 'r3', department_head: 'bob', site_it_lead: 'amina', site_it_signed_at: null }, { id: 4, reference: 'r4', department_head: 'bob', site_it_lead: 'carl' }],
  }) });
  assert.deepEqual(a.decisions.items.map((x) => x.ref), ['DEC-2026-001', 'DEC-2026-007', 'DEC-2026-002']);
  assert.equal(a.decisions.items[0].overdue, true); assert.equal(a.decisions.items[0].link, 'cockpit.html?session=4'); assert.equal(a.decision_due_days, 7);
  assert.deepEqual(a.pvs.items.map((x) => x.id).sort(), [1, 3]); assert.equal(a.pvs.items.find((x) => x.id === 1).link, 'meeting.html?id=1');
});
