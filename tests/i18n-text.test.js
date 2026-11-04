'use strict';
// A-09a — the exact-text layer (public/lib/i18nText.js): text changed IN PLACE (React re-render =
// characterData) is translated too, without looping on its own writes; the first-visit default comes
// from the UI policy (window.__uiPolicy.lang_default) and a saved choice still wins.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'i18nText.js'), 'utf8');

function textNode(v) {
  let val = v; const n = { nodeType: 3, writes: 0 };
  Object.defineProperty(n, 'nodeValue', { get: () => val, set: (x) => { val = x; n.writes++; } });
  return n;
}
function el(tag, children) { return { nodeType: 1, tagName: tag, childNodes: children || [], hasAttribute: () => false }; }

function load({ saved = null, policy, navLang = 'en-US' } = {}) {
  const store = saved ? { sdp_lang: saved } : {};
  let observerCb = null, observeOpts = null;
  class MO { constructor(cb) { observerCb = cb; } observe(_s, o) { observeOpts = o; } disconnect() {} }
  const body = el('BODY', []);
  const documentElement = { lang: 'en' };
  const window = {}; if (policy) window.__uiPolicy = policy;
  const ctx = { window, document: { body, documentElement }, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } }, navigator: { language: navLang }, MutationObserver: MO };
  vm.runInNewContext(SRC, ctx);
  return { I: window.I18nText, body, documentElement, fire: (recs) => observerCb(recs), opts: () => observeOpts, store };
}

const DICT = { Save: 'Enregistrer', Loading: 'Chargement' };

test('a characterData change to an English key is translated when the page is in French', () => {
  const h = load({ saved: 'fr' });
  const n = textNode('Loading');
  h.body.childNodes.push(n);
  h.I.install({ dict: DICT });
  assert.strictEqual(n.nodeValue, 'Chargement');
  assert.ok(h.opts().characterData, 'observes characterData');
  n.nodeValue = 'Save';                       // React updates the existing text node in place
  h.fire([{ type: 'characterData', target: n, addedNodes: [] }]);
  assert.strictEqual(n.nodeValue, 'Enregistrer');
});

test('a node already holding the French value is not re-processed (no loop)', () => {
  const h = load({ saved: 'fr' });
  h.I.install({ dict: DICT });
  const n = textNode('Enregistrer');
  const before = n.writes;
  h.fire([{ type: 'characterData', target: n, addedNodes: [] }]);
  assert.strictEqual(n.nodeValue, 'Enregistrer');
  assert.strictEqual(n.writes, before, 'no write on a French value');
});

test('with nothing saved, the policy default (fr) decides the language', () => {
  const h = load({ policy: { lang_default: 'fr' } });
  h.I.install({ dict: DICT });
  assert.strictEqual(h.I.lang(), 'fr');
  assert.strictEqual(h.documentElement.lang, 'fr');
});

test('a saved sdp_lang=en beats the policy default fr', () => {
  const h = load({ saved: 'en', policy: { lang_default: 'fr' }, navLang: 'fr-FR' });
  h.I.install({ dict: DICT });
  assert.strictEqual(h.I.lang(), 'en');
});

test('without policy and nothing saved, the browser language still decides (today)', () => {
  assert.strictEqual((() => { const h = load({ navLang: 'fr-CI' }); h.I.install({ dict: DICT }); return h.I.lang(); })(), 'fr');
  assert.strictEqual((() => { const h = load({ navLang: 'en-GB' }); h.I.install({ dict: DICT }); return h.I.lang(); })(), 'en');
});

test('merge() combines dictionaries, later ones win', () => {
  const h = load();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.I.merge({ a: '1', b: '2' }, null, { b: '3' }))), { a: '1', b: '3' });
});
