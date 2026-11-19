'use strict';
// P09 — the three tasks that matter most for each of the 11 workspace profiles (public/lib/workspaceProfiles.js
// PROFILES), and where each one starts. SINGLE SOURCE for tests/e2e/p09-profile-tasks-*.spec.js and for
// docs/agent-execution/P09-PROFILE-TASKS.md (written by hand from this list — keep both in step).
//
// The task list is a PROPOSAL from the agent (AI), not a validated user need: the pilot cohort confirms or
// replaces it (sponsor decision D-P09-4). "Reachable" = the landing page (home.html with workspace profiles on)
// shows a shortcut to the task's page (click 1) and that page opens for the profile's roles without an error
// (the task control itself is click 2 or 3 inside the page). It does NOT prove the task can be completed.
//
// roles: the minimal role set whose defaultProfile() is that profile. site: true = the account carries site A.
const PROFILE_TASKS = [
  { id: 'administrator', roles: ['super_admin'], site: false, tasks: [
    { en: 'Check that the integrations (SDP, OpManager, Meraki) are fresh', fr: 'Vérifier la fraîcheur des intégrations (SDP, OpManager, Meraki)', href: 'integrations.html' },
    { en: 'Read the security / sync events of the day', fr: 'Lire les événements de sécurité et de synchronisation du jour', href: 'system-logs.html' },
    { en: 'See the helpdesk load across all sites', fr: 'Voir la charge du helpdesk sur tous les sites', href: 'index.html' }] },
  { id: 'executive', roles: ['executive'], site: false, tasks: [
    { en: 'Read the executive home (group KPIs, worst site)', fr: 'Lire l’accueil direction (indicateurs groupe, site le plus en retard)', href: 'dashboards.html?key=exec-home' },
    { en: 'Prepare the monthly IT review', fr: 'Préparer la revue IT mensuelle', href: 'it-review.html' },
    { en: 'See which projects are late or at risk', fr: 'Voir les projets en retard ou à risque', href: 'portfolio.html' }] },
  { id: 'business', roles: ['site-business'], site: true, tasks: [
    { en: 'See the IT status of my site', fr: 'Voir l’état IT de mon site', href: 'site-awareness.html' },
    { en: 'See the open major incidents on my site', fr: 'Voir les incidents majeurs ouverts sur mon site', href: 'site-awareness.html' },
    { en: 'See the planned changes that will affect my site', fr: 'Voir les changements prévus qui toucheront mon site', href: 'site-awareness.html' }] },
  { id: 'operations', roles: ['admin'], site: false, tasks: [
    { en: 'Find the sites whose helpdesk is slipping', fr: 'Trouver les sites dont le helpdesk décroche', href: 'index.html' },
    { en: 'Chase the overdue site actions', fr: 'Relancer les actions de site en retard', href: 'site-actions.html' },
    { en: 'Work the asset hygiene worklist', fr: 'Traiter la liste d’hygiène du parc', href: 'assets.html' }] },
  { id: 'coordinator', roles: ['editor', 'report-author'], site: true, tasks: [
    { en: 'Close or update my site actions', fr: 'Clôturer ou mettre à jour mes actions de site', href: 'site-actions.html' },
    { en: 'Record an inspection', fr: 'Saisir une inspection', href: 'inspections.html' },
    { en: 'Write and sign the department meeting minutes (PV)', fr: 'Rédiger et signer le PV de réunion de département', href: 'meetings.html' }] },
  { id: 'field', roles: ['field-tech'], site: true, tasks: [
    { en: 'Capture an inspection offline on the phone', fr: 'Saisir une inspection hors ligne sur le téléphone', href: 'field/index.html' },
    { en: 'Look up a past inspection of my site', fr: 'Consulter une inspection passée de mon site', href: 'inspections.html' },
    { en: 'See the actions assigned on my site', fr: 'Voir les actions affectées sur mon site', href: 'site-actions.html' }] },
  { id: 'pmo', roles: ['committee-member'], site: false, tasks: [
    { en: 'Review the portfolio before the committee', fr: 'Revoir le portefeuille avant le comité', href: 'portfolio.html' },
    { en: 'Run the committee meeting from the cockpit', fr: 'Conduire le comité depuis le cockpit', href: 'cockpit.html' },
    { en: 'Check the activity tracker of the month', fr: 'Contrôler le suivi des activités du mois', href: 'activity-tracker.html' }] },
  { id: 'finance', roles: ['finance-viewer'], site: false, tasks: [
    { en: 'Read the asset finance (book value, forecast)', fr: 'Lire la finance du parc (valeur comptable, prévision)', href: 'assets.html#finance' },
    { en: 'Compare project budget and actuals', fr: 'Comparer budget et réalisé des projets', href: 'portfolio.html' },
    { en: 'Produce the finance report', fr: 'Produire le rapport finance', href: 'report-studio.html' }] },
  { id: 'governance', roles: ['audit-viewer'], site: false, tasks: [
    { en: 'Prepare the governance meeting agenda', fr: 'Préparer l’ordre du jour de la réunion de gouvernance', href: 'cockpit.html' },
    { en: 'Check that the minutes (PV) are signed', fr: 'Vérifier que les PV sont signés', href: 'meetings.html' },
    { en: 'Review the governance policies', fr: 'Revoir les politiques de gouvernance', href: 'policies.html' }] },
  { id: 'analyst', roles: ['dashboard-publisher'], site: false, tasks: [
    { en: 'Open or publish a dashboard', fr: 'Ouvrir ou publier un tableau de bord', href: 'dashboards.html' },
    { en: 'Analyse ticket and change trends', fr: 'Analyser les tendances des tickets et des changements', href: 'analytics.html' },
    { en: 'Build a report from the studio', fr: 'Construire un rapport depuis le studio', href: 'report-studio.html' }] },
  { id: 'reader', roles: ['viewer'], site: true, tasks: [
    { en: 'See the helpdesk dashboard', fr: 'Voir le tableau helpdesk', href: 'index.html' },
    { en: 'See the actions of my site', fr: 'Voir les actions de mon site', href: 'site-actions.html' },
    { en: 'Open a published dashboard', fr: 'Ouvrir un tableau de bord publié', href: 'dashboards.html' }] },
];

module.exports = { PROFILE_TASKS };
