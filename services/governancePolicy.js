'use strict';
// Governance policy registry (validation request 2026-10-28).
//
// Every REGULATION BEHAVIOUR the platform applies — four-eyes rules, freshness limits, grace periods,
// minimum reason lengths, escalation switches — is a named parameter with a default here. A context
// changes it in Admin ▸ Governance policies (page policies.html), globally or for ONE site, without code.
//
// Resolution:  site override  →  global override  →  default.
// Guardrails:
//   • bounds   — a value outside [min, max] (or not in the allowed list) is refused (400);
//   • protected — changing a protected parameter in the LESS strict direction (e.g. switching four-eyes
//                 off, raising a freshness limit) needs a super_admin and a written reason (10+ characters);
//                 it is recorded as a risk event and in the append-only history;
//   • site scope — only parameters marked siteScoped accept a per-site value (a data-source freshness
//                 limit is a property of the source, not of a site).
// What is NOT a parameter (invariants, documented in docs/sdp360/completion/GOVERNANCE-POLICIES.md):
// site scoping of data, no self-verification of a commitment, nobody accepts a handoff for its receiver,
// the audit trail, "not measured" is never 0, secrets never leave the server.

const { typed } = require('./httpError');

// stricter: 'true' (true is strict) · 'false' (false is strict) · 'higher' · 'lower' · null (neutral)
const P = (key, type, def, o) => ({ key, type, default: def, siteScoped: true, protected: false, stricter: null, ...o });
const PARAMS = [
  // ── report studio (G-13 / G-14) ───────────────────────────────────────────────────────────────
  P('reports.four_eyes', 'bool', true, { area: 'reports', protected: true, stricter: 'true',
    en: 'The person who generated a report run cannot review or publish it; the last commentary editor cannot review it.',
    fr: 'La personne qui a généré un rapport ne peut ni le relire ni le publier ; le dernier éditeur du commentaire ne peut pas le relire.' }),
  P('reports.freshness_gate', 'bool', true, { area: 'reports', protected: true, stricter: 'true',
    en: 'Refuse publication when a source behind a figure is stale or has never synced.',
    fr: 'Refuser la publication quand une source derrière un chiffre est périmée ou jamais synchronisée.' }),
  P('reports.override_allowed', 'bool', true, { area: 'reports', protected: true, stricter: 'false',
    en: 'An admin may publish despite stale sources by giving a written reason.',
    fr: 'Un admin peut publier malgré des sources périmées en donnant un motif écrit.' }),
  P('reports.override_reason_min', 'int', 10, { area: 'reports', min: 5, max: 500, stricter: 'higher',
    en: 'Minimum length of an admin override reason.', fr: 'Longueur minimale du motif de dérogation d\'un admin.' }),
  P('reports.withdraw_reason_min', 'int', 5, { area: 'reports', min: 3, max: 500, stricter: 'higher',
    en: 'Minimum length of the reason to withdraw a published report.', fr: 'Longueur minimale du motif de retrait d\'un rapport publié.' }),
  // ── source freshness (hours) — properties of the source, global only ─────────────────────────────
  ...[['helpdesk', 3], ['changes', 3], ['survey', 3], ['assets', 30], ['wan', 30], ['infra', 30]].map(([m, h]) =>
    P(`freshness.${m}_hours`, 'number', h, { area: 'freshness', siteScoped: false, protected: true, stricter: 'lower', min: 0.25, max: 24 * 31,
      en: `A ${m} figure is current while its last successful sync is younger than this (hours).`,
      fr: `Un chiffre ${m} est à jour tant que sa dernière synchronisation réussie a moins de ce nombre d'heures.` })),
  // ── definitions: trackers and dashboards (G-23 / G-24) ──────────────────────────────────────────
  P('publication.four_eyes', 'bool', true, { area: 'publication', protected: true, stricter: 'true',
    en: 'A tracker or dashboard is published by someone other than the person who submitted or last edited it.',
    fr: 'Un tracker ou un tableau de bord est publié par une autre personne que celle qui l\'a soumis ou modifié en dernier.' }),
  P('publication.override_allowed', 'bool', true, { area: 'publication', protected: true, stricter: 'false',
    en: 'An admin may publish without review by giving a written reason.', fr: 'Un admin peut publier sans relecture en donnant un motif écrit.' }),
  P('publication.override_reason_min', 'int', 10, { area: 'publication', min: 5, max: 500, stricter: 'higher',
    en: 'Minimum length of a publication override reason.', fr: 'Longueur minimale du motif de dérogation à la relecture.' }),
  // ── governance meetings (G-21) ───────────────────────────────────────────────────────────────────
  P('meetings.missed_grace_hours', 'number', 48, { area: 'meetings', min: 1, max: 24 * 30, protected: true, stricter: 'lower',
    en: 'A planned session not started this many hours after its time is counted as missed.',
    fr: 'Une séance prévue non démarrée ce nombre d\'heures après son horaire est comptée manquée.' }),
  P('meetings.minutes_four_eyes', 'bool', true, { area: 'meetings', protected: true, stricter: 'true',
    en: 'Minutes are accepted by someone other than the person who closed the session.',
    fr: 'Le compte rendu est accepté par une autre personne que celle qui a clôturé la séance.' }),
  P('meetings.cancel_requires_approval', 'bool', true, { area: 'meetings', protected: true, stricter: 'true',
    en: 'A cancelled session stays an unexcused miss until a committee member (not the canceller) approves the exception.',
    fr: 'Une séance annulée reste une absence non excusée tant qu\'un membre du comité (autre que l\'annulateur) n\'a pas approuvé l\'exception.' }),
  P('meetings.cancel_reason_min', 'int', 5, { area: 'meetings', min: 3, max: 500, stricter: 'higher',
    en: 'Minimum length of a cancellation reason.', fr: 'Longueur minimale du motif d\'annulation.' }),
  P('meetings.reopen_reason_min', 'int', 10, { area: 'meetings', min: 5, max: 500, stricter: 'higher',
    en: 'Minimum length of the reason to reopen accepted minutes.', fr: 'Longueur minimale du motif de réouverture d\'un compte rendu accepté.' }),
  // ── handoffs (G-22) ──────────────────────────────────────────────────────────────────────────────
  P('handoffs.reason_min', 'int', 5, { area: 'handoffs', min: 3, max: 500, stricter: 'higher',
    en: 'Minimum length of a reason (reject, block, escalate, cancel, rework, reassign).',
    fr: 'Longueur minimale d\'un motif (refus, blocage, escalade, annulation, reprise, réaffectation).' }),
  P('handoffs.overdue_escalation', 'bool', true, { area: 'handoffs', protected: true, stricter: 'true',
    en: 'An open handoff past its due date is escalated automatically.', fr: 'Une passation ouverte en retard est escaladée automatiquement.' }),
  P('handoffs.escalation_grace_days', 'int', 0, { area: 'handoffs', min: 0, max: 60, protected: true, stricter: 'lower',
    en: 'Days after the due date before the automatic escalation.', fr: 'Jours après l\'échéance avant l\'escalade automatique.' }),
  // ── commitments (G-18) ───────────────────────────────────────────────────────────────────────────
  P('commitments.escalation_enabled', 'bool', true, { area: 'commitments', protected: true, stricter: 'true',
    en: 'Record A01 / A02 escalations (serious commitment without owner / overdue without exception).',
    fr: 'Enregistrer les escalades A01 / A02 (engagement grave sans responsable / en retard sans exception).' }),
];
const BY_KEY = new Map(PARAMS.map((p) => [p.key, p]));
const AREAS = [...new Set(PARAMS.map((p) => p.area))];

/** Parse and bound a raw value for a parameter. Throws VALIDATION. */
function coerce(p, raw) {
  const bad = (m) => typed('VALIDATION', `${p.key}: ${m}`, 400);
  if (p.type === 'bool') {
    if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
    if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
    throw bad('true or false expected');
  }
  if (p.type === 'int' || p.type === 'number') {
    const n = Number(raw);
    if (raw === '' || raw == null || !Number.isFinite(n)) throw bad('a number is expected');
    if (p.type === 'int' && !Number.isInteger(n)) throw bad('a whole number is expected');
    if (p.min != null && n < p.min) throw bad(`minimum ${p.min}`);
    if (p.max != null && n > p.max) throw bad(`maximum ${p.max}`);
    return n;
  }
  if (p.type === 'enum') { if (!(p.values || []).includes(raw)) throw bad(`one of ${(p.values || []).join(', ')}`); return raw; }
  throw bad('unsupported type');
}

/** Is going from `from` to `to` a relaxation of the control? */
function relaxes(p, from, to) {
  if (from === to || p.stricter == null) return false;
  if (p.stricter === 'true') return from === true && to === false;
  if (p.stricter === 'false') return from === false && to === true;
  if (p.stricter === 'higher') return Number(to) < Number(from);
  if (p.stricter === 'lower') return Number(to) > Number(from);
  return false;
}

const scopeOf = (siteId) => (siteId == null ? 'global' : `site:${Number(siteId)}`);
function parseScope(scope) {
  if (scope === 'global') return { scope, siteId: null };
  const m = /^site:(\d+)$/.exec(String(scope || ''));
  if (!m) throw typed('VALIDATION', 'scope must be "global" or "site:<id>"', 400);
  return { scope, siteId: Number(m[1]) };
}

/** Pure resolution over a rows map { 'global': {key: value}, 'site:3': {...} }. */
function resolveFrom(rows, key, siteId) {
  const p = BY_KEY.get(key); if (!p) throw new Error('unknown policy ' + key);
  const site = siteId != null && p.siteScoped ? (rows[scopeOf(siteId)] || {}) : {};
  if (Object.prototype.hasOwnProperty.call(site, key)) return { value: site[key], source: 'site' };
  const g = rows.global || {};
  if (Object.prototype.hasOwnProperty.call(g, key)) return { value: g[key], source: 'global' };
  return { value: p.default, source: 'default' };
}
function snapshotFrom(rows, siteId) {
  const out = {}; for (const p of PARAMS) out[p.key] = resolveFrom(rows, p.key, siteId).value; return out;
}
/** Defaults only — what the pure modules use when no policy is passed (tests, old callers). */
const DEFAULTS = Object.freeze(Object.fromEntries(PARAMS.map((p) => [p.key, p.default])));

function makePolicyStore(db, { now = () => new Date().toISOString(), ttlMs = 30000 } = {}) {
  const Q = (sql) => db().prepare(sql);
  let cache = null, cacheAt = 0;
  async function rows(fresh = false) {
    if (!fresh && cache && Date.now() - cacheAt < ttlMs) return cache;
    const out = {};
    for (const r of await Q('SELECT scope, key, value FROM governance_policies').all()) {
      const p = BY_KEY.get(r.key); if (!p) continue;          // a parameter removed from code is ignored, never applied
      try { (out[r.scope] = out[r.scope] || {})[r.key] = coerce(p, JSON.parse(r.value)); } catch (_) { /* invalid stored value → default */ }
    }
    cache = out; cacheAt = Date.now();
    return out;
  }
  const invalidate = () => { cache = null; };
  /** All resolved values for a context. Never throws: an unreadable store gives the defaults. */
  async function snapshot({ siteId = null } = {}) {
    try { return snapshotFrom(await rows(), siteId); } catch (_) { return { ...DEFAULTS }; }
  }
  async function view({ siteIds = [] } = {}) {
    const r = await rows(true);
    return PARAMS.map((p) => ({ key: p.key, area: p.area, type: p.type, default: p.default, min: p.min, max: p.max, values: p.values,
      protected: p.protected, site_scoped: p.siteScoped, stricter: p.stricter, en: p.en, fr: p.fr,
      global: (r.global || {})[p.key], effective: resolveFrom(r, p.key, null).value,
      sites: Object.fromEntries((siteIds || []).filter(() => p.siteScoped).map((sid) => [sid, (r[scopeOf(sid)] || {})[p.key]]).filter(([, v]) => v !== undefined)) }));
  }
  /**
   * Set (value defined) or clear (value === null → inherit) one parameter in one scope.
   * actor = { id, isSuper, isAdmin } — the caller already required the admin tier.
   */
  async function set({ scope, key, value, reason, actor }) {
    const p = BY_KEY.get(key); if (!p) throw typed('VALIDATION', `unknown policy ${String(key).slice(0, 80)}`, 400);
    const { siteId } = parseScope(scope);
    if (siteId != null && !p.siteScoped) throw typed('VALIDATION', `${key} applies to the whole platform, not to one site`, 400);
    if (!actor || !(actor.isAdmin || actor.isSuper)) throw typed('FORBIDDEN', 'admin tier required', 403);
    const r = await rows(true);
    const before = resolveFrom(r, key, siteId).value;
    const next = value === null ? null : coerce(p, value);
    // effective value after the change (a clear falls back to the next level)
    const after = next !== null ? next : (() => { const copy = JSON.parse(JSON.stringify(r)); if (copy[scope]) delete copy[scope][key]; return resolveFrom(copy, key, siteId).value; })();
    const rel = p.protected && relaxes(p, before, after);
    const why = String(reason || '').trim();
    if (rel && !actor.isSuper) throw typed('FORBIDDEN', `relaxing ${key} needs a super_admin`, 403);
    if (rel && why.length < 10) throw typed('VALIDATION', `relaxing ${key} needs a reason (10+ characters)`, 400);
    if (!rel && why.length < 3) throw typed('VALIDATION', 'a short reason is required for every policy change', 400);
    const old = (r[scope] || {})[key];
    if (next === null) await Q('DELETE FROM governance_policies WHERE scope=? AND key=?').run(scope, key);
    else await Q(`INSERT INTO governance_policies (scope, key, value, updated_by, updated_at, reason) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (scope, key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at, reason=EXCLUDED.reason`)
      .run(scope, key, JSON.stringify(next), actor.id == null ? null : Number(actor.id), now(), why.slice(0, 1000));
    await Q('INSERT INTO governance_policy_history (scope, key, old_value, new_value, actor_id, at, reason, relaxes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(scope, key, old === undefined ? null : JSON.stringify(old), next === null ? null : JSON.stringify(next), actor.id == null ? null : Number(actor.id), now(), why.slice(0, 1000), rel ? 1 : 0);
    invalidate();
    return { key, scope, before, after, relaxes: rel };
  }
  async function history({ key = null, limit = 200 } = {}) {
    const rowsH = key ? await Q(`SELECT * FROM governance_policy_history WHERE key=? ORDER BY id DESC LIMIT ${Math.min(1000, Number(limit) || 200)}`).all(key)
      : await Q(`SELECT * FROM governance_policy_history ORDER BY id DESC LIMIT ${Math.min(1000, Number(limit) || 200)}`).all();
    return rowsH.map((h) => ({ ...h, id: Number(h.id), relaxes: Number(h.relaxes) === 1, old_value: h.old_value == null ? null : JSON.parse(h.old_value), new_value: h.new_value == null ? null : JSON.parse(h.new_value) }));
  }
  return { snapshot, view, set, history, invalidate };
}

// Process-wide store used by the routes (lazy; reports-db PG handle).
let _shared = null;
function shared() {
  if (!_shared) _shared = makePolicyStore(() => require('../reports-db').pgHandle());
  return _shared;
}
/** Convenience for routes: resolved policy for a site (or global), defaults on any failure. */
async function forContext({ siteId = null } = {}) { return shared().snapshot({ siteId }); }

module.exports = { PARAMS, BY_KEY, AREAS, DEFAULTS, coerce, relaxes, resolveFrom, snapshotFrom, scopeOf, parseScope, makePolicyStore, shared, forContext };
