'use strict';
// G-03 (audit 2026-09-24) — the freshness line on public/assets.html.
//
// The register is full-replace-synced nightly at 04:30, so the module never shows the
// edit an asset manager just made in AssetExplorer. The page must SAY so. The label is
// a pure function inside the page so it can be exercised here, the way the weekly
// editor tests exercise reports.html.
//
// Invariant: no synchronisation on record → "jamais synchronisé". Never a date we made up.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { fnSource } = require('./_fn-source');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets.html'), 'utf8').replace(/\r\n/g, '\n');
const label = new Function(`${fnSource(src, '_freshnessLabel')}; return _freshnessLabel;`)();

test('no sync on record → says "jamais synchronisé" and never invents a date', () => {
  for (const input of [null, undefined, {}, { last_sync: null, next_cron: '04:30' }]) {
    const out = label(input);
    assert.match(out, /jamais synchronis/i, `null-ish input must read as never synced: ${JSON.stringify(input)}`);
    assert.ok(!/\d{2}\/\d{2}\/\d{4}/.test(out), 'no fabricated date');
  }
});

test('a stored timestamp is rendered with the next automatic run', () => {
  const out = label({ last_sync: '2026-09-24 03:30:00', next_cron: '04:30' });
  assert.ok(!/jamais/i.test(out), 'not the never-synced branch');
  assert.match(out, /2026/, 'carries the date');
  assert.match(out, /04:30/, 'states when the next automatic sync runs');
});

test('an unparseable timestamp degrades to the raw value, never to a crash', () => {
  const out = label({ last_sync: 'not-a-date', next_cron: '04:30' });
  assert.match(out, /not-a-date/);
});

test('the page carries the banner and asks the route for it', () => {
  assert.ok(src.includes('id="as-freshness"'), 'shared freshness banner element');
  assert.ok(src.includes('/api/assets/sync-status'), 'loads the freshness endpoint');
  // Progress owns the second half of the answer: which snapshot the scores come from.
  assert.ok(/prog-snapDate|dernier instantané/i.test(src), 'Progress states the snapshot it is showing');
});
