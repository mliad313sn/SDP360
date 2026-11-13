'use strict';
// PPM parity W4 — agile board over work packages + roadmap Now / Next / Later (PURE browser modules).
const { test } = require('node:test');
const assert = require('node:assert');
const B = require('../public/lib/ppmBoard');
const N = require('../public/lib/ppmRoadmapNnl');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const tasks = [
  { id: 1, name: 'Phase A', wbs_code: '1', status: 'in_progress' },
  { id: 2, name: 'Survey', wbs_code: '1.1', parent_id: 1, status: 'done', owner: 'ana', version: 3, progress_pct: 100 },
  { id: 3, name: 'Cabling', wbs_code: '1.2', parent_id: 1, status: 'todo', owner: 'bob', version: 1 },
  { id: 4, name: 'Odd', wbs_code: '2', status: 'weird' },
];

test('board: leaf tasks only (summary tasks are lanes), by status, unknown status never folded into "todo"', () => {
  const b = B.board(tasks);
  const col = (k) => b.columns.find((c) => c.key === k).cards.map((c) => c.id);
  assert.deepEqual(col('done'), [2]); assert.deepEqual(col('todo'), [3]); assert.deepEqual(col('in_progress'), [], 'the summary task is not a card');
  assert.deepEqual(b.other.map((c) => c.id), [4]);
  assert.equal(b.columns.find((c) => c.key === 'done').cards[0].lane, '1 Phase A');
  assert.equal(b.columns.find((c) => c.key === 'todo').cards[0].progress_pct, null, 'no progress = unknown, never 0');
});

test('board moves: the existing task update with the row version; nothing when the status does not change', () => {
  const card = B.board(tasks).columns.find((c) => c.key === 'done').cards[0];
  assert.deepEqual(B.movePayload(card, 'blocked'), { id: 2, status: 'blocked', version: 3 });
  assert.equal(B.movePayload(card, 'done'), null);
  assert.equal(B.movePayload(card, 'nowhere'), null);
});

test('board who may move (presentation): committee / plan editor all; pm & scheduler all; contributor own only; client none', () => {
  const own = { owner: 'Ana' }, other = { owner: 'bob' }, user = { username: 'ana' };
  assert.equal(B.canMove(other, { committee: true }), true);
  assert.equal(B.canMove(other, { canEditPlan: true }), true);
  assert.equal(B.canMove(other, { projectRole: 'scheduler' }), true);
  assert.equal(B.canMove(own, { projectRole: 'contributor', user }), true);
  assert.equal(B.canMove(other, { projectRole: 'contributor', user }), false);
  assert.equal(B.canMove(own, { projectRole: 'client', user, canEditPlan: true }), false);
  const html = B.html(B.board(tasks), esc, { projectRole: 'contributor', user: { username: 'ana' } });
  assert.match(html, /data-task="2" draggable="true"/); assert.doesNotMatch(html, /data-task="3" draggable/);
});

test('now / next / later: delivery stage or started = now (late flagged), horizon, unscheduled, closed excluded', () => {
  const g = N.group([
    { id: 1, key: 'A', stage: 'in_progress', start_date: '2026-12-01' },
    { id: 2, key: 'B', stage: 'approval', start_date: '2026-11-01', end_date: '2026-11-10' },
    { id: 3, key: 'C', stage: 'approval', start_date: '2027-01-15' },
    { id: 4, key: 'D', stage: 'proposal', start_date: '2027-06-01' },
    { id: 5, key: 'E', stage: 'proposal' },
    { id: 6, key: 'F', stage: 'closed', start_date: '2026-01-01' },
    { id: 7, key: 'G', status: 'cancelled', start_date: '2027-01-02' },
  ], { today: '2026-11-13', horizonDays: 90 });
  assert.deepEqual(g.now.map((p) => p.key), ['B', 'A']);
  assert.equal(g.now.find((p) => p.key === 'B').late, true);
  assert.deepEqual(g.next.map((p) => p.key), ['C']);
  assert.deepEqual(g.later.map((p) => p.key), ['D']);
  assert.deepEqual(g.unscheduled.map((p) => p.key), ['E'], 'no start date is never guessed into a bucket');
  assert.equal(g.excluded, 2);
  assert.match(N.html(g, esc), /project\.html\?id=3/);
});
