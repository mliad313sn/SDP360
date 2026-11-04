'use strict';
// A-09a — shared UI-policy channel (also used by A-10 landing / nav profile and the deck-builder audience).
// PURE: maps the report_config ui_* keys to the small policy object the browser caches as window.__uiPolicy
// (GET /api/reports/auth/me → {user, ui} → public/auth.js → localStorage 'sdp_ui_policy').
// Every key defaults to TODAY's behaviour and every unknown / blank value falls back to that default, so a
// typo in report_config can never switch a behaviour on.
//   ui_lang_default       ''  = saved choice, else browser language (today) · 'fr'|'en' = first-visit default
//   ui_i18n_pages         '0' = coordinator pages stay English (today) · '1' = page dictionaries active
//   ui_role_landing       '0' = today's landing page · '1' = role-based landing (A-10)
//   ui_nav_profile        'full' (today) · 'lean' (A-21 — shorter menu per role, labels kept down to 1180 px)
//   ui_deck_builder_roles comma list of roles that see the Deck Builder MENU ENTRY (A-21); 'super_admin' today —
//                         C-28: the PAGE gate (executive-report.html data-require-policy) and the routes the page
//                         writes to (services/deckBuilderGate.js) follow the same key; super_admin is always kept
//   ui_exec_nav           'full' (today) · 'consolidated' (C-28, PO P1 — Executive menu = Executive Home + IT
//                         Review; the Scorecard leaves the menu, stays in Home and the Ctrl+K finder)

const UI_DEFAULTS = {
  ui_lang_default: '',
  ui_i18n_pages: '0',
  ui_role_landing: '0',
  ui_nav_profile: 'full',
  ui_deck_builder_roles: 'super_admin',
  ui_exec_nav: 'full',
};
const UI_KEYS = Object.keys(UI_DEFAULTS);

const ENUMS = {
  ui_lang_default: ['', 'fr', 'en'],
  ui_i18n_pages: ['0', '1'],
  ui_role_landing: ['0', '1'],
  ui_nav_profile: ['full', 'lean'],
  ui_exec_nav: ['full', 'consolidated'],
};
// Same vocabulary as reports-db.js ROLE_HIERARCHY + FEATURE_ROLES_KNOWN (kept inline: this module stays pure).
const KNOWN_ROLES = new Set(['super_admin', 'executive', 'admin', 'editor', 'viewer',
  'tracker-admin', 'tracker-editor', 'report-author', 'audit-viewer', 'scorecard-viewer', 'site-business',
  'group-business', 'dashboard-publisher', 'committee-member', 'field-tech', 'finance-viewer']);

function _roles(v) {
  const list = String(v == null ? '' : v).split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length || !list.every((r) => KNOWN_ROLES.has(r))) return null;
  return [...new Set(list)];
}

// Is `value` acceptable for `key`? Only ui_* keys are policy keys.
function isAllowed(key, value) {
  if (!UI_KEYS.includes(key)) return false;
  if (key === 'ui_deck_builder_roles') return _roles(value) != null;
  return ENUMS[key].includes(String(value == null ? '' : value).trim());
}

function _pick(cfg, key) {
  const raw = cfg && cfg[key] != null ? String(cfg[key]).trim() : UI_DEFAULTS[key];
  return isAllowed(key, raw) ? raw : UI_DEFAULTS[key];
}

function uiPolicyFrom(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    lang_default: _pick(c, 'ui_lang_default'),
    i18n_pages: _pick(c, 'ui_i18n_pages'),
    role_landing: _pick(c, 'ui_role_landing'),
    nav_profile: _pick(c, 'ui_nav_profile'),
    deck_builder_roles: _roles(_pick(c, 'ui_deck_builder_roles')),
    exec_nav: _pick(c, 'ui_exec_nav'),
  };
}

module.exports = { UI_DEFAULTS, UI_KEYS, isAllowed, uiPolicyFrom };
