'use strict';
// E-R06 — catalogue A05 schedule reminders (in-app): lead null = nothing, past dates never, one per item and date,
// site local date, STOP and the switch respected by the job.
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../services/scheduleReminders');
const { runScheduleReminders } = require('../services/engagementJobs');
const { DEFAULTS } = require('../services/reportConfig');

const NOW = new Date('2026-11-06T10:00:00Z');   // Friday
const sites = [{ id: 1, name: 'Hounde', country: 'BF' }, { id: 2, name: 'London', time_zone: 'Europe/London' }];
const users = [{ id: 10, role: 'editor', roles: ['editor'], site_id: 1 }, { id: 11, role: 'editor', roles: ['editor'], site_id: 2, extra_site_ids: [1] }, { id: 12, role: 'viewer', roles: ['viewer'], site_id: 1 }, { id: 13, role: 'editor', roles: ['editor'], site_id: 1, active: 0 }];
const base = { sites, users, now: NOW,
  meetings: [{ id: 5, site_id: 1, department: 'Mining', next_meeting_date: '2026-11-09' }, { id: 6, site_id: 1, department: 'HR', next_meeting_date: '2026-11-01' }, { id: 7, site_id: 1, department: 'Plant', next_meeting_date: '2026-12-20', incubation: true }],
  cadences: [{ id: 3, key: 'hgo-weekly', name: 'Hounde weekly IT', site_id: 1, weekday: 1, time_local: '09:00', active: 1 }],
  inspections: [{ site_id: 1, last_date: '2026-08-10' }] };

test('switches ship at today\'s behaviour (off)', () => {
  assert.equal(DEFAULTS.schedule_reminders_enabled, '0'); assert.equal(DEFAULTS.schedule_reminder_lead_days, ''); assert.equal(DEFAULTS.schedule_inspection_interval_days, '');
});
test('lead days null / empty / invalid = nothing at all', () => {
  for (const v of [null, undefined, '', 'x', -1]) assert.deepEqual(R.buildReminders({ ...base, leadDays: v }).items, []);
});
test('within lead: future PV and cadence reminded to the site editors; past or far dates are not', () => {
  const { items } = R.buildReminders({ ...base, leadDays: 5 });
  assert.deepEqual(items.map((i) => i.key), ['A05:cadence:hgo-weekly:2026-11-09', 'A05:meeting:1:mining:2026-11-09']);
  assert.deepEqual(items[0].userIds, [10, 11], 'active editors of the site, including a multi-site editor; viewer and inactive excluded');
  assert.match(items[1].body, /in 3 d/);
});
test('inspection due = last + interval, only when the interval is set', () => {
  assert.ok(!R.buildReminders({ ...base, leadDays: 5 }).items.some((i) => i.kind === 'inspection'));
  const it = R.buildReminders({ ...base, leadDays: 5, inspectionIntervalDays: 90 }).items.find((i) => i.kind === 'inspection');
  assert.equal(it.key, 'A05:inspection:1:2026-11-08');
});
test('same item and date twice → one reminder; site local date is used', () => {
  const dup = { ...base, meetings: [base.meetings[0], { ...base.meetings[0], id: 9 }], cadences: [] };
  assert.equal(R.buildReminders({ ...dup, leadDays: 5 }).items.length, 1);
  assert.equal(R.localDay(new Date('2026-07-01T23:30:00Z'), 'Europe/London'), '2026-07-02');
  assert.equal(R.localDay(new Date('2026-07-01T23:30:00Z'), null), '2026-07-01');
  assert.equal(R.nextCadenceDate({ weekday: 7 }, '2026-11-06'), '2026-11-08');
  assert.equal(R.nextCadenceDate({ weekday: 1, effective_to: '2026-11-07' }, '2026-11-06'), null);
});

function job(cfg, sentKeys = new Set()) {
  const notes = [];
  return runScheduleReminders({ cfg, now: NOW, read: async () => base, sent: async (k) => sentKeys.has(k), store: { notify: async (n) => notes.push(n) } }).then((r) => ({ r, notes }));
}
test('job: switch off, STOP and missing lead days write nothing', async () => {
  assert.equal((await job({ schedule_reminder_lead_days: '5' })).notes.length, 0);
  assert.equal((await job({ schedule_reminders_enabled: '1', schedule_reminder_lead_days: '5', notifications_stop: '1' })).r.skipped, 'notifications_stop');
  assert.equal((await job({ schedule_reminders_enabled: '1' })).r.skipped, 'no lead days');
});
test('job: armed → in-app notices keyed for dedup; an already-sent key is skipped', async () => {
  const cfg = { schedule_reminders_enabled: '1', schedule_reminder_lead_days: '5' };
  const { r, notes } = await job(cfg);
  assert.equal(r.items, 2); assert.equal(notes.length, 4);
  assert.ok(notes.every((n) => n.kind === 'schedule_reminder' && n.sourceKind === 'schedule_reminder' && /^A05:/.test(n.sourceRef)));
  const again = await job(cfg, new Set(notes.map((n) => n.sourceRef)));
  assert.equal(again.notes.length, 0); assert.equal(again.r.already, 2);
});

test('live readers: the SQL runs on PostgreSQL and an unknown key is not sent', async () => {
  const { scheduleReaders } = require('../services/engagementJobs');
  const r = scheduleReaders(require('../reports-db'));
  const d = await r.read();
  for (const k of ['meetings', 'cadences', 'inspections', 'sites', 'users']) assert.ok(Array.isArray(d[k]), k);
  assert.equal(await r.sent('A05:none:x:2026-01-01'), false);
});
