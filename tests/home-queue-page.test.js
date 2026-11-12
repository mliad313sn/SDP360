'use strict';
// R2-QUEUE — Home wiring: the queue (ui_home_queue) and the workspace profile (workspace_profiles_enabled) are both
// off by default and then change NOTHING (no extra request, same shortcuts, same card order).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const SRC = read('lib/home-page.js'), HQ = read('lib/homeQueue.js'), ST = read('lib/statusTransfer.js'), SB = read('lib/stateBadge.js');

function el(id) {
  return { id, innerHTML: '', textContent: '', attrs: {}, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; },
    insertAdjacentElement() {}, insertAdjacentHTML(_, h) { this.innerHTML += h; }, setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; }, querySelector: () => null, remove() {}, focus() {} };
}
const WORK = { ok: true, as_of: '2026-11-12', truncated: 0, sites: [
  { site_id: 7, code: 'HGO', name: 'Hounde', actions: null, weekly_report: null, unsigned_pvs: null, last_inspection: null, tracker_empty: null, benefit_reviews: null },
  { site_id: 8, code: 'MGO', name: 'Mana', actions: null, weekly_report: null, unsigned_pvs: null, last_inspection: null, tracker_empty: null, benefit_reviews: null }] };

async function run({ policy = {}, profile } = {}) {
  const els = {}; const get = (id) => (els[id] = els[id] || el(id));
  const classes = new Set();
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url === '/api/me/work') return { ok: true, status: 200, json: async () => WORK };
    if (url.startsWith('/api/workspace/me')) return { ok: !!profile, status: profile ? 200 : 404, json: async () => profile };
    return { ok: true, status: 200, json: async () => ({ rows: [], groups: {}, commitments: [] }) };
  };
  const document = { documentElement: { lang: 'en' }, body: { classList: { add: (c) => classes.add(c), remove() {}, toggle() {}, contains: (c) => classes.has(c) } },
    getElementById: get, querySelector: () => null, querySelectorAll: () => [], createElement: () => el('x'), activeElement: null };
  const window = { __uiPolicy: policy, __shell: { shellLang: () => 'en', workspaceFor: () => ({ items: [{ href: 'site-actions.html', label: 'Site actions' }] }) } };
  const ctx = vm.createContext({ window, document, fetch, console, setTimeout, self: window, Promise });
  for (const s of [SB, ST, HQ]) vm.runInContext(s, ctx);
  // the browser half of workspaceProfiles.js (load()) — same code the page loads
  vm.runInContext(read('lib/workspaceProfiles.js'), ctx);
  vm.runInContext(SRC, ctx);
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
  return { els, calls, classes, window };
}

test('both switches off (today): only /api/me/work is read, no queue, shell shortcuts', async () => {
  const { els, calls } = await run();
  assert.deepStrictEqual(calls, ['/api/me/work']);
  assert.equal((els.hmQueue || { innerHTML: '' }).innerHTML, '');
  assert.match(els.hmShortcuts.innerHTML, /site-actions\.html/);
  assert.ok(els.hmSites.innerHTML.indexOf('Hounde') < els.hmSites.innerHTML.indexOf('Mana'));
});

test('ui_home_queue = 1: the queue mounts and reads only the sites Home already lists', async () => {
  const { els, calls, window } = await run({ policy: { home_queue: '1' } });
  assert.match(els.hmQueue.innerHTML, /My queue/);
  const codes = [...new Set(calls.filter((u) => /\?site=/.test(u)).map((u) => u.split('=')[1]))].sort();
  assert.deepStrictEqual(codes, ['HGO', 'MGO']);
  assert.equal(window.__homePage.queueOn, true);
  assert.ok(!calls.some((u) => u.startsWith('/api/workspace')), 'no profile read while workspace_profiles is off');
});

test('workspace profile on: shortcuts follow the profile, the default site comes first, compact density; queue:false hides the queue', async () => {
  const profile = { profile: 'coordinator', density: 'compact', queue: false, default_site_id: 8,
    destinations: [], visible: [{ id: 'home', href: 'home.html', label: 'Home' }, { id: 'inspections', href: 'inspections.html', label: 'Inspections' }, { id: 'evil', href: 'javascript:alert(1)', label: 'x' }] };
  const { els, calls, classes } = await run({ policy: { workspace_profiles: '1', home_queue: '1' }, profile });
  assert.ok(calls.includes('/api/workspace/me'));
  assert.match(els.hmShortcuts.innerHTML, /inspections\.html/);
  assert.ok(!/site-actions\.html|javascript:|home\.html/.test(els.hmShortcuts.innerHTML));
  assert.ok(els.hmSites.innerHTML.indexOf('Mana') < els.hmSites.innerHTML.indexOf('Hounde'), 'default site first');
  assert.ok(classes.has('hm-compact'));
  assert.equal((els.hmQueue || { innerHTML: '' }).innerHTML, '', 'a profile without queue (business) never shows it');
});

test('workspace profile switch on but the API answers 404 (route not mounted): Home is today\'s Home', async () => {
  const { els } = await run({ policy: { workspace_profiles: '1' } });
  assert.match(els.hmShortcuts.innerHTML, /site-actions\.html/);
  assert.ok(els.hmSites.innerHTML.indexOf('Hounde') < els.hmSites.innerHTML.indexOf('Mana'));
});
