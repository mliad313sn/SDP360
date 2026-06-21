'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Shared PPTX helpers — single source of truth for the small, pure RAG/trend
// functions that were previously duplicated **verbatim** across
// reports-weekly-pptx.js and reports-monthly-pptx.js.
//
// Only functions that are byte-for-byte (or whitespace/comment-only)
// IDENTICAL between the two files live here. Functions that have legitimately
// diverged between the two decks (addTitle, addSectionBadge, the `C` palette,
// every slideMonthly* renderer, …) are intentionally LEFT in their own files
// because the weekly and monthly decks render them differently — see
// CLAUDE.md § "slideMonthly* duplication".
//
// Pure functions, no DB / pptxgenjs / file-local state. Covered by
// tests/pptx-shared-helpers.test.js (unit) and locked end-to-end by the
// golden fingerprint in tests/pptx-monthly-golden.test.js.
// ─────────────────────────────────────────────────────────────────────────

/** RAG word ('green'|'orange'|'red') → hex. Unknown → neutral grey. */
function statusColor(color) {
  switch ((color || '').toLowerCase()) {
    case 'green':  return '2D9C4A';
    case 'orange': return 'E87722';
    case 'red':    return 'D0312D';
    default:       return 'AAAAAA';
  }
}

/** Trend word → glyph used in the infra tables. */
function trendArrow(trend) {
  switch ((trend || '').toLowerCase()) {
    case 'up':        return '▲';
    case 'down':      return '▼';
    case 'stable':    return '→';
    case 'no_change': return 'No change';
    default:          return '—';
  }
}

/** Trend word → hex (up = green, down = red, else grey). */
function trendColor(trend) {
  switch ((trend || '').toLowerCase()) {
    case 'up':   return '2D9C4A';
    case 'down': return 'D0312D';
    default:     return '666666';
  }
}

/**
 * Auto-compute trend direction by comparing current vs previous week's numeric
 * value. Matched by service name (case-insensitive, trimmed). Non-numeric
 * values keep their stored trend. Returns a new array of KPI objects.
 */
function computeTrends(currentKpis, prevKpis) {
  if (!currentKpis || !currentKpis.length) return currentKpis || [];
  if (!prevKpis    || !prevKpis.length)    return currentKpis;
  const prevMap = {};
  prevKpis.forEach(k => { prevMap[(k.service || '').trim().toLowerCase()] = k.status_value; });
  return currentKpis.map(k => {
    const key     = (k.service || '').trim().toLowerCase();
    const curRaw  = String(k.status_value || '').replace('%', '').replace(',', '.').trim();
    const prevRaw = String(prevMap[key]  || '').replace('%', '').replace(',', '.').trim();
    const curVal  = parseFloat(curRaw);
    const prevVal = parseFloat(prevRaw);
    if (!isNaN(curVal) && !isNaN(prevVal)) {
      const trend = curVal > prevVal ? 'up' : curVal < prevVal ? 'down' : 'stable';
      return { ...k, trend };
    }
    return k; // non-numeric: keep stored trend
  });
}

/**
 * Auto-derive status cell color by comparing numeric status_value to target.
 * Renders all sites consistently regardless of the manually-selected
 * status_color in the form.
 *   ≥ target        → green  (#2D9C4A)
 *   ≥ target × 0.90 → orange (#E87722)
 *   < target × 0.90 → red    (#D0312D)
 * Falls back to the stored status_color when numeric comparison isn't possible.
 * Returns { color: hex, hasColor: bool }.
 */
function autoStatusColor(statusValue, target, storedColor) {
  const val = parseFloat(String(statusValue || '').replace('%', '').trim());
  const tgt = parseFloat(String(target || '').replace('%', '').trim());
  if (!isNaN(val) && !isNaN(tgt) && tgt > 0) {
    if (val >= tgt)        return { color: '2D9C4A', hasColor: true };
    if (val >= tgt * 0.90) return { color: 'E87722', hasColor: true };
    return                        { color: 'D0312D', hasColor: true };
  }
  const sc = statusColor(storedColor);
  const hasColor = !!(storedColor && storedColor !== 'none');
  return { color: sc, hasColor };
}

module.exports = { statusColor, trendArrow, trendColor, computeTrends, autoStatusColor };
