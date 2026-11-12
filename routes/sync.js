'use strict';
const { fail } = require('../services/httpError');
// SDP360 — sync observability routes (Phase 1 Foundation & Sync).
//   GET /api/sync/runs?job=&limit=   last runs of the generic runner (session-guarded)
//   GET /api/sync/health             per-job last ok / last error / error count / content drift (E-D04)
//                                    + `delivery`: failed report sends / publish runs, last ?delivery_days (E-R04)
// DI factory like routes/teamsSla.js: server.js passes { express, requireReportSession }.
// The legacy GET /api/sync/status (sync_metadata) stays as is; this is the run-level view.
module.exports = function syncRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const sync = deps.sync || require('../services/sync');

  router.get('/api/sync/runs', requireReportSession, async (req, res) => {
    try {
      await sync.ensureReady();
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
      const job = req.query.job ? String(req.query.job).slice(0, 64) : null;
      const rows = await sync.getStore().recentRuns(job, limit);
      res.json({ ok: true, runs: rows.map((r) => ({ ...r, meta: safeJson(r.meta) })) });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  // One health view (Step 1): runner runs (sync_runs) merged with the legacy sync_metadata rows
  // (jobs that ran before the registry existed), labelled against the declared freshness window.
  //   status: ok | stale | error | idle (optional job that never ran) | never
  //           | not_configured (optional job whose newest run was a skip) | skipped (mandatory job, same)
  //   F-ARCH-01 / F-DATA-01: a skip is not a collection — last_ok stays the last real collection, never the skip.
  router.get('/api/sync/health', requireReportSession, async (req, res) => {
    try {
      await sync.ensureReady();
      const { FRESHNESS_HOURS, OPTIONAL, LEGACY_NAMES } = require('../services/sync/jobs');
      const rows = await sync.getStore().health();
      const now = Date.now();
      const byJob = new Map();
      for (const r of rows) byJob.set(r.job, { job: r.job, last_ok: r.last_ok || null, last_error: r.last_error || null, errors: Number(r.errors) || 0, last_skipped: r.last_skipped || null, skip_reason: r.skip_reason || null, source: 'runner' });
      // legacy sync_metadata (requests / change_cab / survey / assets_*) → fold into the registry names
      try {
        const rdb = deps.rdb || require('../reports-db');
        const legacy = await rdb.getSyncStatus();
        for (const m of legacy || []) {
          const name = LEGACY_NAMES[m.job_name]; if (!name) continue;
          const cur = byJob.get(name) || { job: name, last_ok: null, last_error: null, errors: 0, last_skipped: null, skip_reason: null, source: 'legacy' };
          if (m.last_sync_at && (!cur.last_ok || Date.parse(m.last_sync_at) > Date.parse(cur.last_ok))) cur.last_ok = new Date(m.last_sync_at + (/[zZ]|[+-]\d\d:?\d\d$/.test(m.last_sync_at) ? '' : 'Z')).toISOString();
          if (m.last_error && !cur.last_error_text) cur.last_error_text = m.last_error;
          byJob.set(name, cur);
        }
      } catch (_) { /* legacy table optional */ }
      for (const name of Object.keys(FRESHNESS_HOURS)) if (!byJob.has(name)) byJob.set(name, { job: name, last_ok: null, last_error: null, errors: 0, last_skipped: null, skip_reason: null, source: 'none' });
      // a platform freshness policy (Admin ▸ Governance policies) overrides the declared window, so this page
      // and the publication gate never disagree on "stale" (committee architect P1-3)
      const limits = { ...FRESHNESS_HOURS };
      try { const GP = require('../services/governancePolicy'); const pol = await GP.forContext({}); for (const [m, job] of GP.FRESHNESS_SOURCES) { const v = Number(pol[`freshness.${m}_hours`]); if (Number.isFinite(v) && v > 0) limits[job] = v; } } catch (_) { /* policy store unreadable → declared windows */ }
      // E-D04 — content drift per job (observation; never blocks a sync). Unreadable config = proposed thresholds.
      let drift = {};
      try {
        const DRIFT = require('../services/sync/drift'); const store = sync.getStore();
        let cfg = {}; try { cfg = await require('../services/reportConfig').getConfig((deps.rdb || require('../reports-db')).db); } catch (_) { cfg = {}; }
        if (typeof store.recentOkRuns === 'function') drift = await DRIFT.driftForJobs(store, Array.from(byJob.keys()), cfg);
      } catch (_) { drift = {}; }
      const jobs = Array.from(byJob.values()).map((j) => {
        const hours = limits[j.job] || null;
        const ageH = j.last_ok ? (now - Date.parse(j.last_ok)) / 36e5 : null;
        const tOk = j.last_ok ? Date.parse(j.last_ok) : -Infinity;
        const tErr = j.last_error ? Date.parse(j.last_error) : -Infinity;
        const tSkip = j.last_skipped ? Date.parse(j.last_skipped) : -Infinity;
        let status = 'ok';
        if (tErr > tOk && tErr >= tSkip) status = 'error';                                  // newest run failed
        else if (tSkip > tOk) status = OPTIONAL.has(j.job) ? 'not_configured' : 'skipped';  // newest run did not collect
        else if (!j.last_ok) status = OPTIONAL.has(j.job) ? 'idle' : 'never';
        else if (hours && ageH > hours) status = 'stale';
        return { ...j, freshness_hours: hours, optional: OPTIONAL.has(j.job), stale_hours: ageH == null ? null : Math.round(ageH), status,
          drift: drift[j.job] || { status: 'unknown', reason: 'not computed', flags: [], runs_considered: 0 } };
      }).sort((a, b) => a.job.localeCompare(b.job));
      const summary = { ok: jobs.filter((j) => j.status === 'ok').length, stale: jobs.filter((j) => j.status === 'stale').length, error: jobs.filter((j) => j.status === 'error').length, never: jobs.filter((j) => j.status === 'never').length, idle: jobs.filter((j) => j.status === 'idle').length,
        not_configured: jobs.filter((j) => j.status === 'not_configured').length, skipped: jobs.filter((j) => j.status === 'skipped').length };
      // E-R04 — report-delivery failures, read-only (no retry here; resending stays the explicit force action)
      let delivery = null;
      try { delivery = await require('../services/deliveryFailures').loadDeliveryFailures((deps.rdb || require('../reports-db')).pgHandle(), { days: req.query.delivery_days }); }
      catch (_) { delivery = { window_days: null, total: null, by_kind: {}, failures: [], errors: ['unreadable'] }; }
      res.json({ ok: true, summary, jobs, delivery });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  function safeJson(s) { if (s == null) return null; try { return JSON.parse(s); } catch (_) { return s; } }
  return router;
};
