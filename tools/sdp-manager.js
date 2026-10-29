#!/usr/bin/env node
'use strict';
// Step 5 — SDP Dashboard Manager, command-line core.
//
//   node tools/sdp-manager.js status          [--dir <install>] [--url http://localhost:3456]
//   node tools/sdp-manager.js backup          [--dir <install>] [--out <backupDir>]
//   node tools/sdp-manager.js verify  <zip>   [--allow-unsigned] [--public-key <pem>]   # manifest + signature check only, touches nothing
//   node tools/sdp-manager.js update  <zip>   [--dir <install>] [--no-backup] [--no-npm] [--no-migrate] [--no-restart] [--allow-downgrade] [--allow-unsigned] [--public-key <pem>]
//   node tools/sdp-manager.js rollback        [--dir <install>] [--no-restart]
//   node tools/sdp-manager.js support-bundle  [--dir <install>] [--out <file.zip>]
//   node tools/sdp-manager.js service <start|stop|restart|status> [--dir <install>]   # Windows service or pm2 (services/serviceControl.js)
//   node tools/sdp-manager.js backups         [--dir <install>] [--json]             # the dumps in SDP_BACKUP_DIR, newest first
//   node tools/sdp-manager.js restore <dump>  --confirm "RESTORE <yyyymmdd>" [--dir <install>] [--no-restart]
//   add --json to status / backups / service status for the Windows Manager (one JSON object on stdout)
//
// The Windows Manager.exe (WPF) and the Inno Setup wizard both call THIS file: there is one
// implementation of "apply a package", exercised by tests/sdp-manager.smoke.test.js on a
// throwaway directory. Rules it enforces (services/updatePackage.js is the pure half):
//   - a package is applied only when every file hashes as its manifest says;
//   - E1: the manifest must carry an Ed25519 signature that verifies against the public key in
//     tools/manifest-public.pem (next to this file; --public-key overrides). No signature →
//     refused unless --allow-unsigned, and that override is LOGGED (logs/sdp-manager.log + the
//     system_log hook when one is injected). A signature that does not verify is ALWAYS refused:
//     an altered package is never applied, whatever the flags;
//   - downgrade refused (rollback is the way back); same version refused unless --reinstall;
//   - before copying: PostgreSQL dump (unless --no-backup) + the CURRENT runtime files are
//     kept under <dir>/.rollback/<version>/ — `rollback` restores them byte for byte;
//   - install state (.env, data/, logs/, node_modules/) is never written by a package;
//   - any failure after the copy (npm, migrator, health probe) triggers the rollback itself.
// Secrets: the .env is read for DASH_USER/DASH_PASS/PG_URL only; nothing from it is printed.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const JSZip = require('jszip');
const pkg = require('../services/updatePackage');

const DEFAULT_DIR = process.platform === 'win32' ? 'C:\\Apps\\SDP-Dashboard' : path.resolve(__dirname, '..');

function log(msg) { process.stdout.write(msg + '\n'); }
const DEFAULT_PUBLIC_KEY = path.join(__dirname, 'manifest-public.pem');
function loadPublicKey(file = DEFAULT_PUBLIC_KEY) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error(`manifest public key unreadable (${file}): ${e.message}`); }
}
/**
 * Manager audit line: appended to <dir>/logs/sdp-manager.log (created on demand) and handed to
 * `systemLog(event)` when the caller injects one (the server's rdb.logEvent, when reachable —
 * the standalone CLI has no open database, so the file is the floor, never the only hope).
 */
function auditLog(dir, event, { systemLog, out } = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  try { fs.mkdirSync(path.join(dir, 'logs'), { recursive: true }); fs.appendFileSync(path.join(dir, 'logs', 'sdp-manager.log'), line + '\n'); } catch (_) { /* no install dir yet */ }
  if (typeof systemLog === 'function') { try { const r = systemLog({ category: 'config', ...event }); if (r && r.catch) r.catch(() => {}); } catch (_) { /* never blocks */ } }
  if (out) out(`[update] AUDIT ${event.action}: ${event.detail || ''}`);
}
function arg(flag, def) { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; }
function has(flag) { return process.argv.includes(flag); }

function readEnv(dir) {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(dir, '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  } catch (_) { /* no .env yet */ }
  return out;
}
function installedManifest(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (_) { return null; }
}
function installedVersion(dir) {
  const m = installedManifest(dir);
  if (m && m.version) return m.version;
  try { return require(path.join(dir, 'package.json')).version || null; } catch (_) { return null; }
}

// ---- package reading -----------------------------------------------------------------
async function openPackage(zipPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const mf = zip.file('manifest.json');
  if (!mf) throw new Error('not an SDP package: manifest.json missing');
  const manifest = JSON.parse(await mf.async('string'));
  const blobs = new Map();
  for (const p of Object.keys(manifest.files || {})) {
    const f = zip.file('files/' + p);
    blobs.set(p, f ? await f.async('nodebuffer') : null);
  }
  return { manifest, blobs };
}
/**
 * Full pre-apply check: file hashes, protected paths, manifest SIGNATURE.
 * `result.signature` = { signed, ok, reason, key_id, allowed_unsigned }.
 */
async function verifyPackage(zipPath, { publicKeyPem, allowUnsigned = false } = {}) {
  const { manifest, blobs } = await openPackage(zipPath);
  const r = pkg.verifyManifest(manifest, (p) => blobs.get(p) || null);
  const prot = Object.keys(manifest.files || {}).filter(pkg.isProtected);
  if (prot.length) { r.ok = false; r.errors.push('package lists protected paths: ' + prot.join(', ')); }
  const sig = pkg.verifyManifestSignature(manifest, publicKeyPem || loadPublicKey());
  sig.allowed_unsigned = false;
  if (sig.signed && !sig.ok) { r.ok = false; r.errors.push('manifest signature invalid: ' + sig.reason); }
  else if (!sig.signed) {
    if (allowUnsigned) sig.allowed_unsigned = true;
    else { r.ok = false; r.errors.push('manifest is not signed (pass --allow-unsigned to accept a package of unknown origin — this is logged)'); }
  }
  r.signature = sig;
  return { manifest, blobs, result: r };
}

// ---- apply / rollback -----------------------------------------------------------------
function copyFile(src, dst) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
function writeFile(dst, buf) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, buf); }

// Install state and machine folders a whole-tree rollback point never copies.
const TREE_SKIP = ['.rollback/', 'runtime/', 'service/', 'manager/', 'backups/', '.setup/'];
function listTree(dir, base = dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (e.isDirectory()) {
      if (pkg.isProtected(rel + '/') || TREE_SKIP.some((x) => (rel + '/').startsWith(x))) continue;
      listTree(abs, base, out);
    } else if (e.isFile() && !pkg.isProtected(rel) && !TREE_SKIP.some((x) => rel.startsWith(x))) out.push(rel);
  }
  return out;
}
function keepForRollback(dir, oldManifest, label) {
  const dest = path.join(dir, '.rollback', label);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const kept = [];
  // UAT EA-03: an installation without manifest.json (v1, or a hand-copied tree) keeps its WHOLE tree —
  // keeping nothing made a failed first update delete the application on rollback.
  const files = oldManifest ? Object.keys(oldManifest.files || {}) : listTree(dir);
  for (const p of files) {
    const src = path.join(dir, p);
    if (fs.existsSync(src)) { copyFile(src, path.join(dest, 'files', p)); kept.push(p); }
  }
  if (oldManifest) fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(oldManifest, null, 2));
  fs.writeFileSync(path.join(dest, 'rollback.json'), JSON.stringify({ label, kept_at: new Date().toISOString(), files: kept }, null, 2));
  return { dest, kept };
}

function latestRollback(dir) {
  const base = path.join(dir, '.rollback');
  let names = [];
  try { names = fs.readdirSync(base).filter(n => fs.existsSync(path.join(base, n, 'rollback.json'))); } catch (_) { return null; }
  if (!names.length) return null;
  names.sort((a, b) => fs.statSync(path.join(base, b, 'rollback.json')).mtimeMs - fs.statSync(path.join(base, a, 'rollback.json')).mtimeMs);
  return path.join(base, names[0]);
}

function restoreFrom(dir, point, newManifest) {
  const info = JSON.parse(fs.readFileSync(path.join(point, 'rollback.json'), 'utf8'));
  // Remove files the failed package added, then put the kept files back.
  if (newManifest) {
    for (const p of Object.keys(newManifest.files || {})) {
      if (!info.files.includes(p)) { try { fs.rmSync(path.join(dir, p), { force: true }); } catch (_) { /* best effort */ } }
    }
  }
  for (const p of info.files) copyFile(path.join(point, 'files', p), path.join(dir, p));
  const oldMf = path.join(point, 'manifest.json');
  if (fs.existsSync(oldMf)) fs.copyFileSync(oldMf, path.join(dir, 'manifest.json'));
  else { try { fs.rmSync(path.join(dir, 'manifest.json'), { force: true }); } catch (_) { /* none before */ } }
  return info.files.length;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', ...opts });
  if (r.error) throw r.error;
  return r;
}

function restartService(dir, env) {
  // stop -> wait -> start, never `pm2 reload` (EADDRINUSE crash-loop, see CLAUDE.md). Windows service or pm2.
  require('../services/serviceControl').restart(env);
}

async function probeHealth(url, env, { timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no answer';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url + '/api/auth/config');
      if (res.ok) return { ok: true };
      last = 'HTTP ' + res.status;
    } catch (e) { last = e.message; }
    await new Promise(r => setTimeout(r, 2000));
  }
  return { ok: false, reason: last };
}

/**
 * Apply a package. `opts.steps` lets the smoke test (and a dry environment) skip the
 * external steps; the apply/rollback logic itself always runs.
 */
async function applyPackage(zipPath, { dir, backup = true, npm = true, migrate = true, restart = true, probe = true,
  allowDowngrade = false, reinstall = false, allowUnsigned = false, publicKeyPem, systemLog,
  url = 'http://localhost:3456', env = readEnv(dir), out = log, backupDir, afterCopy } = {}) {
  const { manifest, blobs, result } = await verifyPackage(zipPath, { publicKeyPem, allowUnsigned });
  if (!result.ok) {
    throw new Error(`package refused: ${result.errors.concat(result.missing.map(m => 'missing ' + m), result.mismatched.map(m => 'corrupt ' + m)).join('; ')}`);
  }
  if (result.signature.allowed_unsigned) {
    auditLog(dir, { action: 'package_unsigned_allowed', risk: 1, actor: os.userInfo().username, target: path.basename(zipPath),
      detail: `--allow-unsigned: unsigned package ${manifest.version} (commit ${manifest.commit || '?'}) accepted on operator decision`,
      details: { version: manifest.version, commit: manifest.commit || null, files: Object.keys(manifest.files || {}).length } }, { systemLog, out });
  } else {
    out(`[update] manifest signature OK (key ${result.signature.key_id})`);
  }
  const current = installedVersion(dir);
  const can = pkg.canApply(current, manifest.version, { allowDowngrade, allowSame: reinstall });
  if (!can.ok) throw new Error(can.reason);
  out(`[update] ${can.kind}: ${current || '(none)'} -> ${manifest.version} (${Object.keys(manifest.files).length} files, commit ${manifest.commit || '?'})`);

  if (backup) {
    const { runBackup } = require('../services/backup');
    const bdir = backupDir || env.SDP_BACKUP_DIR || path.join(dir, 'data', 'backups');
    const b = await runBackup({ dir: bdir, env: { ...process.env, ...env } });
    out(b.skipped ? `[update] database backup skipped (${b.skipped === true ? b.reason : b.skipped})` : `[update] database backup: ${b.file}`);
  }

  const oldManifest = installedManifest(dir);
  const point = keepForRollback(dir, oldManifest, current || 'pre-' + manifest.version);
  out(`[update] rollback point: ${point.dest} (${point.kept.length} files kept)`);

  try {
    for (const [p, buf] of blobs) {
      if (pkg.isProtected(p)) continue;
      writeFile(path.join(dir, p), buf);
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    out('[update] files written');
    if (afterCopy) await afterCopy();   // test seam: a failing post-copy step must trigger the rollback

    if (npm) {
      const lockChanged = !oldManifest || !oldManifest.files['package-lock.json'] ||
        oldManifest.files['package-lock.json'].sha256 !== manifest.files['package-lock.json'].sha256;
      if (lockChanged) {
        out('[update] npm ci --omit=dev (lockfile changed)…');
        const r = run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: dir });
        if (r.status !== 0) throw new Error('npm ci failed: ' + (r.stderr || r.stdout).trim().slice(-500));
      } else out('[update] dependencies unchanged');
    }
    if (migrate) {
      out('[update] schema migrator…');
      const r = run(process.execPath, [path.join(dir, 'db', 'migrate.js')], { cwd: dir, env: { ...process.env, ...env } });
      if (r.status !== 0) throw new Error('db/migrate.js failed: ' + (r.stderr || r.stdout).trim().slice(-500));
    }
    if (restart) { out('[update] restarting service (stop → start)…'); restartService(dir, env); }
    if (restart && probe) {
      const h = await probeHealth(url, env);
      if (!h.ok) throw new Error('service did not answer after restart: ' + h.reason);
      out('[update] service answers');
    }
    out(`[update] OK — ${manifest.version} installed`);
    return { ok: true, version: manifest.version, rollback: point.dest };
  } catch (e) {
    out(`[update] FAILED: ${e.message}`);
    out('[update] rolling back…');
    const n = restoreFrom(dir, point.dest, manifest);
    out(`[update] rolled back ${n} files to ${current || '(none)'}`);
    if (restart) { try { restartService(dir, env); } catch (e2) { out('[update] restart after rollback failed: ' + e2.message); } }
    const err = new Error(`update failed and was rolled back: ${e.message}`);
    err.rolledBack = true;
    throw err;
  }
}

async function rollback({ dir, restart = true, env = readEnv(dir), out = log } = {}) {
  const point = latestRollback(dir);
  if (!point) throw new Error('no rollback point under ' + path.join(dir, '.rollback'));
  const n = restoreFrom(dir, point, installedManifest(dir));
  out(`[rollback] restored ${n} files from ${path.basename(point)}`);
  if (restart) restartService(dir, env);
  return { ok: true, point };
}

// ---- status / support bundle -------------------------------------------------------------
async function login(url, env) {
  if (!env.DASH_USER || !env.DASH_PASS) return null;
  const res = await fetch(url + '/api/reports/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: env.DASH_USER, password: env.DASH_PASS }) });
  if (!res.ok) return null;
  // E5: the login answer no longer carries the token — it travels only in the Set-Cookie header.
  const m = /report_token=([^;]+)/.exec(String(res.headers.get('set-cookie') || ''));
  return m ? decodeURIComponent(m[1]) : null;
}
function backupDirOf(dir, env) { return env.SDP_BACKUP_DIR || path.join(dir, 'data', 'backups'); }
function diskFree(dir) {
  try { const st = fs.statfsSync(dir); return { free_bytes: Number(st.bavail) * Number(st.bsize), total_bytes: Number(st.blocks) * Number(st.bsize) }; } catch (_) { return null; }
}

/** Everything the Manager's Overview shows, as one object (no secret value, ever). */
async function statusObject({ dir, url = 'http://localhost:3456', env = readEnv(dir), probeMs = 4000 } = {}) {
  const mf = installedManifest(dir);
  const svc = (() => { try { return require('../services/serviceControl').status(env); } catch (e) { return { kind: 'unknown', state: 'unknown', error: e.message }; } })();
  const h = await probeHealth(url, env, { timeoutMs: probeMs });
  const backups = require('../services/dbRestore').listBackups(backupDirOf(dir, env));
  const o = { version: installedVersion(dir), commit: (mf && mf.commit) || null, built_at: (mf && mf.built_at) || null, dir, url,
    service: svc, http: { ok: h.ok, reason: h.ok ? null : h.reason },
    backups: { dir: backupDirOf(dir, env), count: backups.length, latest: backups[0] ? { name: backups[0].name, at: backups[0].at, bytes: backups[0].bytes } : null, encrypted_key_set: !!env.SDP_BACKUP_KEY },
    rollback_available: !!latestRollback(dir), disk: diskFree(dir), sync: null };
  if (h.ok) {
    try {
      const token = await login(url, env);
      if (token) {
        const res = await fetch(url + '/api/sync/health', { headers: { 'x-report-token': token } });
        const j = await res.json();
        const jobs = Array.isArray(j) ? j : (j.jobs || j.rows || []);
        o.sync = jobs.map((x) => ({ id: x.id || x.job || x.name, state: x.state || x.status || null, last_ok: x.last_ok || x.last_success || null, last_error: x.last_error || null }));
      }
    } catch (_) { o.sync = null; }
  }
  return o;
}

async function status({ dir, url = 'http://localhost:3456', env = readEnv(dir), out = log } = {}) {
  const o = await statusObject({ dir, url, env });
  out(`SDP Dashboard  version ${o.version || '?'}  commit ${o.commit || '?'}  built ${o.built_at || '?'}`);
  out(`install dir    ${dir}`);
  out(`service        ${o.service.kind === 'none' ? 'not installed' : `${o.service.kind} ${o.service.name || ''} — ${o.service.state}${o.service.restarts != null ? ' (restarts ' + o.service.restarts + ')' : ''}`}`);
  out(`http           ${o.http.ok ? 'answers at ' + url : 'no answer at ' + url + ' (' + o.http.reason + ')'}`);
  out(`backups        ${o.backups.count} in ${o.backups.dir}${o.backups.latest ? ', latest ' + o.backups.latest.at : ''}`);
  if (o.disk) out(`disk           ${(o.disk.free_bytes / 1073741824).toFixed(1)} GB free`);
  if (!o.http.ok) return o;
  if (!o.sync) { out('sync health    (no DASH_USER/DASH_PASS in .env — sign in to System Logs ▸ Sync health)'); return o; }
  out('sync health');
  for (const job of o.sync) out(`  ${String(job.id).padEnd(28)} ${String(job.state || '?').padEnd(7)} last ok ${job.last_ok || '—'}`);
  return o;
}

/** Restore a dump in place: pre-restore backup → stop → restore (one transaction) → start → probe. */
async function restore(file, { dir, confirm, url = 'http://localhost:3456', env = readEnv(dir), restart = true, out = log, spawnRestore, backupFn, service } = {}) {
  const R = require('../services/dbRestore');
  const S = service || require('../services/serviceControl');
  R.confirmPhrase(file);
  if (String(confirm || '').trim() !== R.confirmPhrase(file)) throw Object.assign(new Error(`confirmation refused — type exactly: ${R.confirmPhrase(file)}`), { code: 'CONFIRM' });
  const runB = backupFn || (async () => require('../services/backup').runBackup({ dir: backupDirOf(dir, env), env: { ...process.env, ...env }, keep: 30 }));
  const pre = await runB();
  if (!pre || pre.skipped) throw new Error('the pre-restore backup could not be taken (' + ((pre && pre.reason) || 'unknown') + ') — restore refused');
  out(`[restore] pre-restore backup: ${pre.file}`);
  auditLog(dir, { action: 'database_restore', risk: 1, actor: os.userInfo().username, target: path.basename(file), detail: `restore of ${path.basename(file)} (pre-restore point ${path.basename(pre.file)})` }, { out });
  let stopped = false;
  if (restart) { try { S.stop(env); stopped = true; out('[restore] service stopped'); } catch (e) { out('[restore] service stop: ' + e.message); } }
  try {
    R.restoreDatabase({ file, confirm, env: { ...process.env, ...env }, spawn: spawnRestore, out });
  } finally {
    if (stopped || restart) { try { S.start(env); out('[restore] service started'); } catch (e) { out('[restore] service start: ' + e.message); } }
  }
  if (restart) { const h = await probeHealth(url, env); out(h.ok ? '[restore] service answers' : '[restore] service did not answer: ' + h.reason); }
  return { ok: true, pre_restore: pre.file };
}

async function supportBundle({ dir, out = log, file, url = 'http://localhost:3456', env = readEnv(dir) } = {}) {
  const zip = new JSZip();
  const add = (name, content) => zip.file(name, content);
  add('manifest.json', JSON.stringify(installedManifest(dir) || { note: 'no manifest' }, null, 2));
  // .env: KEYS ONLY — never a value.
  add('env-keys.txt', Object.keys(env).sort().join('\n') + '\n');
  add('versions.json', JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, hostname: os.hostname(), at: new Date().toISOString() }, null, 2));
  for (const sub of ['logs']) {
    const d = path.join(dir, sub);
    try { for (const n of fs.readdirSync(d).slice(-20)) add(`${sub}/${n}`, fs.readFileSync(path.join(d, n))); } catch (_) { /* none */ }
  }
  try { const r = run('pm2', ['jlist']); if (r.status === 0) add('pm2.json', r.stdout); } catch (_) { /* no pm2 */ }
  try {
    const token = await login(url, env);
    if (token) { const res = await fetch(url + '/api/sync/health', { headers: { 'x-report-token': token } }); add('sync-health.json', await res.text()); }
  } catch (_) { /* offline */ }
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const target = file || path.join(dir, `support-bundle-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
  fs.writeFileSync(target, buf);
  out(`[support] ${target} (${(buf.length / 1024).toFixed(0)} KB) — no secret value inside (env keys only)`);
  return target;
}

async function main() {
  const cmd = process.argv[2];
  const dir = path.resolve(arg('--dir', DEFAULT_DIR));
  const url = arg('--url', 'http://localhost:3456');
  const json = has('--json');
  const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  switch (cmd) {
    case 'status': return json ? emit(await statusObject({ dir, url })) : status({ dir, url });
    case 'backup': {
      const env = readEnv(dir);
      const { runBackup } = require('../services/backup');
      const r = await runBackup({ dir: arg('--out', backupDirOf(dir, env)), env: { ...process.env, ...env } });
      if (json) return emit(r.skipped ? { ok: false, reason: r.reason } : { ok: true, file: r.file, encrypted: r.encrypted });
      return log(r.skipped ? `[backup] skipped: ${r.reason}` : `[backup] ${r.file}`);
    }
    case 'backups': {
      const env = readEnv(dir);
      const list = require('../services/dbRestore').listBackups(backupDirOf(dir, env));
      if (json) return emit({ dir: backupDirOf(dir, env), backups: list.map(({ file, ...b }) => ({ ...b, confirm: b.day ? 'RESTORE ' + b.day : null })) });
      if (!list.length) return log(`[backups] none in ${backupDirOf(dir, env)}`);
      for (const b of list) log(`${b.at || '?'}  ${(b.bytes / 1048576).toFixed(1).padStart(8)} MB  ${b.encrypted ? 'encrypted' : 'plain    '}  ${b.name}`);
      return;
    }
    case 'restore': {
      const file = path.resolve(process.argv[3] || '');
      return restore(file, { dir, url, confirm: arg('--confirm', ''), restart: !has('--no-restart') });
    }
    case 'service': {
      const env = readEnv(dir); const S = require('../services/serviceControl'); const op = process.argv[3];
      if (op === 'status') { const s = S.status(env); return json ? emit(s) : log(`${s.kind} ${s.name || ''} — ${s.state}`); }
      if (!['start', 'stop', 'restart'].includes(op)) { log('usage: sdp-manager service <start|stop|restart|status>'); process.exit(2); }
      const kind = S[op](env);
      auditLog(dir, { action: 'service_' + op, risk: 0, actor: os.userInfo().username, target: kind, detail: `service ${op} (${kind})` });
      if (op !== 'stop') { const h = await probeHealth(url, env, { timeoutMs: 60000 }); if (json) return emit({ ok: h.ok, kind, reason: h.reason || null }); return log(h.ok ? `[service] ${op}: answers at ${url}` : `[service] ${op} done but no answer at ${url} (${h.reason})`); }
      return json ? emit({ ok: true, kind }) : log(`[service] stopped (${kind})`);
    }
    case 'verify': {
      const { manifest, result } = await verifyPackage(path.resolve(process.argv[3] || ''), { allowUnsigned: has('--allow-unsigned'), publicKeyPem: has('--public-key') ? loadPublicKey(path.resolve(arg('--public-key'))) : undefined });
      log(`[verify] ${manifest.name} ${manifest.version} commit ${manifest.commit || '?'} — ${result.checked} files checked, signature: ${result.signature.ok ? 'OK (key ' + result.signature.key_id + ')' : result.signature.signed ? 'INVALID' : result.signature.allowed_unsigned ? 'NONE (accepted by --allow-unsigned)' : 'NONE'}`);
      if (!result.ok) { log('[verify] REFUSED: ' + result.errors.concat(result.missing.map(m => 'missing ' + m), result.mismatched.map(m => 'corrupt ' + m)).join('; ')); process.exit(2); }
      return log('[verify] OK');
    }
    case 'update': return applyPackage(path.resolve(process.argv[3] || ''), {
      dir, url, backup: !has('--no-backup'), npm: !has('--no-npm'), migrate: !has('--no-migrate'), restart: !has('--no-restart'),
      allowDowngrade: has('--allow-downgrade'), reinstall: has('--reinstall'), allowUnsigned: has('--allow-unsigned'),
      publicKeyPem: has('--public-key') ? loadPublicKey(path.resolve(arg('--public-key'))) : undefined,
    });
    case 'rollback': return rollback({ dir, restart: !has('--no-restart') });
    case 'support-bundle': return supportBundle({ dir, url, file: arg('--out', null) });
    default:
      log('usage: sdp-manager <status|backup|backups|restore <dump>|service <op>|verify <zip>|update <zip>|rollback|support-bundle> [--dir <install>] [--url <base>] [--json]');
      process.exit(cmd ? 2 : 0);
  }
}

if (require.main === module) {
  main().catch(e => { process.stderr.write('[sdp-manager] ' + e.message + '\n'); process.exit(1); });
}

module.exports = { listTree, readEnv, installedManifest, installedVersion, openPackage, verifyPackage, loadPublicKey, auditLog, DEFAULT_PUBLIC_KEY, keepForRollback, latestRollback, restoreFrom, applyPackage, rollback, status, statusObject, restore, supportBundle, probeHealth };
