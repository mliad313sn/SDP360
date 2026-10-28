'use strict';
// 2027 Goal 02 — PURE metric formulas over commitment rows (status DRAFT — pending Committee, D-04).
// Denominators are explicit and an empty denominator is UNKNOWN (value null), never 0 %.
//
// commitments.verified_on_time_pct
//   numerator   = verified_closed commitments whose verified_at date ≤ due_date
//   denominator = verified_closed commitments that carry a due_date
//   A technically completed but unverified commitment is NOT counted (never a benefit).
// commitments.technical_vs_verified
//   technical = commitments with technical_completed_at set (reached awaiting_verification at least once)
//   verified  = commitments currently verified_closed
//   pending   = technical − verified (work said done, not yet accepted by the reviewer)
// commitments.serious_unowned  (alert A01 — consolidation 2026-10-28)
//   COUNT of high / critical commitments, not terminal, with no accountable owner.
// commitments.serious_overdue  (alert A02)
//   COUNT of high / critical commitments, not terminal and not awaiting verification, whose due
//   date is before asOf and that carry no approved exception. These are exposure COUNTS (0 is a
//   measured zero when the store answers); they never improve a score — they are red flags.

const d10 = (v) => (v ? String(v).slice(0, 10) : null);

function verifiedOnTime(rows) {
  const elig = (rows || []).filter((r) => r.status === 'verified_closed' && d10(r.due_date) && d10(r.verified_at));
  const num = elig.filter((r) => d10(r.verified_at) <= d10(r.due_date)).length;
  return { numerator: num, denominator: elig.length, value: elig.length ? Math.round(1000 * num / elig.length) / 10 : null, state: elig.length ? 'measured' : 'UNKNOWN' };
}

function technicalVsVerified(rows) {
  const list = rows || [];
  const technical = list.filter((r) => r.technical_completed_at).length;
  const verified = list.filter((r) => r.status === 'verified_closed').length;
  return { technical, verified, pending_verification: Math.max(0, technical - verified), value: technical ? Math.round(1000 * verified / technical) / 10 : null, state: technical ? 'measured' : 'UNKNOWN' };
}

const TERMINAL = ['verified_closed', 'cancelled_with_reason', 'accepted_risk_exception'];
const SERIOUS = ['high', 'critical'];
const _str = (v) => String(v == null ? '' : v).trim();

function seriousExposure(rows, asOf) {
  const day = d10(asOf instanceof Date ? asOf.toISOString() : (asOf || new Date().toISOString()));
  const open = (rows || []).filter((r) => SERIOUS.includes(_str(r.severity).toLowerCase()) && !TERMINAL.includes(r.status));
  const unowned = open.filter((r) => !_str(r.accountable_owner));
  const overdue = open.filter((r) => r.status !== 'awaiting_verification' && d10(r.due_date) && d10(r.due_date) < day && !_str(r.exception_approved_by));
  return { serious_open: open.length, serious_unowned: unowned.length, serious_overdue: overdue.length,
    unowned_ids: unowned.map((r) => r.id), overdue_ids: overdue.map((r) => r.id), as_of: day };
}

function summary(rows, asOf) {
  const on = verifiedOnTime(rows), tv = technicalVsVerified(rows);
  const ex = seriousExposure(rows, asOf);
  return { verified_on_time_pct: on.value, verified_on_time: on, verified_of_technical_pct: tv.value, technical_vs_verified: tv,
    serious_unowned: ex.serious_unowned, serious_overdue: ex.serious_overdue, serious_exposure: ex };
}

module.exports = { verifiedOnTime, technicalVsVerified, seriousExposure, summary };
