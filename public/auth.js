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

  // Since 2026-10-20 (fiche C1) the server injects window.__ak ONLY when the request carried a
  // valid session, and the key alone no longer satisfies the /api/ gate from a browser. Pages
  // that still send only 'X-Dash-Key' (executive, analytics, deck builder, freshness bars) must
  // therefore ALSO present the session: attach x-report-token to every same-origin /api/ call that
  // does not carry one yet. Pages' own fetch wrappers chain on top of this one.
  (function attachSessionToApiFetch() {
    if (typeof window.fetch !== 'function' || window.__sessionFetchPatched) return;
    window.__sessionFetchPatched = true;
    const _base = window.fetch.bind(window);
    window.fetch = function(url, opts) {
      try {
        const u = (typeof url === 'string') ? url : (url && url.url) || '';
        const isApi = u.indexOf('/api/') !== -1 && (u.indexOf('://') === -1 || u.indexOf(location.origin) === 0);
        if (isApi) {
          opts = Object.assign({}, opts || {});
          const h = opts.headers;
          if (h instanceof Headers) { if (!h.has('x-report-token')) h.set('x-report-token', token); }
          else if (Array.isArray(h)) { if (!h.some(p => String(p[0]).toLowerCase() === 'x-report-token')) h.push(['x-report-token', token]); }
          else {
            const o = Object.assign({}, h || {});
            if (!Object.keys(o).some(k => k.toLowerCase() === 'x-report-token')) o['x-report-token'] = token;
            opts.headers = o;
          }
        }
      } catch (_) { /* never break a fetch over an auth header */ }
      return _base(url, opts);
    };
  })();

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

  // Validate token with server in background — logout if expired.
  // RBAC audit 2026-10-02: also refresh the cached user. It was stored once at login
  // and never updated, so after an administrator changed someone's roles every page
  // kept gating on the OLD roles for up to the 24 h session while the server (which
  // re-reads roles on each request) applied the new ones. When the role SET differs,
  // store the fresh user and reload ONCE per tab session so the page re-evaluates its
  // gates (a lost page access then redirects through the normal data-require check).
  const _roleSig = u => ((u && Array.isArray(u.roles) && u.roles.length) ? u.roles : (u && u.role ? [u.role] : []))
    .slice().sort().join(',');
  fetch('/api/reports/auth/me', { headers: { 'x-report-token': token } })
    .then(async r => {
      if (r.status === 401) {
        clearSession();
        redirectLogin();
        return;
      }
      if (!r.ok) return;
      const body = await r.json().catch(() => null);
      const fresh = body && body.user;
      if (!fresh || fresh.id !== user.id) return;
      const changed = _roleSig(fresh) !== _roleSig(user);
      localStorage.setItem(USER_KEY, JSON.stringify(fresh));
      if (!changed) return;
      let reloaded = null;
      try { reloaded = sessionStorage.getItem('auth_roles_reloaded'); } catch (_) {}
      if (reloaded) return;                              // never loop
      try { sessionStorage.setItem('auth_roles_reloaded', '1'); } catch (_) {}
      location.reload();
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
