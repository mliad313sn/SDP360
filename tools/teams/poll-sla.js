'use strict';
// Teams SLA alerts (2026-10-03) — the 5-minute job. Reads the open requests from the
// SDP Cloud API, applies the rules (services/teamsSla), drops what was already sent
// (services/slaAlertLog), and posts ONE card per SDP group to that group's Teams channel
// (Workflows webhook). Config-gated + best-effort: never throws, never overlaps.
//
//   node tools/teams/poll-sla.js            # one pass (respects the arm flag)
//   node tools/teams/poll-sla.js --dry-run  # preview only: no post, no record
//
// Rules on failure: SDP API down → nothing sent, nothing recorded. A webhook that fails
// → that group's alerts are NOT recorded, so the next pass retries them. A group with no
// channel → counted, not recorded. A webhook URL never appears in a result or a log line.
const path = require('path');
if (require.main === module) require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const S = require('../../services/teamsSla');
const { buildGroupCard } = require('../../services/teamsCard');

let _running = false;

function _defaultDeps() {
  const rdb = require('../../reports-db');
  const reportConfig = require('../../services/reportConfig');
  const { makeSdpClient } = require('../../services/sdpApiClient');
  const axios = require('axios');
  return {
    loadConfig: () => reportConfig.getConfig(rdb.db),
    makeClient: (c) => makeSdpClient({ baseUrl: c.sdp_api_base_url, accountsUrl: c.sdp_api_accounts_url,
      clientId: c.sdp_api_client_id, clientSecret: c.sdp_api_client_secret, refreshToken: c.sdp_api_refresh_token,
      openFilter: c.sdp_api_open_filter || undefined,
      excludeStatuses: S.parseRules(c.teams_sla_rules).api_exclude_statuses }),
    post: (url, card) => axios.post(url, card, { timeout: 15000, headers: { 'Content-Type': 'application/json' } }),
    log: require('../../services/slaAlertLog'),
    setConfig: (patch) => reportConfig.setConfig(rdb.db, patch, 'teams-sla'),
    now: () => Date.now(),
  };
}

// Never let a webhook URL (a secret: it lets anyone post in the channel) reach a result.
const _scrub = (msg) => String(msg || '').replace(/https?:\/\/\S+/g, '<url>').slice(0, 300);

async function run({ dryRun = false, deps } = {}) {
  if (_running) return { skipped: 'already_running' };
  _running = true;
  try {
    const D = { ..._defaultDepsLazy(deps), ...(deps || {}) };
    const cfg = D.config || await D.loadConfig();
    if (!dryRun && String(cfg.teams_sla_enabled) !== '1') return { skipped: 'disarmed' };
    const channels = S.parseChannels(cfg.teams_sla_channels);
    if (!dryRun && !channels.length) return { skipped: 'no_channels' };
    const client = D.client || D.makeClient(cfg);
    if (!client || !client.configured) return { skipped: 'sdp_api_not_configured' };

    const rules = S.parseRules(cfg.teams_sla_rules);
    const nowMs = D.now();
    let raw;
    try { raw = await client.listOpenRequests({ createdAfterMs: S.createdAfterMs(rules, nowMs) }); }
    catch (e) { return { error: _scrub(e.message) }; }
    const tickets = raw.map(S.normalizeRequest);
    const alerts = S.evaluate(tickets, rules, nowMs);
    const fresh = await D.log.filterUnsent(null, alerts);

    // SDP group names drift in case ("Support team" / "Support Team"): one card per group,
    // keyed case-insensitively, shown under the first spelling met.
    const byGroup = new Map();
    for (const a of fresh) {
      const name = a.group || '(sans groupe)';
      const k = name.toLowerCase();
      if (!byGroup.has(k)) byGroup.set(k, { group: name, list: [] });
      byGroup.get(k).list.push(a);
    }
    const out = { tickets: tickets.length, alerts: alerts.length, new: fresh.length, posted: 0, sent: 0,
      unmapped: [], failures: [] };
    if (dryRun) {
      out.preview = [];
      out.by_status = {};
      tickets.forEach(t => { const k = t.status || '(vide)'; out.by_status[k] = (out.by_status[k] || 0) + 1; });
      out.truncated = !!(client.pageCap && raw.length >= client.pageCap);
      if (typeof client.lastMeta === 'function') out.api_criteria = client.lastMeta().criteria;
    }
    for (const { group, list } of [...byGroup.values()].sort((a, b) => a.group.localeCompare(b.group))) {
      const url = S.resolveChannel(group, channels);
      if (dryRun) { out.preview.push({ group, has_channel: !!url, alerts: list }); continue; }
      if (!url) { out.unmapped.push(group); continue; }
      const card = buildGroupCard(group, list, { apiBaseUrl: cfg.sdp_api_base_url, maxTickets: rules.max_tickets_per_card });
      try {
        await D.post(url, card);
        await D.log.record(null, list);
        out.posted++; out.sent += list.length;
      } catch (e) {
        out.failures.push({ group, error: _scrub(e.message) });
      }
    }
    if (!dryRun) {
      try { await D.log.purge(null, 90); } catch (e) { /* housekeeping only */ }
      try { await D.setConfig({ teams_sla_last_run: new Date(nowMs).toISOString() }); } catch (e) { /* heartbeat only */ }
      if (out.posted || out.failures.length) {
        console.log(`[teams-sla] tickets=${out.tickets} new=${out.new} posted=${out.posted} sent=${out.sent} unmapped=${out.unmapped.length} failures=${out.failures.length}`);
      }
    }
    return out;
  } catch (e) {
    return { error: _scrub(e.message) };
  } finally {
    _running = false;
  }
}

// Real dependencies only when the caller did not inject a complete set (tests do).
function _defaultDepsLazy(d) {
  const complete = d && (d.config || d.loadConfig) && (d.client || d.makeClient) && d.post && d.log && d.setConfig && d.now;
  return complete ? {} : _defaultDeps();
}

async function main(argv = process.argv.slice(2)) {
  const r = await run({ dryRun: argv.includes('--dry-run') });
  console.log(JSON.stringify(r, null, 2));
  return r;
}

if (require.main === module) {
  (async () => {
    if ((process.env.REPORTS_BACKEND || 'sqlite').toLowerCase() === 'postgres') await require('../../reports-db').initPgReports();
    await main();
    process.exit(0);
  })().catch(e => { console.error('[teams-sla]', _scrub(e.message)); process.exit(1); });
}

module.exports = { run, main };
