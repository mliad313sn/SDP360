/* Adoption Lot A (item 11) — French for public/inspections.html (static markup + the scope / not-measured wording).
 * NOT translated on purpose: site names, inspection ids (data). Inert unless ui_i18n_pages='1'.
 * Terms follow docs/ux/GLOSSARY-FR.md (PROPOSED — to be validated by a French-speaking coordinator). */
(function (root) {
  'use strict';
  const STATIC = {
    'Delete this inspection?': 'Supprimer cette inspection ?', 'Cancel · Annuler': 'Annuler', 'Delete · Supprimer': 'Supprimer',
    'IT Inspections': 'Inspections IT', 'Site inspections, findings, and corrective actions': 'Inspections de site, constats et actions correctives',
    'Actions register': 'Registre des actions', 'New inspection': 'Nouvelle inspection', 'Excel (full data)': 'Excel (toutes les données)',
    'All sites': 'Tous les sites', 'From': 'Du', 'To': 'Au', 'Risk': 'Risque', 'Any': 'Tous', 'Low': 'Faible', 'Moderate': 'Modéré',
    'High': 'Élevé', 'Critical': 'Critique', 'Reset': 'Réinitialiser', 'Inspections by status': 'Inspections par statut',
    'Findings by status': 'Constats par statut', 'Inspections by risk': 'Inspections par risque', 'Inspections by site': 'Inspections par site',
    'Repeat findings': 'Constats répétés', 'Inspections per month': 'Inspections par mois', 'ID': 'N°', 'Area': 'Zone', 'Inspector': 'Inspecteur',
    'No inspections match these filters.': 'Aucune inspection ne correspond à ces filtres.', 'Start the first one': 'Commencer la première',
    'Corrective actions register — track and close actions across all inspections': 'Registre des actions correctives — suivre et clôturer les actions de toutes les inspections',
    'Start a new inspection': 'Commencer une nouvelle inspection',
    'Download EVERY inspection, finding and corrective action as an Excel workbook (all sites, ignores filters). Admin only.':
      'Télécharger TOUTES les inspections, constats et actions correctives dans un classeur Excel (tous les sites, sans filtre). Administrateurs uniquement.',
    'Download a roll-up PPTX of the current filter (executive only)': 'Télécharger une présentation PPTX de synthèse du filtre courant (direction uniquement)',
  };
  const RUNTIME = {
    'No site in your scope': 'Aucun site dans votre périmètre',
    'Not measured — the data could not be read': 'Non mesuré — les données n’ont pas pu être lues',
    'Your account reads no site. Ask an administrator to add your site.': 'Votre compte ne lit aucun site. Demandez à un administrateur d’ajouter votre site.',
    'Retry with Refresh.': 'Réessayez avec Actualiser.',
    'Total inspections': 'Inspections au total', 'Critical risk': 'Risque critique', 'Open actions': 'Actions ouvertes', 'Overdue actions': 'Actions en retard',
    'Submitted': 'Soumises', 'Sites covered': 'Sites couverts', 'in current filter': 'dans le filtre courant', 'inspections flagged': 'inspections signalées',
    'not yet closed': 'pas encore clôturées', 'past due date': 'échéance dépassée', 'awaiting close-out': 'en attente de clôture', 'distinct sites': 'sites distincts',
  };
  root.I18N_FR_INSPECTIONS = Object.assign({}, STATIC, RUNTIME);
  root.I18N_FR_INSPECTIONS_RUNTIME = Object.keys(RUNTIME);
})(typeof window !== 'undefined' ? window : globalThis);
