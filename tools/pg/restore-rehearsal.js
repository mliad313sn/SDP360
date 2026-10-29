#!/usr/bin/env node
'use strict';
// EX-03 — PostgreSQL release rehearsal on DISPOSABLE databases (never production, never a real copy unless
// the data owner authorised it). Measures; does not invent a target. Steps, each timed:
//   1 create a database and apply every migration (db/migrate.js) — the installer/CI path
//   2 load a synthetic volume (--rows, default 100 000 helpdesk tickets) + collation / timezone probes
//   3 backup with the production code (services/backup.js: pg_dump, trailer check, gzip, AES-256-GCM)
//   4 restore into a second database with the production code (services/dbRestore.js: one transaction)
//   5 reconcile: row count of every table + an ordered checksum of the ticket table, source vs restored
//   6 failure: a dump with an error in the middle is refused and the target database is unchanged
//   7 drop both databases (unless --keep)
// Usage: PG_ADMIN_URL=postgres://<role with CREATEDB>@host/db node tools/pg/restore-rehearsal.js [--rows 100000] [--out dir]
// Output: a JSON + Markdown report (stdout + --out). The superuser URL is never printed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..', '..');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const ROWS = Math.max(1000, Number(arg('--rows', '100000')) || 100000);
const OUT = arg('--out', '');
const KEEP = process.argv.includes('--keep');

function dbUrl(admin, name) { const u = new URL(admin); u.pathname = '/' + name; return u.toString(); }
async function q(url, sql, params) { const c = new Client({ connectionString: url }); await c.connect(); try { return await c.query(sql, params); } finally { await c.end(); } }
async function timed(steps, name, fn) { const t = process.hrtime.bigint(); const r = await fn(); steps.push({ step: name, ms: Number((process.hrtime.bigint() - t) / 1000000n) }); return r; }

async function counts(url) {
  const tables = (await q(url, "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1")).rows.map((r) => r.table_name);
  const out = {};
  for (const t of tables) out[t] = Number((await q(url, `SELECT count(*)::bigint AS n FROM "${t}"`)).rows[0].n);
  return out;
}
async function ticketChecksum(url) {
  return (await q(url, "SELECT md5(string_agg(request_id || '|' || coalesce(site,'') || '|' || coalesce(created_time,''), ',' ORDER BY request_id)) AS h FROM request_records")).rows[0].h;
}

async function main() {
  const admin = process.env.PG_ADMIN_URL;
  if (!admin) { console.error('PG_ADMIN_URL (a role with CREATEDB on a disposable cluster) is required'); process.exit(2); }
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const src = `sdp_rehearsal_${stamp}`, dst = `sdp_rehearsal_${stamp}_restored`;
  const srcUrl = dbUrl(admin, src), dstUrl = dbUrl(admin, dst);
  const steps = []; const report = { at: new Date().toISOString(), rows_requested: ROWS, steps, checks: [] };
  const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail }); if (!ok) report.failed = true; };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-rehearsal-'));
  try {
    const v = await q(admin, 'SELECT version() AS v, current_setting(\'TimeZone\') AS tz');
    report.server = v.rows[0].v.split(' on ')[0]; report.timezone = v.rows[0].tz;
    await q(admin, `CREATE DATABASE ${src}`); await q(admin, `CREATE DATABASE ${dst}`);
    const coll = (await q(srcUrl, 'SELECT datcollate, datctype FROM pg_database WHERE datname=current_database()')).rows[0];
    report.collation = coll.datcollate; report.ctype = coll.datctype;

    await timed(steps, 'migrate (every db/postgres script)', async () => {
      const r = spawnSync(process.execPath, [path.join(ROOT, 'db', 'migrate.js')], { env: { ...process.env, PG_URL: srcUrl }, encoding: 'utf8' });
      check('migrations apply on an empty database', r.status === 0, (r.stdout.match(/applied=\d+[^\n]*/) || [String(r.stderr).slice(-200)])[0]);
    });

    await timed(steps, `load ${ROWS} synthetic tickets`, async () => {
      await q(srcUrl, `INSERT INTO request_records (request_id, display_id, subject, request_status, site, tech_group, created_time, resolved_time, udf_json)
        SELECT 'R' || g, 'D' || g, 'Ticket ' || g || ' — Houndé / Ity / Sabodala', (ARRAY['Open','Closed','Resolved','On Hold','Cancelled'])[1 + g % 5],
               (ARRAY['HOUNDE','Hounde','Houndé','MANA','Sabodala','ITY','Lafigué','Ouagadougou'])[1 + g % 8], 'Site IT Agents',
               to_char(timestamp '2025-01-01' + (g || ' minutes')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'),
               CASE WHEN g % 3 = 0 THEN NULL ELSE to_char(timestamp '2025-01-01' + ((g + 90) || ' minutes')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"') END,
               '{"UDF:Services affected":"Internet, Infrastructure (FW, files, data, mail, etc.)"}'
        FROM generate_series(1, $1) g`, [ROWS]);
    });

    // collation / timezone probes — what the application relies on (ISO TEXT dates, accent-folded matching in JS)
    const p1 = (await q(srcUrl, "SELECT count(*)::int AS n FROM request_records WHERE substr(created_time,1,10) BETWEEN '2025-01-01' AND '2025-01-31'")).rows[0].n;
    check('ISO TEXT date window is exact and timezone-independent (substr BETWEEN)', p1 === Math.min(ROWS, 31 * 1440 - 1), `${p1} rows in January 2025`);
    const p2 = (await q(srcUrl, "SELECT array_agg(s ORDER BY s) AS a FROM (SELECT DISTINCT site AS s FROM request_records) x")).rows[0].a;
    report.site_sort_order = p2;
    check('accented site labels are stored and returned byte-for-byte', p2.includes('Houndé') && p2.includes('Lafigué'), p2.join(', '));
    const p3 = (await q(srcUrl, "SELECT to_char(now() AT TIME ZONE 'UTC','YYYY') AS y")).rows[0].y;
    check('server clock reachable in UTC', /^\d{4}$/.test(p3), p3);

    const before = await counts(srcUrl); const hSrc = await ticketChecksum(srcUrl);
    report.tables = Object.keys(before).length; report.rows_total = Object.values(before).reduce((a, b) => a + b, 0);

    const bdir = path.join(work, 'backups');
    const env = { ...process.env, PG_URL: srcUrl, SDP_BACKUP_KEY: crypto.randomBytes(24).toString('base64url') };
    const bk = await timed(steps, 'backup (pg_dump + trailer + gzip + AES-256-GCM)', () => require('../../services/backup').runBackup({ dir: bdir, env, log: () => {} }));
    report.backup = { raw_bytes: bk.bytes, stored_bytes: bk.stored_bytes, encrypted: bk.encrypted };

    const R = require('../../services/dbRestore');
    await timed(steps, 'restore into a second database (one transaction)', async () => {
      R.restoreDatabase({ file: bk.file, confirm: R.confirmPhrase(bk.file), env: { ...env, PG_URL: dstUrl } });
    });
    const after = await counts(dstUrl); const hDst = await ticketChecksum(dstUrl);
    const diff = Object.keys({ ...before, ...after }).filter((t) => before[t] !== after[t]);
    check('every table has the same row count after the restore', diff.length === 0, diff.length ? diff.join(', ') : `${report.tables} tables, ${report.rows_total} rows`);
    check('ticket table identical (ordered checksum)', hSrc === hDst, hSrc === hDst ? 'md5 match' : 'md5 differs');

    // failure: an error in the middle of the dump → refused, target unchanged (single transaction)
    await q(dstUrl, "INSERT INTO request_records (request_id) VALUES ('REHEARSAL-MARKER')");
    const plain = require('../../services/backup').openDump(bk.file, { key: require('../../services/backup').deriveKey(env.SDP_BACKUP_KEY) }).toString('utf8');
    const cut = plain.indexOf('\nCOPY ');
    const broken = plain.slice(0, cut) + '\nSELECT 1/0;\n' + plain.slice(cut);
    const bad = path.join(bdir, 'sdp_dashboard_20261029T000000Z.sql.gz');
    fs.writeFileSync(bad, zlib.gzipSync(Buffer.from(broken, 'utf8')));
    let refused = false;
    await timed(steps, 'restore of a broken dump (must fail)', async () => {
      try { R.restoreDatabase({ file: bad, confirm: R.confirmPhrase(bad), env: { ...env, PG_URL: dstUrl, SDP_BACKUP_KEY: '' } }); } catch (_) { refused = true; }
    });
    const marker = Number((await q(dstUrl, "SELECT count(*)::int AS n FROM request_records WHERE request_id='REHEARSAL-MARKER'")).rows[0].n);
    check('a broken dump is refused', refused, refused ? 'restore failed as expected' : 'restore did not fail');
    check('the target database is unchanged after the failed restore (rolled back)', marker === 1, `marker rows: ${marker}`);
    report.measured_restore_ms = (steps.find((s) => s.step.startsWith('restore into')) || {}).ms;
  } finally {
    if (!KEEP) { for (const d of [src, dst]) { try { await q(admin, `DROP DATABASE IF EXISTS ${d} WITH (FORCE)`); } catch (_) { try { await q(admin, `DROP DATABASE IF EXISTS ${d}`); } catch (_e) { /* left for the operator */ } } } }
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {}
  }
  const md = [
    `# PostgreSQL rehearsal — ${report.at}`, '',
    `Server: ${report.server} · timezone ${report.timezone} · collation ${report.collation} · ${report.tables} tables, ${report.rows_total} rows (synthetic)`, '',
    '| Step | ms |', '|---|---:|', ...steps.map((s) => `| ${s.step} | ${s.ms} |`), '',
    `Backup: ${report.backup ? `${report.backup.raw_bytes} bytes raw, ${report.backup.stored_bytes} stored, encrypted ${report.backup.encrypted}` : '—'}`, '',
    '| Check | Result | Detail |', '|---|---|---|', ...report.checks.map((c) => `| ${c.name} | ${c.ok ? 'PASS' : 'FAIL'} | ${String(c.detail).replace(/\|/g, '/')} |`), '',
    'Measured on disposable databases with synthetic data. RPO/RTO targets are a decision of the owners; this measures, it does not set them.',
  ].join('\n');
  console.log(md);
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'rehearsal.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(path.join(OUT, 'rehearsal.md'), md + '\n'); }
  process.exit(report.failed ? 1 : 0);
}
if (require.main === module) main().catch((e) => { console.error('rehearsal failed: ' + e.message); process.exit(1); });
module.exports = { dbUrl };
