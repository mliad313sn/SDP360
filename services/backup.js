'use strict';
// Step 2 — nightly PostgreSQL backup as a registry job (visible in /api/sync/health, alerted
// on failure like every other job). Spawns tools/pg/dump-db.js (pg_dump wrapper, password
// via PGPASSWORD only) and applies a simple retention. Pure core (`planBackup`, `prune`)
// is unit-tested; the spawn is injectable.

const fs = require('fs');
const path = require('path');

function planBackup({ dir, now = new Date(), prefix = 'sdp_dashboard' }) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return { file: path.join(dir, `${prefix}_${stamp}.sql`), stamp };
}

// Keep the newest `keep` dumps matching the prefix; return the deleted names.
function prune(dir, { keep = 14, prefix = 'sdp_dashboard', fsx = fs } = {}) {
  let names = [];
  try { names = fsx.readdirSync(dir).filter((n) => n.startsWith(prefix + '_') && n.endsWith('.sql')); } catch (_) { return []; }
  names.sort();
  const doomed = names.slice(0, Math.max(0, names.length - keep));
  for (const n of doomed) { try { fsx.unlinkSync(path.join(dir, n)); } catch (_) { /* best effort */ } }
  return doomed;
}

/**
 * @param {object} o
 * @param {string} o.dir      backup directory (created if missing)
 * @param {number} [o.keep]   retention count
 * @param {function} [o.spawn]  (cmd, args) => { status, stdout, stderr } — defaults to child_process.spawnSync(node, [dump-db.js, file])
 */
async function runBackup({ dir, keep = 14, spawn, env = process.env, fsx = fs } = {}) {
  if (!env.PG_URL && !env.DATABASE_URL) return { skipped: true, reason: 'no PG_URL' };
  fsx.mkdirSync(dir, { recursive: true });
  const { file } = planBackup({ dir });
  const run = spawn || ((cmd, args) => require('child_process').spawnSync(cmd, args, { env, encoding: 'utf8', timeout: 30 * 60 * 1000 }));
  const r = run(process.execPath, [path.join(__dirname, '..', 'tools', 'pg', 'dump-db.js'), file]);
  if (!r || r.status !== 0) {
    const e = new Error(`pg_dump failed (exit ${r && r.status}): ${String((r && (r.stderr || r.stdout)) || '').trim().slice(0, 300)}`);
    e.transient = true; // a locked file / busy server is worth one retry
    throw e;
  }
  let bytes = 0; try { bytes = fsx.statSync(file).size; } catch (_) {}
  if (bytes < 1024) { const e = new Error(`backup file is suspiciously small (${bytes} bytes): ${file}`); e.transient = false; throw e; }
  const pruned = prune(dir, { keep, fsx });
  return { file, bytes, pruned, rows: 1 };
}

module.exports = { runBackup, planBackup, prune };
