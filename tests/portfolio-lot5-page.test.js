'use strict';
// PORTFOLIO LOT 5 — the review panel on the project page: external nonce script, an empty hidden host (no static text
// to translate), mounted only while the feature flag is on; the panel script builds no inline handler and no colour
// literal; every control is labelled; EN and FR tables carry the same keys; text is escaped.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

test('project page: nonce script, empty hidden host, mounted behind the feature flag', () => {
  const html = read('public/project.html');
  assert.match(html, /<script nonce="%%CSP_NONCE%%" src="lib\/ppmReview\.js"><\/script>/);
  assert.match(html, /<div class="panel" id="review-panel" hidden><\/div>/);
  assert.match(html, /if \(FEAT\.review_workflow && window\.PpmReview && V\) window\.PpmReview\.mount\(/);
});

test('panel script: no inline handler, no colour literal, labelled controls, EN = FR keys', () => {
  const src = read('public/lib/ppmReview.js');
  assert.ok(!/\son[a-z]+\s*=/i.test(src.replace(/addEventListener/g, '')), 'no inline handler');
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(src), 'tokens only');
  const R = require('../public/lib/ppmReview');
  const S = (R.STRINGS || (globalThis.PpmReview && globalThis.PpmReview.STRINGS));
  assert.deepStrictEqual(Object.keys(S.en).sort(), Object.keys(S.fr).sort());
});

test('render escapes server text and shows only the actions the server allows', () => {
  require('../public/lib/ppmReview');
  const host = { innerHTML: '', hidden: true, addEventListener() {}, textContent: '' };
  let handler;
  const ctx = { $: (id) => (id === 'review-panel' ? host : null), V: () => ({ project: { id: 7 } }), msg() {}, fail() {}, reload() {},
    api: () => Promise.resolve({ steps: [{ key: 'budget_review', label: 'Budget review', label_fr: 'Revue budgétaire' }], reviewers: [], returns: [],
      requests: [{ id: 1, step: 'budget_review', question: '<img src=x>', by: 'pm', answer: null }], requester: { name: 'pm', known: true },
      can_assign: false, can_request: false, can_respond: false, can_return: false }) };
  host.addEventListener = (e, f) => { handler = f; };
  globalThis.PpmReview.mount(ctx);
  return new Promise((r) => setTimeout(r, 10)).then(() => {
    assert.equal(host.hidden, false);
    assert.ok(host.innerHTML.includes('&lt;img src=x&gt;') && !host.innerHTML.includes('<img'), 'escaped');
    assert.ok(!/data-rv="(assign|ask|return|template|respond)"/.test(host.innerHTML), 'no action buttons without the right');
    assert.equal(typeof handler, 'function');
  });
});

test('with every right, every input and select sits inside a label', () => {
  require('../public/lib/ppmReview');
  const host = { innerHTML: '', hidden: true, addEventListener() {}, textContent: '' };
  const ctx = { $: (id) => (id === 'review-panel' ? host : null), V: () => ({ project: { id: 8 } }), msg() {}, fail() {}, reload() {},
    api: () => Promise.resolve({ steps: [{ key: 'dq_check', label: 'DQ', label_fr: 'QD' }], reviewers: [], returns: [], requests: [{ id: 2, step: 'general', question: 'Why now?', by: 'pm', answer: null }],
      requester: null, can_assign: true, can_request: true, can_respond: true, can_return: true }) };
  globalThis.PpmReview.mount(ctx);
  return new Promise((r) => setTimeout(r, 10)).then(() => {
    const h = host.innerHTML;
    const controls = [...h.matchAll(/<(input|select)\b/g)];
    assert.ok(controls.length >= 5);
    for (const m of controls) { const before = h.slice(0, m.index); assert.ok(before.lastIndexOf('<label>') > before.lastIndexOf('</label>'), 'labelled control at ' + m.index); }
  });
});
