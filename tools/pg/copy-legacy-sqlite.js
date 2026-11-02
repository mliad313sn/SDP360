#!/usr/bin/env node
'use strict';
// A-01 — one-shot copy of a 1.x SQLite store into the PostgreSQL schema of 2.0 (operator step, never run by Setup).
// The source is opened READ-ONLY through node:sqlite (no native module: better-sqlite3 stays out of package.json).
// The schema belongs to db/migrate.js: this tool never applies DDL, it refuses (exit 2) when a target table is missing.
//
//   tools\pg\copy-legacy-sqlite.cmd --module assets [--source <path\to\assets.db>]          dry run (default)
//   tools\pg\copy-legacy-sqlite.cmd --module assets [--source <path\to\assets.db>] --apply  one transaction
//   (or: node --experimental-sqlite tools/pg/copy-legacy-sqlite.js …   — the flag is needed on Node 22.11)
//
// Default source: <SDP_DATA_DIR or ./data>/assets.db. PG_URL comes from the environment, else the app .env
// (never overriding an exported value). PG_URL is never printed. Exit codes: 0 ok · 1 error · 2 refused
// (bad arguments, source missing, schema not migrated) · 3 a target holds fewer rows than the source after --apply.
// Ported from the 1.x tools/pg/copy-assets.js (git show f44591a^): same tables, NULL-PK skip, append-only guard.
const fs = require('fs');
const path = require('path');

// table -> columns, primary key. The 12 assets tables of 1.x (6 re-synced nightly from Analytics, 6 that a
// re-sync can NEVER rebuild: effort/reconcile history, external devices, import log, first sightings).
const TABLES = [
  ['assets', [
    'asset_id','asset_name','product','product_type','manufacturer','state','serial_number',
    'barcode','site','site_id','purchase_cost','acquisition_date','warranty_expiry','user_name',
    'department','last_successful_audit_time','last_audit_status','days_since_scan',
    'last_scan_source','created_time',
  ], ['asset_id']],
  ['asset_memory', ['memory_module_id','workstation_id','capacity_gb','socket_label','module_tag'], ['memory_module_id']],
  ['asset_logical_drives', ['drive_id','workstation_id','drive_letter','capacity_gb','free_gb','free_pct','file_type'], ['drive_id']],
  ['asset_monitors', ['workstation_id','monitor_id','monitor_type','manufacturer','serial_number'], ['workstation_id','monitor_id']],
  ['software_licenses', ['license_id','license_name','license_type','license_state','expiry_date','cost','site','vendor','software_id'], ['license_id']],
  ['software', [
    'software_id','software_name','manufacturer','licensed_installations','installations',
    'installations_allowed','available_for_allocation','allocated_to_downgrades','purchased',
    'allocated','purchased_cal','compliance_type','software_category','software_type',
  ], ['software_id']],
  // ── IRREPLACEABLE: append-only / point-in-time, a re-sync cannot rebuild them ──
  ['asset_effort_history', [
    'snapshot_date','site','total','no_cost','no_age','no_owner','never_scanned',
    'no_asset_tag','discovered','ghost','cost_pct','age_pct','owner_pct','scan_pct',
    'tag_pct','enrolled_pct','effort_score',
  ], ['snapshot_date','site']],
  ['asset_reconcile_history', [
    'snapshot_date','gaps_open','gaps_decided','sites_touched','ous_touched',
    'retirement_candidates','retirement_applicable','sources_present','by_site_json','captured_by',
  ], ['snapshot_date']],
  ['asset_reconcile_decisions', ['device_key','decision','reason','decided_by','decided_at'], ['device_key']],
  ['asset_external_devices', [
    'source','device_key','device_name','dns_name','os','os_version','last_seen',
    'enabled','join_type','ou_dn','model','raw_json','import_id','imported_at',
  ], ['source','device_key']],
  ['asset_first_seen', ['asset_id','site','first_seen_date','baseline'], ['asset_id']],
  // no primary key (append-only log): copied only into an EMPTY target so a re-run cannot duplicate it
  ['asset_import_log', ['source','imported_at','row_count','dated_count','imported_by'], []],
];
const MODULES = { assets: { file: 'assets.db', tables: TABLES } };

function _upsertSql(table, cols, pk) {
  const ph = cols.map(() => '?').join(', ');
  let conflict = '';
  if (pk && pk.length) {
    const setCols = cols.filter((c) => !pk.includes(c));
    conflict = setCols.length
      ? `ON CONFLICT (${pk.join(',')}) DO UPDATE SET ${setCols.map((c) => `${c}=EXCLUDED.${c}`).join(', ')}`
      : `ON CONFLICT (${pk.join(',')}) DO NOTHING`;
  }
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ${conflict}`.trim();
}

/** Pure: what --apply would do per table, from the source and target row counts (null = table absent). */
function planCopy(srcCounts, tgtCounts, tables = TABLES) {
  return tables.map(([table, , pk]) => {
    const s = srcCounts[table], t = tgtCounts[table];
    let action;
    if (s == null) action = 'absent in source';
    else if (s === 0) action = 'nothing to copy';
    else if (!pk.length) action = t > 0 ? 'skip (append-only, target not empty)' : `insert ${s}`;
    else action = `upsert ${s} by (${pk.join(',')})`;
    return { table, source: s == null ? null : s, target: t == null ? null : t, action };
  });
}

function openSource(file) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { throw new Error('node:sqlite is not available — run through tools\\pg\\copy-legacy-sqlite.cmd (adds --experimental-sqlite) on Node 22'); }
  return new DatabaseSync(file, { readOnly: true });
}
const _cols = (sdb, table) => { try { return sdb.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name); } catch (_) { return []; } };
function sourceCounts(sdb, tables) {
  const out = {};
  for (const [t] of tables) out[t] = _cols(sdb, t).length ? Number(sdb.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n) : null;
  return out;
}
async function targetCounts(pg, tables) {
  const out = {};
  for (const [t] of tables) out[t] = Number((await pg.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).n);
  return out;
}
async function missingTargets(pg, tables) {
  const have = new Set((await pg.prepare('SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()').all()).map((r) => r.table_name));
  return tables.map(([t]) => t).filter((t) => !have.has(t));
}

/**
 * The whole run. Returns { code, message?, applied, source, target, plan, copied?, after? }. Never prints PG_URL.
 * `pg` = a connected services/pgDb handle.
 */
async function run({ module = 'assets', source, apply = false, pg, log = console.log }) {
  const mod = MODULES[module];
  if (!mod) return { code: 2, message: `unknown --module ${module} (supported: ${Object.keys(MODULES).join(', ')})` };
  if (!source || !fs.existsSync(source)) return { code: 2, message: `source not found: ${source}` };
  const tables = mod.tables;
  const missing = await missingTargets(pg, tables);
  if (missing.length) return { code: 2, message: `target table(s) missing: ${missing.join(', ')} — run db/migrate.js --apply first` };
  const sdb = openSource(source);
  try {
    const src = sourceCounts(sdb, tables);
    const tgt = await targetCounts(pg, tables);
    const plan = planCopy(src, tgt, tables);
    log(`[copy-legacy-sqlite] module ${module}, source ${source} (read-only)`);
    log('[copy-legacy-sqlite] source rows ' + JSON.stringify(src));
    log('[copy-legacy-sqlite] target rows ' + JSON.stringify(tgt));
    for (const p of plan) log(`  ${p.table.padEnd(26)} source ${String(p.source ?? '—').padStart(7)}  target ${String(p.target).padStart(7)}  → ${p.action}`);
    if (!apply) { log('[copy-legacy-sqlite] dry run — nothing written. Re-run with --apply after a fresh pg_dump.'); return { code: 0, applied: false, source: src, target: tgt, plan }; }
    const copied = {};
    await pg.runTransaction(async () => {
      for (const [table, cols, pk] of tables) {
        const present = _cols(sdb, table);
        if (!present.length) { copied[table] = { copied: 0, skipped: 0, note: 'absent in source' }; continue; }
        const lacking = cols.filter((c) => !present.includes(c));
        if (lacking.length) log(`[copy-legacy-sqlite] ${table}: column(s) absent in the source, copied as NULL: ${lacking.join(', ')}`);
        const rows = sdb.prepare(`SELECT ${cols.filter((c) => present.includes(c)).join(', ')} FROM ${table}`).all();
        if (rows.length && !pk.length) {
          const ex = await pg.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
          if (Number(ex.n) > 0) {
            copied[table] = { copied: 0, skipped: rows.length, note: 'target not empty' };
            log(`[copy-legacy-sqlite] ${table}: target already has ${ex.n} row(s) — skipped (append-only re-run guard)`);
            continue;
          }
        }
        const ins = pg.prepare(_upsertSql(table, cols, pk));
        let n = 0, skipped = 0;
        for (const r of rows) {
          // a NULL/empty primary key would abort the WHOLE transaction: skip and count it
          if (pk.some((k) => r[k] == null || r[k] === '')) { skipped++; continue; }
          await ins.run(...cols.map((c) => (r[c] === undefined ? null : r[c])));
          n++;
        }
        copied[table] = { copied: n, skipped };
        if (skipped) log(`[copy-legacy-sqlite] ${table}: skipped ${skipped} row(s) with a NULL/empty primary key`);
      }
    });
    const after = await targetCounts(pg, tables);
    log('[copy-legacy-sqlite] copied ' + JSON.stringify(copied));
    log('[copy-legacy-sqlite] target rows after ' + JSON.stringify(after));
    const short = tables.map(([t]) => t).filter((t) => src[t] != null && after[t] < src[t] - ((copied[t] && copied[t].skipped) || 0));
    if (short.length) { log('[copy-legacy-sqlite] WARNING target has fewer rows than source for: ' + short.join(', ')); return { code: 3, applied: true, source: src, target: tgt, plan, copied, after }; }
    return { code: 0, applied: true, source: src, target: tgt, plan, copied, after };
  } finally { sdb.close(); }
}

module.exports = { TABLES, MODULES, _upsertSql, planCopy, run };

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
    const appDir = path.resolve(__dirname, '..', '..');
    if (!process.env.PG_URL && !process.env.DATABASE_URL) { try { require('dotenv').config({ path: path.join(appDir, '.env') }); } catch (_) {} }
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('PG_URL is not set (export it, or run from the application folder where .env lives)'); process.exit(2); }
    const modName = arg('--module', 'assets');
    const dataDir = process.env.SDP_DATA_DIR ? path.resolve(appDir, process.env.SDP_DATA_DIR) : path.join(appDir, 'data');
    const source = path.resolve(arg('--source', path.join(dataDir, (MODULES[modName] || MODULES.assets).file)));
    const { makePgDb } = require('../../services/pgDb');
    const pg = makePgDb(url);
    await pg.connect();
    try {
      const r = await run({ module: modName, source, apply: argv.includes('--apply'), pg });
      if (r.message) console.error('[copy-legacy-sqlite] ' + r.message);
      process.exitCode = r.code;
    } finally { await pg.close(); }
  })().catch((e) => { console.error('[copy-legacy-sqlite] ' + String(e && e.message || e).replace(/postgres(ql)?:\/\/\S+/gi, '<PG_URL>')); process.exit(1); });
}
