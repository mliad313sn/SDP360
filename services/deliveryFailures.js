'use strict';
// E-R04 (audit R-04, catalogue R11 / A08) — report-delivery failures made VISIBLE. Before this, a failed send was a
// row in report_sent_log (result = 'fail') or a failed publish.connectors run in sync_runs that nobody saw: the
// admin page showed sync health only. This module lists them read-only for /api/sync/health (block `delivery`)
// and System Logs; it never retries anything — a resend stays the existing explicit force action.
//   • only result = 'fail' rows are failures; 'ok' and 'resent' are deliveries (the dedup vocabulary)
//   • recipients are never returned (only their count) and error texts are redacted: no URL, no e-mail address,
//     no token-shaped value leaves the server through this list
// The optional outbound alert (delivery_failure_alert_enabled, default '0') goes through the existing sync-alert
// path (services/sync/alerts.js checkDelivery), so it reaches only the sync_alert_* recipients.

const DEFAULT_DAYS = 14;

/** Mask what could identify an address or a secret in a free-text error. */
function redact(text) {
  if (text == null) return null;
  return String(text)
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<address>')
    .replace(/\b(token|key|secret|password|sig|code)=[^\s&]+/gi, '$1=<redacted>')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<redacted>')
    .slice(0, 300);
}

const _iso = (v) => { if (v == null) return null; const t = Date.parse(v instanceof Date ? v.toISOString() : String(v)); return Number.isNaN(t) ? null : new Date(t).toISOString(); };
const _count = (r) => String(r == null ? '' : r).split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean).length;

/** PURE. sentRows = report_sent_log rows; publishRows = sync_runs rows of the publish job. */
function shapeDeliveryFailures({ sentRows = [], publishRows = [], days = DEFAULT_DAYS } = {}) {
  const failures = [];
  for (const r of sentRows || []) {
    if (String(r.result) !== 'fail') continue;
    failures.push({ kind: 'report_send', type: r.report_type || null, site: r.site_code || null, period: r.period || null, at: _iso(r.sent_at), recipients_count: _count(r.recipients), error: null });
  }
  for (const r of publishRows || []) {
    if (String(r.status) !== 'error') continue;
    failures.push({ kind: 'publish', type: r.job || 'publish.connectors', site: null, period: null, at: _iso(r.finished_at || r.started_at), recipients_count: null, error: redact(r.error) });
  }
  failures.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const by_kind = { report_send: failures.filter((f) => f.kind === 'report_send').length, publish: failures.filter((f) => f.kind === 'publish').length };
  return { window_days: days, total: failures.length, by_kind, failures: failures.slice(0, 200) };
}

/** Read the last `days` days. `db` = a pg handle with prepare(). A read error is returned, never thrown. */
async function loadDeliveryFailures(db, { days = DEFAULT_DAYS, now = new Date() } = {}) {
  const d = Math.max(1, Math.min(90, Math.floor(Number(days)) || DEFAULT_DAYS));
  const since = new Date(now.getTime() - d * 864e5).toISOString();
  const out = { sentRows: [], publishRows: [] }; const errors = [];
  try { out.sentRows = await db.prepare(`SELECT report_type, site_code, period, recipients, result, sent_at FROM report_sent_log WHERE result = 'fail' AND sent_at >= CAST(? AS TIMESTAMPTZ) ORDER BY sent_at DESC LIMIT 200`).all(since); } catch (e) { errors.push('report_sent_log unreadable'); }
  try { out.publishRows = await db.prepare(`SELECT job, status, started_at, finished_at, error FROM sync_runs WHERE job LIKE 'publish.%' AND status = 'error' AND started_at >= ? ORDER BY id DESC LIMIT 200`).all(since); } catch (e) { errors.push('sync_runs unreadable'); }
  return { ...shapeDeliveryFailures({ ...out, days: d }), errors };
}

module.exports = { shapeDeliveryFailures, loadDeliveryFailures, redact, DEFAULT_DAYS };
