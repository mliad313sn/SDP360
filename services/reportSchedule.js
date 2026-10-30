'use strict';
// report_schedules store + Windows Task Scheduler bridge. One task per enabled
// (report_type, cadence). Mirrors services/backupSchedule.js (schtasks via
// execFile). runTask is injectable for tests.
const { execFile } = require('child_process');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const SEND_CLI = path.join(APP_ROOT, 'tools', 'reports', 'send-reports.js');
const SEND_HYGIENE_CLI = path.join(APP_ROOT, 'tools', 'reports', 'send-hygiene.js');
const SEND_SCOREBOARD_CLI = path.join(APP_ROOT, 'tools', 'reports', 'send-scoreboard.js');
const SEND_WEEKLY_CLI = path.join(APP_ROOT, 'tools', 'reports', 'send-weekly.js');
const SEND_ASSET_GROUP_CLI = path.join(APP_ROOT, 'tools', 'reports', 'send-asset-group.js');
const SEND_ASSET_REMINDERS_CLI = path.join(APP_ROOT, 'tools', 'reports', 'send-asset-reminders.js');
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const TYPES = ['coordinator', 'group', 'finance', 'hygiene', 'scoreboard', 'weekly_report', 'asset_group', 'asset_reminder'];

// The hygiene digest, the scoreboard email and the weekly report each have their
// own CLI (hygiene composes the Group-IT digest; scoreboard and weekly_report
// each loop per-site coordinators); every other type routes through
// send-reports.js. weekly_report MUST route here — send-reports.js's
// SUPPORTED_TYPES deliberately excludes it, so falling through would make the
// scheduled task print "not implemented yet" and silently never send.
function cliFor(report_type) {
  if (report_type === 'hygiene') return SEND_HYGIENE_CLI;
  if (report_type === 'scoreboard') return SEND_SCOREBOARD_CLI;
  if (report_type === 'weekly_report') return SEND_WEEKLY_CLI;
  if (report_type === 'asset_group') return SEND_ASSET_GROUP_CLI;
  if (report_type === 'asset_reminder') return SEND_ASSET_REMINDERS_CLI;
  return SEND_CLI;
}

function _h(db) {
  const rdb = require('../reports-db');
  return { H: rdb.pgHandle(), isPg: true };
}


function getSchedules(db) {
  const { H, isPg } = _h(db);
  const SQL = 'SELECT report_type, cadence, enabled, day, time, updated_at, updated_by FROM report_schedules ORDER BY report_type, cadence';
  return H.prepare(SQL).all();
}

function _assertTime(v) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''))) throw new Error(`invalid time "${v}" (expected HH:mm)`); }

const _UPSERT = `INSERT INTO report_schedules (report_type, cadence, enabled, day, time, updated_at, updated_by)
  VALUES (?, ?, ?, ?, ?, {NOW}, ?)
  ON CONFLICT(report_type, cadence) DO UPDATE SET
    enabled=excluded.enabled, day=excluded.day, time=excluded.time,
    updated_at=excluded.updated_at, updated_by=excluded.updated_by`;
function _writeRow(db, { report_type, cadence, enabled, day, time }, user) {
  const { H, isPg } = _h(db);
  return H.prepare(_UPSERT.replace('{NOW}', 'now()')).run(report_type, cadence, enabled ? 1 : 0, day || null, time || null, user || 'unknown');
}

// Default real task runner via schtasks. Injected stub in tests.
// /RU SYSTEM is load-bearing (2026-09-21): without it the task runs as the account
// that created it (pm2 = the machine account ABJ-SRV-012$) in "Interactive only" mode,
// so on a server nobody logs on to it NEVER starts (Last Result 267011, last run
// 1999) — every scheduled report since 2026-08-11 silently never ran. The backup
// tasks (tools/installer/Manage-SDP.ps1) already used /RU SYSTEM.
function _taskArgs(spec) {
  if (spec.action === 'delete') return ['/Delete', '/TN', spec.taskName, '/F'];
  const tr = `"${NODE}" "${cliFor(spec.report_type)}" --type=${spec.report_type} --cadence=${spec.cadence}`;
  const base = ['/Create', '/F', '/RU', 'SYSTEM'];
  if (spec.cadence === 'weekly') {
    return [...base, '/SC', 'WEEKLY', '/D', spec.day, '/TN', spec.taskName, '/TR', tr, '/ST', spec.time];
  }
  if (String(spec.day).toUpperCase() === 'LAST') {
    // schtasks LASTDAY requires /MO LASTDAY /D * (NOT /D LAST)
    return [...base, '/SC', 'MONTHLY', '/MO', 'LASTDAY', '/D', '*', '/TN', spec.taskName, '/TR', tr, '/ST', spec.time];
  }
  return [...base, '/SC', 'MONTHLY', '/D', String(spec.day), '/TN', spec.taskName, '/TR', tr, '/ST', spec.time];
}
function _defaultRunTask(spec) {
  return new Promise((resolve, reject) => {
    const args = _taskArgs(spec);
    execFile('schtasks', args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err && spec.action === 'delete') return resolve({ ok: true, note: 'delete ignored: ' + (stderr || err.message) });
      if (err) return reject(new Error('schtasks failed: ' + (String(stderr || '') + String(err.message))));
      resolve({ ok: true, output: String(stdout || '') });
    });
  });
}

// Create the task FIRST; only write the row if the task command succeeded
// (no half-apply). On disable: delete task (ignored if absent) + set enabled=0.
async function setSchedule(db, { report_type, cadence, enabled, day, time } = {}, user, deps = {}) {
  const runTask = deps.runTask || _defaultRunTask;
  if (!TYPES.includes(report_type)) throw new Error(`invalid report_type "${report_type}"`);
  if (!['weekly', 'monthly'].includes(cadence)) throw new Error(`invalid cadence "${cadence}"`);
  const taskName = `SDP-Report-${report_type}-${cadence}`;
  if (!enabled) {
    await runTask({ action: 'delete', taskName, report_type, cadence });
    await _writeRow(db, { report_type, cadence, enabled: 0, day, time }, user);
    return { ok: true, disabled: true };
  }
  _assertTime(time);
  let d = String(day || '').toUpperCase();
  if (cadence === 'weekly') {
    if (!DAYS.includes(d)) throw new Error(`invalid weekly day "${day}"`);
  } else {
    // monthly: accept 'LAST' (any case) or an integer 1-31
    if (d === 'LAST') {
      d = 'LAST';
    } else if (/^\d+$/.test(d) && Number(d) >= 1 && Number(d) <= 31) {
      d = String(Number(d));
    } else {
      throw new Error(`invalid monthly day "${day}" (expected 1-31 or LAST)`);
    }
  }
  await runTask({ action: 'create', taskName, report_type, cadence, day: d, time });   // throws → no row write
  await _writeRow(db, { report_type, cadence, enabled: 1, day: d, time }, user);
  return { ok: true };
}

module.exports = { getSchedules, setSchedule, cliFor, _taskArgs };
