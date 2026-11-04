'use strict';
// C-10 (G16 / G30) — shared page anatomy: question · scope · time window · freshness, never an invented date.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PH = require('../public/lib/pageHead.js');
const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8').replace(/\r\n/g, '\n');

test('fmtWhen: UTC text, date-only kept date-only, no date is null (never 1970 nor now)', () => {
  assert.equal(PH.fmtWhen('2026-11-03T10:05:00Z'), '03 Nov 2026 10:05 UTC');
  assert.equal(PH.fmtWhen('2026-11-03 10:05:00'), '03 Nov 2026 10:05 UTC');
  assert.equal(PH.fmtWhen('2026-11-03'), '03 Nov 2026');
  assert.equal(PH.fmtWhen('2026-11-03', 'fr'), '03 nov. 2026');
  for (const v of [null, undefined, '', 0, 'garbage', NaN]) assert.equal(PH.fmtWhen(v), null, String(v));
});

test('freshness: per source, a missing date reads "never synced", no source reads "unknown"', () => {
  const f = PH.freshness([{ module: 'requests', last_success: '2026-11-03T10:00:00Z' }, { module: 'survey', last_success: null }]);
  assert.equal(f.text, 'requests 03 Nov 2026 10:00 UTC · survey never synced');
  assert.equal(f.known, false);
  assert.deepEqual(PH.freshness([]), { items: [], text: 'unknown', known: false });
  assert.equal(PH.freshness(undefined, { lang: 'fr' }).text, 'inconnue');
  assert.equal(PH.freshness([{ label: { en: 'Collection', fr: 'Collecte' }, at: 0 }], { lang: 'fr' }).text, 'Collecte jamais synchronisé');
  assert.equal(PH.freshness([{ label: 'X', at: '2026-01-02' }]).known, true);
});

test('render: question, scope, window, freshness and computed-at rows; text escaped', () => {
  const h = PH.render({ question: 'Is <IT> ok?', scope: 'Site A', window: 'Past week',
    sources: [{ label: 'Meraki', at: null }], computedAt: '2026-11-04T08:00:00Z' });
  assert.match(h, /class="edv-page-head"/);
  assert.match(h, /Is &lt;IT&gt; ok\?/);
  assert.match(h, /<dt>Scope<\/dt><dd>Site A<\/dd>/);
  assert.match(h, /<dt>Time window<\/dt><dd>Past week<\/dd>/);
  assert.match(h, /<dt>Data through<\/dt>.*Meraki<\/span> never synced/);
  assert.match(h, /<dt>Computed at<\/dt><dd>04 Nov 2026 08:00 UTC<\/dd>/);
  assert.doesNotMatch(PH.render({ question: 'q', sources: false }), /Data through/, 'a page without figures (list) has no freshness row');
  assert.doesNotMatch(PH.render({ question: 'q' }), /Computed at/, 'no computed row unless the page has one');
  assert.match(PH.render({ question: 'q' }), /<dt>Scope<\/dt><dd>unknown<\/dd>.*<dt>Data through<\/dt><dd><span class="edv-page-head__src is-unknown">unknown/);
  const fr = PH.render({ lang: 'fr', question: { en: 'Q', fr: 'Quelle santé ?' }, scope: { en: 'All', fr: 'Tous' }, sources: [], computedAt: null });
  assert.match(fr, /Quelle santé \?/);
  assert.match(fr, /<dt>Périmètre<\/dt><dd>Tous<\/dd>/);
  assert.match(fr, /<dt>Calculé le<\/dt><dd>inconnue<\/dd>/);
});

test('mount writes into the element and is a no-op without one', () => {
  const el = { innerHTML: '' };
  PH.mount(el, { question: 'q' });
  assert.match(el.innerHTML, /edv-page-head/);
  assert.equal(PH.mount(null, {}), null);
});

// The four pages (wan-health.html is a redirect stub to wan.html#health, which carries the head).
const PAGES = {
  'dashboards.html': /PageHead\.mount\(\$\('pageHead'\)/,
  'analytics.html': /PageHead\.mount\(document\.getElementById\('pageHead'\)/,
  'infra-health.html': /PageHead\.mount\(\$\('pageHead'\)/,
  'wan.html': /PageHead\.mount\(\$\('wh-pagehead'\)/,
};
for (const [page, mountRe] of Object.entries(PAGES)) {
  test(`${page}: loads lib/pageHead.js, has a head container and mounts it`, () => {
    const src = read(page);
    assert.match(src, /<script src="lib\/pageHead\.js"><\/script>/);
    assert.match(src, /<link rel="stylesheet" href="brand\/components\.css">/);
    assert.match(src, /id="(pageHead|wh-pagehead)"/);
    assert.match(src, mountRe);
  });
}
test('wan-health.html still redirects to the WAN Health tab that carries the head', () => {
  assert.match(read('wan-health.html'), /url=wan\.html#health/);
});
test('dashboards.html: the freshness comes from the C-05 response (computed_at + sources[]), not re-derived', () => {
  const src = read('dashboards.html');
  assert.match(src, /sources: d\.sources/);
  assert.match(src, /computedAt: d\.computed_at/);
});
test('components.css styles the shared head', () => {
  assert.match(read('brand/components.css'), /\.edv-page-head\s*\{/);
});
