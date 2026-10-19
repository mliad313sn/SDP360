'use strict';
// Step 2 — schema migrator for PostgreSQL.
//
// WHY: until now each *-db.js applied its own SQL files at boot and the newer scripts
// (tracker/002, reports/015, sync/001) were executed by nobody. This module applies EVERY
// db/postgres/**/*.sql in a stable order and records each file in schema_migrations, so
// the installer, the CI and the server share one source of truth and a fresh database
// reaches the current schema in one call. Scripts are idempotent (IF NOT EXISTS) — on an
// existing production database the first run re-applies them harmlessly and records them.
//
// Usage:   node db/migrate.js            (reads PG_URL / DATABASE_URL, or .env)
//          node db/migrate.js --status   (lists applied / pending, applies nothing)
// API:     await migrate(pgDb, { root, log, dryRun })  → { applied: [...], skipped: [...] }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'postgres');
// Apply order between areas (reports first: other areas reference sites/users).
const AREA_ORDER = ['reports', 'tracker', 'meetings', 'inspection', 'assets', 'sync'];

const DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER
)`;

function listMigrations(root = ROOT) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const areas = fs.readdirSync(root).filter((d) => fs.statSync(path.join(root, d)).isDirectory());
  areas.sort((a, b) => (idx(a) - idx(b)) || a.localeCompare(b));
  for (const area of areas) {
    const files = fs.readdirSync(path.join(root, area)).filter((f) => /\.sql$/i.test(f)).sort();
    for (const f of files) {
      const full = path.join(root, area, f);
      const sql = fs.readFileSync(full, 'utf8');
      out.push({ id: `${area}/${f}`, area, file: f, path: full, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') });
    }
  }
  return out;
  function idx(a) { const i = AREA_ORDER.indexOf(a); return i === -1 ? AREA_ORDER.length : i; }
}

/**
 * @param {object} pg  services/pgDb instance (connected) — needs prepare().get/all/run + exec
 */
async function migrate(pg, { root = ROOT, log = () => {}, dryRun = false } = {}) {
  await pg.exec(DDL);
  const done = new Map((await pg.prepare('SELECT id, checksum FROM schema_migrations').all()).map((r) => [r.id, r.checksum]));
  const applied = [], skipped = [], changed = [];
  for (const m of listMigrations(root)) {
    if (done.has(m.id)) {
      if (done.get(m.id) !== m.checksum) changed.push(m.id); // edited after being applied — reported, re-applied (scripts are idempotent)
      else { skipped.push(m.id); continue; }
    }
    if (dryRun) { applied.push(m.id); continue; }
    const t0 = Date.now();
    await pg.exec(m.sql);
    await pg.prepare(
      `INSERT INTO schema_migrations (id, checksum, duration_ms) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now(), duration_ms = EXCLUDED.duration_ms`
    ).run(m.id, m.checksum, Date.now() - t0);
    applied.push(m.id);
    log(`[migrate] applied ${m.id} (${Date.now() - t0} ms)`);
  }
  return { applied, skipped, changed };
}

async function status(pg, { root = ROOT } = {}) {
  await pg.exec(DDL);
  const done = new Map((await pg.prepare('SELECT id, checksum, applied_at FROM schema_migrations').all()).map((r) => [r.id, r]));
  return listMigrations(root).map((m) => ({ id: m.id, state: !done.has(m.id) ? 'pending' : done.get(m.id).checksum === m.checksum ? 'applied' : 'changed', applied_at: done.has(m.id) ? done.get(m.id).applied_at : null }));
}

// Boot helper: apply migrations when at least one module runs on PostgreSQL. Best-effort
// for a transient connection failure (the module inits already applied their own DDL).
async function migrateAtBoot({ env = process.env, log = console.log } = {}) {
  const anyPg = ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND'].some((k) => String(env[k] || '').toLowerCase() === 'postgres');
  const url = env.PG_URL || env.DATABASE_URL;
  if (!anyPg || !url) return { skipped: 'no postgres backend' };
  const { makePgDb } = require('../services/pgDb');
  const pg = makePgDb(url);
  await pg.connect();
  try { return await migrate(pg, { log }); } finally { await pg.close(); }
}

module.exports = { migrate, status, listMigrations, migrateAtBoot, ROOT, AREA_ORDER };

if (require.main === module) {
  (async () => {
    if (!process.env.PG_URL && !process.env.DATABASE_URL) { try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (_) {} }
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('Set PG_URL or DATABASE_URL'); process.exit(2); }
    const { makePgDb } = require('../services/pgDb');
    const pg = makePgDb(url); await pg.connect();
    try {
      if (process.argv.includes('--status')) {
        for (const r of await status(pg)) console.log(`${r.state.padEnd(8)} ${r.id}${r.applied_at ? '  ' + new Date(r.applied_at).toISOString() : ''}`);
      } else {
        const r = await migrate(pg, { log: console.log, dryRun: process.argv.includes('--dry-run') });
        console.log(`[migrate] applied=${r.applied.length} already=${r.skipped.length} changed=${r.changed.length}`);
      }
    } finally { await pg.close(); }
  })().catch((e) => { console.error('[migrate] FAILED:', e.message); process.exit(1); });
}
