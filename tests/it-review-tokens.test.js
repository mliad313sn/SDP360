'use strict';
// C-09 (F15, technical part) — IT Review keeps its "Modernist" look but no longer redefines canonical
// _tokens.css names: its palette lives under --ir-*. Proof: no name collision with _tokens.css, and every
// resolved colour/space/shadow is identical to the pre-change snapshot (tests/fixtures/it-review-palette.json,
// taken from the page before the rename). The brand-owner decision on the look itself stays open.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const SNAP = JSON.parse(read('tests/fixtures/it-review-palette.json'));

function parse(html) {
  const style = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
  const css = style.replace(/\/\*[\s\S]*?\*\//g, '');
  const rootM = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  const defs = {};
  for (const [, k, v] of rootM[1].matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) defs[k] = v.trim();
  const resolve = (v, d = 0) => (d > 10 ? v : v.replace(/var\((--[A-Za-z0-9-]+)(?:\s*,\s*([^)]*))?\)/g, (m, n) => (n in defs ? resolve(defs[n], d + 1) : m)));
  const rules = [];
  for (const [, sel, body] of css.replace(rootM[0], '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const [, p, v] of body.matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)) if (/var\(/.test(v)) rules.push(sel.trim().replace(/\s+/g, ' ') + ' | ' + p + ' | ' + resolve(v.trim()));
  }
  return { defs, resolve, rules };
}
const tokenNames = () => new Set([...read('public/_tokens.css').matchAll(/(--[A-Za-z0-9-]+)\s*:/g)].map((m) => m[1]));

test('it-review.html defines no canonical _tokens.css name (only --ir-*)', () => {
  const { defs } = parse(read('public/it-review.html'));
  const names = Object.keys(defs);
  assert.ok(names.length >= 40, 'palette parsed');
  assert.deepEqual(names.filter((n) => !n.startsWith('--ir-')), [], 'every page-level custom property is namespaced');
  const canon = tokenNames();
  assert.ok(canon.has('--color-bg') && canon.has('--color-text'), '_tokens.css parsed');
  assert.deepEqual(names.filter((n) => canon.has(n)), []);
  // no stray definition anywhere else in the file either (style attributes, template)
  const all = [...read('public/it-review.html').matchAll(/(?:^|[;{\s"])(--(?!ir-)[A-Za-z0-9-]+)\s*:/g)].map((m) => m[1]);
  assert.deepEqual(all.filter((n) => canon.has(n)), []);
});

test('computed colours identical: every --ir-* resolves to the value its old name had, every rule resolves the same', () => {
  const now = parse(read('public/it-review.html'));
  for (const [old, val] of Object.entries(SNAP.palette)) {
    const k = old.replace(/^--/, '--ir-');
    assert.ok(k in now.defs, `${k} defined`);
    assert.equal(now.resolve(now.defs[k]), val, `${k} keeps ${old}'s value`);
  }
  assert.equal(Object.keys(now.defs).length, Object.keys(SNAP.palette).length);
  assert.deepEqual(now.rules, SNAP.resolved_rules, 'every var()-based declaration resolves to the same value');
  assert.ok(now.rules.every((r) => !/var\(--/.test(r)), 'no declaration left pointing at an undefined variable');
});

test('every var() the page uses is its own --ir-* (or a canonical token); model colours are namespaced after rendering', () => {
  const html = read('public/it-review.html');
  const canon = tokenNames();
  const { defs } = parse(html);
  for (const [, n] of html.matchAll(/var\((--[A-Za-z0-9-]+)/g)) {
    if (n === '--ir-color-neutral-') continue;   // the inert reference source builds this name by concatenation
    assert.ok(n in defs || canon.has(n), `${n} is neither defined by the page nor a canonical token`);
    assert.ok(n.startsWith('--ir-'), `${n} would read the canonical token instead of the page palette`);
  }
  const IR = require('../public/it-review.js');
  // services/reviewDashboard.js (fidelity-pinned) emits var(--color-…) — mapped onto the page namespace
  assert.equal(IR.namespaceVars('<td style="background:var(--color-accent-100);color:var(--color-text)">'),
    '<td style="background:var(--ir-color-accent-100);color:var(--ir-color-text)">');
  assert.equal(IR.namespaceVars('var(--ir-color-bg)'), 'var(--ir-color-bg)', 'idempotent');
  const emitted = new Set([...read('services/reviewDashboard.js').matchAll(/var\(--(color-[a-z0-9-]*\d)/g)].map((m) => '--ir-' + m[1]));
  for (const n of emitted) assert.ok(n in defs, `${n} (emitted by the model) is defined by the page`);
});
