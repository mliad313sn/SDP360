'use strict';
// G1-SYNC (R8 hole 4) — the manual "sync now" triggers (POST /api/sync/trigger/assets and /:job) go through the
// SAME runner and lease as the scheduled jobs. Before, they called syncAllAssets / syncRequestData directly, so a
// manual run and the cron run of one job could write at the same time. Now:
//   • the lease is taken BEFORE the HTTP answer: 202-style { ok:true } when the run started, 409 with a readable
//     message when a scheduled (or another admin's) run of the same job holds it — nothing is started twice;
//   • the run is recorded in sync_runs like a scheduled one (job name = the scheduled job's name).
const { fail } = require('../httpError');
const { manualTriggerJob, MANUAL_TRIGGERS } = require('./jobs');

/**
 * @param {import('express').Response} res
 * @param {string} name   'assets' | 'requests' | 'change_cab' | 'survey'
 * @param {object} d      { sync, assets, afterRequests } — passed to manualTriggerJob
 * @param {object} [o]    { force }
 * @param {object} [deps] { syncModule } (tests)
 * @returns {Promise<{job:string}|null>} null when an answer was already sent (400 / 409 / 500)
 */
async function startManualSync(res, name, d, o = {}, deps = {}) {
  try {
    const m = manualTriggerJob(name, d, o);
    if (!m) { fail(res, new Error(`Unknown job: ${name}. Valid: ${MANUAL_TRIGGERS.join(', ')}`), 400, { ok: false }); return null; }
    const syncMod = deps.syncModule || require('./index');
    await syncMod.ensureReady();
    const h = await syncMod.getRunner().start(m.job);
    if (!h.started) {
      fail(res, new Error(`A '${name}' sync is already running (the scheduled run or another admin's) — it was not started a second time. Wait for it to finish, then try again; /api/sync/status shows its progress.`),
        409, { ok: false, status: 'skipped', reason: 'overlap', job: m.lockName });
      return null;
    }
    h.done.then((r) => { if (r && r.status !== 'ok') console.error(`[ManualSync:${name}] ${r.status}${r.error ? ': ' + r.error : ''}`); })
      .catch((e) => console.error(`[ManualSync:${name}]`, e && e.message));
    return { job: m.lockName };
  } catch (e) {
    fail(res, e, 500, { ok: false });
    return null;
  }
}

module.exports = { startManualSync };
