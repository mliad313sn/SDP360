'use strict';
// Roadmap Manager Phase 2 — live AUTO evidence for Objective 2 (Plateforme ITSM & actifs).
// PURE composer + a deps-injectable glue. Composes THREE existing assets-db readers:
//   • getHygieneSummary()      → CMDB completeness (mean over the 4 completeness gaps)
//   • getAssetSummary().total  → SDP asset total
//   • getAssetCountsByType()   → asset-class coverage (product_type distribution)
// Discovery-coverage is computed in the PAGE from the reconcile route — NOT here.
//
// Honesty rule (hard-won): when data is absent, return null — never a fabricated 0/100.
// So hygiene.total === 0 → cmdb_completeness_pct === null (not 0). A 0 would read as
// "0% complete" — the opposite of "we have nothing to judge".

// The four CMDB-completeness attributes. Each is a GAP present-count from
// getHygieneSummary().by_kind; completeness for an attribute = 1 − gap/total.
const COMPLETENESS_KINDS = ['no_owner', 'no_age', 'no_cost', 'never_scanned'];

// Read one gap count from by_kind, defaulting to 0 (a missing kind means no measured
// gap → that attribute reads 100% complete). Tolerates BOTH shapes: the real
// getHygieneSummary().by_kind is an OBJECT { kind: count }, but a caller (or a test)
// may hand the array [{ kind, n }] shape — support both, never assume.
function kindCount(by_kind, kind) {
  if (!by_kind) return 0;
  if (Array.isArray(by_kind)) {
    const r = by_kind.find((x) => x && x.kind === kind);
    return r ? (Number(r.n) || 0) : 0;
  }
  const v = by_kind[kind];
  return v == null ? 0 : (Number(v) || 0);
}

// PURE. No I/O. Composes the three reader outputs into the evidence object.
function platformEvidence({ hygiene, sdpTotal, byType } = {}) {
  hygiene = hygiene || {};
  byType = Array.isArray(byType) ? byType : [];
  const total = Number(hygiene.total) || 0;

  let cmdb_completeness_pct = null;               // null, NOT 0, when there is no data
  if (total > 0) {
    const rates = COMPLETENESS_KINDS.map((k) => 1 - kindCount(hygiene.by_kind, k) / total);
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    cmdb_completeness_pct = Math.round(100 * mean);
  }

  return {
    cmdb_completeness_pct,
    sdp_total: Number(sdpTotal) || 0,
    asset_class_count: byType.length,
    asset_classes: byType,
  };
}

// Glue: awaits the three readers, then the pure compose. Deps injectable for tests;
// defaults to require('../assets-db') — required LAZILY, and only when a reader is
// missing, so a fully-stubbed call never touches the DB. AWAIT the readers before the
// pure call (the pg forks return Promises — the pg-Promise trap).
async function loadPlatformEvidence(deps = {}) {
  const pick = (name) => deps[name] || (deps.assetsDb || require('../assets-db'))[name];
  const getHygieneSummary = pick('getHygieneSummary');
  const getAssetSummary = pick('getAssetSummary');
  const getAssetCountsByType = pick('getAssetCountsByType');

  const hygiene = await getHygieneSummary({});
  const summary = await getAssetSummary();
  const byType = await getAssetCountsByType();

  return platformEvidence({ hygiene, sdpTotal: summary ? summary.total : 0, byType });
}

module.exports = { platformEvidence, loadPlatformEvidence, kindCount, COMPLETENESS_KINDS };
