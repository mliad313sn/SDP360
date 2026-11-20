/* Adoption Lot A (item 11) — French for public/meetings-actions.html (static markup). JS-built rows: next pass.
 * NOT translated on purpose: site, department, owners, descriptions (data). Inert unless ui_i18n_pages='1'.
 * Terms follow docs/ux/GLOSSARY-FR.md (PROPOSED — to be validated by a French-speaking coordinator). */
(function (root) {
  'use strict';
  const STATIC = {
    'Excel (full data)': 'Excel (toutes les données)', 'Export PPTX': 'Exporter en PPTX', 'Insights · Actions Register': 'Insights · Registre des actions',
    'IT commitments across all meetings': 'Engagements IT de toutes les réunions',
    'Every action (IT commitment) raised in any Department Meeting, in one place — so nothing slips through.':
      'Toutes les actions (engagements IT) décidées en réunion de département, au même endroit — pour que rien ne passe entre les mailles.',
    'by site, department, status or owner, and': 'par site, département, statut ou responsable, et', 'close an action right here': 'clôturez une action ici même',
    'without re-opening its PV. Actions stay actionable even after the meeting is signed or closed. The charts and the':
      'sans rouvrir son PV. Les actions restent traitables même après la signature ou la clôture de la réunion. Les graphiques et l’',
    'PPTX export': 'export PPTX', 'reflect whatever filter you have applied. Overdue rows are red.': 'suivent le filtre appliqué. Les lignes en retard sont en rouge.',
    'Status breakdown': 'Répartition par statut', 'All actions in scope': 'Toutes les actions du périmètre',
    'Open actions by department': 'Actions ouvertes par département', 'Not-yet-closed only': 'Non clôturées uniquement',
    'Open-action ageing': 'Ancienneté des actions ouvertes', 'By target date': 'Par date cible', 'Open actions by site': 'Actions ouvertes par site',
    'Where the backlog sits — overdue highlighted': 'Où se trouve le stock — retards en évidence', 'Raised vs closed': 'Ouvertes ou clôturées',
    'Last 6 months': '6 derniers mois', 'All sites': 'Tous les sites', 'All departments': 'Tous les départements', 'All statuses': 'Tous les statuts',
    'Overdue only': 'En retard uniquement',
    'Download EVERY meeting (PV), issue, action and project as an Excel workbook (all sites, ignores filters). Admin only.':
      'Télécharger TOUTES les réunions (PV), problèmes, actions et projets dans un classeur Excel (tous les sites, sans filtre). Administrateurs uniquement.',
    'Export the current filtered view as a PowerPoint deck (KPIs, charts, and the outstanding-action list).':
      'Exporter la vue filtrée en présentation PowerPoint (indicateurs, graphiques et liste des actions en cours).',
    'Search description / owner…': 'Rechercher description / responsable…',
  };
  root.I18N_FR_MEETINGS_ACTIONS = Object.assign({}, STATIC);
  root.I18N_FR_MEETINGS_ACTIONS_RUNTIME = [];   // JS-built rows: next pass
})(typeof window !== 'undefined' ? window : globalThis);
