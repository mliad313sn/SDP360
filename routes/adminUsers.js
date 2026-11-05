'use strict';
const { fail, typed } = require('../services/httpError');
// ─────────────────────────────────────────────────────────────────────────
// Users & sessions admin routes (/api/reports/users*, /api/reports/sessions*) — extracted from server.js (fiche M12-a, 2026-10-20), same
// dependency-injection pattern as routes/inspection.js. Handlers are byte-for-byte
// the inline ones; only `app.` → `router.` and `require('./x')` → `require('../x')`.
//
// Wiring in server.js:
//   app.use(require('./routes/adminUsers')({ express, rdb, requireReportSession, requireSuperAdmin, jsonBody, getCookie }));
// ─────────────────────────────────────────────────────────────────────────
module.exports = function adminUsersRoutes(deps) {
  const { express, rdb, requireReportSession, requireSuperAdmin, jsonBody, getCookie } = deps;
  const router = express.Router();

  // ── E6 — identity journal ───────────────────────────────────────────
  // Every account change lands in system_log (category 'identity') with a before/after
  // diff of the governed fields. The password NEVER appears — only the fact that it was
  // reset (`password_reset`, a risk event). logEvent is fire-and-forget (never awaited).
  const IDENTITY_FIELDS = ['roles', 'site_id', 'extra_site_ids', 'active', 'email', 'full_name'];
  const _norm = (k, v) => {
    if (k === 'roles' || k === 'extra_site_ids') return [...new Set(Array.isArray(v) ? v : [])].sort();
    if (k === 'active') return v == null ? null : (v ? 1 : 0);
    if (k === 'email') return v == null || v === '' ? null : String(v).trim().toLowerCase();
    return v == null || v === '' ? null : v;
  };
  const _snapshot = async (id) => {
    const u = (await rdb.listUsers()).find(x => Number(x.id) === Number(id));
    if (!u) return null;
    const out = { id: u.id, username: u.username };
    for (const k of IDENTITY_FIELDS) out[k] = _norm(k, u[k]);
    return out;
  };
  const _diff = (before, after) => {
    const d = {};
    for (const k of IDENTITY_FIELDS) {
      const a = JSON.stringify(before ? before[k] : null), b = JSON.stringify(after ? after[k] : null);
      if (a !== b) d[k] = { before: before ? before[k] : null, after: after ? after[k] : null };
    }
    return d;
  };
  const _log = (req, action, target, details, risk) => {
    try { rdb.logEvent({ category: 'identity', action, target, details, ...(risk != null ? { risk } : {}), ...rdb._logCtx(req) }); } catch {}
  };

  // ── C-18 — access_require_approval ('0' = today). When '1', adding a role that opens a capability marked
  // requires_request (C-17 catalogue) needs an APPROVED/ACTIVE access request for that user and role. A
  // super_admin may still do it as an explicit break-glass ({ break_glass:true, break_glass_reason }), logged risk=1.
  const _approvalGate = async (req, userId, beforeRoles, afterRoles) => {
    const cfg = await require('../services/reportConfig').getConfig(rdb.db);
    if (String((cfg && cfg.access_require_approval) || '0') !== '1') return null;
    const added = [...new Set(afterRoles || [])].filter((r) => !(beforeRoles || []).includes(r));
    const sensitive = require('../services/accessRequestLifecycle').rolesRequiringRequest(added, rdb.userHasRole);
    if (!sensitive.length) return null;
    const store = require('../services/accessStore').forRdb(rdb);
    const missing = [];
    for (const r of sensitive) if (userId == null || !(await store.hasApproved(userId, r))) missing.push(r);
    if (!missing.length) return null;
    const b = req.body || {};
    if (b.break_glass === true && String(b.break_glass_reason || '').trim().length >= 10 && rdb.userHasRole(req.reportUser, 'super_admin')) {
      // C-22: with emergency_access_enabled='1' a break-glass becomes an emergency record (24 h, post-review) and
      // is never given to oneself.
      if (String((cfg && cfg.emergency_access_enabled) || '0') === '1') {
        if (userId != null && Number(userId) === Number(req.reportUser.id)) return typed('FORBIDDEN', 'nobody grants emergency access to themselves — another super_admin must do it');
        req._sdpBreakGlass = { roles: missing, reason: String(b.break_glass_reason).trim().slice(0, 2000) };
      }
      _log(req, 'access_break_glass', String(userId == null ? b.username : userId), { user_id: userId, roles: missing, reason: String(b.break_glass_reason).slice(0, 500) }, 1);
      return null;
    }
    return typed('CONFLICT', `role(s) ${missing.join(', ')} need an approved access request (or an explicit break-glass with a reason)`);
  };
  // C-22 — after the direct write, record the break-glass as an emergency (time-boxed grants + review due).
  const _recordBreakGlass = async (req, userId) => {
    const bg = req._sdpBreakGlass; if (!bg || userId == null) return null;
    const out = await require('../services/emergencyAccessStore').forRdb(rdb).recordBreakGlass({ subjectId: userId, roles: bg.roles, actor: req.reportUser, reason: bg.reason });
    _log(req, 'access_emergency_granted', String(userId), { via: 'break_glass', emergency_id: out.id, request_id: out.request_id, user_id: userId, roles: bg.roles, expires_at: out.expires_at, review_due: out.review_due }, 1);
    return out;
  };
  const _rolesOf = (b) => (Array.isArray(b.roles) && b.roles.length ? b.roles : (typeof b.role === 'string' ? [b.role] : []));
  // D-04: unknown roles → 400 naming them (checked before the approval gate; the reader enforces it too).
  const _unknownRolesError = (b) => {
    const bad = typeof rdb.unknownRoles === 'function' ? rdb.unknownRoles(_rolesOf(b || {})) : [];
    if (!bad.length) return null;
    const e = typed('VALIDATION', `unknown role(s): ${bad.join(', ')} — not in the role catalogue, nothing saved`);
    e.unknown_roles = bad; return e;
  };
  const _failRoles = (res, e) => fail(res, e, undefined, Array.isArray(e && e.unknown_roles) ? { unknown_roles: e.unknown_roles } : undefined);

// ── Users (admin only) ────────────────────────────────────────────
router.get('/api/reports/users', requireReportSession, requireSuperAdmin, async (req, res) => {
  try { res.json(await rdb.listUsers()); }
  catch(e) { fail(res, e); }
});

router.post('/api/reports/users', requireReportSession, requireSuperAdmin, jsonBody, async (req, res) => {
  try {
    // Accept both legacy `role: 'admin'` (string) and new `roles: ['admin', 'tracker-editor']` (array).
    const { username, full_name, password, site_id, role, roles, email, extra_site_ids } = req.body || {};
    if (!username || !full_name || !password) return res.status(400).json({ error: 'username, full_name, password required' });
    const badRoles = _unknownRolesError(req.body); if (badRoles) return _failRoles(res, badRoles);
    const denied = await _approvalGate(req, null, [], _rolesOf(req.body || {}).length ? _rolesOf(req.body || {}) : ['editor']);
    if (denied) return fail(res, denied);
    const r = await rdb.createUser({ username, full_name, password, site_id, role, roles, email, extra_site_ids });
    const newId = r && (r.lastInsertRowid != null ? Number(r.lastInsertRowid) : (r.lastID != null ? Number(r.lastID) : null));
    const after = newId != null ? await _snapshot(newId) : null;
    _log(req, 'user_created', username, { user_id: newId, after });
    const emergency = req._sdpBreakGlass ? await _recordBreakGlass(req, newId != null ? newId : ((await rdb.listUsers()).find((u) => u.username === username) || {}).id) : null;
    res.json({ ok: true, ...(emergency ? { emergency } : {}) });
  } catch(e) {
    // sqlite raises "UNIQUE constraint failed"; postgres raises SQLSTATE 23505.
    if (e.code === '23505' || (e.message && e.message.includes('UNIQUE'))) return res.status(409).json({ error: 'Username already exists' });
    _failRoles(res, e);
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
  } catch(e) { fail(res, e); }
});

router.put('/api/reports/users/:id', requireReportSession, requireSuperAdmin, jsonBody, async (req, res) => {
  try {
    // Accept both legacy `role` (string) and new `roles` (array) — see createUser comment.
    const { full_name, password, site_id, role, roles, active, email, extra_site_ids } = req.body || {};
    if (!full_name) return res.status(400).json({ error: 'full_name required' });
    const id = parseInt(req.params.id);
    const badRoles = _unknownRolesError(req.body); if (badRoles) return _failRoles(res, badRoles);
    const before = await _snapshot(id);
    if (roles !== undefined || role !== undefined) { const denied = await _approvalGate(req, id, before ? before.roles : [], _rolesOf(req.body || {})); if (denied) return fail(res, denied); }
    await rdb.updateUser(id, { full_name, password, site_id, role, roles, active, email, extra_site_ids });
    const after = await _snapshot(id);
    const target = (after && after.username) || (before && before.username) || String(id);
    const diff = _diff(before, after);
    _log(req, 'user_updated', target, { user_id: id, changed: Object.keys(diff), diff, password_reset: !!password });
    if (diff.roles) _log(req, 'user_role_changed', target, { user_id: id, before: diff.roles.before, after: diff.roles.after });
    if (password) _log(req, 'password_reset', target, { user_id: id, by_admin: true });
    const emergency = await _recordBreakGlass(req, id);
    res.json({ ok: true, ...(emergency ? { emergency } : {}) });
  } catch(e) { _failRoles(res, e); }
});

router.delete('/api/reports/users/:id', requireReportSession, requireSuperAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (req.reportUser.id === id) return res.status(400).json({ error: 'Cannot delete your own account' });
    const before = await _snapshot(id);
    await rdb.deleteUser(id);
    _log(req, 'user_deleted', (before && before.username) || String(id), { user_id: id, before });
    res.json({ ok: true });
  } catch(e) { fail(res, e); }
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
  } catch(e) { fail(res, e); }
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
    if (token === require('../services/sessionAuth').sessionToken(req)) {
      return res.status(400).json({ error: 'Cannot force-logout your own session — use the regular Logout instead.' });
    }
    const r = await rdb.forceLogoutByToken(token);
    const who = req.reportUser?.username || 'unknown';
    console.log(`[sessions] force-logout token=${token.slice(0,8)}… by ${who} — rows=${r.deleted}`);
    rdb.logEvent({ category:'auth', action:'session_killed', target:(r && r.username) || token.slice(0,8), details:{ rows:r.deleted }, ...rdb._logCtx(req) });
    res.json(r);
  } catch(e) { fail(res, e); }
});


  return router;
};
