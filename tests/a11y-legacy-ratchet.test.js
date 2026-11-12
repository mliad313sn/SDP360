'use strict';
// F-UX-10 — the static accessibility floor on ALL pages, pinned per page and per rule: a count may only go down.
// Baseline: tests/fixtures/a11y-legacy-baseline.json · table: docs/ux/A11Y-LEGACY.md (tools/agent/a11y-legacy.js).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const A = require('../tools/agent/a11y-legacy');

const BASE = JSON.parse(fs.readFileSync(A.BASELINE, 'utf8')).pages;
const NOW = A.scan();

test('no page gets worse on any rule (lang, viewport, skip link, main, labels, alt, tabindex, inline handlers, status region)', () => {
  const worse = [];
  for (const [f, c] of Object.entries(NOW)) {
    const b = BASE[f];
    if (!b) { const t = A.RULES.filter((r) => c[r] > 0); if (t.length) worse.push(`${f} (new page): ${t.map((r) => r + '=' + c[r]).join(', ')}`); continue; }
    for (const r of A.RULES) if (c[r] > b[r]) worse.push(`${f}: ${r} ${b[r]} → ${c[r]}`);
  }
  assert.deepStrictEqual(worse, [], 'accessibility regressions (fix them; a new page must start at zero)');
});

test('the baseline covers every page (legacy and new) and the doc is generated from it', () => {
  assert.ok(Object.keys(BASE).length >= 55, 'pages in the baseline: ' + Object.keys(BASE).length);
  assert.ok(BASE['index.html'] && BASE['reports.html'] && BASE['executive.html'] && BASE['field/index.html']);
  assert.strictEqual(fs.readFileSync(A.DOC, 'utf8'), A.renderDoc(BASE), 'docs/ux/A11Y-LEGACY.md — run node tools/agent/a11y-legacy.js --write');
});

test('the checker counts what it says (unit)', () => {
  const c = A.check('<html><body><input id="a"><label for="b">x</label><input id="b"><img src="x"><div onclick="f()" tabindex="2"></div></body></html>');
  assert.deepStrictEqual(c, { lang: 1, viewport: 1, skip_link: 1, main: 1, unlabelled_control: 1, img_no_alt: 1, positive_tabindex: 1, inline_handler: 1, status_region: 1 });
  const ok = A.check('<html lang="fr"><meta name="viewport"><a class="edv-skip" href="#main">s</a><main id="main"><input aria-label="q"><img alt=""></main><div role="status"></div>');
  assert.ok(A.RULES.every((r) => ok[r] === 0));
});
