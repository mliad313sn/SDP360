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
function visibleBenefit(b, { money = false, asOf = null } = {}) {
  const out = { ...b, state: benefitState(b, asOf), review_due: isReviewDue(b, asOf) };
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

module.exports = { VALUE_KINDS, VALUE_FIELDS, benefitState, isReviewDue, visibleBenefit, evidenceLinkOk, reviewItems };
