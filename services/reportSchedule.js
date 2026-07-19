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
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const TYPES = ['coordinator', 'group', 'finance', 'hygiene', 'scoreboard'];

// The hygiene digest and the scoreboard email each have their own CLI (the
// hygiene one composes the Group-IT digest; the scoreboard one loops per-site
// coordinators); every other type routes through send-reports.js.
function cliFor(report_type) {
  if (report_type === 'hygiene') return SEND_HYGIENE_CLI;
  if (report_type === 'scoreboard') return SEND_SCOREBOARD_CLI;
  return SEND_CLI;
}

function _h(db) {
  const rdb = require('../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  return { H: db, isPg: false };
}

const _inited = new WeakSet();
function _initSchema(db) {
  if (_h(db).isPg) return;
  if (_inited.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS report_schedules (
    report_type TEXT, cadence TEXT, enabled INTEGER DEFAULT 0,
    day TEXT, time TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_by TEXT,
    PRIMARY KEY (report_type, cadence)
  );`);
  _inited.add(db);
}

function getSchedules(db) {
  const { H, isPg } = _h(db);
  const SQL = 'SELECT report_type, cadence, enabled, day, time, updated_at, updated_by FROM report_schedules ORDER BY report_type, cadence';
  if (isPg) return H.prepare(SQL).all();
  _initSchema(db);
  try { return H.prepare(SQL).all(); } catch (e) { console.warn('[report-sched] list failed:', e.message); return []; }
}

function _assertTime(v) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''))) throw new Error(`invalid time "${v}" (expected HH:mm)`); }

const _UPSERT = `INSERT INTO report_schedules (report_type, cadence, enabled, day, time, updated_at, updated_by)
  VALUES (?, ?, ?, ?, ?, {NOW}, ?)
  ON CONFLICT(report_type, cadence) DO UPDATE SET
    enabled=excluded.enabled, day=excluded.day, time=excluded.time,
    updated_at=excluded.updated_at, updated_by=excluded.updated_by`;
function _writeRow(db, { report_type, cadence, enabled, day, time }, user) {
  const { H, isPg } = _h(db);
  if (isPg) return H.prepare(_UPSERT.replace('{NOW}', 'now()')).run(report_type, cadence, enabled ? 1 : 0, day || null, time || null, user || 'unknown');
  _initSchema(db);
  H.prepare(_UPSERT.replace('{NOW}', "datetime('now')")).run(report_type, cadence, enabled ? 1 : 0, day || null, time || null, user || 'unknown');
}

// Default real task runner via schtasks. Injected stub in tests.
function _defaultRunTask(spec) {
  return new Promise((resolve, reject) => {
    let args;
    if (spec.action === 'delete') {
      args = ['/Delete', '/TN', spec.taskName, '/F'];
    } else {
      const tr = `"${NODE}" "${cliFor(spec.report_type)}" --type=${spec.report_type} --cadence=${spec.cadence}`;
      if (spec.cadence === 'weekly') {
        args = ['/Create', '/F', '/SC', 'WEEKLY', '/D', spec.day, '/TN', spec.taskName, '/TR', tr, '/ST', spec.time];
      } else if (String(spec.day).toUpperCase() === 'LAST') {
        // schtasks LASTDAY requires /MO LASTDAY /D * (NOT /D LAST)
        args = ['/Create', '/F', '/SC', 'MONTHLY', '/MO', 'LASTDAY', '/D', '*', '/TN', spec.taskName, '/TR', tr, '/ST', spec.time];
      } else {
        args = ['/Create', '/F', '/SC', 'MONTHLY', '/D', String(spec.day), '/TN', spec.taskName, '/TR', tr, '/ST', spec.time];
      }
    }
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
    _writeRow(db, { report_type, cadence, enabled: 0, day, time }, user);
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
  _writeRow(db, { report_type, cadence, enabled: 1, day: d, time }, user);
  return { ok: true };
}

module.exports = { _initSchema, getSchedules, setSchedule, cliFor };
