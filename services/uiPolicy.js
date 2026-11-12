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
//   ui_kpi_base_line      '0' = KPI tiles as today · '1' = "n = 142 closed" / "base not measured" under the value (E-V03)
//   ui_kpi_definition_drawer '0' = as today · '1' = "Definition" drawer on KPI tiles (formula, window, denominator, source job,
//                         certification) and "n of N sites" on the fleet comparator (F-DATA-07)
//   ui_kpi_sample_size    '0' = as today · '1' = "n = …" on tiles/grid cells + low-sample warning from an ADOPTED
//                         kpi_policy min_sample (E-K02; no adopted policy → no warning)
//   ui_small_multiples    '0' = the `multiples` widget type is not creatable (today) · '1' = offered (E-V09)
//   ui_feedback_enabled   '0' = no Feedback button, /api/feedback answers 404 (today) · '1' = in-app feedback (E-B07)
//   ui_data_quality_page  '0' = no Data quality nav entry, the page answers 404 (today) · '1' = shown (E-D07)
//   ui_url_filters        '0' = Analytics filters are not written to the URL (today) · '1' = written with
//                         history.replaceState and restored on load, Reset clears them (E-U02)
//   ui_nav_active_from_url '0' = the active menu entry comes from the page's data-current only (today) · '1' = when
//                         data-current names no menu entry, the entry matching the address is marked (F-UX-02)
//   ui_exec_charts_v2     '0' = Executive Scorecard charts as today · '1' = dual axes as small multiples, rings as bars,
//                         same figures (F-UX-12; arming needs a browser review, decision D5)
//   ui_home_queue         '0' = Home as today · '1' = progressive queue "S1" of my authorised work across sources, each source with
//                         its own state (available / unknown / stale / partial / denied), 12 sites, 150 items (R2-QUEUE, R3)
//   ui_nav_carry_site     '0' = menu links as today · '1' = links to site-aware pages carry the current ?site=CODE (R2-QUEUE, R4)
//   ui_home_blocks        '0' = Home renders in one pass, a failed call blanks it (today) · '1' = each block shows
//                         its own state, a failed call keeps the page with a retry, each site card reloads alone (F-UX-09)

const UI_DEFAULTS = {
  ui_lang_default: '',
  ui_i18n_pages: '0',
  ui_role_landing: '0',
  ui_nav_profile: 'full',
  ui_deck_builder_roles: 'super_admin',
  ui_exec_nav: 'full',
  ui_kpi_base_line: '0',
  ui_kpi_sample_size: '0',
  ui_kpi_definition_drawer: '0',
  ui_small_multiples: '0',
  ui_feedback_enabled: '0',
  ui_data_quality_page: '0',
  ui_url_filters: '0',
  ui_nav_active_from_url: '0',
  ui_home_blocks: '0',
  ui_exec_charts_v2: '0',
  ui_home_queue: '0',
  ui_nav_carry_site: '0',
};
const UI_KEYS = Object.keys(UI_DEFAULTS);

const ENUMS = {
  ui_lang_default: ['', 'fr', 'en'],
  ui_i18n_pages: ['0', '1'],
  ui_role_landing: ['0', '1'],
  ui_nav_profile: ['full', 'lean'],
  ui_exec_nav: ['full', 'consolidated'],
  ui_kpi_base_line: ['0', '1'],
  ui_kpi_sample_size: ['0', '1'],
  ui_kpi_definition_drawer: ['0', '1'],
  ui_small_multiples: ['0', '1'],
  ui_feedback_enabled: ['0', '1'],
  ui_data_quality_page: ['0', '1'],
  ui_url_filters: ['0', '1'],
  ui_nav_active_from_url: ['0', '1'],
  ui_home_blocks: ['0', '1'],
  ui_exec_charts_v2: ['0', '1'],
  ui_home_queue: ['0', '1'],
  ui_nav_carry_site: ['0', '1'],
};
// Same vocabulary as reports-db.js ROLE_HIERARCHY + FEATURE_ROLES_KNOWN (kept inline: this module stays pure).
const KNOWN_ROLES = new Set(['super_admin', 'executive', 'admin', 'editor', 'viewer',
  'tracker-admin', 'tracker-editor', 'report-author', 'audit-viewer', 'scorecard-viewer', 'site-business',
  'group-business', 'dashboard-publisher', 'committee-member', 'field-tech', 'finance-viewer', 'kpi-committee', 'finance-verifier']);

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
    kpi_base_line: _pick(c, 'ui_kpi_base_line'),
    kpi_sample_size: _pick(c, 'ui_kpi_sample_size'),
    kpi_definition_drawer: _pick(c, 'ui_kpi_definition_drawer'),
    small_multiples: _pick(c, 'ui_small_multiples'),
    feedback: _pick(c, 'ui_feedback_enabled'),
    data_quality_page: _pick(c, 'ui_data_quality_page'),
    url_filters: _pick(c, 'ui_url_filters'),
    nav_active_from_url: _pick(c, 'ui_nav_active_from_url'),
    home_blocks: _pick(c, 'ui_home_blocks'),
    exec_charts_v2: _pick(c, 'ui_exec_charts_v2'),
    home_queue: _pick(c, 'ui_home_queue'),
    nav_carry_site: _pick(c, 'ui_nav_carry_site'),
    // R2-QUEUE — not a ui_* key: the shell shows the "My workspace" link only while the settings page exists
    workspace_profiles: String(c.workspace_profiles_enabled == null ? '' : c.workspace_profiles_enabled).trim() === '1' ? '1' : '0',
    // UAT-F — not a ui_* key: the Home queue skips the commitments source (no 404 probe) while the module is off
    commitments: String(c.commitments_enabled == null ? '' : c.commitments_enabled).trim() === '1' ? '1' : '0',
    // A7 — not a ui_* key (a KPI switch): which SLA rate the Helpdesk / scorecard tiles show as the headline
    sla_headline: require('../public/lib/slaDual').normalizeHeadline(c.sla_headline_definition),
    // F-UX-06 — not a ui_* key (it is a telemetry switch): the browser only needs to know whether to send events
    ux_events: String(c.ux_event_telemetry == null ? '' : c.ux_event_telemetry).trim() === '1' ? '1' : '0',
    // A1/B8 — not a ui_* key: the shell shows the Finance certification entry only while one of its switches is on
    finance_page: ['finance_certification_enabled', 'actuals_import_enabled'].some((k) => String(c[k] == null ? '' : c[k]).trim() === '1') ? '1' : '0',
  };
}

module.exports = { UI_DEFAULTS, UI_KEYS, isAllowed, uiPolicyFrom };
