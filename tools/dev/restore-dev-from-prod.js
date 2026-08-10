'use strict';
// ── tools/dev/restore-dev-from-prod.js ───────────────────────────────────────
// One-shot: rebuild the DEV install from a prod export (dump + blobs).
//
//   node tools/dev/restore-dev-from-prod.js
//   node tools/dev/restore-dev-from-prod.js --src "C:\Users\Admin\Desktop\SDP"
//
// It:
//   1. reads PG_URL from .env (target DB + user)
//   2. HARD-GUARDS the DB name (refuses fmp_*/postgres/template* — never touch
//      4MyPeople's databases)
//   3. extracts sdp_dashboard_full.zip -> the SQL dump
//   4. wipes the target with `DROP OWNED BY CURRENT_USER CASCADE` (owner-scoped,
//      no superuser needed — the prod dump has no DROP, so a clean slate is
//      required or every CREATE/COPY collides)
//   5. restores the dump with psql (ON_ERROR_STOP=1)
//   6. extracts data-blobs.zip -> <repo>/data/blobs (inspection photos/signatures,
//      which are NOT in the PG dump)
//   7. verifies row counts
//
// DESTRUCTIVE to the dev database only. Idempotent — safe to re-run. The password
// is passed to psql via PGPASSWORD env, never printed, never on a command line.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

// Locate the repo whether this runs from inside it (tools/dev/) OR from a
// standalone copy dropped next to the export (e.g. C:\SDP). --repo overrides.
function resolveRepo() {
  const cand = [path.join(__dirname, '../..'), getArg('--repo', null), 'C:\\Users\\Admin\\Documents\\SDP-Dashboard'];
  for (const c of cand) if (c && fs.existsSync(path.join(c, 'server.js'))) return c;
  console.error('✖ SDP-Dashboard repo not found — pass --repo <path-to-repo>.');
  process.exit(1);
}
const REPO = resolveRepo();

// Zero-dependency .env parse (so this can run standalone with plain `node`, no node_modules).
function loadDotEnv(p) {
  const out = {};
  try {
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(line => {
      if (line.trim().startsWith('#')) return;
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (_) {}
  return out;
}
const ENV = loadDotEnv(path.join(REPO, '.env'));

// Source of the export zips: default to this script's own folder if the zips are
// there (standalone copy in C:\SDP), else Desktop\SDP.
const defaultSrc = fs.existsSync(path.join(__dirname, 'sdp_dashboard_full.zip'))
  ? __dirname
  : path.join(process.env.USERPROFILE || 'C:\\Users\\Admin', 'Desktop', 'SDP');
const SRC = getArg('--src', defaultSrc);
const DUMP_ZIP = getArg('--dump', path.join(SRC, 'sdp_dashboard_full.zip'));
const BLOBS_ZIP = getArg('--blobs', path.join(SRC, 'data-blobs.zip'));

// ── PG target + guard ─────────────────────────────────────────────────────────
const url = process.env.PG_URL || process.env.DATABASE_URL || ENV.PG_URL || ENV.DATABASE_URL;
if (!url) { console.error('✖ PG_URL not set in .env'); process.exit(1); }
const U = new URL(url);
const DB = U.pathname.slice(1);
const USER = decodeURIComponent(U.username);
if (/^(fmp|postgres$|template)/i.test(DB)) {
  console.error(`✖ REFUSING: target DB "${DB}" looks like a 4MyPeople / system database. Aborting.`);
  process.exit(1);
}
console.log(`Target: ${DB} / ${USER} @ ${U.hostname}:${U.port || 5432}`);

// ── locate psql ───────────────────────────────────────────────────────────────
function findBin(name) {
  if (process.env.PG_BIN && fs.existsSync(path.join(process.env.PG_BIN, name))) return path.join(process.env.PG_BIN, name);
  for (const root of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL']) {
    try {
      for (const v of fs.readdirSync(root).sort((a, b) => parseFloat(b) - parseFloat(a))) {
        const p = path.join(root, v, 'bin', name);
        if (fs.existsSync(p)) return p;
      }
    } catch (_) {}
  }
  return null;
}
const PSQL = findBin('psql.exe');
if (!PSQL) { console.error('✖ psql.exe not found (set PG_BIN=<...\\bin>).'); process.exit(1); }

// ── helpers ────────────────────────────────────────────────────────────────────
const PGENV = { ...process.env, PGPASSWORD: decodeURIComponent(U.password || '') };
const psqlArgs = ['-h', U.hostname, '-p', String(U.port || 5432), '-U', USER, '-d', DB, '-v', 'ON_ERROR_STOP=1', '--no-password'];
function psql(extra, opts = {}) {
  return spawnSync(PSQL, [...psqlArgs, ...extra], { env: PGENV, encoding: 'utf8', ...opts });
}
function psqlC(sql) { return psql(['-c', sql]); }
function expand(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const r = spawnSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Expand-Archive failed for ${zip}: ${(r.stderr || '').trim()}`);
}
function must(r, label) {
  if (r.status !== 0) { console.error(`✖ ${label} failed:\n${(r.stderr || r.stdout || '').trim()}`); process.exit(1); }
}

(async () => {
  // sanity: files exist
  for (const f of [DUMP_ZIP, BLOBS_ZIP]) if (!fs.existsSync(f)) { console.error(`✖ not found: ${f}`); process.exit(1); }

  const TMP = path.join(REPO, 'tools', 'dev', '_restore_tmp');
  fs.rmSync(TMP, { recursive: true, force: true });

  // 1) extract dump
  console.log(`\n[1/5] Extracting dump…`);
  expand(DUMP_ZIP, TMP);
  const sql = fs.readdirSync(TMP).map(f => path.join(TMP, f)).find(f => f.endsWith('.sql'));
  if (!sql) { console.error('✖ no .sql inside the dump zip'); process.exit(1); }
  console.log(`      ${path.basename(sql)} (${(fs.statSync(sql).size / 1048576).toFixed(1)} MB)`);

  // connectivity check
  const ping = psqlC('SELECT 1');
  must(ping, 'connect');

  // 2) wipe (owner-scoped)
  console.log(`[2/5] Wiping ${DB} (DROP OWNED BY ${USER} CASCADE)…`);
  // terminate our own idle sessions first so DROP doesn't wait on a lock
   psqlC(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB}' AND usename='${USER}' AND pid<>pg_backend_pid()`);
  must( psqlC('DROP OWNED BY CURRENT_USER CASCADE'), 'wipe');

  // 3) restore
  console.log(`[3/5] Restoring dump (this is the long step)…`);
  must(psql(['-f', sql], { maxBuffer: 1 << 28 }), 'restore');

  // 4) blobs
  console.log(`[4/5] Restoring inspection blobs…`);
  const dataDir = path.join(REPO, 'data');
  fs.rmSync(path.join(dataDir, 'blobs'), { recursive: true, force: true });
  expand(BLOBS_ZIP, dataDir);   // zip root is blobs/ -> data/blobs/
  const blobRoot = path.join(dataDir, 'blobs');
  const blobCount = fs.existsSync(blobRoot)
    ? spawnSync('powershell', ['-NoProfile', '-Command', `(Get-ChildItem -Recurse -File '${blobRoot}').Count`], { encoding: 'utf8' }).stdout.trim()
    : '0';
  console.log(`      data/blobs: ${blobCount} files`);

  // 5) verify
  console.log(`[5/5] Verifying…`);
  const q = (s) => (psqlC(`SELECT ${s}`).stdout || '').split('\n')[2]?.trim();
  const tables = q("count(*) FROM information_schema.tables WHERE table_schema='public'");
  const reqs   = q('count(*) FROM request_records');
  const users  = q('count(*) FROM users');
  const insp   = q('count(*) FROM insp_inspections');
  console.log(`      public tables: ${tables} | request_records: ${reqs} | users: ${users} | inspections: ${insp}`);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n✅ Dev restore complete. Start the app:  pm2 restart sdp-dashboard-dev  (or  node server.js)`);
  console.log(`   Reminder: ASSETS_BACKEND=postgres in .env, and leave Zoho tokens empty in dev unless you need live sync.`);
})().catch(e => { console.error('✖ ' + e.message); process.exit(1); });
