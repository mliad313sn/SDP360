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
// P11 F-03 (ADR-P11-F03-migrator-changed-scripts): an APPLIED script whose bytes changed is always reported
// (`changed`). A script that WRITES DATA (INSERT / UPDATE … SET / DELETE / TRUNCATE / MERGE outside comments)
// is then NOT re-executed — a comment edit used to re-run backfills (reports/039 stage reset, reports/066
// time-zone default) over what users had changed since; it stays 'changed' in --status and logs a warning on
// every run. A DDL-only script keeps the historical contract (idempotent, re-applied once, journal updated).
// Explicit line markers override the detection: `-- migrate:rerun-on-change` / `-- migrate:run-once`.
// A new behaviour goes in a NEW file (ADR-002); never edit an applied script to change what it does.
//
// Usage:   node db/migrate.js            (reads PG_URL / DATABASE_URL, or .env)
//          node db/migrate.js --status   (lists applied / pending, applies nothing)
// API:     await migrate(pgDb, { root, log, dryRun })  → { applied: [...], skipped: [...] }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'postgres');
const RERUN_MARKER = '-- migrate:rerun-on-change';
const RUN_ONCE_MARKER = '-- migrate:run-once';
const _hasLine = (sql, marker) => sql.split(/\r?\n/).some((l) => l.trim() === marker);
/** True when the script writes data (comments stripped). Conservative: any match counts. */
function writesData(sql) {
  const code = String(sql).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  if (/\b(INSERT\s+INTO|DELETE\s+FROM|TRUNCATE|MERGE\s+INTO)\b/i.test(code)) return true;
  if (/\bCOPY\s+\S+\s+FROM\b/i.test(code)) return true;
  // UPDATE <table> … SET within the same statement (not "ON UPDATE", "FOR UPDATE", "BEFORE UPDATE OR …")
  const re = /\bUPDATE\s+/gi; let m;
  while ((m = re.exec(code))) {
    const before = code.slice(Math.max(0, m.index - 12), m.index);
    if (/\b(ON|FOR|BEFORE|AFTER|OR|OF)\s*$/i.test(before)) continue;
    const stmt = code.slice(m.index, code.indexOf(';', m.index) === -1 ? code.length : code.indexOf(';', m.index));
    if (/\bSET\b/i.test(stmt)) return true;
  }
  return false;
}
/** P11 F-20 — True when the script carries destructive DDL (comments stripped): DROP TABLE / COLUMN / SCHEMA / VIEW /
 *  MATERIALIZED VIEW / SEQUENCE / TYPE / DATABASE / DOMAIN (CASCADE drops the typed columns) / OWNED, also inside a quoted
 *  dynamic EXECUTE (P11 F-25), or a column type change (ALTER [COLUMN] x [SET DATA] TYPE). Re-running
 *  one of these on a live database loses data, so an edited applied script that contains one is never re-executed
 *  (same run-once class as a data write). DROP INDEX / TRIGGER / CONSTRAINT / FUNCTION / POLICY stay re-runnable:
 *  the script re-creates them. */
function destructiveDdl(sql) {
  const code = String(sql).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  const KEEP = new Set(['CONSTRAINT', 'DEFAULT', 'NOT', 'IDENTITY', 'EXPRESSION', 'TRIGGER']);
  for (const raw of code.split(';')) {
    // P11 F-25: quotes become separators, so a dynamic EXECUTE 'DROP TABLE x' / format('DROP …') is tokenised like
    // plain DDL ('DROP → DROP). A data string that contains "drop table" only appears in a data write (run-once anyway).
    const tk = raw.replace(/"/g, '').replace(/['(]/g, ' ').toUpperCase().split(/\s+/).filter(Boolean);
    const altTable = tk.some((t, n) => t === 'ALTER' && tk[n + 1] === 'TABLE');   // also inside a DO block
    for (let i = 0; i < tk.length; i++) {
      if (tk[i] === 'DROP') {
        const w = tk[i + 1];
        if (['TABLE', 'COLUMN', 'SCHEMA', 'VIEW', 'MATERIALIZED', 'SEQUENCE', 'TYPE', 'DATABASE', 'DOMAIN', 'OWNED'].includes(w)) return true;
        // ALTER TABLE t DROP [IF EXISTS] x — COLUMN keyword optional; DROP CONSTRAINT / DEFAULT / NOT NULL … are not destructive
        if (altTable && w && !KEEP.has(w)) return true;
      }
      if (tk[i] === 'ALTER') {   // ALTER [COLUMN] x [SET DATA] TYPE …
        let k = i + 1;
        if (tk[k] === 'COLUMN') k++;
        k++;
        if (tk[k] === 'SET' && tk[k + 1] === 'DATA') k += 2;
        if (tk[k] === 'TYPE') return true;
      }
    }
  }
  return false;
}
/** May an applied script whose bytes changed be executed again? */
function rerunOnChange(sql) {
  if (_hasLine(sql, RUN_ONCE_MARKER)) return false;
  if (_hasLine(sql, RERUN_MARKER)) return true;
  return !writesData(sql) && !destructiveDdl(sql);
}
// Apply order between areas (reports first: other areas reference sites/users).
const AREA_ORDER = ['reports', 'tracker', 'meetings', 'inspection', 'assets', 'sync'];

const DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER
)`;

// Upgrade from 1.11: that line kept ITS OWN journal under the same name, keyed by
// (module, filename) with a TEXT applied_at and no id. CREATE TABLE IF NOT EXISTS above then kept
// the 1.11 table and the first SELECT failed with `column "id" does not exist`, so every update
// from 1.11 rolled back. The 1.11 journal is converted IN PLACE into a table both migrators can
// use, inside one transaction: every 1.11 row stays (id NULL — the two namespaces never mix),
// `id` / `duration_ms` are added, the (module, filename) primary key becomes a unique index so
// 2.0 rows (module NULL) fit, and applied_at gets a default. A server rolled back to 1.11 reads
// `WHERE module = ?` and still finds exactly its own rows — it boots with nothing to re-apply.
const LEGACY_JOURNAL_SQL = [
  'ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS id TEXT',
  'ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS duration_ms INTEGER',
  `DO $$ DECLARE pk TEXT; BEGIN
     SELECT conname INTO pk FROM pg_constraint
      WHERE conrelid = to_regclass(quote_ident(current_schema()) || '.schema_migrations') AND contype = 'p';
     IF pk IS NOT NULL THEN EXECUTE format('ALTER TABLE schema_migrations DROP CONSTRAINT %I', pk); END IF;
   END $$`,
  'ALTER TABLE schema_migrations ALTER COLUMN module DROP NOT NULL',
  'ALTER TABLE schema_migrations ALTER COLUMN filename DROP NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS schema_migrations_module_filename_key ON schema_migrations (module, filename)',
  'CREATE UNIQUE INDEX IF NOT EXISTS schema_migrations_id_key ON schema_migrations (id)',
  `ALTER TABLE schema_migrations ALTER COLUMN applied_at SET DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
];

async function _journalColumns(pg) {
  const rows = await pg.prepare(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'schema_migrations'`
  ).all();
  return rows.map((r) => r.column_name);
}

/** Create the journal, or convert a 1.11 journal in place. Returns true when a 1.11 journal was converted. */
async function ensureJournal(pg, { log = () => {}, dryRun = false } = {}) {
  const cols = await _journalColumns(pg);
  if (!cols.length) { if (!dryRun) await pg.exec(DDL); return false; }
  if (cols.includes('id')) return false;
  if (!cols.includes('module') || !cols.includes('filename')) {
    throw new Error(`schema_migrations has an unknown shape (${cols.join(', ')}) — not a 2.0 nor a 1.11 journal; nothing applied`);
  }
  if (dryRun) { log('[migrate] would convert the 1.11 schema_migrations journal (dry run)'); return true; }
  await pg.runTransaction(async () => { for (const sql of LEGACY_JOURNAL_SQL) await pg.exec(sql); });
  log('[migrate] converted the 1.11 schema_migrations journal (1.11 rows kept)');
  return true;
}

async function _journalRows(pg, cols) {
  if (!(await _journalColumns(pg)).includes('id')) return [];   // dry run on a 1.11 journal: nothing 2.0 applied yet
  return pg.prepare(`SELECT ${cols} FROM schema_migrations WHERE id IS NOT NULL`).all();
}

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
  const legacy = await ensureJournal(pg, { log, dryRun });
  const done = new Map((await _journalRows(pg, 'id, checksum')).map((r) => [r.id, r.checksum]));
  const applied = [], skipped = [], changed = [], notReapplied = [];
  for (const m of listMigrations(root)) {
    if (done.has(m.id)) {
      if (done.get(m.id) === m.checksum) { skipped.push(m.id); continue; }
      changed.push(m.id);   // edited after being applied
      if (!rerunOnChange(m.sql)) {
        notReapplied.push(m.id);
        log(`[migrate] WARNING ${m.id} changed after it was applied — NOT re-executed: it writes data (put the change in a new file; "${RERUN_MARKER}" forces a re-run)`);
        continue;
      }
    }
    if (dryRun) { applied.push(m.id); continue; }
    const t0 = Date.now();
    // One transaction per file: a failing script leaves neither half its DDL nor a journal row.
    try {
      await pg.runTransaction(async () => {
        await pg.exec(m.sql);
        await pg.prepare(
          `INSERT INTO schema_migrations (id, checksum, duration_ms) VALUES (?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now(), duration_ms = EXCLUDED.duration_ms`
        ).run(m.id, m.checksum, Date.now() - t0);
      });
    } catch (e) {
      e.message = `${m.id}: ${e.message}`;   // name the script: "column x does not exist" alone is not actionable
      e.migration = m.id;
      throw e;
    }
    applied.push(m.id);
    log(`[migrate] applied ${m.id} (${Date.now() - t0} ms)`);
  }
  return { applied, skipped, changed, notReapplied, legacyJournal: legacy };
}

async function status(pg, { root = ROOT } = {}) {
  await ensureJournal(pg, { dryRun: true });
  const done = new Map((await _journalRows(pg, 'id, checksum, applied_at')).map((r) => [r.id, r]));
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

module.exports = { migrate, status, listMigrations, migrateAtBoot, ensureJournal, ROOT, AREA_ORDER, RERUN_MARKER, RUN_ONCE_MARKER, writesData, destructiveDdl, rerunOnChange };

if (require.main === module) {
  (async () => {
    if (!process.env.PG_URL && !process.env.DATABASE_URL) { try { require('dotenv').config({ quiet: true, path: path.join(__dirname, '..', '.env') }); } catch (_) {} }
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('Set PG_URL or DATABASE_URL'); process.exit(2); }
    const { makePgDb } = require('../services/pgDb');
    const pg = makePgDb(url); await pg.connect();
    try {
      if (process.argv.includes('--status')) {
        for (const r of await status(pg)) console.log(`${r.state.padEnd(8)} ${r.id}${r.applied_at ? '  ' + new Date(r.applied_at).toISOString() : ''}`);
      } else {
        const r = await migrate(pg, { log: console.log, dryRun: process.argv.includes('--dry-run') });
        console.log(`[migrate] applied=${r.applied.length} already=${r.skipped.length} changed=${r.changed.length} not_reapplied=${r.notReapplied.length}`);
      }
    } finally { await pg.close(); }
  })().catch((e) => { console.error('[migrate] FAILED:', e.message); process.exit(1); });
}
