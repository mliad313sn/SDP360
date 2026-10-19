'use strict';
// Step 1 — the single registry of scheduled jobs. Every job the platform runs on a timer is
// declared HERE (name, cron, freshness window, how to run it) and executed through the shared
// runner (services/sync/syncRunner.js), so each one gets the same lock / retry / run log /
// failure event, and /api/sync/health can say "stale" from the declared freshness window
// instead of guessing.
//
// Two shapes of job:
//   • native   — { fetch, apply, key } exactly as the runner expects (rows flow through the
//                empty guard and dedup);
//   • legacy   — an existing function (syncRequestData, syncAllAssets, Meraki/OpManager mains,
//                poll-sla.run …) wrapped by legacyJob(): it still does its own fetch+apply, but
//                it now runs under the lock, is retried on transient errors, and is recorded.
//                The empty-fetch guard is OFF for wrappers (there are no raw rows to count);
//                the Zoho jobs carry their own truncation guard (zoho-sync.js assertNotTruncated).
//
// Pure: nothing here touches a DB or a scheduler. schedule.js binds the registry to node-cron,
// routes/sync.js reads FRESHNESS to label health.

/**
 * Wrap a legacy "do everything" function as a runner job.
 * @param {string} name
 * @param {function} fn   async (ctx) => summary — may return anything; a thrown error fails the run
 * @param {object} [o]
 * @param {number} [o.maxAttempts]
 * @param {function} [o.rowsOf]  summary => number of rows written (for the run log)
 */
function legacyJob(name, fn, o = {}) {
  return {
    name,
    opts: { emptyGuard: false, maxAttempts: o.maxAttempts || 3, ...(o.opts || {}) },
    async fetch({ attempt }) {
      const summary = await fn({ attempt });
      // A legacy function that reports an error in its result (poll-sla.run does) is a failure.
      if (summary && summary.error && !summary.ok) {
        const e = new Error(String(summary.error));
        e.transient = summary.transient === true;
        throw e;
      }
      const n = typeof o.rowsOf === 'function' ? o.rowsOf(summary) : rowsOf(summary);
      return { rows: n > 0 ? new Array(n).fill(0).map((_, i) => ({ i })) : [], nextWatermark: new Date().toISOString(), summary };
    },
    async apply({ rows, fetched }) {
      const s = fetched && fetched.summary;
      return { upserted: rows.length, deleted: Number(s && (s.deleted || s.removed)) || 0 };
    },
    key: 'i',
  };
}

// Best-effort row count from the heterogeneous legacy summaries.
function rowsOf(s) {
  if (s == null) return 0;
  if (typeof s === 'number') return s;
  if (Array.isArray(s)) return s.reduce((a, x) => a + (Number(x && x.rows) || 0), 0); // assets: [{name, rows}|{name,error}]
  for (const k of ['upserted', 'rows', 'written', 'upserts', 'snapshots', 'count', 'alerts', 'outages']) {
    if (Number.isFinite(Number(s[k]))) return Number(s[k]);
  }
  return 0;
}

/**
 * Build the job list from the server's dependencies. Each entry:
 *   { name, cron, freshnessHours, job }  — `job` is what runner.run() takes.
 * freshnessHours = how old the last successful run may be before health says "stale".
 * @param {object} d  { sync (zoho-sync), assets (assets-sync), tools:{...}, fetchView, afterRequests }
 */
function buildJobs(d) {
  const t = d.tools || {};
  const req = (p) => (t[p] || require(`../../tools/${p}`));
  const list = [
    { name: 'zoho.requests',   cron: '45 * * * *', freshnessHours: 3,
      job: legacyJob('zoho.requests', async () => { const r = await d.sync.syncRequestData(); if (d.afterRequests) await d.afterRequests(r); return r; }) },
    { name: 'zoho.change_cab', cron: '30 * * * *', freshnessHours: 3,
      job: legacyJob('zoho.change_cab', () => d.sync.syncChangeCab()) },
    { name: 'zoho.survey',     cron: '0 * * * *',  freshnessHours: 3,
      job: legacyJob('zoho.survey', () => d.sync.syncSurveyData()) },
    { name: 'assets.sync',     cron: '30 4 * * *', freshnessHours: 30,
      job: legacyJob('assets.sync', async () => {
        const summary = await d.assets.syncAllAssets();
        await d.assets.afterAssetsSync(summary, { sendAlerts: true });
        const failed = (summary || []).filter((v) => v && v.error);
        if (failed.length) { const e = new Error(`assets views failed: ${failed.map((v) => `${v.name}: ${v.error}`).join('; ')}`); e.transient = true; throw e; }
        return summary;
      }) },
    { name: 'meridian.resources', cron: '0 5 * * *', freshnessHours: 30, optional: true,
      job: legacyJob('meridian.resources', () => req('meridian/sync-resources').main()) },
    { name: 'opmanager.availability', cron: '10 5 * * *', freshnessHours: 30, optional: true,
      job: legacyJob('opmanager.availability', () => req('opmanager/sync-availability').main({ fetchView: d.fetchView })) },
    { name: 'meraki.wan',      cron: '20 5 * * *', freshnessHours: 30, optional: true,
      job: legacyJob('meraki.wan', () => req('meraki/sync-wan').main({})) },
    { name: 'meraki.wan_events', cron: '25 5 * * *', freshnessHours: 30, optional: true,
      job: legacyJob('meraki.wan_events', () => req('meraki/sync-wan-events').main({})) },
    { name: 'meraki.wan_events_5m', cron: '*/5 * * * *', freshnessHours: 1, optional: true,
      job: legacyJob('meraki.wan_events_5m', () => req('meraki/sync-wan-events').main({ since: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }), { maxAttempts: 2 }) },
    { name: 'meraki.wan_poller', cron: '*/5 * * * *', freshnessHours: 1, optional: true,
      job: legacyJob('meraki.wan_poller', () => req('meraki/poll-wan-outages').main({}), { maxAttempts: 2 }) },
    { name: 'teams.sla_poll',  cron: '*/5 * * * *', freshnessHours: 1, optional: true,
      job: legacyJob('teams.sla_poll', () => req('teams/poll-sla').run({}), { maxAttempts: 2 }) },
  ];
  if (d.backup) list.push({ name: 'db.backup', cron: d.backup.cron || '0 2 * * *', freshnessHours: 30, job: legacyJob('db.backup', () => d.backup.run()) });
  return list;
}

// Declared freshness per job — read by routes/sync.js without needing the live deps.
const FRESHNESS_HOURS = {
  'zoho.requests': 3, 'zoho.change_cab': 3, 'zoho.survey': 3, 'assets.sync': 30,
  'meridian.resources': 30, 'opmanager.availability': 30, 'meraki.wan': 30, 'meraki.wan_events': 30,
  'meraki.wan_events_5m': 1, 'meraki.wan_poller': 1, 'teams.sla_poll': 1, 'db.backup': 30,
};
// Jobs that self-skip until configured (no API key / webhook) — never reported "stale", only "idle".
const OPTIONAL = new Set(['meridian.resources', 'opmanager.availability', 'meraki.wan', 'meraki.wan_events', 'meraki.wan_events_5m', 'meraki.wan_poller', 'teams.sla_poll']);

// Map the legacy sync_metadata job names onto the registry names (one health view, D7).
const LEGACY_NAMES = { requests: 'zoho.requests', change_cab: 'zoho.change_cab', survey: 'zoho.survey',
  assets_assets: 'assets.sync', assets_memory: 'assets.sync', assets_logical_drives: 'assets.sync', assets_monitors: 'assets.sync', assets_software_licenses: 'assets.sync', assets_software: 'assets.sync' };

module.exports = { legacyJob, buildJobs, rowsOf, FRESHNESS_HOURS, OPTIONAL, LEGACY_NAMES };
