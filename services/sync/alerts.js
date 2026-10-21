'use strict';
// Step 1 — sync alerting. Two triggers, one message path:
//   • failure: a job has failed N times in a row (default 2) → alert once per failure streak;
//   • staleness: a job's last success is older than its freshness window → alert once per
//     24 h while it stays stale (the hourly staleness sweep in schedule.js calls checkStale).
// Senders are injected (e-mail through services/mailer, Teams through a Workflows webhook) so
// the module is pure and testable; both are best-effort and never throw into the runner.
// Dedup state lives in sync_watermarks under 'alert:<job>' so it survives a restart.

const DEFAULT_STREAK = 2;
const STALE_REPEAT_MS = 24 * 3600 * 1000;

function createAlerter({ store, senders = [], now = () => Date.now(), streak = DEFAULT_STREAK, log = () => {} } = {}) {
  async function recentStatuses(job, n) {
    const runs = await store.recentRuns(job, n);
    return runs.map((r) => r.status);
  }

  async function lastAlertAt(key) {
    const v = await store.getWatermark(`alert:${key}`);
    return v ? Date.parse(v) : 0;
  }
  async function markAlert(key) { await store.setWatermark(`alert:${key}`, new Date(now()).toISOString()); }
  async function clearAlert(key) { await store.setWatermark(`alert:${key}`, null); }

  async function send(kind, job, text) {
    const msg = { kind, job, title: `Sync alert — ${job}: ${kind}`, text, at: new Date(now()).toISOString() };
    for (const s of senders) {
      try { await s(msg); } catch (e) { log('warn', `alert sender failed: ${e.message}`); }
    }
    return msg;
  }

  // Called from the runner's onEvent.
  async function onEvent(kind, p) {
    if (!p || !p.job) return null;
    if (kind === 'sync_ok') { await clearAlert(`fail:${p.job}`); return null; }
    if (kind !== 'sync_failed') return null;
    const statuses = await recentStatuses(p.job, streak);
    const consecutive = statuses.length >= streak && statuses.every((s) => s === 'error');
    if (!consecutive) return null;
    if (await lastAlertAt(`fail:${p.job}`)) return null; // already alerted for this streak
    await markAlert(`fail:${p.job}`);
    return send('failure', p.job, `${p.job} failed ${statuses.length} times in a row. Last error: ${p.error || 'unknown'}`);
  }

  // Called by the hourly sweep with the health rows + declared freshness windows.
  async function checkStale(healthRows, freshnessHours, optional = new Set()) {
    const out = [];
    for (const r of healthRows) {
      const hours = freshnessHours[r.job];
      if (!hours) continue;
      const neverRan = !r.last_ok;
      if (neverRan && optional.has(r.job)) continue;
      const ageMs = neverRan ? Infinity : now() - Date.parse(r.last_ok);
      if (ageMs <= hours * 3600 * 1000) { await clearAlert(`stale:${r.job}`); continue; }
      const last = await lastAlertAt(`stale:${r.job}`);
      if (last && now() - last < STALE_REPEAT_MS) continue;
      await markAlert(`stale:${r.job}`);
      out.push(await send('stale', r.job, neverRan ? `${r.job} has never succeeded.` : `${r.job} last succeeded ${Math.round(ageMs / 36e5)} h ago (window ${hours} h).`));
    }
    return out;
  }

  return { onEvent, checkStale };
}

// Sender factories — thin, best-effort.
function emailSender({ mailer, to, from }) {
  return async (msg) => {
    if (!mailer || !to || !to.length) return;
    await mailer.send({ to, from, subject: msg.title, text: `${msg.text}\n\n${msg.at}`, html: `<p><b>${escapeHtml(msg.title)}</b></p><p>${escapeHtml(msg.text)}</p><p><small>${msg.at}</small></p>` });
  };
}
function teamsSender({ post, url, allowHosts }) {
  return async (msg) => {
    if (!post || !url) return;
    // M4 — the Teams webhook is validated right before each post (https, no private address unless
    // allow-listed); an unsafe URL is a logged sender failure, never a crash of the alerter.
    const safe = await require('../safeUrl').validateOutboundUrl(url, { allowHosts: allowHosts || require('../safeUrl').DEFAULT_ALLOW_HOSTS });
    await post(safe, { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: {
      type: 'AdaptiveCard', version: '1.4', body: [
        { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: msg.title, color: msg.kind === 'failure' ? 'Attention' : 'Warning' },
        { type: 'TextBlock', wrap: true, text: msg.text }, { type: 'TextBlock', isSubtle: true, size: 'Small', text: msg.at },
      ] } }] });
  };
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

module.exports = { createAlerter, emailSender, teamsSender, DEFAULT_STREAK, STALE_REPEAT_MS };
