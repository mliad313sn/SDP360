'use strict';
// ---------------------------------------------------------------------------
// Reporting configuration routes - extracted from server.js (SDP-DASH-2.0 step 5,
// lot 5.3, 2026-10-22). Same dependency-injection pattern as routes/inspection.js:
// handlers unchanged, `app.` became `router.`, `require('./` became `require('../`.
// Covers /api/reports/config, /api/integrations/analytics, /api/meridian/sync,
// /api/reports/{recipients,schedule,exec-editorial}. The router is mounted where the
// block used to sit, so the registration order (and /api/reports/:id shadowing) is unchanged.
// ---------------------------------------------------------------------------
module.exports = function reportsConfigRoutes(deps) {
  const {
    express, rdb, requireReportSession, requireAdmin, requireSuperAdmin,
    reportConfig, reportDirectory, reportSchedule,
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
      for (const k of ['sdp_api_client_secret', 'sdp_api_refresh_token', 'teams_sla_channels', 'analytics_client_secret', 'analytics_refresh_token']) if (c && c[k]) c[k] = '';   // Teams SLA + Analytics secrets
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
      const SSO_KEYS = ['sso_mode','entra_tenant_id','entra_client_id','entra_client_secret','entra_redirect_uri','sso_breakglass_user',
        'sso_group_sync','sso_group_map','sso_deprovision_enabled'];
      // Step 4: a group map that does not validate is refused (it would lock every SSO user out).
      if ('sso_group_map' in body) {
        const gm = require('../services/ssoGroupSync').parseGroupMap(String(body.sso_group_map || '[]'));
        if (gm.errors.length) return res.status(400).json({ error: 'Group map: ' + gm.errors.join('; ') });
      }
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
      const OPMANAGER_KEYS = ['opmanager_api_key','opmanager_base_url','opmanager_tls_insecure','opmanager_ca_file','opmanager_apikey_in_query'];
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

  // Meridian resource sync — on-demand (admin+). Runs the same job as the nightly cron;
  // self-skips when unconfigured. Behind the /api/ dash-key gate + session/admin.
  router.post('/api/meridian/sync', requireReportSession, requireSuperAdmin, async (req, res) => {
    try { res.json(await require('../tools/meridian/sync-resources').main()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/api/reports/recipients', requireReportSession, requireSuperAdmin, async (req, res) => {
    try { res.json(await reportDirectory.listRecipients(rdb.db)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/api/reports/recipients/:site', requireReportSession, requireSuperAdmin, async (req, res) => {
    try { res.json(await reportDirectory.upsertRecipient(rdb.db, req.params.site, req.body || {}, req.reportUser?.username)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Pre-fills blank recipient names from meetings PV data. Never overwrites a
  // confirmed value; the admin still confirms every address before any send.
  router.post('/api/reports/recipients/suggest', requireReportSession, requireSuperAdmin, async (req, res) => {
    try {
      const meetingsDb = require('../meetings-db');
      // NO optional chaining — a missing reader must fail loudly, not yield filled:0.
      const codes = (await rdb.listSiteModuleCodes('meetings')).map(r => r.code).filter(Boolean);
      const out = await reportDirectory.suggestFromMeetings(rdb.db, codes, meetingsDb, req.reportUser?.username);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/api/reports/schedule', requireReportSession, requireSuperAdmin, async (req, res) => {
    try { res.json(await reportSchedule.getSchedules(rdb.db)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/api/reports/schedule', requireReportSession, requireSuperAdmin, async (req, res) => {
    try { res.json(await reportSchedule.setSchedule(rdb.db, req.body || {}, req.reportUser?.username)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  // ── GET/PUT /api/reports/exec-editorial ──────────────────────────────
  // The Group IT deck builder's monthly analysis (Operations Summary + the
  // Analyze/commentary fields), stored server-side so it survives a cleared
  // cache and is visible to colleagues instead of living only in the author's
  // browser localStorage. Keyed (period, scope) — see reports-db's
  // exec_report_editorial for why the commentary scope carries the site+group
  // filter. Gated the SAME as POST /api/reports/exec-pptx below: anyone who can
  // build the deck can save its analysis.
  //
  // `scope` is a composite KEY, not user prose — validate it tightly so a stray
  // query string can't write an unbounded row the browser will never read back.
  const _EXEC_ED_PERIOD_RE = /^\d{4}-\d{2}$/;
  function _execEditorialKey(req, res) {
    const period = String(req.query.period || '').trim();
    const scope  = String(req.query.scope  || '').trim();
    if (!_EXEC_ED_PERIOD_RE.test(period)) {
      res.status(400).json({ error: 'period must be YYYY-MM' });
      return null;
    }
    if (!scope || scope.length > 120) {
      res.status(400).json({ error: 'scope must be non-empty and at most 120 characters' });
      return null;
    }
    return { period, scope };
  }

  router.get('/api/reports/exec-editorial', requireReportSession, requireAdmin, async (req, res) => {
    const key = _execEditorialKey(req, res);
    if (!key) return;
    try {
      const payload = await rdb.getExecReportEditorial(key.period, key.scope);
      return res.json({ payload: payload ?? null });
    } catch (e) {
      console.error('[exec-editorial] read failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });

  router.put('/api/reports/exec-editorial', requireReportSession, requireAdmin, async (req, res) => {
    const key = _execEditorialKey(req, res);
    if (!key) return;
    try {
      const who = req.reportUser
        ? (req.reportUser.username || req.reportUser.full_name || 'unknown')
        : 'unknown';
      await rdb.setExecReportEditorial(key.period, key.scope, (req.body || {}).payload, who);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[exec-editorial] write failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });


  return router;
};
