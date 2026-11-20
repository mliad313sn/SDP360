/* Adoption Lot A (item 11) — French for public/inspection-actions.html (static markup). JS-built rows: next pass.
 * NOT translated on purpose: site names, owners, descriptions (data). Inert unless ui_i18n_pages='1'.
 * Terms follow docs/ux/GLOSSARY-FR.md (PROPOSED — to be validated by a French-speaking coordinator). */
(function (root) {
  'use strict';
  const STATIC = {
    '‹ Inspections dashboard': '‹ Tableau des inspections', 'Excel (full data)': 'Excel (toutes les données)', 'Export PPTX': 'Exporter en PPTX',
    'Inspections · Corrective Actions Register': 'Inspections · Registre des actions correctives',
    'Corrective actions across all inspections': 'Actions correctives de toutes les inspections',
    "Every corrective action raised in any site inspection, in one place — so a critical finding's fix isn't forgotten between visits.":
      'Toutes les actions correctives ouvertes lors des inspections de site, au même endroit — pour qu’aucune correction d’un constat critique ne soit oubliée entre deux visites.',
    'by site, status, priority or owner, and': 'par site, statut, priorité ou responsable, et',
    'close an action right here': 'clôturez une action ici même',
    'without re-opening its inspection. Overdue rows are red. The charts and the': 'sans rouvrir son inspection. Les lignes en retard sont en rouge. Les graphiques et l’',
    'PPTX export': 'export PPTX', 'reflect whatever filter you have applied.': 'suivent le filtre appliqué.',
    'Status breakdown': 'Répartition par statut', 'All actions in scope': 'Toutes les actions du périmètre',
    'Open actions by priority': 'Actions ouvertes par priorité', 'Not-yet-closed only': 'Non clôturées uniquement',
    'Open-action ageing': 'Ancienneté des actions ouvertes', 'By due date': 'Par échéance', 'Open actions by site': 'Actions ouvertes par site',
    'Where the backlog sits — overdue highlighted': 'Où se trouve le stock — retards en évidence', 'Raised vs closed': 'Ouvertes ou clôturées',
    'Last 6 months': '6 derniers mois', 'All sites': 'Tous les sites', 'All statuses': 'Tous les statuts', 'All priorities': 'Toutes les priorités',
    'Critical': 'Critique', 'High': 'Élevée', 'Medium': 'Moyenne', 'Low': 'Faible', 'Overdue only': 'En retard uniquement',
    'Corrective actions': 'Actions correctives',
    'Download EVERY inspection, finding and corrective action as an Excel workbook (all sites, ignores filters). Admin only.':
      'Télécharger TOUTES les inspections, constats et actions correctives dans un classeur Excel (tous les sites, sans filtre). Administrateurs uniquement.',
    'Export the current filtered view as a PowerPoint deck (KPIs, charts, and the priority action list).':
      'Exporter la vue filtrée en présentation PowerPoint (indicateurs, graphiques et liste des actions prioritaires).',
    'Search description / owner / item…': 'Rechercher description / responsable / élément…',
  };
  root.I18N_FR_INSPECTION_ACTIONS = Object.assign({}, STATIC);
  root.I18N_FR_INSPECTION_ACTIONS_RUNTIME = [];   // JS-built rows: next pass
})(typeof window !== 'undefined' ? window : globalThis);
