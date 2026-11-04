'use strict';
// A-10 — one landing rule for the post-login redirect (login.html) and the brand link (_shell.js).
// public/lib/landing.js is PURE (UMD). roleLanding '0' = today's mapping (the default, report_config
// ui_role_landing); '1' = the proposed role-based landing (switched off until the owner turns it on).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const Landing = require('../public/lib/landing');
const SHELL = fs.readFileSync(path.join(ROOT, 'public', '_shell.js'), 'utf8').replace(/\r\n/g, '\n');
const LOGIN = fs.readFileSync(path.join(ROOT, 'public', 'login.html'), 'utf8').replace(/\r\n/g, '\n');
const LANDING_SRC = fs.readFileSync(path.join(ROOT, 'public', 'lib', 'landing.js'), 'utf8');

const HIER = ['viewer', 'editor', 'admin', 'executive', 'super_admin'];
const hasFor = (roles) => (r) => roles.includes(r) || (HIER.includes(r) && roles.some((x) => HIER.indexOf(x) >= HIER.indexOf(r)));
const BUSINESS = ['site-business', 'group-business'];
const isBiz = (roles) => roles.length > 0 && roles.every((r) => BUSINESS.includes(r));
const land = (roles, roleLanding) => Landing.landingFor({ has: hasFor(roles), isBusinessOnly: isBiz(roles), roleLanding });

const PERSONAS = [['executive'], ['super_admin'], ['admin'], ['editor'], ['viewer'], ['tracker-editor'], ['viewer', 'tracker-editor'],
  ['field-tech'], ['editor', 'field-tech'], ['site-business'], ['group-business', 'site-business'], ['admin', 'field-tech'], ['scorecard-viewer']];

test("roleLanding '0' reproduces today's mapping", () => {
  assert.equal(land(['executive'], '0'), 'executive.html');
  assert.equal(land(['super_admin'], '0'), 'executive.html');
  assert.equal(land(['admin'], '0'), 'index.html');
  assert.equal(land(['tracker-editor'], '0'), 'activity-tracker.html');
  assert.equal(land(['viewer'], '0'), 'index.html');
  assert.equal(land(['editor'], '0'), 'index.html');
  assert.equal(land(['site-business'], '0'), 'site-awareness.html');
});

test("roleLanding '1' applies the proposed role mapping", () => {
  assert.equal(land(['editor'], '1'), 'home.html');
  assert.equal(land(['field-tech'], '1'), 'field/index.html');
  assert.equal(land(['editor', 'field-tech'], '1'), 'home.html');
  assert.equal(land(['executive'], '1'), 'dashboards.html?key=exec-home');
  assert.equal(land(['super_admin'], '1'), 'home.html');
  assert.equal(land(['admin'], '1'), 'index.html');
  assert.equal(land(['tracker-editor'], '1'), 'activity-tracker.html');
  assert.equal(land(['viewer'], '1'), 'index.html');
  assert.equal(land(['site-business'], '1'), 'site-awareness.html');
});

test("an unknown or missing roleLanding value behaves as '0'", () => {
  for (const v of [undefined, null, '', 'yes', 1, '2', true]) {
    for (const p of PERSONAS) assert.equal(land(p, v), land(p, '0'), `${p} with ${String(v)}`);
  }
  assert.equal(Landing.landingFor({}), 'index.html', 'no role check at all → index');
});

test('landing.js stays pure (no window / document / localStorage access)', () => {
  assert.ok(!/\bwindow\.|\bdocument\.|\blocalStorage\b/.test(LANDING_SRC.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
});

function shellFor(roles, { policy, landing } = {}) {
  const mount = { dataset: { section: 'operations', current: '' }, innerHTML: '' };
  const document = { readyState: 'complete', getElementById: (id) => (id === '__shell' ? mount : null), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const window = { __userHasRole: hasFor(roles), __isBusinessOnly: isBiz(roles), __authUser: { full_name: 'A', role: roles[0] }, EDV_ICONS: { html: () => '', get: () => '' } };
  if (policy) window.__uiPolicy = policy;
  if (landing) window.Landing = Landing;
  vm.runInNewContext(SHELL, { window, document, console, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'en-US' } });
  return window.__shell;
}

test("the shell's inline '0' mapping and landing.js '0' give the same page for every persona", () => {
  for (const p of PERSONAS) assert.equal(shellFor(p).defaultLanding(), land(p, '0'), p.join('+'));
  // a page that loaded lib/landing.js but kept the switch off still lands where it did
  for (const p of PERSONAS) assert.equal(shellFor(p, { landing: true, policy: { role_landing: '0' } }).defaultLanding(), land(p, '0'), p.join('+'));
});

test("the shell follows landing.js when ui_role_landing is '1' and the module is loaded", () => {
  assert.equal(shellFor(['editor'], { landing: true, policy: { role_landing: '1' } }).defaultLanding(), 'home.html');
  assert.equal(shellFor(['executive'], { landing: true, policy: { role_landing: '1' } }).defaultLanding(), 'dashboards.html?key=exec-home');
  // the module not loaded on the page → today's mapping (the 45 shell pages need no new script tag)
  assert.equal(shellFor(['editor'], { policy: { role_landing: '1' } }).defaultLanding(), 'index.html');
});

test('login.html and _shell.js no longer carry divergent inline mappings (login uses Landing.landingFor)', () => {
  assert.match(LOGIN, /<script nonce="%%CSP_NONCE%%" src="lib\/landing\.js"><\/script>/, 'login loads the shared module (with the CSP nonce)');
  assert.match(LOGIN, /Landing\.landingFor\(/);
  assert.ok(!/return 'executive\.html'/.test(LOGIN), 'no private copy of the mapping left in login.html');
  assert.match(LOGIN, /superAdminPages/, '?next= guard unchanged');
  assert.match(LOGIN, /\/api\/reports\/auth\/me/, 'reads ui.role_landing after login');
});

test('home.html loads lib/landing.js before _shell.js', () => {
  const home = fs.readFileSync(path.join(ROOT, 'public', 'home.html'), 'utf8');
  const a = home.indexOf('src="lib/landing.js"'), b = home.indexOf('src="_shell.js"');
  assert.ok(a > 0 && b > a);
});
