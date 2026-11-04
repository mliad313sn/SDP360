'use strict';
// C-17 — `authz_capability_mode` = off | shadow | enforce (report_config, default off = today).
//
// instrument(app) runs ONCE after every route is registered (server.js, before export). It walks the
// router and wraps each role-guard layer (a middleware tagged with `legacyRoles`) so that, in SHADOW
// mode, the capability evaluator runs BESIDE the legacy guard on the same request and any divergence
// is written to system_log (category 'authz', action 'authz_shadow_divergence', actor = user id only —
// no name, no IP, no request body). The legacy guard ALWAYS answers the request: shadow never changes
// a response. `enforce` is NOT wired in this goal — it is read as `shadow` and logged once (see
// docs/agent-execution/C-17.md, "enforce plan").
const registry = require('./capabilityRegistry');
const authz = require('./authorizationService');

const MODES = Object.freeze(['off', 'shadow', 'enforce']);
const TTL_MS = 30000;
let _cache = { mode: 'off', at: 0 }, _warnedEnforce = false;

function normalizeMode(v) { const s = String(v == null ? '' : v).trim().toLowerCase(); return MODES.includes(s) ? s : 'off'; }

async function currentMode(deps = {}) {
  const now = Date.now();
  if (now - _cache.at < TTL_MS) return _cache.mode;
  try {
    const cfg = await (deps.getConfig ? deps.getConfig() : require('./reportConfig').getConfig());
    _cache = { mode: normalizeMode(cfg && cfg.authz_capability_mode), at: now };
  } catch (_) { _cache = { mode: 'off', at: now - TTL_MS + 5000 }; }   // degraded read: off, retried in 5 s
  return _cache.mode;
}
function _resetCache() { _cache = { mode: 'off', at: 0 }; _warnedEnforce = false; }

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
    if (mode === 'enforce' && !_warnedEnforce) { _warnedEnforce = true; console.warn('[authz] authz_capability_mode=enforce is not wired yet — running as shadow'); }
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
          const wrapped = function (req, res, next) { observe(req, roles, deps); return h(req, res, next); };
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

module.exports = { MODES, normalizeMode, currentMode, compare, observe, instrument, _resetCache };
