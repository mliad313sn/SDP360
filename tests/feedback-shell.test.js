'use strict';
// E-B07 — the shell shows the Feedback button only while ui_feedback_enabled = '1' (window.__uiPolicy.feedback),
// and the dialog never parses user text as HTML. _shell.js runs in a sandbox (pattern of shell-skip-link.test.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', '_shell.js'), 'utf8');

function render(policy) {
  const mount = { dataset: { section: 'operations', current: 'portfolio' }, innerHTML: '', children: [], appendChild() {}, insertBefore() {} };
  const body = { children: [mount], appendChild() {}, insertBefore() {}, classList: { toggle() {}, add() {}, remove() {} } };
  const document = { readyState: 'complete', body, getElementById: (id) => (id === '__shell' ? mount : null), querySelector: () => null,
    querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, appendChild() {}, dataset: {}, children: [] }), addEventListener() {} };
  const window = { __userHasRole: () => true, __authUser: { full_name: 'Ana', role: 'admin' }, __uiPolicy: policy, EDV_ICONS: { html: () => '', get: () => '' } };
  vm.runInNewContext(SRC, { window, document, console, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'en-US' } });
  if (window.__shell && window.__shell.render) window.__shell.render(mount);
  return mount.innerHTML;
}

test('switch off (default) → no Feedback button', () => {
  assert.ok(!render({ feedback: '0' }).includes('shell-feedback-btn'));
  assert.ok(!render(undefined).includes('shell-feedback-btn'));
});

test('switch on → Feedback button in the header actions', () => {
  assert.match(render({ feedback: '1' }), /class="shell-feedback-btn"/);
});

test('the dialog builds its DOM with textContent only (an XSS payload stays text)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'lib', 'feedback.js'), 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(src), 'no HTML parsing of user text');
  assert.match(src, /textContent/);
});
