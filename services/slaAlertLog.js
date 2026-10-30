'use strict';
// Teams SLA alerts (2026-10-03) — anti-duplicate log: one alert per (ticket, kind),
// ever. sqlite (created here, lazily) + PostgreSQL (db/postgres/reports/013_sla_alert_log.sql,
// applied by initPgReports). Every function returns a Promise on both backends.

function _h(db) {
  const rdb = require('../reports-db');
  return { H: rdb.pgHandle(), isPg: true };
}


const _k = (a) => `${a.request_id}|${a.kind}`;

/** The alerts never sent before (order kept). */
async function filterUnsent(db, alerts) {
  if (!alerts || !alerts.length) return [];
  const { H, isPg } = _h(db);
  
  const ids = [...new Set(alerts.map(a => String(a.request_id)))];
  const sent = new Set();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await H.prepare(`SELECT request_id, kind FROM sla_alert_log WHERE request_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk);
    rows.forEach(r => sent.add(`${r.request_id}|${r.kind}`));
  }
  return alerts.filter(a => !sent.has(_k(a)));
}

async function record(db, alerts) {
  if (!alerts || !alerts.length) return;
  const { H, isPg } = _h(db);
  const SQL = ('INSERT INTO sla_alert_log (request_id, kind, group_name) VALUES (?, ?, ?) ON CONFLICT (request_id, kind) DO NOTHING');
  await H.runTransaction(async () => { for (const a of alerts) await H.prepare(SQL).run(String(a.request_id), a.kind, a.group || null); });
  return;
}

/** Delete rows older than `days`; returns the number removed. */
async function purge(db, days = 90) {
  const { H, isPg } = _h(db);
  const d = Math.max(1, Number(days) || 90);
  const r = await H.prepare(`DELETE FROM sla_alert_log WHERE sent_at < now() - (? * interval '1 day')`).run(d);
  return r.changes || 0;
}

module.exports = { filterUnsent, record, purge };
