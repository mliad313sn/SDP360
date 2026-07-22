'use strict';

/**
 * assetHygieneForSite — "which of this site's assets are out of compliance".
 *
 * Extracted from weeklyReportData.js so the site-report page and the monthly
 * report can reuse it instead of growing a third copy of the label fold. The
 * fold is subtle enough that a re-implementation would get it wrong quietly —
 * see the warning on labelsForCode.
 *
 * Two exports, deliberately split:
 *   labelsForCode(...)      PURE — which real `assets.site` labels are this site
 *   sumHygieneByKind(...)   async — the per-kind counts across those labels
 *
 * The caller keeps the orchestration (fetching lookups, deciding what a
 * label-less code means) because the weekly e-mail and the page answer that
 * question with the same rule but at different points in their flow.
 */

/**
 * Which REAL `assets.site` labels belong to this site code.
 *
 * ⚠ Do NOT invert `aliases.ALIAS` to get these. Its KEYS are accent-folded
 * lowercase (`sabodala`, `massawa`) because they exist to be looked up AFTER
 * folding the input — they are not the spellings stored in the database. But
 * `_assetWhere` (assets-db.js) filters with exact `a.site = ?`, so feeding a
 * folded key back as a filter matches ZERO rows against a real `'Sabodala'`,
 * and every site's worklist silently reads empty. An empty worklist looks like
 * a clean site, which is the exact failure this block exists to prevent.
 *
 * So we go the direction the map was designed for: take the ACTUAL distinct
 * labels from the data and fold each one FORWARD through assetLabelToCode.
 *
 * Two label vocabularies are in play and both must match:
 *   • the AP export's mine names — 'Sabodala', 'MASSAWA', 'Houndé'  → via ALIAS
 *   • a site CODE used directly as the label — 'HGO', 'MGO'         → ALIAS has
 *     no 'hgo' key, so these resolve to null and need the direct comparison.
 */
function labelsForCode(siteLabels, siteCode, assetLabelToCode) {
  const code = String(siteCode || '').trim().toUpperCase();
  return (siteLabels || []).filter((label) => {
    if (assetLabelToCode(label) === code) return true;              // mine name
    return String(label || '').trim().toUpperCase() === code;        // literal code
  });
}

/**
 * Sum by_kind across every label folding to this code, then DROP the zeros.
 *
 * The sum has to come from per-label getHygieneSummary calls: the summary's own
 * `by_site` carries only four columns and they are present-counts (inverted
 * gaps), so it has no discovered / ghost / no_asset_tag / lifecycle_exception —
 * folding it would ship a worklist missing half its kinds.
 *
 * Zero-count kinds are dropped entirely. A block of zeros trains the reader to
 * skip the section, which costs us the non-zero weeks too.
 */
async function sumHygieneByKind(assetsDb, labels) {
  const totals = {};
  for (const label of labels) {
    const summary = await assetsDb.getHygieneSummary({ site: label });
    const byKind = (summary && summary.by_kind) || {};
    for (const [kind, n] of Object.entries(byKind)) {
      totals[kind] = (totals[kind] || 0) + (Number(n) || 0);
    }
  }
  const out = {};
  for (const [kind, n] of Object.entries(totals)) if (n > 0) out[kind] = n;
  return out;
}

module.exports = { labelsForCode, sumHygieneByKind };
