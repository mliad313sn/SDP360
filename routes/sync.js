'use strict';
const { fail } = require('../services/httpError');
// SDP360 — sync observability routes (Phase 1 Foundation & Sync).
//   GET /api/sync/runs?job=&limit=   last runs of the generic runner (session-guarded)
//   GET /api/sync/health             per-job last ok / last error / error count
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
  //   status: ok | stale | error | idle (optional job never configured) | never
  router.get('/api/sync/health', requireReportSession, async (req, res) => {
    try {
      await sync.ensureReady();
      const { FRESHNESS_HOURS, OPTIONAL, LEGACY_NAMES } = require('../services/sync/jobs');
      const rows = await sync.getStore().health();
      const now = Date.now();
      const byJob = new Map();
      for (const r of rows) byJob.set(r.job, { job: r.job, last_ok: r.last_ok || null, last_error: r.last_error || null, errors: Number(r.errors) || 0, source: 'runner' });
      // legacy sync_metadata (requests / change_cab / survey / assets_*) → fold into the registry names
      try {
        const rdb = deps.rdb || require('../reports-db');
        const legacy = await rdb.getSyncStatus();
        for (const m of legacy || []) {
          const name = LEGACY_NAMES[m.job_name]; if (!name) continue;
          const cur = byJob.get(name) || { job: name, last_ok: null, last_error: null, errors: 0, source: 'legacy' };
          if (m.last_sync_at && (!cur.last_ok || Date.parse(m.last_sync_at) > Date.parse(cur.last_ok))) cur.last_ok = new Date(m.last_sync_at + (/[zZ]|[+-]\d\d:?\d\d$/.test(m.last_sync_at) ? '' : 'Z')).toISOString();
          if (m.last_error && !cur.last_error_text) cur.last_error_text = m.last_error;
          byJob.set(name, cur);
        }
      } catch (_) { /* legacy table optional */ }
      for (const name of Object.keys(FRESHNESS_HOURS)) if (!byJob.has(name)) byJob.set(name, { job: name, last_ok: null, last_error: null, errors: 0, source: 'none' });
      // a platform freshness policy (Admin ▸ Governance policies) overrides the declared window, so this page
      // and the publication gate never disagree on "stale" (committee architect P1-3)
      const limits = { ...FRESHNESS_HOURS };
      try { const GP = require('../services/governancePolicy'); const pol = await GP.forContext({}); for (const [m, job] of GP.FRESHNESS_SOURCES) { const v = Number(pol[`freshness.${m}_hours`]); if (Number.isFinite(v) && v > 0) limits[job] = v; } } catch (_) { /* policy store unreadable → declared windows */ }
      const jobs = Array.from(byJob.values()).map((j) => {
        const hours = limits[j.job] || null;
        const ageH = j.last_ok ? (now - Date.parse(j.last_ok)) / 36e5 : null;
        let status = 'ok';
        if (!j.last_ok) status = OPTIONAL.has(j.job) ? 'idle' : 'never';
        else if (j.last_error && Date.parse(j.last_error) > Date.parse(j.last_ok)) status = 'error';
        else if (hours && ageH > hours) status = 'stale';
        return { ...j, freshness_hours: hours, optional: OPTIONAL.has(j.job), stale_hours: ageH == null ? null : Math.round(ageH), status };
      }).sort((a, b) => a.job.localeCompare(b.job));
      const summary = { ok: jobs.filter((j) => j.status === 'ok').length, stale: jobs.filter((j) => j.status === 'stale').length, error: jobs.filter((j) => j.status === 'error').length, never: jobs.filter((j) => j.status === 'never').length, idle: jobs.filter((j) => j.status === 'idle').length };
      res.json({ ok: true, summary, jobs });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  function safeJson(s) { if (s == null) return null; try { return JSON.parse(s); } catch (_) { return s; } }
  return router;
};
