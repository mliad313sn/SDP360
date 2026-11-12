'use strict';
const { fail } = require('../services/httpError');
// ─────────────────────────────────────────────────────────────────────────
// Health routes — extracted from server.js (fiche M12-a, 2026-10-20), same dependency-injection
// pattern as routes/inspection.js.
//
//   GET /ready              — UNAUTHENTICATED readiness probe (fiche C1 / M14). Mounted OUTSIDE the
//                             /api/ gate on purpose; returns ONLY {ok, db, last_job_at} — no business
//                             data, no token state, no identifiers.
//   GET /api/health/views   — Zoho view-schema check, session + admin tier (was key/query-token only).
//   GET /api/health/restore-drill — last `restore_drill` system_log row (E11), super_admin.
//   GET /api/health/version — package version + build SHA + Node + start time; any signed-in user
//                             (consolidation P0-E / backlog E0.3). Nothing sensitive: no host, path or config.
//                             Admin tier also gets `provenance` (F-ARCH-03): source vs installed artifact
//                             (manifest.json, signature check, SBOM) — services/runtimeProvenance.js.
//
// Wiring in server.js:
//   app.use(require('./routes/health')({ express, checkZohoViewSchema, requireReportSession, getRdb }));
// ─────────────────────────────────────────────────────────────────────────
module.exports = function healthRoutes(deps) {
  const { express, checkZohoViewSchema, requireReportSession, getRdb, getBuild, getTokenState, getProvenance } = deps;
  const startedAt = new Date().toISOString();
  const router = express.Router();

// Readiness: can we reach the database? When was the last sync job marked successful?
// `getSyncStatus` is a dual-backend dispatcher (Promise on PostgreSQL) → awaited.
router.get('/ready', async (req, res) => {
  let db = false, last_job_at = null;
  try {
    const rdb = getRdb && getRdb();
    if (rdb) {
      const rows = await rdb.getSyncStatus();
      db = true;
      for (const r of rows || []) {
        const t = r && r.last_sync_at;
        if (t && (!last_job_at || String(t) > String(last_job_at))) last_job_at = t;
      }
    }
  } catch (e) { db = false; }
  res.status(db ? 200 : 503).json({ ok: db, db, last_job_at });
});

router.get('/api/health/version', requireReportSession, (req, res) => {
  const out = { version: require('../package.json').version, build: (getBuild && getBuild()) || null,
    node: process.version, started_at: startedAt };
  let admin = false;
  try { admin = !!getRdb().userHasRole(req.reportUser, 'admin'); } catch (_) { admin = false; }
  if (admin && getProvenance) { try { out.provenance = getProvenance(); } catch (_) { out.provenance = null; } }
  res.json(out);
});

// Expose as an admin-only endpoint for manual health checks (session required — the admin tier
// is checked through rdb.userHasRole, never user.role === 'admin').
router.get('/api/health/views', requireReportSession, async (req, res) => {
  const rdb = getRdb();
  if (!rdb.userHasRole(req.reportUser, 'admin')) {
    return res.status(403).json({ error: 'Admin role required' });
  }
  try {
    const results = await checkZohoViewSchema();
    const allOk = results.every(r => r.ok);
    res.json({ ok: allOk, checkedAt: new Date().toISOString(), results });
  } catch(e) {
    fail(res, e);
  }
});

// E11 — last restore drill (super_admin): the newest `restore_drill` row of system_log, so the
// admin card can show date + result without reading the dated report file.
// `listSystemLog` is a dual-backend dispatcher (Promise on PostgreSQL) → awaited.
router.get('/api/health/restore-drill', requireReportSession, async (req, res) => {
  const rdb = getRdb();
  if (!rdb.userHasRole(req.reportUser, 'super_admin')) return res.status(403).json({ error: 'super_admin only' });
  try {
    const { rows } = await rdb.listSystemLog({ category: 'ops', action: 'restore_drill' }, { limit: 1, offset: 0 });
    const r = rows && rows[0];
    if (!r) return res.json({ last: null });
    let details = null;
    try { details = typeof r.details === 'string' ? JSON.parse(r.details) : r.details; } catch (_) { details = null; }
    res.json({ last: { ts: r.ts, ok: details ? !!details.ok : !r.risk, date: r.target, details } });
  } catch (e) { fail(res, e); }
});

// E-Q07 — GET /api/health/deps (admin tier): dependency health from readings already on this server —
// PostgreSQL SELECT 1, Zoho token state (in memory), SMTP configured (never probed), sync jobs vs their
// freshness window, last backup / restore drill, data-dir disk free. NO outbound call. unknown ≠ green.
router.get('/api/health/deps', requireReportSession, async (req, res) => {
  const rdb = getRdb();
  if (!rdb.userHasRole(req.reportUser, 'admin')) return fail(res, new Error('Admin role required'), 403);
  const r = { tokenState: null, config: null, syncRows: null, restoreDrill: null, disk: null, pg: null };
  const { FRESHNESS_HOURS } = require('../services/sync/jobs');
  r.freshness = FRESHNESS_HOURS;
  try { const t0 = process.hrtime.bigint(); await rdb.pgHandle().prepare('SELECT 1 AS ok').get(); r.pg = { latency_ms: Number((process.hrtime.bigint() - t0) / 1000000n) }; }
  catch (e) { r.pg = { error: e.message }; }
  try { const ts = getTokenState && getTokenState(); if (ts) r.tokenState = { accessToken: !!ts.accessToken, expiresAt: ts.expiresAt, lastRefreshError: !!ts.lastRefreshError }; } catch (_) { /* unknown */ }
  try { r.config = await require('../services/reportConfig').getConfig(rdb.db); } catch (_) { /* unknown */ }
  try { const sync = require('../services/sync'); await sync.ensureReady(); r.syncRows = await sync.getStore().health(); } catch (_) { /* unknown */ }
  try {
    const { rows } = await rdb.listSystemLog({ category: 'ops', action: 'restore_drill' }, { limit: 1, offset: 0 });
    const x = rows && rows[0];
    if (x) { let d = null; try { d = typeof x.details === 'string' ? JSON.parse(x.details) : x.details; } catch (_) { d = null; } r.restoreDrill = { ts: x.ts, ok: d ? !!d.ok : !x.risk }; }
  } catch (_) { /* unknown */ }
  try {
    const fs = require('fs'); const dir = process.env.SDP_DATA_DIR || require('path').join(__dirname, '..', 'data');
    const st = fs.statfsSync(fs.existsSync(dir) ? dir : require('path').join(__dirname, '..'));
    r.disk = { free_bytes: st.bavail * st.bsize, total_bytes: st.blocks * st.bsize };
  } catch (_) { /* unknown */ }
  res.json(require('../services/healthDeps').compose(r));
});

  return router;
};
