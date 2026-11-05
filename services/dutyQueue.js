'use strict';
// C-21 (G46 · A10) — duty queues. PURE: no DB, no clock.
// A queue = the people ON DUTY now for one site × duty family (duty_roster_shifts, C-20), eligible as in the
// coverage engine (active account that still holds the site, or admin tier). Under the governance policy
// handoffs.queue_receivers (site, default false = the behaviour until now) an escalation goes to the queue
// FIRST, and to the named role holder (and their deputy) only when nobody is on duty.
const { holderIneligible } = require('./governanceRoles');

const QUEUE_FAMILY = 'site-it-support';   // R9 — the family that receives handoff / commitment escalations

/** Eligible user ids on duty at `at` (ISO) for site × family. No account state → nobody (fail closed). */
function onDuty({ shifts, account, siteId, family = QUEUE_FAMILY, at }) {
  if (!account) return [];
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return [];
  return [...new Set((shifts || []).filter((s) => !s.removed_at && Number(s.site_id) === Number(siteId) && s.family === family
      && Date.parse(s.starts_at) <= t && t < Date.parse(s.ends_at))
    .map((s) => Number(s.user_id)).filter((u) => !holderIneligible(account, u, siteId)))];
}

/** The escalation with the queue applied: members first; the matrix result is kept as the fallback. */
function applyQueue(escalation, members, { siteId, family = QUEUE_FAMILY } = {}) {
  const e = escalation || { matched: null, role: null, targets: [], gap: false, why: 'no escalation rule' };
  const queue = { site_id: siteId == null ? null : Number(siteId), family, size: (members || []).length };
  if (!queue.size) return { ...e, queue, why: e.targets && e.targets.length ? `queue empty — ${e.why}` : e.why };
  return { ...e, targets: [...members], gap: false, why: 'queue', queue, person_targets: e.targets || [] };
}

module.exports = { QUEUE_FAMILY, onDuty, applyQueue };
