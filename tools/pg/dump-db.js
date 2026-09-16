'use strict';
// pg_dump wrapper for the dashboard's PostgreSQL database. Used by
// _sdp_admin.cmd option 5 (Backup now) so restore points cover PG data too —
// the 4MyPeople restore points dump fmp_v2 ONLY, sdp_dashboard is ours.
//
//   node tools/pg/dump-db.js <output.sql>
//
// Reads PG_URL (or DATABASE_URL) from the environment or the app root .env.
// Locates pg_dump.exe from the standard PostgreSQL install (or PG_DUMP env
// override). Exit 0 on success. The password is passed via PGPASSWORD env to
// the child only — never printed, never on a command line.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function loadDotEnv() {
  const p = path.join(__dirname, '../../.env');
  const out = {};
  try {
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (_) {}
  return out;
}

function findPgDump() {
  if (process.env.PG_DUMP && fs.existsSync(process.env.PG_DUMP)) return process.env.PG_DUMP;
  const roots = ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL'];
  for (const root of roots) {
    try {
      // newest version first
      const vers = fs.readdirSync(root).sort((a, b) => parseFloat(b) - parseFloat(a));
      for (const v of vers) {
        const p = path.join(root, v, 'bin', 'pg_dump.exe');
        if (fs.existsSync(p)) return p;
      }
    } catch (_) {}
  }
  return null;
}

const outFile = process.argv[2];
if (!outFile) { console.error('Usage: node tools/pg/dump-db.js <output.sql>'); process.exit(2); }

const dotenv = loadDotEnv();
const url = process.env.PG_URL || process.env.DATABASE_URL || dotenv.PG_URL || dotenv.DATABASE_URL;
if (!url) { console.log('[pg-dump] no PG_URL configured — nothing to dump (sqlite-only install).'); process.exit(0); }

let u;
try { u = new URL(url); }
catch (e) { console.error('[pg-dump] invalid PG_URL: ' + e.message); process.exit(1); }

const pgDump = findPgDump();
if (!pgDump) { console.error('[pg-dump] pg_dump.exe not found (set PG_DUMP=<full path> to override).'); process.exit(1); }

const db = (u.pathname || '/sdp_dashboard').slice(1);
const args = ['-h', u.hostname || 'localhost', '-p', u.port || '5432',
              '-U', decodeURIComponent(u.username || 'sdp_app'),
              '-d', db, '--no-password', '-f', outFile];
const r = spawnSync(pgDump, args, {
  env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password || '') },
  encoding: 'utf8', timeout: 300000,
});
if (r.status === 0 && fs.existsSync(outFile)) {
  const mb = (fs.statSync(outFile).size / 1048576).toFixed(2);
  console.log(`[pg-dump] OK — ${db} -> ${outFile} (${mb} MB)`);
  process.exit(0);
}
// pg_dump writes plain SQL top-to-bottom; a killed/failed run (timeout, OOM,
// disk full, power loss) can leave a truncated-but-non-empty file that a
// naive "does the file exist" check would mistake for a real dump. Delete it
// so a restore point never carries a dump that only LOOKS complete.
try { fs.unlinkSync(outFile); } catch (_) {}
console.error('[pg-dump] FAILED — ' + ((r.stderr || r.error && r.error.message || 'unknown error').toString().trim()));
process.exit(1);
