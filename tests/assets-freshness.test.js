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

// ── G-04 (audit 2026-09-24) — the Progress board on the page ───────────────────
// Same fix as the digest, on the screen an asset manager actually opens: the fleet size
// next to the score, and "hors classement" instead of a rank for a site too small to
// compare. Extracted as a pure cell renderer so it can be exercised here.
const rankCell = new Function(`${fnSource(src, '_lbRankCell')}; return _lbRankCell;`)();

test('G-04: a ranked site shows its rank', () => {
  assert.strictEqual(String(rankCell({ ranked: true, rank: 3 })), '3');
});

test('G-04: a site under the bar shows "hors classement", never a number', () => {
  const out = String(rankCell({ ranked: false, rank: null, total: 1 }));
  assert.match(out, /hors classement/i);
  const visible = out.replace(/<[^>]*>/g, '');   // the inline style carries digits; the TEXT must not
  assert.ok(!/\d/.test(visible), `no rank digit reaches the reader: ${visible}`);
});

test('G-04: a board built before the flag still shows its ranks', () => {
  assert.strictEqual(String(rankCell({ rank: 2 })), '2', 'absent flag means ranked');
});

test('G-04: the page shows the fleet size and states the threshold', () => {
  assert.ok(/Actifs|actifs/.test(src), 'a fleet-size column exists');
  assert.ok(src.includes('r.total'), 'the renderer reads the fleet size');
  assert.ok(src.includes('min_assets'), 'the threshold reaches the page');
});

// ── G-11 (audit 2026-09-24, owner decision) — the money is admin+ ─────────────
// The routes refuse a viewer now, so the page must not walk one into a tab that will
// 403. The engagement tabs stay: closing the module would cost more than the exposure.
test('G-11: the money tabs are gated on the role, the engagement tabs are not', () => {
  const gate = new Function(`${fnSource(src, '_moneyTabsAllowed')}; return _moneyTabsAllowed;`)();
  assert.strictEqual(gate(() => true), true, 'an admin keeps Finance and Investment');
  assert.strictEqual(gate(() => false), false, 'a viewer does not');
  assert.strictEqual(gate(null), false, 'no role helper at all → assume not allowed');
});

test('G-11: the page hides those tabs rather than letting the click 403', () => {
  assert.ok(src.includes('_moneyTabsAllowed'), 'the gate exists');
  assert.ok(/MONEY_TABS/.test(src), 'and names the tabs it governs');
});
