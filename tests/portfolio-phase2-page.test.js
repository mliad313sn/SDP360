'use strict';
// PORTFOLIO LOT 6 — the portfolio Phase 2 page is a strict-CSP page; the three project tabs exist only behind their
// feature flags; both scripts carry EN + FR tables with the same keys and build no inline handler; controls labelled.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

test('portfolio-phase2.html: external nonce scripts only, no inline handler, tokens only, served + cached + strict', () => {
  const html = read('public/portfolio-phase2.html');
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) { assert.match(attrs, /src="/); assert.match(attrs, /nonce="%%CSP_NONCE%%"/); assert.equal(body.trim(), ''); }
  assert.ok(!/\son[a-z]+\s*=/i.test(html)); assert.ok(!/#[0-9a-f]{3,6}\b/i.test(html.replace(/href="#[^"]*"/g, '')));
  assert.ok(html.includes('src="lib/portfolioPhase2Page.js"')); assert.match(html, /<main id="main"/); assert.match(html, /class="edv-skip"/);
  assert.equal((read('server.js').match(/'portfolio-phase2\.html'/g) || []).length, 2);
  assert.ok(require('../services/sessionAuth').isStrictCspPath('/portfolio-phase2.html'));
  for (const f of ['public/lib/portfolioPhase2Page.js', 'public/lib/ppmPhase2.js']) assert.ok(!/\son[a-z]+\s*=/i.test(read(f).replace(/addEventListener/g, '')), f);
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(read('public/lib/ppmPhase2.css')), 'tokens only');
});

test('project.html: the three tabs are hidden and added only by their flags; the portfolio link only behind a flag', () => {
  const p = read('public/project.html');
  for (const t of ['p2deps', 'p2demand', 'p2docs']) { assert.match(p, new RegExp(`id="tab-${t}"[^>]*hidden`)); assert.match(p, new RegExp(`id="pane-${t}" role="tabpanel" aria-labelledby="tab-${t}" hidden`)); }
  assert.match(p, /if \(FEAT\.structured_dependencies\) addTab\("p2deps", "gates"\)/);
  assert.match(p, /if \(FEAT\.resource_demand\) addTab\("p2demand", "gates"\)/);
  assert.match(p, /if \(FEAT\.documents\) addTab\("p2docs", "gates"\)/);
  assert.match(read('public/portfolio.html'), /id="phase2-link" href="portfolio-phase2\.html" hidden/);
});

test('EN / FR tables carry the same keys; every generated input has a label', () => {
  const P2 = require('../public/lib/ppmPhase2.js');
  assert.deepStrictEqual(Object.keys(P2.S.en).sort(), Object.keys(P2.S.fr).sort());
  const src = read('public/lib/ppmPhase2.js');
  const ids = [...src.matchAll(/field\('([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length >= 15);
  for (const id of ids.filter((i) => !i.endsWith('-'))) assert.ok(src.includes(`id="${id}"`), id + ' input carries the id its label points to');
  assert.match(src, /field\('p2-eff-' \+ k, esc\(t\(k\)\), '<select id="p2-eff-' \+ k \+ '">'/, 'effort factor selects: dynamic id = label for');
  const page = read('public/lib/portfolioPhase2Page.js');
  const en = page.slice(page.indexOf('en: {'), page.indexOf('fr: {')), fr = page.slice(page.indexOf('fr: {'), page.indexOf('const T ='));
  const keys = (s) => [...s.matchAll(/\b([a-z_]+): '/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(keys(en), keys(fr));
});
