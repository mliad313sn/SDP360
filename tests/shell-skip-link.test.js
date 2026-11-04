'use strict';
// A-12a — the shared header injects a "Skip to content" link on every shell page (WCAG 2.4.1) and the
// shell stylesheet carries one global focus ring that inline outline:none cannot remove (WCAG 2.4.7).
// _shell.js runs in a sandbox with a small stub DOM (pattern of tests/shell-navigation.test.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', '_shell.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', '_shell.css'), 'utf8').replace(/\r\n/g, '\n');

function el(tag, attrs = {}) {
  const e = { tagName: tag.toUpperCase(), attrs: { ...attrs }, children: [], parent: null, className: '', textContent: '', dataset: {},
    get id() { return this.attrs.id || ''; }, set id(v) { this.attrs.id = v; },
    get href() { return this.attrs.href || ''; }, set href(v) { this.attrs.href = v; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null },
    hasAttribute(k) { return k in this.attrs; },
    get firstChild() { return this.children[0] || null; },
    get nextElementSibling() { const s = this.parent && this.parent.children; return s ? s[s.indexOf(this) + 1] || null : null; },
    insertBefore(n, ref) { n.parent = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; },
    appendChild(n) { return this.insertBefore(n, null); } };
  return e;
}
function walk(root, fn) { for (const c of root.children) { fn(c); walk(c, fn); } }

function load({ lang = null, existingSkip = false, main = 'none' } = {}) {
  const body = el('body');
  const mount = el('div', { id: '__shell' }); mount.dataset = { section: 'operations', current: 'portfolio' }; mount.innerHTML = '';
  if (existingSkip) { const s = el('a', { href: '#main' }); s.className = 'edv-skip'; body.appendChild(s); }
  body.appendChild(mount);
  body.appendChild(el('script'));
  const content = el(main === 'tag' ? 'main' : 'div', main === 'id' ? { id: 'main' } : main === 'other-id' ? { id: 'content' } : {});
  if (main === 'other-id') content.tagName = 'MAIN';
  body.appendChild(content);
  const all = () => { const out = []; walk(body, (n) => out.push(n)); return out; };
  const matches = (n, sel) => sel.split(',').map((s) => s.trim()).some((s) => (s.startsWith('.') ? n.className.split(/\s+/).includes(s.slice(1)) : n.tagName === s.toUpperCase()));
  const document = { readyState: 'complete', body,
    getElementById: (id) => all().find((n) => n.id === id) || null,
    querySelector: (sel) => all().find((n) => matches(n, sel)) || null,
    querySelectorAll: (sel) => all().filter((n) => matches(n, sel)),
    createElement: (t) => el(t), addEventListener() {} };
  const window = { __userHasRole: () => true, __authUser: { full_name: 'Ana', role: 'admin' }, EDV_ICONS: { html: () => '', get: () => '' } };
  const localStorage = { getItem: (k) => (k === 'sdp_lang' ? lang : null), setItem() {} };
  vm.runInNewContext(SRC, { window, document, console, localStorage, navigator: { language: 'en-US' } });
  const skips = all().filter((n) => n.className === 'shell-skip');
  return { window, document, body, content, skips, mount };
}

test('render() inserts exactly one .shell-skip link as the first child of <body>', () => {
  const { body, skips } = load({ main: 'id' });
  assert.strictEqual(skips.length, 1);
  assert.strictEqual(body.firstChild, skips[0]);
  assert.strictEqual(skips[0].href, '#main');
  assert.strictEqual(skips[0].textContent, 'Skip to content');
});

test('a re-render does not add a second link', () => {
  const r = load({ main: 'id' });
  r.window.__shell.render(r.mount);
  r.window.__shell.render(r.mount);
  assert.strictEqual(r.body.children.filter((n) => n.className === 'shell-skip').length, 1);
});

test('no shell link when the page already has its own .edv-skip', () => {
  assert.strictEqual(load({ existingSkip: true, main: 'id' }).skips.length, 0);
});

test('target without #main: the element after the mount (scripts skipped) gets id=main and tabindex=-1', () => {
  const { content, skips } = load({ main: 'none' });
  assert.strictEqual(content.id, 'main');
  assert.strictEqual(content.getAttribute('tabindex'), '-1');
  assert.strictEqual(skips[0].href, '#main');
});

test('first <main> is the target; an existing id is kept and the link points at it', () => {
  assert.strictEqual(load({ main: 'tag' }).content.id, 'main');
  const r = load({ main: 'other-id' });
  assert.strictEqual(r.content.id, 'content');
  assert.strictEqual(r.skips[0].href, '#content');
});

test('label is French when sdp_lang=fr', () => {
  assert.strictEqual(load({ lang: 'fr', main: 'id' }).skips[0].textContent, 'Aller au contenu');
});

test('_shell.css: off-screen skip link that appears on focus', () => {
  assert.match(CSS, /\.shell-skip \{[^}]*position: ?absolute[^}]*left: ?-9999px/);
  assert.match(CSS, /\.shell-skip:focus \{[^}]*left: ?8px/);
});

test('_shell.css: one global :focus-visible ring with !important (beats inline outline:none) + forced-colors fallback', () => {
  assert.match(CSS, /(^|\n):focus-visible \{[^}]*outline: ?2px solid [^;]*!important;[^}]*outline-offset: ?2px ?!important/);
  assert.match(CSS, /@media \(forced-colors: active\) \{\s*:focus-visible \{ ?outline-color: ?Highlight ?!important/);
});

test('_shell.css: the header keeps its light ring on the dark background (not overridden by the global ring)', () => {
  assert.match(CSS, /\.shell-dropdown a:focus-visible[^{]*\{[^}]*var\(--shell-orange-light\) ?!important/);
  assert.match(CSS, /\.shell-lang-btn:focus-visible \{[^}]*!important/);
  assert.match(CSS, /\.shell-search-list a:focus-visible \{[^}]*!important/);
});
