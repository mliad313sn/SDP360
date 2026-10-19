'use strict';
// Multi-site editors (2026-10-05) — PURE helpers. A user keeps ONE primary site
// (users.site_id) and may hold extra sites (table user_sites). The session carries
// site_ids = [primary, ...extras]. Every site check in the app asks "is this one of the
// user's sites?" through these helpers — never `user.site_id === x` directly.
// The admin tier is unscoped and is handled by the callers (rdb.userHasRole(user,'admin')).

/** The user's site ids, primary first, de-duplicated (a pre-change session has only site_id). */
function siteIds(user) {
  if (!user) return [];
  const raw = [user.site_id].concat(Array.isArray(user.site_ids) ? user.site_ids : []);
  const out = [];
  for (const v of raw) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

function hasSite(user, siteId) {
  return siteIds(user).includes(Number(siteId));
}

/** The user's codes in one module, primary first. toCode(siteRow) → code|null. */
function codesFor(user, sites, toCode) {
  const out = [];
  for (const id of siteIds(user)) {
    const s = (sites || []).find((x) => Number(x.id) === id);
    if (!s) continue;
    let c = null;
    try { c = toCode(s); } catch (_) { c = null; }
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

const _k = (v) => String(v == null ? '' : v).trim().toUpperCase();

/** The object's code when the user holds it, else the primary code; null when no code. */
function pickCode(codes, wanted) {
  const list = Array.isArray(codes) ? codes : [];
  if (!list.length) return null;
  const hit = wanted ? list.find((c) => _k(c) === _k(wanted)) : null;
  return hit || list[0];
}

/** Is `code` in a scope given as a single code or a list of codes? (case-insensitive) */
function inScope(code, scope) {
  const list = Array.isArray(scope) ? scope : [scope];
  return list.some((c) => c && _k(c) === _k(code));
}

/** Readable scope for an error message. */
function scopeLabel(scope) {
  return Array.isArray(scope) ? scope.join(', ') : String(scope || '');
}

module.exports = { siteIds, hasSite, codesFor, pickCode, inScope, scopeLabel };
