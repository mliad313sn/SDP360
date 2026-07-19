'use strict';
// Delivery settings for the reporting suite — key/value in report_config.
// sqlite + PG fork via the same _h(db) resolver used by groupPresets.js.

const DEFAULTS = {
  transport: 'smtp',
  smtp_host: '', smtp_port: '587', smtp_secure: '0', smtp_user: '', smtp_pass: '',
  from: '', reply_to: '',
  default_email_domain: 'edv-ops.com',
  formats: 'html,pdf',
  never_send_unconfirmed: '1',
  group_report_to: '', group_report_cc: '', group_report_to_confirmed: '0',
  hygiene_recipients: '', hygiene_send_enabled: '0',
  xof_usd_rate: '0.00165',
  // Annual replacement-price uplift (%) for the investment forecast — 0 = like-for-like.
  // Must live in DEFAULTS so setConfig's KEYS filter accepts the admin's write.
  asset_replacement_uplift_pct: '0',
  // Asset depreciation policy (JSON) — the computed-book-value reader resolves a
  // method/useful-life/salvage per product_type from this. Must live in DEFAULTS
  // so setConfig's KEYS filter accepts the admin's write (else silently dropped).
  asset_depreciation_config: JSON.stringify(require('./depreciation').DEFAULT_DEPRECIATION_CONFIG),
};
const KEYS = Object.keys(DEFAULTS);

function _h(db) {
  const rdb = require('../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  return { H: db, isPg: false };
}

const _inited = new WeakSet();
function _initSchema(db) {
  if (_h(db).isPg) return;
  if (_inited.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS report_config (
    key TEXT PRIMARY KEY, value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_by TEXT
  );`);
  _inited.add(db);
}

function _fold(rows) {
  const out = { ...DEFAULTS };
  rows.forEach(r => { out[r.key] = r.value; });
  return out;
}
function getConfig(db) {
  const { H, isPg } = _h(db);
  if (isPg) return (async () => _fold(await H.prepare('SELECT key, value FROM report_config').all()))();
  _initSchema(db);
  try { return _fold(H.prepare('SELECT key, value FROM report_config').all()); }
  catch (e) { console.warn('[report-config] get failed:', e.message); return { ...DEFAULTS }; }
}

const _UPSERT = `INSERT INTO report_config (key, value, updated_at, updated_by)
  VALUES (?, ?, {NOW}, ?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`;
function setConfig(db, patch, user) {
  // A blank smtp_pass means "keep the existing password" — the GET handler
  // redacts it to '', so a Save that doesn't retype it must NOT wipe the stored value.
  const clean = Object.entries(patch || {})
    .filter(([k]) => KEYS.includes(k))
    .filter(([k, v]) => !(k === 'smtp_pass' && String(v) === ''));
  const { H, isPg } = _h(db);
  if (isPg) return (async () => {
    await H.runTransaction(async () => {
      for (const [k, v] of clean) await H.prepare(_UPSERT.replace('{NOW}', 'now()')).run(k, String(v), user || 'unknown');
    });
    return getConfig(db);
  })();
  _initSchema(db);
  const stmt = H.prepare(_UPSERT.replace('{NOW}', "datetime('now')"));
  H.transaction(() => { for (const [k, v] of clean) stmt.run(k, String(v), user || 'unknown'); })();
  return getConfig(db);
}

module.exports = { DEFAULTS, KEYS, _initSchema, getConfig, setConfig };
