'use strict';
// Step 8 — a meeting CADENCE: type, site (or the whole group), rhythm, participants, preparer and the agenda
// template. The agenda is made of SECTIONS taken from a fixed catalogue; the figures of each section come from the
// KPI dictionary and the existing readers at the start of the meeting (services/cockpit/agenda.js) — nothing is
// typed by hand except the free topics. validate() returns errors (publish refused) and warnings.

const { AUDIENCE_ROLES } = require('../dashboards/definition');

const TYPES = {
  'it-weekly':   'Revue hebdomadaire informatique',
  'site-ops':    'Revue opérationnelle de site',
  'codir':       'Comité de direction informatique',
  'cab':         'Comité des changements',
  'council':     'Conseil (escalades)',
  'other':       'Autre',
};
// Agenda sections. `widget` = rendered by the dashboard engine (figures frozen at the start of the meeting).
const SECTIONS = {
  kpi:       { label: 'Indicateurs', widget: true, needs: 'metrics' },
  incidents: { label: 'Incidents majeurs', widget: true },
  decisions: { label: 'Décisions en attente', widget: true },
  actions:   { label: 'Actions en retard (réunions, inspections)', widget: true },
  followup:  { label: 'Suivi des actions de la réunion précédente' },
  rfis:      { label: 'Demandes soumises au comité' },
  portfolio: { label: 'Jalons du portefeuille en retard ou à risque' },
  topic:     { label: 'Sujet libre' },
};
const ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const HTML_RE = /[<>]/;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function validate(input, opts = {}) {
  const errors = [], warnings = [];
  const d = input && typeof input === 'object' ? input : {};
  const out = {};
  out.id = str(d.id, 48);
  if (!ID_RE.test(out.id)) errors.push('id: lower-case letters, digits and dashes, 2-48 characters');
  out.title = str(d.title, 120);
  if (!out.title) errors.push('title: empty');
  out.type = TYPES[d.type] ? d.type : 'other';
  out.description = str(d.description, 400);
  if (HTML_RE.test(out.title + out.description)) errors.push('title/description: HTML is not allowed');
  out.site_id = d.site_id == null || d.site_id === '' ? null : Number(d.site_id);
  if (out.site_id != null && !(Number.isInteger(out.site_id) && out.site_id > 0)) errors.push('site_id: a site id, or empty for the whole group');
  if (out.site_id != null && opts.siteIds && !opts.siteIds.has(out.site_id)) errors.push('site_id: unknown or inactive site');
  out.rhythm = ['weekly', 'biweekly', 'monthly'].includes(d.rhythm) ? d.rhythm : 'weekly';
  out.weekday = Number(d.weekday);
  if (!(Number.isInteger(out.weekday) && out.weekday >= 1 && out.weekday <= 7)) { out.weekday = 1; warnings.push('weekday: Monday by default'); }
  out.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(d.time || '')) ? d.time : '09:00';
  out.duration_min = Math.max(15, Math.min(240, Number(d.duration_min) || 60));
  out.preparer = str(d.preparer, 80);
  if (!out.preparer) warnings.push('preparer: nobody prepares this meeting');
  const parts = Array.isArray(d.participants) ? d.participants.slice(0, 60) : [];
  out.participants = parts.map((p, i) => {
    const o = { name: str(p && p.name, 80), email: str(p && p.email, 120).toLowerCase(), role: str(p && p.role, 60) };
    if (!o.name) errors.push(`participants[${i}].name: empty`);
    if (o.email && !EMAIL_RE.test(o.email)) errors.push(`participants[${i}].email: invalid address`);
    if (HTML_RE.test(o.name + o.role)) errors.push(`participants[${i}]: HTML is not allowed`);
    if (!o.email) delete o.email;
    if (!o.role) delete o.role;
    return o;
  });
  if (!out.participants.length) warnings.push('participants: nobody is invited');
  if (out.participants.length && !out.participants.some(p => p.email)) warnings.push('participants: no e-mail address — the minutes cannot be sent');
  const served = opts.servedMetrics || null;
  const agenda = Array.isArray(d.agenda) ? d.agenda.slice(0, 20) : [];
  if (!agenda.length) errors.push('agenda: at least one section');
  let total = 0;
  out.agenda = agenda.map((s, i) => {
    const kind = SECTIONS[s && s.kind] ? s.kind : null;
    if (!kind) { errors.push(`agenda[${i}].kind: one of ${Object.keys(SECTIONS).join(', ')}`); return { id: 's' + (i + 1), kind: 'topic', title: '' }; }
    const o = { id: 's' + (i + 1), kind, title: str(s.title, 120) || SECTIONS[kind].label, minutes: Math.max(0, Math.min(120, Number(s.minutes) || 0)) };
    if (HTML_RE.test(o.title)) errors.push(`agenda[${i}].title: HTML is not allowed`);
    total += o.minutes;
    if (kind === 'kpi') {
      o.metrics = (Array.isArray(s.metrics) ? s.metrics : []).map(k => str(k, 80)).filter(Boolean).slice(0, 8);
      if (!o.metrics.length) errors.push(`agenda[${i}]: an indicators section needs 1 to 8 dictionary keys`);
      if (served) for (const k of o.metrics) if (!served.has(k)) errors.push(`agenda[${i}]: ${k} is not a served dictionary key`);
    }
    if (kind === 'topic') o.text = str(s.text, 1000);
    return o;
  });
  if (total > out.duration_min) warnings.push(`agenda: ${total} min planned for a ${out.duration_min}-minute meeting`);
  const aud = d.audience && typeof d.audience === 'object' ? d.audience : {};
  const roles = (Array.isArray(aud.roles) ? aud.roles : ['any']).map(r => str(r, 40));
  for (const r of roles) if (!AUDIENCE_ROLES.includes(r)) errors.push(`audience: unknown role ${r}`);
  out.audience = { roles: roles.length ? roles : ['any'] };
  return { ok: errors.length === 0, errors, warnings, definition: out };
}

// Agenda templates per meeting type (DEC-8.1, recommended option) — the starting point of a new cadence.
const TEMPLATES = {
  'it-weekly': [
    { kind: 'followup', minutes: 10 },
    { kind: 'kpi', title: 'Service de la semaine', minutes: 10, metrics: ['helpdesk.inbound', 'helpdesk.closed', 'helpdesk.sla_res_pct', 'helpdesk.backlog'] },
    { kind: 'incidents', minutes: 10 }, { kind: 'actions', minutes: 10 }, { kind: 'topic', title: 'Points divers', minutes: 10 },
  ],
  'site-ops': [
    { kind: 'followup', minutes: 10 },
    { kind: 'kpi', title: 'Le site ce mois-ci', minutes: 10, metrics: ['helpdesk.sla_res_pct', 'helpdesk.backlog', 'infra.wan_timeup_pct', 'inspections.conformity_pct'] },
    { kind: 'incidents', minutes: 5 }, { kind: 'actions', minutes: 15 }, { kind: 'topic', title: 'Besoins du site', minutes: 10 },
  ],
  codir: [
    { kind: 'kpi', title: 'Objectifs de service', minutes: 15, metrics: ['helpdesk.sla_res_pct', 'helpdesk.sla_reply_pct', 'infra.wan_timeup_pct', 'changes.success_pct', 'helpdesk.csat_pct', 'meetings.engagements_score'] },
    { kind: 'decisions', minutes: 15 }, { kind: 'portfolio', minutes: 15 }, { kind: 'rfis', minutes: 10 }, { kind: 'followup', minutes: 5 },
  ],
  cab: [{ kind: 'decisions', title: 'Changements à approuver', minutes: 30 }, { kind: 'kpi', title: 'Changements du mois', minutes: 5, metrics: ['changes.total', 'changes.success_pct'] }, { kind: 'followup', minutes: 10 }],
  council: [{ kind: 'decisions', title: 'Escalades ouvertes', minutes: 30 }, { kind: 'rfis', minutes: 15 }, { kind: 'followup', minutes: 15 }],
  other: [{ kind: 'followup', minutes: 10 }, { kind: 'topic', title: 'Ordre du jour', minutes: 30 }],
};

module.exports = { validate, TYPES, SECTIONS, TEMPLATES, ID_RE };
