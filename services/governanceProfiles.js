'use strict';
// Site profiles (committee review 2026-10-28: CIO P0-3, Houndé site IT recommendation 1, architect "next").
// A profile is a NAMED BUNDLE of site-scoped governance policy values, applied to one site in one action
// instead of ten edits. Applying goes through the policy store one rule at a time, so every guardrail
// still holds: a value that relaxes a protected rule becomes a two-person proposal (or needs a
// super_admin), every change is reasoned and kept in the history. A profile never touches platform-only
// rules and never touches an invariant.
//
// Values are starting points written for Endeavour Mining's sites; the committee edits them here (code
// review) or per site afterwards. "large_mine" is the platform default made explicit.

const PROFILES = Object.freeze({
  large_mine: {
    en: 'Large mine (3+ IT staff): every default control — two people for minutes and publication, 48 h grace.',
    fr: 'Grande mine (3 informaticiens ou plus) : tous les contrôles par défaut — deux personnes pour les comptes rendus et la publication, 48 h de grâce.',
    values: { 'meetings.minutes_four_eyes': true, 'publication.four_eyes': true, 'reports.four_eyes': true, 'meetings.missed_grace_hours': 48, 'handoffs.overdue_escalation': true, 'handoffs.escalation_grace_days': 0 },
  },
  small_site: {
    en: 'Small site (one IT person): minutes accepted without a second local person (the group reviews them afterwards), 72 h grace, handoff escalation after 2 days. Publication and report four-eyes stay on (the second person is at group level).',
    fr: 'Petit site (un seul informaticien) : compte rendu accepté sans seconde personne locale (le groupe le relit ensuite), 72 h de grâce, remontée des demandes après 2 jours. La double validation des publications et rapports reste active (la seconde personne est au groupe).',
    values: { 'meetings.minutes_four_eyes': false, 'publication.four_eyes': true, 'reports.four_eyes': true, 'meetings.missed_grace_hours': 72, 'handoffs.overdue_escalation': true, 'handoffs.escalation_grace_days': 2 },
  },
  office: {
    en: 'Office (Abidjan, Dakar, London, Ouagadougou): default controls, 48 h grace, handoff escalation after 1 day.',
    fr: 'Bureau (Abidjan, Dakar, Londres, Ouagadougou) : contrôles par défaut, 48 h de grâce, remontée des demandes après 1 jour.',
    values: { 'meetings.minutes_four_eyes': true, 'publication.four_eyes': true, 'reports.four_eyes': true, 'meetings.missed_grace_hours': 48, 'handoffs.overdue_escalation': true, 'handoffs.escalation_grace_days': 1 },
  },
});

/** Every key of every profile must be a known, site-scoped parameter with a valid value (checked by tests). */
function validateProfiles(GP) {
  const errors = [];
  for (const [name, p] of Object.entries(PROFILES)) for (const [k, v] of Object.entries(p.values)) {
    const param = GP.BY_KEY.get(k);
    if (!param) { errors.push(`${name}: unknown ${k}`); continue; }
    if (!param.siteScoped) errors.push(`${name}: ${k} is platform-only`);
    try { GP.coerce(param, v); } catch (e) { errors.push(`${name}: ${k} ${e.message}`); }
  }
  return errors;
}

/**
 * Apply a profile to one site through the policy store. Values equal to the site's current effective value
 * are skipped. Returns one line per rule: applied / pending (two-person proposal) / unchanged / error.
 */
async function applyProfile(store, { siteId, profile, reason, actor }) {
  const p = PROFILES[profile];
  if (!p) { const e = new Error('unknown profile'); e.code = 'VALIDATION'; e.status = 400; e.expose = true; throw e; }
  const why = `profile ${profile}: ${String(reason || '').trim()}`;
  const current = await store.snapshot({ siteId });
  const out = [];
  for (const [key, value] of Object.entries(p.values)) {
    if (JSON.stringify(current[key]) === JSON.stringify(value)) { out.push({ key, result: 'unchanged' }); continue; }
    try {
      const r = await store.set({ scope: `site:${Number(siteId)}`, key, value, reason: why, actor });
      out.push({ key, result: r.pending ? 'pending' : 'applied', relaxes: !!r.relaxes, proposal: r.pending ? r.pending.id : undefined });
    } catch (e) { out.push({ key, result: 'error', error: String(e.message || e).slice(0, 200), status: e.status || 500 }); }
  }
  return out;
}

module.exports = { PROFILES, validateProfiles, applyProfile };
