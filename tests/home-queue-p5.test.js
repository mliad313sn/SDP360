'use strict';
// P5 (A3) — the Home queue sources it lacked + inline actions, pure behaviour of public/lib/homeQueue.js and
// services/myWork.buildQueueExtra. No source omitted (the 7 sources), absent = unknown never 0, SoD kept, every inline
// action goes through the SAME per-item route as the registers (no new right), snooze hides only a line of my queue.
const { test } = require('node:test');
const assert = require('node:assert');
const HQ = require('../public/lib/homeQueue');
const { buildQueueExtra, QUEUE_EXTRA_SOURCES } = require('../services/myWork');

const AS = '2026-11-12';
const ok = (json) => ({ status: 200, json });
const ME = { id: 5, username: 'ana', full_name: 'Ana Coord', email: 'ana@x.test' };

test('the queue reads seven sources, in this order — no source omitted', () => {
  assert.deepStrictEqual(HQ.SOURCES, ['meetings', 'inspections', 'report', 'commitments', 'awaiting', 'pending', 'obligations']);
  assert.deepStrictEqual(HQ.PENDING_PARTS, QUEUE_EXTRA_SOURCES);
  assert.deepStrictEqual(QUEUE_EXTRA_SOURCES, ['access', 'change_requests', 'gates', 'rfis', 'tasks']);
});

test('buildQueueExtra: SoD — never my own access request, change request to decide or project gate to sign', async () => {
  const x = await buildQueueExtra({ user: ME, asOf: AS, readers: {
    access: async () => [{ id: 1, subject_user_id: 9, requested_by: 8, roles: ['finance-viewer'], valid_from: '2026-11-13' }, { id: 2, subject_user_id: 5, requested_by: 8, roles: ['admin'] }, { id: 3, subject_user_id: 9, requested_by: 5, roles: ['viewer'] }],
    change_requests: async () => [{ id: 10, project_id: 3, project_key: 'P-3', title: 'Scope', status: 'proposed', author_id: 5 }, { id: 11, project_id: 3, title: 'Mine', status: 'assessed', author_id: 5 }, { id: 12, project_id: 4, title: 'Theirs', status: 'assessed', author_id: 7 }],
    gates: async () => [{ id: 3, key: 'P-3', name: 'Mine', stage: 'approval', owner: 'ana' }, { id: 4, key: 'P-4', name: 'Theirs', stage: 'closure', owner: 'bob', end_date: '2026-11-01' }, { id: 6, key: 'P-6', name: 'Running', stage: 'in_progress', owner: 'bob' }],
    rfis: async () => [{ id: 1, ref: 'RFI-1', title: 'Open', status: 'triaged', requester_id: 9 }, { id: 2, ref: 'RFI-2', title: 'Delivered to me', status: 'delivered', requester_id: 5 }, { id: 3, ref: 'RFI-3', title: 'Delivered to another', status: 'delivered', requester_id: 9 }, { id: 4, title: 'Rejected', status: 'rejected', requester_id: 5 }],
    tasks: async () => [{ kind: 'task', id: 1, project_id: 3, project_key: 'P-3', name: 'Late mine', owner: 'ana', due: '2026-11-01', status: 'in_progress' }, { kind: 'milestone', id: 2, project_id: 3, name: 'Late MS', owner: 'Ana Coord', due: '2026-11-10', status: 'planned' },
      { kind: 'task', id: 3, project_id: 3, name: 'Done', owner: 'ana', due: '2026-11-01', status: 'done' }, { kind: 'task', id: 4, project_id: 3, name: 'Others', owner: 'bob', due: '2026-11-01', status: 'todo' }, { kind: 'task', id: 5, project_id: 3, name: 'Future', owner: 'ana', due: '2026-12-01', status: 'todo' }],
  } });
  assert.deepStrictEqual(x.access.items.map((i) => i.id), [1]);
  assert.deepStrictEqual(x.change_requests.items.map((i) => i.id).sort(), [10, 12], 'proposed = to assess (any committee member); assessed = to decide, never my own');
  assert.deepStrictEqual(x.gates.items.map((i) => i.id), [4], 'the owner never signs his own gate; a running project waits at no gate');
  assert.deepStrictEqual(x.rfis.items.map((i) => i.id).sort(), [1, 2]);
  assert.deepStrictEqual(x.tasks.items.map((i) => i.id).sort(), ['m2', 't1'], 'mine, open, late — name or username both count');
  assert.ok(x.tasks.items.every((i) => i.overdue === true));
  assert.equal(x.total, 1 + 2 + 1 + 2 + 2); assert.deepStrictEqual(x.not_measured, []);
});

test('buildQueueExtra: a missing or failing reader is "not measured" (null), never 0; nothing measured → total null', async () => {
  const some = await buildQueueExtra({ user: ME, asOf: AS, readers: { access: async () => [], rfis: async () => { throw new Error('down'); } } });
  assert.deepStrictEqual(some.access, { count: 0, items: [] });
  assert.strictEqual(some.rfis, null); assert.strictEqual(some.tasks, null);
  assert.deepStrictEqual(some.not_measured, ['change_requests', 'gates', 'rfis', 'tasks']); assert.equal(some.total, 0);
  const none = await buildQueueExtra({ user: ME, asOf: AS, readers: {} });
  assert.strictEqual(none.total, null);
});

test('pending: absent = switched off (unknown), null = not measured, a missing part = partial; deep links kept', async () => {
  const mk = (pending) => HQ.createQueue({ sites: [], fetchJson: async () => ok({}), asOf: AS, pending });
  const off = mk(undefined); await off.loadAll();
  assert.equal(off.state.pending.state, 'unknown'); assert.match(off.state.pending.detail, /not switched on/);
  const nm = mk(null); await nm.loadAll(); assert.equal(nm.state.pending.state, 'unknown'); assert.equal(nm.state.pending.detail, 'could not be read');
  const part = mk({ access: { count: 1, items: [{ id: 4, ref: 'AR-4', title: 'finance-viewer', link: 'access.html' }] }, change_requests: null, gates: { count: 0, items: [] }, rfis: { count: 0, items: [] }, tasks: { count: 1, items: [{ id: 't9', ref: 'P-1', title: 'Late', due_date: '2026-11-01', overdue: true, link: 'project.html?id=1' }] } });
  await part.loadAll();
  assert.equal(part.state.pending.state, 'partial', 'one part not measured → partial, never 0');
  const v = part.view();
  const t = v.items.find((x) => x.source === 'pending' && x.sub === 'tasks');
  assert.equal(t.href, 'project.html?id=1'); assert.equal(t.overdue, true); assert.equal(t.key, 'tasks:t9');
  assert.equal(v.items[0].key, 'tasks:t9', 'late first');
  const bad = HQ.fromPending({ access: { items: [{ id: 1, link: 'javascript:alert(1)' }] } }, AS).items[0];
  assert.equal(bad.href, 'access.html'); assert.equal(bad.deep, false);
});

test('obligations: a weekly report not submitted and empty tracker cells become lines; submitted / zero empty do not; null = not measured', async () => {
  const sites = [
    { site_id: 7, code: 'HGO', weekly_report: { week_label: 'W45 2026', status: 'ready', label: 'Complete but not submitted', report_id: 42 }, tracker_empty: { month: 11, empty_cells: 3, total_cells: 10 } },
    { site_id: 8, code: 'MGO', weekly_report: { week_label: 'W45 2026', status: 'submitted', label: 'Submitted', report_id: 43 }, tracker_empty: { month: 11, empty_cells: 0, total_cells: 10 } },
    { site_id: 9, code: 'SGO', weekly_report: null, tracker_empty: null },
  ];
  const q = HQ.createQueue({ sites, fetchJson: async () => ok({ rows: [], groups: {}, commitments: [] }), asOf: AS });
  await q.loadAll();
  assert.equal(q.state.obligations.state, 'partial', 'SGO not measured');
  const lines = q.view().items.filter((x) => x.source === 'obligations');
  assert.deepStrictEqual(lines.map((x) => x.sub).sort(), ['tracker', 'weekly']);
  const w = lines.find((x) => x.sub === 'weekly');
  assert.equal(w.href, 'reports.html?report=42'); assert.match(w.title, /W45 2026 — Complete but not submitted/); assert.strictEqual(w.overdue, false, 'no deadline policy → never "late"');
  const none = HQ.createQueue({ sites: [{ site_id: 1, code: 'X' }], fetchJson: async () => ok({ rows: [], groups: {}, commitments: [] }), asOf: AS });
  await none.loadAll(); assert.equal(none.state.obligations.state, 'unknown');
});

test('inline "Complete" targets the SAME per-item update routes as the registers (no new route, no new right)', () => {
  const m = HQ.fromMeetings({ rows: [{ id: 3, meeting_id: 11, description: 'x', status: 'open' }] }, 'HGO', AS, 7)[0];
  assert.deepStrictEqual(m.act, { url: '/api/meetings/actions/3/update', body: { status_change: 'resolved', body: 'Completed from Home' } });
  assert.equal(m.key, 'meetings:3'); assert.equal(m.site_id, 7);
  const i = HQ.fromInspections({ rows: [{ id: 5, inspection_id: 'EM-1', description: 'y', status: 'Open' }] }, 'HGO', AS, 7)[0];
  assert.equal(i.act.url, '/api/inspection/actions/5/update'); assert.equal(i.act.body.status_change, 'Closed');
  const r = HQ.fromReport({ groups: { report: { items: [{ uid: 'a1b2-c3', title: 'z', close: { url: 'reports.html?report=1' } }] } } }, 'HGO', AS, 7)[0];
  assert.deepStrictEqual(r.act, { url: '/api/reports/action/a1b2-c3/status', body: { status: 'closed' } });
  const noId = HQ.fromMeetings({ rows: [{ id: 'x;drop', meeting_id: 11, description: 'x', status: 'open' }] }, 'HGO', AS)[0];
  assert.strictEqual(noId.act, null); assert.strictEqual(noId.key, null);
  // a cancellation (needs a justification) is never offered inline — "Complete" is a non-transfer status
  const ST = require('../public/lib/statusTransfer');
  assert.ok(!ST.isTransfer('resolved') && !ST.isTransfer('closed'));
});

test('snooze hides only MY line until the day; a toggle shows it again, labelled; render offers the actions', async () => {
  const q = HQ.createQueue({ sites: [{ site_id: 7, code: 'HGO' }], asOf: AS, delegate: true, snoozed: { 'meetings:3': '2026-11-19', 'meetings:4': '2026-11-01', 'bad key': '2027-01-01' },
    fetchJson: async (u) => (u.startsWith('/api/meetings') ? ok({ rows: [{ id: 3, meeting_id: 11, description: 'Snoozed', status: 'open' }, { id: 4, meeting_id: 11, description: 'Expired snooze', status: 'open', target_date: '2026-11-20' }] }) : ok({ rows: [], groups: {}, commitments: [] })) });
  await q.loadAll();
  let v = q.view();
  assert.deepStrictEqual(v.items.filter((x) => x.source === 'meetings').map((x) => x.title), ['Expired snooze']);
  assert.equal(v.snoozed, 1);
  let h = HQ.renderHtml(v, 'en');
  assert.match(h, /1 line\(s\) snoozed/); assert.match(h, /data-act="complete" data-key="meetings:4"/); assert.match(h, /data-act="snooze" data-key="meetings:4"/);
  assert.match(h, /href="handoffs\.html\?delegate=1&amp;title=Expired%20snooze&amp;site=7&amp;due=2026-11-20&amp;src=meetings%3A4"/);
  q.toggleSnoozed(true); v = q.view();
  assert.ok(v.items.some((x) => x.title === 'Snoozed' && x.snoozed_until === '2026-11-19'));
  h = HQ.renderHtml(v, 'fr');
  assert.match(h, /reportée jusqu'au 2026-11-19|reportée jusqu&#39;au 2026-11-19/); assert.match(h, /data-act="unsnooze" data-key="meetings:3"/);
  q.snooze('meetings:3', null); q.toggleSnoozed(false);
  assert.equal(q.view().snoozed, 0);
  const noDel = HQ.renderHtml(Object.assign({}, v, { delegate: false }), 'en');
  assert.ok(!/delegate=1/.test(noDel), 'no Delegate while handoffs are off');
});
