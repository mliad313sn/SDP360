'use strict';
// B-08 — minimal benefit record on a portfolio project (catalogue rule A09 "benefit review date reached").
// PURE: no DB, no clock — the caller passes `asOf`. The store (services/governanceStore) persists the rows
// (db/postgres/reports/056_portfolio_benefits.sql); the routes (routes/governance.js) decide who may write.
//   • expected benefit: description (+ optional measure, unit, baseline value, target value), owner, review date;
//   • realised value: entered with an evidence link (http/https only), then VERIFIED by a different person
//     (the person who entered the realised value can never verify it — SELF_REVIEW, as the A-25 contract review);
//   • value_kind 'money' marks values that are amounts: they follow the portfolio money-read rule (committee,
//     admin tier, finance-viewer) and are removed for everyone else — the description, dates and state stay.
// A benefit is "review due" from its review date until it is verified. Nothing is sent: the reminder is a line
// in the Site obligations view and a block on "My work" (no outbound notice).
const VALUE_KINDS = ['quantity', 'money'];
const VALUE_FIELDS = ['baseline_value', 'target_value', 'realised_value'];
const day = (v) => (v ? String(v).slice(0, 10) : null);

/** planned | review_due | awaiting_verification | verified. */
function benefitState(b, asOf) {
  if (!b) return null;
  if (b.verified_at) return 'verified';
  if (b.realised_value != null) return 'awaiting_verification';
  if (b.review_date && day(asOf) && day(b.review_date) <= day(asOf)) return 'review_due';
  return 'planned';
}
/** The review date is reached and the benefit is not verified yet (missing value OR value not verified). */
function isReviewDue(b, asOf) {
  return !!(b && b.review_date && !b.verified_at && day(asOf) && day(b.review_date) <= day(asOf));
}
/** One benefit as a reader sees it: money values removed unless the reader may see money. */
function visibleBenefit(b, { money = false, asOf = null, classes = false } = {}) {
  const out = { ...b, state: benefitState(b, asOf), review_due: isReviewDue(b, asOf) };
  if (classes) Object.assign(out, classView(b));
  if (b.value_kind === 'money' && !money) { for (const f of VALUE_FIELDS) out[f] = undefined; out.values_hidden = true; }
  return out;
}
/** Evidence of a realised value: an http(s) link only (never javascript:, data:, a bare path). */
function evidenceLinkOk(s) {
  const v = s == null ? '' : String(s).trim();
  return v.length > 0 && v.length <= 1000 && /^https?:\/\/[^\s<>"']+$/i.test(v);
}
/**
 * Obligation lines (register 'benefit_review') for the benefits whose review date is reached and that are
 * not verified. Rows carry project_id, project_key, project_name, description, owner, review_date,
 * realised_value, verified_at. Values themselves never go into the line (no money in the feed).
 */
function reviewItems(rows, asOf) {
  return (rows || []).filter((b) => isReviewDue(b, asOf)).map((b) => ({
    register: 'benefit_review', id: Number(b.id), ref: b.project_key || null,
    title: 'Benefit review: ' + String(b.description || '').slice(0, 200) + (b.project_name ? ' (' + b.project_name + ')' : ''),
    owner: b.owner || null, due_date: day(b.review_date), status: b.realised_value == null ? 'missing' : 'awaiting_verification',
    overdue: day(b.review_date) < day(asOf), link: `project.html?id=${Number(b.project_id)}#benefits`, project_id: Number(b.project_id),
  }));
}


// ── F-PRODUCT-03 + F-DATA-09 — value class, measurement basis and window (report_config benefit_value_class_enabled) ──
// A realised amount, an estimated avoidance and a validated benefit are three different statements:
//   value_class        what kind of benefit it is (NULL = unclassified — there is NO default class);
//   basis              'observed' (measured) or 'estimated_avoidance' (a cost that did not happen — an ESTIMATE);
//   evidence_level     planned (no realised value) | entered (a value with evidence) | verified (four-eyes);
//   measurement_class  null (no basis) | 'estimated' (an estimate stays an estimate, verified or not) |
//                      'observed' | 'validated' (observed AND verified by an INDEPENDENT verifier AND an evidence link).
// "validated" is DERIVED from the acts of people (a verification by the holder of the required role); no code path
// sets it. Totals are computed per (measurement class, value class, kind, currency / unit) and NEVER across them.
const VALUE_CLASSES = ['realised_cash', 'cost_avoidance_estimate', 'productivity_time', 'risk_reduction', 'other'];
const BASES = ['observed', 'estimated_avoidance'];
const SOURCE_KINDS = ['manual', 'metric'];
const CLASS_FIELDS = ['value_class', 'basis', 'baseline_period_from', 'baseline_period_to', 'measured_from', 'measured_to', 'method_note', 'source_kind', 'metric_key'];
const blank = (v) => v == null || String(v).trim() === '';

function evidenceLevel(b) {
  if (!b) return null;
  if (b.verified_at) return 'verified';
  return b.realised_value != null ? 'entered' : 'planned';
}
/** Verified by someone who held the role required at that moment, who is neither the entrant nor the linked owner. */
function verificationIndependent(b) {
  if (!b || !b.verified_at || blank(b.verifier_role_required) || b.verified_by == null) return false;
  if (b.realised_by != null && Number(b.verified_by) === Number(b.realised_by)) return false;
  if (b.owner_user_id != null && Number(b.verified_by) === Number(b.owner_user_id)) return false;
  return true;
}
function measurementClass(b) {
  if (!b || blank(b.basis)) return null;
  if (b.basis === 'estimated_avoidance') return 'estimated';
  return verificationIndependent(b) && evidenceLinkOk(b.evidence_link) ? 'validated' : 'observed';
}
/** null when the class fields of a benefit (after the write) are coherent, else { code, error }. */
function classProblem(b) {
  const x = b || {};
  const bad = (code, error) => ({ code, error });
  if (!blank(x.value_class) && !VALUE_CLASSES.includes(x.value_class)) return bad('VALUE_CLASS', 'value_class must be ' + VALUE_CLASSES.join(' | ') + ' (or empty = unclassified)');
  if (!blank(x.basis) && !BASES.includes(x.basis)) return bad('BASIS', 'basis must be ' + BASES.join(' | ') + ' (or empty)');
  if (x.value_class === 'cost_avoidance_estimate' && x.basis === 'observed') return bad('CLASS_BASIS', 'a cost avoidance is an estimate: its basis cannot be "observed"');
  if (x.value_class === 'realised_cash' && x.basis === 'estimated_avoidance') return bad('CLASS_BASIS', 'realised cash is an observed amount: its basis cannot be an estimate');
  if (!blank(x.source_kind) && !SOURCE_KINDS.includes(x.source_kind)) return bad('SOURCE_KIND', 'source_kind must be ' + SOURCE_KINDS.join(' | '));
  if (x.source_kind === 'metric' && blank(x.metric_key)) return bad('METRIC_KEY', 'metric_key is required when the source is a metric');
  if (x.source_kind !== 'metric' && !blank(x.metric_key)) return bad('METRIC_KEY', 'metric_key is only for a metric source');
  for (const [f, t] of [['baseline_period_from', 'baseline_period_to'], ['measured_from', 'measured_to']]) if (!blank(x[f]) && !blank(x[t]) && day(x[f]) > day(x[t])) return bad('PERIOD', `${f} is after ${t}`);
  if (x.value_kind === 'money' && !blank(x.basis) && blank(x.currency)) return bad('CURRENCY_REQUIRED', 'a money benefit with a measurement basis needs its currency');
  return null;
}
/** The class view of one benefit (added to the reader's row while the switch is on). */
function classView(b) {
  const mc = measurementClass(b);
  return { evidence_level: evidenceLevel(b), measurement_class: mc, verification_independent: verificationIndependent(b), is_estimate: mc === 'estimated' || b.value_class === 'cost_avoidance_estimate',
    class_label: mc === 'estimated' ? 'estimate' : mc };
}
/**
 * Realised values per (measurement class, value class, kind, currency or unit). Nothing is added across two groups:
 * an estimate is never added to an observed or validated value, two currencies or two units are never added.
 * A benefit with no realised value is counted (without_value), never summed as 0; hidden money values are counted too.
 */
function benefitTotals(benefits) {
  const groups = new Map();
  for (const b of benefits || []) {
    const mc = measurementClass(b) || 'unclassified', vc = blank(b.value_class) ? 'unclassified' : b.value_class;
    const kind = b.value_kind || 'quantity', dim = kind === 'money' ? (b.currency || null) : (b.unit || null);
    const k = JSON.stringify([mc, vc, kind, dim]);
    if (!groups.has(k)) groups.set(k, { measurement_class: mc, value_class: vc, value_kind: kind, currency: kind === 'money' ? dim : null, unit: kind === 'money' ? null : dim, label: mc === 'estimated' ? 'estimate' : mc, benefits: 0, with_value: 0, without_value: 0, hidden: 0, realised_total: null });
    const g = groups.get(k); g.benefits++;
    if (b.values_hidden) { g.hidden++; continue; }
    if (b.realised_value == null || !Number.isFinite(Number(b.realised_value))) { g.without_value++; continue; }
    g.with_value++; g.realised_total = (g.realised_total == null ? 0 : g.realised_total) + Number(b.realised_value);
  }
  const ORDER = ['validated', 'observed', 'estimated', 'unclassified'];
  return [...groups.values()].sort((a, b) => ORDER.indexOf(a.measurement_class) - ORDER.indexOf(b.measurement_class) || a.value_class.localeCompare(b.value_class) || String(a.currency || a.unit || '').localeCompare(String(b.currency || b.unit || '')));
}

module.exports = { VALUE_KINDS, VALUE_FIELDS, benefitState, isReviewDue, visibleBenefit, evidenceLinkOk, reviewItems,
  VALUE_CLASSES, BASES, SOURCE_KINDS, CLASS_FIELDS, evidenceLevel, verificationIndependent, measurementClass, classProblem, classView, benefitTotals };
