'use strict';
// KPI reconciliation — proves reports.db's forked readers return the SAME numbers under sqlite and
// Postgres on the SAME data. Run BEFORE flipping REPORTS_BACKEND=postgres in prod.
//
//   PG_ADMIN_URL=postgres://…  node tools/pg/reconcile-reports.js [path/to/reports.db]
//
// Flow (orchestrator mode): provision a throwaway PG, copy the sqlite reports.db into it
// (copy-reports-all), then run a fixed set of whole-dataset KPI readers in TWO child processes —
// one sqlite-backed, one pg-backed — and deep-diff their JSON outputs. Exit 0 if identical, 1 if any
// reader diverges. The sqlite file is opened read-only by the copy; never modified.
//
// Self-exec probe mode: when _RECON_BACKEND is set, this same file requires reports-db under that
// backend, runs the reader list, and prints {name: result} JSON to stdout. (Separate processes avoid
// the reports-db singleton's load-time REPORTS_BACKEND capture.)
const fs   = require('fs');
const path = require('path');

// ── The reconcilable readers — whole-dataset / deterministic args (no per-site loop). Each entry:
//    [name, async (rdb) => result]. Add per-site assemblers later if needed. ─────────────────────
const READERS = [
  ['getRequestMetrics',            r => r.getRequestMetrics({})],
  ['getRequestFilterOptions',      r => r.getRequestFilterOptions()],
  ['getMonthlyHelpdeskHistory',    r => r.getMonthlyHelpdeskHistory(12)],
  ['getSlaTrendDB',                r => r.getSlaTrendDB(12)],
  ['getSlaByCategoryDB',           r => r.getSlaByCategoryDB()],
  ['getFirstResponseTrendDB',      r => r.getFirstResponseTrendDB(12)],
  ['getGroupRequestsDB',           r => r.getGroupRequestsDB(12)],
  ['getIncidentVsSrDB',            r => r.getIncidentVsSrDB(12)],
  ['getAgeingBySiteDB',            r => r.getAgeingBySiteDB()],
  ['getAgeingByGroupDB',           r => r.getAgeingByGroupDB()],
  ['getAgeingSummaryDB',           r => r.getAgeingSummaryDB()],
  ['getChangeMetrics',             r => r.getChangeMetrics({})],
  ['getChangeRecordsHistory',      r => r.getChangeRecordsHistory(12)],
  ['getEmergencyChangesDB',        r => r.getEmergencyChangesDB(12)],
  ['getCABMetrics',                r => r.getCABMetrics({})],
  ['getCabApprovalsDB',            r => r.getCabApprovalsDB(12)],
  ['getCabRecommendationsDB',      r => r.getCabRecommendationsDB(12)],
  ['getSurveyMetrics',             r => r.getSurveyMetrics({})],
  ['getCustomerVoiceDB',           r => r.getCustomerVoiceDB(12)],
  ['getCustomerVoiceByDimensionDB',r => r.getCustomerVoiceByDimensionDB()],
  ['getMajorIncidentsHistory',     r => r.getMajorIncidentsHistory(12)],
];

// ── Probe mode — run under whichever backend, print JSON ──────────────────────────────────────
async function probe() {
  const rdb = require('../../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') await rdb.initPgReports();
  const out = {};
  for (const [name, fn] of READERS) {
    try { out[name] = await fn(rdb); }
    catch (e) { out[name] = { __error: e.message }; }
  }
  // Wrap in markers — reports-db logs boot/seed lines to stdout; the parent extracts between these.
  process.stdout.write(`\n__RECON__${JSON.stringify(out)}__RECON__\n`);
  // pg pool keeps the loop alive — exit explicitly.
  try { if (rdb.REPORTS_BACKEND === 'postgres') await rdb.pgHandle().close(); } catch {}
  process.exit(0);
}

// ── Deep diff (epsilon for float noise; reports up to `max` differing paths) ────────────────────
function diff(a, b, p = '', acc = [], max = 40) {
  if (acc.length >= max) return acc;
  const ta = typeof a, tb = typeof b;
  if (ta === 'number' && tb === 'number') {
    if (Math.abs(a - b) > 1e-9) acc.push(`${p}: sqlite=${a} pg=${b}`);
    return acc;
  }
  if (a === null || b === null || ta !== 'object' || tb !== 'object') {
    if (a !== b) acc.push(`${p}: sqlite=${JSON.stringify(a)} pg=${JSON.stringify(b)}`);
    return acc;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) { if (acc.length >= max) break; diff(a[k], b[k], p ? `${p}.${k}` : k, acc, max); }
  return acc;
}

async function orchestrate() {
  const { spawnSync } = require('child_process');
  const _os = require('os');
  const src = process.argv[2] || path.join(__dirname, '../../data/reports.db');
  if (!fs.existsSync(src)) { console.error('reports.db not found at ' + src); process.exit(2); }
  const adminUrl = process.env.PG_ADMIN_URL || process.env.DATABASE_URL;
  if (!adminUrl) { console.error('Set PG_ADMIN_URL (admin connection to create a scratch DB)'); process.exit(2); }

  // 1) scratch PG (reuse the test harness's provisioner)
  const { provisionTestDb, dropTestDb } = require('../../tests/pg-helpers');
  const ctx = await provisionTestDb();
  if (!ctx) { console.error('Could not provision a scratch PG (is PG_ADMIN_URL reachable?)'); process.exit(2); }

  try {
    // 2) copy sqlite → scratch PG
    const { makePgDb } = require('../../services/pgDb');
    const { copyReportsAll } = require('./copy-reports-all');
    const pg = makePgDb(ctx.url); await pg.connect();
    try { await copyReportsAll(src, pg); } finally { await pg.close(); }

    // 3) run both probes as child processes
    const runProbe = (env) => {
      const res = spawnSync(process.execPath, ['--max-old-space-size=2048', __filename], {
        env: {
          // reports-db's first-boot check needs DASH_USER/PASS — default them (reconcile never uses
          // auth; on the prod host these come from .env anyway). ZOHO_* not needed (no server boot).
          DASH_USER: process.env.DASH_USER || 'recon-admin',
          DASH_PASS: process.env.DASH_PASS || 'recon-pass-0000',
          ...process.env, ...env,
          _RECON_BACKEND: env.REPORTS_BACKEND || 'sqlite',
        },
        encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
      });
      if (res.status !== 0) { console.error('probe failed:', res.stderr); process.exit(1); }
      const m = (res.stdout || '').match(/__RECON__([\s\S]*?)__RECON__/);
      if (!m) { console.error('probe produced no result marker. stdout tail:', (res.stdout||'').slice(-400)); process.exit(1); }
      return JSON.parse(m[1]);
    };
    const sqliteDir = path.dirname(path.resolve(src));   // reports-db opens <DATA_DIR>/reports.db
    const sqliteOut = runProbe({ SDP_DATA_DIR: sqliteDir, REPORTS_BACKEND: '' });
    const pgScratchDir = fs.mkdtempSync(path.join(_os.tmpdir(), 'recon-pg-'));
    const pgOut = runProbe({ SDP_DATA_DIR: pgScratchDir, REPORTS_BACKEND: 'postgres', PG_URL: ctx.url });

    // 4) diff per reader
    let failed = 0;
    for (const [name] of READERS) {
      const d = diff(sqliteOut[name], pgOut[name]);
      if (d.length === 0) { console.log(`  ✓ ${name}`); }
      else { failed++; console.log(`  ✗ ${name} — ${d.length} diff(s):`); d.slice(0, 8).forEach(x => console.log(`      ${x}`)); }
    }
    console.log(failed === 0
      ? `\n✅ RECONCILED — all ${READERS.length} readers identical sqlite vs pg`
      : `\n❌ ${failed}/${READERS.length} readers DIVERGED — investigate before the prod flip`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    await dropTestDb(ctx);
  }
}

if (process.env._RECON_BACKEND) {
  if (process.env._RECON_BACKEND === 'postgres') process.env.REPORTS_BACKEND = 'postgres';
  else delete process.env.REPORTS_BACKEND;
  probe().catch(e => { console.error(e); process.exit(1); });
} else if (require.main === module) {
  orchestrate().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { READERS, diff };
