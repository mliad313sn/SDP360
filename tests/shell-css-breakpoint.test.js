'use strict';
// A-21 — the "icons only" breakpoint of the top menu: 1400 px in the full profile (today), 1180 px only when the
// lean profile is active (body.shell-nav-lean, set by _shell.js from report_config ui_nav_profile).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', '_shell.css'), 'utf8').replace(/\r\n/g, '\n');

function block(media) {
  const i = CSS.indexOf(`@media (max-width: ${media})`);
  assert.ok(i >= 0, `@media (max-width: ${media}) exists`);
  let depth = 0, j = CSS.indexOf('{', i);
  for (let k = j; k < CSS.length; k++) {
    if (CSS[k] === '{') depth++;
    else if (CSS[k] === '}' && --depth === 0) return CSS.slice(j + 1, k);
  }
  throw new Error('unbalanced');
}

test('the 1400 px label rule is scoped to body:not(.shell-nav-lean)', () => {
  const b = block('1400px');
  assert.match(b, /body:not\(\.shell-nav-lean\) \.shell-nav > \.shell-nav-item:not\(\.is-active\) \.shell-nav-label/);
  assert.match(b, /body:not\(\.shell-nav-lean\) \.shell-nav > \.shell-nav-item-link:not\(\.is-active\) \.shell-nav-label/);
  assert.ok(!/(^|[\s,}])\.shell-nav > /.test(b.replace(/body:not\(\.shell-nav-lean\) /g, 'X')), 'no unscoped label rule left in the 1400 px block');
});

test('a 1180 px label rule exists for body.shell-nav-lean', () => {
  const b = block('1180px');
  assert.match(b, /body\.shell-nav-lean \.shell-nav > \.shell-nav-item:not\(\.is-active\) \.shell-nav-label/);
  assert.match(b, /body\.shell-nav-lean \.shell-nav > \.shell-nav-item-link:not\(\.is-active\) \.shell-nav-label/);
});

test('lean-only contextual links are hidden unless the lean profile is active', () => {
  assert.match(CSS, /\.shell-lean-only\s*\{\s*display:\s*none/);
  assert.match(CSS, /body\.shell-nav-lean \.shell-lean-only\s*\{/);
});
