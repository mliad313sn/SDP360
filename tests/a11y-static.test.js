'use strict';
// Step 6 — static accessibility floor for every NEW page (the legacy inventory is the CSP test's).
// Not an axe run (no browser in CI): lang, viewport, skip link, labelled controls, alt text, no
// positive tabindex, no inline handlers. The axe audit is the designer's step (dossier §12).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const NEW_PAGES = ['dashboards.html', 'dashboard-composer.html'];

for (const f of NEW_PAGES) {
  test(`${f}: accessibility floor`, () => {
    const s = fs.readFileSync(path.join(PUB, f), 'utf8');
    assert.match(s, /<html lang="[a-z]{2}"/, 'lang attribute');
    assert.match(s, /<meta name="viewport"/, 'viewport');
    assert.match(s, /class="edv-skip" href="#main"/, 'skip link'); assert.match(s, /<main id="main"/, 'main landmark');
    for (const m of s.matchAll(/<img\b[^>]*>/g)) assert.match(m[0], /\balt=/, 'img alt: ' + m[0]);
    for (const m of s.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
      const tag = m[0]; const id = /\bid="([^"]+)"/.exec(tag);
      const labelled = /aria-label=/.test(tag) || (id && (new RegExp(`<label[^>]*for="${id[1]}"`).test(s) || new RegExp(`<label[^>]*>[^<]*<${m[1]}[^>]*id="${id[1]}"`).test(s)));
      assert.ok(labelled, 'unlabelled control: ' + tag);
    }
    assert.ok(!/tabindex="[1-9]/.test(s), 'no positive tabindex');
    assert.ok(!/\son[a-z]+="/i.test(s), 'no inline event handler');
    assert.match(s, /role="status"/, 'a live status region');
  });
}
