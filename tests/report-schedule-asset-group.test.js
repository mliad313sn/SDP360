'use strict';
// Assets reports integration, Task 3 — reportSchedule must (a) map report_type
// 'asset_group' to its dedicated send-asset-group.js (cliFor) and (b) accept
// 'asset_group' as a valid TYPES so setSchedule persists a row. Mirrors
// tests/report-schedule-hygiene.test.js.
const test = require('node:test');
const assert = require('node:assert');
const rs = require('../services/reportSchedule');

async function freshDb() { return require('./_pg-fresh').fresh(['report_schedules']); }

test('cliFor maps asset_group → send-asset-group.js, coordinator → send-reports.js', () => {
  assert.ok(rs.cliFor('asset_group').endsWith('send-asset-group.js'));
  assert.ok(rs.cliFor('coordinator').endsWith('send-reports.js'));
  assert.ok(rs.cliFor('hygiene').endsWith('send-hygiene.js'));
});

test('setSchedule accepts report_type=asset_group (TYPES includes it)', async () => {
  const db = (await freshDb());
  let captured = null;
  const r = await rs.setSchedule(
    db,
    { report_type: 'asset_group', cadence: 'monthly', enabled: true, day: 'LAST', time: '07:00' },
    'u',
    { runTask: async (spec) => { captured = spec; return { ok: true }; } },
  );
  assert.strictEqual(r.ok, true);
  assert.ok(captured, 'runTask was invoked');
  assert.strictEqual(captured.report_type, 'asset_group');
  const row = (await rs.getSchedules(db)).find(x => x.report_type === 'asset_group' && x.cadence === 'monthly');
  assert.ok(row, 'asset_group row persisted');
  assert.strictEqual(row.enabled, 1);
});
