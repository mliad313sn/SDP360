'use strict';
// Step 1 — binds the job registry (jobs.js) to node-cron and wires alerting. server.js calls
// start() once at boot instead of declaring ~12 cron lines itself (the "one cron registry"
// of roadmap P1-7). Every schedule goes through runner.run → lock, retry, run log, events.

const { buildJobs, FRESHNESS_HOURS, OPTIONAL } = require('./jobs');
const { createAlerter, emailSender, teamsSender } = require('./alerts');

let _started = null;

/**
 * @param {object} d
 * @param {object} d.cron        node-cron (injected so tests can stub it)
 * @param {object} d.sync        zoho-sync module (initialised)
 * @param {object} d.assets      assets-sync module (initialised)
 * @param {function} d.fetchView
 * @param {function} [d.afterRequests]  called after a successful requests sync (raw-cache rebuild)
 * @param {object} [d.tools]     overrides for the tools/* modules (tests)
 * @param {object} [d.syncModule]  services/sync (getRunner/getStore/ensureReady) — injectable
 * @param {function} [d.getAlertConfig]  async () => { recipients:[], teamsUrl, from, mailer, post }
 */
function start(d) {
  if (_started) return _started;
  const syncMod = d.syncModule || require('./index');
  const jobs = buildJobs(d);
  const byName = new Map(jobs.map((j) => [j.name, j]));

  const alerter = createAlerter({
    store: { // lazy — the store opens on first use
      recentRuns: (...a) => syncMod.getStore().recentRuns(...a),
      getWatermark: (...a) => syncMod.getStore().getWatermark(...a),
      setWatermark: (...a) => syncMod.getStore().setWatermark(...a),
    },
    senders: [async (msg) => {
      const cfg = d.getAlertConfig ? await d.getAlertConfig() : null;
      if (!cfg) return;
      await emailSender({ mailer: cfg.mailer, to: cfg.recipients, from: cfg.from })(msg);
      await teamsSender({ post: cfg.post, url: cfg.teamsUrl })(msg);
    }],
    log: (lvl, m) => console[lvl === 'warn' ? 'warn' : 'log']('[sync-alert]', m),
  });
  syncMod.setEventHook((kind, p) => alerter.onEvent(kind, p).catch((e) => console.warn('[sync-alert]', e.message)));

  async function runJob(name) {
    const entry = byName.get(name);
    if (!entry) throw new Error(`unknown job ${name}`);
    await syncMod.ensureReady();
    return syncMod.getRunner().run(entry.job);
  }

  const tasks = [];
  for (const j of jobs) {
    tasks.push(d.cron.schedule(j.cron, () => runJob(j.name).catch((e) => console.error(`[Cron:${j.name}]`, e && e.message))));
  }
  // Hourly staleness sweep (at :05 — off the job slots).
  tasks.push(d.cron.schedule('5 * * * *', async () => {
    try {
      await syncMod.ensureReady();
      const rows = await syncMod.getStore().health();
      await alerter.checkStale(rows, FRESHNESS_HOURS, OPTIONAL);
    } catch (e) { console.warn('[sync-alert] stale sweep failed:', e.message); }
  }));

  _started = { jobs: jobs.map((j) => ({ name: j.name, cron: j.cron, freshnessHours: j.freshnessHours, optional: !!j.optional })), runJob, alerter, tasks };
  return _started;
}

function status() { return _started; }
function _reset() { _started = null; }

module.exports = { start, status, _reset };
