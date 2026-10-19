#!/usr/bin/env node
/**
 * Diagnostic: investigate why the Incident Register table on
 * executive-report.html shows all RCA/CA/PIR/LL as red dots
 * (the "MISSING" indicator).
 *
 * Run from C:\Apps\SDP-Dashboard\ on the prod host:
 *
 *     node _diag_major_udfs.js
 *
 * The script opens reports.db read-only and prints:
 *   1. How many Major Incidents exist in the last 12 months
 *   2. How many of those have udf_json populated
 *   3. For up to 5 most recent: the raw udf_json + parsed UDF keys
 *   4. Last successful sync timestamps (requests + change_cab)
 *   5. Per-UDF-key fill rate across all major incidents in window
 *
 * Read-only — does NOT modify any data. Safe to run anytime.
 */

'use strict';

const path     = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'data', 'reports.db');

let db;
try {
  db = new Database(DB_PATH, { readonly: true });
} catch (e) {
  console.error('Cannot open reports.db at', DB_PATH, '\n', e.message);
  process.exit(1);
}

const MONTHS = 12;
const cutoffISO = new Date(new Date().getFullYear(), new Date().getMonth() - MONTHS + 1, 1).toISOString();

console.log('\n=================================================');
console.log('Major Incident UDF diagnostic — last', MONTHS, 'months');
console.log('Cutoff (created_time >=):', cutoffISO);
console.log('=================================================\n');

// ── 1. Total counts ──────────────────────────────────────────────────
const total = db.prepare(`
  SELECT COUNT(*) AS n FROM request_records
  WHERE LOWER(COALESCE(request_type, '')) LIKE '%major%'
    AND created_time >= ?
`).get(cutoffISO).n;

const withUdfJson = db.prepare(`
  SELECT COUNT(*) AS n FROM request_records
  WHERE LOWER(COALESCE(request_type, '')) LIKE '%major%'
    AND created_time >= ?
    AND udf_json IS NOT NULL
    AND TRIM(udf_json) NOT IN ('', '{}')
`).get(cutoffISO).n;

console.log(`1. Major incidents in window:           ${total}`);
console.log(`   With udf_json (non-empty/{}):         ${withUdfJson}`);
console.log(`   Without udf_json (NULL or empty):     ${total - withUdfJson}`);
if (total === 0) {
  console.log('\n⚠ Zero major incidents in this DB window — table will be empty.');
  console.log('  Either no real majors in last 12 months OR sync hasn\'t populated request_records.');
}
if (total > 0 && withUdfJson === 0) {
  console.log('\n🔴 ROOT CAUSE LIKELY HERE: Major incidents exist but ALL have empty udf_json.');
  console.log('   The MAJOR_INCIDENTS (790842) backfill step in zoho-sync.js isn\'t');
  console.log('   filling the column. Either:');
  console.log('     (a) the Zoho view returns no rows  → check sync logs for "fetched 0 MAJOR_INCIDENTS"');
  console.log('     (b) the Zoho view changed column naming  → check for "NO UDF: columns" warning');
  console.log('     (c) request_id mismatch on UPDATE  → check for "had no matching request_id" warning');
  console.log('   Run on prod:');
  console.log('     pm2 logs endeavour-dashboard --lines 500 --nostream | findstr UDF');
}

// ── 2. Sample 5 most recent — raw + parsed ──────────────────────────
console.log('\n2. Sample of 5 most recent major incidents:');
const samples = db.prepare(`
  SELECT request_id, display_id, subject, site, created_time, udf_json
  FROM request_records
  WHERE LOWER(COALESCE(request_type, '')) LIKE '%major%'
    AND created_time >= ?
  ORDER BY created_time DESC
  LIMIT 5
`).all(cutoffISO);
samples.forEach((s, i) => {
  console.log(`\n  [${i + 1}] #${s.display_id || '—'}  (req_id=${s.request_id})`);
  console.log(`      Site: ${s.site || '—'}   Created: ${s.created_time || '—'}`);
  console.log(`      Subject: ${(s.subject || '').substring(0, 80)}`);
  console.log(`      udf_json raw: ${s.udf_json ? s.udf_json.substring(0, 220) : '(NULL)'}${s.udf_json && s.udf_json.length > 220 ? '…' : ''}`);
  if (s.udf_json) {
    try {
      const u = JSON.parse(s.udf_json);
      const keys = Object.keys(u);
      const udfKeys = keys.filter(k => k.startsWith('UDF:'));
      const populatedKeys = udfKeys.filter(k => u[k] != null && String(u[k]).trim() !== '');
      console.log(`      → parsed: ${keys.length} keys total, ${udfKeys.length} UDF: keys, ${populatedKeys.length} populated`);
      if (populatedKeys.length > 0) {
        console.log(`      → populated UDF keys: ${populatedKeys.slice(0, 6).join(' | ')}${populatedKeys.length > 6 ? ' …' : ''}`);
        const sampleKey = populatedKeys[0];
        console.log(`      → sample value (${sampleKey}): "${String(u[sampleKey]).substring(0, 80)}…"`);
      }
    } catch (e) {
      console.log(`      → ⚠ MALFORMED JSON: ${e.message}`);
    }
  }
});

// ── 3. Per-UDF-key fill rate ────────────────────────────────────────
console.log('\n3. Per-UDF-key fill rate (across all major incidents in window):');
const UDF_KEYS_OF_INTEREST = [
  'UDF:Root Cause Analysis :',
  'UDF:Corrective action:',
  'UDF:Lessons Learned:',
  'UDF:Preventive Measures:',
  'UDF:Workaround Details (if applicable):',
  'UDF:PIR Required:',
];
const allRows = db.prepare(`
  SELECT udf_json FROM request_records
  WHERE LOWER(COALESCE(request_type, '')) LIKE '%major%'
    AND created_time >= ?
    AND udf_json IS NOT NULL
`).all(cutoffISO);

const fillCounts = Object.fromEntries(UDF_KEYS_OF_INTEREST.map(k => [k, 0]));
let parseFails = 0;
for (const r of allRows) {
  let u;
  try { u = JSON.parse(r.udf_json); } catch (_) { parseFails++; continue; }
  if (!u || typeof u !== 'object') continue;
  for (const k of UDF_KEYS_OF_INTEREST) {
    const v = u[k];
    if (v != null && String(v).trim().length > 2) fillCounts[k]++;
  }
}
const maxKeyLen = Math.max(...UDF_KEYS_OF_INTEREST.map(k => k.length));
UDF_KEYS_OF_INTEREST.forEach(k => {
  const pct = total > 0 ? (fillCounts[k] / total * 100).toFixed(1) : '0.0';
  console.log(`     ${k.padEnd(maxKeyLen + 2)}  ${fillCounts[k]} / ${total} populated  (${pct}%)`);
});
if (parseFails > 0) console.log(`     ⚠ ${parseFails} rows had malformed JSON in udf_json`);

// ── 4. Sync timestamps ──────────────────────────────────────────────
console.log('\n4. Sync metadata (when did the last successful sync happen?):');
try {
  // Discover column names defensively — sync_metadata schema has evolved over time.
  // The job-name column was renamed `job_name` (was `job`), and the success-time
  // column is `last_sync_at` (was `last_success`). PRAGMA-driven lookup lets the
  // script keep working across both shapes.
  const cols = db.prepare(`PRAGMA table_info(sync_metadata)`).all().map(c => c.name);
  const jobCol  = cols.includes('job_name')        ? 'job_name'
                : cols.includes('job')             ? 'job'
                : null;
  const tsCol   = cols.includes('last_sync_at')    ? 'last_sync_at'
                : cols.includes('last_success')    ? 'last_success'
                : null;
  const rowsCol = cols.includes('last_sync_rows')  ? 'last_sync_rows'
                : cols.includes('rows_synced')     ? 'rows_synced'
                : null;
  if (!jobCol || !tsCol) {
    console.log(`     ⚠ Unable to map sync_metadata columns. Found: ${cols.join(', ')}`);
  } else {
    const syncRows = db.prepare(
      `SELECT ${jobCol} AS job, ${tsCol} AS ts${rowsCol ? `, ${rowsCol} AS rows` : ''}, last_error
       FROM sync_metadata
       WHERE ${jobCol} IN ('requests', 'helpdesk', 'change_cab', 'survey')
       ORDER BY ${jobCol}`
    ).all();
    if (syncRows.length === 0) {
      console.log('     ⚠ sync_metadata empty — sync hasn\'t reported a state yet.');
    } else {
      syncRows.forEach(s => {
        const age = s.ts ? Math.round((Date.now() - new Date(s.ts).getTime()) / 3600000) + 'h ago' : '(never)';
        console.log(`     ${(s.job || '').padEnd(12)}  last_sync_at=${s.ts || '(never)'}  age=${age}  rows=${s.rows ?? '—'}`);
        if (s.last_error) console.log(`     ${' '.repeat(12)}  ⚠ last_error: ${s.last_error}`);
      });
    }
  }
} catch (e) {
  console.log('     ⚠ sync_metadata not queryable:', e.message);
}

// ── 5. Hint ──────────────────────────────────────────────────────────
console.log('\n5. Next steps if fill rate is 0% or very low:');
console.log('   (a) Force a fresh requests sync (will re-run the UDF backfill):');
console.log('       curl -X POST http://localhost:3456/api/sync/trigger/requests \\');
console.log('         -H "x-report-token: <super-admin-session-token>"');
console.log('   (b) Watch the sync log for diagnostic lines:');
console.log('       pm2 logs endeavour-dashboard --lines 200 --nostream | findstr UDF');
console.log('       Look for:');
console.log('         "fetched X MAJOR_INCIDENTS rows for UDF backfill"  → 0 means Zoho returns no majors');
console.log('         "NO UDF: columns"                                  → view column-name mismatch');
console.log('         "had no matching request_id in DB"                 → primary-key format mismatch');
console.log('   (c) If sync succeeded but fill rate is still 0%, the techs simply haven\'t');
console.log('       filled in the UDF fields on real incidents — that\'s a data-entry issue,');
console.log('       not a dashboard bug. The red dots are correct.\n');

db.close();
