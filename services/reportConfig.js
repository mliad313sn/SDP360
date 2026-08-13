'use strict';
// Delivery settings for the reporting suite — key/value in report_config.
// sqlite + PG fork via the same _h(db) resolver used by groupPresets.js.

const DEFAULTS = {
  transport: 'smtp',
  smtp_host: '', smtp_port: '587', smtp_secure: '0', smtp_user: '', smtp_pass: '',
  from: '', reply_to: '',
  default_email_domain: 'edv-ops.com',
  // Public origin of this dashboard (e.g. https://itops-dashboard.edv-ops.com),
  // used to turn e-mail figures into links the reader can act on. EMPTY BY
  // DEFAULT and every consumer must degrade to plain text: a guessed or stale
  // origin produces dead links in an e-mail that has already left the building,
  // which is worse than no link. No trailing slash — consumers append '/…'.
  public_base_url: '',
  formats: 'html,pdf',
  never_send_unconfirmed: '1',
  group_report_to: '', group_report_cc: '', group_report_to_confirmed: '0',
  hygiene_recipients: '', hygiene_send_enabled: '0',
  // Scheduled per-coordinator operational scoreboard email — armed OFF by
  // default. Arm flag ONLY (recipients come from the coordinator directory, not
  // a config list). Must live in DEFAULTS so setConfig's KEYS filter accepts it.
  scoreboard_send_enabled: '0',
  // Scheduled per-coordinator WEEKLY report email — armed OFF by default. Arm
  // flag ONLY (recipients come from the coordinator directory, not a config
  // list). Must live in DEFAULTS so setConfig's KEYS filter accepts it.
  weekly_report_send_enabled: '0',
  // Scheduled monthly "Assets — Groupe" management digest — armed OFF by default.
  // A GROUP sender (like hygiene): arm flag + a recipients comma-list (no directory).
  // Both must live in DEFAULTS so setConfig's KEYS filter accepts the admin's write
  // (else silently dropped and the digest is permanently inert).
  asset_group_send_enabled: '0',
  asset_group_recipients: '',
  // Fenêtre « vu récemment » de la réconciliation AD/Entra, en jours. Il n'existe
  // pas de bonne valeur universelle — un site à rotation lente voudra 60, une
  // campagne de déploiement 7 — et la valeur retenue est affichée dans l'en-tête
  // du rapport : un seuil implicite rend deux rapports incomparables.
  // DOIT figurer ici ou setConfig filtre la clé sur KEYS.includes(k) et l'écriture
  // de l'admin disparaît sans erreur.
  reconcile_recent_days: '30',
  xof_usd_rate: '0.00165',
  // Annual replacement-price uplift (%) for the investment forecast — 0 = like-for-like.
  // Must live in DEFAULTS so setConfig's KEYS filter accepts the admin's write.
  asset_replacement_uplift_pct: '0',
  // Asset depreciation policy (JSON) — the computed-book-value reader resolves a
  // method/useful-life/salvage per product_type from this. Must live in DEFAULTS
  // so setConfig's KEYS filter accepts the admin's write (else silently dropped).
  asset_depreciation_config: JSON.stringify(require('./depreciation').DEFAULT_DEPRECIATION_CONFIG),
  // ── F2a: Entra SSO (admin-configurable; resolved by services/ssoSettings.js as
  //    DB ?? .env ?? default). entra_client_secret is redacted on GET and blank-kept
  //    on save, exactly like smtp_pass. Must live in DEFAULTS or setConfig drops them.
  sso_mode: '', entra_tenant_id: '', entra_client_id: '', entra_client_secret: '',
  entra_redirect_uri: '', sso_breakglass_user: '',
  // ── F1: Meridian PMO federation. base_url + two API keys. out_key = SDP presents
  //    it to Meridian (sync + link read-back); in_key = SDP requires it inbound on
  //    /api/actions/open. Both keys are secrets: redacted on GET, blank-kept on save
  //    like smtp_pass / entra_client_secret. Must live here or setConfig drops them.
  meridian_base_url: '', meridian_out_key: '', meridian_in_key: '',
  // ── OPManager infra availability (V1a). The Analytics Plus view id OPS reads via
  //    fetchView; per-family availability targets (JSON); staleness threshold (days).
  //    Non-secret. Must live here or setConfig's KEYS filter silently drops them.
  opm_availability_view_id: '',
  opm_targets: JSON.stringify({ lan: 99, wifi: 98, wan: 98, servers: 99 }),
  opm_stale_days: '9',
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
    .filter(([k, v]) => !((k === 'smtp_pass' || k === 'entra_client_secret' || k === 'meridian_out_key' || k === 'meridian_in_key') && String(v) === ''));
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
