'use strict';
// Shared intra-module tab strip (public/module-tabs.js) — rendered under a
// stubbed DOM, the same technique already used to verify _shell.js. No browser,
// no session: this proves the component's STRUCTURE (tabs / active / icons /
// hrefs / role-gating). Visual QA is the user's step (pages are session-gated).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function loadWith({ role = 'any', module, current }) {
  const captured = {};
  const icons = { html: (n) => `<svg data-icon="${n}"></svg>`, get: () => '' };
  const mount = {
    dataset: { module, current },
    set innerHTML(v) { captured.html = v; },
    get innerHTML() { return captured.html || ''; },
  };
  // A plain user (role 'any') has NO elevated roles → __userHasRole('admin') is
  // false. The component treats a tab's own roles:['any'] as always-visible via
  // it.roles.includes('any'), so it never asks __userHasRole for those.
  global.window = { EDV_ICONS: icons, __userHasRole: (r) => r === role };
  global.document = {
    readyState: 'complete',
    getElementById: (id) => (id === '__moduletabs' ? mount : null),
    addEventListener: () => {},
    querySelectorAll: () => [],
  };
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'module-tabs.js'), 'utf8');
  new Function(src)();
  return captured.html || '';
}

test('meetings: renders 8 tabs (admin), active state + non-empty icons', () => {
  const html = loadWith({ role: 'admin', module: 'meetings', current: 'issues' });
  for (const l of ['Meetings','Dashboard','Issues','Actions','Unsigned','Council','Compliance','Setup'])
    assert.ok(html.includes(l), `missing tab ${l}`);
  assert.ok(html.includes('aria-current="page"'), 'no active tab');
  assert.ok(/data-icon="alert-circle"/.test(html), 'issues icon missing');
  assert.ok(!/data-icon=""/.test(html) && !html.includes('data-icon="undefined"'), 'empty icon');
});

test('meetings: Setup hidden for non-admin (role-gated) + count-badge hook present', () => {
  const html = loadWith({ role: 'any', module: 'meetings', current: 'list' });
  assert.ok(!html.includes('Setup'), 'Setup must be gated to admin');
  assert.ok(html.includes('id="mdTabCount"'), 'count badge hook missing on Meetings tab');
});

test('inspections: 3 tabs, new active, hrefs correct', () => {
  const html = loadWith({ role: 'any', module: 'inspections', current: 'new' });
  for (const l of ['Inspections','New','Actions']) assert.ok(html.includes(l), `missing ${l}`);
  assert.ok(html.includes('href="inspection.html"'), 'new href');
  assert.ok(html.includes('aria-current="page"'), 'active');
});

test('site_actions: 3-register family strip, site active', () => {
  const html = loadWith({ role: 'any', module: 'site_actions', current: 'site' });
  for (const l of ['Site Actions','Meetings Actions','Inspection Actions']) assert.ok(html.includes(l), `missing ${l}`);
  assert.ok(html.includes('href="site-actions.html"'), 'site href');
  assert.ok(html.includes('href="meetings-actions.html"'), 'meetings-actions href');
  assert.ok(html.includes('aria-current="page"'), 'active');
});

test('unknown data-current renders strip with nothing active (editor gap fix)', () => {
  const html = loadWith({ role: 'any', module: 'meetings', current: '' });
  assert.ok(html.includes('Meetings') && html.includes('Compliance'), 'strip still renders');
  assert.ok(!html.includes('aria-current="page"'), 'nothing active when current empty');
});

test('unknown module renders nothing (safe degrade)', () => {
  const html = loadWith({ role: 'any', module: 'nope', current: 'x' });
  assert.equal(html, '');
});

test('every href in the config points to an existing public/*.html', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'module-tabs.js'), 'utf8');
  const hrefs = [...src.matchAll(/href:\s*'([a-z0-9-]+\.html)'/g)].map(m => m[1]);
  assert.ok(hrefs.length >= 12, `expected >=12 hrefs, got ${hrefs.length}`);
  for (const h of hrefs)
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', h)), `missing page ${h}`);
});
