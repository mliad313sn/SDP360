'use strict';
// Step 2 (SDP-DASH-2.0) — PostgreSQL schema migrator. ONE way to apply the schema, used by the
// server at boot (each initPg* calls migrateModule), by the installer and by CI:
//
//   node db/migrate.js --status     # what is applied / pending / changed, per module
//   node db/migrate.js --apply      # apply everything pending (reads PG_URL from env or .env)
//
// Rules (docs/adr/0002-schema-migrations.md):
//   · scripts live in db/postgres/<module>/NNN_name.sql and run in file-name order;
//   · every script is IDEMPOTENT (CREATE … IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, guarded DO
//     blocks) — they were all re-run at every boot before this migrator existed;
//   · journal schema_migrations(module, filename, checksum, applied_at); a new file is applied
//     and recorded; an unchanged file is skipped; an EDITED file is re-applied (idempotent) and
//     its checksum updated — logged as 'reapplied' so an edit is never silent;
//   · each file runs in its own transaction under a PostgreSQL advisory lock, so a CLI run and
//     a booting server never apply the same file twice at once;
//   · data seeds (lookups, catalogs, backfills) stay in the modules: they are data, not schema.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'postgres');
const MODULES = ['reports', 'tracker', 'meetings', 'inspection', 'assets'];
const LOCK_KEY = 72616701;   // arbitrary constant: pg_advisory_xact_lock(LOCK_KEY)

const JOURNAL_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  module     TEXT NOT NULL,
  filename   TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (module, filename)
)`;

/** Line-ending-insensitive checksum (a Windows checkout and the Linux CI must agree). */
function checksum(sql) {
  return crypto.createHash('sha256').update(String(sql).replace(/\r\n/g, '\n')).digest('hex');
}

/** The scripts of a module, in apply order: [{ filename, sql, checksum }]. */
function listScripts(module, root = ROOT) {
  const dir = path.join(root, module);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /^\d{3}_[\w-]+\.sql$/.test(f)).sort()
    .map(filename => { const sql = fs.readFileSync(path.join(dir, filename), 'utf8'); return { filename, sql, checksum: checksum(sql) }; });
}

/** Pure: what would happen. journal = rows of schema_migrations for this module. */
function plan(scripts, journal) {
  const seen = new Map((journal || []).map(r => [r.filename, r.checksum]));
  return scripts.map(s => ({ filename: s.filename,
    action: !seen.has(s.filename) ? 'apply' : (seen.get(s.filename) === s.checksum ? 'skip' : 'reapply') }));
}

async function _journal(pg, module) {
  await pg.exec(JOURNAL_DDL);
  return pg.prepare('SELECT filename, checksum, applied_at FROM schema_migrations WHERE module = ? ORDER BY filename').all(module);
}

/**
 * Apply the pending scripts of one module on an open pgDb handle (services/pgDb.makePgDb).
 * @returns {{module, applied:string[], reapplied:string[], skipped:number}}
 */
async function migrateModule(pg, module, { root = ROOT, log = console.log } = {}) {
  const scripts = listScripts(module, root);
  const out = { module, applied: [], reapplied: [], skipped: 0 };
  await pg.exec(JOURNAL_DDL);
  for (const s of scripts) {
    await pg.runTransaction(async () => {
      await pg.prepare(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`).get();
      const row = await pg.prepare('SELECT checksum FROM schema_migrations WHERE module = ? AND filename = ?').get(module, s.filename);
      if (row && row.checksum === s.checksum) { out.skipped++; return; }
      await pg.exec(s.sql);
      const now = new Date().toISOString();
      if (row) {
        await pg.prepare('UPDATE schema_migrations SET checksum = ?, applied_at = ? WHERE module = ? AND filename = ?').run(s.checksum, now, module, s.filename);
        out.reapplied.push(s.filename);
      } else {
        await pg.prepare('INSERT INTO schema_migrations (module, filename, checksum, applied_at) VALUES (?, ?, ?, ?)').run(module, s.filename, s.checksum, now);
        out.applied.push(s.filename);
      }
    });
  }
  if (out.applied.length || out.reapplied.length) {
    log(`[migrate] ${module}: applied ${out.applied.join(', ') || '—'}; reapplied ${out.reapplied.join(', ') || '—'}`);
  }
  return out;
}

async function status(pg, { root = ROOT } = {}) {
  const res = [];
  for (const m of MODULES) res.push({ module: m, plan: plan(listScripts(m, root), await _journal(pg, m)) });
  return res;
}

async function migrateAll(pg, opts) {
  const res = [];
  for (const m of MODULES) res.push(await migrateModule(pg, m, opts));
  return res;
}

module.exports = { migrateModule, migrateAll, status, plan, listScripts, checksum, MODULES, JOURNAL_DDL };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  (async () => {
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('PG_URL / DATABASE_URL is not set'); process.exit(2); }
    const pg = require('../services/pgDb').makePgDb(url);
    await pg.connect();
    try {
      if (process.argv.includes('--apply')) {
        const r = await migrateAll(pg);
        r.forEach(x => console.log(`${x.module.padEnd(11)} applied=${x.applied.length} reapplied=${x.reapplied.length} unchanged=${x.skipped}`));
      } else {
        for (const m of await status(pg)) {
          const n = (a) => m.plan.filter(p => p.action === a).length;
          console.log(`${m.module.padEnd(11)} ${m.plan.length} script(s): pending=${n('apply')} changed=${n('reapply')} applied=${n('skip')}`);
          m.plan.filter(p => p.action !== 'skip').forEach(p => console.log(`  ${p.action.padEnd(7)} ${p.filename}`));
        }
        console.log('(status only — run with --apply to apply)');
      }
    } finally { await pg.close(); }
  })().catch(e => { console.error('[migrate] failed:', e.message); process.exit(1); });
}
