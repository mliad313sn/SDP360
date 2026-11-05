'use strict';
// C-19 (G41 · PO decision R10) — qualification evidence rules. PURE: no database, no clock (today passed in).
//
// SDP360 RECORDS evidence that a person holds a qualification; it never grants a physical authorisation
// (a permit to work, an electrical habilitation…) — those stay with the site's HSE process.
//   • recorded by an admin-tier user (the route checks the role);
//   • verified by someone who is neither the holder nor the recorder, nor a deputy of either (sodPolicy);
//   • a record is VALID on `today` iff status = verified and (no expires_on or expires_on >= today).
// `qualification_check_enabled` ('0' = today): when '1', a capability that declares required kinds (catalogue
// `prereq`, or report_config `qualification_requirements` = {"<capability id>": ["<kind>", …]}) is refused with
// the missing / expired / unverified kinds as the reason.
const sod = require('./sodPolicy');

const DEFAULT_KINDS = Object.freeze(['site-induction', 'electrical-authorisation', 'working-at-height', 'confined-space']);
const STATUSES = Object.freeze(['recorded', 'verified', 'rejected', 'revoked']);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const err = (status, code, error) => ({ status, code, error });
const okDate = (s) => ISO.test(String(s)) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const txt = (v, max) => { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, max) : null; };

/** Validate a new record. Returns { error } or { value }. */
function validateRecord(b, { kinds = DEFAULT_KINDS, today } = {}) {
  b = b || {};
  const user_id = Number(b.user_id);
  if (!Number.isInteger(user_id) || user_id <= 0) return { error: err(400, 'VALIDATION', 'user_id is required') };
  const kind = String(b.kind || '').trim();
  if (!kinds.includes(kind)) return { error: err(400, 'VALIDATION', `unknown qualification kind: ${kind || '—'}`) };
  const issued_on = b.issued_on ? String(b.issued_on) : null, expires_on = b.expires_on ? String(b.expires_on) : null;
  if (issued_on && !okDate(issued_on)) return { error: err(400, 'VALIDATION', 'issued_on must be YYYY-MM-DD') };
  if (expires_on && !okDate(expires_on)) return { error: err(400, 'VALIDATION', 'expires_on must be YYYY-MM-DD') };
  if (issued_on && today && issued_on > today) return { error: err(400, 'VALIDATION', 'issued_on is in the future') };
  if (issued_on && expires_on && expires_on < issued_on) return { error: err(400, 'VALIDATION', 'expires_on is before issued_on') };
  const issuer = txt(b.issuer, 200), evidence_ref = txt(b.evidence_ref, 300);
  if (!issuer) return { error: err(400, 'VALIDATION', 'issuer is required (as named by the site HSE owner)') };
  if (!evidence_ref) return { error: err(400, 'VALIDATION', 'evidence_ref is required (reference of the document seen)') };
  return { value: { user_id, kind, issuer, issued_on, expires_on, evidence_ref, notes: txt(b.notes, 1000) } };
}

/**
 * May `actor` verify / reject record `q`? null = yes.
 * @param {object} ctx { isAdminTier: bool, deputyIds: Set<number> (active deputies of holder and recorder) }
 */
function verifyCheck(q, actor, ctx = {}) {
  if (!q) return err(404, 'NOT_FOUND', 'qualification record not found');
  if (q.status !== 'recorded') return err(409, 'CONFLICT', `a ${q.status} record cannot be verified`);
  if (!ctx.isAdminTier) return err(403, 'FORBIDDEN', 'only the admin tier may verify qualification evidence');
  const r = sod.evaluate('qualification.verify', { actorId: actor && actor.id, subjectId: q.user_id, recorderId: q.recorded_by, deputyIds: ctx.deputyIds });
  return r.refuse ? err(403, 'FORBIDDEN', r.refuse.error) : null;
}

/** The state of one record on `today`: valid | expired | unverified | ended. */
function stateOf(q, today) {
  if (q.status === 'rejected' || q.status === 'revoked') return 'ended';
  if (q.status !== 'verified') return 'unverified';
  if (q.expires_on && String(q.expires_on) < today) return 'expired';
  return 'valid';
}

/**
 * Do `records` (one user's) satisfy `required` kinds on `today`?
 * @returns {{ ok, missing: string[], expired: string[], unverified: string[], reason: string|null }}
 */
function evaluate(required, records, today) {
  const out = { ok: true, missing: [], expired: [], unverified: [], reason: null };
  for (const kind of [...new Set(required || [])]) {
    const st = (records || []).filter((q) => q.kind === kind).map((q) => stateOf(q, today));
    if (st.includes('valid')) continue;
    if (st.includes('expired')) out.expired.push(kind);
    else if (st.includes('unverified')) out.unverified.push(kind);
    else out.missing.push(kind);
  }
  const parts = [];
  if (out.missing.length) parts.push('missing ' + out.missing.join(', '));
  if (out.expired.length) parts.push('expired ' + out.expired.join(', '));
  if (out.unverified.length) parts.push('not yet verified ' + out.unverified.join(', '));
  if (parts.length) { out.ok = false; out.reason = 'qualification evidence ' + parts.join('; '); }
  return out;
}

/** Required kinds for a capability: catalogue prereq ∪ report_config qualification_requirements[capId]. */
function requirementsFor(capId, raw) {
  const cap = require('./capabilityRegistry').get(capId);
  let map = raw;
  if (typeof raw === 'string') { try { map = raw.trim() ? JSON.parse(raw) : {}; } catch (_) { map = {}; } }
  const extra = map && typeof map === 'object' && Array.isArray(map[capId]) ? map[capId].map(String) : [];
  return [...new Set([...(cap ? cap.prereq : []), ...extra])].sort();
}

module.exports = { DEFAULT_KINDS, STATUSES, validateRecord, verifyCheck, stateOf, evaluate, requirementsFor };
