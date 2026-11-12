'use strict';
// P4 / A2 — Connector Health, PURE composition (no I/O, no clock: `now` is passed in).
//
// One card per source system: SDP / Analytics (Zoho Analytics Plus), Meraki, OpManager, SDP Cloud REST.
// For each: last success, last failure + its plain-language cause, last run duration (the runner's
// started_at → finished_at, i.e. the whole collection call), freshness vs the declared cadence, coverage %
// (sites with data ÷ sites expected), failing scope (which sites), where its configuration is read from,
// and the HUMAN step that unblocks it. Rules:
//   • a reading we do not have is UNKNOWN (null / 'unknown') — never 0, never green;
//   • a feature switched off on purpose is 'disarmed' ("désarmé") with its human step — never an error;
//   • configuration is described by PRESENCE and SOURCE only (db / env / default / db_unreadable), never a value.
const H = 3600e3;
const _ms = (t) => { if (t == null || t === '') return null; const s = String(t); const v = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z'); return Number.isFinite(v) ? v : null; };
const _iso = (v) => (v == null ? null : new Date(v).toISOString());

const CONNECTORS = Object.freeze([
  { id: 'sdp_analytics', name: 'ServiceDesk Plus via Zoho Analytics', register: 'C01', jobs: ['zoho.requests', 'zoho.change_cab', 'zoho.survey', 'assets.sync'], primary: 'zoho.requests' },
  { id: 'meraki', name: 'Cisco Meraki (WAN)', register: 'C07', jobs: ['meraki.wan', 'meraki.wan_poller', 'meraki.wan_events', 'meraki.wan_events_5m'], primary: 'meraki.wan' },
  { id: 'opmanager', name: 'OpManager (LAN, Wi-Fi, servers)', register: 'C08', jobs: ['opmanager.availability'], primary: 'opmanager.availability' },
  { id: 'sdp_cloud', name: 'ServiceDesk Plus Cloud REST (Teams SLA alerts)', register: 'C03', jobs: ['teams.sla_poll'], primary: 'teams.sla_poll' },
]);
const OWNER_FALLBACK = { sdp_analytics: 'Platform owner', meraki: 'Infrastructure owner', opmanager: 'Infrastructure owner', sdp_cloud: 'Service & Support Manager' };

function pct(covered, expected) { return expected > 0 ? Math.round((100 * covered) / expected) : null; }

/** Plain-language rewrite of a technical error (the raw text is kept beside it, truncated). */
function plainCause(err) {
  const e = String(err || '');
  if (!e) return null;
  if (/401|unauthor|invalid_token|invalid_code/i.test(e)) return 'The source refused our credentials (HTTP 401): the key or token is wrong, expired or lacks the scope.';
  if (/403|forbidden|7301|not.?permitted/i.test(e)) return 'The source refused access (HTTP 403): the account behind the key lacks the permission.';
  if (/429|rate.?limit|too many|access denied/i.test(e)) return 'The source is rate-limiting us; the next run retries on its own.';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(e)) return 'The server cannot resolve the source host name (DNS or proxy).';
  if (/ECONNREFUSED|ECONNRESET|socket hang up/i.test(e)) return 'The source host refused or dropped the connection (service down or firewall).';
  if (/ETIMEDOUT|timeout|timed out/i.test(e)) return 'The source did not answer in time.';
  if (/certificate|self.signed|CERT_/i.test(e)) return 'The source TLS certificate is not trusted (install the CA bundle in Admin).';
  if (/no rows|returned no rows|empty/i.test(e)) return 'The source answered with no data: nothing was collected, so the previous values were kept.';
  if (/truncat/i.test(e)) return 'The source answer looked truncated; it was rejected so no data was replaced.';
  return 'The last collection failed (see the technical message).';
}

/** One job's health from the runner + legacy rows. j = {last_ok, last_error, last_error_text, last_skipped, skip_reason, last_run_ms} */
function jobState(name, j, freshHours, now) {
  const tOk = _ms(j && j.last_ok), tErr = _ms(j && j.last_error), tSkip = _ms(j && j.last_skipped);
  let status;
  if (tErr != null && (tOk == null || tErr > tOk) && (tSkip == null || tErr >= tSkip)) status = 'error';
  else if (tSkip != null && (tOk == null || tSkip > tOk)) status = 'skipped';
  else if (tOk == null) status = 'never';
  else status = (freshHours && (now - tOk) / H > freshHours) ? 'stale' : 'ok';
  return { job: name, status, last_ok: _iso(tOk), last_error: _iso(tErr), last_error_text: (j && j.last_error_text) ? String(j.last_error_text).slice(0, 300) : null,
    skip_reason: (j && j.skip_reason) || null, last_run_ms: j && Number.isFinite(Number(j.last_run_ms)) ? Number(j.last_run_ms) : null,
    age_hours: tOk == null ? null : Math.round(((now - tOk) / H) * 10) / 10, freshness_hours: freshHours || null };
}

function coverageOf(cov, siteNames) {
  if (!cov || !Array.isArray(cov.expected)) return { covered: null, expected: null, pct: null, label: 'unknown', period: null };
  const exp = cov.expected.map(Number), got = new Set((cov.covered || []).map(Number));
  const covered = exp.filter((id) => got.has(id)).length;
  const missing = exp.filter((id) => !got.has(id)).map((id) => ({ site_id: id, site: siteNames.get(id) || `site #${id}`, reason: cov.reason || 'no data for the period' }));
  return { covered, expected: exp.length, pct: pct(covered, exp.length), label: exp.length ? `${covered} / ${exp.length} sites` : 'no site mapped', period: cov.period || null, missing };
}

function _base(c, r, now, siteNames) {
  const jobs = c.jobs.map((n) => jobState(n, (r.jobs || {})[n], (r.freshness || {})[n], now));
  const primary = jobs.find((x) => x.job === c.primary) || jobs[0];
  const okTimes = jobs.map((x) => _ms(x.last_ok)).filter((x) => x != null);
  const errJobs = jobs.filter((x) => x.last_error).sort((a, b) => _ms(b.last_error) - _ms(a.last_error));
  const cov = coverageOf((r.coverage || {})[c.id], siteNames);
  return {
    id: c.id, name: c.name, register: c.register, owner_role: (r.owners || {})[c.id] || OWNER_FALLBACK[c.id],
    jobs, last_success: okTimes.length ? _iso(Math.max(...okTimes)) : null,
    last_failure: errJobs[0] ? errJobs[0].last_error : null,
    last_failure_text: errJobs[0] ? errJobs[0].last_error_text : null,
    last_run_ms: primary.last_run_ms,
    freshness: { status: primary.status, age_hours: primary.age_hours, expected_hours: primary.freshness_hours },
    coverage: { covered: cov.covered, expected: cov.expected, pct: cov.pct, label: cov.label, period: cov.period },
    failing_scope: cov.missing || [],
    config: (r.config || {})[c.id] || null,
  };
}

/** The first blocking step, in order — that is the cause shown, and the human step that removes it. */
function decide(c, b, r) {
  const cfg = b.config || {};
  const err = b.jobs.find((x) => x.job === c.primary && x.status === 'error') || b.jobs.find((x) => x.status === 'error');
  const set = (state, cause, step) => Object.assign(b, { state, cause, human_step: step || null });

  if (c.id === 'sdp_cloud') {
    if (!cfg.armed) {
      const noToken = cfg.refresh_token !== 'db';
      return set('disarmed', noToken
        ? 'Désarmé: no SDP Cloud refresh token with the SDPOnDemand.requests.READ scope is stored (the only token supplied carries the Analytics scope).'
        : 'Désarmé: a token is stored but the Teams SLA alerts are not armed (teams_sla_enabled = 0).',
      noToken
        ? 'Mint a refresh token from the Zoho Self Client with scope SDPOnDemand.requests.READ, enter it in Admin ▸ Intégration API ▸ Alertes SLA (write-only field), run Preview, then decide whether to arm.'
        : 'Run Preview in Admin ▸ Intégration API ▸ Alertes SLA; arming is a human decision (owner: Service & Support Manager).');
    }
    if (cfg.refresh_token !== 'db') return set('not_configured', 'Armed but no readable SDP Cloud refresh token.', 'Enter the SDPOnDemand.requests.READ refresh token in Admin ▸ Intégration API ▸ Alertes SLA.');
  }
  if (c.id === 'meraki') {
    if (cfg.api_key === 'db_unreadable') return set('not_configured', 'A Meraki API key is stored ENCRYPTED but SDP_CONFIG_KEY is missing or different on this server, so it reads as empty.', 'Put the same SDP_CONFIG_KEY in .env as when the key was saved, or re-enter the Meraki key in Admin ▸ Infra (super_admin).');
    if (cfg.api_key !== 'db') return set('not_configured', 'No Meraki API key: every Meraki job skips (it is read only from the database, report_config.meraki_api_key — there is no .env fallback).', 'Enter the Meraki API key and organisation id in Admin ▸ Infra (super_admin).');
    if (!cfg.org_id) return set('not_configured', 'Meraki API key present but no organisation id.', 'Enter meraki_org_id in Admin ▸ Infra.');
  }
  if (c.id === 'opmanager') {
    if (cfg.api_key === 'db_unreadable') return set('not_configured', 'An OpManager API key is stored ENCRYPTED but SDP_CONFIG_KEY is missing or different on this server, so it reads as empty.', 'Restore the SDP_CONFIG_KEY used when the key was saved, or re-enter the OpManager key in Admin ▸ Infra.');
    const rest = cfg.api_key === 'db' && cfg.base_url;
    if (!rest && !cfg.view_id) return set('not_configured', 'Neither the OpManager REST API (opmanager_api_key + opmanager_base_url) nor the Analytics view (opm_availability_view_id) is set: LAN, Wi-Fi and server values cannot be prefilled.', 'Enter the OpManager REST URL and API key in Admin ▸ Infra, then run the discovery (node tools/opmanager/discover.js) to confirm device types and the device → site mapping.');
    b.mode = rest ? 'rest' : 'analytics_view';
  }
  if (c.id === 'sdp_analytics' && cfg.ready === false) return set('not_configured', 'The Zoho Analytics client id, secret or refresh token is missing (database and .env).', 'Enter them in Admin ▸ Intégration API ▸ Analytics, then Test.');
  if (c.id === 'sdp_analytics' && r.token && r.token.lastRefreshError && !r.token.accessToken) return set('error', 'The Zoho token refresh failed: no helpdesk data can be read until it succeeds.', 'Check the refresh token and its scope (MEAplus.fullaccess.all) in Admin ▸ Intégration API ▸ Analytics.');
  if (err) return set('error', plainCause(err.last_error_text) || 'The last collection failed.', `Owner (${b.owner_role}): read the message, fix the source or the credentials, then run the job again from System Logs ▸ Sync.`);
  const prim = b.jobs.find((x) => x.job === c.primary);
  if (prim && prim.status === 'skipped') return set('not_configured', `The last run did not collect: ${prim.skip_reason || 'not configured'}.`, 'Complete the configuration in Admin, then run the job again.');
  if (prim && prim.status === 'never') return set('unknown', 'Configured, but no collection has run yet: values are unknown.', 'Wait for the scheduled run or start it from System Logs ▸ Sync.');
  if (c.id === 'opmanager') {
    const thr = r.opmDataThrough || null; const staleDays = Number(r.opmStaleDays) || 9;
    if (b.mode === 'analytics_view' && thr && (r.now - _ms(thr)) / (24 * H) > staleDays)
      return set('stale', `The OpManager → Analytics Plus view stopped refreshing: newest data is from ${String(thr).slice(0, 10)} (older than ${staleDays} days).`, 'Restart the OpManager → Analytics Plus import on the Zoho side, or switch to the OpManager REST API (Admin ▸ Infra).');
    if (b.coverage.expected > 0 && b.coverage.covered === 0)
      return set('error', 'Devices are collected but none landed on a site: the device → site mapping (discovery) is not done.', 'Run node tools/opmanager/discover.js with the infrastructure owner, confirm the probe ↔ site mapping, then re-run the sync.');
  }
  if (prim && prim.status === 'stale') return set('stale', `No successful collection for ${prim.age_hours} h (expected every ${prim.freshness_hours} h).`, 'Check the scheduler and the last run in System Logs ▸ Sync.');
  if (b.coverage.pct != null && b.coverage.pct < 100) return set('partial', `${b.coverage.label} have data for ${b.coverage.period || 'the period'}.`, 'Map the missing sites (Admin ▸ Infra) or open a fix task per site below.');
  return set('ok', null, null);
}

const STATE_LABEL = { ok: 'ok', partial: 'partial', stale: 'stale', error: 'error', not_configured: 'not configured', disarmed: 'désarmé', unknown: 'unknown' };

/**
 * r = { now, jobs:{job:{…}}, freshness, config:{connector:{…}}, coverage:{connector:{expected,covered,period,reason}},
 *       sites:[{id,name}], owners:{connector:role}, token:{accessToken,lastRefreshError}, opmDataThrough, opmStaleDays, openTasks }
 */
function compose(r = {}) {
  const now = r.now || Date.now();
  const siteNames = new Map((r.sites || []).map((s) => [Number(s.id), s.name]));
  const tasks = r.openTasks || [];
  const connectors = CONNECTORS.map((c) => {
    const b = _base(c, r, now, siteNames);
    decide(c, b, { ...r, now });
    b.state_label = STATE_LABEL[b.state] || b.state;
    b.open_tasks = tasks.filter((t) => t.connector === c.id).length;
    // every "unknown" the page shows is a fix task: the connector itself (scope '') and each missing site
    b.fix_targets = (b.state === 'ok' ? [] : [{ connector: c.id, site_id: null, scope: '', cause: b.cause }])
      .concat(b.failing_scope.map((m) => ({ connector: c.id, site_id: m.site_id, scope: 'site', cause: `${b.name}: ${m.reason} (${m.site})` })));
    return b;
  });
  const summary = {};
  for (const c of connectors) summary[c.state] = (summary[c.state] || 0) + 1;
  return { checked_at: new Date(now).toISOString(), summary, connectors };
}

module.exports = { compose, plainCause, jobState, coverageOf, CONNECTORS, STATE_LABEL };
