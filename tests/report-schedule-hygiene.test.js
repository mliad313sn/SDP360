'use strict';
// Sub-project B, Task 5 — reportSchedule must (a) map report_type 'hygiene' to
// send-hygiene.js and everything else to send-reports.js (cliFor), and (b) accept
// 'hygiene' as a valid TYPES so setSchedule persists a hygiene row.
const test = require('node:test');
const assert = require('node:assert');
const rs = require('../services/reportSchedule');

async function freshDb() { return require('./_pg-fresh').fresh(['report_schedules']); }

test('cliFor maps hygiene → send-hygiene.js, coordinator → send-reports.js', () => {
  assert.ok(rs.cliFor('hygiene').endsWith('send-hygiene.js'));
  assert.ok(rs.cliFor('coordinator').endsWith('send-reports.js'));
  assert.ok(rs.cliFor('group').endsWith('send-reports.js'));
  assert.ok(rs.cliFor('finance').endsWith('send-reports.js'));
});

test('setSchedule accepts report_type=hygiene (TYPES includes it)', async () => {
  const db = (await freshDb());
  let captured = null;
  const r = await rs.setSchedule(
    db,
    { report_type: 'hygiene', cadence: 'weekly', enabled: true, day: 'MON', time: '07:00' },
    'u',
    { runTask: async (spec) => { captured = spec; return { ok: true }; } },
  );
  assert.strictEqual(r.ok, true);
  assert.ok(captured, 'runTask was invoked');
  assert.strictEqual(captured.report_type, 'hygiene');
  const row = (await rs.getSchedules(db)).find(x => x.report_type === 'hygiene' && x.cadence === 'weekly');
  assert.ok(row, 'hygiene row persisted');
  assert.strictEqual(row.enabled, 1);
});
