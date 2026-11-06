'use strict';
// C-17 — `authz_capability_mode` = off | shadow | enforce (report_config, default off = today).
//
// instrument(app) runs ONCE after every route is registered (server.js, before export). It walks the
// router and wraps each role-guard layer (a middleware tagged with `legacyRoles`) so that, in SHADOW
// mode, the capability evaluator runs BESIDE the legacy guard on the same request and any divergence
// is written to system_log (category 'authz', action 'authz_shadow_divergence', actor = user id only —
// no name, no IP, no request body). The legacy guard ALWAYS answers the request: shadow never changes
// a response.
//
// E-S01 (audit S-04, C-17 enforce plan step 2) — `enforce` acts ONLY on the capabilities listed in
// report_config `authz_enforce_caps` (comma list, default '' = nothing enforced = shadow for everything).
// For a listed capability, a `can()` DENY answers the request (403, reason_code, one system_log row
// category 'authz' action 'authz_enforce_denied', actor id only); a `can()` ALLOW hands the request to
// the legacy guard — so enforce can only ever REFUSE, never widen. A missing session stays the legacy
// guard's 401. A `critical` capability is ignored (warned once) while C-18 grants are off
// (access_require_approval and access_grant_expiry_job both '0'). Unlisted capabilities = shadow.
const registry = require('./capabilityRegistry');
const authz = require('./authorizationService');

const MODES = Object.freeze(['off', 'shadow', 'enforce']);
const TTL_MS = 30000;
const EMPTY = Object.freeze(new Set());
let _cache = { mode: 'off', caps: EMPTY, at: 0 }, _warned = new Set();

function normalizeMode(v) { const s = String(v == null ? '' : v).trim().toLowerCase(); return MODES.includes(s) ? s : 'off'; }

function _warnOnce(key, msg) { if (_warned.has(key)) return; _warned.add(key); console.warn('[authz] ' + msg); }

/**
 * Pure: the set of capability ids enforce may act on. Unknown ids and inline capabilities are dropped;
 * a `critical` capability is dropped while C-18 grants are off. `warn(key, msg)` is told why.
 */
function parseEnforceCaps(raw, cfg = {}, warn = () => {}) {
  const grantsOn = String(cfg.access_require_approval) === '1' || String(cfg.access_grant_expiry_job) === '1';
  const out = new Set();
  for (const id of String(raw == null ? '' : raw).split(',').map((x) => x.trim()).filter(Boolean)) {
    const c = registry.get(id);
    if (!c) { warn('unknown:' + id, `authz_enforce_caps: unknown capability "${id}" ignored`); continue; }
    if (c.inline) { warn('inline:' + id, `authz_enforce_caps: "${id}" is checked inside handlers, not by a guard — ignored`); continue; }
    if (c.risk === 'critical' && !grantsOn) { warn('critical:' + id, `authz_enforce_caps: critical capability "${id}" ignored while access grants (C-18) are off`); continue; }
    out.add(c.id);
  }
  return out;
}

async function _policy(deps = {}) {
  const now = Date.now();
  if (now - _cache.at < TTL_MS) return _cache;
  try {
    const cfg = await (deps.getConfig ? deps.getConfig() : require('./reportConfig').getConfig());
    const mode = normalizeMode(cfg && cfg.authz_capability_mode);
    const caps = mode === 'enforce' ? parseEnforceCaps(cfg && cfg.authz_enforce_caps, cfg || {}, _warnOnce) : EMPTY;
    _cache = { mode, caps, at: now };
  } catch (_) { _cache = { mode: 'off', caps: EMPTY, at: now - TTL_MS + 5000 }; }   // degraded read: off, retried in 5 s
  return _cache;
}
async function currentMode(deps = {}) { return (await _policy(deps)).mode; }
/** The cached policy when still fresh (synchronous fast path), else null. */
function _peek() { return Date.now() - _cache.at < TTL_MS ? _cache : null; }
function _resetCache() { _cache = { mode: 'off', caps: EMPTY, at: 0 }; _warned = new Set(); }

/** Pure comparison used by the wrapper and the tests. */
function compare(user, method, path, roles, hasRole) {
  const legacyAllow = roles.some((r) => hasRole(user, r));
  const cap = registry.forRoute(method, path, roles);
  const d = authz.can(user, cap ? cap.id : null, {}, hasRole);
  return { legacyAllow, capAllow: d.allow, capability: cap ? cap.id : null, reason_code: d.reason_code, diverges: legacyAllow !== d.allow };
}

/** Fire-and-forget shadow evaluation for one request. Never throws, never awaits on the request path. */
function observe(req, roles, deps = {}) {
  const hasRole = deps.hasRole || ((u, r) => require('../reports-db').userHasRole(u, r));
  Promise.resolve(currentMode(deps)).then(async (mode) => {
    if (mode === 'off') return;
    const path = (req.baseUrl || '') + (req.route && req.route.path ? req.route.path : req.path || '');
    const r = compare(req.reportUser, req.method, path, roles, hasRole);
    if (!r.diverges) return;
    const uid = req.reportUser && req.reportUser.id != null ? req.reportUser.id : null;
    const log = deps.logEvent || ((ev) => require('../reports-db').logEvent(ev));
    await log({ category: 'authz', action: 'authz_shadow_divergence', actor: uid != null ? 'user:' + uid : 'anonymous', actor_id: uid,
      target: r.capability || 'uncatalogued', risk: 0,
      details: { route: `${req.method} ${path}`, legacy_roles: roles, legacy_allow: r.legacyAllow, capability_allow: r.capAllow, reason_code: r.reason_code } });
  }).catch(() => {});
}

function _routePath(req) { return (req.baseUrl || '') + (req.route && req.route.path ? req.route.path : req.path || ''); }

/**
 * E-S01 — decide one request for a guard layer. Returns 'legacy' (call the legacy guard) or 'denied'
 * (a 403 has been sent). Only a capability in policy.caps under mode enforce can produce 'denied'.
 */
function enforceDecision(req, res, roles, policy, deps = {}) {
  if (!policy || policy.mode !== 'enforce' || !policy.caps.size) return 'legacy';
  const path = _routePath(req);
  const cap = registry.forRoute(req.method, path, roles);
  if (!cap || !policy.caps.has(cap.id)) return 'legacy';
  const user = req.reportUser;
  if (!user || typeof user !== 'object') return 'legacy';            // no session: the legacy guard's own 401
  const hasRole = deps.hasRole || ((u, r) => require('../reports-db').userHasRole(u, r));
  const d = authz.can(user, cap.id, {}, hasRole);
  if (d.allow) return 'legacy';                                      // never widen: the legacy guard still decides
  const uid = user.id != null ? user.id : null;
  const log = deps.logEvent || ((ev) => require('../reports-db').logEvent(ev));
  Promise.resolve().then(() => log({ category: 'authz', action: 'authz_enforce_denied', actor: uid != null ? 'user:' + uid : 'anonymous', actor_id: uid,
    target: cap.id, risk: 0, details: { route: `${req.method} ${path}`, legacy_roles: roles, reason_code: d.reason_code } })).catch(() => {});
  const httpError = require('./httpError');
  httpError.fail(res, httpError.typed('FORBIDDEN', 'Access denied: capability ' + cap.id + ' (' + d.reason_code + ')', 403), 403,
    { reason_code: d.reason_code, capability: cap.id });
  return 'denied';
}

/** Wrap every tagged guard layer of the app. Returns the number of layers instrumented. */
function instrument(app, deps = {}) {
  let n = 0;
  const visit = (stack) => {
    for (const layer of stack || []) {
      if (layer.route) {
        for (const l of layer.route.stack) {
          const h = l.handle;
          if (!h || !Array.isArray(h.legacyRoles) || h.__authzShadow) continue;
          const roles = [...h.legacyRoles];
          const run = (req, res, next, policy) => {
            if (enforceDecision(req, res, roles, policy, deps) === 'denied') return undefined;
            observe(req, roles, deps); return h(req, res, next);
          };
          const wrapped = function (req, res, next) {
            const p = _peek();
            if (p) return run(req, res, next, p);
            Promise.resolve(_policy(deps)).then((pol) => run(req, res, next, pol), () => run(req, res, next, null)).catch(next);
            return undefined;
          };
          Object.defineProperty(wrapped, 'name', { value: h.name });
          wrapped.legacyRoles = h.legacyRoles; wrapped.__authzShadow = true; wrapped.__inner = h;
          l.handle = wrapped; n++;
        }
      } else if (layer.handle && layer.handle.stack) visit(layer.handle.stack);
    }
  };
  visit(app && app._router && app._router.stack);
  return n;
}

module.exports = { MODES, normalizeMode, currentMode, parseEnforceCaps, enforceDecision, compare, observe, instrument, _resetCache };
