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

// sync_metadata stamps carry no zone (UTC by convention, as routes/sync.js reads them); sync_runs stamps are ISO.
const _ms = (t) => { const s = String(t); const n = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z'); return Number.isFinite(n) ? n : -Infinity; };

// P11 r3 N-06 — the readiness probe is anonymous and was unbounded: under a long table lock (migration, VACUUM FULL)
// every /ready call hung on a pooled connection and 12 retrying probes drained the 10-connection pool, so sign-in hung
// for everyone. Three bounds now:
//   • the database work runs in ONE transaction with SET LOCAL statement_timeout / lock_timeout (READY_STMT_MS);
//   • a single probe is in flight at a time — concurrent callers share its answer (at most one pool connection);
//   • a hard timer (READY_STMT_MS + 1 s, covers waiting for a pool connection) answers 503 {error:'timeout'}.
// A non-200 answer is reused for READY_FAIL_CACHE_MS so a retry storm during an outage costs nothing; a healthy
// answer is never cached (last_job_at must move as soon as a job finishes).
const READY_STMT_MS = Math.max(100, Number(process.env.SDP_READY_STATEMENT_TIMEOUT_MS) || 1000);
const READY_FAIL_CACHE_MS = Math.max(0, Number(process.env.SDP_READY_FAIL_CACHE_MS ?? 2000));
const TIMEOUT_CODES = new Set(['57014', '55P03']);   // query_canceled (statement_timeout), lock_not_available (lock_timeout)

// Readiness: can we reach — and write to — the database? When was the last job marked successful (legacy sync_metadata OR runner sync_runs)?
// `getSyncStatus` is a dual-backend dispatcher (Promise on PostgreSQL) → awaited.
async function readinessProbe() {
  let db = false, last_job_at = null, writable = null, timedOut = false;
  try {
    const rdb = getRdb && getRdb();
    if (rdb) {
      // The sync store's first use applies its DDL — never inside the time-boxed transaction below.
      let sync = null;
      try { sync = deps.sync || require('../services/sync'); await sync.ensureReady(); } catch (_) { sync = null; }
      const h = rdb.pgHandle();
      const work = async () => {
        if (typeof h.runTransaction === 'function') {
          await h.exec(`SET LOCAL statement_timeout = ${READY_STMT_MS}`);
          await h.exec(`SET LOCAL lock_timeout = ${READY_STMT_MS}`);
        }
        const rows = await rdb.getSyncStatus();
        // P11 r2 N-03 — reachable is not enough: a database left read-only (PG_URL on the standby replica after a
        // restore/failover, or default_transaction_read_only=on) answers SELECTs while every login fails with 500.
        // /ready gates sdp-manager auto-rollback/restore, so it must say "not ready" then. One cheap catalogue read.
        const w = await h.prepare("SELECT pg_is_in_recovery() AS rec, current_setting('transaction_read_only') AS ro").get();
        writable = !!w && w.rec !== true && w.rec !== 't' && String(w.ro).toLowerCase() !== 'on';
        db = true;
        // P05 — one SELECT 1 timing for the database-latency SLI (sli_30d). Never fails the probe; the answer is unchanged.
        try { const t0 = process.hrtime.bigint(); await h.prepare('SELECT 1 AS ok').get(); require('../services/sliCounters').recordDbLatency(Number(process.hrtime.bigint() - t0) / 1e6); } catch (_) { /* reading optional */ }
        for (const r of rows || []) {
          const t = r && r.last_sync_at;
          if (t && (!last_job_at || String(t) > String(last_job_at))) last_job_at = t;
        }
        // F-ARCH-09 — jobs run by the shared runner (backup, audit, Meraki, …) never write sync_metadata: also read
        // the newest SUCCESSFUL run of sync_runs (a skip or an error is not a success) and keep the later of the two.
        // Unreadable run log → the legacy value stands; the probe never fails because of it.
        try {
          const store = sync && sync.getStore();
          const t = store && typeof store.lastOkAt === 'function' ? await store.lastOkAt() : null;
          if (t && (!last_job_at || _ms(t) > _ms(last_job_at))) last_job_at = t;
        } catch (_) { /* run log optional for readiness */ }
      };
      if (typeof h.runTransaction === 'function') await h.runTransaction(work); else await work();
    }
  } catch (e) { db = false; timedOut = !!(e && TIMEOUT_CODES.has(e.code)); }
  // Healthy answer keeps the public shape {ok, db, last_job_at}; a read-only primary answers 503 with
  // `writable:false` plus an `error` code (one response path — the probe body is not an httpError.fail body).
  const readOnly = db && writable === false;
  if (timedOut) return { status: 503, body: { ok: false, db: false, error: 'timeout', last_job_at: null } };
  const body = readOnly ? { ok: false, db, writable: false, error: 'read_only', last_job_at } : { ok: db, db, last_job_at };
  return { status: db && !readOnly ? 200 : 503, body };
}

let _inflight = null;      // the one database probe running now (shared by every concurrent caller)
let _lastFail = null;      // { at, answer } — a recent non-200 answer, reused for READY_FAIL_CACHE_MS
router.get('/ready', async (req, res) => {
  if (_lastFail && Date.now() - _lastFail.at < READY_FAIL_CACHE_MS) return res.status(_lastFail.answer.status).json(_lastFail.answer.body);
  if (!_inflight) _inflight = readinessProbe().finally(() => { _inflight = null; });
  let timer;
  const timeout = new Promise((r) => { timer = setTimeout(() => r({ status: 503, body: { ok: false, db: false, error: 'timeout', last_job_at: null } }), READY_STMT_MS + 1000); });
  const answer = await Promise.race([_inflight, timeout]);
  clearTimeout(timer);
  if (answer.status !== 200) _lastFail = { at: Date.now(), answer }; else _lastFail = null;
  res.status(answer.status).json(answer.body);
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
  try { const t0 = process.hrtime.bigint(); await rdb.pgHandle().prepare('SELECT 1 AS ok').get(); r.pg = { latency_ms: Number((process.hrtime.bigint() - t0) / 1000000n) }; require('../services/sliCounters').recordDbLatency(Number(process.hrtime.bigint() - t0) / 1e6); }
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
  const out = require('../services/healthDeps').compose(r);
  // P05 — 30-day SLI readings (docs/ops/SLO-PROPOSAL.md); observation only, every target UNKNOWN.
  try {
    const S = require('../services/sliReadings');
    out.sli_30d = await S.gather({ pg: rdb.pgHandle(), counters: require('../services/sliCounters').snapshot(), freshness: FRESHNESS_HOURS });
  } catch (_) { out.sli_30d = null; }
  res.json(out);
});

  return router;
};
