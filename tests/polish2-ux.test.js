'use strict';
// VISUAL POLISH 2 (2026-11) — UX committee findings that a static check can hold: the field app on a phone
// (field seat F1–F25), one language at a time on the inspection form (F16), the action registers as cards (F3).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

test('oneLanguage: a doubled label is split into its two halves, data-like texts are left alone', () => {
  const O = require('../public/lib/oneLanguage.js');
  assert.deepStrictEqual(O.split('Cancel · Annuler'), ['Cancel', 'Annuler']);
  assert.deepStrictEqual(O.split('✓ Submit Inspection · Soumettre'), ['✓ Submit Inspection', '✓ Soumettre']);
  assert.deepStrictEqual(O.split('— Select / Sélectionner —'), ['— Select —', '— Sélectionner —']);
  assert.deepStrictEqual(O.split('Hoist / Headframe / Treuil / Chevalement'), ['Hoist / Headframe', 'Treuil / Chevalement']);
  assert.strictEqual(O.split('0 / 0'), null, 'a counter is not a translation pair');
  assert.strictEqual(O.split('N/A'), null);
  assert.strictEqual(O.split('Mine Operations Centre / Dispatch'), null, 'listed as not a pair');
  assert.strictEqual(O.pick('Area / Zone', 'fr'), 'Zone');
});

test('oneLanguage: an option without a value keeps its original text as the stored value; datalists are never touched', () => {
  const src = read('public/lib/oneLanguage.js');
  assert.match(src, /if \(el\.tagName === 'OPTION' && !el\.hasAttribute\('value'\)\) el\.setAttribute\('value', cur\.trim\(\)\)/);
  assert.match(src, /parentNode\.tagName === 'DATALIST'\) return/);
  assert.match(read('public/inspection.html'), /<script nonce="%%CSP_NONCE%%" src="lib\/oneLanguage\.js" data-auto><\/script>/);
});

test('field app: status buttons are a 5-column grid under the label, coloured by severity when pressed', () => {
  const css = read('public/field/styles.css');
  assert.match(css, /\.seg \{ display:grid; grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /\.checklist \.ci \{ display:block/);
  for (const st of ['ok', 'minor', 'major', 'critical', 'na']) assert.match(css, new RegExp('\\.seg button\\[data-st="' + st + '"\\]\\[aria-pressed="true"\\] \\{ background:var\\(--'), st);
  assert.match(css, /main \{[^}]*overflow-x:clip/);
});

test('field app: no inline style, styled sheets instead of browser dialogs, safe-area bottom bar, toast above the bar', () => {
  const html = read('public/field/index.html'), app = read('public/field/app.js'), css = read('public/field/styles.css');
  assert.doesNotMatch(html, /\sstyle="/, 'index.html carries no inline style (CSP style-src)');
  assert.doesNotMatch(app, /style="/, 'app.js writes no inline style');
  assert.doesNotMatch(app, /window\.confirm\(|[^.\w]confirm\(|alert\(/, 'no browser confirm/alert');
  assert.match(css, /dialog::backdrop/); assert.match(css, /nav\.tabs \{[^}]*padding-bottom:var\(--safe-b\)/);
  assert.match(css, /#msg \{ position:fixed;[^}]*bottom:calc\(var\(--nav-h\)/);
  assert.strictEqual((html.match(/<nav class="tabs"[\s\S]*?<\/nav>/)[0].match(/<svg class="ic"/g) || []).length, 5, 'an icon on each of the 5 tabs');
});

test('field app: French lookups, human dates, the entry id kept but secondary, measured zero vs unknown', () => {
  const app = read('public/field/app.js');
  assert.match(app, /L2\(a\.name_en, a\.name_fr\)/); assert.match(app, /L2\(it\.l, it\.fr\)/);
  assert.match(app, /SF\.dateTime\(iso, \{ lang: LANG\(\) \}\)/, 'dates through SDPFormat');
  assert.match(app, /<details class="ob-d">[\s\S]{0,200}esc\(e\.uuid\) \+ ' · ' \+ esc\(e\.client_ts\)/, 'uuid and exact timestamp stay available');
  assert.match(app, /var measured = w\.value != null, v = measured \? \(w\.display \|\| w\.value\) : '—'/, 'null = — , a measured 0 stays 0');
  assert.match(app, /w\.unit !== 'count'/); assert.match(app, /rag === 'GREEN' \|\| rag === 'AMBER' \|\| rag === 'RED'/);
  const sw = read('public/field/sw.js');
  assert.match(sw, /'\/lib\/codeLabels\.js', '\/lib\/format\.js'/, 'the two libraries are in the offline shell');
});

test('action registers: below 720 px a row is a card and the list comes before the charts', () => {
  for (const f of ['public/inspection-actions.html', 'public/meetings-actions.html']) {
    const h = read(f);
    assert.match(h, /@media \(max-width: 720px\) \{[\s\S]*?\.mi-table-head \{ display: none; \}[\s\S]*?grid-template-areas:/, f);
    assert.match(h, /\.mi-wrap > \.mi-charts \{ order: 9; \}/, f);
  }
});
