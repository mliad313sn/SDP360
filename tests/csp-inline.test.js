'use strict';
// Step 4 (SDP-DASH-2.0) — no inline script on new pages, and the legacy count only goes down.
//   · a page that is NOT in the baseline (tests/__golden__/inline-scripts.json) must carry no inline
//     <script>, no on*="" handler, no javascript: URL — and be served with the strict CSP;
//   · a page in the baseline may not GAIN inline items (lower its entry when you remove some).
const fs = require('fs'), path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');
const { inventory, STRICT_PAGES, strictHeader } = require('../services/cspPolicy');

const PUB = path.join(__dirname, '..', 'public');
const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '__golden__', 'inline-scripts.json'), 'utf8'));
const pages = fs.readdirSync(PUB).filter(f => f.endsWith('.html'));

test('inventory counts blocks, handlers and javascript: URLs, ignores src= and templates', () => {
  const i = inventory(`<script src="a.js"></script><script>x()</script><script type="text/html"><b>t</b></script>
    <button onclick="go()">x</button><a href="javascript:void(0)">y</a><!-- <script>z</script> -->`);
  assert.deepEqual(i, { blocks: 1, handlers: 1, jsUrls: 1, total: 3 });
});

test('pages outside the legacy baseline have no inline script and are served strict', () => {
  const bad = [];
  for (const f of pages) {
    if (BASE[f] != null) continue;
    const i = inventory(fs.readFileSync(path.join(PUB, f), 'utf8'));
    if (i.total) bad.push(`${f}: ${JSON.stringify(i)}`);
  }
  assert.deepEqual(bad, [], 'new pages must be written without inline script');
  for (const p of STRICT_PAGES) assert.ok(pages.includes(p.slice(1)), `${p} exists`);
});

test('legacy pages may only lose inline items (ratchet)', () => {
  const grew = [];
  for (const [f, n] of Object.entries(BASE)) {
    if (!pages.includes(f)) continue;
    const now = inventory(fs.readFileSync(path.join(PUB, f), 'utf8')).total;
    if (now > n) grew.push(`${f}: ${n} → ${now}`);
  }
  assert.deepEqual(grew, [], 'inline scripts added to a legacy page — move them to a .js file');
});

test('the strict policy forbids inline script', () => {
  const h = strictHeader('abc');
  const scriptSrc = h.split('; ').find(d => d.startsWith('script-src '));
  assert.ok(!/unsafe-inline|unsafe-eval/.test(scriptSrc));
  assert.match(h, /script-src-attr 'none'/);
  assert.match(scriptSrc, /'nonce-abc'/);
});
