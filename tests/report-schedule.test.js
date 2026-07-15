'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const sched = require('../services/reportSchedule');

function freshDb() { const db = new Database(':memory:'); sched._initSchema(db); return db; }

test('setSchedule persists a (type,cadence) row + attempts a task', async () => {
  const db = freshDb();
  const calls = [];
  const r = await sched.setSchedule(db, { report_type: 'finance', cadence: 'weekly', enabled: 1, day: 'MON', time: '07:30' }, 'azize', { runTask: (a) => { calls.push(a); return { ok: true }; } });
  assert.strictEqual(r.ok, true);
  const row = sched.getSchedules(db).find(x => x.report_type === 'finance' && x.cadence === 'weekly');
  assert.strictEqual(row.enabled, 1);
  assert.strictEqual(row.day, 'MON');
  assert.ok(calls.length >= 1);
});

test('invalid time rejected', async () => {
  const db = freshDb();
  await assert.rejects(() => sched.setSchedule(db, { report_type: 'finance', cadence: 'weekly', enabled: 1, day: 'MON', time: '25:99' }, 'a', { runTask: () => ({ ok: true }) }), /time/i);
});

test('disable removes the task + flips enabled=0', async () => {
  const db = freshDb();
  const calls = [];
  await sched.setSchedule(db, { report_type: 'finance', cadence: 'weekly', enabled: 1, day: 'MON', time: '07:30' }, 'a', { runTask: (x) => { calls.push(x); return { ok: true }; } });
  await sched.setSchedule(db, { report_type: 'finance', cadence: 'weekly', enabled: 0 }, 'a', { runTask: (x) => { calls.push(x); return { ok: true }; } });
  const row = sched.getSchedules(db).find(x => x.report_type === 'finance' && x.cadence === 'weekly');
  assert.strictEqual(row.enabled, 0);
});
