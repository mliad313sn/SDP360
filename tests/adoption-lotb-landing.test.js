'use strict';
// Adoption Lot B (item 6) — "each profile lands on its job", behind report_config ui_role_landing_profiles
// (default '0'). With the switch off the landing is exactly today's, for every persona and both values of
// ui_role_landing; with it on, an account holding feature roles only lands on the first page of its default
// workspace profile (public/lib/workspaceProfiles.js) instead of the Helpdesk. The page each profile lands on is a
// PROPOSAL for the pilot owner (docs/ai-decisions/ADR-ADOPTION-LOTB-profile-landing.md).
const test = require('node:test');
const assert = require('node:assert');
const Landing = require('../public/lib/landing');
const WP = require('../public/lib/workspaceProfiles');
const { uiPolicyFrom } = require('../services/uiPolicy');
const { DEFAULTS } = require('../services/reportConfig');

const HIER = ['viewer', 'editor', 'admin', 'executive', 'super_admin'];
const has = (roles) => (r) => roles.includes(r) || (HIER.includes(r) && roles.some((x) => HIER.indexOf(x) >= HIER.indexOf(r)));
const PERSONAS = {
  viewer: ['viewer'], editor: ['editor'], coordinator: ['editor', 'report-author'], admin: ['admin'], executive: ['executive'],
  super_admin: ['super_admin'], 'field-tech': ['field-tech'], 'tracker-editor': ['tracker-editor'],
  'committee-member': ['committee-member'], 'finance-viewer': ['finance-viewer'], 'audit-viewer': ['audit-viewer'],
  'kpi-committee': ['kpi-committee'], 'dashboard-publisher': ['dashboard-publisher'], 'scorecard-viewer': ['scorecard-viewer'],
  'report-author': ['report-author'], 'site-business': ['site-business'],
};
const land = (roles, roleLanding, profileLanding) => Landing.landingFor({ has: has(roles), isBusinessOnly: roles.every((r) => WP.BUSINESS_ROLES.includes(r)),
  roleLanding, profileLanding, roles, profiles: WP });

test('the four Lot B switches default to "0" and reach the browser policy', () => {
  for (const k of ['ui_role_landing_profiles', 'ui_home_group_variant', 'ui_home_freshness_strip', 'ui_helpdesk_site_default']) assert.strictEqual(DEFAULTS[k], '0', k);
  const off = uiPolicyFrom({});
  assert.deepStrictEqual([off.role_landing_profiles, off.home_group_variant, off.home_freshness_strip, off.helpdesk_site_default], ['0', '0', '0', '0']);
  const on = uiPolicyFrom({ ui_role_landing_profiles: '1', ui_home_group_variant: '1', ui_home_freshness_strip: '1', ui_helpdesk_site_default: '1' });
  assert.deepStrictEqual([on.role_landing_profiles, on.home_group_variant, on.home_freshness_strip, on.helpdesk_site_default], ['1', '1', '1', '1']);
  assert.strictEqual(uiPolicyFrom({ ui_role_landing_profiles: 'yes' }).role_landing_profiles, '0', 'a typo never switches it on');
});

test('switch off: the landing is today\'s for every persona (both ui_role_landing values)', () => {
  for (const rl of ['0', '1']) {
    for (const [name, roles] of Object.entries(PERSONAS)) {
      const today = Landing.landingFor({ has: has(roles), isBusinessOnly: roles.every((r) => WP.BUSINESS_ROLES.includes(r)), roleLanding: rl });
      assert.strictEqual(land(roles, rl, '0'), today, `${name} / role landing ${rl}`);
      assert.strictEqual(land(roles, rl, 'nonsense'), today, `${name}: unknown value behaves as off`);
    }
  }
});

test('switch on: feature-role accounts land on their profile\'s first page; hierarchical roles keep theirs', () => {
  const expect = {
    'committee-member': 'portfolio.html', 'finance-viewer': 'assets.html#finance', 'audit-viewer': 'cockpit.html',
    'kpi-committee': 'cockpit.html', 'dashboard-publisher': 'dashboards.html', 'scorecard-viewer': 'dashboards.html?key=exec-home',
    'field-tech': 'field/index.html', viewer: 'index.html', 'report-author': 'index.html',
  };
  for (const rl of ['0', '1']) {
    for (const [name, page] of Object.entries(expect)) assert.strictEqual(land(PERSONAS[name], rl, '1'), page, `${name} / role landing ${rl}`);
    // editor and above, tracker editors and business accounts are untouched by this switch
    for (const name of ['editor', 'coordinator', 'admin', 'executive', 'super_admin', 'tracker-editor', 'site-business']) {
      assert.strictEqual(land(PERSONAS[name], rl, '1'), land(PERSONAS[name], rl, '0'), `${name} unchanged / ${rl}`);
    }
  }
  // mixed: an editor who also sits on the committee keeps the editor landing
  assert.strictEqual(land(['editor', 'committee-member'], '1', '1'), 'home.html');
});

test('switch on without the profile catalogue loaded: nothing is guessed', () => {
  assert.strictEqual(Landing.landingFor({ has: has(['committee-member']), roleLanding: '0', profileLanding: '1', roles: ['committee-member'] }), 'index.html');
});

test('every page a profile lands on is a destination the person may open (catalogue rule)', () => {
  for (const [name, roles] of Object.entries(PERSONAS)) {
    const page = land(roles, '0', '1');
    const dest = Object.entries(WP.DESTINATIONS).find(([, d]) => d.href === page);
    if (page === 'site-awareness.html' || page === 'activity-tracker.html' || page === 'executive.html') continue;   // today's mapping
    assert.ok(dest, `${name}: ${page} is a catalogue destination`);
    assert.ok(WP.mayOpen(dest[0], { has: has(roles), roles }), `${name} may open ${page}`);
  }
});
