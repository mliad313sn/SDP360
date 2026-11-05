/* A-10 — the starting page for a user, ONE rule for the post-login redirect (login.html) and the
 * brand link (_shell.js). PURE: the caller passes the role check; nothing global is read here.
 *   landingFor({ has, isBusinessOnly, roleLanding }) → page (relative href)
 *   has(role)      hierarchical role check (super_admin > executive > admin > editor > viewer;
 *                  feature roles exact match) — window.__userHasRole in the browser
 *   roleLanding    report_config ui_role_landing: '0' (default) = today's mapping;
 *                  '1' = role-based landing (Home for site editors, field app for field techs).
 *                  Any other value behaves as '0'.
 * A landing is a starting point, never a permission: the target page keeps its own gate.
 * UMD — window.Landing in the browser, module.exports in Node (tests).
 */
(function (root) {
  'use strict';
  function landingFor(opts) {
    var o = opts || {};
    var has = typeof o.has === 'function' ? o.has : function () { return false; };
    if (o.isBusinessOnly) return 'site-awareness.html';            // GM/FM land on their site view
    if (o.roleLanding === '1') {
      if (has('super_admin'))    return 'home.html';
      if (has('executive'))      return 'dashboards.html?key=exec-home';
      if (has('admin'))          return 'index.html';
      if (has('editor'))         return 'home.html';
      if (has('field-tech'))     return 'field/index.html';
      if (has('tracker-editor')) return 'activity-tracker.html';
      return 'index.html';
    }
    // '0' — today's mapping
    if (has('executive') || has('super_admin')) return 'executive.html';
    if (has('admin'))                            return 'index.html';
    if (has('tracker-editor'))                   return 'activity-tracker.html';
    return 'index.html';
  }
  // SEC-01 — ?next= after login: only a same-origin RELATIVE page is followed. Anything absolute,
  // protocol-relative (//host), backslashed (/\host), carrying a scheme (javascript:, data:) or a
  // control character returns '' and the caller falls back to the role landing.
  function safeNext(raw) {
    if (typeof raw !== 'string') return '';
    var v = raw.replace(/^\/+/, function (m) { return m.length === 1 ? '' : m; });
    if (!v || v.length > 512) return '';
    if (/[\u0000-\u001f\u007f\\]/.test(v)) return '';          // control chars / backslash
    if (/^[\/]/.test(v)) return '';                                // '//host' (protocol-relative)
    if (/%2f|%5c/i.test(v.split(/[?#]/)[0])) return '';             // encoded slash/backslash in the path
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return '';                  // any scheme
    if (!/^[A-Za-z0-9._~\-\/]+(\.html)?([?#].*)?$/.test(v)) return '';
    return v;
  }
  var api = { landingFor: landingFor, safeNext: safeNext };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Landing = api;
})(typeof self !== 'undefined' ? self : this);
