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

function keepForRollback(dir, oldManifest, label) {
  const dest = path.join(dir, '.rollback', label);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const kept = [];
  const files = oldManifest ? Object.keys(oldManifest.files || {}) : [];
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
  const name = env.PM2_NAME || 'endeavour-dashboard';
  // stop -> wait -> start, never `pm2 reload` (EADDRINUSE crash-loop, see CLAUDE.md).
  const stop = run('pm2', ['stop', name], { cwd: dir });
  if (stop.status !== 0) throw new Error('pm2 stop failed: ' + (stop.stderr || stop.stdout).trim());
  const t = Date.now(); while (Date.now() - t < 5000) { /* wait for the port */ }
  const start = run('pm2', ['start', name], { cwd: dir });
  if (start.status !== 0) throw new Error('pm2 start failed: ' + (start.stderr || start.stdout).trim());
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
    if (restart) { out('[update] restarting service (pm2 stop → start)…'); restartService(dir, env); }
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
  return (await res.json()).token || null;
}
async function status({ dir, url = 'http://localhost:3456', env = readEnv(dir), out = log } = {}) {
  const mf = installedManifest(dir);
  out(`SDP Dashboard  version ${installedVersion(dir) || '?'}  commit ${(mf && mf.commit) || '?'}  built ${(mf && mf.built_at) || '?'}`);
  out(`install dir    ${dir}`);
  const pm2 = (() => { try { return run('pm2', ['jlist']); } catch (_) { return null; } })();
  if (pm2 && pm2.status === 0) {
    try {
      const procs = JSON.parse(pm2.stdout);
      const p = procs.find(x => x.name === (env.PM2_NAME || 'endeavour-dashboard'));
      out(`service        ${p ? p.pm2_env.status + ' (restarts ' + p.pm2_env.restart_time + ')' : 'not registered in pm2'}`);
    } catch (_) { out('service        pm2 answered but its output was unreadable'); }
  } else out('service        pm2 not available on this machine');
  const h = await probeHealth(url, env, { timeoutMs: 4000 });
  out(`http           ${h.ok ? 'answers at ' + url : 'no answer at ' + url + ' (' + h.reason + ')'}`);
  if (!h.ok) return;
  const token = await login(url, env);
  if (!token) { out('sync health    (no DASH_USER/DASH_PASS in .env — sign in to System Logs ▸ Sync health)'); return; }
  try {
    const res = await fetch(url + '/api/sync/health', { headers: { 'x-report-token': token } });
    const j = await res.json();
    const jobs = Array.isArray(j) ? j : (j.jobs || j.rows || []);
    out('sync health');
    for (const job of jobs) out(`  ${String(job.id || job.job || job.name).padEnd(28)} ${String(job.state || job.status || '?').padEnd(7)} last ok ${job.last_ok || job.last_success || '—'}`);
  } catch (e) { out('sync health    unreadable: ' + e.message); }
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
  switch (cmd) {
    case 'status': return status({ dir, url });
    case 'backup': {
      const env = readEnv(dir);
      const { runBackup } = require('../services/backup');
      const r = await runBackup({ dir: arg('--out', env.SDP_BACKUP_DIR || path.join(dir, 'data', 'backups')), env: { ...process.env, ...env } });
      return log(r.skipped ? `[backup] skipped: ${r.reason}` : `[backup] ${r.file}`);
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
      log('usage: sdp-manager <status|backup|verify <zip>|update <zip>|rollback|support-bundle> [--dir <install>] [--url <base>]');
      process.exit(cmd ? 2 : 0);
  }
}

if (require.main === module) {
  main().catch(e => { process.stderr.write('[sdp-manager] ' + e.message + '\n'); process.exit(1); });
}

module.exports = { readEnv, installedManifest, installedVersion, openPackage, verifyPackage, loadPublicKey, auditLog, DEFAULT_PUBLIC_KEY, keepForRollback, latestRollback, restoreFrom, applyPackage, rollback, status, supportBundle, probeHealth };
