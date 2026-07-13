'use strict';
// Scheduled-backup bridge between the admin card and tools/installer/
// Manage-SDP.ps1 (the single backup implementation). The app only CONFIGURES
// the Windows Task Scheduler jobs — the jobs themselves run even when the app
// is down, which is the whole point.
//
// Test seams (never used in prod):
//   MANAGE_CMD      executable (default: powershell)
//   MANAGE_PS1      script consumed by MANAGE_CMD (default: Manage-SDP.ps1)
//   SDP_BACKUP_DIR  restore-points dir override
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const PS1 = process.env.MANAGE_PS1 || path.join(APP_ROOT, 'tools', 'installer', 'Manage-SDP.ps1');
const CMD = process.env.MANAGE_CMD || 'powershell';

// BackupDir + retention defaults come from the installer's config.psd1 —
// tiny regex read, no PowerShell round-trip. InstallDir is NOT read from the
// config: the app resolves its own root (the server always runs in place).
function _cfg() {
  const out = { BackupDir: '..\\SDP-Backups', RetentionFull: 8, RetentionDbOnly: 14 };
  try {
    const txt = fs.readFileSync(path.join(APP_ROOT, 'tools', 'installer', 'config.psd1'), 'utf8');
    const grab = (k) => { const m = txt.match(new RegExp(k + "\\s*=\\s*'?([^'\\r\\n]+)'?")); return m ? m[1].trim() : null; };
    out.BackupDir = grab('BackupDir') || out.BackupDir;
    out.RetentionFull = parseInt(grab('RetentionFull'), 10) || out.RetentionFull;
    out.RetentionDbOnly = parseInt(grab('RetentionDbOnly'), 10) || out.RetentionDbOnly;
  } catch (_) { /* defaults */ }
  return out;
}

function _backupDir() {
  if (process.env.SDP_BACKUP_DIR) return process.env.SDP_BACKUP_DIR;
  return path.resolve(APP_ROOT, _cfg().BackupDir);
}

function _run(actionArgs, timeoutMs = 300000) {
  const args = CMD.toLowerCase().includes('powershell')
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, ...actionArgs]
    : [PS1, ...actionArgs];
  return new Promise((resolve, reject) => {
    execFile(CMD, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err && err.killed) return reject(new Error('Manage-SDP timed out'));
      // Manage-SDP exits non-zero on Die(); surface stdout+stderr either way.
      resolve({ code: err ? (err.code || 1) : 0, output: String(stdout || '') + String(stderr || '') });
    });
  });
}

async function getStatus() {
  const r = await _run(['-ScheduleStatus']);
  const st = { daily: { exists: false }, weekly: { exists: false } };
  r.output.split(/\r?\n/).forEach(line => {
    const m = line.match(/^(daily|weekly)\.([A-Za-z]+)=(.*)$/);
    if (!m) return;
    const [, which, key, raw] = m;
    let v = raw.trim();
    if (key === 'exists' || key === 'enabled') v = (v === '1');
    else if (key === 'retentionFull' || key === 'retentionDbOnly') v = parseInt(v, 10);
    st[which][key] = v;
  });
  return st;
}

function _assertTime(label, v) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''))) throw new Error(`invalid ${label} time "${v}" (expected HH:mm)`);
}

async function setSchedule({ daily, weeklyDay, weeklyTime, retentionFull, retentionDbOnly, enabled } = {}) {
  if (enabled === false) {
    const r = await _run(['-Schedule', '-Disable']);
    if (r.code !== 0) throw new Error('disable failed: ' + r.output.slice(-300));
    return { ok: true, disabled: true };
  }
  _assertTime('daily', daily);
  _assertTime('weekly', weeklyTime);
  const day = String(weeklyDay || '').toUpperCase();
  if (!['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].includes(day)) throw new Error(`invalid weekly day "${weeklyDay}"`);
  const cfg = _cfg();
  const rf = parseInt(retentionFull, 10) || cfg.RetentionFull;
  const rd = parseInt(retentionDbOnly, 10) || cfg.RetentionDbOnly;
  const r = await _run(['-Schedule', '-Daily', daily, '-Weekly', `${day}:${weeklyTime}`,
                        '-RetentionFull', String(rf), '-RetentionDbOnly', String(rd)]);
  if (r.code !== 0) throw new Error('schedule failed: ' + r.output.slice(-300));
  return { ok: true, output: r.output };
}

async function backupNow({ dbOnly } = {}) {
  const args = ['-Backup'];
  if (dbOnly) args.push('-DbOnly');
  args.push('-Tag', 'admin-ui');
  const r = await _run(args, 900000);   // full backup can take a while
  if (r.code !== 0) throw new Error('backup failed: ' + r.output.slice(-300));
  return { ok: true, output: r.output };
}

async function listRestorePoints() {
  const dir = _backupDir();
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  return names
    .filter(n => /^sdp-restore_.*\.zip$/.test(n) || /^sdp-db_.*\.sql$/.test(n))
    .map(n => { const st = fs.statSync(path.join(dir, n)); return { name: n, sizeBytes: st.size, mtime: st.mtime.toISOString() }; })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

module.exports = { getStatus, setSchedule, backupNow, listRestorePoints };
