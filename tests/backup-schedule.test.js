'use strict';
// services/backupSchedule.js — TDD. The service NEVER touches real schtasks or
// real backups in tests: MANAGE_CMD/MANAGE_PS1 point at a Node stub that logs
// its argv and prints canned Manage-SDP.ps1 output.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-bstest-'));
const argvLog = path.join(tmp, 'argv.jsonl');
const stub = path.join(tmp, 'stub.js');
fs.writeFileSync(stub, `
  const fs = require('fs');
  fs.appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
  if (process.argv.includes('-ScheduleStatus')) {
    console.log('daily.exists=1');
    console.log('daily.enabled=1');
    console.log('daily.lastRun=2026-07-13 02:00');
    console.log('daily.lastResult=0');
    console.log('daily.retentionFull=8');
    console.log('daily.retentionDbOnly=14');
    console.log('daily.startTime=02:00');
    console.log('weekly.exists=0');
  } else if (process.argv.includes('-Backup')) {
    console.log('12:00:00 [OK] DB backup done: X');
  } else {
    console.log('12:00:00 [OK] Scheduled: ...');
  }
`);

process.env.MANAGE_CMD = process.execPath;   // node
process.env.MANAGE_PS1 = stub;               // stub consumes the action args directly
process.env.SDP_BACKUP_DIR = tmp;            // listRestorePoints reads here

const bs = require('../services/backupSchedule');

function loggedCalls() {
  if (!fs.existsSync(argvLog)) return [];
  return fs.readFileSync(argvLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
}

test('getStatus parses the KEY=VALUE digest into daily/weekly objects', async () => {
  const st = await bs.getStatus();
  assert.equal(st.daily.exists, true);
  assert.equal(st.daily.enabled, true);
  assert.equal(st.daily.lastResult, '0');
  assert.equal(st.daily.retentionFull, 8);
  assert.equal(st.daily.startTime, '02:00');
  assert.equal(st.weekly.exists, false);
});

test('setSchedule invokes Manage -Schedule with daily/weekly/retention args', async () => {
  fs.rmSync(argvLog, { force: true });
  await bs.setSchedule({ daily: '02:00', weeklyDay: 'SUN', weeklyTime: '03:00', retentionFull: 9, retentionDbOnly: 20, enabled: true });
  const calls = loggedCalls();
  assert.equal(calls.length, 1);
  const a = calls[0];
  assert.ok(a.includes('-Schedule'));
  assert.equal(a[a.indexOf('-Daily') + 1], '02:00');
  assert.equal(a[a.indexOf('-Weekly') + 1], 'SUN:03:00');
  assert.equal(a[a.indexOf('-RetentionFull') + 1], '9');
  assert.equal(a[a.indexOf('-RetentionDbOnly') + 1], '20');
});

test('setSchedule enabled=false sends -Schedule -Disable', async () => {
  fs.rmSync(argvLog, { force: true });
  await bs.setSchedule({ enabled: false });
  const a = loggedCalls()[0];
  assert.ok(a.includes('-Schedule') && a.includes('-Disable'));
});

test('setSchedule validates time formats', async () => {
  await assert.rejects(async () => bs.setSchedule({ daily: '2 pm', weeklyDay: 'SUN', weeklyTime: '03:00', enabled: true }), /invalid/i);
  await assert.rejects(async () => bs.setSchedule({ daily: '02:00', weeklyDay: 'FUNDAY', weeklyTime: '03:00', enabled: true }), /invalid/i);
});

test('backupNow runs -Backup [-DbOnly] and returns output', async () => {
  fs.rmSync(argvLog, { force: true });
  const r = await bs.backupNow({ dbOnly: true });
  const a = loggedCalls()[0];
  assert.ok(a.includes('-Backup') && a.includes('-DbOnly'));
  assert.match(r.output, /DB backup done/);
});

test('listRestorePoints returns backup files newest-first', async () => {
  fs.writeFileSync(path.join(tmp, 'sdp-restore_t_20260101-000000.zip'), 'zz');
  fs.writeFileSync(path.join(tmp, 'sdp-db_20260102-000000.sql'), 'ss');
  const pts = await bs.listRestorePoints();
  assert.equal(pts.length, 2);
  assert.ok(pts[0].name.startsWith('sdp-') && pts[0].sizeBytes > 0 && pts[0].mtime);
});
