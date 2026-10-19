'use strict';
// Teams SLA alerts (2026-10-03) — anti-duplicate log: one alert per (ticket, kind),
// ever. sqlite (created here, lazily) + PostgreSQL (db/postgres/reports/013_sla_alert_log.sql,
// applied by initPgReports). Every function returns a Promise on both backends.

function _h(db) {
  const rdb = require('../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  return { H: db || rdb.db, isPg: false };
}

const _inited = new WeakSet();
function _initSchema(db) {
  if (_inited.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS sla_alert_log (
    request_id TEXT NOT NULL, kind TEXT NOT NULL, group_name TEXT,
    sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (request_id, kind)
  );
  CREATE INDEX IF NOT EXISTS ix_sla_alert_log_sent ON sla_alert_log (sent_at);`);
  _inited.add(db);
}

const _k = (a) => `${a.request_id}|${a.kind}`;

/** The alerts never sent before (order kept). */
async function filterUnsent(db, alerts) {
  if (!alerts || !alerts.length) return [];
  const { H, isPg } = _h(db);
  if (!isPg) _initSchema(H);
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
  const SQL = isPg
    ? 'INSERT INTO sla_alert_log (request_id, kind, group_name) VALUES (?, ?, ?) ON CONFLICT (request_id, kind) DO NOTHING'
    : 'INSERT OR IGNORE INTO sla_alert_log (request_id, kind, group_name) VALUES (?, ?, ?)';
  if (isPg) {
    await H.runTransaction(async () => { for (const a of alerts) await H.prepare(SQL).run(String(a.request_id), a.kind, a.group || null); });
    return;
  }
  _initSchema(H);
  const st = H.prepare(SQL);
  H.transaction(() => { for (const a of alerts) st.run(String(a.request_id), a.kind, a.group || null); })();
}

/** Delete rows older than `days`; returns the number removed. */
async function purge(db, days = 90) {
  const { H, isPg } = _h(db);
  const d = Math.max(1, Number(days) || 90);
  if (isPg) {
    const r = await H.prepare(`DELETE FROM sla_alert_log WHERE sent_at < now() - (? * interval '1 day')`).run(d);
    return r.changes || 0;
  }
  _initSchema(H);
  return H.prepare(`DELETE FROM sla_alert_log WHERE sent_at < datetime('now', ?)`).run(`-${d} days`).changes;
}

module.exports = { _initSchema, filterUnsent, record, purge };
