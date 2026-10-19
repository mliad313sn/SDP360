'use strict';
// Weekly-report email, Task 5 — reportSchedule must (a) route report_type
// 'weekly_report' to its OWN CLI (tools/reports/send-weekly.js) and leave every
// other type on send-reports.js, and (b) accept 'weekly_report' as a valid TYPE
// so setSchedule persists the row and creates the Task Scheduler job.
//
// The routing matters: send-reports.js's SUPPORTED_TYPES is deliberately NOT
// extended, so if cliFor fell through to it the scheduled task would print
// "not implemented yet" and silently never send.
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const rs = require('../services/reportSchedule');

function freshDb() { const db = new Database(':memory:'); rs._initSchema(db); return db; }

test('cliFor maps weekly_report → send-weekly.js and leaves the others alone', () => {
  assert.ok(rs.cliFor('weekly_report').endsWith('send-weekly.js'));
  assert.ok(rs.cliFor('hygiene').endsWith('send-hygiene.js'));
  assert.ok(rs.cliFor('scoreboard').endsWith('send-scoreboard.js'));
  assert.ok(rs.cliFor('coordinator').endsWith('send-reports.js'));
  assert.ok(rs.cliFor('group').endsWith('send-reports.js'));
  assert.ok(rs.cliFor('finance').endsWith('send-reports.js'));
});

test('weekly_report must NOT route through send-reports.js (which would refuse it)', () => {
  const { SUPPORTED_TYPES } = require('../tools/reports/send-reports');
  assert.ok(!SUPPORTED_TYPES.includes('weekly_report'),
    'send-reports.js deliberately does not support it — cliFor is what keeps it working');
  assert.ok(!rs.cliFor('weekly_report').endsWith('send-reports.js'));
});

test('setSchedule accepts report_type=weekly_report (TYPES includes it)', async () => {
  const db = freshDb();
  let captured = null;
  const r = await rs.setSchedule(
    db,
    { report_type: 'weekly_report', cadence: 'weekly', enabled: true, day: 'MON', time: '07:30' },
    'u',
    { runTask: async (spec) => { captured = spec; return { ok: true }; } },
  );
  assert.strictEqual(r.ok, true);
  assert.ok(captured, 'runTask was invoked');
  assert.strictEqual(captured.report_type, 'weekly_report');
  assert.strictEqual(captured.taskName, 'SDP-Report-weekly_report-weekly');

  const row = rs.getSchedules(db).find(x => x.report_type === 'weekly_report' && x.cadence === 'weekly');
  assert.ok(row, 'weekly_report row persisted');
  assert.strictEqual(row.enabled, 1);
  assert.strictEqual(row.day, 'MON');
  assert.strictEqual(row.time, '07:30');
});
