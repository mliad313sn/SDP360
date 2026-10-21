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

function summary(rows) {
  const on = verifiedOnTime(rows), tv = technicalVsVerified(rows);
  return { verified_on_time_pct: on.value, verified_on_time: on, verified_of_technical_pct: tv.value, technical_vs_verified: tv };
}

module.exports = { verifiedOnTime, technicalVsVerified, summary };
