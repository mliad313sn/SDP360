'use strict';
const { fail } = require('../services/httpError');
// ─────────────────────────────────────────────────────────────────────────
// Report config + integrations routes (/api/reports/config, /api/integrations/analytics*, /api/reports/test-smtp) — extracted from server.js (fiche M12-a, 2026-10-20), same
// dependency-injection pattern as routes/inspection.js. Handlers are byte-for-byte
// the inline ones; only `app.` → `router.` and `require('./x')` → `require('../x')`.
//
// Wiring in server.js:
//   app.use(require('./routes/adminConfig')({
//     express, rdb, reportConfig, requireReportSession, requireSuperAdmin,
//     tokenState, refreshAccessToken, applyAnalyticsSettings: _applyAnalyticsSettings,
//   }));
// ─────────────────────────────────────────────────────────────────────────
module.exports = function adminConfigRoutes(deps) {
  const {
    express, rdb, reportConfig, requireReportSession, requireSuperAdmin,
    tokenState, refreshAccessToken, applyAnalyticsSettings: _applyAnalyticsSettings,
  } = deps;
  const router = express.Router();
  const safeUrl = require('../services/safeUrl');
  // M4 — the config keys that hold an outbound URL the server will call.
  const URL_KEYS = ['opmanager_base_url', 'meraki_base_url', 'sdp_api_base_url', 'sdp_api_accounts_url',
    'engagement_teams_url', 'engagement_webhook_url', 'publish_webhook_url', 'sync_alert_teams_url'];
  const _s = (v) => String(v == null ? '' : v).trim();
  /** Returns an error message for the first changed, non-blank URL that fails the guard; null when all pass. */
  async function checkOutboundUrls(body, cur) {
    const allow = safeUrl.allowHostsFromConfig({ ...(cur || {}), ...(body || {}) });
    for (const k of URL_KEYS) {
      if (!(k in body)) continue;
      const v = _s(body[k]);
      if (!v || v === _s(cur && cur[k])) continue;          // blank = clear; unchanged = already accepted
      try { await safeUrl.validateOutboundUrl(v, { allowHosts: allow }); }
      catch (e) { return `${k}: ${e.message}`; }
    }
    return null;
  }
  /** System log: one `config_url_changed` row per changed URL key, scheme+host only (a webhook URL is a secret). */
  function logUrlChanges(req, body, cur) {
    for (const k of URL_KEYS) {
      if (!(k in body)) continue;
      const before = _s(cur && cur[k]), after = _s(body[k]);
      if (before === after) continue;
      if (!after && reportConfig._SECRET_BLANK_KEEP.has(k)) continue;   // blank secret-shaped URL = keep stored, no change

      try {
        rdb.logEvent({ category: 'config', action: 'config_url_changed', target: k,
          details: { from: before ? safeUrl.redactUrl(before) : '', to: after ? safeUrl.redactUrl(after) : '' }, ...rdb._logCtx(req) });
      } catch (_) { /* best-effort */ }
    }
    if ('outbound_allow_hosts' in body && _s(body.outbound_allow_hosts) !== _s(cur && cur.outbound_allow_hosts)) {
      try { rdb.logEvent({ category: 'config', action: 'config_url_changed', target: 'outbound_allow_hosts', details: { from: _s(cur && cur.outbound_allow_hosts), to: _s(body.outbound_allow_hosts) }, ...rdb._logCtx(req) }); } catch (_) { /* best-effort */ }
    }
  }

// Never hand a stored secret back to the browser: every secret-shaped key (the blank-keep set — the same set
// that is encrypted at rest) is blanked on the GET AND on the PUT answer (setConfig returns the full, decrypted
// config). C-23 found sharepoint_client_secret, engagement/publish webhook URLs coming back on GET, and every
// stored secret coming back in the PUT answer. The CA bundle keeps its presence flag (opmanager_ca_bundle_set).
function redactSecrets(c) {
  if (!c || typeof c !== 'object') return c;
  c.opmanager_ca_bundle_set = !!c.opmanager_ca_bundle;
  for (const k of reportConfig._SECRET_BLANK_KEEP) if (c[k]) c[k] = '';
  return c;
}
router.get('/api/reports/config', requireReportSession, requireSuperAdmin, async (req, res) => {
  try {
    res.json(redactSecrets(await reportConfig.getConfig(rdb.db)));
  }
  catch (e) { fail(res, e); }
});
// E-A07 — GET /api/reports/config/history?key=&limit= : the config_changed journal (newest first, no secret values).
router.get('/api/reports/config/history', requireReportSession, requireSuperAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number.parseInt(req.query.limit, 10) || 100));
    const key = String(req.query.key || '').trim().slice(0, 80);
    const fetchN = key ? 2000 : limit;
    const { rows } = await rdb.listSystemLog({ category: 'config', action: 'config_changed' }, { limit: fetchN });
    const out = require('../services/configJournal').historyRows(rows).filter((r) => !key || r.key === key).slice(0, limit);
    res.json({ rows: out });
  }
  catch (e) { fail(res, e); }
});
router.put('/api/reports/config', requireReportSession, requireSuperAdmin, async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    const reason = body.reason; delete body.reason;   // E-A07 — optional, stored with each journal row
    // SSO settings (mode / secret / tenant) are auth-critical. The endpoint is
    // requireAdmin (shared with SMTP etc.), so enforce super_admin server-side for
    // the SSO keys — the UI hide alone is not a boundary.
    const SSO_KEYS = ['sso_mode','entra_tenant_id','entra_client_id','entra_client_secret','entra_redirect_uri','sso_breakglass_user'];
    if (SSO_KEYS.some(k => k in body) && req.reportUser?.role !== 'super_admin') {
      return res.status(403).json({ error: 'SSO settings require super_admin' });
    }
    // Meridian federation keys carry a service secret (out/in API keys) → super_admin only.
    const MERIDIAN_KEYS = ['meridian_base_url','meridian_out_key','meridian_in_key','meridian_enabled'];
    if (MERIDIAN_KEYS.some(k => k in body) && req.reportUser?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Meridian settings require super_admin' });
    }
    // Meraki API key carries a service secret → super_admin only (org_id/base_url/policy too, kept simple).
    const MERAKI_KEYS = ['meraki_api_key','meraki_org_id','meraki_base_url','meraki_missing_policy'];
    if (MERAKI_KEYS.some(k => k in body) && req.reportUser?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Meraki settings require super_admin' });
    }
    const OPMANAGER_KEYS = ['opmanager_api_key','opmanager_base_url','opmanager_tls_insecure','opmanager_ca_bundle'];
    if (OPMANAGER_KEYS.some(k => k in body) && req.reportUser?.role !== 'super_admin') {
      return res.status(403).json({ error: 'OpManager settings require super_admin' });
    }
    // M4 — outbound URLs (webhooks, API base URLs) are validated BEFORE they are stored:
    // https only, never a private / loopback / link-local / metadata address unless the host
    // is on the allow list (outbound_allow_hosts). Only a CHANGED value is checked, so a form
    // that re-sends an unchanged URL cannot block an unrelated save; the send-time guard in the
    // clients re-checks every call anyway. Each change is journalled as scheme+host only.
    const cur = await reportConfig.getConfig(rdb.db);
    const denied = await checkOutboundUrls(body, cur);
    if (denied) return res.status(400).json({ error: denied });
    const out = await reportConfig.setConfig(rdb.db, body, req.reportUser?.username);
    require('../services/ssoSettings')._invalidate();   // config changed → re-read next request
    require('../services/dashKeyScope')._invalidate();
    logUrlChanges(req, body, cur);
    // E-A07 — one system_log row per ACTUALLY changed key (secrets: set/cleared only) + prerequisite warnings
    const J = require('../services/configJournal');
    J.journal((ev) => rdb.logEvent(ev), J.diffConfig(cur, body, { keys: reportConfig.KEYS, secretSet: reportConfig._SECRET_BLANK_KEEP, blankKeep: reportConfig._SECRET_BLANK_KEEP }), rdb._logCtx(req), reason);
    res.json({ ...redactSecrets(out), warnings: require('../services/switchPrereqs').warningsFor(body, cur) });
  }
  catch (e) { fail(res, e); }
});
// ── Zoho Analytics connection (2026-10-04) — Admin ▸ Intégration API ▸ Analytics. Secrets are
// write-only (GET says whether one is stored and where each value comes from: db / env / default).
router.get('/api/integrations/analytics', requireReportSession, requireSuperAdmin, async (req, res) => {
  try {
    const A = require('../services/analyticsSettings');
    A._invalidate();
    const s = await A.resolveAnalyticsSettings();
    res.json({
      client_id: s.clientId, workspace_id: s.workspaceId, org_id: s.orgId, accounts_url: s.accountsUrl,
      has_client_secret: !!s.clientSecret, has_refresh_token: !!s.refreshToken, sources: s.sources, ready: s.ready,
      token: { valid: Date.now() < tokenState.expiresAt, expires_at: tokenState.expiresAt ? new Date(tokenState.expiresAt).toISOString() : null,
        granted_scope: tokenState.grantedScope || null, last_error: tokenState.lastRefreshError || null },
    });
  } catch (e) { fail(res, e); }
});
router.put('/api/integrations/analytics', requireReportSession, requireSuperAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const map = { client_id: 'analytics_client_id', client_secret: 'analytics_client_secret', refresh_token: 'analytics_refresh_token',
      workspace_id: 'analytics_workspace_id', org_id: 'analytics_org_id', accounts_url: 'analytics_accounts_url' };
    const patch = {};
    for (const [k, key] of Object.entries(map)) if (k in b) patch[key] = String(b[k] == null ? '' : b[k]).trim();
    if (patch.analytics_accounts_url && !/^https:\/\/\S+$/i.test(patch.analytics_accounts_url)) return res.status(400).json({ error: 'Serveur OAuth : https:// requis' });
    await reportConfig.setConfig(rdb.db, patch, req.reportUser?.username);
    require('../services/analyticsSettings')._invalidate();
    await _applyAnalyticsSettings();
    tokenState.accessToken = null; tokenState.expiresAt = 0;   // next Analytics call refreshes with the new credentials
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});
// Refresh the token NOW with the stored settings → proves the credentials + shows the scope.
router.post('/api/integrations/analytics/test', requireReportSession, requireSuperAdmin, async (req, res) => {
  try {
    require('../services/analyticsSettings')._invalidate();
    tokenState.accessToken = null; tokenState.expiresAt = 0;
    await refreshAccessToken();
    const scope = tokenState.grantedScope || '';
    res.json({ ok: true, granted_scope: scope || null,
      warning: scope && !scope.includes('MEAplus.fullaccess') ? 'Scope différent de MEAplus.fullaccess.all — certaines vues renverront 7301.' : null });
  } catch (e) { fail(res, e, 502, { error: 'Token refresh failed — see the server log (correlation_id).' }); }
});

// Tests the settings the admin is LOOKING AT, not only the last-saved ones:
// the form's values (if posted) are overlaid on the stored config. Previously
// this read only the saved config, so testing before Save silently probed an
// empty host — which nodemailer turns into `ECONNREFUSED 127.0.0.1:587`.
// The password field is deliberately never echoed back to the browser
// (reports.html), so a blank one means "keep the stored secret" — the exact
// rule the Save path already uses.
router.post('/api/reports/test-smtp', requireReportSession, requireSuperAdmin, async (req, res) => {
  try {
    const { buildMailer } = require('../services/mailer');
    const cfg = Object.assign({}, await reportConfig.getConfig(rdb.db));
    const body = req.body || {};
    for (const k of ['transport', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'from', 'reply_to']) {
      if (body[k] !== undefined && body[k] !== null) cfg[k] = String(body[k]);
    }
    if (body.smtp_pass) cfg.smtp_pass = String(body.smtp_pass);
    res.json(await buildMailer(cfg).verify());
  } catch (e) { fail(res, e); }
});


  return router;
};
