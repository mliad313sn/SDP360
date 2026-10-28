'use strict';
// E11 — restore drill: prove that the latest backup restores and matches the live database.
//
//   node tools/pg/restore-drill.js [--dump <file>] [--backup-first] [--dir <backupDir>]
//                                  [--report-dir <dir>] [--keep-target] [--no-log]
//
//   1. picks the newest dump in SDP_BACKUP_DIR (or --dump), opens it (gunzip + AES-256-GCM with
//      SDP_BACKUP_KEY when the file is .enc) and checks pg_dump's trailer;
//   2. counts the rows of the 10 main tables on the LIVE database (PG_URL) — BEFORE the restore,
//      so the live counts and the dump are as close in time as possible (--backup-first takes a
//      fresh dump first, which is what the monthly job does: the whole chain is exercised);
//   3. restores into a DISPOSABLE target: a throwaway DATABASE when PG_ADMIN_URL can create one,
//      otherwise a throwaway SCHEMA of the live database (recipe G-02, CLAUDE.md / tests/pg-helpers.js
//      — pg_dump qualifies objects with `public.`, so the SQL is rewritten to the schema);
//   4. counts the same tables on the copy, drops the target, writes docs/ops/restore-drills/<date>.md
//      and a `restore_drill` system_log row (category 'ops');
//   5. exits 1 when any compared table differs by one row or more.
//
// Passwords never appear on a command line (PGPASSWORD / PGOPTIONS via tools/pg/pg-bin.js) and the
// plain SQL is piped to psql's stdin — it never touches the disk during the drill.
// Pure parts (comparison, schema rewrite, report) live in services/restoreDrill.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
if (require.main === module) require('dotenv').config({ path: path.join(ROOT, '.env') });

const backup = require('../../services/backup');
const drill = require('../../services/restoreDrill');
const { findPgBin, pgArgsFromUrl } = require('./pg-bin');

function defaultBackupDir(env = process.env) {
  return env.SDP_BACKUP_DIR || path.join(env.SDP_DATA_DIR || path.join(ROOT, 'data'), 'backups');
}
function defaultReportDir(env = process.env) {
  return env.SDP_DRILL_REPORT_DIR || path.join(ROOT, 'docs', 'ops', 'restore-drills');
}
function rnd() { return Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '') || 'x'; }

/** Row counts of `tables` through a connected pg Client; a missing table → null. */
async function countTables(client, tables, { schema = 'public' } = {}) {
  const out = {};
  for (const t of tables) {
    const reg = await client.query('SELECT to_regclass($1) AS r', [`${schema}.${t}`]);
    if (!reg.rows[0] || reg.rows[0].r == null) { out[t] = null; continue; }
    const r = await client.query(`SELECT count(*)::bigint AS n FROM ${schema}.${t}`);
    out[t] = Number(r.rows[0].n);
  }
  return out;
}

/** Create the disposable target. Returns { kind:'database'|'schema', name, url, schema, drop() }. */
async function provisionTarget({ env, liveUrl, Client }) {
  const admin = env.PG_ADMIN_URL;
  if (admin) {
    const c = new Client({ connectionString: admin });
    try {
      await c.connect();
      const name = 'sdp_drill_' + rnd();
      await c.query(`CREATE DATABASE ${name}`);
      await c.end();
      // eslint-disable-next-line security/detect-unsafe-regex -- reviewed (consolidation 2026-10-28): anchored at $, [^/?]* and \?.* are disjoint, linear
      const url = admin.replace(/\/[^/?]*(\?.*)?$/, '/' + name);
      return {
        kind: 'database', name, url, schema: 'public',
        async drop() { const a = new Client({ connectionString: admin }); await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await a.end(); },
      };
    } catch (e) { try { await c.end(); } catch (_) {} /* fall through to the schema path */ }
  }
  const schema = 'sdp_drill_' + rnd();
  const c = new Client({ connectionString: liveUrl });
  await c.connect();
  await c.query(`CREATE SCHEMA ${schema}`);
  await c.end();
  return {
    kind: 'schema', name: schema, url: liveUrl, schema,
    async drop() { const a = new Client({ connectionString: liveUrl }); await a.connect(); await a.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await a.end(); },
  };
}

/** psql < sql, password via env only. Returns { status, stderr }. */
function restoreWithPsql(targetUrl, sql, { env, spawn = spawnSync } = {}) {
  const psql = findPgBin('psql', 'PG_PSQL', env);
  const { args, env: childEnv } = pgArgsFromUrl(targetUrl, { env, defaultUser: 'postgres' });
  const r = spawn(psql, [...args, '--no-password', '-X', '-q', '-v', 'ON_ERROR_STOP=0', '-f', '-'],
    { env: childEnv, input: sql, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 60 * 60 * 1000 });
  if (r.error) throw new Error(`psql could not be started (${psql}): ${r.error.message}`);
  return { status: r.status, stderr: r.stderr || '' };
}

/** Direct insert used when no in-process logEvent is available (CLI run). */
async function logDirect(liveUrl, details, Client) {
  const c = new Client({ connectionString: liveUrl });
  await c.connect();
  try {
    await c.query(`INSERT INTO system_log (ts,category,action,actor,actor_id,target,details,ip,risk) VALUES ($1,'ops','restore_drill',$2,NULL,$3,$4,NULL,$5)`,
      [new Date().toISOString(), 'restore-drill', details.date, JSON.stringify(details), details.ok ? 0 : 1]);
  } finally { await c.end(); }
}

/**
 * @param {object} o
 * @param {string}  [o.dir]          backup directory
 * @param {string}  [o.dumpFile]     explicit dump (default: newest in dir)
 * @param {boolean} [o.backupFirst]  take a fresh dump before the drill
 * @param {string}  [o.offsitePath]  forwarded to runBackup when backupFirst
 * @param {string}  [o.reportDir]
 * @param {function}[o.logEvent]     rdb.logEvent (in-process job); default = direct insert
 * @param {boolean} [o.noLog]
 * @param {object}  [o.env]
 * @returns {Promise<{ok:boolean, comparison, reportFile, dumpFile, target}>}
 */
async function run(o = {}) {
  const env = o.env || process.env;
  const log = o.log || ((m) => console.log(m));
  const Client = o.Client || require('pg').Client;
  const liveUrl = env.PG_URL || env.DATABASE_URL;
  if (!liveUrl) throw new Error('restore-drill: PG_URL is not set (sqlite-only install — nothing to drill)');
  const dir = o.dir || defaultBackupDir(env);
  const now = o.now || new Date();
  const date = now.toISOString().slice(0, 10);
  const notes = [];

  if (o.backupFirst) {
    const b = await backup.runBackup({ dir, env, offsitePath: o.offsitePath || '', log: (m) => { notes.push(m.replace(/^\[backup\]\s*/, '')); log(m); } });
    if (b.skipped) throw new Error('restore-drill: backup skipped — ' + b.reason);
    log(`[restore-drill] fresh dump ${b.file} (${drill.fmtBytes(b.bytes)} plain, ${b.encrypted ? 'encrypted' : 'PLAINTEXT gzip'})`);
  }
  const dumpFile = o.dumpFile || backup.latestDump(dir);
  if (!dumpFile) throw new Error(`restore-drill: no dump found in ${dir}`);
  const key = backup.deriveKey(env.SDP_BACKUP_KEY);
  const encrypted = dumpFile.endsWith('.enc');
  if (encrypted && !key) throw new Error('restore-drill: the dump is encrypted and SDP_BACKUP_KEY is not set (or too short)');
  const sql = backup.openDump(dumpFile, { key });
  if (!backup.hasDumpTrailer(sql)) throw new Error(`restore-drill: ${path.basename(dumpFile)} has no pg_dump trailer — incomplete dump, nothing to restore`);
  const storedBytes = fs.statSync(dumpFile).size;
  log(`[restore-drill] dump ${path.basename(dumpFile)}: ${drill.fmtBytes(sql.length)} plain SQL, trailer present${encrypted ? ', decrypted' : ''}`);

  // live counts first (closest to the dump in time)
  const live = new Client({ connectionString: liveUrl });
  await live.connect();
  let liveCounts;
  try { liveCounts = await countTables(live, drill.MAIN_TABLES); } finally { await live.end(); }

  const target = await provisionTarget({ env, liveUrl, Client });
  log(`[restore-drill] target: ${target.kind} ${target.name}`);
  let comparison, psql, durationMs;
  try {
    const t0 = Date.now();
    const body = target.kind === 'schema' ? Buffer.from(drill.rewriteSchema(sql.toString('utf8'), target.schema), 'utf8') : sql;
    if (target.kind === 'schema') notes.push('Throwaway-schema fallback: no PG_ADMIN_URL with CREATEDB → the dump was rewritten from `public.` to the drill schema (documented limitation; a throwaway database is the preferred target).');
    const r = restoreWithPsql(target.url, body, { env, spawn: o.spawn });
    durationMs = Date.now() - t0;
    psql = drill.summarizePsqlErrors(r.stderr);
    if (r.status !== 0) notes.push(`psql exited ${r.status}`);
    const tc = new Client({ connectionString: target.url });
    await tc.connect();
    let restored;
    try { restored = await countTables(tc, drill.MAIN_TABLES, { schema: target.schema }); } finally { await tc.end(); }
    comparison = drill.compareCounts(liveCounts, restored);
  } finally {
    if (!o.keepTarget) { try { await target.drop(); } catch (e) { notes.push('target drop failed: ' + e.message); log('[restore-drill] WARNING target drop failed: ' + e.message); } }
    else notes.push(`target kept on request: ${target.kind} ${target.name}`);
  }
  if (!encrypted) notes.push('The dump was stored as plaintext gzip — set SDP_BACKUP_KEY in .env to encrypt backups at rest.');

  const reportDir = o.reportDir || defaultReportDir(env);
  fs.mkdirSync(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, `${date}.md`);
  const d = { date, dumpFile, dumpBytes: sql.length, storedBytes, encrypted, target: { kind: target.kind, name: target.name }, comparison, durationMs, psql, notes, actor: o.actor, reportFile };
  fs.writeFileSync(reportFile, drill.renderReport(d));
  const details = drill.logDetails(d);
  if (!o.noLog) {
    try {
      if (typeof o.logEvent === 'function') o.logEvent({ category: 'ops', action: 'restore_drill', actor: 'restore-drill', target: date, details, risk: comparison.ok ? 0 : 1 });
      else await logDirect(liveUrl, details, Client);
    } catch (e) { log('[restore-drill] WARNING system_log row not written: ' + e.message); }
  }
  for (const r of comparison.rows) log(`[restore-drill]   ${r.table.padEnd(18)} live=${r.live == null ? '—' : r.live}  restored=${r.restored == null ? '—' : r.restored}  ${r.status}`);
  log(`[restore-drill] ${comparison.ok ? 'PASS' : 'FAIL'} — report ${reportFile}`);
  if (!comparison.ok) { const e = new Error(`restore drill FAILED: ${comparison.mismatches} table(s) differ (see ${reportFile})`); e.transient = false; e.result = { ok: false, comparison, reportFile, dumpFile, target: d.target }; throw e; }
  return { ok: true, comparison, reportFile, dumpFile, target: d.target, rows: 1 };
}

function argOf(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

if (require.main === module) {
  run({
    dumpFile: argOf('--dump'), dir: argOf('--dir'), reportDir: argOf('--report-dir'),
    backupFirst: process.argv.includes('--backup-first'), keepTarget: process.argv.includes('--keep-target'),
    noLog: process.argv.includes('--no-log'), actor: 'manual run (tools/pg/restore-drill.js)',
  }).then(() => process.exit(0))
    .catch((e) => { console.error('[restore-drill] ' + e.message); process.exit(1); });
}

module.exports = { run, countTables, provisionTarget, restoreWithPsql, defaultBackupDir, defaultReportDir };
