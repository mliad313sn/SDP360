/* Adoption Lot A (item 11) — French for public/inspection-actions.html (static markup). JS-built rows: next pass.
 * NOT translated on purpose: site names, owners, descriptions (data). Inert unless ui_i18n_pages='1'.
 * Terms follow docs/i18n/GLOSSAIRE-FR.md (PROPOSED — to be validated by a French-speaking coordinator). */
(function (root) {
  'use strict';
  const STATIC = {
    // I18N-QUALITY — whole sentence (lib/i18nText.js matches the block first; inline tags kept in the value)
    'Every corrective action raised in any site inspection, in one place — so a critical finding\'s fix isn\'t forgotten between visits. Filter by site, status, priority or owner, and close an action right here without re-opening its inspection. Overdue rows are red. The charts and the PPTX export reflect whatever filter you have applied.': 'Toutes les actions correctives issues des inspections de site, au même endroit — pour qu’aucune correction d’un constat critique ne soit oubliée entre deux visites. <strong>Filtrez</strong> par site, statut, priorité ou responsable, et <strong>clôturez une action ici même</strong> sans rouvrir son inspection. Les lignes en retard sont en rouge. Les graphiques et l’<strong>export PPTX</strong> suivent le filtre appliqué.',
    '‹ Inspections dashboard': '‹ Tableau des inspections', 'Excel (full data)': 'Excel (toutes les données)', 'Export PPTX': 'Exporter en PPTX',
    'Inspections · Corrective Actions Register': 'Inspections · Registre des actions correctives',
    'Corrective actions across all inspections': 'Actions correctives de toutes les inspections',
    'PPTX export': 'export PPTX',    'Status breakdown': 'Répartition par statut', 'All actions in scope': 'Toutes les actions du périmètre',
    'Open actions by priority': 'Actions ouvertes par priorité', 'Not-yet-closed only': 'Non clôturées uniquement',
    'Open-action ageing': 'Ancienneté des actions ouvertes', 'By due date': 'Par échéance', 'Open actions by site': 'Actions ouvertes par site',
    'Where the backlog sits — overdue highlighted': 'Où se trouve le backlog — retards en évidence', 'Raised vs closed': 'Ouvertes ou clôturées',
    'Last 6 months': '6 derniers mois', 'All sites': 'Tous les sites', 'All statuses': 'Tous les statuts', 'All priorities': 'Toutes les priorités',
    'Critical': 'Critique', 'High': 'Élevée', 'Medium': 'Moyenne', 'Low': 'Faible', 'Overdue only': 'En retard uniquement',
    'Corrective actions': 'Actions correctives',
    'Download EVERY inspection, finding and corrective action as an Excel workbook (all sites, ignores filters). Admin only.':
      'Télécharger TOUTES les inspections, constats et actions correctives dans un classeur Excel (tous les sites, sans filtre). Administrateurs uniquement.',
    'Export the current filtered view as a PowerPoint deck (KPIs, charts, and the priority action list).':
      'Exporter la vue filtrée en présentation PowerPoint (indicateurs, graphiques et liste des actions prioritaires).',
    'Search description / owner / item…': 'Rechercher description / responsable / élément…',
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
    'past due date': 'échéance dépassée',
    'No owner': 'Sans responsable',
    'closed / cancelled': 'clôturées / annulées',
    'Closed': 'Clôturé',
    'Overdue': 'En retard',
    'Verification note (what you checked):': 'Note de vérification (ce que vous avez contrôlé) :',
    'Action verified': 'Action vérifiée',
    'Action verified (the person who closed it is not recorded)': 'Action vérifiée (la personne qui l’a clôturée n’est pas enregistrée)',
    'Verification failed:': 'Échec de la vérification :',
    'Verify': 'Vérifier',
    '✓ verified': '✓ vérifiée',
    'awaiting verification': 'en attente de vérification',
    'Inspection': 'Inspection',
  };
  root.I18N_FR_INSPECTION_ACTIONS = Object.assign({}, STATIC, RUNTIME);
  root.I18N_FR_INSPECTION_ACTIONS_RUNTIME = Object.keys(RUNTIME);
})(typeof window !== 'undefined' ? window : globalThis);
