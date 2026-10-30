'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sched = require('../services/reportSchedule');

async function freshDb() { return require('./_pg-fresh').fresh(['report_schedules']); }

test('setSchedule persists a (type,cadence) row + attempts a task', async () => {
  const db = (await freshDb());
  const calls = [];
  const r = await sched.setSchedule(db, { report_type: 'finance', cadence: 'weekly', enabled: 1, day: 'MON', time: '07:30' }, 'azize', { runTask: (a) => { calls.push(a); return { ok: true }; } });
  assert.strictEqual(r.ok, true);
  const row = (await sched.getSchedules(db)).find(x => x.report_type === 'finance' && x.cadence === 'weekly');
  assert.strictEqual(row.enabled, 1);
  assert.strictEqual(row.day, 'MON');
  assert.ok(calls.length >= 1);
});

test('invalid time rejected', async () => {
  const db = (await freshDb());
  await assert.rejects(async () => (await sched.setSchedule(db, { report_type: 'finance', cadence: 'weekly', enabled: 1, day: 'MON', time: '25:99' }, 'a', { runTask: () => ({ ok: true }) })), /time/i);
});

test('disable removes the task + flips enabled=0', async () => {
  const db = (await freshDb());
  const calls = [];
  await sched.setSchedule(db, { report_type: 'finance', cadence: 'weekly', enabled: 1, day: 'MON', time: '07:30' }, 'a', { runTask: (x) => { calls.push(x); return { ok: true }; } });
  await sched.setSchedule(db, { report_type: 'finance', cadence: 'weekly', enabled: 0 }, 'a', { runTask: (x) => { calls.push(x); return { ok: true }; } });
  const row = (await sched.getSchedules(db)).find(x => x.report_type === 'finance' && x.cadence === 'weekly');
  assert.strictEqual(row.enabled, 0);
});

test('monthly schedule passes the day-of-month through to runTask', async () => {
  const db = (await freshDb());
  const calls = [];
  await sched.setSchedule(db, { report_type: 'finance', cadence: 'monthly', enabled: 1, day: '25', time: '07:30' }, 'a', { runTask: (x) => { calls.push(x); return { ok: true }; } });
  const create = calls.find(c => c.action === 'create');
  assert.strictEqual(String(create.day), '25');
  const row = (await sched.getSchedules(db)).find(x => x.report_type === 'finance' && x.cadence === 'monthly');
  assert.strictEqual(row.day, '25');
});

test('monthly LAST is accepted and normalized', async () => {
  const db = (await freshDb());
  const calls = [];
  await sched.setSchedule(db, { report_type: 'finance', cadence: 'monthly', enabled: 1, day: 'last', time: '07:30' }, 'a', { runTask: (x) => { calls.push(x); return { ok: true }; } });
  assert.strictEqual(calls.find(c => c.action === 'create').day, 'LAST');
});

test('invalid monthly day rejected', async () => {
  const db = (await freshDb());
  await assert.rejects(async () => (await sched.setSchedule(db, { report_type: 'finance', cadence: 'monthly', enabled: 1, day: 'xyz', time: '07:30' }, 'a', { runTask: () => ({ ok: true }) })), /monthly day/i);
});
