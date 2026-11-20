/* Adoption Lot A (item 5) — what a list page may claim about the signed-in person's site scope.
 *   SiteScope.of(user, has) → { adminTier, sites, none, canWrite }
 *     adminTier — admin / executive / super_admin read every site (server rule: rdb.userHasRole(user, 'admin'))
 *     sites     — the person's site ids (primary + extra, services/userSites.js), [] when none
 *     none      — no site in scope and not the admin tier: the server returns NOTHING for them, so a page must say
 *                 "no site in your scope" — never "0 meetings", which reads as a measured zero
 *     canWrite  — may create / import (admin tier, or an editor with at least one site; a site-less account writes
 *                 nothing server-side — RBAC audit 2026-10-02)
 * Presentation only: it never widens a read scope (that is a human access decision) and the server still decides. */
(function (root) {
  'use strict';
  function of(user, has) {
    const h = typeof has === 'function' ? has : () => false;
    const u = user || {};
    const ids = Array.isArray(u.site_ids) && u.site_ids.length ? u.site_ids : (u.site_id != null ? [u.site_id] : []);
    const sites = ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    const adminTier = !!h('admin');
    return { adminTier, sites, none: !adminTier && sites.length === 0, canWrite: adminTier || (!!h('editor') && sites.length > 0) };
  }
  const api = { of };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SiteScope = api;
})(typeof self !== 'undefined' ? self : this);
