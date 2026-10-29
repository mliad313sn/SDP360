'use strict';
// UAT F-03 — the field app is French first: every visible text of the shell has a French entry, French is
// the default, and the language files are in the offline cache.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DIR = path.join(__dirname, '..', 'public', 'field');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

function loadDict() {
  let dict = null; const store = {};
  const ctx = { window: {}, document: { getElementById: () => null }, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } } };
  ctx.window.I18nText = { install: (o) => { dict = o.dict; }, t: (s) => s };
  vm.runInNewContext(fs.readFileSync(path.join(DIR, 'i18n.js'), 'utf8'), ctx);
  return { dict, store };
}

test('every visible text and label of the field shell has a French translation', () => {
  const { dict } = loadDict();
  const body = html.slice(html.indexOf('<body>'), html.indexOf('<script'));
  const texts = [...body.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter((t) => /[A-Za-z]{2}/.test(t) && !/^(FR|EN)$/.test(t));
  const attrs = [...body.matchAll(/(?:placeholder|aria-label|title)="([^"]+)"/g)].map((m) => m[1]);
  const missing = [...texts, ...attrs].filter((t) => !(t in dict));
  assert.deepStrictEqual(missing, [], 'missing French entries');
});

test('French is the default and the toggle exists', () => {
  const { store } = loadDict();
  assert.strictEqual(store.field_lang, 'fr');
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /id="lang-fr"/); assert.match(html, /id="lang-en"/);
});

test('the language files are in the offline cache and the cache version moved', () => {
  const sw = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
  assert.match(sw, /'\/field\/i18n\.js'/); assert.match(sw, /'\/lib\/i18nText\.js'/);
  assert.doesNotMatch(sw, /CACHE_VERSION = 'field-v1'/);
});

test('app.js messages go through the dictionary (no bare English status message left)', () => {
  const app = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
  const { dict } = loadDict();
  for (const m of app.matchAll(/FT\('([^']+)'\)/g)) assert.ok(m[1] in dict, `FT('${m[1]}') has no French entry`);
  assert.doesNotMatch(app, /msg\('[A-Z]/, 'every msg() text is translated');
});
