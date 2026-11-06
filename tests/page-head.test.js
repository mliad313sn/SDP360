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

// E-U03 — rollout on six non-hot pages (wan-sla.html redirects to the SLA tab of wan.html, which mounts its own head).
const ROLLOUT = {
  'home.html': { src: ['home.html', 'lib/home-page.js'], el: 'pageHead', mount: /PageHead\.mount\(\$\('pageHead'\)/ },
  'site-actions.html': { src: ['site-actions.html'], el: 'pageHead', mount: /PageHead\.mount\(document\.getElementById\('pageHead'\)/ },
  'wan-sla (wan.html#sla)': { src: ['wan.html'], el: 'sl-pagehead', mount: /PageHead\.mount\(\$\('sl-pagehead'\)/ },
  'assets.html': { src: ['assets.html'], el: 'pageHead', mount: /PageHead\.mount\(document\.getElementById\('pageHead'\)/ },
  'meetings.html': { src: ['meetings.html'], el: 'pageHead', mount: /PageHead\.mount\(document\.getElementById\('pageHead'\)/ },
  'inspections.html': { src: ['inspections.html'], el: 'pageHead', mount: /PageHead\.mount\(document\.getElementById\('pageHead'\)/ },
};
function mountCall(src, mountRe) {
  const m = mountRe.exec(src);
  assert.ok(m, 'mount call found');
  return src.slice(m.index, m.index + 2500);
}
for (const [page, c] of Object.entries(ROLLOUT)) {
  test(`E-U03 ${page}: loads pageHead.js, has #${c.el}, mounts with a non-empty question and scope, no browser clock`, () => {
    const html = read(c.src[0]);
    const all = c.src.map(read).join('\n');
    assert.match(html, /src="lib\/pageHead\.js"><\/script>/);
    assert.match(html, /<link rel="stylesheet" href="brand\/components\.css">/);
    assert.match(html, new RegExp('id="' + c.el + '"'));
    const call = mountCall(all, c.mount);
    assert.match(call, /question: \{ en: '(?:[^'\\]|\\.){10,}', fr: '(?:[^'\\]|\\.){10,}' \}/, 'bilingual, non-empty question');
    assert.match(call, /scope: /);
    assert.match(call, /sources: /);
    assert.doesNotMatch(call.slice(0, call.indexOf('sources:') + 400), /new Date\(\)|Date\.now\(\)/, 'freshness never taken from the browser clock');
  });
}
test('E-U03 wan-sla.html still redirects to the SLA tab that carries the head', () => {
  assert.match(read('wan-sla.html'), /url=wan\.html#sla/);
});
test('E-U03 unknown freshness says so: live-record pages pass no source and the head reads "unknown"', () => {
  for (const f of ['site-actions.html', 'meetings.html', 'inspections.html']) {
    const call = mountCall(read(f), /PageHead\.mount\(document\.getElementById\('pageHead'\)/);
    assert.match(call, /sources: \[\],/, f + ' passes no invented source');
  }
  assert.match(PH.render({ question: 'q', scope: 's', sources: [] }), /<dt>Data through<\/dt><dd><span class="edv-page-head__src is-unknown">unknown/);
  assert.match(PH.render({ question: 'q', scope: 's', sources: [{ label: 'AssetExplorer sync', at: null }] }), /AssetExplorer sync<\/span> never synced/);
});
test('E-U03 module tabs and the shell mount are untouched on the rollout pages', () => {
  for (const f of ['site-actions.html', 'meetings.html', 'inspections.html']) {
    const s = read(f);
    assert.match(s, /<div id="__moduletabs" data-module="[a-z_]+"/);
    assert.match(s, /<div id="__shell"/);
    assert.ok(s.indexOf('id="__moduletabs"') < s.indexOf('id="pageHead"'), f + ': head sits below the module tabs');
  }
  assert.match(read('home.html'), /<div id="__shell" data-section="home"/);
});
