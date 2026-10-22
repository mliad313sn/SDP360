'use strict';
// Step 6 — SYSTEM dashboards: inserted and published once (version 1) the first time the dashboards are read,
// never overwritten afterwards (a super_admin edits them in the composer like any dashboard). The direction
// space is the first one (lot 6.3); the replacement candidates of the 10 legacy pages follow (lot 6.6).
//
// Choices made here follow the recommendations of docs/design/ETAPE-06-design-espace-direction-composeur.md
// while the committee decides (DEC-6.1 objectives, DEC-6.2 executive access): changing them is an edit +
// publish in the composer, not a code change.

const DIRECTION = {
  id: 'direction',
  title: { fr: 'Espace direction', en: 'Leadership space' },
  description: 'Où en est l’IT : objectifs de service, tendances 13 semaines, incidents majeurs, décisions en attente, sites et programmes.',
  audience: { roles: ['executive', 'scorecard-viewer'], site_scope: 'all' },
  density: 'comfort',
  widgets: [
    { id: 'objectives', type: 'kpi', span: 12, title: { fr: 'Objectifs de service', en: 'Service objectives' },
      metrics: ['helpdesk.sla_res_pct', 'helpdesk.sla_reply_pct', 'infra.wan_timeup_pct', 'changes.success_pct', 'helpdesk.csat_pct', 'meetings.engagements_score'] },
    { id: 'trend-volume', type: 'trend', span: 6, title: { fr: 'Tickets entrants et clôturés', en: 'Tickets in and closed' },
      metrics: ['helpdesk.inbound', 'helpdesk.closed'], grain: 'week', points: 13 },
    { id: 'trend-sla', type: 'trend', span: 6, title: { fr: 'SLA de résolution', en: 'Resolution SLA' }, metrics: ['helpdesk.sla_res_pct'], grain: 'week', points: 13 },
    { id: 'trend-wan', type: 'trend', span: 6, title: { fr: 'Disponibilité réseau', en: 'Network availability' }, metrics: ['infra.wan_timeup_pct'], grain: 'week', points: 13 },
    { id: 'trend-mi', type: 'trend', span: 6, title: { fr: 'Incidents majeurs ouverts', en: 'Major incidents raised' }, metrics: ['helpdesk.major_incidents'], grain: 'week', points: 13 },
    { id: 'incidents', type: 'events', source: 'incidents', span: 6, title: { fr: 'Incidents majeurs en cours', en: 'Major incidents in progress' } },
    { id: 'decisions', type: 'events', source: 'decisions', span: 6, title: { fr: 'Décisions en attente', en: 'Pending decisions' } },
    { id: 'sites', type: 'table', span: 12, title: { fr: 'Où en est-on — sites', en: 'Where we stand — sites' },
      metrics: ['score.scoreboard', 'helpdesk.sla_res_pct', 'inspections.conformity_pct', 'meetings.engagements_score'] },
    { id: 'programmes', type: 'tracker', span: 12, title: { fr: 'Où en est-on — programmes (stratégie IT)', en: 'Where we stand — programmes (IT strategy)' } },
  ],
};

const SYSTEM = [DIRECTION];

module.exports = { SYSTEM, DIRECTION };
