'use strict';
// Step 1 (SDP-DASH-2.0) — sync alert channel. Called by the runner on a failure streak, a
// recovery, or a stale job. Two channels, both ARMED OFF by default (house rule: nothing is
// sent until an admin arms it):
//   · e-mail  — sync_alert_enabled = '1' + sync_alert_recipients (comma list)
//   · Teams   — sync_alert_teams = '1' → the DEFAULT channel ('*') of teams_sla_channels
// Never throws. A webhook URL never appears in a result or a log line.

function buildMessage({ kind, job, state, error, ageMinutes }) {
  const label = (job && job.label) || (job && job.key) || 'job';
  const key = (job && job.key) || '';
  if (kind === 'recovery') {
    return { subject: `[SDP-Dashboard] Sync recovered: ${label}`,
      text: `The job "${label}" (${key}) is running again after ${Number(state && state.consecutive_failures) || 0} failure(s).` };
  }
  if (kind === 'stale') {
    const h = ageMinutes != null ? `${Math.round(ageMinutes / 6) / 10} h` : 'an unknown time';
    return { subject: `[SDP-Dashboard] Sync stale: ${label}`,
      text: `The job "${label}" (${key}) has not completed for ${h} (freshness window ${job ? job.freshnessMinutes : '?'} min). ` +
        `The data it feeds is out of date. Check Admin ▸ System Logs ▸ Sync health.` };
  }
  return { subject: `[SDP-Dashboard] Sync failing: ${label}`,
    text: `The job "${label}" (${key}) failed ${Number(state && state.consecutive_failures) || 0} time(s) in a row.\n` +
      `Last error: ${String(error || '').slice(0, 500)}\nCheck Admin ▸ System Logs ▸ Sync health.` };
}

function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function teamsCard(msg, kind) {
  const color = kind === 'recovery' ? 'Good' : 'Attention';
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null,
    content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
      body: [
        { type: 'TextBlock', size: 'Medium', weight: 'Bolder', color, wrap: true, text: msg.subject.replace('[SDP-Dashboard] ', '') },
        { type: 'TextBlock', wrap: true, text: msg.text },
      ] } }] };
}

function _defaultDeps() {
  const rdb = require('../../reports-db');
  const reportConfig = require('./../reportConfig');
  const { buildMailer } = require('../mailer');
  const axios = require('axios');
  return {
    loadConfig: () => reportConfig.getConfig(rdb.db),
    mail: (cfg, m) => buildMailer(cfg).send(m),
    post: (url, body) => axios.post(url, body, { timeout: 15000, headers: { 'Content-Type': 'application/json' } }),
  };
}

function buildAlerter(deps) {
  const D = deps || _defaultDeps();
  return async function alert(ev) {
    const out = { email: 'off', teams: 'off' };
    try {
      const cfg = await D.loadConfig();
      const msg = buildMessage(ev);
      if (String(cfg.sync_alert_enabled) === '1') {
        const to = String(cfg.sync_alert_recipients || '').split(/[,;\s]+/).filter(x => /@/.test(x));
        if (!to.length) out.email = 'no_recipients';
        else {
          const r = await D.mail(cfg, { to: to.join(','), subject: msg.subject,
            html: `<p>${_esc(msg.text).replace(/\n/g, '<br>')}</p>` });
          out.email = r && r.ok ? 'sent' : `failed: ${r && r.error}`;
        }
      }
      if (String(cfg.sync_alert_teams) === '1') {
        const { parseChannels } = require('../teamsSla');
        const def = parseChannels(cfg.teams_sla_channels).find(c => c.group === '*');
        if (!def) out.teams = 'no_default_channel';
        else {
          try { await D.post(def.url, teamsCard(msg, ev.kind)); out.teams = 'sent'; }
          catch (e) { out.teams = 'failed: ' + String(e.message || e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 200); }
        }
      }
    } catch (e) {
      out.error = String(e.message || e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 200);
    }
    if (out.email !== 'off' || out.teams !== 'off' || out.error) {
      console.log(`[sync-alert] ${ev.kind} ${ev.job && ev.job.key}: email=${out.email} teams=${out.teams}${out.error ? ' error=' + out.error : ''}`);
    }
    return out;
  };
}

module.exports = { buildAlerter, buildMessage, teamsCard };
