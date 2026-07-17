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
  // fleet completeness = mean(28.0, 24.5) = 26.3 (1 dp)
  assert.match(out.html, /26\.3/);
  // three worklist counts present
  assert.match(out.html, /\b5\b/);
  assert.match(out.html, /\b12\b/);
  assert.match(out.html, /\b3\b/);
  // freshness line: 7 days + a "synced"/"day" word
  assert.match(out.html, /7/);
  assert.match(out.html, /sync|day/i);
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
