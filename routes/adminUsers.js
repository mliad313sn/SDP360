'use strict';
const { fail } = require('../services/httpError');
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
    const r = await rdb.createUser({ username, full_name, password, site_id, role, roles, email, extra_site_ids });
    const newId = r && (r.lastInsertRowid != null ? Number(r.lastInsertRowid) : (r.lastID != null ? Number(r.lastID) : null));
    const after = newId != null ? await _snapshot(newId) : null;
    _log(req, 'user_created', username, { user_id: newId, after });
    res.json({ ok: true });
  } catch(e) {
    // sqlite raises "UNIQUE constraint failed"; postgres raises SQLSTATE 23505.
    if (e.code === '23505' || (e.message && e.message.includes('UNIQUE'))) return res.status(409).json({ error: 'Username already exists' });
    fail(res, e);
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
    const before = await _snapshot(id);
    await rdb.updateUser(id, { full_name, password, site_id, role, roles, active, email, extra_site_ids });
    const after = await _snapshot(id);
    const target = (after && after.username) || (before && before.username) || String(id);
    const diff = _diff(before, after);
    _log(req, 'user_updated', target, { user_id: id, changed: Object.keys(diff), diff, password_reset: !!password });
    if (diff.roles) _log(req, 'user_role_changed', target, { user_id: id, before: diff.roles.before, after: diff.roles.after });
    if (password) _log(req, 'password_reset', target, { user_id: id, by_admin: true });
    res.json({ ok: true });
  } catch(e) { fail(res, e); }
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
