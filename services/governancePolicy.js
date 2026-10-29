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

// Module → sync job behind it (one source of truth: the hours default to services/sync/jobs.js
// FRESHNESS_HOURS, and both publication and /api/sync/health read the policy value — committee P1-3).
const FRESHNESS_SOURCES = [['helpdesk', 'zoho.requests'], ['changes', 'zoho.change_cab'], ['survey', 'zoho.survey'], ['assets', 'assets.sync'], ['wan', 'meraki.wan'], ['infra', 'opmanager.availability']];

// stricter: 'true' (true is strict) · 'false' (false is strict) · 'higher' · 'lower' · null (neutral)
const P = (key, type, def, o) => ({ key, type, default: def, siteScoped: true, protected: false, stricter: null, ...o });
const PARAMS = [
  // ── the policy registry itself ───────────────────────────────────────────────────────────────
  P('governance.dual_approval_relaxations', 'bool', true, { area: 'governance', siteScoped: false, protected: true, stricter: 'true',
    en: 'Relaxing a protected rule is a two-person act: one super_admin proposes, another approves (proposals expire after 7 days).',
    fr: 'Assouplir une règle protégée se fait à deux : un super_admin propose, un autre approuve (les propositions expirent après 7 jours).' }),
  P('governance.dual_approval_tightening', 'bool', false, { area: 'governance', siteScoped: false, protected: true, stricter: 'true',
    en: 'Tightening a protected rule also takes two people (a very short freshness limit or a very long reason minimum can stop work across the platform). Off = the admin tier tightens alone, the behaviour until now.',
    fr: 'Durcir une règle protégée demande aussi deux personnes (une limite de fraîcheur très courte ou un motif très long peut bloquer le travail partout). Désactivé = un admin durcit seul, le fonctionnement actuel.' }),
  P('governance.relaxation_max_days', 'int', 90, { area: 'governance', siteScoped: false, protected: true, stricter: 'lower', min: 1, max: 365,
    en: 'A relaxed protected rule reverts to the stricter value automatically after this many days (a new relaxation is needed to keep it).',
    fr: 'Une règle protégée assouplie revient d\'elle-même à la valeur plus stricte après ce nombre de jours (il faut un nouvel assouplissement pour la garder).' }),
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
  P('reports.override_reason_min', 'int', 10, { area: 'reports', protected: true, min: 5, max: 500, stricter: 'higher',
    en: 'Minimum length of an admin override reason.', fr: 'Longueur minimale du motif de dérogation d\'un admin.' }),
  P('reports.withdraw_reason_min', 'int', 5, { area: 'reports', protected: true, min: 3, max: 500, stricter: 'higher',
    en: 'Minimum length of the reason to withdraw a published report.', fr: 'Longueur minimale du motif de retrait d\'un rapport publié.' }),
  // ── source freshness (hours) — properties of the source, global only ─────────────────────────────
  ...FRESHNESS_SOURCES.map(([m, job]) => [m, require('./sync/jobs').FRESHNESS_HOURS[job]]).map(([m, h]) =>
    P(`freshness.${m}_hours`, 'number', h, { area: 'freshness', siteScoped: false, protected: true, stricter: 'lower', min: 0.25, max: 24 * 31,
      en: `A ${m} figure is current while its last successful sync is younger than this (hours).`,
      fr: `Un chiffre ${m} est à jour tant que sa dernière synchronisation réussie a moins de ce nombre d'heures.` })),
  // ── definitions: trackers and dashboards (G-23 / G-24) ──────────────────────────────────────────
  P('publication.four_eyes', 'bool', true, { area: 'publication', protected: true, stricter: 'true',
    en: 'A tracker or dashboard is published by someone other than the person who submitted or last edited it.',
    fr: 'Un tracker ou un tableau de bord est publié par une autre personne que celle qui l\'a soumis ou modifié en dernier.' }),
  P('publication.override_allowed', 'bool', true, { area: 'publication', protected: true, stricter: 'false',
    en: 'An admin may publish without review by giving a written reason.', fr: 'Un admin peut publier sans relecture en donnant un motif écrit.' }),
  P('publication.override_reason_min', 'int', 10, { area: 'publication', protected: true, min: 5, max: 500, stricter: 'higher',
    en: 'Minimum length of a publication override reason.', fr: 'Longueur minimale du motif de dérogation à la relecture.' }),
  // ── governance meetings (G-21) ───────────────────────────────────────────────────────────────────
  P('meetings.missed_grace_hours', 'number', 48, { area: 'meetings', min: 1, max: 24 * 7, protected: true, stricter: 'lower',
    en: 'A planned session not started this many hours after its time is counted as missed.',
    fr: 'Une séance prévue non démarrée ce nombre d\'heures après son horaire est comptée manquée.' }),
  P('meetings.minutes_four_eyes', 'bool', true, { area: 'meetings', protected: true, stricter: 'true',
    en: 'Minutes are accepted by someone other than the person who closed the session.',
    fr: 'Le compte rendu est accepté par une autre personne que celle qui a clôturé la séance.' }),
  P('meetings.cancel_requires_approval', 'bool', true, { area: 'meetings', protected: true, stricter: 'true',
    en: 'A cancelled session stays an unexcused miss until a committee member (not the canceller) approves the exception.',
    fr: 'Une séance annulée reste une absence non excusée tant qu\'un membre du comité (autre que l\'annulateur) n\'a pas approuvé l\'exception.' }),
  P('meetings.cancel_reason_min', 'int', 5, { area: 'meetings', protected: true, min: 3, max: 500, stricter: 'higher',
    en: 'Minimum length of a cancellation reason.', fr: 'Longueur minimale du motif d\'annulation.' }),
  P('meetings.reopen_reason_min', 'int', 10, { area: 'meetings', protected: true, min: 5, max: 500, stricter: 'higher',
    en: 'Minimum length of the reason to reopen accepted minutes.', fr: 'Longueur minimale du motif de réouverture d\'un compte rendu accepté.' }),
  P('meetings.compliance_as_of', 'bool', false, { area: 'meetings', stricter: null,
    en: 'Judge each past session with the rules in force at its scheduled date (a later change does not rewrite past compliance). Off = the rules of today apply to every session shown, the behaviour until now.',
    fr: 'Juger chaque séance passée avec les règles en vigueur à sa date (un changement ultérieur ne réécrit pas la conformité passée). Désactivé = les règles du jour s\'appliquent à toutes les séances affichées, le fonctionnement actuel.' }),
  P('meetings.reopen_two_people', 'bool', false, { area: 'meetings', protected: true, stricter: 'true',
    en: 'Reopening accepted minutes takes two admins: one requests it with a reason, ANOTHER confirms it (off = one admin with a reason, the behaviour until now).',
    fr: 'Rouvrir un compte rendu accepté demande deux admins : l\'un le demande avec un motif, un AUTRE le confirme (désactivé = un seul admin avec motif, le fonctionnement actuel).' }),
  P('meetings.group_decisions_public', 'bool', true, { area: 'meetings', siteScoped: false, protected: true, stricter: 'false',
    en: 'Decisions of group-level (committee) sessions are listed for every account; off = only the committee, the chair / secretary and the participants see them, like the sessions themselves.',
    fr: 'Les décisions des séances de groupe (comité) sont visibles de tous ; désactivé = seuls le comité, le président / secrétaire et les participants les voient, comme les séances.' }),
  // ── handoffs (G-22) ──────────────────────────────────────────────────────────────────────────────
  P('handoffs.reason_min', 'int', 5, { area: 'handoffs', protected: true, min: 3, max: 500, stricter: 'higher',
    en: 'Minimum length of a reason (reject, block, escalate, cancel, rework, reassign).',
    fr: 'Longueur minimale d\'un motif (refus, blocage, escalade, annulation, reprise, réaffectation).' }),
  P('handoffs.overdue_escalation', 'bool', true, { area: 'handoffs', protected: true, stricter: 'true',
    en: 'An open handoff past its due date is escalated automatically.', fr: 'Une passation ouverte en retard est escaladée automatiquement.' }),
  P('handoffs.escalation_grace_days', 'int', 0, { area: 'handoffs', min: 0, max: 60, protected: true, stricter: 'lower',
    en: 'Days after the due date before the automatic escalation.', fr: 'Jours après l\'échéance avant l\'escalade automatique.' }),
  P('handoffs.proxy_accept', 'bool', false, { area: 'handoffs', protected: true, stricter: 'false',
    en: 'A handoff may name a receiver who has no account (e.g. a department head); the receiver account (a coordinator) then records each step on their behalf, with a note every time. Off = only people with an account receive handoffs, the behaviour until now.',
    fr: 'Une demande peut désigner un destinataire sans compte (ex. un chef de service) ; le compte destinataire (un coordinateur) enregistre alors chaque étape en son nom, avec une note à chaque fois. Désactivé = seules les personnes ayant un compte reçoivent des demandes, le fonctionnement actuel.' }),
  // ── commitments (G-18) ───────────────────────────────────────────────────────────────────────────
  P('commitments.escalation_enabled', 'bool', true, { area: 'commitments', protected: true, stricter: 'true',
    en: 'Record A01 / A02 escalations (serious commitment without owner / overdue without exception).',
    fr: 'Enregistrer les escalades A01 / A02 (engagement grave sans responsable / en retard sans exception).' }),
  P('commitments.serious_due_move_needs_admin', 'bool', true, { area: 'commitments', protected: true, stricter: 'true',
    en: 'Moving the due date of a high / critical commitment past its original (baseline) date needs the admin tier — a site editor cannot clear an A02 overdue alert alone.',
    fr: 'Reporter l\'échéance d\'un engagement élevé / critique au-delà de sa date initiale exige le palier admin — un éditeur de site ne peut pas effacer seul une alerte A02.' }),
  P('commitments.exception_max_days', 'int', 90, { area: 'commitments', protected: true, stricter: 'lower', min: 1, max: 365,
    en: 'An approved exception (overdue serious commitment) lapses after this many days; the A02 alert comes back unless it is renewed.',
    fr: 'Une exception approuvée (engagement grave en retard) expire après ce nombre de jours ; l\'alerte A02 revient si elle n\'est pas renouvelée.' }),
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
// Committee #49 — group scopes between the site and the platform: a site may carry a country and a
// business unit (sites.country / sites.business_unit, migration 036). Resolution order:
//   site → country → business unit → platform → default.
const GROUP_CODE = /^[A-Z0-9_-]{2,16}$/;
const groupCode = (v) => { const c = String(v == null ? '' : v).trim().toUpperCase(); return GROUP_CODE.test(c) ? c : null; };
/** The ordered group scopes of a site from its attributes ({ country, business_unit }). */
function groupsFor(attrs) {
  const a = attrs || {}; const out = [];
  const c = groupCode(a.country); if (c) out.push(`country:${c}`);
  const b = groupCode(a.business_unit); if (b) out.push(`bu:${b}`);
  return out;
}
function parseScope(scope) {
  if (scope === 'global') return { scope, siteId: null, group: null };
  const m = /^site:(\d+)$/.exec(String(scope || ''));
  if (m) return { scope, siteId: Number(m[1]), group: null };
  const g = /^(country|bu):([A-Z0-9_-]{2,16})$/.exec(String(scope || ''));
  if (g) return { scope, siteId: null, group: scope };
  throw typed('VALIDATION', 'scope must be "global", "site:<id>", "country:<CODE>" or "bu:<CODE>"', 400);
}

/** Pure resolution over a rows map { 'global': {key: value}, 'site:3': {...} }. */
function resolveFrom(rows, key, siteId, groups = []) {
  const p = BY_KEY.get(key); if (!p) throw new Error('unknown policy ' + key);
  const site = siteId != null && p.siteScoped ? (rows[scopeOf(siteId)] || {}) : {};
  if (Object.prototype.hasOwnProperty.call(site, key)) return { value: site[key], source: 'site' };
  if (p.siteScoped) for (const g of groups || []) { const v = rows[g] || {}; if (Object.prototype.hasOwnProperty.call(v, key)) return { value: v[key], source: g.split(':')[0] }; }
  const g = rows.global || {};
  if (Object.prototype.hasOwnProperty.call(g, key)) return { value: g[key], source: 'global' };
  return { value: p.default, source: 'default' };
}
/**
 * Replay the append-only history to the values in force at `at` (ISO): for each scope × rule, the last
 * change made at or before `at`; a cleared value (new_value null) or a relaxation already expired at `at`
 * no longer applies. Pure — committee audit P1-3 / architect P2-4.
 */
function rowsAsOf(history, at) {
  const t = String(at || ''); const last = new Map();
  for (const h of history || []) { if (String(h.at) > t) continue; const k = `${h.scope}|${h.key}`; const cur = last.get(k); if (!cur || String(h.at) > String(cur.at) || (String(h.at) === String(cur.at) && Number(h.id) > Number(cur.id))) last.set(k, h); }
  const out = {};
  for (const h of last.values()) {
    if (h.new_value == null || h.new_value === undefined) continue;
    if (h.expires_at && String(h.expires_at) <= t) continue;
    const p = BY_KEY.get(h.key); if (!p) continue;
    let v = h.new_value; if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { continue; } }
    try { v = coerce(p, v); } catch (_) { continue; }
    (out[h.scope] = out[h.scope] || {})[h.key] = v;
  }
  return out;
}
function snapshotFrom(rows, siteId, groups = []) {
  const out = {}; for (const p of PARAMS) out[p.key] = resolveFrom(rows, p.key, siteId, groups).value; return out;
}
/** Defaults only — what the pure modules use when no policy is passed (tests, old callers). */
const DEFAULTS = Object.freeze(Object.fromEntries(PARAMS.map((p) => [p.key, p.default])));

function makePolicyStore(db, { now = () => new Date().toISOString(), ttlMs = 30000, onInvalid = null, proposalDays = 7 } = {}) {
  const Q = (sql) => db().prepare(sql);
  // Cache: reloaded when the history version moves (every change writes one history row — a write on
  // another process or server is seen at its next request, committee P1-2) or after ttlMs (a value
  // edited directly in the database). On a read failure the LAST GOOD snapshot is kept: an outage
  // must not silently relax a rule a context had made stricter (committee P2-1).
  let cache = null, cacheAt = 0, cacheVersion = null;
  async function version() { const r = await Q('SELECT COALESCE(MAX(id), 0) AS v FROM governance_policy_history').get(); return Number(r && r.v) || 0; }
  async function rows(fresh = false) {
    try {
      const v = await version();
      if (!fresh && cache && v === cacheVersion && Date.now() - cacheAt < ttlMs) return cache;
      const out = {};
      const tnow = now();
      for (const r of await Q('SELECT scope, key, value, expires_at FROM governance_policies').all()) {
        if (r.expires_at && r.expires_at <= tnow) continue;   // a temporary relaxation that has lapsed no longer applies
        const p = BY_KEY.get(r.key);
        if (!p) { if (onInvalid) onInvalid({ scope: r.scope, key: r.key, reason: 'unknown key' }); continue; }   // a rule removed from code is never applied
        try { (out[r.scope] = out[r.scope] || {})[r.key] = coerce(p, JSON.parse(r.value)); }
        catch (e) { if (onInvalid) onInvalid({ scope: r.scope, key: r.key, reason: e.message }); }   // out of today's bounds → default, and said so
      }
      cache = out; cacheAt = Date.now(); cacheVersion = v;
      return out;
    } catch (e) {
      if (cache) return cache;
      throw e;
    }
  }
  // site → its group scopes (country / business unit), refreshed with the rows; empty if 036 is absent
  let groupMap = new Map(), groupAt = 0;
  async function groupsOf(siteId) {
    if (siteId == null) return [];
    if (Date.now() - groupAt > ttlMs) {
      try { const m = new Map(); for (const r of await Q('SELECT id, country, business_unit FROM sites').all()) m.set(Number(r.id), groupsFor(r)); groupMap = m; groupAt = Date.now(); }
      catch (_) { /* keep the last map */ }
    }
    return groupMap.get(Number(siteId)) || [];
  }
  const invalidate = () => { cache = null; groupAt = 0; };
  /** All resolved values for a context. Never throws: last good snapshot, else the defaults. */
  async function snapshot({ siteId = null } = {}) {
    try { return snapshotFrom(await rows(), siteId, await groupsOf(siteId)); } catch (_) { return { ...DEFAULTS }; }
  }
  /** The policy in force at `at` (history replay), cached per history version. */
  let histCache = null, histVersion = null;
  async function snapshotAt({ siteId = null, at } = {}) {
    try {
      const v = await version();
      if (!histCache || histVersion !== v) { histCache = await Q('SELECT id, scope, key, new_value, at, expires_at FROM governance_policy_history ORDER BY id').all(); histVersion = v; }
      return snapshotFrom(rowsAsOf(histCache, at), siteId, await groupsOf(siteId));   // groups as of today (site attributes are not historised)
    } catch (_) { return snapshot({ siteId }); }
  }
  async function view({ siteIds = [] } = {}) {
    const r = await rows(true);
    const expiresOf = {}; for (const x of await Q('SELECT scope, key, expires_at FROM governance_policies WHERE expires_at IS NOT NULL').all()) expiresOf[`${x.scope}|${x.key}`] = x.expires_at;
    return PARAMS.map((p) => ({ key: p.key, area: p.area, type: p.type, default: p.default, min: p.min, max: p.max, values: p.values,
      protected: p.protected, site_scoped: p.siteScoped, stricter: p.stricter, en: p.en, fr: p.fr,
      global: (r.global || {})[p.key], effective: resolveFrom(r, p.key, null).value, expires: expiresOf[`global|${p.key}`] || null,
      sites: p.siteScoped ? Object.fromEntries((siteIds || []).map((sid) => [sid, (r[scopeOf(sid)] || {})[p.key]]).filter(([, v]) => v !== undefined)) : {},
      groups: p.siteScoped ? Object.fromEntries(Object.keys(r).filter((sc) => /^(country|bu):/.test(sc)).map((sc) => [sc, r[sc][p.key]]).filter(([, v]) => v !== undefined)) : {} }));
  }
  const tx = async (fn) => { const h = db(); return h.runTransaction ? h.runTransaction(fn) : fn(); };

  /** Compute what a change would do (no write). */
  async function plan({ scope, key, value }) {
    const p = BY_KEY.get(key); if (!p) throw typed('VALIDATION', `unknown policy ${String(key).slice(0, 80)}`, 400);
    const { siteId, group } = parseScope(scope);
    if ((siteId != null || group) && !p.siteScoped) throw typed('VALIDATION', `${key} applies to the whole platform, not to one site`, 400);
    const r = await rows(true);
    const groups = group ? [group] : await groupsOf(siteId);
    const before = resolveFrom(r, key, siteId, groups).value;
    const next = value === null ? null : coerce(p, value);
    const after = next !== null ? next : (() => { const copy = JSON.parse(JSON.stringify(r)); if (copy[scope]) delete copy[scope][key]; return resolveFrom(copy, key, siteId, groups).value; })();
    return { p, r, before, next, after, rel: p.protected && relaxes(p, before, after), old: (r[scope] || {})[key], dual: resolveFrom(r, 'governance.dual_approval_relaxations', null).value !== false,
      maxDays: Number(resolveFrom(r, 'governance.relaxation_max_days', null).value) || 90, dualTight: resolveFrom(r, 'governance.dual_approval_tightening', null).value === true };
  }
  async function write({ scope, key, next, old, why, actorId, rel, proposedBy = null, approvedBy = null, expiresAt = null }) {
    if (next === null) await Q('DELETE FROM governance_policies WHERE scope=? AND key=?').run(scope, key);
    else await Q(`INSERT INTO governance_policies (scope, key, value, updated_by, updated_at, reason, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (scope, key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at, reason=EXCLUDED.reason, expires_at=EXCLUDED.expires_at`)
      .run(scope, key, JSON.stringify(next), actorId == null ? null : Number(actorId), now(), why.slice(0, 1000), expiresAt);
    await Q('INSERT INTO governance_policy_history (scope, key, old_value, new_value, actor_id, at, reason, relaxes, proposed_by, approved_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(scope, key, old === undefined ? null : JSON.stringify(old), next === null ? null : JSON.stringify(next), actorId == null ? null : Number(actorId), now(), why.slice(0, 1000), rel ? 1 : 0,
        proposedBy == null ? null : Number(proposedBy), approvedBy == null ? null : Number(approvedBy), expiresAt);
  }
  /**
   * Set (value defined) or clear (value === null → inherit) one parameter in one scope.
   * actor = { id, isSuper, isAdmin }. A protected relaxation under dual approval returns { pending: proposal }.
   * Read → check → write runs in one transaction under a per-(scope,key) advisory lock (committee P1-5).
   */
  const expiry = (days) => new Date(Date.parse(now()) + days * 864e5).toISOString();
  async function set({ scope, key, value, reason, actor, expiresDays = null }) {
    if (!actor || !(actor.isAdmin || actor.isSuper)) throw typed('FORBIDDEN', 'admin tier required', 403);
    const why = String(reason || '').trim();
    const out = await tx(async () => {
      await Q('SELECT pg_advisory_xact_lock(hashtext(?))').get(`policy:${scope}:${key}`);
      const pl = await plan({ scope, key, value });
      if (pl.rel && !actor.isSuper) throw typed('FORBIDDEN', `relaxing ${key} needs a super_admin`, 403);
      if (pl.rel && why.length < 10) throw typed('VALIDATION', `relaxing ${key} needs a reason (10+ characters)`, 400);
      if (!pl.rel && why.length < 3) throw typed('VALIDATION', 'a short reason is required for every policy change', 400);
      const tightenTwo = !pl.rel && pl.p.protected && pl.dualTight && JSON.stringify(pl.before) !== JSON.stringify(pl.after);
      if ((pl.rel && pl.dual) || tightenTwo) {
        const dup = await Q("SELECT id FROM governance_policy_proposals WHERE scope=? AND key=? AND status='pending' AND expires_at > ?").get(scope, key, now());
        if (dup) throw typed('CONFLICT', `a proposal for ${key} is already pending (#${dup.id})`, 409);
        const exp = new Date(Date.parse(now()) + proposalDays * 864e5).toISOString();
        const days = Math.min(pl.maxDays, Math.max(1, Number(expiresDays) || pl.maxDays));
        const r = await Q('INSERT INTO governance_policy_proposals (scope, key, value, reason, proposed_by, proposed_at, expires_at, expires_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
          .run(scope, key, pl.next === null ? null : JSON.stringify(pl.next), why.slice(0, 1000), Number(actor.id), now(), exp, days);
        return { key, scope, before: pl.before, after: pl.after, relaxes: pl.rel, pending: { id: Number(r.lastID), expires_at: exp } };
      }
      const until = pl.rel && pl.next !== null ? expiry(Math.min(pl.maxDays, Math.max(1, Number(expiresDays) || pl.maxDays))) : null;
      await write({ scope, key, next: pl.next, old: pl.old, why, actorId: actor.id, rel: pl.rel, expiresAt: until });
      return { key, scope, before: pl.before, after: pl.after, relaxes: pl.rel, expires_at: until };
    });
    invalidate();
    return out;
  }
  const propRow = (r) => r && ({ ...r, id: Number(r.id), proposed_by: Number(r.proposed_by), decided_by: r.decided_by == null ? null : Number(r.decided_by), value: r.value == null ? null : JSON.parse(r.value) });
  async function listProposals({ status = 'pending' } = {}) {
    const rowsP = status ? await Q('SELECT * FROM governance_policy_proposals WHERE status=? ORDER BY id DESC LIMIT 200').all(status) : await Q('SELECT * FROM governance_policy_proposals ORDER BY id DESC LIMIT 200').all();
    const t = now();
    return rowsP.map(propRow).map((x) => (x.status === 'pending' && x.expires_at <= t ? { ...x, status: 'expired' } : x));
  }
  /** decision: 'approve' | 'reject'. The approver is a super_admin other than the proposer. */
  async function decide(id, decision, { actor, reason } = {}) {
    if (!actor || !actor.isSuper) throw typed('FORBIDDEN', 'a super_admin decides a proposal', 403);
    const why = String(reason || '').trim();
    if (why.length < 3) throw typed('VALIDATION', 'a reason is required', 400);
    const out = await tx(async () => {
      const pr = propRow(await Q('SELECT * FROM governance_policy_proposals WHERE id=? FOR UPDATE').get(Number(id)));
      if (!pr) throw typed('NOT_FOUND', 'proposal not found', 404);
      if (pr.status !== 'pending') throw typed('CONFLICT', `proposal is ${pr.status}`, 409);
      if (pr.expires_at <= now()) { await Q("UPDATE governance_policy_proposals SET status='expired' WHERE id=?").run(pr.id); throw typed('CONFLICT', 'proposal expired', 409); }
      if (Number(pr.proposed_by) === Number(actor.id)) throw typed('FORBIDDEN', 'the proposer cannot approve or reject their own proposal', 403);
      if (decision === 'reject') {
        await Q("UPDATE governance_policy_proposals SET status='rejected', decided_by=?, decided_at=?, decision_reason=? WHERE id=?").run(Number(actor.id), now(), why.slice(0, 1000), pr.id);
        return { id: pr.id, status: 'rejected' };
      }
      if (decision !== 'approve') throw typed('VALIDATION', 'decision must be approve | reject', 400);
      await Q('SELECT pg_advisory_xact_lock(hashtext(?))').get(`policy:${pr.scope}:${pr.key}`);
      const pl = await plan({ scope: pr.scope, key: pr.key, value: pr.value });   // re-checked against the CURRENT value
      const until = pl.rel && pl.next !== null ? expiry(Math.min(pl.maxDays, Math.max(1, Number(pr.expires_days) || pl.maxDays))) : null;
      await write({ scope: pr.scope, key: pr.key, next: pl.next, old: pl.old, why: `${pr.reason} — approved: ${why}`, actorId: actor.id, rel: pl.rel, proposedBy: pr.proposed_by, approvedBy: actor.id, expiresAt: until });
      await Q("UPDATE governance_policy_proposals SET status='approved', decided_by=?, decided_at=?, decision_reason=? WHERE id=?").run(Number(actor.id), now(), why.slice(0, 1000), pr.id);
      return { id: pr.id, status: 'approved', key: pr.key, scope: pr.scope, before: pl.before, after: pl.after, relaxes: pl.rel, expires_at: until };
    });
    invalidate();
    return out;
  }
  async function history({ key = null, limit = 200 } = {}) {
    const lim = Math.min(1000, Math.max(1, Number(limit) || 200));
    const rowsH = key ? await Q(`SELECT * FROM governance_policy_history WHERE key=? ORDER BY id DESC LIMIT ${lim}`).all(key)
      : await Q(`SELECT * FROM governance_policy_history ORDER BY id DESC LIMIT ${lim}`).all();
    return rowsH.map((h) => ({ ...h, id: Number(h.id), relaxes: Number(h.relaxes) === 1, old_value: h.old_value == null ? null : JSON.parse(h.old_value), new_value: h.new_value == null ? null : JSON.parse(h.new_value) }));
  }
  /**
   * Oversight report (MEA02, committee): over [from, to] — relaxations, publication / report overrides,
   * decided and pending proposals; and now — every value that differs from its default, flagged when it
   * is less strict than the default.
   */
  async function oversight({ from, to } = {}) {
    const f = String(from || '0000'), t = String(to || '9999');
    const rel = (await Q('SELECT * FROM governance_policy_history WHERE relaxes=1 AND at >= ? AND at <= ? ORDER BY id DESC').all(f, t + '\uffff')).map((h) => ({ ...h, id: Number(h.id) }));
    let overrides = [];
    try {
      overrides = await Q(`SELECT ts, category, action, actor, target, details FROM system_log WHERE action IN ('report_publish_override','tracker_publish_override','dashboard_publish_override') AND ts >= ? AND ts <= ? ORDER BY ts DESC LIMIT 1000`).all(f, t + '\uffff');
    } catch (_) { overrides = null; }   // null = could not be read (never shown as "none")
    const r = await rows(true);
    const deviations = [];
    for (const [scope, vals] of Object.entries(r)) for (const [key, value] of Object.entries(vals)) {
      const p = BY_KEY.get(key); if (!p || value === p.default) continue;
      deviations.push({ scope, key, value, default: p.default, less_strict: relaxes(p, p.default, value), protected: p.protected });
    }
    const proposals = (await listProposals({ status: null })).filter((x) => x.proposed_at >= f && x.proposed_at <= t + '\uffff');
    return { from: from || null, to: to || null, relaxations: rel, overrides, deviations, proposals };
  }
  return { snapshot, snapshotAt, view, set, history, listProposals, decide, oversight, invalidate, groupsOf };
}

// Process-wide store used by the routes (lazy; reports-db PG handle).
let _shared = null;
function shared() {
  if (!_shared) _shared = makePolicyStore(() => require('../reports-db').pgHandle(), {
    onInvalid: (x) => { try { require('../reports-db').logEvent({ category: 'governance', action: 'invalid_policy_value', target: `${x.scope}:${x.key}`, details: x, risk: 1 }); } catch (_) {} } });
  return _shared;
}
/** Convenience for routes: resolved policy for a site (or global), defaults on any failure. */
async function forContext({ siteId = null } = {}) { return shared().snapshot({ siteId }); }
/** The policy in force at `at` for a site (history replay). */
async function forContextAt({ siteId = null, at } = {}) { return shared().snapshotAt({ siteId, at }); }

module.exports = { groupsFor, groupCode, rowsAsOf, FRESHNESS_SOURCES, PARAMS, BY_KEY, AREAS, DEFAULTS, coerce, relaxes, resolveFrom, snapshotFrom, scopeOf, parseScope, makePolicyStore, shared, forContext, forContextAt };
