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
  // Asset engagement reminders (2026-09-18) — both armed OFF. Recipients come from
  // the directory (asset manager, coordinator in copy). Must live in DEFAULTS or
  // setConfig's KEYS filter silently drops the admin's write.
  asset_reminder_send_enabled: '0',
  asset_new_alert_enabled: '0',
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
  // Step 4 — Entra groups → roles/sites (armed off) and automatic deactivation of departed accounts (armed off).
  sso_group_sync: '0', sso_group_map: '[]', sso_deprovision_enabled: '0',
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
  // Comma-separated substrings that identify the OpManager monitoring servers
  // themselves (remote probes + central). These devices are EXCLUDED from the
  // business availability pools, and their own downtime flags the affected site's
  // period as a monitoring blind spot. Case-insensitive substring match on device key.
  opm_monitor_patterns: 'opma,abj-spm-000',
  // ── Meraki Dashboard API (V1b — WAN availability & quality). api_key is a SECRET
  //    (redacted on GET, blank-kept on save like smtp_pass); org_id + base_url are not.
  //    missing_policy is the calibration output ('down'|'unknown', §7) — MUST live here
  //    or setConfig's KEYS filter silently drops the calibrated value.
  meraki_api_key: '', meraki_org_id: '',
  meraki_base_url: 'https://api.meraki.com/api/v1',
  meraki_missing_policy: 'down',
  // ── OpManager REST API (V1b-B — LAN/WLAN/Servers device availability). api_key is a
  //    SECRET (redact/blank-keep/super_admin); base_url points at the on-prem server;
  //    tls_insecure tolerates its self-signed cert. '1' = insecure (default).
  opmanager_base_url: '', opmanager_api_key: '', opmanager_tls_insecure: '0', opmanager_ca_file: '', opmanager_apikey_in_query: '0',
  // ── WAN SLA / ISP chargeback (V1c). The tier/circuit policy (JSON) that the SLA
  //    engine + credit reader resolve per (site_id, sub_site, uplink). Seeded as a
  //    JSON string (like asset_depreciation_config). Must live here or setConfig's
  //    KEYS filter silently drops the admin's write and the module stays inert.
  sla_wan_config: JSON.stringify(require('./slaWanConfig').DEFAULT_SLA_WAN_CONFIG),
  // Heartbeat: the WAN outage poller stamps its last-run ISO timestamp here. WAN Health uses
  // it to know monitoring is live → a circuit with no outages reads 100% (not '—'); if unset
  // (poller never ran), event-based availability is '—' rather than a fabricated 100%.
  wan_poll_last_run: '',
  wan_poll_first_run: '',   // when WAN monitoring began — availability denominator is clamped to it
  // Quality-weighted availability thresholds — LEGACY min-model, superseded by wan_mos_config below.
  wan_quality_thresholds: '{"loss":{"good":1,"bad":7},"latency":{"good":100,"bad":400},"jitter":{"good":30,"bad":100}}',
  // WAN Quality = ITU-T G.107 "E-model": loss/latency/jitter → R-factor (0-100, the "Qualité %") → MOS
  // (1..4.5). Defaults are G.711 wired. codec_loss_factor: R lost per 1% loss (G.711 2.5 / G.729 ~4);
  // advantage_factor: 0 wired, 10-20 for satellite/VSAT tolerance.
  wan_mos_config: '{"r0":93.2,"codec_loss_factor":2.5,"jitter_buffer_factor":2,"base_delay_ms":10,"advantage_factor":0}',
  // "% Time Up" down-thresholds (approximate Meraki's Summary Report, which counts high-loss /
  // timeout samples as down — NOT only 100% loss). loss_pct = an interval with loss ≥ this is
  // down (default 100 = the plain loss<100 rule); latency_ms = an interval slower than this is
  // down (blank = no latency cap). Tune loss_pct down (~15-25) to land on Meraki's % Time Up.
  wan_timeup_loss_pct: '100',
  wan_timeup_latency_ms: '',
  // ── Teams SLA alerts (2026-10-03) — tools/teams/poll-sla.js, every 5 min. Disarmed by default.
  //    The SDP Cloud API is read with a Zoho OAuth self-client (scope SDPOnDemand.requests.READ):
  //    client_secret + refresh_token are SECRETS. teams_sla_channels = JSON [{group, url}] — a
  //    Workflows webhook URL lets anyone post in the channel, so the whole blob is a SECRET too
  //    (redacted on GET, blank-kept, encrypted at rest); the dedicated /api/teams-sla routes
  //    expose only which groups are mapped. teams_sla_rules = JSON (services/teamsSla.DEFAULT_RULES).
  teams_sla_enabled: '0', teams_sla_rules: '', teams_sla_channels: '', teams_sla_last_run: '',
  // ── Step 1 (SDP-DASH-2.0) sync alerts: e-mail after N consecutive failures / staleness,
  //    optional Teams card to the DEFAULT ('*') channel of teams_sla_channels. Armed OFF.
  //    Must live in DEFAULTS or setConfig's KEYS filter silently drops the admin's write.
  sync_alert_enabled: '0', sync_alert_recipients: '', sync_alert_teams: '0',
  sdp_api_base_url: 'https://oneitsupport.endeavourmining.com/app/itdesk/api/v3',
  sdp_api_accounts_url: 'https://accounts.zoho.com',
  sdp_api_client_id: '', sdp_api_client_secret: '', sdp_api_refresh_token: '',
  sdp_api_open_filter: 'Open_System',
  // ── Zoho Analytics connection (helpdesk data), editable in Admin ▸ Intégration API ▸ Analytics
  //    (2026-10-04). BLANK = use .env (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN /
  //    WORKSPACE_ID / ORG_ID) — services/analyticsSettings resolves database → .env → default.
  analytics_client_id: '', analytics_client_secret: '', analytics_refresh_token: '',
  analytics_workspace_id: '', analytics_org_id: '', analytics_accounts_url: '',
  // Step 9 — e-mail delivery of the alert rules and of the daily notification digest: armed OFF (in-app only).
  engagement_email: '0',
  // Step 9 — the indicators published to the OData feed / scheduled publications (comma list of dictionary keys).
  // EMPTY = the default set of services/publication/snapshot.js (the six service objectives + volume and backlog).
  published_metrics: '',
};
const KEYS = Object.keys(DEFAULTS);

// Secrets that the GET handler redacts to '' — a Save that doesn't retype them must
// NOT wipe the stored value (blank = keep). Any new secret-shaped key joins this set.
const _SECRET_BLANK_KEEP = new Set([
  'smtp_pass', 'entra_client_secret', 'meridian_out_key', 'meridian_in_key', 'meraki_api_key', 'opmanager_api_key',
  'sdp_api_client_secret', 'sdp_api_refresh_token', 'teams_sla_channels',
  'analytics_client_secret', 'analytics_refresh_token',
]);

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

// A-13 (audit 2026-09-24) — the six secret-shaped values are encrypted at rest when
// SDP_CONFIG_KEY is set, so a database dump (or a restore point) no longer hands whoever
// holds it the SSO client secret. With no key, everything below is a no-op and the
// behaviour is byte-identical to before: nobody is locked out of SMTP by a deploy that
// forgot to set a variable.
const _secrets = require('./configSecrets');
const _keyOf = (opts) => {
  if (opts && 'key' in opts) return opts.key ? _secrets.keyFrom(opts.key) : null;
  return _secrets.envKey();
};

function _fold(rows, key) {
  const out = { ...DEFAULTS };
  rows.forEach(r => {
    if (!_SECRET_BLANK_KEEP.has(r.key)) { out[r.key] = r.value; return; }
    const plain = _secrets.decryptValue(r.value, key);
    if (plain === null) {
      // An encrypted value we cannot open. Returning the box would make nodemailer or the
      // SSO handshake fail with an error nobody can read, so it reads as "not configured"
      // and says why, once, in the log.
      console.warn(`[report-config] ${r.key} is encrypted but SDP_CONFIG_KEY is missing or wrong — read as empty.`);
      out[r.key] = '';
      return;
    }
    out[r.key] = plain;
  });
  return out;
}
function getConfig(db, opts) {
  const key = _keyOf(opts);
  const { H, isPg } = _h(db);
  if (isPg) return (async () => _fold(await H.prepare('SELECT key, value FROM report_config').all(), key))();
  _initSchema(db);
  try { return _fold(H.prepare('SELECT key, value FROM report_config').all(), key); }
  catch (e) { console.warn('[report-config] get failed:', e.message); return { ...DEFAULTS }; }
}

const _UPSERT = `INSERT INTO report_config (key, value, updated_at, updated_by)
  VALUES (?, ?, {NOW}, ?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`;
function setConfig(db, patch, user, opts) {
  const _key = _keyOf(opts);
  // A blank smtp_pass means "keep the existing password" — the GET handler
  // redacts it to '', so a Save that doesn't retype it must NOT wipe the stored value.
  const clean = Object.entries(patch || {})
    .filter(([k]) => KEYS.includes(k))
    .filter(([k, v]) => !(_SECRET_BLANK_KEEP.has(k) && String(v) === ''))
    // Encrypt on the way in, and only the secret-shaped keys: a host or a port stays
    // legible so an operator can still read the table when something is wrong.
    .map(([k, v]) => [k, _SECRET_BLANK_KEEP.has(k) ? _secrets.encryptValue(String(v), _key) : v]);
  const { H, isPg } = _h(db);
  if (isPg) return (async () => {
    await H.runTransaction(async () => {
      for (const [k, v] of clean) await H.prepare(_UPSERT.replace('{NOW}', 'now()')).run(k, String(v), user || 'unknown');
    });
    return getConfig(db, opts);
  })();
  _initSchema(db);
  const stmt = H.prepare(_UPSERT.replace('{NOW}', "datetime('now')"));
  H.transaction(() => { for (const [k, v] of clean) stmt.run(k, String(v), user || 'unknown'); })();
  return getConfig(db, opts);
}

module.exports = { DEFAULTS, KEYS, _SECRET_BLANK_KEEP, _initSchema, getConfig, setConfig };
