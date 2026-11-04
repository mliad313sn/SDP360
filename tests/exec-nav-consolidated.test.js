'use strict';
// C-28 (PO decision P1) — report_config ui_exec_nav: 'full' (today) keeps the three Executive entries;
// 'consolidated' keeps "Executive Home" + "IT Review" in the menu and moves the Executive Scorecard to
// Home (dashboards.html?key=exec-home) and the Ctrl+K finder. Nothing is deleted, no permission changes.
// Same vm sandbox as tests/simplicity-budget.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', '_shell.js'), 'utf8').replace(/\r\n/g, '\n');

const j = (x) => JSON.parse(JSON.stringify(x));
function load(roles, policy = {}) {
  const mount = { dataset: { section: 'executive', current: 'exec-home' }, innerHTML: '' };
  const classes = new Set();
  const body = { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) } };
  const document = { readyState: 'complete', body, getElementById: (id) => (id === '__shell' ? mount : null), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const HIER = ['viewer', 'editor', 'admin', 'executive', 'super_admin'];
  const has = (r) => roles.includes(r) || (HIER.includes(r) && roles.some((x) => HIER.indexOf(x) >= HIER.indexOf(r)));
  const window = { __userHasRole: has, __isBusinessOnly: false, __authUser: { full_name: 'Ana', role: roles[0] }, __uiPolicy: policy, EDV_ICONS: { html: () => '', get: () => '' } };
  vm.runInNewContext(SRC, { window, document, console, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'en-US' } });
  return { shell: window.__shell, mount, classes };
}
const execMenu = (shell) => ((j(shell.menuModel()).find((s) => s.id === 'executive') || { children: [] }).children.map((c) => c.id));
const PERSONAS = [['executive'], ['super_admin'], ['viewer', 'scorecard-viewer']];

test('full (default, explicit, unknown value): the Executive menu keeps today\'s three entries', () => {
  for (const roles of PERSONAS) {
    for (const exec_nav of [undefined, 'full', 'nonsense']) {
      const { shell, classes } = load(roles, exec_nav === undefined ? {} : { exec_nav });
      assert.deepStrictEqual(execMenu(shell), ['exec-home', 'it-review', 'scorecard'], `${roles} / ${exec_nav}`);
      assert.ok(!classes.has('shell-exec-consolidated'));
    }
  }
});

test('consolidated: the Executive menu shows only Executive Home and IT Review, in both nav profiles', () => {
  for (const roles of PERSONAS) {
    for (const nav_profile of ['full', 'lean']) {
      const { shell, mount, classes } = load(roles, { exec_nav: 'consolidated', nav_profile });
      assert.deepStrictEqual(execMenu(shell), ['exec-home', 'it-review'], `${roles} / ${nav_profile}`);
      const nav = (mount.innerHTML.match(/<nav class="shell-nav">([\s\S]*?)<\/nav>/) || [])[1] || '';
      assert.ok(/href="it-review.html"/.test(nav) && !/href="executive.html"/.test(nav), 'the Scorecard is not rendered in the menu');
      assert.ok(classes.has('shell-exec-consolidated'), 'body class lets Home show its Scorecard link');
    }
  }
});

test('consolidated: the Scorecard stays reachable through the Ctrl+K finder for those who may open it', () => {
  for (const roles of PERSONAS) {
    const hits = j(load(roles, { exec_nav: 'consolidated' }).shell.searchEntries('scorecard'));
    assert.ok(hits.some((e) => e.id === 'scorecard' && e.href === 'executive.html'), String(roles));
  }
  assert.deepStrictEqual(j(load(['admin'], { exec_nav: 'consolidated' }).shell.searchEntries('scorecard')), [], 'no new permission');
  assert.ok(!('executive' in Object.fromEntries(j(load(['admin'], { exec_nav: 'consolidated' }).shell.menuModel()).map((s) => [s.id, 1]))));
});

test('Executive Home links to the Scorecard only in the consolidated mode', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'dashboards.html'), 'utf8');
  assert.match(html, /id="scorecardLink"[^>]*class="[^"]*shell-exec-consolidated-only|class="[^"]*shell-exec-consolidated-only[^"]*"[^>]*id="scorecardLink"/);
  assert.match(html, /href="executive.html"/);
  const css = fs.readFileSync(path.join(ROOT, 'public', '_shell.css'), 'utf8');
  assert.match(css, /\.shell-exec-consolidated-only\s*\{\s*display:\s*none/);
  assert.match(css, /body\.shell-exec-consolidated \.shell-exec-consolidated-only/);
});
