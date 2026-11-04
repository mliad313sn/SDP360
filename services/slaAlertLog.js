'use strict';
// Teams SLA alerts (2026-10-03) — anti-duplicate log, PostgreSQL (db/postgres/reports/
// 013_sla_alert_log.sql + 048_sla_alert_log_due.sql, applied by the migrator).
// Modes (teams_sla_rules.dedup_mode, A-23):
//   'once'    (default, today) — one alert per (ticket, kind), ever.
//   'per_due' — one alert per (ticket, kind, deadline): a re-planned due date alerts again.
//               A legacy row (due_ms NULL) or an alert without a deadline counts as sent.

function _h() {
  const rdb = require('../reports-db');
  return { H: rdb.pgHandle() };
}

const _k = (a) => `${a.request_id}|${a.kind}`;
const _due = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const _mode = (o) => (o && o.mode === 'per_due' ? 'per_due' : 'once');

/** The alerts not sent before (order kept). */
async function filterUnsent(db, alerts, opts) {
  if (!alerts || !alerts.length) return [];
  const { H } = _h(db);
  const perDue = _mode(opts) === 'per_due';
  const ids = [...new Set(alerts.map(a => String(a.request_id)))];
  const sent = new Map();   // key → due_ms recorded (null for legacy rows)
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await H.prepare(`SELECT request_id, kind, due_ms FROM sla_alert_log WHERE request_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk);
    rows.forEach(r => sent.set(`${r.request_id}|${r.kind}`, _due(r.due_ms)));
  }
  return alerts.filter(a => {
    const k = _k(a);
    if (!sent.has(k)) return true;
    if (!perDue) return false;
    const prev = sent.get(k), cur = _due(a.due_ms);
    return !(prev == null || cur == null || prev === cur);
  });
}

async function record(db, alerts, opts) {
  if (!alerts || !alerts.length) return;
  const { H } = _h(db);
  const SQL = _mode(opts) === 'per_due'
    ? 'INSERT INTO sla_alert_log (request_id, kind, group_name, due_ms) VALUES (?, ?, ?, ?) ON CONFLICT (request_id, kind) DO UPDATE SET due_ms = excluded.due_ms, sent_at = now(), group_name = excluded.group_name'
    : 'INSERT INTO sla_alert_log (request_id, kind, group_name, due_ms) VALUES (?, ?, ?, ?) ON CONFLICT (request_id, kind) DO NOTHING';
  await H.runTransaction(async () => {
    for (const a of alerts) await H.prepare(SQL).run(String(a.request_id), a.kind, a.group || null, _due(a.due_ms));
  });
}

/** Delete rows older than `days`; returns the number removed. */
async function purge(db, days = 90) {
  const { H } = _h(db);
  const d = Math.max(1, Number(days) || 90);
  const r = await H.prepare(`DELETE FROM sla_alert_log WHERE sent_at < now() - (? * interval '1 day')`).run(d);
  return r.changes || 0;
}

module.exports = { filterUnsent, record, purge };
