'use strict';
// Step 9 — SYSTEM report templates, inserted and published once (version 1) the first time the templates are read,
// never overwritten afterwards (edited in the report designer like any template). The monthly executive pack is the
// study's acceptance case: "produced without manual typing, zero divergence of figures".

const PACK = {
  id: 'pack-executif-mensuel',
  title: { fr: 'Pack exécutif mensuel', en: 'Monthly executive pack' },
  description: 'Objectifs de service, tendances, incidents, décisions, sites et programmes, avec l’analyse du mois.',
  audience: { roles: ['executive', 'scorecard-viewer'], site_scope: 'all' },
  language: 'fr', tone: 'direction', ai: true,
  sections: [
    { type: 'kpi', title: { fr: 'Objectifs de service', en: 'Service objectives' }, metrics: ['helpdesk.sla_res_pct', 'helpdesk.sla_reply_pct', 'infra.wan_timeup_pct', 'changes.success_pct', 'helpdesk.csat_pct', 'meetings.engagements_score'] },
    { type: 'commentary', title: 'Lecture des objectifs' },
    { type: 'trend', span: 6, title: { fr: 'Tickets entrants et clôturés (12 mois)' }, metrics: ['helpdesk.inbound', 'helpdesk.closed'], grain: 'month', points: 12 },
    { type: 'trend', span: 6, title: { fr: 'SLA de résolution (12 mois)' }, metrics: ['helpdesk.sla_res_pct'], grain: 'month', points: 12 },
    { type: 'events', source: 'incidents', span: 6, title: { fr: 'Incidents majeurs en cours' } },
    { type: 'events', source: 'decisions', span: 6, title: { fr: 'Décisions en attente' } },
    { type: 'table', title: { fr: 'Sites' }, metrics: ['score.scoreboard', 'helpdesk.sla_res_pct', 'inspections.conformity_pct', 'meetings.engagements_score'] },
    { type: 'tracker', title: { fr: 'Programmes de la stratégie IT' } },
    { type: 'commentary', title: 'Points d’attention et décisions' },
  ],
};
const SITE = {
  id: 'revue-site-mensuelle',
  title: { fr: 'Revue mensuelle de site', en: 'Monthly site review' },
  description: 'Le service informatique d’un site, ses incidents, ses actions et ses réunions.',
  audience: { roles: ['editor', 'site-business', 'admin'], site_scope: 'own' },
  language: 'fr', tone: 'coordinateur', ai: false,
  sections: [
    { type: 'kpi', title: { fr: 'Service du mois' }, metrics: ['helpdesk.inbound', 'helpdesk.closed', 'helpdesk.sla_res_pct', 'helpdesk.backlog', 'infra.wan_timeup_pct', 'inspections.conformity_pct'] },
    { type: 'events', source: 'incidents', span: 6, title: { fr: 'Incidents majeurs en cours' } },
    { type: 'actions', span: 6, title: { fr: 'Actions en retard' } },
    { type: 'trend', title: { fr: 'Tickets du site (6 mois)' }, metrics: ['helpdesk.inbound', 'helpdesk.closed'], grain: 'month', points: 6 },
    { type: 'commentary', title: 'Analyse et actions' },
  ],
};

module.exports = { SYSTEM: [PACK, SITE], PACK, SITE };
