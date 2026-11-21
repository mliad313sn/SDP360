/* Adoption Lot A (item 11) — French for public/meetings-actions.html (static markup). JS-built rows: next pass.
 * NOT translated on purpose: site, department, owners, descriptions (data). Inert unless ui_i18n_pages='1'.
 * Terms follow docs/i18n/GLOSSAIRE-FR.md (PROPOSED — to be validated by a French-speaking coordinator). */
(function (root) {
  'use strict';
  const STATIC = {
    // I18N-QUALITY — severity options (md_severities name_fr)
    'High@status': 'Haute',
    'Medium@status': 'Moyenne',
    'Low@status': 'Basse',
    // I18N-QUALITY — whole sentence (lib/i18nText.js matches the block first; inline tags kept in the value)
    'Every action (IT commitment) raised in any Department Meeting, in one place — so nothing slips through. Filter by site, department, status or owner, and close an action right here without re-opening its PV. Actions stay actionable even after the meeting is signed or closed. The charts and the PPTX export reflect whatever filter you have applied. Overdue rows are red.': 'Toutes les actions (engagements IT) décidées en réunion de département, au même endroit — pour que rien ne passe entre les mailles. <strong>Filtrez</strong> par site, département, statut ou responsable, et <strong>clôturez une action ici même</strong> sans rouvrir son PV. Les actions restent modifiables même après la signature ou la clôture de la réunion. Les graphiques et l’<strong>export PPTX</strong> suivent le filtre appliqué. Les lignes en retard sont en rouge.',
    'Excel (full data)': 'Excel (toutes les données)', 'Export PPTX': 'Exporter en PPTX', 'Insights · Actions Register': 'Analyses · Registre des actions',
    'IT commitments across all meetings': 'Engagements IT de toutes les réunions',
    'PPTX export': 'export PPTX',    'Status breakdown': 'Répartition par statut', 'All actions in scope': 'Toutes les actions du périmètre',
    'Open actions by department': 'Actions ouvertes par département', 'Not-yet-closed only': 'Non clôturées uniquement',
    'Open-action ageing': 'Ancienneté des actions ouvertes', 'By target date': 'Par date cible', 'Open actions by site': 'Actions ouvertes par site',
    'Where the backlog sits — overdue highlighted': 'Où se trouve le backlog — retards en évidence', 'Raised vs closed': 'Ouvertes ou clôturées',
    'Last 6 months': '6 derniers mois', 'All sites': 'Tous les sites', 'All departments': 'Tous les départements', 'All statuses': 'Tous les statuts',
    'Overdue only': 'En retard uniquement',
    'Download EVERY meeting (PV), issue, action and project as an Excel workbook (all sites, ignores filters). Admin only.':
      'Télécharger TOUTES les réunions (PV), problèmes, actions et projets dans un classeur Excel (tous les sites, sans filtre). Administrateurs uniquement.',
    'Export the current filtered view as a PowerPoint deck (KPIs, charts, and the outstanding-action list).':
      'Exporter la vue filtrée en présentation PowerPoint (indicateurs, graphiques et liste des actions en cours).',
    'Search description / owner…': 'Rechercher description / responsable…',
  };
  const RUNTIME = {
    // P11 r4 F-12 — texts built in script (toasts, empty states, row buttons, table heads)
    'Total actions': 'Actions au total',
    'Open': 'Ouvertes', 'Open@status': 'Ouverte',
    'in scope': 'dans le périmètre',
    'not yet closed': 'pas encore clôturées',
    'open & unassigned': 'ouvertes et non attribuées',
    'Action updated →': 'Action mise à jour →',
    'Update failed:': 'Échec de la mise à jour :',
    'PPTX library not loaded — refresh the page.': 'Bibliothèque PPTX non chargée — rechargez la page.',
    'PPTX exported': 'PPTX exporté',
    'Export failed:': 'Échec de l’export :',
    'Excel downloaded': 'Excel téléchargé',
    'Excel export failed:': 'Échec de l’export Excel :',
    'No actions match the current filter.': 'Aucune action ne correspond au filtre courant.',
    'Open ›': 'Ouvrir ›',
    'Failed to load actions.': 'Échec du chargement des actions.',
    'Target': 'Échéance',
    'past target date': 'échéance dépassée',
    'No champion': 'Sans champion',
    'resolved / cancelled / transferred': 'résolues / annulées / transférées',
    'Closed': 'Clôturé',
    'Overdue': 'En retard',
    'Ref': 'Réf.',
    'Champion': 'Champion',
    'PV closed': 'PV clôturé',
  };
  root.I18N_FR_MEETINGS_ACTIONS = Object.assign({}, STATIC, RUNTIME);
  root.I18N_FR_MEETINGS_ACTIONS_RUNTIME = Object.keys(RUNTIME);
})(typeof window !== 'undefined' ? window : globalThis);
