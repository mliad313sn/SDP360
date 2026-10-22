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

// ── Lot 6.6 — replacement CANDIDATES of the 10 legacy read-only pages (dossier §7). Published next to the
// pages they may replace; nothing redirects until the committee validates the side-by-side comparison
// (DEC-6.5, docs/design/ETAPE-06-comparaison-pages.md). Audience = the roles that open the page today.
const C = (page, id, title, roles, scope, widgets, note) => ({
  id: 'candidat-' + id, title: { fr: title + ' (candidat)', en: title + ' (candidate)' },
  description: `Candidat de remplacement de ${page} — à comparer avant décision (DEC-6.5).${note ? ' ' + note : ''}`,
  audience: { roles, site_scope: scope }, density: 'compact', widgets,
});
const HD = ['helpdesk.inbound', 'helpdesk.closed', 'helpdesk.close_pct', 'helpdesk.sla_res_pct', 'helpdesk.sla_reply_pct', 'helpdesk.backlog', 'helpdesk.major_incidents'];
const CANDIDATES = [
  C('exec-view.html', 'exec-view', 'Vitrine direction', ['executive', 'scorecard-viewer', 'group-business'], 'all', [
    { type: 'kpi', title: 'Indicateurs du mois', metrics: ['helpdesk.inbound', 'helpdesk.sla_res_pct', 'helpdesk.sla_reply_pct', 'helpdesk.csat_pct', 'changes.success_pct'] },
    { type: 'events', source: 'incidents', span: 6, title: 'Incidents majeurs en cours' },
    { type: 'trend', span: 6, title: 'Volume', metrics: ['helpdesk.inbound'], grain: 'month', points: 6 },
    { type: 'tracker', title: 'Stratégie IT' },
  ], 'La vitrine SharePoint est publique : ce candidat exige une session tant que DEC-6.2 n’a pas tranché un mode public.'),
  C('executive.html (KPI Snapshot)', 'executive-kpi', 'Scorecard — KPI du mois', ['executive', 'scorecard-viewer'], 'all', [
    { type: 'kpi', title: 'Helpdesk', metrics: HD },
    { type: 'kpi', title: 'Satisfaction et changements', metrics: ['helpdesk.csat_pct', 'helpdesk.nps', 'changes.total', 'changes.success_pct'] },
    { type: 'trend', span: 6, title: 'Tickets entrants / clôturés (12 mois)', metrics: ['helpdesk.inbound', 'helpdesk.closed'], grain: 'month', points: 12 },
    { type: 'trend', span: 6, title: 'SLA de résolution (12 mois)', metrics: ['helpdesk.sla_res_pct'], grain: 'month', points: 12 },
  ]),
  C('site-awareness.html (vue site)', 'site-awareness', 'Mon site — vue métier', ['site-business', 'group-business', 'executive'], 'own', [
    { type: 'kpi', title: 'Service IT du site', metrics: ['helpdesk.sla_res_pct', 'helpdesk.backlog', 'helpdesk.major_incidents', 'infra.wan_timeup_pct', 'changes.total'] },
    { type: 'events', source: 'incidents', span: 6, title: 'Incidents majeurs en cours' },
    { type: 'actions', span: 6, title: 'Actions en retard' },
    { type: 'trend', title: 'Tickets du site (6 mois)', metrics: ['helpdesk.inbound', 'helpdesk.closed'], grain: 'month', points: 6, span: 12 },
  ]),
  C('site-awareness.html (vue groupe)', 'site-awareness-groupe', 'Vue métier — tous les sites', ['group-business', 'executive'], 'all', [
    { type: 'table', title: 'Sites', metrics: ['helpdesk.sla_res_pct', 'helpdesk.backlog', 'infra.wan_timeup_pct', 'changes.total'] },
    { type: 'events', source: 'incidents', span: 6, title: 'Incidents majeurs en cours' },
    { type: 'events', source: 'decisions', span: 6, title: 'Décisions en attente' },
  ]),
  C('meetings-insights.html', 'meetings-insights', 'Réunions — tableau de bord', ['any'], 'all', [
    { type: 'kpi', title: 'Réunions du mois', metrics: ['meetings.pvs_held', 'meetings.depts_with_pv', 'meetings.open_issues', 'meetings.high_open', 'meetings.resolved_month', 'meetings.escalations_open', 'meetings.engagements_score'] },
    { type: 'heatmap', title: '5 Engagements par site et par mois', metrics: ['meetings.engagements_score'], points: 6 },
    { type: 'bars', span: 6, title: 'Problèmes ouverts par site', metrics: ['meetings.open_issues'] },
    { type: 'bars', span: 6, title: 'Escalades ouvertes par site', metrics: ['meetings.escalations_open'] },
  ]),
  C('meetings-compliance.html', 'meetings-compliance', 'Réunions — 5 Engagements', ['any'], 'all', [
    { type: 'rag-grid', title: 'Conformité par site', metrics: ['meetings.engagements_score'] },
    { type: 'table', title: 'PV du mois par site', metrics: ['meetings.pvs_held', 'meetings.depts_with_pv', 'meetings.engagements_score'] },
  ], 'Le détail E1 / E2 / E3 / E5 par site n’est pas encore dans le dictionnaire : seul le score global l’est.'),
  C('meetings-council.html', 'meetings-council', 'Council — escalades', ['any'], 'all', [
    { type: 'events', source: 'decisions', title: 'Décisions en attente' },
    { type: 'bars', title: 'Escalades ouvertes par site', metrics: ['meetings.escalations_open'] },
  ], 'Le regroupement par thème du Council n’est pas encore un widget.'),
  C('infra-health.html', 'infra-health', 'Santé de l’infrastructure', ['any'], 'all', [
    { type: 'table', title: 'Disponibilité réseau par site', metrics: ['infra.wan_timeup_pct'] },
    { type: 'trend', title: 'Disponibilité réseau (13 semaines)', metrics: ['infra.wan_timeup_pct'], grain: 'week', points: 13, span: 12 },
    { type: 'text', markdown: 'LAN, Wi-Fi et serveurs (OpManager) ne sont pas encore servis par le dictionnaire : ils restent sur [la page actuelle](infra-health.html).' },
  ], 'Couverture partielle : WAN seulement.'),
  C('wan.html (santé)', 'wan', 'WAN — santé', ['any'], 'all', [
    { type: 'bars', span: 6, title: 'Disponibilité par site (mois)', metrics: ['infra.wan_timeup_pct'] },
    { type: 'trend', span: 6, title: '13 semaines', metrics: ['infra.wan_timeup_pct'], grain: 'week', points: 13 },
    { type: 'heatmap', title: 'Par site et par mois', metrics: ['infra.wan_timeup_pct'], points: 6 },
  ], 'Perte, latence et gigue par lien restent sur la page actuelle.'),
  C('inspections.html (tableau de bord)', 'inspections', 'Inspections — tableau de bord', ['any'], 'all', [
    { type: 'kpi', title: 'Inspections du mois', metrics: ['inspections.done', 'inspections.conformity_pct', 'inspections.open_actions', 'inspections.overdue_actions'] },
    { type: 'bars', span: 6, title: 'Conformité par site', metrics: ['inspections.conformity_pct'] },
    { type: 'actions', span: 6, title: 'Actions en retard' },
    { type: 'heatmap', title: 'Conformité par site et par mois', metrics: ['inspections.conformity_pct'], points: 6 },
  ]),
  C('analytics.html', 'analytics', 'Analyses helpdesk', ['admin', 'scorecard-viewer'], 'all', [
    { type: 'trend', span: 6, title: 'Tickets (12 mois)', metrics: ['helpdesk.inbound', 'helpdesk.closed'], grain: 'month', points: 12 },
    { type: 'trend', span: 6, title: 'SLA (12 mois)', metrics: ['helpdesk.sla_res_pct', 'helpdesk.sla_reply_pct'], grain: 'month', points: 12 },
    { type: 'table', title: 'Par site (mois)', metrics: ['helpdesk.inbound', 'helpdesk.close_pct', 'helpdesk.sla_res_pct', 'helpdesk.sla_reply_pct', 'helpdesk.backlog'] },
  ], 'Catégories, canaux et techniciens restent sur la page actuelle (pas encore dans le dictionnaire).'),
];

const SYSTEM = [DIRECTION, ...CANDIDATES];

module.exports = { SYSTEM, DIRECTION, CANDIDATES };
