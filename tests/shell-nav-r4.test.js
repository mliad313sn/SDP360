'use strict';
// R2-QUEUE (REBUILD-SPEC R4) — shared navigation: one active destination chosen from route + query + fragment
// (exactly one aria-current per navigation landmark), links to site-aware pages carry the current site, and the
// "My workspace" link. Every behaviour is behind a switch whose default is today's header.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', '_shell.js'), 'utf8').replace(/\r\n/g, '\n');

const j = (x) => JSON.parse(JSON.stringify(x));
function load(roles, { policy, section = 'operations', current = 'portfolio', location, navLang = 'en' } = {}) {
  const mount = { dataset: { section, current }, innerHTML: '' };
  const listeners = {};
  const document = { readyState: 'complete', getElementById: (id) => (id === '__shell' ? mount : null), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const HIER = ['viewer', 'editor', 'admin', 'executive', 'super_admin'];
  const has = (r) => roles.includes(r) || (HIER.includes(r) && roles.some((x) => HIER.indexOf(x) >= HIER.indexOf(r)));
  const window = { __userHasRole: has, __isBusinessOnly: false, __authUser: { full_name: 'Ana', role: roles[0] }, __uiPolicy: policy,
    EDV_ICONS: { html: (k) => `<svg data-i="${k}"></svg>`, get: () => '' }, addEventListener: (t, f) => { listeners[t] = f; } };
  vm.runInNewContext(SRC, { window, document, console, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: navLang }, location });
  return { shell: window.__shell, mount, listeners };
}
const loc = (pathname, search = '', hash = '') => ({ pathname, search, hash });
// every navigation landmark of the header: the primary <nav> and the breadcrumb <nav>
const landmarks = (html) => [...html.matchAll(/<nav class="(shell-nav|shell-breadcrumb)"[^>]*>([\s\S]*?)<\/nav>/g)].map((m) => ({ kind: m[1], cur: (m[2].match(/aria-current="page"/g) || []).length, html: m[2] }));

test('switch off: the address never moves the active entry (a valid data-current wins, as today)', () => {
  const { mount } = load(['super_admin'], { section: 'helpdesk', current: 'site-reports', location: loc('/reports.html', '', '#admin') });
  const nav = landmarks(mount.innerHTML).find((l) => l.kind === 'shell-nav');
  assert.ok(!/href="reports.html#admin" aria-current/.test(nav.html));
});

test('switch on: a #fragment or ?key= in the address wins over the page\'s static data-current; exactly one aria-current per landmark', () => {
  const on = { nav_active_from_url: '1' };
  const r = load(['super_admin'], { policy: on, section: 'reports', current: 'site-reports', location: loc('/reports.html', '', '#admin') });
  const ls = landmarks(r.mount.innerHTML);
  for (const l of ls) assert.ok(l.cur <= 1, l.kind + ' has ' + l.cur);
  const nav = ls.find((l) => l.kind === 'shell-nav');
  assert.equal(nav.cur, 1);
  assert.match(nav.html, /href="reports.html#admin" aria-current="page"/);
  assert.deepStrictEqual(j(r.shell.activeFor({ section: 'reports', current: 'site-reports' }, loc('/reports.html', '', '#admin'))), { section: 'admin', current: 'admin-settings' });
  // a plain path never overrides a valid data-current (F-UX-02 rule kept)
  assert.deepStrictEqual(j(r.shell.activeFor({ section: 'operations', current: 'portfolio' }, loc('/home.html'))), { section: 'operations', current: 'portfolio' });
  // an in-page #change re-renders the header (listener wired only while the switch is on)
  assert.equal(typeof r.listeners.hashchange, 'function');
  assert.equal(load(['super_admin'], { location: loc('/reports.html') }).listeners.hashchange, undefined);
});

test('switch on: the exactly-one rule holds for every menu entry of every role, addressed by its own link', () => {
  const on = { nav_active_from_url: '1' };
  let checked = 0;
  for (const roles of [['super_admin'], ['admin'], ['editor'], ['viewer'], ['executive']]) {
    const base = load(roles, { policy: on });
    for (const sec of base.shell.NAV) for (const it of [sec, ...(sec.children || [])]) {
      if (!it.href || /^https?:/.test(it.href)) continue;
      const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(it.href);
      const { mount } = load(roles, { policy: on, section: 'x', current: 'not-a-menu-id', location: loc('/' + m[1], m[2] || '', m[3] || '') });
      for (const l of landmarks(mount.innerHTML)) assert.ok(l.cur <= 1, `${roles[0]} ${it.href} ${l.kind}=${l.cur}`);
      checked++;
    }
  }
  assert.ok(checked > 40, String(checked));
});

test('ui_nav_carry_site: off = links untouched; on = site-aware links carry the current ?site=CODE, nothing else does', () => {
  const at = loc('/site-actions.html', '?site=HGO');
  const off = load(['admin'], { location: at });
  assert.ok(!/site-actions\.html\?site=HGO/.test(off.mount.innerHTML));
  assert.equal(off.shell.withSite('site-actions.html', at), 'site-actions.html');
  const on = load(['admin'], { policy: { nav_carry_site: '1' }, location: at });
  assert.match(on.mount.innerHTML, /href="site-actions\.html\?site=HGO"/);
  assert.equal(on.shell.withSite('obligations.html', at), 'obligations.html?site=HGO');
  assert.equal(on.shell.withSite('meetings-actions.html?x=1#t', at), 'meetings-actions.html?x=1&site=HGO#t');
  assert.equal(on.shell.withSite('site-actions.html?site=MGO', at), 'site-actions.html?site=MGO', 'an explicit site is never replaced');
  assert.equal(on.shell.withSite('portfolio.html', at), 'portfolio.html', 'pages that do not read ?site= are untouched');
  assert.equal(on.shell.withSite('site-actions.html', loc('/x.html', '?site=%3Cscript%3E')), 'site-actions.html', 'a malformed code is never carried');
  // the finder / workspace entries carry it too
  assert.ok(j(on.shell.searchEntries('site actions')).some((e) => e.href === 'site-actions.html?site=HGO'));
});

test('"My workspace" link: only while workspace_profiles = 1 reaches the browser; French label', () => {
  assert.ok(!/workspace-settings\.html/.test(load(['viewer']).mount.innerHTML));
  const on = load(['viewer'], { policy: { workspace_profiles: '1' } });
  assert.match(on.mount.innerHTML, /<a class="shell-ws-link" href="workspace-settings\.html"[^>]*>My workspace<\/a>/);
  assert.match(load(['viewer'], { policy: { workspace_profiles: '1' }, navLang: 'fr-FR' }).mount.innerHTML, />Mon espace<\/a>/);
});
