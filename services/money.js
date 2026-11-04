'use strict';
// Task 0 — currency infrastructure for the Assets Licence/Finance delivery.
// PURE module (no requires). Finance surfaces display USD:
//   - asset purchase_cost is XOF raw TEXT  -> toUsd(raw, xof_usd_rate)
//   - software_licenses cost is already USD -> parseAmount / fmtUsd directly
// fmtUsd renders NO currency glyph — USD clarity is via a text label, and the
// digest asserts !html.includes('$').

// Parse a raw money string (comma / space / $ thousands separators) to a Number.
// '0.00' -> 0 (zero kept); '' / null / undefined / non-numeric -> null.
// A-26: opts.mode === 'locale' dispatches to parseAmountLocale (switch
// asset_amount_parser); anything else is the legacy path, byte-for-byte unchanged.
function parseAmount(raw, opts) {
  if (opts && opts.mode === 'locale') return parseAmountLocale(raw);
  if (raw == null) return null;
  const s = String(raw).replace(/[$,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// A-26 — locale-safe amount parser (PROPOSED, behind asset_amount_parser='locale').
// Rule: "$", spaces (incl. U+00A0 / U+202F) and apostrophes are thousands/currency
// noise; the LAST "." or "," followed by 1 or 2 digits and nothing else is the
// decimal mark, every other separator is a thousands mark (so "1,234" stays 1234,
// "12,5" is 12.5, "2 250 000,00" is 2250000). A leading "-" is allowed; anything
// else that is not digits/separators → null. '' / null → null.
function parseAmountLocale(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[$\s\u00A0\u202F'\u2019]/g, '');
  if (s === '') return null;
  let sign = 1;
  if (s[0] === '-') { sign = -1; s = s.slice(1); }
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null;
  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  let num;
  if (last >= 0 && /^[0-9]{1,2}$/.test(s.slice(last + 1))) {
    num = s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1);
  } else {
    num = s.replace(/[.,]/g, '');
  }
  const n = Number(num);
  return Number.isFinite(n) ? sign * n : null;
}

// Convert a raw XOF money string to USD via rate. null propagates; 0 stays 0.
// A-26: the second argument may instead be {currency, rates, mode} — the rate is
// rates[currency]; an unknown currency or a missing/zero rate gives null (never
// converted at the XOF rate). The number form is unchanged.
function toUsd(rawXof, rate) {
  if (rate && typeof rate === 'object') {
    const r = rate.rates && rate.currency ? Number(rate.rates[rate.currency]) : NaN;
    if (!(r > 0)) return null;
    const v = parseAmount(rawXof, { mode: rate.mode });
    return v == null ? null : v * r;
  }
  const n = parseAmount(rawXof);
  return n == null ? null : n * rate;
}

// Format a USD number with thousands separators + 2dp, no currency glyph.
// null / non-finite -> '—'.
function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = { parseAmount, parseAmountLocale, toUsd, fmtUsd };
