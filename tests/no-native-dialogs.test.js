'use strict';
// Committee field review 2026-10-28 (P1-5): window.prompt / confirm are suppressed in some embedded
// browsers (Teams webview, Android in-app browsers) — the action then silently does nothing — and on a
// tablet they cannot show the minimum reason length. The governance pages use public/lib/reasonDialog.js.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const PAGES = ['policies.html', 'handoffs.html', 'cockpit.html', 'dashboard-composer.html', 'tracker-builder.html', 'commitments.html'];

for (const p of PAGES) {
  test(`${p}: no native prompt/confirm; loads the inline dialog`, () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8').replace(/\r\n/g, '\n');
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/(^|[^.\w])(window\.)?(prompt|confirm)\s*\(/.test(code), 'uses window.prompt / confirm');
    assert.ok(src.includes('src="lib/reasonDialog.js"'), 'loads lib/reasonDialog.js');
  });
}

test('cockpit: every select option carries an explicit value (the French layer translates the text only)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'cockpit.html'), 'utf8');
  assert.ok(!/<option>/.test(src) && !/"<option"\s*\+\s*\(/.test(src), 'an <option> without value would send translated text to the server');
});
