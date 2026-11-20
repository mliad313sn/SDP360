'use strict';
// PORTFOLIO LOT 4 — the decisions & alerts page is a strict-CSP page: every <script> has a src and the nonce, no inline
// handler, tokens only, labelled controls, EN / FR tables with the same keys, served from the page cache, listed as
// strict; the portfolio page links to it only while one of the two switches is on.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('public/portfolio-decisions.html');
const js = read('public/lib/portfolioDecisionsPage.js');

test('strict-CSP shape: external nonce scripts only, nonce style, no inline handler, no hex colour', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 4);
  for (const [, attrs, body] of scripts) { assert.match(attrs, /src="/); assert.match(attrs, /nonce="%%CSP_NONCE%%"/); assert.equal(body.trim(), ''); }
  assert.match(html, /<style nonce="%%CSP_NONCE%%">/);
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline handler');
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(html.replace(/href="#[^"]*"/g, '')), 'tokens only');
  assert.ok(html.includes('src="lib/portfolioDecisionsPage.js"'));
  assert.ok(!/\son[a-z]+\s*=/i.test(js.replace(/addEventListener/g, '')), 'page script builds no inline handler');
});

test('served, cached and strict; linked from the portfolio page behind the feature flags', () => {
  assert.equal((read('server.js').match(/'portfolio-decisions\.html'/g) || []).length, 2, 'boot cache + route');
  assert.ok(require('../services/sessionAuth').isStrictCspPath('/portfolio-decisions.html'));
  const pf = read('public/portfolio.html');
  assert.match(pf, /id="decisions-link" href="portfolio-decisions\.html" hidden/);
  assert.match(pf, /\$\("decisions-link"\)\.hidden = !\(f\.decision_agenda \|\| f\.alert_actions\)/);
});

test('every input carries a label; tables have scoped headers; EN and FR carry the same keys; nothing is sent', () => {
  assert.match(js, /<label class="pd-sr" for="\$\{esc\(name\)\}">/);
  assert.match(js, /<th scope="col">/); assert.match(js, /<th scope="row">/);
  const en = js.match(/en: \{ title:/), fr = js.match(/fr: \{ title:/);
  assert.ok(en && fr);
  const keysOf = (tag) => { const i = js.indexOf(tag); const seg = js.slice(i, js.indexOf('kinds:', i)); return [...seg.matchAll(/(?:\{ |, )([a-zA-Z_]+): /g)].map((m) => m[1]).sort(); };
  assert.deepStrictEqual(keysOf('en: { title:'), keysOf('fr: { title:'));
  assert.ok(!/mailto:|\/notify|\/send/.test(js), 'the page sends no message');
});
