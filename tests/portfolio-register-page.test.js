'use strict';
// PORTFOLIO LOT 3 — the register page is a strict-CSP page: every <script> has a src and the nonce, no inline handler,
// no colour literal (tokens only), labelled controls, served from the page cache, listed as strict; the portfolio page
// links to it only while the switch is on.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('public/portfolio-register.html');

test('strict-CSP shape: external nonce scripts only, nonce style, no inline handler, no hex colour', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 5);
  for (const [, attrs, body] of scripts) { assert.match(attrs, /src="/); assert.match(attrs, /nonce="%%CSP_NONCE%%"/); assert.equal(body.trim(), ''); }
  assert.match(html, /<style nonce="%%CSP_NONCE%%">/);
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline handler');
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(html.replace(/href="#[^"]*"/g, '')), 'tokens only');
  for (const src of ['lib/urlFilters.js', 'lib/portfolioRegister.js', 'lib/portfolioRegisterPage.js']) assert.ok(html.includes(`src="${src}"`), src);
  assert.ok(!/\son[a-z]+\s*=/i.test(read('public/lib/portfolioRegisterPage.js').replace(/addEventListener/g, '')), 'page script builds no inline handler');
});

test('served, cached and strict; linked from the portfolio page behind the feature flag', () => {
  const server = read('server.js');
  assert.equal((server.match(/'portfolio-register\.html'/g) || []).length, 2, 'boot cache + route');
  assert.ok(require('../services/sessionAuth').isStrictCspPath('/portfolio-register.html'));
  const pf = read('public/portfolio.html');
  assert.match(pf, /id="register-link" href="portfolio-register\.html" hidden/);
  assert.match(pf, /\$\("register-link"\)\.hidden = !f\.portfolio_dashboard_v2/);
});

test('every select and the search box carry a label; the table region is focusable and named', () => {
  const src = read('public/lib/portfolioRegisterPage.js');
  assert.match(src, /<select multiple id="pf_\$\{k\}" name="\$\{k\}" aria-label=/);
  assert.match(src, /<label>\$\{esc\(T\.search\)\}<input type="search"/);
  const UI = require('../public/lib/portfolioRegister');
  const t = UI.tableHtml([{ id: 1, ref: 'PRJ-1' }], { cols: ['ref', 'site', 'name'], esc: (s) => String(s), T: UI.T.fr, lang: 'fr' });
  assert.match(t, /role="region" aria-label="Registre du portefeuille"/); assert.match(t, /tabindex="0"/); assert.match(t, /<th scope="row"/);
  assert.deepStrictEqual(Object.keys(UI.T.en).sort(), Object.keys(UI.T.fr).sort(), 'EN and FR tables have the same keys');
});
