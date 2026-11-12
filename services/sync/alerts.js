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
      // F-ARCH-01 — a skip is not a collection, so last_ok no longer moves while a job skips. An OPTIONAL job
      // whose newest run is a skip (integration not configured / feature disarmed) is not paged: health shows
      // it as not_configured with its last real collection date. A MANDATORY job that skips ages and alerts.
      const skippedLast = !!r.last_skipped && (neverRan || Date.parse(r.last_skipped) > Date.parse(r.last_ok));
      if (skippedLast && optional.has(r.job)) { await clearAlert(`stale:${r.job}`); continue; }
      const ageMs = neverRan ? Infinity : now() - Date.parse(r.last_ok);
      if (ageMs <= hours * 3600 * 1000) { await clearAlert(`stale:${r.job}`); continue; }
      const last = await lastAlertAt(`stale:${r.job}`);
      if (last && now() - last < STALE_REPEAT_MS) continue;
      await markAlert(`stale:${r.job}`);
      const skipNote = skippedLast ? ` Its last run was skipped${r.skip_reason ? ` (${r.skip_reason})` : ''}.` : '';
      out.push(await send('stale', r.job, (neverRan ? `${r.job} has never succeeded.` : `${r.job} last succeeded ${Math.round(ageMs / 36e5)} h ago (window ${hours} h).`) + skipNote));
    }
    return out;
  }

  // E-D04 — content drift (shadow). Sends nothing unless `enabled` (report_config sync_drift_alerts = '1');
  // once per 24 h per job while the same flags stay raised. `drift` = { job: computeDrift result }.
  async function checkDrift(drift, { enabled = false } = {}) {
    const out = [];
    if (!enabled) return out;
    for (const [job, d] of Object.entries(drift || {})) {
      if (!d || d.status !== 'drift') { if (d && d.status === 'ok') await clearAlert(`drift:${job}`); continue; }
      const last = await lastAlertAt(`drift:${job}`);
      if (last && now() - last < STALE_REPEAT_MS) continue;
      await markAlert(`drift:${job}`);
      out.push(await send('drift', job, `${job}: ${d.flags.join(', ')} — last run ${d.last_rows} rows vs median ${d.median_rows} over ${d.runs_considered} runs${d.duplicates_pct != null ? `, duplicates ${d.duplicates_pct} %` : ''}. Thresholds are proposals; the sync was not blocked.`));
    }
    return out;
  }

  // E-R04 — report-delivery failures (services/deliveryFailures). Sends nothing unless `enabled`
  // (report_config delivery_failure_alert_enabled = '1'); one message per batch of failures newer than the last
  // one alerted (watermark alert:delivery), so a failure is announced once and never re-sent hourly.
  async function checkDelivery(delivery, { enabled = false } = {}) {
    if (!enabled || !delivery || !Array.isArray(delivery.failures)) return null;
    const last = await lastAlertAt('delivery');
    const fresh = delivery.failures.filter((f) => f.at && Date.parse(f.at) > last);
    if (!fresh.length) return null;
    await store.setWatermark('alert:delivery', fresh.map((f) => f.at).sort().pop());
    const lines = fresh.slice(0, 10).map((f) => `${f.kind === 'publish' ? 'publish' : f.type}${f.site ? ' · ' + f.site : ''}${f.period ? ' · ' + f.period : ''} at ${f.at}${f.error ? ' — ' + f.error : ''}`);
    return send('delivery', 'report delivery', `${fresh.length} report delivery failure(s): ${lines.join('; ')}${fresh.length > 10 ? ` (+${fresh.length - 10} more)` : ''}. Nothing is retried automatically; resend from Admin.`);
  }

  return { onEvent, checkStale, checkDrift, checkDelivery };
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
