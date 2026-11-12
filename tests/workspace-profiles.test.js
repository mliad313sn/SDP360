'use strict';
// R1-PROFILES — the pure profile engine (public/lib/workspaceProfiles.js): the 11 profiles of REBUILD-SPEC R1,
// the role → default profile rule, business-only accounts, and "a destination is shown only if the roles open it".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const W = require('../services/workspaceProfiles');

// hierarchical role check, same tiers as reports-db.userHasRole; feature roles exact
const TIERS = ['viewer', 'editor', 'admin', 'executive', 'super_admin'];
function ctx(roles) {
  return { roles, has: (r) => {
    if (roles.includes(r)) return true;
    const want = TIERS.indexOf(r);
    if (want === -1) return false;
    return roles.some((x) => TIERS.indexOf(x) >= want);
  } };
}

test('the 11 profiles carry the roles and destinations of REBUILD-SPEC R1', () => {
  const spec = {
    administrator: [['super_admin'], ['home', 'dashboard', 'integrations', 'system-logs']],
    executive: [['executive', 'scorecard-viewer'], ['home', 'exec-home', 'it-review', 'portfolio']],
    business: [['site-business', 'group-business'], ['site-awareness']],
    operations: [['admin', 'editor'], ['home', 'dashboard', 'site-actions', 'assets']],
    coordinator: [['editor', 'report-author'], ['home', 'site-actions', 'inspections', 'meetings']],
    field: [['editor', 'field-tech'], ['home', 'field', 'inspections', 'site-actions']],
    pmo: [['admin', 'committee-member'], ['home', 'portfolio', 'cockpit', 'tracker']],
    finance: [['admin', 'finance-viewer'], ['home', 'finance-assets', 'portfolio', 'report-studio']],
    governance: [['admin', 'committee-member', 'audit-viewer', 'kpi-committee'], ['home', 'cockpit', 'meetings', 'policies']],
    analyst: [['admin', 'scorecard-viewer', 'dashboard-publisher'], ['home', 'dashboards', 'analytics', 'report-studio']],
    reader: [['any'], ['home', 'dashboard', 'site-actions', 'dashboards']],
  };
  assert.deepEqual(W.PROFILES.map((p) => p.id), Object.keys(spec));
  for (const p of W.PROFILES) {
    assert.deepEqual(p.roles, spec[p.id][0], p.id + ' roles');
    assert.deepEqual(p.destinations, spec[p.id][1], p.id + ' destinations');
    for (const d of p.destinations) assert.ok(W.DESTINATIONS[d], d + ' is in the catalogue');
    assert.ok(W.DENSITIES.includes(p.density));
  }
  assert.equal(W.PROFILES.find((p) => p.id === 'business').queue, false, 'business never queries the internal queue');
});

test('the destination catalogue carries the same role lists as the shell NAV (drift guard)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', '_shell.js'), 'utf8');
  for (const [id, d] of Object.entries(W.DESTINATIONS)) {
    if (id === 'finance-assets') { assert.deepEqual(d.roles, ['admin', 'finance-viewer'], 'requireMoneyRead roles'); continue; }
    const at = src.search(new RegExp(`id:\\s*'${id}'`));
    assert.ok(at > -1, `${id} found in _shell.js NAV`);
    const m = /roles:\s*\[([^\]]*)\]/.exec(src.slice(at));
    const roles = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    assert.deepEqual(d.roles, roles, `${id} roles drifted from the shell`);
  }
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), /function _canReadMoney/);
});

test('default profile follows the hierarchical role first, then feature roles', () => {
  const cases = [
    [['super_admin'], 'administrator'], [['executive'], 'executive'], [['viewer', 'scorecard-viewer'], 'executive'],
    [['admin'], 'operations'], [['admin', 'committee-member'], 'operations'], [['viewer', 'committee-member'], 'pmo'],
    [['viewer', 'finance-viewer'], 'finance'], [['editor'], 'coordinator'], [['editor', 'field-tech'], 'coordinator'],
    [['field-tech'], 'field'], [['viewer', 'audit-viewer'], 'governance'], [['viewer', 'kpi-committee'], 'governance'],
    [['viewer', 'dashboard-publisher'], 'analyst'], [['viewer'], 'reader'],
    [['site-business'], 'business'], [['group-business'], 'business'],
  ];
  for (const [roles, want] of cases) {
    assert.equal(W.defaultProfile(ctx(roles)), want, roles.join('+'));
    assert.ok(W.eligibleProfiles(ctx(roles)).includes(want), `${want} is eligible for ${roles.join('+')}`);
  }
});

test('a business-only account is offered ONLY the business profile and sees no internal destination', () => {
  for (const roles of [['site-business'], ['group-business'], ['site-business', 'group-business']]) {
    const c = ctx(roles);
    assert.deepEqual(W.eligibleProfiles(c), ['business']);
    const r = W.resolve(c, { profile: 'reader', card_order: ['dashboard', 'site-actions'] });
    assert.equal(r.profile, 'business');
    assert.equal(r.reason, 'not_allowed_fallback');
    assert.equal(r.queue, false);
    assert.deepEqual(r.destinations.map((d) => d.id), ['site-awareness']);
  }
  // a business role held alongside an internal role is not business-only: business stays one choice among others
  const mixed = W.eligibleProfiles(ctx(['viewer', 'site-business']));
  assert.ok(mixed.includes('business') && mixed.includes('reader'));
});

test('resolve never lists a destination the roles do not open — exhaustive over role sets and stored prefs', () => {
  const roleSets = [['viewer'], ['editor'], ['admin'], ['executive'], ['super_admin'], ['field-tech'], ['viewer', 'finance-viewer'],
    ['viewer', 'committee-member'], ['viewer', 'scorecard-viewer'], ['viewer', 'audit-viewer'], ['site-business'], ['viewer', 'dashboard-publisher']];
  const everything = Object.keys(W.DESTINATIONS);
  for (const roles of roleSets) {
    const c = ctx(roles);
    for (const p of W.PROFILES) {
      const r = W.resolve(c, { profile: p.id, card_order: everything, cards_hidden: [] });
      for (const d of r.destinations) assert.ok(W.mayOpen(d.id, c), `${roles.join('+')} / ${p.id} lists ${d.id} it cannot open`);
      assert.ok(r.eligible.includes(r.profile), 'the profile in use is always an allowed one');
    }
  }
  const v = W.resolve(ctx(['viewer']), { profile: 'administrator', card_order: ['system-logs', 'integrations', 'home'] });
  assert.equal(v.profile, 'reader');
  assert.ok(!v.destinations.some((d) => ['system-logs', 'integrations'].includes(d.id)));
});

test('stored order and hidden list are applied; unknown ids are dropped; density falls back to the profile', () => {
  const c = ctx(['editor']);
  const r = W.resolve(c, { profile: 'coordinator', card_order: ['meetings', 'nope', 'home'], cards_hidden: ['inspections'], density: 'weird' }, 'fr');
  assert.deepEqual(r.destinations.map((d) => d.id), ['meetings', 'home', 'site-actions', 'inspections']);
  assert.deepEqual(r.visible.map((d) => d.id), ['meetings', 'home', 'site-actions']);
  assert.equal(r.density, 'comfortable');
  assert.equal(r.destinations[0].label, 'Réunions');
  assert.equal(r.reason, 'chosen');
  assert.equal(W.resolve(c, null).reason, 'default');
});

test('validatePrefs refuses what the roles do not allow and malformed values', () => {
  const c = ctx(['viewer']);
  assert.match(W.validatePrefs({ profile: 'administrator' }, c).error, /not available/);
  assert.match(W.validatePrefs({ profile: 'root' }, c).error, /unknown profile/);
  assert.match(W.validatePrefs({ card_order: ['home', '<script>'] }, c).error, /unknown destination/);
  assert.match(W.validatePrefs({ card_order: 'home' }, c).error, /must be a list/);
  assert.match(W.validatePrefs({ cards_hidden: new Array(31).fill('home') }, c).error, /too long/);
  assert.match(W.validatePrefs({ density: 'tiny' }, c).error, /density/);
  assert.match(W.validatePrefs({ default_site_id: 'abc' }, c).error, /site id/);
  const ok = W.validatePrefs({ profile: 'reader', card_order: ['dashboard', 'home', 'home'], density: 'compact', default_site_id: '3' }, c);
  assert.deepEqual(ok.prefs, { profile: 'reader', card_order: ['dashboard', 'home'], cards_hidden: null, density: 'compact', default_site_id: 3 });
});

test('the switch defaults to today (off)', () => {
  assert.equal(require('../services/reportConfig').DEFAULTS.workspace_profiles_enabled, '0');
});
