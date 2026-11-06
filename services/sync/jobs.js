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
      // G05 — a configured source that answers with nothing is a failed sync, not a fresh one: freshness then
      // turns STALE and the KPIs fed by it lose their colour instead of showing yesterday's numbers as new.
      if (o.failOnZero && n === 0 && summary && !summary.skipped) { const e = new Error('source returned no rows'); e.transient = true; throw e; }
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
      job: legacyJob('opmanager.availability', () => req('opmanager/sync-availability').main({ fetchView: d.fetchView }), { failOnZero: true, rowsOf: (x) => Number((x && (x.rows ?? x.devices)) || 0) }) },
    { name: 'meraki.wan',      cron: '20 5 * * *', freshnessHours: 30, optional: true,
      job: legacyJob('meraki.wan', () => req('meraki/sync-wan').main({}), { failOnZero: true }) },
    { name: 'meraki.wan_events', cron: '25 5 * * *', freshnessHours: 30, optional: true,
      job: legacyJob('meraki.wan_events', () => req('meraki/sync-wan-events').main({})) },
    { name: 'meraki.wan_events_5m', cron: '*/5 * * * *', freshnessHours: 1, optional: true,
      job: legacyJob('meraki.wan_events_5m', () => req('meraki/sync-wan-events').main({ since: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }), { maxAttempts: 2 }) },
    { name: 'meraki.wan_poller', cron: '*/5 * * * *', freshnessHours: 1, optional: true,
      job: legacyJob('meraki.wan_poller', () => req('meraki/poll-wan-outages').main({}), { maxAttempts: 2 }) },
    { name: 'teams.sla_poll',  cron: '*/5 * * * *', freshnessHours: 1, optional: true,
      job: legacyJob('teams.sla_poll', () => req('teams/poll-sla').run({}), { maxAttempts: 2 }) },
  ];
  // Nightly PostgreSQL dump (Step 2, hardened by E11: trailer-verified, gzip, AES-256-GCM with
  // SDP_BACKUP_KEY, off-site copy to report_config.backup_offsite_path). 03:00 — the time
  // docs/ops/EXPLOITATION.md §3 announces; keep both in step. Optional: self-skips without PG_URL.
  // Directory from SDP_BACKUP_DIR (default <data>/backups), retention SDP_BACKUP_KEEP (default 14).
  const backupDir = () => process.env.SDP_BACKUP_DIR || require('path').join(process.env.SDP_DATA_DIR || require('path').join(__dirname, '..', '..', 'data'), 'backups');
  const offsitePath = async () => {
    try { const rdb = d.rdb || require('../../reports-db'); const cfg = await require('../reportConfig').getConfig(rdb.db); return (cfg && cfg.backup_offsite_path) || ''; }
    catch (_) { return ''; }
  };
  const backup = d.backup || {
    cron: '0 3 * * *',
    run: async () => require('../backup').runBackup({ dir: backupDir(), keep: Number(process.env.SDP_BACKUP_KEEP) || 14, offsitePath: await offsitePath() }),
  };
  list.push({ name: 'db.backup', cron: backup.cron || '0 3 * * *', freshnessHours: 30, optional: true, job: legacyJob('db.backup', () => backup.run()) });
  // E11 — monthly restore drill (1st at 04:00): fresh dump → restore into a disposable target →
  // row counts compared with the live database → dated report + system_log 'restore_drill'.
  // A mismatch is a failed run (alerted like any job). Optional: self-skips without PG_URL.
  const drillRun = d.restoreDrill || (async () => {
    if (!process.env.PG_URL && !process.env.DATABASE_URL) return { skipped: true, reason: 'no PG_URL' };
    const rdb = d.rdb || require('../../reports-db');
    return require('../../tools/pg/restore-drill').run({ dir: backupDir(), backupFirst: true, offsitePath: await offsitePath(), logEvent: rdb.logEvent });
  });
  list.push({ name: 'db.restore_drill', cron: '0 4 1 * *', freshnessHours: 24 * 33, optional: true, job: legacyJob('db.restore_drill', () => drillRun(), { maxAttempts: 1 }) });
  // Step 4 — audit retention: system_log kept 12 months (risk events 24). Mandatory job.
  list.push({ name: 'audit.retention', cron: '30 3 * * *', freshnessHours: 30,
    job: legacyJob('audit.retention', async () => { const rdb = d.rdb || require('../../reports-db'); const r = await rdb.purgeSystemLog({ months: Number(process.env.AUDIT_RETENTION_MONTHS) || 12 }); return { deleted: r.deleted, rows: r.deleted }; }) });
  // Committee review 2026-10-28 — verify the hash-chained audit tables and log the chain heads (daily anchor).
  // A broken chain is a failed run (alerted like any job) and a risk event.
  list.push({ name: 'audit.chain_verify', cron: '45 3 * * *', freshnessHours: 30,
    job: legacyJob('audit.chain_verify', async () => {
      const rdb = d.rdb || require('../../reports-db'); const r = await require('../auditChain').verify(rdb.pgHandle ? rdb.pgHandle() : rdb.db);
      await rdb.logEvent({ category: 'governance', action: r.ok ? 'audit_chain_anchor' : 'audit_chain_broken', target: 'audit', details: { tables: r.tables.map((x) => ({ table: x.table, rows: x.rows, ok: x.ok, head: x.head, first_broken_id: x.first_broken_id })) }, risk: r.ok ? 0 : 1 });
      if (!r.ok) throw new Error('audit chain broken: ' + r.tables.filter((x) => x.ok === false).map((x) => `${x.table}#${x.first_broken_id}`).join(', '));
      return { rows: r.tables.reduce((n, x) => n + (x.rows || 0), 0) };
    }, { maxAttempts: 1 }) });
  // Step 9 — engagement + publishing through the same runner (d.engagement = { evaluate, digest, reports, publish } injected by server.js).
  const eng = d.engagement || null;
  list.push({ name: 'engagement.alerts', cron: '*/15 * * * *', freshnessHours: 1, optional: true, job: legacyJob('engagement.alerts', () => eng ? eng.evaluate() : { skipped: true }, { maxAttempts: 2 }) });
  list.push({ name: 'engagement.digest', cron: '0 7 * * *', freshnessHours: 30, optional: true, job: legacyJob('engagement.digest', () => eng ? eng.digest('daily') : { skipped: true }) });
  list.push({ name: 'engagement.digest_weekly', cron: '15 7 * * 1', freshnessHours: 24 * 8, optional: true, job: legacyJob('engagement.digest_weekly', () => eng ? eng.digest('weekly') : { skipped: true }) });
  list.push({ name: 'reports.weekly', cron: '30 6 * * 1', freshnessHours: 24 * 8, optional: true, job: legacyJob('reports.weekly', () => eng ? eng.reports('weekly') : { skipped: true }) });
  list.push({ name: 'reports.monthly', cron: '45 6 1 * *', freshnessHours: 24 * 32, optional: true, job: legacyJob('reports.monthly', () => eng ? eng.reports('monthly') : { skipped: true }) });
  list.push({ name: 'publish.connectors', cron: '0 6 * * *', freshnessHours: 30, optional: true, job: legacyJob('publish.connectors', () => eng ? eng.publish() : { skipped: true }) });
  // Step 10 — field outbox hygiene: ledger rows > 90 days and abandoned chunk uploads > 48 h (d.field = store, lazy).
  const fld = d.field || null;
  list.push({ name: 'field.purge', cron: '0 3 * * *', freshnessHours: 30, optional: true, job: legacyJob('field.purge', async () => fld ? { outbox: await fld.purgeOutbox({ days: 90 }), uploads: await fld.purgeUploads({ hours: 48 }) } : { skipped: true }) });
  // A-19 — soft-delete purge: hard-deletes rows stamped deleted longer than soft_delete_retention_days (+ inspection
  // blobs). Self-skips unless report_config soft_delete_purge_enabled = '1' (default '0' — PROPOSED policy, armed off).
  list.push({ name: 'softdelete.purge', cron: '40 3 * * *', freshnessHours: 30, optional: true, job: legacyJob('softdelete.purge', () => softDeletePurgeRun(d), { maxAttempts: 1 }) });
  // G-18 — A01 / A02 escalation ledger. d.commitments.escalate self-skips while commitments_enabled != '1'.
  const cmt = d.commitments || null;
  const ho = d.handoffs || null;
  list.push({ name: 'handoffs.escalate', cron: '35 * * * *', freshnessHours: 3, optional: true, job: legacyJob('handoffs.escalate', () => ho ? ho.escalate() : { skipped: true }, { maxAttempts: 2 }) });
  list.push({ name: 'commitments.escalate', cron: '20 * * * *', freshnessHours: 3, optional: true, job: legacyJob('commitments.escalate', () => cmt ? cmt.escalate() : { skipped: true }, { maxAttempts: 2 }) });
  // A-27 — catalogue A11 PPM exceptions, nightly. A dry run (records nothing) while ppm_alerts_enabled != '1'.
  list.push({ name: 'governance.ppm_alerts', cron: '40 5 * * *', freshnessHours: 30, optional: true, job: legacyJob('governance.ppm_alerts', () => req('governance/ppm-alerts').run({}), { maxAttempts: 1 }) });
  // C-18 — access grants: end expired grants / activate approved requests whose day has come. Self-skips unless
  // report_config access_grant_expiry_job = '1' (default '0' — no grant expires by itself today).
  // C-22 — emergency access ends at its hour (≤ 24 h). Self-skips unless emergency_access_enabled = '1'.
  list.push({ name: 'access.emergency_expiry', cron: '*/10 * * * *', freshnessHours: 3, optional: true, job: legacyJob('access.emergency_expiry', () => accessEmergencyExpiryRun(d), { maxAttempts: 1 }) });
  // E-S04 — Entra leavers (nightly, dry run first). Self-skips unless entra_deprovision_enabled = '1' AND SSO is ready;
  // no Graph call at all otherwise. Deactivates only when entra_deprovision_apply = '1'.
  list.push({ name: 'access.entra_deprovision', cron: '55 3 * * *', freshnessHours: 30, optional: true, job: legacyJob('access.entra_deprovision', () => entraDeprovisionRun(d), { maxAttempts: 1, rowsOf: (x) => Number((x && x.accounts) || 0) }) });
  list.push({ name: 'access.grant_expiry', cron: '50 3 * * *', freshnessHours: 30, optional: true, job: legacyJob('access.grant_expiry', () => accessGrantExpiryRun(d), { maxAttempts: 1 }) });
  return list;
}

/** C-18 — the access.grant_expiry body (exported for tests): skipped unless armed, else run the store's expiry pass. */
async function accessGrantExpiryRun(d = {}) {
  const rdb = d.rdb || require('../../reports-db');
  const cfg = d.cfg || await require('../reportConfig').getConfig(rdb.db);
  if (String((cfg && cfg.access_grant_expiry_job) || '0') !== '1') return { skipped: true, reason: 'access_grant_expiry_job is 0' };
  const store = d.accessStore || require('../accessStore').forRdb(rdb);
  return store.runExpiry({ actorId: null });
}

/** E-S04 — the access.entra_deprovision body (exported for tests). */
async function entraDeprovisionRun(d = {}) {
  const out = await (d.entraDeprovision || require('../entraDeprovision')).run({ rdb: d.rdb, cfg: d.cfg });
  if (out && !out.skipped) {
    const rdb = d.rdb || require('../../reports-db');
    try { rdb.logEvent({ category: 'identity', action: 'entra_deprovision_run', actor: 'system', target: 'access.entra_deprovision',
      details: { status: out.status, dry_run: out.dry_run, accounts: out.accounts, would_deactivate: out.would_deactivate || 0, deactivated: out.deactivated } }); } catch (_) { /* never blocks */ }
  }
  return out;
}

/** C-22 — the access.emergency_expiry body (exported for tests): skipped unless enabled. */
async function accessEmergencyExpiryRun(d = {}) {
  const rdb = d.rdb || require('../../reports-db');
  const cfg = d.cfg || await require('../reportConfig').getConfig(rdb.db);
  if (String((cfg && cfg.emergency_access_enabled) || '0') !== '1') return { skipped: true, reason: 'emergency_access_enabled is 0' };
  const store = d.emergencyStore || require('../emergencyAccessStore').forRdb(rdb);
  return store.expireDue({ actorId: null });
}

/** A-19 — the softdelete.purge body (exported for the registry test): skipped unless armed, else purge + log counts. */
async function softDeletePurgeRun(d = {}) {
  const rdb = d.rdb || require('../../reports-db');
  const softDelete = require('../softDelete');
  const cfg = d.cfg || await softDelete.readConfig(rdb);
  if (!softDelete.purgeEnabled(cfg)) return { skipped: true, reason: 'soft_delete_purge_enabled is 0' };
  const out = await (d.softDeleteOps || require('../softDeleteOps')).purge({ apply: true, cfg });
  const counts = Object.fromEntries(Object.entries(out.modules).map(([k, v]) => [k, v.purged]));
  const rows = Object.values(counts).reduce((n, x) => n + x, 0);
  for (const [mod, n] of Object.entries(counts)) if (n > 0) rdb.logEvent({ category: mod, action: `${mod}_purged`, target: 'softdelete.purge', details: { purged: n, cutoff: out.cutoff, retention_days: out.retention_days } });
  const skipped = Object.values(out.modules).flatMap((v) => v.skipped || []);   // e.g. A-27 baselined projects (append-only)
  if (skipped.length) rdb.logEvent({ category: 'portfolio', action: 'portfolio_purge_skipped', target: 'softdelete.purge', details: { skipped } });
  return { rows, purged: counts, skipped, cutoff: out.cutoff };
}

// Declared freshness per job — read by routes/sync.js without needing the live deps.
const FRESHNESS_HOURS = {
  'zoho.requests': 3, 'zoho.change_cab': 3, 'zoho.survey': 3, 'assets.sync': 30,
  'meridian.resources': 30, 'opmanager.availability': 30, 'meraki.wan': 30, 'meraki.wan_events': 30,
  'meraki.wan_events_5m': 1, 'meraki.wan_poller': 1, 'teams.sla_poll': 1, 'db.backup': 30, 'db.restore_drill': 24 * 33, 'audit.retention': 30, 'audit.chain_verify': 30,
  'engagement.alerts': 1, 'engagement.digest': 30, 'engagement.digest_weekly': 24 * 8, 'reports.weekly': 24 * 8, 'reports.monthly': 24 * 32, 'publish.connectors': 30, 'field.purge': 30, 'softdelete.purge': 30,
  'commitments.escalate': 3, 'handoffs.escalate': 3, 'governance.ppm_alerts': 30, 'access.grant_expiry': 30, 'access.emergency_expiry': 3, 'access.entra_deprovision': 30,
};
// Jobs that self-skip until configured (no API key / webhook) — never reported "stale", only "idle".
const OPTIONAL = new Set(['meridian.resources', 'opmanager.availability', 'meraki.wan', 'meraki.wan_events', 'meraki.wan_events_5m', 'meraki.wan_poller', 'teams.sla_poll', 'db.backup', 'db.restore_drill',
  'engagement.alerts', 'engagement.digest', 'engagement.digest_weekly', 'reports.weekly', 'reports.monthly', 'publish.connectors', 'field.purge', 'softdelete.purge', 'commitments.escalate', 'handoffs.escalate', 'governance.ppm_alerts', 'access.grant_expiry', 'access.emergency_expiry', 'access.entra_deprovision']);

// Map the legacy sync_metadata job names onto the registry names (one health view, D7).
const LEGACY_NAMES = { requests: 'zoho.requests', change_cab: 'zoho.change_cab', survey: 'zoho.survey',
  assets_assets: 'assets.sync', assets_memory: 'assets.sync', assets_logical_drives: 'assets.sync', assets_monitors: 'assets.sync', assets_software_licenses: 'assets.sync', assets_software: 'assets.sync' };

module.exports = { legacyJob, buildJobs, rowsOf, FRESHNESS_HOURS, OPTIONAL, LEGACY_NAMES, softDeletePurgeRun, accessGrantExpiryRun, accessEmergencyExpiryRun, entraDeprovisionRun };
