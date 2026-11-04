'use strict';
// C-28 (PO decision P12) — who may use the Deck Builder (executive-report.html), from report_config
// ui_deck_builder_roles (services/uiPolicy.js). Default 'super_admin' reproduces today exactly:
//   page  — public/auth.js data-require-policy="deck_builder_roles": super_admin + the listed roles
//   API   — the routes the page writes to: admin+ (today's floor, unchanged) OR one of the listed roles
// A bad value falls back to the default, so a typo can never widen access.
const { uiPolicyFrom } = require('./uiPolicy');
const httpError = require('./httpError');

function pageAudience(cfg) {
  return [...new Set(['super_admin', ...(uiPolicyFrom(cfg).deck_builder_roles || [])])];
}

function mayUseDeckBuilderApi(user, cfg, hasRole) {
  if (!user) return false;
  if (hasRole(user, 'admin')) return true;
  return pageAudience(cfg).some((r) => hasRole(user, r));
}

// Express guard. legacyRoles = the static floor (admin) for the authorisation matrix / capability registry.
function makeRequireDeckBuilder({ hasRole, getConfig }) {
  async function requireDeckBuilder(req, res, next) {
    let cfg = {};
    try { cfg = (await getConfig()) || {}; } catch (_) { cfg = {}; }   // unreadable config = default = today
    if (!mayUseDeckBuilderApi(req.reportUser, cfg, hasRole)) return httpError.fail(res, httpError.typed('FORBIDDEN', 'Deck Builder access only (admin or ui_deck_builder_roles)'), 403);
    next();
  }
  return Object.assign(requireDeckBuilder, { legacyRoles: ['admin'] });
}

module.exports = { pageAudience, mayUseDeckBuilderApi, makeRequireDeckBuilder };
