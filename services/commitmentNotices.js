'use strict';
// E-R02 — catalogue rules A03 / A04 completed IN-APP ONLY (PURE: no I/O, no clock).
//   A03  a commitment reaches awaiting_verification (technically completed) → the designated reviewer is told
//        (the named reviewer; with no reviewer named, the holders of commitments.reviewer for the site)
//   A04  a verification is rejected (→ rejected_for_rework) → the accountable owner is told, reason included
// Nothing leaves the server: the route writes in-app notifications only, inside the commitments_enabled gate,
// and nothing at all while notifications_stop = '1'. A person is matched by a UNIQUE identity only — username or
// e-mail — never a full name (namesakes; committee security P1-3); an unmatched name reaches nobody and says so.
// The author of the transition is never notified about their own act.

const _s = (v) => String(v == null ? '' : v).trim().toLowerCase();
const _active = (u) => u && u.active !== 0 && u.active !== false;

/** Users whose username or e-mail equals the free-text identity `who`. */
function usersMatching(who, users) {
  const w = _s(who); if (!w) return [];
  return (users || []).filter((u) => _active(u) && (_s(u.username) === w || _s(u.email) === w));
}

/**
 * @param {object} before  the commitment before the transition (status)
 * @param {object} after   the commitment after it (id, title, status, reviewer, accountable_owner)
 * @param {object} o       { reason, actorId, users:[{id,username,email,active}], roleReviewerIds:[ids] }
 * @returns {{ notices: Array<{userId, kind, title, body, link, sourceKind, sourceRef, rule}>, unmatched: string|null }}
 */
function noticesFor(before, after, o = {}) {
  const out = { notices: [], unmatched: null };
  if (!after || !before || before.status === after.status) return out;
  const title = String(after.title || '').slice(0, 120);
  const link = `commitments.html?id=${after.id}`;
  const base = { kind: 'commitment', link, sourceKind: 'commitment', sourceRef: String(after.id) };
  const actor = o.actorId == null ? null : Number(o.actorId);
  const add = (ids, n) => { for (const id of new Set(ids.map(Number))) if (id !== actor) out.notices.push({ userId: id, ...base, ...n }); };
  if (after.status === 'awaiting_verification') {
    const named = _s(after.reviewer);
    const ids = named ? usersMatching(after.reviewer, o.users).map((u) => u.id) : (o.roleReviewerIds || []);
    if (named && !ids.length) out.unmatched = 'reviewer';
    add(ids, { rule: 'A03', title: `A03 — to verify: ${title}`, body: 'technically completed — your independent verification is requested' });
  }
  if (after.status === 'rejected_for_rework') {
    const ids = usersMatching(after.accountable_owner, o.users).map((u) => u.id);
    if (_s(after.accountable_owner) && !ids.length) out.unmatched = 'owner';
    const why = String(o.reason == null ? '' : o.reason).trim().slice(0, 500);
    add(ids, { rule: 'A04', title: `A04 — verification rejected: ${title}`, body: why ? `reason: ${why}` : 'verification rejected' });
  }
  return out;
}

module.exports = { noticesFor, usersMatching };
