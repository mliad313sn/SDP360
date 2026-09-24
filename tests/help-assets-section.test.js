'use strict';
// G-08 (audit 2026-09-24) — the Assets module must be documented, in both languages.
//
// The audit found help.html covered the weekly report's tab 5 and the admin reminder
// card, but the module itself — seven tabs, including the two least self-explanatory
// surfaces in the product (Réconciliation, Investment) — had three passing mentions in
// the whole file. A site asset manager is exactly the persona with no one to ask.
//
// These tests are a drift guard, not prose review: they check the section exists on both
// sides, covers every tab, and that no table-of-contents entry points at nothing.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'help.html'), 'utf8').replace(/\r\n/g, '\n');

// The seven tabs of public/assets.html, in page order.
const TABS = ['inventory', 'hygiene', 'finance', 'hardware', 'progress', 'investment', 'reconcile'];

for (const lang of ['en', 'fr']) {
  test(`[${lang}] the Assets module has its own section`, () => {
    assert.ok(src.includes(`id="${lang}-18"`), `section ${lang}-18 exists`);
    assert.ok(src.includes(`href="#${lang}-18"`), `the table of contents links to it`);
  });

  test(`[${lang}] every Assets tab is documented`, () => {
    for (let i = 1; i <= TABS.length; i++) {
      assert.ok(src.includes(`id="${lang}-18-${i}"`), `sub-section ${lang}-18-${i} (${TABS[i - 1]}) exists`);
      assert.ok(src.includes(`href="#${lang}-18-${i}"`), `sub-section ${lang}-18-${i} is in the table of contents`);
    }
  });
}

test('the freshness rule is stated — the register is not live', () => {
  // The single thing an asset manager most needs to know, and the reason G-03 exists.
  assert.match(src, /04:30/, 'the nightly sync time is stated');
  assert.ok(/jamais synchronis|never synced/i.test(src), 'the never-synced state is explained');
});

test('the help promises nothing that is blocked', () => {
  const s18 = src.slice(src.indexOf('id="en-18"'), src.indexOf('id="fr-1"') > 0 ? src.length : src.length);
  assert.ok(!/format d'import SDP|SDP import template/i.test(s18) || /non fourni|not supplied|bloqué|blocked/i.test(s18),
    'the SDP import template is blocked — do not document it as available');
});

test('every table-of-contents link resolves to a real anchor', () => {
  const hrefs = [...src.matchAll(/href="#((?:en|fr)-[0-9.\-]+)"/g)].map(m => m[1]);
  const ids = new Set([...src.matchAll(/id="((?:en|fr)-[0-9.\-]+)"/g)].map(m => m[1]));
  const missing = [...new Set(hrefs)].filter(h => !ids.has(h));
  assert.deepStrictEqual(missing, [], `dangling table-of-contents links: ${missing.join(', ')}`);
});
