'use strict';
// F-UX-06 — the adoption report is pure over system_log rows: reach per tier, repeat users, task events,
// first-click-on-expected ratio (UNKNOWN without the human expected answers); counts people, never lists them.
const { test } = require('node:test');
const assert = require('node:assert');
const A = require('../tools/pilot/adoption-report');

const R = (action, uid, target, details, ts) => ({ action, actor_id: uid, target, details: JSON.stringify(details), ts });
const rows = [
  R('page_viewed', 1, 'home', { tier: 'editor' }, '2026-11-02T08:00:00Z'), R('page_viewed', 1, 'home', { tier: 'editor' }, '2026-11-03T08:00:00Z'),
  R('page_viewed', 2, 'executive', { tier: 'executive' }, '2026-11-02T09:00:00Z'),
  R('ux_first_click', 1, 'home', { tier: 'editor', to: 'site-actions' }, '2026-11-02T08:01:00Z'),
  R('ux_first_click', 2, 'home', { tier: 'executive', to: 'help' }, '2026-11-02T09:01:00Z'),
  R('ux_first_click', 2, 'executive', { tier: 'executive', to: 'control' }, '2026-11-02T09:02:00Z'),
  R('ux_export', 2, 'executive', { tier: 'executive', to: null }, '2026-11-02T09:03:00Z'),
];

test('reach, repeat use and events; denominators kept', () => {
  const r = A.adoption(rows);
  assert.deepEqual(r.reach, [{ tier: 'editor', users: 1 }, { tier: 'executive', users: 1 }]);
  assert.deepEqual([r.users, r.repeat_users, r.repeat_pct], [2, 1, 50]);
  assert.deepEqual(r.events.find((e) => e.kind === 'export'), { kind: 'export', events: 1, users: 1 });
  assert.deepEqual(r.events.find((e) => e.kind === 'drill'), { kind: 'drill', events: 0, users: 0 });
});

test('first click on the expected page: UNKNOWN without expected answers, a ratio with them', () => {
  const none = A.adoption(rows);
  assert.ok(none.first_click.every((x) => x.on_expected === null && x.pct === null));
  const exp = A.parseExpected('task,landing_page,expected_page\nT1,home,site-actions\nT2,executive,unknown\n');
  const r = A.adoption(rows, { expected: exp });
  assert.deepEqual(r.first_click.find((x) => x.page === 'home'), { page: 'home', clicks: 2, on_expected: 1, pct: 50 });
  assert.equal(r.first_click.find((x) => x.page === 'executive').pct, null, '"unknown" expected answer stays UNKNOWN');
});

test('no data → UNKNOWN, never 0 %; the rendered report lists no people', () => {
  const e = A.adoption([]);
  assert.deepEqual([e.users, e.repeat_users, e.repeat_pct], [0, null, null]);
  const md = A.render(A.adoption(rows), { from: '2026-11-02', to: '2026-11-03' });
  assert.match(md, /repeat users \(≥ 2 days\): 1 \/ 2 \(50 %\)/);
  assert.match(md, /\| home \| 2 \| UNKNOWN \| UNKNOWN \|/);
  assert.ok(!/actor_id|u1\b|u2\b/.test(md));
});
