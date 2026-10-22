'use strict';
// ---------------------------------------------------------------------------
// Accounts routes - extracted from server.js (SDP-DASH-2.0 step 5, lot 5.3, 2026-10-22).
// Password login/logout/me, Microsoft Entra SSO (/api/auth/*), change password, sites,
// users, active sessions, action departments and the current-week helper. Handlers
// unchanged (`app.` became `router.`); mounted where the block used to sit.
// ---------------------------------------------------------------------------
module.exports = function accountsRoutes(deps) {
  const {
    express, rdb, requireReportSession, requireSuperAdmin, requireExecutiveOrSuperAdmin,
    loginLimiter, jsonBody, reportConfig, sessionCookieOpts: _sessionCookieOpts, getCookie, IS_DEV,
  } = deps;
  const router = express.Router();

  // ── Auth routes ───────────────────────────────────────────────────
  // SECURITY: Login endpoint is rate-limited (10 attempts/15min) to block brute force.
  router.post('/api/reports/auth/login', loginLimiter, jsonBody, async (req, res) => {
    if (!rdb) return res.status(503).json({ error: 'Reports module not available' });
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    // 'only' mode: password sign-in is reserved for the break-glass account so an
    // Entra outage can't lock everyone out. 'available' mode keeps password login
    // open for everyone (the hybrid transition window). 'off' → unrestricted.
    const _sso = await require('../services/ssoSettings').resolveSsoSettings(rdb.db);
    if (_sso.mode === 'only' && username !== _sso.breakglassUser) {
      return res.status(403).json({ error: 'Password sign-in is disabled — use "Sign in with Microsoft".' });
    }
    // Step 4: persistent throttle (services/authThrottle.js) — survives a restart and also caps
    // FAILED attempts per ACCOUNT, whatever the address. Best-effort: a throttle-store error never
    // blocks a login (the in-memory loginLimiter above still applies).
    const _thr = require('../services/authThrottle'), _thrWin = 15 * 60 * 1000, _thrMax = 10;
    try {
      const u = await _thr.peek(_thr.bucketForUser(username), { windowMs: _thrWin });
      const ipf = await _thr.peek(_thr.bucketForIp(req.ip), { windowMs: _thrWin });
      if (u.hits >= _thrMax || ipf.hits >= _thrMax * 3) {
        rdb.logEvent({ category: 'auth', action: 'login_throttled', actor: username, ip: req.ip, details: { account_failures: u.hits, ip_failures: ipf.hits } });
        res.setHeader('Retry-After', Math.max(u.retryAfterSec, ipf.retryAfterSec) || Math.ceil(_thrWin / 1000));
        return res.status(429).json({ error: 'Too many login attempts. Please wait 15 minutes before trying again.' });
      }
    } catch (e) { console.warn('[auth] throttle store unavailable:', e.message); }
    try {
      const result = await rdb.login(username, password);
      if (!result) {
        rdb.logEvent({ category:'auth', action:'login_failed', actor: username || 'anonymous', ip: req.ip, details:{ reason:'invalid_credentials' } });
        _thr.hit(_thr.bucketForUser(username), { windowMs: _thrWin }).catch(() => {});
        _thr.hit(_thr.bucketForIp(req.ip), { windowMs: _thrWin }).catch(() => {});
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      _thr.reset(_thr.bucketForUser(username)).catch(() => {});
      rdb.logEvent({ category:'auth', action:'login_success', actor:(result.user && result.user.username) || username, actor_id:(result.user && result.user.id) || null, ip: req.ip });
      // Step 4: a password sign-in while SSO is enforced can only be the break-glass account —
      // always a risk-flagged event, so every use of the emergency account is visible in System Logs.
      if (_sso.mode === 'only') rdb.logEvent({ category: 'auth', action: 'breakglass_login', actor: username, actor_id: (result.user && result.user.id) || null, ip: req.ip, details: { sso_mode: 'only' } });
      // SECURITY: If token is also set as a cookie, apply httpOnly + Secure + SameSite flags.
      // httpOnly prevents JavaScript from reading the cookie (XSS protection).
      // Secure ensures it is only sent over HTTPS in production.
      if (result.token) {
        res.cookie('report_token', result.token, _sessionCookieOpts(req));
      }
      res.json({ token: result.token, user: result.user });
    } catch(e) { res.status(500).json({ error: IS_DEV ? e.message : 'Login error.' }); }
  });

  router.post('/api/reports/auth/logout', requireReportSession, async (req, res) => {
    const token = req.headers['x-report-token'];
    try { await rdb.logout(token); rdb.logEvent({ category:'auth', action:'logout', ...rdb._logCtx(req) }); res.json({ ok: true }); }
    catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/reports/auth/me', requireReportSession, (req, res) => {
    res.json({ user: req.reportUser });
  });

  // ── Microsoft Entra ID (Azure AD) SSO ────────────────────────────────────────
  // OpenID Connect auth-code + PKCE. The engine (services/ssoEntra.js) is
  // identity-only; here we map the validated identity onto the dashboard user and
  // mint the SAME session token password login uses. Flag-gated + dormant until
  // SSO_ENABLED=true and the ENTRA_* vars are set. See docs/SSO_ENTRA_SETUP.md.
  // SSO_MODE controls the cutover: 'off' (password only), 'available' (BOTH
  // Microsoft + password — the hybrid transition window), 'only' (Microsoft
  // required; password reserved for the break-glass account). Back-compat:
  // SSO_ENABLED=true maps to 'only'.
  // F2a: SSO settings are resolved PER-REQUEST from report_config (DB) ?? .env ??
  // default (services/ssoSettings.js), so the admin config page (reports.html#ap-sso)
  // takes effect without a restart; .env still works as a fallback. Boot log is
  // best-effort — the live values can change at runtime.
  const ssoSettings = require('../services/ssoSettings');
  ssoSettings.resolveSsoSettings(rdb.db).then(s =>
    console.log(`[SSO] mode=${s.mode} ${s.ssoEnabled ? (s.ready ? '(Entra ready)' : '(NOT configured — set it in reports.html#admin or .env)') : ''}`)
  ).catch(() => {});

  // Pending logins: state → {nonce, codeVerifier, at}. In-memory (single pm2
  // process); 10-min TTL. A pm2 restart drops in-flight logins — the user just
  // clicks sign-in again. (Move to a table if the app ever runs multi-process.)
  const _ssoPending = new Map();
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [k, v] of _ssoPending) if (v.at < cutoff) _ssoPending.delete(k);
  }, 5 * 60 * 1000).unref();

  // Public: drives the login page — show the Microsoft button? show the password
  // form? password_login is false only in 'only' mode (break-glass still works via
  // ?breakglass=1, which the server allows for SSO_BREAKGLASS_USER).
  router.get('/api/auth/config', async (req, res) => {
    const s = await ssoSettings.resolveSsoSettings(rdb.db);
    res.json({
      sso_enabled:    !!s.ready,
      mode:           s.mode,
      password_login: s.mode !== 'only',
      breakglass_user: s.mode === 'only' ? s.breakglassUser : null,
    });
  });

  // Kick off the login: build the authorize URL, stash PKCE bits, redirect to Entra.
  router.get('/api/auth/sso/login', async (req, res) => {
    const s = await ssoSettings.resolveSsoSettings(rdb.db);
    if (!s.ready) return res.status(404).send('SSO is not enabled on this server.');
    try {
      const ssoEntra = require('../services/ssoEntra');
      const { url, state, nonce, codeVerifier } = ssoEntra.beginLogin(s.cfg);
      _ssoPending.set(state, { nonce, codeVerifier, at: Date.now() });
      res.redirect(url);
    } catch (e) {
      console.error('[SSO] login start failed:', e.message);
      res.redirect('/login.html?sso_error=start_failed');
    }
  });

  // Entra redirects back here with ?code=&state=. Validate, map to a user, mint.
  router.get('/api/auth/sso/callback', async (req, res) => {
    const s = await ssoSettings.resolveSsoSettings(rdb.db);
    if (!s.ready) return res.status(404).send('SSO is not enabled on this server.');
    const _fail = (code) => res.redirect('/login.html?sso_error=' + encodeURIComponent(code));
    try {
      if (req.query.error) { console.warn('[SSO] Entra returned error:', req.query.error, req.query.error_description || ''); return _fail(String(req.query.error)); }
      const { code, state } = req.query;
      if (!code || !state) return _fail('missing_code');
      const pending = _ssoPending.get(state);          // state match = CSRF guard
      if (!pending) return _fail('state_expired');
      _ssoPending.delete(state);

      const ssoEntra = require('../services/ssoEntra');
      const claims = await ssoEntra.completeLogin({
        code, codeVerifier: pending.codeVerifier, expectedNonce: pending.nonce, cfg: s.cfg,
      });

      // Pre-provisioned only: the identity must match an active dashboard user.
      const user = await rdb.findUserByEntra({ oid: claims.oid, email: claims.email });
      if (!user) {
        console.warn(`[SSO] denied — no provisioned user for ${claims.email} (oid ${claims.oid})`);
        return _fail('not_provisioned');
      }
      await rdb.linkUserEntra(user.id, claims.oid, claims.email);   // stamp stable oid
      // Step 4: Entra groups → roles + sites (armed off: sso_group_sync='1' to enable).
      {
        const cfg = await reportConfig.getConfig(rdb.db);
        const g = require('../services/ssoGroupSync').decide({ enabled: cfg.sso_group_sync === '1', claims, mapText: cfg.sso_group_map });
        if (g.action === 'deny') {
          rdb.logEvent({ category: 'auth', action: 'login_failed', actor: user.username, actor_id: user.id, ip: req.ip, details: { method: 'sso', reason: g.reason } });
          return _fail(g.reason);
        }
        if (g.action === 'apply') {
          await rdb.applyEntraAccess(user.id, g.access);
          rdb.logEvent({ category: 'identity', action: 'roles_from_entra', actor: user.username, actor_id: user.id, target: user.username,
            details: { roles: g.access.roles, site_id: g.access.site_id, extra_site_ids: g.access.extra_site_ids, groups: g.access.groups } });
        }
      }
      // Refresh the display profile FROM Microsoft (name/title/office).
      try {
        await rdb.updateUserProfileFromEntra(user.id, {
          first_name: claims.first_name, last_name: claims.last_name,
          title: claims.title, office: claims.office, full_name: claims.name,
        });
      } catch (e) { console.warn('[SSO] profile sync skipped:', e.message); }
      const session = await rdb.createSessionForUser(user.id);
      if (!session) return _fail('session_failed');
      console.log(`[SSO] login ok user=${user.username} email=${claims.email}`);

      // Set the same httpOnly session cookie password login uses…
      res.cookie('report_token', session.token, _sessionCookieOpts(req));
      rdb.logEvent({ category: 'auth', action: 'login_success', actor: user.username, actor_id: user.id, ip: req.ip, details: { method: 'sso' } });
      // …and hand the token to localStorage via a tiny page (mirrors the password
      // flow; token is in the HTTPS response body, never in the URL).
      const payload = JSON.stringify({ token: session.token, user: session.user });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!doctype html><meta charset="utf-8"><title>Signing in…</title>
<body style="font-family:system-ui;background:#0f1419;color:#cbd5e1;display:grid;place-items:center;height:100vh;margin:0">
<div>Signing you in…</div>
<script>try{var d=${payload};localStorage.setItem('report_token',d.token);localStorage.setItem('report_user',JSON.stringify(d.user));}catch(e){}location.replace('/index.html');</script>
</body>`);
    } catch (e) {
      console.error('[SSO] callback failed:', e.code || '', e.message);
      return _fail(e.code || 'sso_failed');
    }
  });

  // ── Change own password ───────────────────────────────────────────
  router.post('/api/reports/auth/change-password', requireReportSession, jsonBody, async (req, res) => {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password)
      return res.status(400).json({ error: 'current_password and new_password are required' });
    try {
      const result = await rdb.changePassword(req.reportUser.id, current_password, new_password);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true, message: 'Password changed successfully' });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── Sites ─────────────────────────────────────────────────────────
  router.get('/api/reports/sites', requireReportSession, async (req, res) => {
    try {
      const includeInactive = req.query.include_inactive === '1';
      if (includeInactive && !['executive','super_admin'].includes(req.reportUser?.role)) {
        return res.status(403).json({ error: 'Executive or super_admin only for include_inactive' });
      }
      res.json(await rdb.listSites({ includeInactive }));
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/reports/sites/:id — partial update.
  // - admin/executive/super_admin can update zoho_group (existing behavior, used by inline Save).
  // - executive+ required for sort_order or active changes (broader site config).
  // `name` is intentionally NOT editable here — see reports-db.js updateSite() comment.
  router.put('/api/reports/sites/:id', requireReportSession, requireSuperAdmin, jsonBody, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { zoho_group, sort_order, active } = req.body || {};

      // RBAC: edits beyond zoho_group require executive+
      const broaderUpdate = (sort_order !== undefined) || (active !== undefined);
      if (broaderUpdate && !['executive','super_admin'].includes(req.reportUser?.role)) {
        return res.status(403).json({ error: 'Executive or super_admin only to change sort_order / active' });
      }

      const before = (await rdb.listSites({ includeInactive: true })).find(s => s.id === id);
      if (!before) return res.status(404).json({ error: 'Site not found' });

      const after = await rdb.updateSite(id, { zoho_group, sort_order, active });

      // Audit only the broader updates; legacy zoho_group inline edits stay quiet to keep audit_log focused
      if (broaderUpdate) {
        const action = (before.active && !after.active) ? 'site_disabled'
                     : (!before.active && after.active) ? 'site_enabled'
                     : 'site_updated';
        await rdb.logAudit({
          site_id: id, user_id: req.reportUser.id, username: req.reportUser.username,
          action, details: { before: { zoho_group: before.zoho_group, sort_order: before.sort_order, active: before.active },
                              after:  { zoho_group: after.zoho_group,  sort_order: after.sort_order,  active: after.active } }
        });
      }
      res.json({ ok: true, ...after });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/reports/sites — create a new site (executive+).
  // If a site with the same name already exists but is inactive, it's reactivated
  // instead of failing the UNIQUE constraint (matches Departments behavior).
  router.post('/api/reports/sites', requireReportSession, requireExecutiveOrSuperAdmin, jsonBody, async (req, res) => {
    try {
      const { name, zoho_group, sort_order } = req.body || {};
      const result = await rdb.createSite({ name, zoho_group, sort_order });
      await rdb.logAudit({
        site_id: result.id, user_id: req.reportUser.id, username: req.reportUser.username,
        action: result.reactivated ? 'site_enabled' : 'site_created',
        details: { id: result.id, name: result.name, zoho_group: zoho_group || null }
      });
      res.json(result);
    } catch(e) { res.status(400).json({ error: e.message }); }
  });

  // DELETE /api/reports/sites/:id — soft-delete (sets active=0).
  // Historical reports keep their site_id link and remain accessible.
  router.delete('/api/reports/sites/:id', requireReportSession, requireExecutiveOrSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const before = (await rdb.listSites({ includeInactive: true })).find(s => s.id === id);
      if (!before) return res.status(404).json({ error: 'Site not found' });
      const after = await rdb.setSiteActive(id, 0);
      await rdb.logAudit({
        site_id: id, user_id: req.reportUser.id, username: req.reportUser.username,
        action: 'site_disabled',
        details: { id, name: before.name }
      });
      res.json({ ok: true, ...after });
    } catch(e) { res.status(400).json({ error: e.message }); }
  });

  // ── Users (admin only) ────────────────────────────────────────────
  router.get('/api/reports/users', requireReportSession, requireSuperAdmin, async (req, res) => {
    try { res.json(await rdb.listUsers()); }
    catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/reports/users', requireReportSession, requireSuperAdmin, jsonBody, async (req, res) => {
    try {
      // Accept both legacy `role: 'admin'` (string) and new `roles: ['admin', 'tracker-editor']` (array).
      const { username, full_name, password, site_id, role, roles, email, extra_site_ids } = req.body || {};
      if (!username || !full_name || !password) return res.status(400).json({ error: 'username, full_name, password required' });
      await rdb.createUser({ username, full_name, password, site_id, role, roles, email, extra_site_ids });
      res.json({ ok: true });
    } catch(e) {
      // sqlite raises "UNIQUE constraint failed"; postgres raises SQLSTATE 23505.
      if (e.code === '23505' || (e.message && e.message.includes('UNIQUE'))) return res.status(409).json({ error: 'Username already exists' });
      res.status(500).json({ error: e.message });
    }
  });

  // Bulk email mapping for the SSO transition — set many users' emails at once.
  // Body: { updates: [{ id, email }] }. admin+. Registered BEFORE /users/:id so
  // "emails" isn't parsed as an :id.
  router.put('/api/reports/users/emails', requireReportSession, requireSuperAdmin, jsonBody, async (req, res) => {
    try {
      const updates = (req.body && req.body.updates) || [];
      if (!Array.isArray(updates)) return res.status(400).json({ error: 'updates[] required' });
      let n = 0;
      for (const u of updates) {
        const id = parseInt(u && u.id, 10);
        if (!Number.isFinite(id)) continue;
        await rdb.setUserEmail(id, (u.email || '').trim());
        n++;
      }
      console.log(`[SSO] bulk email map: ${n} user(s) updated by ${req.reportUser?.username || 'admin'}`);
      res.json({ ok: true, updated: n });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/api/reports/users/:id', requireReportSession, requireSuperAdmin, jsonBody, async (req, res) => {
    try {
      // Accept both legacy `role` (string) and new `roles` (array) — see createUser comment.
      const { full_name, password, site_id, role, roles, active, email, extra_site_ids } = req.body || {};
      if (!full_name) return res.status(400).json({ error: 'full_name required' });
      await rdb.updateUser(parseInt(req.params.id), { full_name, password, site_id, role, roles, active, email, extra_site_ids });
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/api/reports/users/:id', requireReportSession, requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (req.reportUser.id === id) return res.status(400).json({ error: 'Cannot delete your own account' });
      await rdb.deleteUser(id);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── Active sessions (admin observability) ─────────────────────────
  // "Who's actually using the dashboard right now" — backed by the
  // `last_seen` column that `validateSession()` stamps on every
  // authenticated request. Default window = 5 minutes idle.
  //
  // View: admin+ (matches the Users-card RBAC — same operational scope).
  // Force-logout: super_admin only (destructive action; could kick the
  // wrong session in a multi-tab scenario).
  router.get('/api/reports/sessions/active', requireReportSession, requireSuperAdmin, async (req, res) => {
    try {
      const idle = Math.max(1, Math.min(1440, parseInt(req.query.idle_minutes || '5', 10) || 5));
      const sessions = await rdb.listActiveSessions(idle);
      // Don't leak full tokens to the browser — sufficient to show a
      // short prefix for visual identification, and pass the full one
      // back only when the operator explicitly clicks Force Logout.
      const safe = sessions.map(s => ({
        token_preview: (s.token || '').slice(0, 8) + '…',
        token:         s.token,                    // used by DELETE; not rendered as-is
        user_id:       s.user_id,
        username:      s.username,
        full_name:     s.full_name,
        role:          s.role,
        site_name:     s.site_name,
        last_seen:     s.last_seen,
        seconds_idle:  s.seconds_idle,
        created_at:    s.created_at,
        expires_at:    s.expires_at,
        is_self:       s.user_id === req.reportUser.id,
      }));
      res.json({
        idle_minutes: idle,
        count:        safe.length,
        sessions:     safe,
        generated_at: new Date().toISOString(),
      });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Force-logout one session by token. Token is passed in the URL path
  // (URL-encoded) — bodies on DELETE are inconsistent across clients.
  // super_admin only because it's destructive.
  router.delete('/api/reports/sessions/:token', requireReportSession, (req, res, next) => {
    if (!rdb.userHasRole(req.reportUser, 'super_admin')) {
      return res.status(403).json({ error: 'super_admin only' });
    }
    next();
  }, async (req, res) => {
    try {
      const token = decodeURIComponent(req.params.token || '');
      if (!token) return res.status(400).json({ error: 'token is required' });
      // Defensive: prevent kicking your own session by accident. The
      // client-side UI also greys the button on is_self rows.
      if (token === (req.headers['x-report-token'] || getCookie(req, 'report_token'))) {
        return res.status(400).json({ error: 'Cannot force-logout your own session — use the regular Logout instead.' });
      }
      const r = await rdb.forceLogoutByToken(token);
      const who = req.reportUser?.username || 'unknown';
      console.log(`[sessions] force-logout token=${token.slice(0,8)}… by ${who} — rows=${r.deleted}`);
      rdb.logEvent({ category:'auth', action:'session_killed', target:(r && r.username) || token.slice(0,8), details:{ rows:r.deleted }, ...rdb._logCtx(req) });
      res.json(r);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── Action departments (categories used by action items dropdown) ─
  // GET active list — any logged-in session (used by reports.html dropdown).
  // Mutations require executive or super_admin.
  router.get('/api/reports/departments', requireReportSession, async (req, res) => {
    try {
      const includeInactive = req.query.include_inactive === '1';
      if (includeInactive && !['executive','super_admin'].includes(req.reportUser?.role)) {
        return res.status(403).json({ error: 'Executive or super_admin only for include_inactive' });
      }
      res.json(await rdb.listDepartments({ includeInactive }));
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/reports/departments', requireReportSession, requireExecutiveOrSuperAdmin, jsonBody, async (req, res) => {
    try {
      const { name, sort_order } = req.body || {};
      const result = await rdb.createDepartment({ name, sort_order });
      await rdb.logAudit({
        user_id: req.reportUser.id, username: req.reportUser.username,
        action: result.reactivated ? 'department_enabled' : 'department_created',
        details: { id: result.id, name: result.name }
      });
      res.json(result);
    } catch(e) { res.status(400).json({ error: e.message }); }
  });

  router.put('/api/reports/departments/:id', requireReportSession, requireExecutiveOrSuperAdmin, jsonBody, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const before = (await rdb.listDepartments({ includeInactive: true })).find(d => d.id === id);
      if (!before) return res.status(404).json({ error: 'Department not found' });
      const after = await rdb.updateDepartment(id, req.body || {});
      const action = (before.active && !after.active) ? 'department_disabled'
                   : (!before.active && after.active) ? 'department_enabled'
                   : 'department_updated';
      await rdb.logAudit({
        user_id: req.reportUser.id, username: req.reportUser.username,
        action, details: { id, before: { name: before.name, active: before.active, sort_order: before.sort_order },
                                after:  { name: after.name,  active: after.active,  sort_order: after.sort_order } }
      });
      res.json(after);
    } catch(e) { res.status(400).json({ error: e.message }); }
  });

  router.delete('/api/reports/departments/:id', requireReportSession, requireExecutiveOrSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const before = (await rdb.listDepartments({ includeInactive: true })).find(d => d.id === id);
      if (!before) return res.status(404).json({ error: 'Department not found' });
      const after = await rdb.setDepartmentActive(id, 0);
      await rdb.logAudit({
        user_id: req.reportUser.id, username: req.reportUser.username,
        action: 'department_disabled',
        details: { id, name: before.name }
      });
      res.json({ ok: true, ...after });
    } catch(e) { res.status(400).json({ error: e.message }); }
  });

  // ── Week helpers ──────────────────────────────────────────────────
  router.get('/api/reports/current-week', requireReportSession, (req, res) => {
    try {
      const prev = rdb.getPreviousWeek();
      const range = rdb.getWeekRange(prev.year, prev.week);
      res.json({ year: prev.year, week: prev.week, ...range });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });


  return router;
};
