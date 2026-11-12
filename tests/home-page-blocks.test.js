'use strict';
// F-UX-09 — Home cards load and fail independently (report_config ui_home_blocks, default '0' = today).
// home-page.js runs in a sandbox with a small fake DOM and a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'lib', 'home-page.js'), 'utf8');
const SB_SRC = fs.readFileSync(path.join(ROOT, 'public', 'lib', 'stateBadge.js'), 'utf8');

function el(id) {
  return { id, innerHTML: '', textContent: '', listeners: {}, attrs: {}, disabled: false,
    addEventListener(t, f) { this.listeners[t] = f; }, insertAdjacentElement() {}, insertAdjacentHTML(_, h) { this.innerHTML += h; },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, remove() {}, focus() { this.focused = true; } };
}
const SITE = (over) => Object.assign({ site_id: 7, code: 'HGO', name: 'Hounde', actions: { open: 3, overdue: 1, oldest_days: 12 },
  weekly_report: { week_label: 'W45 2026', status: 'draft', label: 'In progress', report_id: 9 }, unsigned_pvs: { count: 0, items: [] },
  last_inspection: null, tracker_empty: { month: 11, empty_cells: 2, total_cells: 10 }, benefit_reviews: { count: 0, items: [] } }, over || {});

async function run({ on, fetchImpl, lang = 'en' }) {
  const els = {};
  const get = (id) => (els[id] = els[id] || el(id));
  const document = { documentElement: { lang: 'en' }, body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
    getElementById: get, querySelector: () => null, querySelectorAll: () => [], createElement: () => el('x') };
  const window = { __uiPolicy: on ? { home_blocks: '1' } : {}, __shell: { shellLang: () => lang, workspaceFor: () => ({ items: [{ href: 'site-actions.html', label: 'Site actions' }] }) } };
  const ctx = vm.createContext({ window, document, fetch: fetchImpl, console, setTimeout, self: window });
  vm.runInContext(SB_SRC, ctx);   // UMD → self.StateBadge = window.StateBadge
  vm.runInContext(SRC, ctx);
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  return { els, window };
}
const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const down = async () => { throw new Error('network down'); };

test('switch off (today): a failed call blanks the cards and shows only the message', async () => {
  const { els } = await run({ on: false, fetchImpl: down });
  assert.equal(els.hmSites.innerHTML, '');
  assert.equal(els.hmMsg.textContent, 'network down');
  assert.ok(!/edv-state/.test(els.hmSites.innerHTML));
});

test('switch off: a null block reads "— not measured" as today; no reload button', async () => {
  const { els } = await run({ on: false, fetchImpl: ok({ ok: true, sites: [SITE()] }) });
  assert.match(els.hmSites.innerHTML, /<span class="hm-nm">— not measured<\/span>/);
  assert.ok(!/hm-retry/.test(els.hmSites.innerHTML));
});

test('switch on: one null block shows the not-measured state; the other blocks keep their values', async () => {
  const { els } = await run({ on: true, fetchImpl: ok({ ok: true, sites: [SITE()] }) });
  const h = els.hmSites.innerHTML;
  assert.match(h, /edv-state edv-state-not-measured" role="img"/, 'the inspection block (null) says not measured');
  assert.match(h, /3 open/); assert.match(h, /W45 2026/); assert.match(h, /all signed/);
  assert.ok(!/>0 open/.test(h), 'null is never rendered as 0');
  assert.match(h, /class="hm-retry" data-site="7"/, 'each card can be reloaded on its own');
});

test('switch on: a failed call keeps the page, shows the error state and a retry; shortcuts still render', async () => {
  const { els } = await run({ on: true, fetchImpl: down });
  assert.match(els.hmSites.innerHTML, /edv-state-error/);
  assert.match(els.hmSites.innerHTML, /network down/);
  assert.match(els.hmSites.innerHTML, /class="hm-retry" data-site="\*"/);
  assert.match(els.hmShortcuts.innerHTML, /site-actions\.html/);
});

test('switch on: French states use the French text', async () => {
  const { els } = await run({ on: true, lang: 'fr', fetchImpl: ok({ ok: true, sites: [SITE()] }) });
  assert.match(els.hmSites.innerHTML, /non mesuré/);
  assert.ok(!/> not measured</.test(els.hmSites.innerHTML));
});

test('ui_home_blocks is a default-off policy key and in DEFAULTS', () => {
  const P = require('../services/uiPolicy');
  assert.equal(P.UI_DEFAULTS.ui_home_blocks, '0');
  assert.equal(P.uiPolicyFrom({ ui_home_blocks: 'yes' }).home_blocks, '0');
  assert.equal(P.uiPolicyFrom({ ui_home_blocks: '1' }).home_blocks, '1');
  assert.equal(require('../services/reportConfig').DEFAULTS.ui_home_blocks, '0');
  const html = fs.readFileSync(path.join(ROOT, 'public', 'home.html'), 'utf8');
  assert.ok(html.indexOf('lib/stateBadge.js') > 0 && html.indexOf('lib/stateBadge.js') < html.indexOf('lib/home-page.js'), 'stateBadge before home-page');
});
