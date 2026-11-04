'use strict';
// A-12b — white text never sits on brand orange (3.25:1). Filled controls use --color-primary-fill
// (5.18:1); the 55 `outline:none` declarations are gone so the keyboard focus ring always shows.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8').replace(/\r\n/g, '\n');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['vendor', 'dist', 'dashboard-preview', 'design-system', 'node_modules'].includes(e.name)) walk(p, out); }
    else if (/\.(html|css)$/.test(e.name)) out.push(p);
  }
  return out;
}
// dashboard-preview/ and design-system/ are the frozen design references (not product pages).
const FILES = walk(PUB);
const ORANGE = /background(?:-color)?\s*:\s*(var\(--edv-orange(?:-dark)?(?:,\s*#[0-9A-Fa-f]{6})?\)|var\(--orange(?:-dark)?(?:,[^)]*)?\)|var\(--color-primary(?:-hover)?(?:,[^)]*)?\)|var\(--shell-orange\)|#EF631A|#CA6419|#E87722)/i;
const WHITE = /(?<![-\w])color\s*:\s*(#fff\b|#ffffff\b|white\b)/i;

function cssOf(file, s) { return file.endsWith('.css') ? s : [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'); }

test('brand/components.css and login.html filled buttons use --color-primary-fill', () => {
  const comp = read('brand/components.css');
  assert.match(comp, /\.edv-empty-state__action\s*\{[^}]*background:\s*var\(--color-primary-fill/);
  assert.match(comp, /\.edv-empty-state__action:hover\s*\{[^}]*background:\s*var\(--color-primary-fill-hover/);
  const login = read('login.html');
  assert.match(login, /\.btn\{[^}]*background:var\(--color-primary-fill/);
  assert.match(login, /\.btn:hover\{background:var\(--color-primary-fill-hover/);
  assert.match(read('_shell.css'), /\.shell-user-role \{\s*background: var\(--color-primary-fill/);
});

test('no CSS rule or inline style puts white text on brand orange', () => {
  const bad = [];
  for (const f of FILES) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of cssOf(f, s).matchAll(/([^{}]{0,200})\{([^{}]*)\}/g)) if (ORANGE.test(m[2]) && WHITE.test(m[2])) bad.push(path.relative(PUB, f) + ' ' + m[1].trim().split('\n').pop());
    if (f.endsWith('.html')) for (const m of s.matchAll(/style="([^"]*)"/g)) if (ORANGE.test(m[1]) && WHITE.test(m[1])) bad.push(path.relative(PUB, f) + ' inline');
  }
  assert.deepStrictEqual(bad, []);
});

test('no outline:none left in page CSS or inline styles (the global ring is the only focus style)', () => {
  const ALLOW = { '_shell.css': 1 }; // [data-shell-skip-target]:focus — a programmatic skip target, not a control
  const bad = [];
  for (const f of FILES) {
    const rel = path.relative(PUB, f).split(path.sep).join('/');
    const n = (fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').match(/outline\s*:\s*(none|0)\b/g) || []).length;
    if (n > (ALLOW[rel] || 0)) bad.push(`${rel}: ${n}`);
  }
  assert.deepStrictEqual(bad, []);
});

test('status words use the *-text tokens, not --color-warning/--color-success', () => {
  const bad = [];
  for (const f of FILES) {
    const rel = path.relative(PUB, f).split(path.sep).join('/');
    if (rel === 'brand/icons.css') continue; // icon tint = non-text mark, 3.19:1 ≥ 3:1
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?<![-\w])color\s*:\s*var\(--color-(warning|success)[,)]/g)) bad.push(`${rel}: ${m[0]}`);
  }
  assert.deepStrictEqual(bad, []);
});
