'use strict';
// C-09 (F16 / F29 / G14 prep) — page usage facts: the pure aggregator, the shell beacon (once per page load,
// user id + tier only on the server side), distinct executive icons, and the matrix document.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const PU = require('../services/pageUsage');
const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'public', '_shell.js'), 'utf8');

test('normalizePage: known pages only; a key suffix only on dashboards', () => {
  const known = new Set(['executive', 'dashboards', 'it-review']);
  assert.equal(PU.normalizePage('executive', known), 'executive');
  assert.equal(PU.normalizePage('Executive.html', known), 'executive');
  assert.equal(PU.normalizePage('dashboards:exec-home', known), 'dashboards:exec-home');
  assert.equal(PU.normalizePage('it-review:x', known), null);
  assert.equal(PU.normalizePage('nope', known), null);
  assert.equal(PU.normalizePage('../etc/passwd', known), null);
  assert.equal(PU.normalizePage('<img onerror=1>', known), null);
  assert.equal(PU.normalizePage('', known), null);
  assert.equal(PU.normalizePage(null, known), null);
});

test('roleTier: highest hierarchical role, feature-only otherwise', () => {
  assert.equal(PU.roleTier({ role: 'viewer', roles: ['viewer', 'executive'] }), 'executive');
  assert.equal(PU.roleTier({ roles: ['scorecard-viewer'] }), 'feature-only');
  assert.equal(PU.roleTier({ role: 'super_admin' }), 'super_admin');
  assert.equal(PU.roleTier(null), 'feature-only');
});

test('aggregate: distinct users per page and per tier, user-days counted once per day', () => {
  const rows = [
    { target: 'executive', actor_id: 1, details: '{"tier":"executive"}', ts: '2026-11-01T08:00:00Z' },
    { target: 'executive', actor_id: 1, details: '{"tier":"executive"}', ts: '2026-11-02T08:00:00Z' },
    { target: 'executive', actor_id: 2, details: '{"tier":"feature-only"}', ts: '2026-11-02T09:00:00Z' },
    { target: 'it-review', actor_id: 1, details: '{"tier":"executive"}', ts: '2026-11-02T09:00:00Z' },
    { target: 'it-review', actor_id: 3, details: 'not json', ts: '2026-11-02T09:00:00Z' },
    { target: 'x', actor_id: null, details: null, ts: '2026-11-02' },
  ];
  const a = PU.aggregate(rows);
  assert.deepEqual(a.tiers, ['executive', 'feature-only', 'unknown']);
  const ex = a.pages.find((p) => p.page === 'executive');
  assert.equal(ex.users, 2); assert.equal(ex.view_days, 3);
  assert.deepEqual(ex.by_tier, { executive: 1, 'feature-only': 1, unknown: 0 });
  assert.equal(a.pages.find((p) => p.page === 'it-review').by_tier.unknown, 1);
  assert.ok(!a.pages.some((p) => p.page === 'x'), 'rows without a user are ignored');
  assert.deepEqual(PU.aggregate([]), { pages: [], tiers: [] });
});

test('clampDays: 1..180, default 30', () => {
  assert.equal(PU.clampDays(undefined), 30); assert.equal(PU.clampDays('0'), 1); assert.equal(PU.clampDays('9999'), 180); assert.equal(PU.clampDays('7'), 7);
});

function loadShell({ pathname = '/executive.html', search = '', authUser = { id: 5, role: 'executive' } } = {}) {
  const mount = { dataset: { section: 'executive', current: 'scorecard' }, innerHTML: '' };
  const document = { readyState: 'complete', getElementById: (id) => (id === '__shell' ? mount : null), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const calls = [];
  const window = { __userHasRole: () => true, __authUser: authUser, EDV_ICONS: { html: (k) => `<svg data-i="${k}"></svg>`, get: () => '' } };
  const fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve({ ok: true }); };
  vm.runInNewContext(SHELL, { window, document, console, fetch, location: { pathname, search }, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'en' } });
  return { shell: window.__shell, calls };
}

test('shell: one page_viewed beacon per page load, never twice on re-render, page id from the path', () => {
  const { shell, calls } = loadShell();
  shell.render(); shell.render();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/ux/page-view');
  assert.equal(calls[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { page: 'executive' });
  assert.equal(shell.pageIdFor({ pathname: '/dashboards.html', search: '?key=exec-home&site=3' }), 'dashboards:exec-home');
  assert.equal(shell.pageIdFor({ pathname: '/', search: '' }), 'index');
  assert.equal(loadShell({ authUser: null }).calls.length, 0, 'no session → no beacon');
});

test('executive siblings have distinct icons (F16: Home and Scorecard both used gauge)', () => {
  const { shell } = loadShell();
  const exec = shell.NAV.find((s) => s.id === 'executive');
  const icons = exec.children.filter((c) => ['exec-home', 'it-review', 'scorecard'].includes(c.id)).map((c) => c.icon);
  assert.equal(icons.length, 3);
  assert.equal(new Set(icons).size, 3, 'Executive Home, IT Review and Scorecard must not share an icon');
  assert.match(exec.children.find((c) => c.id === 'scorecard').icon, /clipboard-list/);
});

test('EXEC-PAGES-MATRIX.md: PROPOSAL banner, five surfaces, the pages it names exist', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'ux', 'EXEC-PAGES-MATRIX.md'), 'utf8');
  assert.match(doc, /PROPOSAL — decision pending/);
  for (const t of ['Executive Home', 'IT Review', 'Executive Scorecard', 'Exec View', 'Deck Builder']) assert.ok(doc.includes(t), t);
  for (const f of ['dashboards.html', 'it-review.html', 'executive.html', 'exec-view.html', 'executive-report.html']) assert.ok(fs.existsSync(path.join(ROOT, 'public', f)), f);
  for (const [, p] of doc.matchAll(/`((?:services|tools|routes|public)\/[A-Za-z0-9_./-]+\.(?:js|py|html))`/g)) assert.ok(fs.existsSync(path.join(ROOT, p)), p);
  assert.ok(!/\b(approved|signed off)\b/i.test(doc.replace(/not approved|Nothing below is approved/gi, '')), 'the matrix claims no approval');
});
