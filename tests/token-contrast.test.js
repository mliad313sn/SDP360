'use strict';
// A-12b — WCAG 2.2 AA contrast of the design tokens, computed (not eyeballed) from public/_tokens.css.
// 1.4.3 text ≥ 4.5:1 · 1.4.11 non-text (marks, focus ring) ≥ 3:1. Light mode only (no dark theme exists).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', '_tokens.css'), 'utf8').replace(/\r\n/g, '\n');

function tokens(css) {
  const out = {};
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) if (!(m[1] in out)) out[m[1]] = m[2].replace(/\/\*.*?\*\//g, '').trim();
  return out;
}
const T = tokens(CSS);
function resolve(v, depth = 0) {
  const m = /^var\((--[\w-]+)(?:,\s*([^)]+))?\)$/.exec(String(v).trim());
  if (!m) return String(v).trim();
  if (depth > 3) throw new Error('var() too deep: ' + v);
  return resolve(T[m[1]] != null ? T[m[1]] : m[2], depth + 1);
}
function hex(name) {
  const v = name.startsWith('#') ? name : resolve(T[name]);
  assert.match(v, /^#[0-9a-fA-F]{6}$/, `${name} resolves to a 6-digit hex (got ${v})`);
  return v;
}
function lum(h) {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }

const PAIRS = [
  ['#FFFFFF', '--color-primary-fill', 4.5],
  ['#FFFFFF', '--color-primary-fill-hover', 4.5],
  ['--color-warning-text', '#FFFFFF', 4.5],
  ['--color-warning-text', '--color-warning-bg', 4.5],
  ['--color-success-text', '#FFFFFF', 4.5],
  ['--color-success-text', '--color-success-bg', 4.5],
  ['--color-text-muted', '#FFFFFF', 4.5],
  ['--color-text-muted', '--color-bg', 4.5],
  ['--rag-na', '#FFFFFF', 3.0],
  ['--rag-green', '#FFFFFF', 3.0],
  ['--rag-amber', '#FFFFFF', 3.0],
  ['--rag-red', '#FFFFFF', 3.0],
  ['--focus-ring', '#FFFFFF', 3.0],
  ['--focus-ring', '--color-bg', 3.0],
  ['--chart-target', '#FFFFFF', 3.0],
  ['--chart-text', '#FFFFFF', 4.5],
];
for (const [fg, bg, min] of PAIRS) {
  test(`${fg} on ${bg} ≥ ${min}:1`, () => {
    const r = ratio(fg, bg);
    assert.ok(r >= min, `${fg} on ${bg} = ${r.toFixed(2)}:1, needs ${min}:1`);
  });
}

test('every chart series colour is ≥ 3:1 on white (non-text contrast)', () => {
  for (let i = 1; i <= 6; i++) {
    const r = ratio(`--chart-series-${i}`, '#FFFFFF');
    assert.ok(r >= 3, `--chart-series-${i} = ${r.toFixed(2)}:1`);
  }
});

test('--color-warning keeps #D97706 (mirrored for the PPTX generators in brand-tokens.js)', () => {
  assert.strictEqual(T['--color-warning'].toUpperCase(), '#D97706');
  const mirror = fs.readFileSync(path.join(__dirname, '..', 'public', 'brand', 'brand-tokens.js'), 'utf8');
  assert.match(mirror, /'#D97706'/);
});

test('the brand orange itself is unchanged (accents, borders, brand mark)', () => {
  assert.strictEqual(T['--edv-orange'].toUpperCase(), '#EF631A');
  assert.match(T['--color-primary'], /var\(--edv-orange\)/);
});

module.exports = { ratio };
