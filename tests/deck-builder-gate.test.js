'use strict';
// C-28 (PO decision P12) — the Deck Builder PAGE gate follows report_config ui_deck_builder_roles, like its
// menu entry (A-21). Default 'super_admin' = today. The page always admits super_admin; the server routes the
// page writes to keep their admin floor and admit the same widened roles (services/deckBuilderGate.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const gate = require('../services/deckBuilderGate');

const HIER = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];
const hasRole = (u, r) => (u.roles || []).includes(r) || (HIER.includes(r) && (u.roles || []).some((x) => HIER.includes(x) && HIER.indexOf(x) <= HIER.indexOf(r)));

test('page audience: default super_admin; widened by the key; super_admin always kept; bad value = default', () => {
  assert.deepStrictEqual(gate.pageAudience({}), ['super_admin']);
  assert.deepStrictEqual(gate.pageAudience({ ui_deck_builder_roles: 'super_admin,report-author' }), ['super_admin', 'report-author']);
  assert.deepStrictEqual(gate.pageAudience({ ui_deck_builder_roles: 'report-author' }), ['super_admin', 'report-author']);
  assert.deepStrictEqual(gate.pageAudience({ ui_deck_builder_roles: 'root' }), ['super_admin']);
});

test('API rule: admin floor unchanged; report-author admitted only when the key names it', () => {
  const author = { roles: ['viewer', 'report-author'] };
  assert.ok(gate.mayUseDeckBuilderApi({ roles: ['admin'] }, {}, hasRole), 'admin keeps today\'s access');
  assert.ok(!gate.mayUseDeckBuilderApi(author, {}, hasRole), 'default: report-author refused (today)');
  assert.ok(!gate.mayUseDeckBuilderApi({ roles: ['editor'] }, {}, hasRole));
  assert.ok(gate.mayUseDeckBuilderApi(author, { ui_deck_builder_roles: 'super_admin,report-author' }, hasRole));
  assert.ok(!gate.mayUseDeckBuilderApi({ roles: ['editor'] }, { ui_deck_builder_roles: 'super_admin,report-author' }, hasRole));
});

// auth.js run in a sandbox: does the page let this user stay?
function runAuth(roles, policy, attrs) {
  let redirected = null;
  const store = { report_user: JSON.stringify({ id: 1, role: roles[0], roles }) };
  if (policy) store.sdp_ui_policy = JSON.stringify(policy);
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
  const document = { currentScript: { getAttribute: (a) => (a in attrs ? attrs[a] : null) }, addEventListener() {}, getElementById: () => null };
  const window = { fetch: () => new Promise(() => {}) };
  const location = { pathname: '/executive-report.html', search: '', origin: 'http://x', replace: (u) => { redirected = u; }, reload() {} };
  window.location = location;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'auth.js'), 'utf8'), { window, document, localStorage, sessionStorage: localStorage, location, fetch: window.fetch, console, URL, encodeURIComponent, setTimeout, Promise });
  return { redirected, window };
}
const PAGE = { 'data-require': 'super_admin', 'data-require-policy': 'deck_builder_roles' };

test('page gate: default policy keeps super_admin only', () => {
  assert.strictEqual(runAuth(['super_admin'], null, PAGE).redirected, null);
  assert.match(String(runAuth(['viewer', 'report-author'], null, PAGE).redirected), /no-access\.html/);
  assert.match(String(runAuth(['executive'], null, PAGE).redirected), /no-access\.html/);
});

test('page gate: widened policy admits report-author, not others; super_admin always', () => {
  const pol = { deck_builder_roles: ['super_admin', 'report-author'] };
  assert.strictEqual(runAuth(['viewer', 'report-author'], pol, PAGE).redirected, null);
  assert.match(String(runAuth(['executive'], pol, PAGE).redirected), /no-access\.html/);
  assert.strictEqual(runAuth(['super_admin'], { deck_builder_roles: ['report-author'] }, PAGE).redirected, null);
});

test('a page without data-require-policy keeps its static gate (policy ignored)', () => {
  const pol = { deck_builder_roles: ['super_admin', 'report-author'] };
  assert.match(String(runAuth(['viewer', 'report-author'], pol, { 'data-require': 'super_admin' }).redirected), /no-access\.html/);
});

test('executive-report.html opts into the policy gate; the policy carries exec_nav default', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'executive-report.html'), 'utf8');
  assert.match(html, /src="auth\.js" data-require="super_admin" data-require-policy="deck_builder_roles"/);
  assert.strictEqual(runAuth(['super_admin'], null, PAGE).window.__uiPolicy.exec_nav, 'full');
});
