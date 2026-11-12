'use strict';
// F-UX-01 — a page that shows a French body (body.lang-fr) must also announce French (<html lang="fr">),
// otherwise a screen reader reads French text with an English voice (WCAG 3.1.1).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUB = path.join(__dirname, '..', 'public');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'vendor') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(html|js)$/.test(e.name)) out.push(p);
  }
  return out;
}
// A line that WRITES the body class (add / toggle / remove), not one that only reads it or styles it.
const WRITES = /classList\.(?:add|toggle|remove)\(\s*'lang-fr'/;

test('every file that switches body.lang-fr also sets document.documentElement.lang', () => {
  const offenders = [];
  let seen = 0;
  for (const f of walk(PUB)) {
    const src = fs.readFileSync(f, 'utf8');
    if (!WRITES.test(src)) continue;
    seen++;
    if (!/document\.documentElement\.lang\s*=/.test(src)) offenders.push(path.relative(PUB, f));
  }
  assert.ok(seen >= 10, `expected the bilingual pages to be found (saw ${seen})`);
  assert.deepStrictEqual(offenders, []);
});

test('each write of the class is paired with a lang write in the same function or statement group', () => {
  // Stronger than file level: within 3 lines after each write there is a lang assignment (or on the same line).
  const offenders = [];
  for (const f of walk(PUB)) {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((ln, i) => {
      if (!WRITES.test(ln)) return;
      const near = lines.slice(Math.max(0, i - 1), i + 4).join('\n');
      if (!/document\.documentElement\.lang\s*=/.test(near)) offenders.push(`${path.relative(PUB, f)}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(offenders, []);
});

function runHome(shellLang) {
  const src = fs.readFileSync(path.join(PUB, 'lib', 'home-page.js'), 'utf8');
  const cls = new Set();
  const el = () => ({ textContent: '', innerHTML: '', hidden: false, style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], focus() {} });
  const document = {
    documentElement: { lang: 'en', dataset: {} },
    body: { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) } },
    getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => el(),
  };
  const window = { __shell: { shellLang: () => shellLang, WORKSPACES: [], workspaceFor: () => null }, __authUser: { roles: ['editor'] }, addEventListener() {}, location: { search: '', href: '' } };
  window.window = window; window.document = document;
  const ctx = vm.createContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, fetch: () => new Promise(() => {}), console, setTimeout, clearTimeout, URLSearchParams, location: window.location });
  try { vm.runInContext(src, ctx, { filename: 'home-page.js' }); } catch (_) { /* the page boot needs a real DOM; the language lines run first */ }
  return { lang: document.documentElement.lang, fr: cls.has('lang-fr') };
}

test('Home: French shell language → body.lang-fr and <html lang="fr">', () => {
  assert.deepStrictEqual(runHome('fr'), { lang: 'fr', fr: true });
});
test('Home: English stays <html lang="en"> with no lang-fr class', () => {
  assert.deepStrictEqual(runHome('en'), { lang: 'en', fr: false });
});
