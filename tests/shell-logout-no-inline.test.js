'use strict';
// P07 — the shell's user pill (log out) must work on a page served with the nonce-only script-src: no inline
// on*="" handler in the markup the shell builds; the click is handled by the shell's delegated listener.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', '_shell.js'), 'utf8');

function boot() {
  const listeners = {};
  const mount = { dataset: { section: 'operations', current: 'portfolio' }, innerHTML: '', children: [], appendChild() {}, insertBefore() {} };
  const body = { children: [mount], appendChild() {}, insertBefore() {}, classList: { toggle() {}, add() {}, remove() {} } };
  const document = { readyState: 'complete', body, getElementById: (id) => (id === '__shell' ? mount : null), querySelector: () => null,
    querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, appendChild() {}, dataset: {}, children: [] }),
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); } };
  let loggedOut = 0;
  const window = { __userHasRole: () => true, __authUser: { full_name: 'Ana', role: 'admin' }, __uiPolicy: {}, EDV_ICONS: { html: () => '', get: () => '' },
    __logout() { loggedOut++; } };
  vm.runInNewContext(SRC, { window, document, console, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'en-US' } });
  if (window.__shell && window.__shell.render) window.__shell.render(mount);
  return { html: mount.innerHTML, listeners, loggedOut: () => loggedOut };
}

test('the rendered header carries no inline event handler', () => {
  const { html } = boot();
  assert.match(html, /shell-user-pill/);
  assert.ok(!/<[a-zA-Z][^>]*\son[a-z]+\s*=/.test(html), 'inline handler found in shell markup');
});

// ia-value F5 (2026-11): the pill OPENS the account menu — one click never signs out; "Sign out" is an explicit item.
test('a click on the user pill opens the account menu and does NOT log out', () => {
  const b = boot();
  assert.match(b.html, /class="shell-user-pill"[^>]*aria-haspopup="menu"/);
  const target = { closest: (sel) => (sel === '.shell-user-pill' ? { setAttribute() {} } : null) };
  for (const fn of b.listeners.click || []) fn({ target, preventDefault() {}, stopPropagation() {} });
  assert.equal(b.loggedOut(), 0);
});

test('the "Sign out" item logs out through the delegated listener', () => {
  const b = boot();
  assert.match(b.html, /class="shell-signout"/);
  const target = { closest: (sel) => (sel === '.shell-signout' ? {} : null) };
  for (const fn of b.listeners.click || []) fn({ target, preventDefault() {}, stopPropagation() {} });
  assert.equal(b.loggedOut(), 1);
});

test('no shell source string builds an inline handler', () => {
  assert.ok(!/\son[a-z]{3,}\s*=\s*\\?["'`]/.test(SRC.replace(/\/\/[^\n]*/g, '')), 'inline handler string in _shell.js');
});
