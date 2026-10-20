'use strict';
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

router.get('/api/reports/config', requireReportSession, requireSuperAdmin, async (req, res) => {
  try {
    const c = await reportConfig.getConfig(rdb.db);
    if (c && c.smtp_pass) c.smtp_pass = '';   // never expose the stored SMTP password
    if (c && c.entra_client_secret) c.entra_client_secret = '';   // never expose the stored SSO secret
    if (c && c.meridian_out_key) c.meridian_out_key = '';   // never expose the stored Meridian keys
    if (c && c.meridian_in_key) c.meridian_in_key = '';
    if (c && c.meraki_api_key) c.meraki_api_key = '';   // never expose the stored Meraki API key
    if (c && c.opmanager_api_key) c.opmanager_api_key = '';   // never expose the stored OpManager API key
    for (const k of ['sdp_api_client_secret', 'sdp_api_refresh_token', 'teams_sla_channels', 'analytics_client_secret', 'analytics_refresh_token', 'sync_alert_teams_url']) if (c && c[k]) c[k] = '';   // Teams SLA + Analytics secrets
    res.json(c);
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/api/reports/config', requireReportSession, requireSuperAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    // SSO settings (mode / secret / tenant) are auth-critical. The endpoint is
    // requireAdmin (shared with SMTP etc.), so enforce super_admin server-side for
    // the SSO keys — the UI hide alone is not a boundary.
    const SSO_KEYS = ['sso_mode','entra_tenant_id','entra_client_id','entra_client_secret','entra_redirect_uri','sso_breakglass_user'];
    if (SSO_KEYS.some(k => k in body) && req.reportUser?.role !== 'super_admin') {
      return res.status(403).json({ error: 'SSO settings require super_admin' });
    }
    // Meridian federation keys carry a service secret (out/in API keys) → super_admin only.
    const MERIDIAN_KEYS = ['meridian_base_url','meridian_out_key','meridian_in_key'];
    if (MERIDIAN_KEYS.some(k => k in body) && req.reportUser?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Meridian settings require super_admin' });
    }
    // Meraki API key carries a service secret → super_admin only (org_id/base_url/policy too, kept simple).
    const MERAKI_KEYS = ['meraki_api_key','meraki_org_id','meraki_base_url','meraki_missing_policy'];
    if (MERAKI_KEYS.some(k => k in body) && req.reportUser?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Meraki settings require super_admin' });
    }
    const OPMANAGER_KEYS = ['opmanager_api_key','opmanager_base_url','opmanager_tls_insecure'];
    if (OPMANAGER_KEYS.some(k => k in body) && req.reportUser?.role !== 'super_admin') {
      return res.status(403).json({ error: 'OpManager settings require super_admin' });
    }
    const out = await reportConfig.setConfig(rdb.db, body, req.reportUser?.username);
    require('../services/ssoSettings')._invalidate();   // config changed → re-read next request
    res.json(out);
  }
  catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(502).json({ error: String(e.message || e).slice(0, 400) }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});


  return router;
};
