'use strict';
// A-21 — navigation budget per role behind report_config ui_nav_profile ('full' = today, 'lean' = proposal,
// to be re-decided from the pilot usability sessions) and ui_deck_builder_roles (the Deck Builder ENTRY only;
// the page gate stays super_admin). Loaded in the same vm sandbox as tests/shell-navigation.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', '_shell.js'), 'utf8').replace(/\r\n/g, '\n');

const j = (x) => JSON.parse(JSON.stringify(x)); // sandbox arrays come from another realm
function load(roles, { businessOnly = false, profile, deck } = {}) {
  const mount = { dataset: { section: 'operations', current: 'inspections' }, innerHTML: '' };
  const classes = new Set();
  const body = { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) } };
  const document = { readyState: 'complete', body, getElementById: (id) => (id === '__shell' ? mount : null), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const HIER = ['viewer', 'editor', 'admin', 'executive', 'super_admin'];
  const has = (r) => roles.includes(r) || (HIER.includes(r) && roles.some((x) => HIER.indexOf(x) >= HIER.indexOf(r)));
  const policy = {};
  if (profile !== undefined) policy.nav_profile = profile;
  if (deck !== undefined) policy.deck_builder_roles = deck;
  const window = { __userHasRole: has, __isBusinessOnly: businessOnly, __authUser: { full_name: 'Ana', role: roles[0] }, __uiPolicy: policy, EDV_ICONS: { html: () => '', get: () => '' } };
  const localStorage = { getItem: () => null, setItem() {} };
  vm.runInNewContext(SRC, { window, document, console, localStorage, navigator: { language: 'en-US' } });
  return { shell: window.__shell, mount, classes };
}
// { sectionId: [visible menu child ids] } — compare by id, never by (translated) label
const model = (shell) => Object.fromEntries(j(shell.menuModel()).map((s) => [s.id, s.children.map((c) => c.id)]));

const PERSONAS = {
  viewer: [['viewer']],
  editor: [['editor']],
  'editor+tracker-editor': [['editor', 'tracker-editor']],
  'field-tech': [['field-tech']],
  admin: [['admin']],
  executive: [['executive']],
  super_admin: [['super_admin']],
  'committee-member': [['committee-member']],
  'business-only': [['site-business'], true],
};

// Today's menu (measured on sdp-waves before A-21) — the 'full' profile must reproduce it entry for entry.
const OPS_ANY = ['inspections', 'meetings', 'site-actions', 'tracker', 'trackers', 'dashboards', 'cockpit', 'portfolio', 'rfi', 'report-studio', 'notifications', 'handoffs', 'obligations'];
const INFRA = ['assets', 'wan', 'infra-health'];
const TODAY = {
  viewer: { home: [], helpdesk: ['dashboard'], operations: OPS_ANY, infrastructure: INFRA, reports: ['site-reports'], help: [] },
  editor: { home: [], helpdesk: ['dashboard'], operations: [...OPS_ANY, 'field'], infrastructure: INFRA, reports: ['site-reports'], help: [] },
  'editor+tracker-editor': { home: [], helpdesk: ['dashboard'], operations: [...OPS_ANY, 'field'], infrastructure: INFRA, reports: ['site-reports'], help: [] },
  'field-tech': { home: [], helpdesk: ['dashboard'], operations: [...OPS_ANY, 'field'], infrastructure: INFRA, reports: ['site-reports'], help: [] },
  admin: { home: [], helpdesk: ['dashboard', 'analytics'], operations: [...OPS_ANY, 'policies', 'integrations', 'field'], infrastructure: INFRA, reports: ['site-reports'], help: [] },
  executive: { home: [], 'site-awareness': [], helpdesk: ['dashboard', 'analytics'], operations: [...OPS_ANY, 'policies', 'integrations', 'field'], infrastructure: INFRA, reports: ['site-reports'], executive: ['exec-home', 'it-review', 'scorecard'], help: [] },
  super_admin: { home: [], 'site-awareness': [], helpdesk: ['dashboard', 'analytics'], operations: [...OPS_ANY, 'policies', 'integrations', 'field'], infrastructure: INFRA, reports: ['site-reports', 'reports-builder'], executive: ['exec-home', 'it-review', 'scorecard'], admin: ['admin-settings', 'system-logs'], help: [] },
  'committee-member': { helpdesk: ['dashboard'], operations: [...OPS_ANY, 'policies'], infrastructure: INFRA, reports: ['site-reports'], help: [] },
  'business-only': { 'site-awareness': [] },
};
const TODAY_TOP = { viewer: 6, editor: 6, 'editor+tracker-editor': 6, 'field-tech': 6, admin: 6, executive: 8, super_admin: 9, 'committee-member': 5, 'business-only': 1 };

const opsTasks = (shell) => (j(shell.menuModel()).find((s) => s.id === 'operations') || { children: [] }).children.filter((c) => c.group !== 'Configure');
const opsConfigure = (shell) => (j(shell.menuModel()).find((s) => s.id === 'operations') || { children: [] }).children.filter((c) => c.group === 'Configure');

test('full profile (default and explicit) reproduces today\'s menu for every persona', () => {
  for (const [name, [roles, biz]] of Object.entries(PERSONAS)) {
    for (const profile of [undefined, 'full', 'nonsense']) {
      const { shell, mount, classes } = load(roles, { businessOnly: !!biz, profile });
      assert.deepStrictEqual(model(shell), TODAY[name], `${name} / ${profile}`);
      const labels = (mount.innerHTML.match(/class="shell-nav-label"/g) || []).length;
      assert.strictEqual(labels, TODAY_TOP[name], `${name}: rendered top-level count`);
      assert.ok(!classes.has('shell-nav-lean'), 'no lean body class in the full profile');
    }
  }
});

test('lean: Operations keeps at most 8 task entries for every persona; Configure is admin tooling (max 3)', () => {
  for (const [name, [roles, biz]] of Object.entries(PERSONAS)) {
    const { shell } = load(roles, { businessOnly: !!biz, profile: 'lean' });
    assert.ok(opsTasks(shell).length <= 8, `${name}: ${opsTasks(shell).map((c) => c.id)}`);
    assert.ok(opsConfigure(shell).length <= 3, `${name}: configure ${opsConfigure(shell).map((c) => c.id)}`);
  }
});

test('lean: exactly one tracker entry and no Configure item for viewer / editor / field-tech', () => {
  for (const name of ['viewer', 'editor', 'editor+tracker-editor', 'field-tech']) {
    const { shell } = load(PERSONAS[name][0], { profile: 'lean' });
    const ops = model(shell).operations;
    assert.strictEqual(ops.filter((id) => id === 'tracker' || id === 'trackers').length, 1, name);
    assert.ok(ops.includes('tracker'), `${name} keeps the live Activity Tracker`);
    assert.deepStrictEqual(opsConfigure(shell), [], name);
  }
  assert.ok(model(load(['admin'], { profile: 'lean' }).shell).operations.includes('trackers'), 'admin keeps the tracker engine');
  assert.ok(model(load(['viewer', 'tracker-admin'], { profile: 'lean' }).shell).operations.includes('trackers'));
});

test('lean: no Infrastructure section for viewer / editor / field-tech; admin and executive keep it', () => {
  for (const name of ['viewer', 'editor', 'field-tech']) assert.ok(!('infrastructure' in model(load(PERSONAS[name][0], { profile: 'lean' }).shell)), name);
  for (const name of ['admin', 'executive', 'super_admin']) assert.deepStrictEqual(model(load(PERSONAS[name][0], { profile: 'lean' }).shell).infrastructure, INFRA, name);
  assert.deepStrictEqual(model(load(['viewer', 'scorecard-viewer'], { profile: 'lean' }).shell).infrastructure, INFRA);
});

test('lean: entries off the menu stay in the finder for a user allowed to open them', () => {
  const { shell } = load(['viewer'], { profile: 'lean' });
  const ops = model(shell).operations;
  for (const [id, q] of [['handoffs', 'handoffs'], ['notifications', 'notif'], ['obligations', 'obligations'], ['rfi', 'rfi'], ['trackers', 'trackers'], ['assets', 'assets']]) {
    assert.ok(!ops.includes(id) && !(model(shell).infrastructure || []).includes(id), `${id} is off the lean menu`);
    assert.ok(j(shell.searchEntries(q)).some((e) => e.id === id), `${id} is still found`);
  }
  assert.deepStrictEqual(j(shell.searchEntries('integr')), [], 'the finder still respects the page roles');
});

test('Deck Builder entry follows ui_deck_builder_roles (default super_admin only) in both profiles', () => {
  for (const profile of ['full', 'lean']) {
    assert.ok(model(load(['super_admin'], { profile }).shell).reports.includes('reports-builder'));
    for (const r of [['executive'], ['admin'], ['viewer', 'report-author']]) assert.ok(!(model(load(r, { profile }).shell).reports || []).includes('reports-builder'), `${r} / ${profile}`);
    const widened = (r) => (model(load(r, { profile, deck: ['super_admin', 'report-author'] }).shell).reports || []);
    assert.ok(widened(['viewer', 'report-author']).includes('reports-builder'));
    assert.ok(!widened(['executive']).includes('reports-builder'));
    assert.ok(!j(load(['executive'], { profile }).shell.searchEntries('deck')).length, 'not offered by the finder either');
  }
  assert.ok(model(load(['executive'], { deck: ['executive'] }).shell).reports.includes('reports-builder'));
  assert.ok(!model(load(['executive'], { deck: [] }).shell).reports.includes('reports-builder'), 'an empty list falls back to super_admin');
});

test('business-only user sees only Site Overview in both profiles', () => {
  for (const profile of ['full', 'lean']) assert.deepStrictEqual(model(load(['site-business'], { businessOnly: true, profile }).shell), { 'site-awareness': [] });
});

test('lean: body class toggles and the rendered menu matches the model', () => {
  const { mount, classes, shell } = load(['super_admin'], { profile: 'lean' });
  assert.ok(classes.has('shell-nav-lean'));
  assert.strictEqual((mount.innerHTML.match(/class="shell-nav-label"/g) || []).length, j(shell.menuModel()).length);
  assert.ok(!/href="handoffs.html"/.test(mount.innerHTML), 'handoffs is not in the lean menu');
});

// A-22: the guard now covers the full profile too (super_admin's full menu overflowed by 53-287 px); a stub nav
// that keeps overflowing after the icons switch also gets the compact tier.
test('fit guard: labels give way to icons only when the measured menu overflows (both profiles)', () => {
  for (const [sw, cw, profile, tight] of [[1072, 711, 'lean', true], [746, 746, 'lean', false], [1072, 711, 'full', true], [746, 746, 'full', false]]) {
    const mount = { dataset: { section: 'operations', current: 'inspections' }, innerHTML: '' };
    const classes = new Set();
    const body = { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
    const nav = { scrollWidth: sw, clientWidth: cw };
    const document = { readyState: 'complete', body, getElementById: (id) => (id === '__shell' ? mount : null), addEventListener() {}, querySelector: (q) => (q === '.shell-nav' ? nav : null), querySelectorAll: () => [] };
    const window = { __userHasRole: () => true, __isBusinessOnly: false, __authUser: {}, __uiPolicy: { nav_profile: profile }, EDV_ICONS: { html: () => '', get: () => '' } };
    vm.runInNewContext(SRC, { window, document, console, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'en' } });
    assert.strictEqual(classes.has('shell-nav-tight'), tight, `${sw}/${cw} ${profile}`);
    assert.strictEqual(classes.has('shell-nav-compact'), tight, `${sw}/${cw} ${profile} compact`);
  }
});
