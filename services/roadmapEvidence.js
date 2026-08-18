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

// ── Objective 3 — Incidents & gouvernance CAB ──────────────────────────
// Primary KPI = RCA/template conformity of major incidents (auto-derivable):
// what share of MIs carry ALL of Root Cause Analysis / Corrective Action /
// PIR / Lessons Learned. Secondary context = change success rate.
// (The "14 active actions" are the manager's MANUAL deliverables — NOT derived here.)
//
// A UDF field is "filled" if the trimmed value of ANY of its name variants is
// non-empty. The variants mirror public/executive-report.html's classifier —
// the raw udf_json blob may carry a variant key while the canonical
// trailing-space+colon key is blank, so check every variant.
const INCIDENT_UDF_VARIANTS = {
  rca: ['UDF:Root Cause Analysis :', 'UDF:Root Cause Analysis:', 'UDF:Root Cause Analysis', 'UDF:RCA:', 'UDF:RCA', 'Root Cause Analysis', 'RCA'],
  ca:  ['UDF:Corrective action:', 'UDF:Corrective Action:', 'UDF:Corrective action', 'UDF:Corrective Action', 'Corrective Action', 'CA'],
  pir: ['UDF:PIR Required:', 'UDF:PIR Required', 'PIR Required', 'PIR'],
  ll:  ['UDF:Lessons Learned:', 'UDF:Lessons Learned', 'Lessons Learned', 'LL'],
};
const INCIDENT_UDF_FIELDS = ['rca', 'ca', 'pir', 'll'];

// True iff the trimmed value of ANY variant key on mi is non-empty.
function _fieldFilled(mi, variants) {
  if (!mi || !variants) return false;
  for (const k of variants) {
    if (mi[k] != null && String(mi[k]).trim().length) return true;
  }
  return false;
}

// PURE. No I/O. Composes major-incident + change-metric reader outputs.
// Honesty rule: pct is null (never a fabricated 0) when there are 0 MIs — a 0
// would read "0% conform" rather than "nothing in the window to judge".
function incidentsEvidence({ majorIncidents, changeMetrics } = {}) {
  const mis = Array.isArray(majorIncidents) ? majorIncidents : [];
  const total_mi = mis.length;

  const filled = { rca: 0, ca: 0, pir: 0, ll: 0 };
  let allFilledCount = 0;
  for (const mi of mis) {
    let all = true;
    for (const f of INCIDENT_UDF_FIELDS) {
      if (_fieldFilled(mi, INCIDENT_UDF_VARIANTS[f])) filled[f]++;
      else all = false;
    }
    if (all) allFilledCount++;
  }

  const pct = (n) => (total_mi > 0 ? Math.round((100 * n) / total_mi) : null);
  const cm = changeMetrics || null;

  return {
    total_mi,
    conformity_pct: pct(allFilledCount),
    rca_pct: pct(filled.rca),
    ca_pct: pct(filled.ca),
    pir_pct: pct(filled.pir),
    ll_pct: pct(filled.ll),
    change_success_rate: cm && cm.change_success_rate != null ? cm.change_success_rate : null,
    changes_count: cm && cm.total != null ? cm.total : null,
  };
}

// Glue: awaits the two reports-db readers, then the pure compose. Deps
// injectable for tests; defaults to require('../reports-db'). AWAIT the readers
// before the pure call (the pg forks return Promises — the pg-Promise trap).
async function loadIncidentsEvidence(deps = {}) {
  const pick = (name) => deps[name] || (deps.reportsDb || require('../reports-db'))[name];
  const getMajorIncidentsHistory = pick('getMajorIncidentsHistory');
  const getChangeMetrics = pick('getChangeMetrics');

  const majorIncidents = await getMajorIncidentsHistory();
  const changeMetrics = await getChangeMetrics({});

  return incidentsEvidence({ majorIncidents, changeMetrics });
}

module.exports = {
  platformEvidence, loadPlatformEvidence, kindCount, COMPLETENESS_KINDS,
  incidentsEvidence, loadIncidentsEvidence, _fieldFilled, INCIDENT_UDF_VARIANTS,
};
