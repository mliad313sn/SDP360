/* R1-PROFILES (REBUILD-SPEC R1 + R2) — presentation profiles and workspace preferences. PURE.
 *
 * A profile is a PRESENTATION choice: which destinations a person sees first, in which order, how dense,
 * and whether the context is a site or the group. It NEVER grants anything: every destination is filtered
 * through the person's real roles (same rule as the shell menu), every route keeps its own gate, and the
 * server re-checks the chosen profile against the roles on each save and each read.
 *
 * The caller passes the role check; nothing global is read here:
 *   ctx = { has(role) → bool  (hierarchical: super_admin > executive > admin > editor > viewer;
 *                              feature roles exact — rdb.userHasRole on the server, window.__userHasRole
 *                              in the browser),
 *           roles: [...]      (the raw role list, only used for the business-only rule) }
 *
 * Business-only accounts (only site-business / group-business) are offered ONLY the business profile:
 * the shell rule makes 'any' destinations invisible to them, so a "reader" profile would show nothing
 * but Home — and the business profile never queries the internal action queue.
 *
 * UMD — window.WorkspaceProfiles in the browser (plus .load() for the page/shell), module.exports in Node.
 */
(function (root) {
  'use strict';

  var BUSINESS_ROLES = ['site-business', 'group-business'];
  var DENSITIES = ['comfortable', 'compact'];
  var MAX_LIST = 30;

  // Destination catalogue — mirrors public/_shell.js NAV (id, href, roles). tests/workspace-profiles.test.js
  // parses the NAV literal and fails when a role list here drifts from the shell's.
  // finance-assets is not a NAV id: it is the Assets Finance tab, gated server-side by requireMoneyRead
  // (admin or finance-viewer) — the same two roles are declared here.
  var DESTINATIONS = {
    'home':           { href: 'home.html',                     roles: ['viewer', 'editor', 'admin', 'executive', 'field-tech', 'tracker-editor'], en: 'Home',                fr: 'Accueil' },
    'dashboard':      { href: 'index.html',                    roles: ['any'],                                    en: 'Helpdesk dashboard',  fr: 'Tableau helpdesk' },
    'integrations':   { href: 'integrations.html',             roles: ['admin'],                                  en: 'Integrations',        fr: 'Intégrations' },
    'system-logs':    { href: 'system-logs.html',              roles: ['super_admin'],                            en: 'System logs',         fr: 'Journaux système' },
    'exec-home':      { href: 'dashboards.html?key=exec-home', roles: ['executive', 'scorecard-viewer'],          en: 'Executive home',      fr: 'Accueil direction' },
    'it-review':      { href: 'it-review.html',                roles: ['executive', 'scorecard-viewer'],          en: 'IT review',           fr: 'Revue IT' },
    'portfolio':      { href: 'portfolio.html',                roles: ['any'],                                    en: 'Portfolio',           fr: 'Portefeuille' },
    'site-awareness': { href: 'site-awareness.html',           roles: ['site-business', 'group-business', 'executive'], en: 'Site view',     fr: 'Vue site' },
    'site-actions':   { href: 'site-actions.html',             roles: ['any'],                                    en: 'Site actions',        fr: 'Actions du site' },
    'assets':         { href: 'assets.html',                   roles: ['any'],                                    en: 'Assets',              fr: 'Parc' },
    'inspections':    { href: 'inspections.html',              roles: ['any'],                                    en: 'Inspections',         fr: 'Inspections' },
    'meetings':       { href: 'meetings.html',                 roles: ['any'],                                    en: 'Meetings',            fr: 'Réunions' },
    'field':          { href: 'field/index.html',              roles: ['editor', 'field-tech'],                   en: 'Field app',           fr: 'Application terrain' },
    'cockpit':        { href: 'cockpit.html',                  roles: ['any'],                                    en: 'Meeting cockpit',     fr: 'Cockpit de réunion' },
    'tracker':        { href: 'activity-tracker.html',         roles: ['any'],                                    en: 'Activity tracker',    fr: 'Suivi des activités' },
    'finance-assets': { href: 'assets.html#finance',           roles: ['admin', 'finance-viewer'],                en: 'Asset finance',       fr: 'Finance du parc' },
    'report-studio':  { href: 'report-studio.html',            roles: ['any'],                                    en: 'Report studio',       fr: 'Studio de rapports' },
    'policies':       { href: 'policies.html',                 roles: ['admin', 'committee-member'],              en: 'Governance policies', fr: 'Politiques de gouvernance' },
    'dashboards':     { href: 'dashboards.html',               roles: ['any'],                                    en: 'Dashboards',          fr: 'Tableaux de bord' },
    'analytics':      { href: 'analytics.html',                roles: ['admin', 'scorecard-viewer'],              en: 'Analytics',           fr: 'Analytique' },
  };

  // The 11 profiles of REBUILD-SPEC R1 (declared roles + initial destination order). Density and context
  // are PROPOSALS (presentation defaults), changeable by each person in workspace settings.
  var PROFILES = [
    { id: 'administrator', roles: ['super_admin'],                                        destinations: ['home', 'dashboard', 'integrations', 'system-logs'],      density: 'compact',     context: 'group', en: 'Administrator', fr: 'Administrateur' },
    { id: 'executive',     roles: ['executive', 'scorecard-viewer'],                      destinations: ['home', 'exec-home', 'it-review', 'portfolio'],           density: 'comfortable', context: 'group', en: 'Executive',     fr: 'Direction' },
    { id: 'business',      roles: ['site-business', 'group-business'],                    destinations: ['site-awareness'],                                        density: 'comfortable', context: 'site',  en: 'Business',      fr: 'Métier', queue: false },
    { id: 'operations',    roles: ['admin', 'editor'],                                    destinations: ['home', 'dashboard', 'site-actions', 'assets'],           density: 'compact',     context: 'group', en: 'Operations',    fr: 'Opérations' },
    { id: 'coordinator',   roles: ['editor', 'report-author'],                            destinations: ['home', 'site-actions', 'inspections', 'meetings'],       density: 'comfortable', context: 'site',  en: 'Coordinator',   fr: 'Coordinateur' },
    { id: 'field',         roles: ['editor', 'field-tech'],                               destinations: ['home', 'field', 'inspections', 'site-actions'],          density: 'comfortable', context: 'site',  en: 'Field',         fr: 'Terrain' },
    { id: 'pmo',           roles: ['admin', 'committee-member'],                          destinations: ['home', 'portfolio', 'cockpit', 'tracker'],               density: 'comfortable', context: 'group', en: 'PMO',           fr: 'PMO' },
    { id: 'finance',       roles: ['admin', 'finance-viewer'],                            destinations: ['home', 'finance-assets', 'portfolio', 'report-studio'],  density: 'comfortable', context: 'group', en: 'Finance',       fr: 'Finance' },
    { id: 'governance',    roles: ['admin', 'committee-member', 'audit-viewer', 'kpi-committee'], destinations: ['home', 'cockpit', 'meetings', 'policies'],       density: 'comfortable', context: 'group', en: 'Governance',    fr: 'Gouvernance' },
    { id: 'analyst',       roles: ['admin', 'scorecard-viewer', 'dashboard-publisher'],   destinations: ['home', 'dashboards', 'analytics', 'report-studio'],      density: 'compact',     context: 'group', en: 'Analyst',       fr: 'Analyste' },
    { id: 'reader',        roles: ['any'],                                                destinations: ['home', 'dashboard', 'site-actions', 'dashboards'],       density: 'comfortable', context: 'site',  en: 'Reader',        fr: 'Lecteur' },
  ];
  var BY_ID = {};
  PROFILES.forEach(function (p) { BY_ID[p.id] = p; });

  function _has(ctx) { return ctx && typeof ctx.has === 'function' ? ctx.has : function () { return false; }; }

  function isBusinessOnly(roles) {
    if (!Array.isArray(roles) || roles.length === 0) return false;
    return roles.every(function (r) { return BUSINESS_ROLES.indexOf(r) !== -1; });
  }

  // Same rule as _shell.js hasAnyRole: 'any' grants every logged-in user EXCEPT a business-only account.
  function grants(roles, ctx) {
    if (!Array.isArray(roles)) return false;
    var bo = isBusinessOnly(ctx && ctx.roles);
    if (roles.indexOf('any') !== -1) return !bo;
    var has = _has(ctx);
    return roles.some(function (r) { return has(r); });
  }

  /** May this person open the destination? (presentation filter — the page keeps its own server gate) */
  function mayOpen(destId, ctx) {
    var d = DESTINATIONS[destId];
    return !!d && grants(d.roles, ctx);
  }

  /** Profiles this person may choose, in catalogue order. A business-only account gets only 'business'. */
  function eligibleProfiles(ctx) {
    if (isBusinessOnly(ctx && ctx.roles)) return ['business'];
    var has = _has(ctx);
    return PROFILES.filter(function (p) {
      if (p.id === 'business') return BUSINESS_ROLES.some(function (r) { return has(r); });
      return grants(p.roles, ctx);
    }).map(function (p) { return p.id; });
  }

  /** The default profile for these roles: the hierarchical role decides first, then feature roles
   *  (same precedence as the shell's G17 workspaces). */
  function defaultProfile(ctx) {
    if (isBusinessOnly(ctx && ctx.roles)) return 'business';
    var has = _has(ctx);
    if (has('super_admin')) return 'administrator';
    if (has('executive') || has('scorecard-viewer')) return 'executive';
    if (has('admin')) return 'operations';
    if (has('committee-member')) return 'pmo';
    if (has('finance-viewer')) return 'finance';
    if (has('editor')) return 'coordinator';
    if (has('field-tech')) return 'field';
    if (has('audit-viewer') || has('kpi-committee')) return 'governance';
    if (has('dashboard-publisher')) return 'analyst';
    return 'reader';
  }

  function _ids(v) {
    var a = v;
    if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { a = null; } }
    if (!Array.isArray(a)) return null;
    var out = [];
    a.forEach(function (x) { var s = String(x); if (DESTINATIONS[s] && out.indexOf(s) === -1) out.push(s); });
    return out;
  }

  /** Resolve what this person sees. prefs = stored row (or null). Never returns a destination the
   *  person may not open; an ineligible stored profile falls back to the role default (reason given). */
  function resolve(ctx, prefs, lang) {
    var p = prefs || {};
    var eligible = eligibleProfiles(ctx);
    var fallback = defaultProfile(ctx);
    if (eligible.indexOf(fallback) === -1) fallback = eligible[0] || 'reader';
    var chosen = p.profile && eligible.indexOf(p.profile) !== -1 ? p.profile : fallback;
    var reason = !p.profile ? 'default' : (chosen === p.profile ? 'chosen' : 'not_allowed_fallback');
    var prof = BY_ID[chosen];
    var order = prof.destinations.slice();
    var custom = _ids(p.card_order);
    if (custom && custom.length) {
      // the stored order wins for the destinations it names; the profile's others follow in profile order
      order = custom.concat(order.filter(function (id) { return custom.indexOf(id) === -1; }));
    }
    var hidden = _ids(p.cards_hidden) || [];
    var L = lang === 'fr' ? 'fr' : 'en';
    var destinations = order.filter(function (id) { return mayOpen(id, ctx); }).map(function (id) {
      var d = DESTINATIONS[id];
      return { id: id, href: d.href, label: d[L], hidden: hidden.indexOf(id) !== -1 };
    });
    return {
      profile: chosen, profile_label: prof[L], reason: reason, eligible: eligible,
      default_profile: fallback,
      density: DENSITIES.indexOf(p.density) !== -1 ? p.density : prof.density,
      context: prof.context,
      queue: prof.queue !== false,
      default_site_id: p.default_site_id != null ? Number(p.default_site_id) : null,
      destinations: destinations,
      visible: destinations.filter(function (d) { return !d.hidden; }),
    };
  }

  /** Validate a preferences body against what THIS person may choose. → { prefs } | { error }.
   *  The site check (default_site_id) is the caller's: it needs the user's site list. */
  function validatePrefs(body, ctx) {
    var b = body || {};
    var out = {};
    if (b.profile != null && b.profile !== '') {
      var pr = String(b.profile);
      if (!BY_ID[pr]) return { error: 'unknown profile' };
      if (eligibleProfiles(ctx).indexOf(pr) === -1) return { error: 'this profile is not available for your roles' };
      out.profile = pr;
    } else out.profile = null;
    function list(key) {
      if (b[key] == null) return null;
      if (!Array.isArray(b[key])) return { error: key + ' must be a list' };
      if (b[key].length > MAX_LIST) return { error: key + ' is too long' };
      for (var i = 0; i < b[key].length; i++) if (!DESTINATIONS[String(b[key][i])]) return { error: key + ': unknown destination ' + String(b[key][i]).slice(0, 40) };
      return { ok: _ids(b[key]) };
    }
    var co = list('card_order'); if (co && co.error) return co; out.card_order = co ? co.ok : null;
    var ch = list('cards_hidden'); if (ch && ch.error) return ch; out.cards_hidden = ch ? ch.ok : null;
    if (b.density != null && b.density !== '') {
      if (DENSITIES.indexOf(String(b.density)) === -1) return { error: 'density must be comfortable or compact' };
      out.density = String(b.density);
    } else out.density = null;
    if (b.default_site_id != null && b.default_site_id !== '') {
      var n = Number(b.default_site_id);
      if (!Number.isInteger(n) || n <= 0) return { error: 'default_site_id must be a site id' };
      out.default_site_id = n;
    } else out.default_site_id = null;
    return { prefs: out };
  }

  var api = {
    PROFILES: PROFILES, DESTINATIONS: DESTINATIONS, DENSITIES: DENSITIES, BUSINESS_ROLES: BUSINESS_ROLES,
    isBusinessOnly: isBusinessOnly, mayOpen: mayOpen, eligibleProfiles: eligibleProfiles,
    defaultProfile: defaultProfile, resolve: resolve, validatePrefs: validatePrefs,
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // Browser: the hand-off point for the shell / Home (R2-QUEUE). Resolves null while the switch is off
  // (the API answers 404) or on any error — callers then behave exactly as today.
  api.load = function () {
    var h = { 'Accept': 'application/json' };
    try { if (window.__authToken) h['x-report-token'] = window.__authToken; } catch (_) {}
    return fetch('/api/workspace/me', { headers: h, credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  };
  root.WorkspaceProfiles = api;
})(typeof self !== 'undefined' ? self : this);
