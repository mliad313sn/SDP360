'use strict';
// A1 (goal programme 2026-11-12) — Finance verifier: the rules of a HUMAN certification of a money figure.
// PURE: no DB, no clock, no I/O. The store (services/financeCertStore.js, migration 094) persists; the routes
// (routes/finance.js) decide; the figures come from services/financeFigures.js.
//
//   • who:   the holder of the feature role `finance-verifier`, held EXACTLY (no tier implies it — a super_admin
//            or a finance-viewer without it can never certify), who may also READ the amounts (admin tier or
//            finance-viewer, invariant 2): nobody certifies figures they cannot see.
//   • SoD:   the last person who edited the figures (when the store knows it: the entrant of a budget-period
//            actual, the committer of an import, the entrant of a realised benefit) cannot certify them.
//   • what:  scope × scope_key × period, stamped with the SHA-256 of the canonical figures. A later read whose hash
//            differs is "stale" → NOT certified: the "Non certifié" badge comes back by itself.
//   • the automatic coverage threshold (services/moneyCoverage.js) is a COVERAGE indicator, never a certification.
const crypto = require('crypto');

const SCOPES = Object.freeze(['asset_finance', 'licences', 'investment', 'depreciation', 'project_benefits', 'project_actuals']);
const ASSET_SCOPES = Object.freeze(['asset_finance', 'licences', 'investment', 'depreciation']);
const VERIFIER_ROLE = 'finance-verifier';
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const blank = (v) => v == null || String(v).trim() === '';

/** Stable JSON: keys sorted at every level, undefined dropped (so key order never changes a hash). */
function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
function figuresHash(figures) { return 'sha256:' + crypto.createHash('sha256').update(canonical(figures), 'utf8').digest('hex'); }

function scopeKeyOk(scope, key) {
  const k = String(key || '');
  if (ASSET_SCOPES.includes(scope)) return k === 'fleet' || /^site:[^\s].{0,119}$/.test(k);
  return /^project:[1-9][0-9]{0,15}$/.test(k);
}
function evidenceLinkOk(s) { const v = String(s || '').trim(); return v.length > 0 && v.length <= 1000 && /^https?:\/\/[^\s<>"']+$/i.test(v); }

/** null when the certification request is well formed, else { code, error }. */
function validate(b) {
  const x = b || {};
  const bad = (code, error) => ({ code, error });
  if (!SCOPES.includes(x.scope)) return bad('SCOPE', 'scope must be ' + SCOPES.join(' | '));
  if (!scopeKeyOk(x.scope, x.scope_key)) return bad('SCOPE_KEY', ASSET_SCOPES.includes(x.scope) ? 'scope_key must be "fleet" or "site:<site>"' : 'scope_key must be "project:<id>"');
  if (!PERIOD_RE.test(String(x.period || ''))) return bad('PERIOD', 'period must be YYYY-MM');
  if (blank(x.evidence) || String(x.evidence).length > 4000) return bad('EVIDENCE', 'evidence is required (what was checked against what), 4000 characters at most');
  if (blank(x.source) || String(x.source).length > 400) return bad('SOURCE', 'source is required (e.g. "Pronto GL extract 2026-10")');
  if (!blank(x.evidence_link) && !evidenceLinkOk(x.evidence_link)) return bad('EVIDENCE_LINK', 'evidence_link must be an http(s) link');
  return null;
}

/** { ok, reason } — reason VERIFIER_ROLE (role not held exactly) or MONEY_SCOPE (cannot read the amounts). */
function mayCertify(user, hasRole) {
  if (!user || !Array.isArray(user.roles) || !user.roles.includes(VERIFIER_ROLE)) return { ok: false, reason: 'VERIFIER_ROLE' };
  if (!(hasRole(user, 'admin') || hasRole(user, 'finance-viewer'))) return { ok: false, reason: 'MONEY_SCOPE' };
  return { ok: true, reason: null };
}
/** 'SELF_REVIEW' when the certifier is one of the last editors of the figures (unknown editors never refuse). */
function sodProblem(userId, lastEditorIds) {
  const uid = userId == null ? null : Number(userId);
  return uid != null && (lastEditorIds || []).some((e) => e != null && Number(e) === uid) ? 'SELF_REVIEW' : null;
}

/** uncertified | verified | stale (a verified row whose figures changed since). */
function state(cert, currentHash) {
  if (!cert || cert.status !== 'verified') return 'uncertified';
  return currentHash && cert.figures_hash === currentHash ? 'verified' : 'stale';
}
const day = (s) => (s ? String(s).slice(0, 10) : '—');
/** The badge words (French, as on the pages). The verdict is carried by the words, never by colour alone. */
function badge(st, cert) {
  if (st === 'verified') return { certified: true, label: `Certifié par ${cert && cert.certified_by_name ? cert.certified_by_name : '—'} le ${day(cert && cert.certified_at)}` };
  if (st === 'stale') return { certified: false, label: `Non certifié — chiffres modifiés depuis la certification du ${day(cert && cert.certified_at)}` };
  return { certified: false, label: 'Non certifié — aucune certification Finance' };
}
/** One export line (sheet "Finance certification"): who / when / source — never an amount. */
function exportRow(target, st, cert) {
  const ok = st === 'verified';
  return { Scope: target.scope, 'Scope key': target.scope_key, Period: target.period,
    State: ok ? 'Certifié' : 'Non certifié', Detail: badge(st, cert).label,
    'Certified by': ok ? (cert.certified_by_name || '—') : '—', 'Certified at': ok ? cert.certified_at : '—',
    Source: ok ? (cert.source || '—') : '—', Evidence: ok ? (cert.evidence || '—') : '—' };
}

module.exports = { SCOPES, ASSET_SCOPES, VERIFIER_ROLE, PERIOD_RE, canonical, figuresHash, scopeKeyOk, validate, mayCertify, sodProblem, state, badge, exportRow };
