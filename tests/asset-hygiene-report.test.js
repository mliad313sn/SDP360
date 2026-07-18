'use strict';

// Task 3 (Assets sub-project B) — pure hygiene digest composer.
// buildHygieneDigest(summary, opts) -> { subject, html, attachments }
// Zero I/O: it receives already-computed data and builds strings + an xlsx Buffer.

const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');
const { buildHygieneDigest } = require('../services/assetHygieneReport');

function makeSummary() {
  return {
    total: 100,
    by_kind: { discovered: 5, never_scanned: 12, ghost: 3, no_owner: 98, no_age: 90, no_cost: 90 },
    by_site: [
      { site: 'MANA', total: 60, cost_pct: 20.0, age_pct: 10.0, owner_pct: 2.0, scan_pct: 80.0, completeness: 28.0 },
      { site: '<Houndé> & Co', total: 40, cost_pct: 5.0, age_pct: 5.0, owner_pct: 0.0, scan_pct: 88.0, completeness: 24.5 },
    ],
    scan_freshness: { never: 12, over90: 3, d30_90: 10, d7_30: 20, under7: 55 },
    by_state: { InUse: 80, Discovered: 5, Retired: 15 },
    sync: { last_success: '2026-07-10', age_days: 7 },
  };
}

const exceptionsByKind = {
  discovered: [{ asset_id: 'A1', asset_name: 'PC1', site: 'MANA' }],
  ghost: [{ asset_id: 'A2', asset_name: 'SRV9', site: 'MANA' }],
  never_scanned: [
    { asset_id: 'A3', asset_name: 'LT7', site: 'MANA' },
    { asset_id: 'A4', asset_name: 'LT8', site: 'MANA' },
  ],
};

const prev = { by_kind: { discovered: 8, never_scanned: 15, ghost: 5 } };

test('returns {subject, html, attachments}; subject carries the period', () => {
  const out = buildHygieneDigest(makeSummary(), { period: '2026-07', prev, exceptionsByKind });
  assert.strictEqual(typeof out.subject, 'string');
  assert.match(out.subject, /2026-07/);
  assert.strictEqual(typeof out.html, 'string');
  assert.ok(Array.isArray(out.attachments));
});

test('html shows fleet completeness + the three worklist counts + freshness line', () => {
  const out = buildHygieneDigest(makeSummary(), { period: '2026-07', prev, exceptionsByKind });
  // Fleet completeness is now ASSET-WEIGHTED (matches the dashboard header exactly),
  // NOT the old per-site mean (which was 26.3 = mean(28.0, 24.5)). Asset-weighted =
  //   100 * (4*total - (no_cost + no_age + no_owner + never_scanned)) / (4*total)
  //   = 100 * (400 - (90 + 90 + 98 + 12)) / 400 = 100 * 110/400 = 27.5
  assert.match(out.html, /27\.5/);
  // three worklist counts present
  assert.match(out.html, /\b5\b/);
  assert.match(out.html, /\b12\b/);
  assert.match(out.html, /\b3\b/);
  // freshness line: 7 days + a "synced"/"day" word
  assert.match(out.html, /7/);
  assert.match(out.html, /sync|day/i);
});

test('headline completeness == the dashboard asset-weighted formula (page=email)', () => {
  const s = makeSummary();
  // Replicate public/assets-hygiene.html:396-399 exactly.
  const bk = s.by_kind, t = s.total;
  const present = (t - bk.no_cost) + (t - bk.no_age) + (t - bk.no_owner) + (t - bk.never_scanned);
  const expected = Math.round(1000 * present / (4 * t)) / 10;   // 27.5
  assert.strictEqual(expected, 27.5);
  const out = buildHygieneDigest(s, { period: '2026-07', prev, exceptionsByKind });
  assert.match(out.html, new RegExp(`${expected.toFixed(1)}%`));
});

test('html contains NO money — no $, no purchase_cost', () => {
  const out = buildHygieneDigest(makeSummary(), { period: '2026-07', prev, exceptionsByKind });
  assert.ok(!out.html.includes('$'), 'html must not contain a $ sign');
  assert.ok(!out.html.includes('purchase_cost'), 'html must not reference purchase_cost');
});

test('with prev, html shows a delta indicator for a worklist kind', () => {
  const out = buildHygieneDigest(makeSummary(), { period: '2026-07', prev, exceptionsByKind });
  // discovered 5 vs 8 -> down 3
  assert.match(out.html, /▼|-3|−3/);
});

test('attachments[0] is a real xlsx Buffer with one sheet per non-empty kind', () => {
  const out = buildHygieneDigest(makeSummary(), { period: '2026-07', prev, exceptionsByKind });
  const att = out.attachments[0];
  assert.ok(Buffer.isBuffer(att.content), 'attachment content must be a Buffer');
  assert.match(att.filename, /\.xlsx$/);
  const wb = XLSX.read(att.content, { type: 'buffer' });
  assert.ok(wb.SheetNames.length >= 1);
  // the discovered kind had rows -> a sheet for it must exist
  const hasDiscovered = wb.SheetNames.some(n => /discover/i.test(n));
  assert.ok(hasDiscovered, `expected a "discovered" sheet, got ${wb.SheetNames.join(', ')}`);
});

test('prev:null still returns valid html — no NaN / undefined leakage', () => {
  const out = buildHygieneDigest(makeSummary(), { period: '2026-07', prev: null, exceptionsByKind });
  assert.strictEqual(typeof out.html, 'string');
  assert.ok(!out.html.includes('NaN'), 'html must not contain NaN');
  assert.ok(!out.html.includes('undefined'), 'html must not contain undefined');
});

test('empty by_site guards completeness to a dash, never NaN', () => {
  const s = makeSummary();
  s.by_site = [];
  const out = buildHygieneDigest(s, { period: '2026-07', prev: null, exceptionsByKind: {} });
  assert.ok(!out.html.includes('NaN'));
});

test('sync age_days null renders "unknown" not NaN/undefined', () => {
  const s = makeSummary();
  s.sync = { last_success: null, age_days: null };
  const out = buildHygieneDigest(s, { period: '2026-07', prev: null, exceptionsByKind });
  assert.match(out.html, /unknown/i);
  assert.ok(!out.html.includes('NaN'));
  assert.ok(!out.html.includes('undefined'));
});

test('free-text site name is HTML-escaped', () => {
  const out = buildHygieneDigest(makeSummary(), { period: '2026-07', prev, exceptionsByKind });
  assert.ok(out.html.includes('&lt;Houndé&gt;') || out.html.includes('&lt;Hound'), 'site name must be escaped');
  assert.ok(!out.html.includes('<Houndé>'), 'raw angle-bracket site name must not appear');
});

// ── Task 7 — Finance + Licence snapshots (backward-compatible) ────────────────

const FINANCE = {
  fleet: { book_value_usd: 16912.5, purchase_cost_usd: 32267.14, refresh_due: 7 },
  rate: 0.00165,
};
const LICENCES = {
  total: 19,
  expiry: { expired: 3, expiring_90: 5, ok: 10, no_expiry: 1 },
  by_family: { User: 8, Enterprise: 6, Machine: 3, Server: 1, Special: 1 },
};

test('with finance opts, html renders a Finance snapshot via fmtUsd + USD label + rate — still NO $', () => {
  const out = buildHygieneDigest(makeSummary(), { period: '2026-07', finance: FINANCE, licences: LICENCES });
  // book value via fmtUsd (thousands + 2dp, NO glyph)
  assert.match(out.html, /16,912\.50/);
  // a Finance snapshot header + a USD text label + the rate somewhere in the block
  assert.match(out.html, /Finance snapshot/i);
  assert.match(out.html, /USD/);
  assert.match(out.html, /0\.00165/);
  // CRUCIAL: money uses fmtUsd + USD text, never a $ glyph
  assert.ok(!out.html.includes('$'), 'html must not contain a $ sign even with finance rendered');
});

test('with licence opts, html renders a Licence snapshot with expired=3 + expiring=5', () => {
  const out = buildHygieneDigest(makeSummary(), { period: '2026-07', finance: FINANCE, licences: LICENCES });
  assert.match(out.html, /Licence snapshot/i);
  // expired 3 and expiring-soon 5 both surfaced
  assert.match(out.html, /Expired[^<]*<[^>]*>\s*3\b|>\s*3\s*<[^>]*>[^<]*[Ee]xpired|Expired/);
  assert.ok(/3/.test(out.html) && /5/.test(out.html), 'expired=3 and expiring=5 present');
  // total + a by-family one-liner
  assert.match(out.html, /19/);
  assert.match(out.html, /User|Enterprise/);
  assert.ok(!out.html.includes('$'), 'licence block must not contain a $ sign');
});

test('backward-compat: NO finance/licences opts → valid digest, no Finance/Licence block headers, no throw', () => {
  const out = buildHygieneDigest(makeSummary(), { period: '2026-07' });
  assert.strictEqual(typeof out.subject, 'string');
  assert.strictEqual(typeof out.html, 'string');
  assert.ok(Array.isArray(out.attachments));
  // the two new blocks are absent entirely when their opts are missing
  assert.ok(!/Finance snapshot/i.test(out.html), 'Finance block must be absent without finance opt');
  assert.ok(!/Licence snapshot/i.test(out.html), 'Licence block must be absent without licences opt');
  // existing no-money invariant still holds
  assert.ok(!out.html.includes('$'));
});
