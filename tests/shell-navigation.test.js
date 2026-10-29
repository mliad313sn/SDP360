'use strict';
// G17 — the shared header: task-grouped menus, role-filtered quick find, persona workspaces and a breadcrumb.
// Loaded in a sandbox with a stub DOM; the role check is the same function the header uses.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', '_shell.js'), 'utf8').replace(/\r\n/g, '\n');
const ICONS = fs.readFileSync(path.join(ROOT, 'public', 'brand', 'icons.js'), 'utf8');

const j = (x) => JSON.parse(JSON.stringify(x)); // sandbox arrays come from another realm
function load(roles, { businessOnly = false } = {}) {
  const mount = { dataset: { section: 'operations', current: 'portfolio' }, innerHTML: '' };
  const document = { readyState: 'complete', getElementById: (id) => (id === '__shell' ? mount : null), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const HIER = ['viewer', 'editor', 'admin', 'executive', 'super_admin'];
  const has = (r) => roles.includes(r) || (HIER.includes(r) && roles.some((x) => HIER.indexOf(x) >= HIER.indexOf(r)));
  const window = { __userHasRole: has, __isBusinessOnly: businessOnly, __authUser: { full_name: 'Ana', role: roles[0] }, EDV_ICONS: { html: (k) => `<svg data-i="${k}"></svg>`, get: () => '' } };
  vm.runInNewContext(SRC, { window, document, console });
  return { shell: window.__shell, mount };
}

test('every nav icon resolves (an unknown key renders an empty icon span with no error)', () => {
  const keys = [...SRC.matchAll(/icon:\s*ICON_LIB(?:\.([a-z]+)|\['([a-z0-9-]+)'\])/g)].map((m) => m[1] || m[2]);
  const lib = [...SRC.matchAll(/^\s*'?([a-z0-9-]+)'?:\s+ICONS\.html\('([a-z0-9-]+)'\)/gm)];
  const defined = new Set(lib.map((m) => m[1]));
  for (const k of new Set(keys)) assert.ok(defined.has(k), `ICON_LIB.${k} is not defined`);
  for (const m of lib) assert.ok(ICONS.includes(`'${m[2]}':`), `icon ${m[2]} missing from brand/icons.js`);
});

test('every href in the navigation points at a page that exists', () => {
  const { shell } = load(['super_admin']);
  for (const sec of shell.NAV) for (const it of [sec, ...(sec.children || [])]) if (it.href) assert.ok(fs.existsSync(path.join(ROOT, 'public', it.href.split(/[?#]/)[0])), it.href);
});

test('Operations is grouped by task; every child names a group; first group keeps the first landing page', () => {
  const { shell } = load(['admin']);
  const ops = shell.NAV.find((s) => s.id === 'operations');
  assert.ok(ops.children.every((c) => c.group), 'every Operations entry is in a group');
  assert.deepStrictEqual(j(shell.groupChildren(ops.children).map((g) => g.name)), ['Governance', 'Plan & track', 'Report & share', 'Configure']);
  assert.strictEqual(shell.landingFor('operations'), 'inspections.html');
});

test('rendered menu: group headings, carets expose aria-expanded, current page marked', () => {
  const { mount } = load(['admin']);
  assert.match(mount.innerHTML, /class="shell-dd-heading" aria-hidden="true">Governance</);
  assert.match(mount.innerHTML, /class="shell-nav-caret" role="button" tabindex="0" aria-expanded="false"/);
  assert.match(mount.innerHTML, /href="portfolio.html" aria-current="page"/);
  assert.match(mount.innerHTML, /<nav class="shell-breadcrumb" aria-label="Breadcrumb">/);
  assert.match(mount.innerHTML, /id="shell-search" role="dialog"/);
});

test('quick find only offers pages the user may open', () => {
  const viewer = load(['viewer']).shell, admin = load(['admin']).shell;
  assert.deepStrictEqual(j(viewer.searchEntries('integr')), [], 'Integrations is admin-only');
  assert.strictEqual(admin.searchEntries('integr')[0].href, 'integrations.html');
  assert.ok(admin.searchEntries('INSPECTIONS').some((e) => e.href === 'inspections.html'), 'case-insensitive');
  assert.ok(admin.searchEntries('governance').length >= 3, 'matches the group name too');
  assert.deepStrictEqual(j(viewer.searchEntries('system logs')), []);
});

test('workspaces follow the role and list only reachable pages', () => {
  assert.strictEqual(load(['executive']).shell.workspaceFor().id, 'executive');
  assert.strictEqual(load(['admin']).shell.workspaceFor().id, 'admin');
  assert.strictEqual(load(['super_admin']).shell.workspaceFor().id, 'super', 'super_admin runs the platform, not the executive view');
  assert.strictEqual(load(['admin', 'committee-member']).shell.workspaceFor().id, 'admin', 'the hierarchical role decides first');
  assert.strictEqual(load(['viewer', 'committee-member']).shell.workspaceFor().id, 'pmo');
  assert.strictEqual(load(['editor']).shell.workspaceFor().id, 'site-it');
  assert.strictEqual(load(['viewer']).shell.workspaceFor().id, 'reader');
  const biz = load(['site-business'], { businessOnly: true }).shell.workspaceFor();
  assert.deepStrictEqual(j(biz.items.map((i) => i.href)), ['site-awareness.html']);
  const ws = load(['editor']).shell.workspaceFor();
  assert.ok(!ws.items.some((i) => i.href === 'integrations.html'));
});

test('breadcrumb: section › group › page as plain text (the section has no overview page); none off-menu', () => {
  const { shell } = load(['admin']);
  assert.ok(shell.breadcrumbFor({ section: 'operations', current: 'portfolio' }).every((c) => !c.href));
  assert.deepStrictEqual(j(shell.breadcrumbFor({ section: 'operations', current: 'portfolio' }).map((c) => c.label)), ['Operations', 'Plan & track', 'Portfolio']);
  assert.strictEqual(shell.breadcrumbFor({ section: 'operations', current: 'nope' }), null);
  assert.strictEqual(shell.breadcrumbFor({ section: '', current: '' }), null);
});

test('no single-character shortcut (WCAG 2.1.4): only Ctrl/Cmd+K opens the finder', () => {
  assert.ok(!/e\.key === '\/'/.test(SRC), 'the "/" shortcut is gone');
  assert.match(SRC, /\(e\.ctrlKey \|\| e\.metaKey\) && !e\.altKey && \(e\.key === 'k' \|\| e\.key === 'K'\)/);
  assert.match(SRC, /title="Find a page \(Ctrl\+K\)"/);
});

test('menus open only through the caret for keyboard users: no :focus-within opener, no focus stop on the wrapper', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', '_shell.css'), 'utf8');
  assert.ok(!/:focus-within \.shell-dropdown/.test(css));
  assert.match(css, /\.shell-nav-item:not\(\.is-suppressed\):hover \.shell-dropdown/);
  assert.ok(!/class="shell-nav-item\$\{activeC\}"\$\{titleA\} tabindex="0"/.test(SRC));
  assert.ok(!/aria-haspopup="true"/.test(SRC), 'disclosure pattern, not a menu');
  assert.match(css, /\.shell-search-list a:focus-visible \{[^}]*outline: 2px solid/);
});

test('finder announces the result count and remembers who opened it', () => {
  const { mount } = load(['admin']);
  assert.match(mount.innerHTML, /id="shell-search-status" aria-live="polite"/);
  assert.match(mount.innerHTML, /class="shell-search-btn" aria-haspopup="dialog" aria-expanded="false"/);
  assert.match(SRC, /searchOpener = document\.activeElement/);
  assert.match(SRC, /document\.addEventListener\('focusout'/);
});
