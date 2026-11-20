'use strict';
// Adoption Lot A (item 4) — "zero menu entry leads to a 403". Walks every outcome persona of the committed authz
// snapshot (docs/ops/authz-outcomes.json, tests/authz-outcomes.smoke.test.js) × every menu entry the shell shows
// that persona, and checks that (1) the page's own gate (auth.js data-require) lets the persona in, and (2) the
// page's primary data route answers the persona with something other than a refusal (U / F). Before Lot A the
// Activity Tracker entry was on every menu while GET /api/tracker/load refuses 10 of 15 profiles.
// A new menu entry must name its primary route in PRIMARY below (or null for a static page) — the test says so.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', '_shell.js'), 'utf8');
const OUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'authz-outcomes.json'), 'utf8'));
const HIER = ['viewer', 'editor', 'admin', 'executive', 'super_admin'];
const BUSINESS = ['site-business', 'group-business'];

// page → the GET route the page cannot work without (probe key of docs/ops/authz-outcomes.json); null = static page.
const PRIMARY = {
  'home.html': 'GET /api/me/work',
  'site-awareness.html': 'GET /api/site-awareness/summary',
  'index.html': 'GET /api/data/requests-raw',
  'analytics.html': 'GET /api/metrics/requests',
  'inspections.html': 'GET /api/inspection/list',
  'meetings.html': 'GET /api/meetings/list',
  // the hub's GET /api/reports/site-actions needs ?site= (the probe sends none); its per-source lists are the data
  'site-actions.html': 'GET /api/meetings/actions',
  'activity-tracker.html': 'GET /api/tracker/load',
  'trackers.html': 'GET /api/trackers',
  'dashboards.html': 'GET /api/dashboards',
  'cockpit.html': 'GET /api/governance/overview',
  'portfolio.html': 'GET /api/governance/portfolio',
  'rfi.html': 'GET /api/governance/rfi',
  'report-studio.html': 'GET /api/report-studio/templates',
  'finance.html': 'GET /api/finance/certifications',
  'notifications.html': 'GET /api/engagement/notifications',
  'handoffs.html': 'GET /api/handoffs',
  'obligations.html': 'GET /api/obligations',
  'policies.html': 'GET /api/governance/policies',
  'kpi-builder.html': 'GET /api/kpi-policies',
  'integrations.html': 'GET /api/engagement/firings',
  'connector-health.html': 'GET /api/connector-health',
  'data-quality.html': 'GET /api/data-quality',
  'value-scoreboard.html': 'GET /api/value-scoreboard',
  'field/index.html': 'GET /api/field/bootstrap',
  'assets.html': 'GET /api/assets/inventory',
  'wan.html': 'GET /api/analytics/wan/summary',
  'infra-health.html': 'GET /api/analytics/infra/summary',
  'reports.html': 'GET /api/reports',
  'executive-report.html': 'GET /api/dashboard/presets',
  'it-review.html': 'GET /api/reports/review-data',
  'executive.html': 'GET /api/survey/summary',
  'system-logs.html': 'GET /api/reports/system-log',
  'help.html': null,
  // P11 r4 F-13 — the Policy Center entry (switch policy_center_page) is walked like every other policy-gated entry
  'policy-center.html': 'GET /api/policy-center/catalogue',
};
// Admin settings live on reports.html#admin: its data is the users list (super_admin), not the weekly reports.
const PRIMARY_BY_HREF = { 'reports.html#admin': 'GET /api/reports/users' };

function persona(key) {
  const tier = { viewA: ['viewer'], edNoSite: ['editor'], edA: ['editor'], edAB: ['editor'], sbizA: ['site-business'],
    gbiz: ['group-business'], admin: ['admin'], exec: ['executive'], super: ['super_admin'] };
  if (tier[key]) return tier[key];
  if (key.startsWith('f:')) return [key.slice(2)];
  return null;   // anon / deact / revoked — no menu
}
const has = (roles) => (r) => roles.includes(r) || (HIER.includes(r) && roles.some((x) => HIER.indexOf(x) >= HIER.indexOf(r)));

function menuFor(roles, policy) {
  const mount = { dataset: { section: 'x', current: 'y' }, innerHTML: '' };
  const document = { readyState: 'complete', getElementById: (id) => (id === '__shell' ? mount : null), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const businessOnly = roles.every((r) => BUSINESS.includes(r));
  const window = { __userHasRole: has(roles), __isBusinessOnly: businessOnly, __authUser: { full_name: 'A', role: roles[0] }, __uiPolicy: policy,
    EDV_ICONS: { html: () => '', get: () => '' } };
  vm.runInNewContext(SRC, { window, document, console, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'en' } });
  const sh = window.__shell;
  const model = JSON.parse(JSON.stringify(sh.menuModel()));
  const out = [];
  for (const sec of model) {
    const def = sh.NAV.find((s) => s.id === sec.id);
    if (!sec.children.length && def.href) out.push(def);
    for (const c of sec.children) out.push(def.children.find((x) => x.id === c.id));
  }
  return { items: out, businessOnly };
}
function pageGate(page) {
  let html = '';
  try { html = fs.readFileSync(path.join(ROOT, 'public', page), 'utf8'); } catch (_) { return 'any'; }
  const m = html.match(/src="auth\.js"[^>]*data-require="([^"]+)"/) || html.match(/data-require="([^"]+)"[^>]*src="auth\.js"/);
  return m ? m[1] : 'any';
}

const POLICIES = { defaults: undefined, 'all page switches on': { finance_page: '1', connector_health_page: '1', data_quality_page: '1', value_scoreboard_page: '1', policy_center_page: '1' } };
for (const [pname, policy] of Object.entries(POLICIES)) {
  test(`no menu entry leads to a refusal, for any persona (${pname})`, () => {
    const violations = [];
    let checked = 0;
    OUT.personas.forEach((key, idx) => {
      const roles = persona(key);
      if (!roles) return;
      const { items, businessOnly } = menuFor(roles, policy);
      for (const it of items) {
        const page = it.href.split(/[?#]/)[0];
        assert.ok(page in PRIMARY, `menu entry ${it.id} (${page}) has no primary route in PRIMARY — add it`);
        // (1) the page gate
        if (businessOnly && !['site-awareness.html', 'help.html'].includes(page)) violations.push(`${key} · ${it.id}: business-only redirect`);
        const gate = pageGate(page);
        if (gate !== 'any' && !gate.split('|').some(has(roles))) violations.push(`${key} · ${it.id}: page gate data-require="${gate}" refuses`);
        // (2) the primary data route
        const route = PRIMARY_BY_HREF[it.href] !== undefined ? PRIMARY_BY_HREF[it.href] : PRIMARY[page];
        if (route == null) continue;
        const codes = OUT.routes[route];
        assert.ok(codes, `primary route ${route} is in the outcome snapshot`);
        const c = codes[idx];
        checked++;
        // N is a switched-off feature (policy-gated entries only appear when the switch is on), never a role refusal
        if (c === 'U' || c === 'F') violations.push(`${key} · ${it.id}: ${route} → ${c}`);
      }
    });
    assert.ok(checked > 200, `walk is not vacuous (${checked} persona × entry checks)`);
    assert.deepStrictEqual(violations, []);
  });
}

test('the Activity Tracker entry carries the same roles as its data route', () => {
  const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'authz-matrix.json'), 'utf8'));
  const row = matrix.routes.find((r) => r.method === 'GET' && r.path === '/api/tracker/load');
  assert.ok(row, 'route in the matrix');
  const roles = (row.roles || row.guard_roles || []).slice().sort();
  const nav = SRC.match(/id: 'tracker', group: 'Plan & track'[^\n]*roles: \[([^\]]+)\]/);
  assert.ok(nav, 'tracker nav entry found');
  const navRoles = nav[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort();
  if (roles.length) assert.deepStrictEqual(navRoles, roles);
  assert.deepStrictEqual(navRoles, ['admin', 'tracker-admin', 'tracker-editor']);
});

// P11 r4 F-13 — "all page switches on" turns on EVERY policy-gated menu entry of the shell, so a new switch cannot
// escape the walk again (the Policy Center entry did).
test('the "all page switches on" policy covers every policy-gated menu entry', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'public', '_shell.js'), 'utf8');
  const gated = [...new Set([...shell.matchAll(/policy: *'([a-z_]+)'/g)].map((m) => m[1]))];
  assert.ok(gated.length >= 5, 'found the gated entries');
  for (const k of gated) assert.strictEqual(POLICIES['all page switches on'][k], '1', k + ' is not switched on in the walk');
});

// Adoption Lot B — "each profile lands on its job": with the Lot B switches ON, the page each persona LANDS on
// (ui_role_landing_profiles, with ui_role_landing '0' and '1') and every route the optional Home blocks call
// (ui_home_group_variant, ui_home_freshness_strip) and the Helpdesk site default (ui_helpdesk_site_default) must be
// readable by that persona — a landing page is a starting point, never a dead end.
test('Lot B: landing pages and Home-block routes never lead a persona to a refusal (switches on)', () => {
  const Landing = require('../public/lib/landing');
  const WP = require('../public/lib/workspaceProfiles');
  const HG = require('../public/lib/homeGroup');
  const HSD = require('../public/lib/helpdeskSiteDefault');
  const BY_HREF = Object.assign({}, PRIMARY_BY_HREF, { 'assets.html#finance': 'GET /api/assets/finance/summary' });
  const on = { home_group_variant: '1', home_freshness_strip: '1', helpdesk_site_default: '1' };
  const violations = [];
  let checked = 0;
  const route = (key, idx, r, why) => {
    const codes = OUT.routes[r];
    assert.ok(codes, `route ${r} is in the outcome snapshot`);
    checked++;
    if (codes[idx] === 'U' || codes[idx] === 'F') violations.push(`${key} · ${why}: ${r} → ${codes[idx]}`);
  };
  OUT.personas.forEach((key, idx) => {
    const roles = persona(key);
    if (!roles) return;
    const businessOnly = roles.every((r) => BUSINESS.includes(r));
    for (const rl of ['0', '1']) {
      const href = Landing.landingFor({ has: has(roles), isBusinessOnly: businessOnly, roleLanding: rl, profileLanding: '1', roles, profiles: WP });
      const page = href.split(/[?#]/)[0];
      assert.ok(page in PRIMARY, `landing ${href} has a primary route in PRIMARY`);
      if (businessOnly && !['site-awareness.html', 'help.html'].includes(page)) violations.push(`${key} · landing ${href}: business-only redirect`);
      const gate = pageGate(page);
      if (gate !== 'any' && !gate.split('|').some(has(roles))) violations.push(`${key} · landing ${href}: page gate "${gate}" refuses`);
      const r = BY_HREF[href] !== undefined ? BY_HREF[href] : PRIMARY[page];
      if (r) route(key, idx, r, `landing ${href} (role landing ${rl})`);
    }
    if (businessOnly) return;   // business accounts never reach Home or the Helpdesk
    const b = HG.blocksFor(has(roles), on, true);
    if (b.group) { route(key, idx, 'GET /api/governance/portfolio', 'home group'); route(key, idx, 'GET /api/governance/overview', 'home group'); }
    if (b.worst) route(key, idx, 'GET /api/site-awareness/fleet', 'home worst sites');
    if (b.freshness) route(key, idx, 'GET /api/connector-health', 'home freshness');
    if (HSD.applies(on, { site_id: 1 }, has(roles))) route(key, idx, 'GET /api/reports/sites', 'helpdesk site default');
  });
  assert.ok(checked > 40, `walk is not vacuous (${checked})`);
  assert.deepStrictEqual(violations, []);
});
