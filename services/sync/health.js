'use strict';
// Step 1 (SDP-DASH-2.0) — health of the scheduled jobs (pure). One status per job:
//   running · error (last run failed) · stale (no successful run within its freshness window)
//   · idle (config-gated: the job ran but skipped, e.g. integration not configured)
//   · never (no trace at all) · ok.
// Jobs that predate the runner also have a sync_metadata row (requests, change_cab, survey,
// assets_*): its last_sync_at counts as a successful run, so the history is not lost on day 1.

/** Any date shape we store → epoch ms, or null. sqlite datetime('now') has no zone: it is UTC. */
function toMs(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  let s = String(v).trim();
  // eslint-disable-next-line security/detect-unsafe-regex -- reviewed (step 4): anchored, fixed-width fields
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function _iso(ms) { return ms == null ? null : new Date(ms).toISOString(); }

function computeHealth({ jobs = [], states = [], metadata = [], running = [], nowMs = Date.now() }) {
  const st = new Map(states.map(s => [s.job_key, s]));
  const meta = new Map(metadata.map(m => [m.job_name, m]));
  const live = new Set(running);
  const out = jobs.map(job => {
    const s = st.get(job.key) || null;
    const metas = (job.metadataKeys || []).map(k => meta.get(k)).filter(Boolean);
    let lastOk = toMs(s && s.last_ok_at);
    for (const m of metas) { const t = toMs(m.last_sync_at); if (t != null && (lastOk == null || t > lastOk)) lastOk = t; }
    const lastRun = toMs(s && s.last_run_at);
    const skipped = s && s.last_status === 'skipped';
    // A config-gated skip is activity too: the scheduler is alive, the job has nothing to do.
    const lastActivity = Math.max(lastOk == null ? -Infinity : lastOk, skipped && lastRun != null ? lastRun : -Infinity);
    const age = Number.isFinite(lastActivity) ? Math.round((nowMs - lastActivity) / 60000) : null;
    const metaErr = metas.find(m => m.last_error);
    let status;
    if (live.has(job.key)) status = 'running';
    else if (s && s.last_status === 'error') status = 'error';
    else if (!s && metaErr && (toMs(metaErr.last_error_at) || 0) > (lastOk || 0)) status = 'error';
    else if (age == null) status = 'never';
    else if (age > job.freshnessMinutes) status = 'stale';
    else if (skipped && lastOk == null) status = 'idle';
    else if (skipped && (lastRun || 0) > (lastOk || 0)) status = 'idle';
    else status = 'ok';
    return {
      key: job.key, label: job.label, group: job.group, cron: job.cron || null,
      freshness_minutes: job.freshnessMinutes, status,
      last_run_at: _iso(lastRun), last_ok_at: _iso(lastOk), age_minutes: age,
      last_status: s ? s.last_status : null,
      last_error: (s && s.last_error) || (status === 'error' && metaErr ? metaErr.last_error : null),
      consecutive_failures: s ? Number(s.consecutive_failures) || 0 : 0,
      alerted: !!(s && (s.failure_alerted_at || s.stale_alerted_at)),
    };
  });
  const summary = { total: out.length };
  for (const k of ['ok', 'running', 'idle', 'stale', 'error', 'never']) summary[k] = out.filter(j => j.status === k).length;
  return { jobs: out, summary, server_time: _iso(nowMs) };
}

module.exports = { computeHealth, toMs };
