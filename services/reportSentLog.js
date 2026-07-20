'use strict';
// Idempotency + audit for report sends. alreadySentToday() dedups a
// (type,site,period) send within the same calendar day.

function _h(db) {
  const rdb = require('../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  return { H: db, isPg: false };
}

const _inited = new WeakSet();
function _initSchema(db) {
  if (_h(db).isPg) return;
  if (_inited.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS report_sent_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, report_type TEXT, site_code TEXT, period TEXT,
    recipients TEXT, result TEXT, sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS ix_report_sent_log_dedup ON report_sent_log(report_type, site_code, period);`);
  _inited.add(db);
}

function record(db, { report_type, site_code, period, recipients, result }) {
  const { H, isPg } = _h(db);
  const SQL = `INSERT INTO report_sent_log (report_type, site_code, period, recipients, result) VALUES (?, ?, ?, ?, ?)`;
  if (isPg) return (async () => { await H.prepare(SQL).run(report_type, site_code, period, recipients, result); return { ok: true }; })();
  _initSchema(db);
  H.prepare(SQL).run(report_type, site_code, period, recipients, result);
  return { ok: true };
}

// The SUCCESS results are 'ok' (a normal send) and 'resent' (a deliberate
// force=1 re-send). BOTH must count here: tagging a re-send 'resent' purely for
// traceability, while dedup looked only for 'ok', would make a force-first send
// leave the period looking un-sent — the very skip this function exists for
// would then never fire. 'fail' stays excluded so a failure is retryable.
function alreadySentToday(db, report_type, site_code, period) {
  const { H, isPg } = _h(db);
  if (isPg) return (async () => {
    const r = await H.prepare(`SELECT 1 FROM report_sent_log WHERE report_type=? AND site_code=? AND period=? AND result IN ('ok','resent') AND sent_at::date = current_date LIMIT 1`).get(report_type, site_code, period);
    return !!r;
  })();
  _initSchema(db);
  const r = H.prepare(`SELECT 1 FROM report_sent_log WHERE report_type=? AND site_code=? AND period=? AND result IN ('ok','resent') AND date(sent_at)=date('now') LIMIT 1`).get(report_type, site_code, period);
  return !!r;
}

module.exports = { _initSchema, record, alreadySentToday };
