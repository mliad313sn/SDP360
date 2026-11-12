'use strict';
// F-UX-04 — the reflow allow-list (tests/e2e/fixtures/reflow-known.json) may only shrink, and it names only pages
// and widths the viewport journey actually visits. No entry is a claim of WCAG conformance.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const KNOWN = require('./e2e/fixtures/reflow-known.json').known;
const SPEC = fs.readFileSync(path.join(__dirname, 'e2e', 'v1-viewport-layout.spec.js'), 'utf8');
const CEILING = 6;   // lower this when an entry is fixed; never raise it

test('the allow-list never grows', () => {
  assert.ok(Object.keys(KNOWN).length <= CEILING, `reflow-known.json has ${Object.keys(KNOWN).length} entries, ceiling ${CEILING}`);
});

test('every entry is page@width of the matrix, with a reason', () => {
  const widths = JSON.parse(/const WIDTHS = (\[[^\]]+\])/.exec(SPEC)[1]);
  const pages = /const PAGES = \[([\s\S]*?)\];/.exec(SPEC)[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1));
  assert.ok(widths.includes(320), '320 px (WCAG 1.4.10) is in the matrix');
  for (const p of ['home', 'reports', 'meetings', 'meeting', 'inspection', 'inspections', 'site-awareness', 'field/index']) assert.ok(pages.includes(p), p + ' is in the matrix');
  for (const [k, why] of Object.entries(KNOWN)) {
    const m = /^(.+)@(\d+)$/.exec(k);
    assert.ok(m && pages.includes(m[1]) && widths.includes(Number(m[2])), 'unknown key ' + k);
    assert.ok(typeof why === 'string' && why.length > 10, 'reason for ' + k);
  }
});
