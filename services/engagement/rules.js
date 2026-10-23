'use strict';
// Step 9 — ALERT RULES of the engagement engine: what is watched (an indicator of the dictionary, tickets open for
// too long, a major incident, the health of the synchronisations), where (the group or one site), the threshold,
// how many evaluations in a row before it fires (persistence), the quiet time before it may fire again (cooldown),
// the channels and the recipients. validate() returns errors and the normalised rule.

const KINDS = {
  metric:         'Indicateur du dictionnaire',
  tickets_older:  'Tickets ouverts depuis trop longtemps',
  major_incident: 'Incident majeur en cours',
  sync_health:    'Synchronisation en échec ou en retard',
};
const OPS = ['<', '<=', '>', '>='];
const CHANNELS = ['inapp', 'email', 'teams', 'webhook'];
const AGE_DAYS = [30, 45, 60];
const ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

function validate(input, opts = {}) {
  const d = input && typeof input === 'object' ? input : {};
  const errors = [], r = {};
  r.id = str(d.id, 48);
  if (!ID_RE.test(r.id)) errors.push('id: lower-case letters, digits and dashes');
  r.title = str(d.title, 160);
  if (!r.title || /[<>]/.test(r.title)) errors.push('title: empty or HTML');
  r.kind = KINDS[d.kind] ? d.kind : null;
  if (!r.kind) errors.push('kind: one of ' + Object.keys(KINDS).join(', '));
  const c = d.config && typeof d.config === 'object' ? d.config : {};
  const scope = str(c.scope || 'GROUP', 20).toUpperCase();
  if (opts.siteCodes && scope !== 'GROUP' && !opts.siteCodes.has(scope)) errors.push(`scope: ${scope} is not a site code`);
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  if (r.kind === 'metric') {
    r.config = { metric: str(c.metric, 80), scope, op: OPS.includes(c.op) ? c.op : '<', threshold: num(c.threshold) };
    if (!r.config.metric) errors.push('config.metric: a dictionary key');
    if (opts.servedMetrics && r.config.metric && !opts.servedMetrics.has(r.config.metric)) errors.push(`config.metric: ${r.config.metric} is not a served dictionary key`);
    if (r.config.threshold == null) errors.push('config.threshold: a number');
  } else if (r.kind === 'tickets_older') {
    const days = Number(c.days);
    r.config = { days: AGE_DAYS.includes(days) ? days : 30, scope, threshold: Math.max(1, Math.round(num(c.threshold) || 1)) };
  } else if (r.kind === 'major_incident') {
    r.config = { scope, threshold: Math.max(1, Math.round(num(c.threshold) || 1)) };
  } else if (r.kind === 'sync_health') {
    r.config = { threshold: 1 };
  }
  r.channels = (Array.isArray(d.channels) ? d.channels : ['inapp']).filter(x => CHANNELS.includes(x));
  if (!r.channels.length) r.channels = ['inapp'];
  r.channel_id = str(d.channel_id, 40) || null;
  if ((r.channels.includes('teams') || r.channels.includes('webhook')) && !r.channel_id) errors.push('channel_id: choose the Teams channel or the webhook');
  r.recipients = (Array.isArray(d.recipients) ? d.recipients : []).slice(0, 50).map(x => ({ type: x && x.type === 'user' ? 'user' : 'role', value: str(x && x.value, 80) })).filter(x => x.value);
  r.persistence = Math.max(1, Math.min(10, Math.round(Number(d.persistence) || 1)));
  r.cooldown_hours = Math.max(0, Math.min(168, Math.round(Number(d.cooldown_hours == null ? 24 : d.cooldown_hours))));
  r.enabled = !!d.enabled;
  return { ok: errors.length === 0, errors, rule: r };
}

/** Is `value` in breach of the rule? null (not measured) is never a breach. */
function breaches(rule, value) {
  if (value == null || !Number.isFinite(Number(value))) return false;
  const v = Number(value);
  if (rule.kind === 'metric') {
    const t = rule.config.threshold;
    return rule.config.op === '<' ? v < t : rule.config.op === '<=' ? v <= t : rule.config.op === '>' ? v > t : v >= t;
  }
  return v >= rule.config.threshold;
}

/** The sentence of a fired alert. */
function message(rule, value) {
  const c = rule.config, where = c.scope && c.scope !== 'GROUP' ? `site ${c.scope}` : 'ensemble du groupe';
  if (rule.kind === 'metric') return `${rule.title} : ${value} (seuil ${c.op} ${c.threshold}, ${where})`;
  if (rule.kind === 'tickets_older') return `${value} ticket(s) ouvert(s) depuis plus de ${c.days} jours (${where}, seuil ${c.threshold})`;
  if (rule.kind === 'major_incident') return `${value} incident(s) majeur(s) en cours (${where})`;
  return `${value} source(s) de données en retard ou en échec`;
}

// The initial catalogue (DEC-9.4, recommended): proposals, all DISABLED — the committee switches on the ones it wants.
const R = (id, title, kind, config, extra) => Object.assign({ id, title, kind, config, channels: ['inapp'], recipients: [{ type: 'role', value: 'admin' }], persistence: 2, cooldown_hours: 24, enabled: false }, extra || {});
const CATALOGUE = [
  R('sla-resolution', 'SLA de résolution du groupe sous 85 %', 'metric', { metric: 'helpdesk.sla_res_pct', scope: 'GROUP', op: '<', threshold: 85 }, { recipients: [{ type: 'role', value: 'executive' }, { type: 'role', value: 'admin' }] }),
  R('sla-first-reply', 'SLA de première réponse du groupe sous 85 %', 'metric', { metric: 'helpdesk.sla_reply_pct', scope: 'GROUP', op: '<', threshold: 85 }),
  R('backlog', 'Backlog ouvert du groupe au-dessus de 300 tickets', 'metric', { metric: 'helpdesk.backlog', scope: 'GROUP', op: '>', threshold: 300 }),
  R('tickets-30-days', 'Plus de 10 tickets ouverts depuis plus de 30 jours', 'tickets_older', { days: 30, scope: 'GROUP', threshold: 10 }),
  R('tickets-60-days', 'Un ticket ouvert depuis plus de 60 jours', 'tickets_older', { days: 60, scope: 'GROUP', threshold: 1 }, { persistence: 1 }),
  R('major-incident', 'Incident majeur en cours', 'major_incident', { scope: 'GROUP', threshold: 1 }, { persistence: 1, cooldown_hours: 4, recipients: [{ type: 'role', value: 'executive' }, { type: 'role', value: 'admin' }] }),
  R('wan-availability', 'Disponibilité réseau du groupe sous 98 %', 'metric', { metric: 'infra.wan_timeup_pct', scope: 'GROUP', op: '<', threshold: 98 }),
  R('change-success', 'Réussite des changements sous 90 %', 'metric', { metric: 'changes.success_pct', scope: 'GROUP', op: '<', threshold: 90 }),
  R('csat', 'Satisfaction des utilisateurs sous 80 %', 'metric', { metric: 'helpdesk.csat_pct', scope: 'GROUP', op: '<', threshold: 80 }),
  R('meeting-discipline', 'Discipline des revues de site (5 engagements) sous 60 %', 'metric', { metric: 'meetings.engagements_score', scope: 'GROUP', op: '<', threshold: 60 }),
  R('inspection-overdue', 'Actions d’inspection en retard', 'metric', { metric: 'inspections.overdue_actions', scope: 'GROUP', op: '>', threshold: 0 }, { persistence: 3 }),
  R('sync-health', 'Synchronisation des données en échec ou en retard', 'sync_health', {}, { persistence: 2, cooldown_hours: 12, recipients: [{ type: 'role', value: 'super_admin' }] }),
];

module.exports = { validate, breaches, message, KINDS, OPS, CHANNELS, AGE_DAYS, CATALOGUE };
