'use strict';
// Step 1 (SDP-DASH-2.0) — binds the job registry to cron, plus the runner's own housekeeping:
// an hourly staleness sweep (:07) and a nightly purge of the run log (03:40).
// Retention: SYNC_RUN_RETENTION_DAYS (default 30). Nothing here throws.

function start({ runner, cron, loadMetadata, store, env = process.env }) {
  const meta = async () => { try { return (await loadMetadata()) || []; } catch (e) { return []; } };
  const bound = [];
  for (const job of runner.jobs()) {
    if (!job.cron) continue;
    cron.schedule(job.cron, () => { runner.run(job.key, { trigger: 'cron' }).catch(() => {}); });
    bound.push(job.key);
  }
  cron.schedule('7 * * * *', () => {
    meta().then(m => runner.sweep({ metadata: m }))
      .catch(e => console.error('[sync-sweep]', e && e.message));
  });
  const days = Number(env.SYNC_RUN_RETENTION_DAYS) > 0 ? Number(env.SYNC_RUN_RETENTION_DAYS) : 30;
  cron.schedule('40 3 * * *', () => {
    Promise.resolve().then(() => store.purge(days))
      .catch(e => console.error('[sync-purge]', e && e.message));
  });
  console.log(`[sync] runner scheduled ${bound.length} job(s) — health at /api/sync/health`);
  return bound;
}

module.exports = { start };
