/**
 * Unified Auth Helper — Endeavour Mining IT Dashboard
 * Checks session token, redirects to login if not authenticated,
 * and enforces role-based access per page.
 *
 * Usage: <script src="auth.js" data-require="super_admin"></script>
 *   data-require="super_admin" — only super_admin allowed (executive pages)
 *   data-require="executive"   — executive or super_admin allowed
 *   data-require="admin"       — admin, executive, or super_admin allowed
 *   data-require="any"         — any logged-in user allowed (index, reports)
 *   data-require="a|b"         — OR list: pass if the user holds ANY of the
 *                                listed roles (hierarchy still applies per
 *                                entry). e.g. "admin|scorecard-viewer"
 *   (no attribute)             — defaults to "any"
 */
(function() {
  const TOKEN_KEY = 'report_token';
  const USER_KEY  = 'report_user';

  function getToken()    { return localStorage.getItem(TOKEN_KEY); }
  function getUser()     { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } }
  function clearSession(){ localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }

  function redirectLogin() {
    const next = encodeURIComponent(location.pathname.split('/').pop() + location.search);
    location.replace('login.html?next=' + next);
  }

  // Get required role from script tag attribute
  const scriptTag   = document.currentScript;
  const requireRole = scriptTag ? (scriptTag.getAttribute('data-require') || 'any') : 'any';

  const token = getToken();
  const user  = getUser();

  // No token → go to login
  if (!token || !user) return redirectLogin();

  // ── Multi-role helper ────────────────────────────────────────────
  // Resolves the hierarchy chain (super_admin > executive > admin > editor >
  // viewer) AND the new orthogonal feature roles (tracker-admin,
  // tracker-editor, report-author, audit-viewer). For feature roles only an
  // exact match grants access; for hierarchical roles, any role above the
  // requested tier in the chain passes. Reads user.roles array (preferred,
  // multi-role-aware) with fallback to legacy single user.role for users
  // logged in before the RBAC migration.
  const ROLE_HIERARCHY_CLIENT = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];
  function userHasRoleClient(required) {
    if (!user || !required) return false;
    const roles = (Array.isArray(user.roles) && user.roles.length)
      ? user.roles
      : (user.role ? [user.role] : []);
    if (roles.includes(required)) return true;        // exact match (covers feature roles)
    const reqIdx = ROLE_HIERARCHY_CLIENT.indexOf(required);
    if (reqIdx >= 0) {
      for (const r of roles) {
        const have = ROLE_HIERARCHY_CLIENT.indexOf(r);
        if (have >= 0 && have <= reqIdx) return true; // user holds same-or-higher tier
      }
    }
    return false;
  }

  // Page-level role gate. Routes through userHasRoleClient so the same gate
  // works for hierarchy roles AND feature roles (e.g. data-require="tracker-admin").
  // Pipe-separated list = OR: "admin|scorecard-viewer" passes if the user
  // holds ANY of the listed roles (hierarchy implication applies per entry).
  if (requireRole !== 'any') {
    const anyOf = requireRole.split('|').map(s => s.trim()).filter(Boolean);
    if (!anyOf.some(userHasRoleClient)) {
      location.replace('index.html');
      return;
    }
  }

  // Business-only accounts (GM/FM whose ONLY roles are site-business / group-business) get the
  // restricted "Ma Vue Site" experience: they may use ONLY site-awareness.html; any other page
  // redirects them there (defence-in-depth over the nav hiding in _shell.js). Mirrors the pure
  // public/lib/businessRoles.js (isBusinessOnly). A user with any other role keeps full access.
  const _roles = (Array.isArray(user.roles) && user.roles.length) ? user.roles : (user.role ? [user.role] : []);
  window.__isBusinessOnly = _roles.length > 0 && _roles.every(r => r === 'site-business' || r === 'group-business');
  if (window.__isBusinessOnly) {
    const _page = (location.pathname.split('/').pop() || '').toLowerCase();
    if (_page !== 'site-awareness.html' && _page !== 'login.html') {
      location.replace('site-awareness.html');
      return;
    }
  }

  // Expose user info globally for pages to use
  window.__authUser      = user;
  window.__authToken     = token;
  window.__userHasRole   = userHasRoleClient;
  window.__isExecutive   = userHasRoleClient('executive');     // hierarchy: exec or super_admin
  window.__isSuperAdmin  = (user.role === 'super_admin') || userHasRoleClient('super_admin');

  // Helper: add auth header to all fetch calls
  window.__authHeaders = function() {
    return { 'x-report-token': token };
  };

  // Helper: logout function available to all pages
  window.__logout = function() {
    fetch('/api/reports/auth/logout', {
      method: 'POST',
      headers: { 'x-report-token': token }
    }).finally(() => {
      clearSession();
      location.replace('login.html');
    });
  };

  // Validate token with server in background — logout if expired
  fetch('/api/reports/auth/me', { headers: { 'x-report-token': token } })
    .then(r => {
      if (r.status === 401) {
        clearSession();
        redirectLogin();
      }
    })
    .catch(() => {}); // network error — let page load, will fail on data fetch

  // Show executive nav links for super_admin only once DOM is ready.
  // Runs from auth.js (in <head>) so `user` is already resolved — no race with async fetches.
  document.addEventListener('DOMContentLoaded', function() {
    var isSuperAdmin = user.role === 'super_admin';
    var isExec       = ['executive', 'super_admin'].includes(user.role);
    var isAdmin      = ['admin', 'executive', 'super_admin'].includes(user.role);
    var ne = document.getElementById('nav-executive');
    var nr = document.getElementById('nav-exec-report');
    var hs = document.getElementById('btnForceSync');
    if (ne) ne.style.display = isSuperAdmin ? '' : 'none';
    if (nr) nr.style.display = isSuperAdmin ? '' : 'none';
    if (hs) hs.style.display = isAdmin      ? '' : 'none';
  });

})();
