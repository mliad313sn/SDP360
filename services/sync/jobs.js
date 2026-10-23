'use strict';
// Step 1 (SDP-DASH-2.0) — the ONE registry of scheduled jobs. Each entry used to be a bare
// cron.schedule(...) line in server.js; the schedules and the work are unchanged, only the
// envelope is new (lock, retries, run log, health, alerts — services/sync/runner.js).
//
// Freshness windows (DEC-2026-003, recommended option): 3 h for hourly jobs, 30 h for nightly
// jobs, 1 h for 5-minute jobs. Retries only apply to transient errors (network, 429, 5xx).
//
// deps (injected by server.js): sync (zoho-sync), fetchView, refreshToken,
// refreshRawCache, clearRawCache.

const HOURLY = 180, NIGHTLY = 1800, FIVE_MIN = 60;

/** Legacy jobs report a partial failure in their result instead of throwing. */
function assetsOutcome(summary) {
  const failed = (Array.isArray(summary) ? summary : []).filter(v => v && v.error);
  if (failed.length) return { error: `${failed.length} asset view(s) failed: ` + failed.map(v => `${v.name} (${v.error})`).join('; ') };
  return { views: (summary || []).length, rows: (summary || []).reduce((n, v) => n + (Number(v.rows) || 0), 0) };
}

function buildJobs(deps) {
  const d = deps || {};
  return [
    { key: 'zoho.token', label: 'Zoho OAuth token refresh', group: 'zoho', cron: '*/50 * * * *',
      freshnessMinutes: HOURLY, retries: 0,
      fn: async () => { await d.refreshToken(); return { refreshed: true }; } },
    { key: 'zoho.requests', label: 'Tickets (requests) + ticket cache', group: 'zoho', cron: '45 * * * *',
      freshnessMinutes: HOURLY, retries: 2, baseDelayMs: 60000, metadataKeys: ['requests'],
      fn: async (ctx) => {
        const r = await d.sync.syncRequestData({ force: !!(ctx && ctx.args && ctx.args.force) });
        if (ctx && ctx.trigger === 'manual' && d.clearRawCache) d.clearRawCache();
        await d.refreshRawCache();
        return r;
      } },
    { key: 'zoho.change_cab', label: 'Changes + CAB approvals', group: 'zoho', cron: '30 * * * *',
      freshnessMinutes: HOURLY, retries: 2, baseDelayMs: 60000, metadataKeys: ['change_cab'],
      fn: () => d.sync.syncChangeCab() },
    { key: 'zoho.survey', label: 'CSAT survey', group: 'zoho', cron: '0 * * * *',
      freshnessMinutes: HOURLY, retries: 2, baseDelayMs: 60000, metadataKeys: ['survey'],
      fn: () => d.sync.syncSurveyData() },
    { key: 'cache.raw_refresh', label: 'Ticket cache refresh', group: 'cache', cron: '20 * * * *',
      freshnessMinutes: HOURLY, retries: 1, baseDelayMs: 60000,
      fn: async () => { await d.refreshRawCache(); return { refreshed: true }; } },
    { key: 'cache.nightly', label: 'Nightly ticket cache reset', group: 'cache', cron: '15 3 * * *',
      freshnessMinutes: NIGHTLY, retries: 0,
      fn: async () => { d.clearRawCache(); await d.refreshRawCache(); return { refreshed: true }; } },
    { key: 'assets.sync', label: 'Assets (AssetExplorer views)', group: 'assets', cron: '30 4 * * *',
      freshnessMinutes: NIGHTLY, retries: 1, baseDelayMs: 120000,
      metadataKeys: ['assets_assets', 'assets_memory', 'assets_logical_drives', 'assets_monitors', 'assets_software_licenses', 'assets_software'],
      fn: async (ctx) => {
        const A = require('../../assets-sync');
        const summary = await A.syncAllAssets();
        await A.afterAssetsSync(summary, { sendAlerts: !(ctx && ctx.trigger === 'manual') });
        return assetsOutcome(summary);
      } },
    { key: 'meridian.resources', label: 'Meridian resource sync', group: 'integrations', cron: '0 5 * * *',
      freshnessMinutes: NIGHTLY, retries: 0,
      fn: () => require('../../tools/meridian/sync-resources').main() },
    { key: 'opmanager.availability', label: 'OpManager availability', group: 'infra', cron: '10 5 * * *',
      freshnessMinutes: NIGHTLY, retries: 1, baseDelayMs: 120000,
      fn: () => require('../../tools/opmanager/sync-availability').main({ fetchView: d.fetchView }) },
    { key: 'meraki.wan', label: 'Meraki WAN quality (weekly / monthly)', group: 'infra', cron: '20 5 * * *',
      freshnessMinutes: NIGHTLY, retries: 1, baseDelayMs: 120000,
      fn: () => require('../../tools/meraki/sync-wan').main({}) },
    { key: 'meraki.wan_events', label: 'Meraki WAN events (3 h lookback)', group: 'infra', cron: '*/5 * * * *',
      freshnessMinutes: FIVE_MIN, retries: 0,
      fn: () => require('../../tools/meraki/sync-wan-events').main({ since: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }) },
    { key: 'meraki.wan_events_nightly', label: 'Meraki WAN events (nightly backfill)', group: 'infra', cron: '25 5 * * *',
      freshnessMinutes: NIGHTLY, retries: 1, baseDelayMs: 120000,
      fn: () => require('../../tools/meraki/sync-wan-events').main({}) },
    { key: 'meraki.wan_poller', label: 'WAN outage poller (ISP SLA)', group: 'infra', cron: '*/5 * * * *',
      freshnessMinutes: FIVE_MIN, retries: 0,
      fn: () => require('../../tools/meraki/poll-wan-outages').main({}) },
    { key: 'db.backup', label: 'Encrypted PostgreSQL backup', group: 'database', cron: '30 2 * * *',
      freshnessMinutes: NIGHTLY, retries: 1, baseDelayMs: 300000,
      fn: () => require('../dbBackup').runBackup() },
    // Step 4 — the security journal is kept 12 months, then purged (expired login-throttle rows too).
    { key: 'audit.retention', label: 'Audit log retention (12 months)', group: 'database', cron: '40 2 * * *',
      freshnessMinutes: NIGHTLY, retries: 1, baseDelayMs: 60000,
      fn: async () => {
        const cut = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
        const purged = await require('../../reports-db').purgeSystemLog(cut);
        await require('../authThrottle').purge({ windowMs: 24 * 3600 * 1000 });
        return { purged, before: cut };
      } },
    // Step 4 — deactivate dashboard accounts whose Entra identity was deleted or disabled (armed off).
    { key: 'entra.deprovision', label: 'Entra departures → account deactivation', group: 'security', cron: '50 2 * * *',
      freshnessMinutes: NIGHTLY, retries: 1, baseDelayMs: 300000,
      fn: async () => {
        const rdb = require('../../reports-db');
        const conf = await require('../reportConfig').getConfig(rdb.db);
        const s = await require('../ssoSettings').resolveSsoSettings(rdb.db);
        const mode = String(conf.sso_deprovision_enabled || '0');   // '0' off · 'preview' dry run · '1' on
        return require('../entraDeprovision').run({ rdb, cfg: s.cfg, enabled: mode !== '0', dryRun: mode === 'preview', logEvent: rdb.logEvent });
      } },
    { key: 'teams.sla', label: 'Teams SLA alerts', group: 'integrations', cron: '*/5 * * * *',
      freshnessMinutes: FIVE_MIN, retries: 0,
      fn: () => require('../../tools/teams/poll-sla').run({}) },
    // Step 7 — parallel run of a migrated tracker: the IT Activity Tracker's entries are copied into it every
    // night and both engines are compared (no migrated tracker in parallel run = nothing to do).
    { key: 'trackers.legacy_mirror', label: 'Tracker migration — nightly copy + comparison', group: 'trackers', cron: '10 6 * * *',
      freshnessMinutes: NIGHTLY, retries: 1, baseDelayMs: 60000,
      fn: () => require('../trackers/service').mirrorAll(require('../../reports-db')) },
    // Step 7 — items of a tracker linked to a dictionary key (meetings, inspections, tickets…).
    { key: 'trackers.sources', label: 'Trackers — items linked to the indicators', group: 'trackers', cron: '20 6 * * *',
      freshnessMinutes: NIGHTLY, retries: 1, baseDelayMs: 60000,
      fn: () => require('../trackers/service').refreshAllSources(require('../../reports-db')) },
  ];
}

module.exports = { buildJobs, assetsOutcome, HOURLY, NIGHTLY, FIVE_MIN };
