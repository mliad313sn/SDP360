'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const rs = require('../services/reportSchedule');
function freshDb() { const db = new Database(':memory:'); rs._initSchema(db); return db; }

test('cliFor(asset_reminder) → send-asset-reminders.js; others unchanged', () => {
  assert.ok(rs.cliFor('asset_reminder').endsWith('send-asset-reminders.js'));
  assert.ok(rs.cliFor('weekly_report').endsWith('send-weekly.js'));
  assert.ok(rs.cliFor('coordinator').endsWith('send-reports.js'));
});
test('setSchedule accepts asset_reminder WEEKLY MON 07:00', async () => {
  const db = freshDb();
  let spec = null;
  const r = await rs.setSchedule(db, { report_type: 'asset_reminder', cadence: 'weekly', enabled: true, day: 'MON', time: '07:00' }, 'u',
    { runTask: async (s) => { spec = s; return { ok: true }; } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(spec.report_type, 'asset_reminder');
  assert.strictEqual(rs.getSchedules(db).find(x => x.report_type === 'asset_reminder').enabled, 1);
});
