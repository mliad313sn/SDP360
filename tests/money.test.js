'use strict';
// Task 0 — currency infrastructure. money.js is PURE (no requires).
// Finance surfaces display USD: assets are XOF (converted via xof_usd_rate),
// licence cost is already USD. No currency glyph is ever rendered — USD clarity
// is via a text label, and the digest asserts !html.includes('$').
const test = require('node:test');
const assert = require('node:assert');
const { parseAmount, toUsd, fmtUsd } = require('../services/money');

test('parseAmount handles comma / space / $ thousands separators', () => {
  assert.strictEqual(parseAmount('2,250,000.00'), 2250000);
  assert.strictEqual(parseAmount('55 920.00'), 55920);
  assert.strictEqual(parseAmount('$1,250'), 1250);
});

test('parseAmount keeps zero, rejects empty / null / garbage', () => {
  assert.strictEqual(parseAmount('0.00'), 0);
  assert.strictEqual(parseAmount(''), null);
  assert.strictEqual(parseAmount(null), null);
  assert.strictEqual(parseAmount('abc'), null);
  assert.strictEqual(parseAmount(undefined), null);
});

test('toUsd converts XOF via rate, propagates null, keeps zero', () => {
  assert.ok(Math.abs(toUsd('2,250,000.00', 0.00165) - 3712.5) < 0.01);
  assert.strictEqual(toUsd('', 0.00165), null);
  assert.strictEqual(toUsd('0.00', 0.00165), 0);
  assert.strictEqual(toUsd(null, 0.00165), null);
});

test('fmtUsd — thousands sep, 2dp, NO currency glyph', () => {
  assert.strictEqual(fmtUsd(3712.5), '3,712.50');
  assert.ok(!fmtUsd(3712.5).includes('$'));
  assert.strictEqual(fmtUsd(null), '—');
  assert.strictEqual(fmtUsd(0), '0.00');
});

// ── A-26 — locale-safe parser (behind asset_amount_parser, default legacy) ──────
const fs = require('node:fs');
const path = require('node:path');
const { parseAmountLocale } = require('../services/money');

test('A-26 parseAmountLocale reads every locale shape', () => {
  assert.strictEqual(parseAmountLocale('2 250 000,00'), 2250000);
  assert.strictEqual(parseAmountLocale('1.234,56'), 1234.56);
  assert.strictEqual(parseAmountLocale('1 234,56'), 1234.56);
  assert.strictEqual(parseAmountLocale('1,234.56'), 1234.56);
  assert.strictEqual(parseAmountLocale('12,5'), 12.5);
  assert.strictEqual(parseAmountLocale('1,234'), 1234);
  assert.strictEqual(parseAmountLocale('-1 000,5'), -1000.5);
  assert.strictEqual(parseAmountLocale("1'234.50"), 1234.5);
  assert.strictEqual(parseAmountLocale('$1,250'), 1250);
  assert.strictEqual(parseAmountLocale('0.00'), 0);
  assert.strictEqual(parseAmountLocale('abc'), null);
  assert.strictEqual(parseAmountLocale(''), null);
  assert.strictEqual(parseAmountLocale(null), null);
  assert.strictEqual(parseAmountLocale('1-2'), null);
});

test('A-26 parseAmount without opts stays legacy (today), mode locale dispatches', () => {
  assert.strictEqual(parseAmount('2 250 000,00'), 225000000);
  assert.strictEqual(parseAmount('2 250 000,00', { mode: 'legacy' }), 225000000);
  assert.strictEqual(parseAmount('2 250 000,00', { mode: 'locale' }), 2250000);
});

test('A-26 property: every formatting of n + c/100 parses to that number', () => {
  const group = (n, sep) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  let seed = 42;
  const rnd = (max) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % max; };
  for (let i = 0; i < 500; i++) {
    const n = rnd(2000000000);
    const c = rnd(100);
    const cc = String(c).padStart(2, '0');
    const want = Number(`${n}.${cc}`);
    const shapes = [
      `${group(n, ',')}.${cc}`,              // en-US
      `${group(n, ' ')},${cc}`,              // fr-FR, plain space
      `${group(n, ' ')},${cc}`,         // fr-FR, NBSP
      `${group(n, ' ')},${cc}`,         // fr-FR, narrow NBSP
      `${group(n, '.')},${cc}`,              // de-DE
      `${group(n, "'")}.${cc}`,              // de-CH
      `${n}.${cc}`,
    ];
    for (const s of shapes) {
      const got = parseAmountLocale(s);
      assert.ok(got != null && Math.abs(got - want) < 1e-6, `${JSON.stringify(s)} → ${got}, want ${want}`);
      assert.ok(Math.abs(parseAmountLocale('-' + s) + want) < 1e-6, `negative ${s}`);
    }
  }
});

// Minimal CSV reader (quoted fields) for the committed AP export.
function csvColumn(file, header) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const idx = rows[0].findIndex((h) => h.trim() === header);
  assert.ok(idx >= 0, `column ${header} in ${file}`);
  return rows.slice(1).filter((r) => r.length > idx).map((r) => r[idx]);
}

test('A-26 parity: every purchase_cost of the real AP export parses identically in both modes', () => {
  const vals = csvColumn(path.join(__dirname, 'fixtures', 'assets', 'Assets.csv'), 'Purchase Cost($)');
  assert.ok(vals.length > 2000, `read ${vals.length} values`);
  for (const v of vals) {
    assert.strictEqual(parseAmount(v, { mode: 'locale' }), parseAmount(v), `value ${JSON.stringify(v)}`);
  }
});

test('A-26 toUsd: opts form returns null for an unknown currency; number form unchanged', () => {
  const rates = { XOF: 0.00165, USD: 1 };
  assert.strictEqual(toUsd('2,250,000.00', { currency: 'GBP', rates }), null);
  assert.strictEqual(toUsd('2,250,000.00', { currency: null, rates }), null);
  assert.ok(Math.abs(toUsd('2 250 000,00', { currency: 'XOF', rates, mode: 'locale' }) - 3712.5) < 1e-6);
  assert.strictEqual(toUsd('2,250,000.00', 0.00165), 2250000 * 0.00165);
  assert.strictEqual(toUsd('', { currency: 'XOF', rates }), null);
});
