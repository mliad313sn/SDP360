'use strict';
// Scheduled report tasks must run as SYSTEM: created without /RU they run as the pm2
// machine account in "Interactive only" mode and never start (prod, 2026-08-11 → 09-21).
const test = require('node:test');
const assert = require('node:assert');
const { _taskArgs } = require('../services/reportSchedule');

for (const spec of [
  { report_type: 'weekly_report', cadence: 'weekly', day: 'MON', time: '07:00', taskName: 'SDP-Report-weekly_report-weekly' },
  { report_type: 'coordinator', cadence: 'monthly', day: '1', time: '07:00', taskName: 'SDP-Report-coordinator-monthly' },
  { report_type: 'group', cadence: 'monthly', day: 'LAST', time: '07:00', taskName: 'SDP-Report-group-monthly' },
]) {
  test(`${spec.taskName}: created with /RU SYSTEM`, () => {
    const a = _taskArgs(spec);
    const i = a.indexOf('/RU');
    assert.ok(i > 0 && a[i + 1] === 'SYSTEM');
    assert.ok(a.includes('/TR') && a[a.indexOf('/TR') + 1].includes(`--type=${spec.report_type}`));
  });
}
test('delete args untouched', () => {
  assert.deepStrictEqual(_taskArgs({ action: 'delete', taskName: 'X' }), ['/Delete', '/TN', 'X', '/F']);
});
