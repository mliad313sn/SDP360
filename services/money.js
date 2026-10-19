'use strict';
// Task 0 — currency infrastructure for the Assets Licence/Finance delivery.
// PURE module (no requires). Finance surfaces display USD:
//   - asset purchase_cost is XOF raw TEXT  -> toUsd(raw, xof_usd_rate)
//   - software_licenses cost is already USD -> parseAmount / fmtUsd directly
// fmtUsd renders NO currency glyph — USD clarity is via a text label, and the
// digest asserts !html.includes('$').

// Parse a raw money string (comma / space / $ thousands separators) to a Number.
// '0.00' -> 0 (zero kept); '' / null / undefined / non-numeric -> null.
function parseAmount(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[$,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Convert a raw XOF money string to USD via rate. null propagates; 0 stays 0.
function toUsd(rawXof, rate) {
  const n = parseAmount(rawXof);
  return n == null ? null : n * rate;
}

// Format a USD number with thousands separators + 2dp, no currency glyph.
// null / non-finite -> '—'.
function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = { parseAmount, toUsd, fmtUsd };
