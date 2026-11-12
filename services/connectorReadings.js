'use strict';
// P4 / A2 — the readings behind Connector Health (services/connectorHealth.js compose). Each reader is optional:
// one that throws leaves its part UNKNOWN, it never turns into a zero. NO outbound call: everything is read from
// this server's own database (sync run log, report_config presence, snapshot tables) and in-memory token state.
// Reads the sync store only through its existing readers (health / recentRuns) — the write path is untouched.

const CONFIG_KEYS = ['meraki_api_key', 'meraki_org_id', 'opmanager_api_key', 'opmanager_base_url', 'opm_availability_view_id',
  'sdp_api_refresh_token', 'sdp_api_client_id', 'teams_sla_enabled'];

/** Where a key is read from: 'db' (stored and readable), 'db_unreadable' (stored, decrypts to '' — wrong/missing
 *  SDP_CONFIG_KEY), 'none' (not stored → default). Values are never returned. */
function sourceOf(key, presentRows, folded) {
  const stored = presentRows.has(key);
  const readable = String((folded || {})[key] || '').trim() !== '';
  if (stored && readable) return 'db';
  if (stored && !readable) return 'db_unreadable';
  return 'none';
}

async function readConfig(rdb) {
  const H = rdb.pgHandle();
  const rows = await H.prepare(`SELECT key FROM report_config WHERE key IN (${CONFIG_KEYS.map(() => '?').join(',')}) AND value IS NOT NULL AND value <> ''`).all(...CONFIG_KEYS);
  const present = new Set(rows.map((x) => x.key));
  const cfg = await require('./reportConfig').getConfig(rdb.db);
  const analytics = require('./analyticsSettings').mergeAnalyticsSettings(cfg, process.env);
  return {
    cfg,
    config: {
      sdp_analytics: { ready: analytics.ready, sources: analytics.sources ? { clientId: analytics.sources.clientId, clientSecret: analytics.sources.clientSecret, refreshToken: analytics.sources.refreshToken } : null },
      meraki: { api_key: sourceOf('meraki_api_key', present, cfg), org_id: !!String(cfg.meraki_org_id || '').trim(), runtime_source: 'report_config (database) read at each job run — no .env fallback' },
      opmanager: { api_key: sourceOf('opmanager_api_key', present, cfg), base_url: !!String(cfg.opmanager_base_url || '').trim(), view_id: !!String(cfg.opm_availability_view_id || '').trim() },
      sdp_cloud: { armed: String(cfg.teams_sla_enabled || '0') === '1', refresh_token: sourceOf('sdp_api_refresh_token', present, cfg), client_id: !!String(cfg.sdp_api_client_id || '').trim() },
    },
  };
}

async function readJobs(rdb, jobNames, sync) {
  const S = sync || require('./sync');
  await S.ensureReady();
  const store = S.getStore();
  const out = {};
  for (const r of await store.health()) out[r.job] = { last_ok: r.last_ok || null, last_error: r.last_error || null, last_skipped: r.last_skipped || null, skip_reason: r.skip_reason || null };
  // legacy sync_metadata rows (helpdesk jobs that ran before the registry)
  try {
    const { LEGACY_NAMES } = require('./sync/jobs');
    for (const m of (await rdb.getSyncStatus()) || []) {
      const name = LEGACY_NAMES[m.job_name]; if (!name) continue;
      const cur = out[name] || (out[name] = { last_ok: null, last_error: null });
      if (m.last_sync_at && (!cur.last_ok || Date.parse(m.last_sync_at + (/[zZ]$/.test(m.last_sync_at) ? '' : 'Z')) > Date.parse(cur.last_ok))) cur.last_ok = m.last_sync_at;
      if (m.last_error && !cur.last_error_text) cur.last_error_text = m.last_error;
    }
  } catch (_) { /* legacy table optional */ }
  for (const job of jobNames) {
    const runs = (await store.recentRuns(job, 10)) || [];
    const cur = out[job] || (out[job] = { last_ok: null, last_error: null });
    const fin = runs.find((x) => x.finished_at && x.started_at && x.status !== 'running');
    if (fin) { const d = Date.parse(fin.finished_at) - Date.parse(fin.started_at); if (Number.isFinite(d) && d >= 0) cur.last_run_ms = d; }
    const err = runs.find((x) => x.status === 'error');
    if (err && err.error && !cur.last_error_text) cur.last_error_text = err.error;
  }
  return out;
}

/** Sites expected by a module (site_module_codes) vs sites that have a snapshot for the newest week. */
async function snapshotCoverage(H, module, table, valueCol) {
  const expected = (await H.prepare(`SELECT DISTINCT site_id FROM site_module_codes WHERE module = ?`).all(module)).map((x) => Number(x.site_id));
  const latest = await H.prepare(`SELECT MAX(period_start) AS p FROM ${table} WHERE period_type = 'week'`).get();
  const period = latest && latest.p ? latest.p : null;
  const covered = period ? (await H.prepare(`SELECT DISTINCT site_id FROM ${table} WHERE period_type = 'week' AND period_start = ? AND ${valueCol} IS NOT NULL`).all(period)).map((x) => Number(x.site_id)) : [];
  return { expected, covered, period: period ? `week of ${period}` : null, reason: period ? `no snapshot for the week of ${period}` : 'no snapshot yet' };
}

async function readCoverage(rdb, { now = Date.now() } = {}) {
  const H = rdb.pgHandle();
  const out = {};
  try { out.meraki = await snapshotCoverage(H, 'meraki', 'wan_link_snapshots', 'availability_pct'); } catch (_) { /* unknown */ }
  try { out.opmanager = await snapshotCoverage(H, 'opmanager', 'infra_metric_snapshots', 'metric_value'); } catch (_) { /* unknown */ }
  try {
    const sites = ((await rdb.listSites()) || []).filter((s) => String(s.zoho_group || '').trim());
    const since = new Date(now - 14 * 864e5).toISOString();
    const seen = new Set((await H.prepare(`SELECT DISTINCT tech_group FROM request_records WHERE created_time >= ?`).all(since)).map((x) => String(x.tech_group || '').trim().toLowerCase()));
    const covered = sites.filter((s) => String(s.zoho_group).split(',').some((g) => seen.has(g.trim().toLowerCase()))).map((s) => Number(s.id));
    out.sdp_analytics = { expected: sites.map((s) => Number(s.id)), covered, period: 'last 14 days', reason: 'no ticket from its Zoho group in 14 days' };
  } catch (_) { /* unknown */ }
  try {
    const r = await H.prepare(`SELECT MAX(data_through) AS t FROM infra_metric_snapshots`).get();
    out._opmDataThrough = r && r.t ? r.t : null;
  } catch (_) { out._opmDataThrough = null; }
  return out;
}

/** Owners per connector from docs/sdp360/completion/CONNECTOR-REGISTER.csv (owner_role column), by register id. */
function readOwners() {
  const fs = require('fs'); const path = require('path');
  const map = { sdp_analytics: 'C01', meraki: 'C07', opmanager: 'C08', sdp_cloud: 'C03' };
  try {
    const text = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sdp360', 'completion', 'CONNECTOR-REGISTER.csv'), 'utf8');
    const out = {};
    for (const line of text.split('\n').slice(1)) {
      const id = line.split(',')[0];
      const conn = Object.keys(map).find((k) => map[k] === id); if (!conn) continue;
      const m = /,(Platform owner|Infrastructure owner|Service & Support Manager|Information Security[^,]*),/.exec(line);
      if (m) out[conn] = m[1];
    }
    return out;
  } catch (_) { return {}; }
}

async function gather(rdb, deps = {}) {
  const r = { now: deps.now || Date.now(), jobs: {}, config: {}, coverage: {}, sites: [], owners: readOwners(), openTasks: [] };
  const { FRESHNESS_HOURS } = require('./sync/jobs');
  r.freshness = FRESHNESS_HOURS;
  const names = require('./connectorHealth').CONNECTORS.flatMap((c) => c.jobs);
  try { r.jobs = await readJobs(rdb, names, deps.sync); } catch (_) { r.jobs = {}; }
  try { const c = await readConfig(rdb); r.config = c.config; r.opmStaleDays = c.cfg.opm_stale_days; } catch (_) { r.config = {}; }
  try { const cov = await readCoverage(rdb, { now: r.now }); r.opmDataThrough = cov._opmDataThrough; delete cov._opmDataThrough; r.coverage = cov; } catch (_) { r.coverage = {}; }
  try { r.sites = ((await rdb.listSites()) || []).map((s) => ({ id: Number(s.id), name: s.name })); } catch (_) { r.sites = []; }
  try { const ts = deps.getTokenState && deps.getTokenState(); if (ts) r.token = { accessToken: !!ts.accessToken, lastRefreshError: !!ts.lastRefreshError }; } catch (_) { /* unknown */ }
  try { r.openTasks = await require('./connectorFixTasks').list(rdb.pgHandle(), { status: 'open' }); } catch (_) { r.openTasks = []; }
  return r;
}

module.exports = { gather, readConfig, readJobs, readCoverage, readOwners, sourceOf, CONFIG_KEYS };
