'use strict';
// P5 / goal B2 — aging reminders over the site actions: inert by default (switch off, policy undecided), a dated late
// action reminds its owner (one matching account of the site) or else the coordinators, the escalation goes to the
// coordinators, each level is sent once per action and due date (dedupe key), nobody → counted, never sent.
const { test } = require('node:test');
const assert = require('node:assert');
const A = require('../services/actionAgingReminders');

const NOW = new Date('2026-11-12T08:00:00Z');
const USERS = [
  { id: 1, username: 'coord', role: 'editor', roles: ['editor'], site_id: 7, active: 1 },
  { id: 2, username: 'ana', email: 'ana@x.test', roles: ['viewer'], site_id: 7, active: 1 },
  { id: 3, username: 'ana', roles: ['editor'], site_id: 8, active: 1 },   // same text, another site — not the owner on 7
  { id: 4, username: 'gone', roles: ['editor'], site_id: 7, active: 0 },
];
const ACTIONS = [
  { source: 'meetings', id: 11, site_id: 7, site_code: 'HGO', title: 'Switch', owner: 'ana', due_date: '2026-11-01' },      // 11 d late
  { source: 'inspections', id: 12, site_id: 7, site_code: 'HGO', title: 'Rack', owner: 'nobody here', due_date: '2026-11-09' }, // 3 d
  { source: 'report', id: 'u-1', site_id: 7, title: 'Follow-up', owner: null, due_date: null },                               // no date
  { source: 'meetings', id: 13, site_id: 9, title: 'No coordinator', owner: null, due_date: '2026-10-01' },
  { source: 'meetings', id: 14, site_id: 7, title: 'Not late enough', owner: 'ana', due_date: '2026-11-11' },
];

test('inert by default: the switch is off, and on without a delay nothing fires either', async () => {
  const D = require('../services/reportConfig').DEFAULTS;
  assert.equal(D.action_aging_reminders_enabled, '0'); assert.equal(D.action_aging_reminder_days, ''); assert.equal(D.action_aging_escalation_days, '');
  const store = { notify: () => { throw new Error('must not send'); } };
  const read = async () => { throw new Error('must not read'); };
  for (const cfg of [{}, { action_aging_reminders_enabled: '1' }, { action_aging_reminders_enabled: '1', action_aging_reminder_days: '3', notifications_stop: '1' }]) {
    assert.ok((await A.runAgingReminders({ cfg, read, store, sent: async () => false, now: NOW })).skipped);
  }
  assert.deepStrictEqual(A.buildAgingReminders({ actions: ACTIONS, users: USERS, now: NOW }), { items: [], off: true });
});

test('reminder to the named owner when ONE active account of the site matches, else the coordinators; escalation to coordinators', () => {
  const { items } = A.buildAgingReminders({ actions: ACTIONS, users: USERS, sites: [{ id: 7, name: 'Hounde' }], now: NOW, reminderDays: '3', escalationDays: '10' });
  const by = (k) => items.find((x) => x.key === k);
  assert.deepStrictEqual(by('B2:remind:meetings:11:2026-11-01').userIds, [2], 'owner ana on site 7 (the other ana is on site 8)');
  assert.deepStrictEqual(by('B2:escalate:meetings:11:2026-11-01').userIds, [1], 'escalation → the coordinator (active editor of the site)');
  assert.deepStrictEqual(by('B2:remind:inspections:12:2026-11-09').userIds, [1], 'owner text matches no account → coordinators');
  assert.ok(!items.some((x) => x.action_id === 'u-1'), 'no due date → never reminded (unknown ≠ late)');
  assert.ok(!items.some((x) => x.action_id === '14'), 'not late enough');
  assert.deepStrictEqual(by('B2:remind:meetings:13:2026-10-01').userIds, [], 'no coordinator → nobody');
});

test('run: each level sent once per action and due date; nobody counted, never sent', async () => {
  const sentKeys = new Set(); const notes = [];
  const store = { notify: async (n) => { notes.push(n); } };
  const cfg = { action_aging_reminders_enabled: '1', action_aging_reminder_days: '3', action_aging_escalation_days: '10' };
  const read = async () => ({ actions: ACTIONS, users: USERS, sites: [{ id: 7, name: 'Hounde' }] });
  const sent = async (k) => sentKeys.has(k);
  const r1 = await A.runAgingReminders({ cfg, read, store, sent, now: NOW });
  assert.equal(r1.notified, 3); assert.equal(r1.nobody, 2); assert.equal(r1.escalated, 1);
  notes.forEach((n) => sentKeys.add(n.sourceRef));
  assert.ok(notes.every((n) => n.kind === 'action_aging' && n.sourceKind === 'action_aging'));
  const r2 = await A.runAgingReminders({ cfg, read, store, sent, now: NOW });
  assert.equal(r2.notified, 0); assert.equal(r2.already, 3);
});

test('the job is registered, daily, optional (self-skips while off)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'services', 'sync', 'jobs.js'), 'utf8');
  assert.match(src, /name: 'engagement\.action_aging'.*optional: true/);
});
