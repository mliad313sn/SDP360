/* C-26 (G27) — French for public/dashboards.html (published group dashboards). Widget titles, KPI names and figures
 * come from the KPI dictionary / the API and are data: never keys here. Inert unless ui_i18n_pages='1'.
 * Glossary: docs/ux/GLOSSARY-FR.md. */
(function (root) {
  'use strict';
  root.I18N_FR_DASHBOARDS = {
    'Dashboards': 'Tableaux de bord',
    'Published dashboards — every figure comes from the KPI dictionary and is dated.':
      'Tableaux de bord publiés — chaque chiffre vient du dictionnaire des KPI et porte sa date.',
    'Period': 'Période', 'Apply': 'Appliquer', 'Edit in composer': 'Modifier dans le compositeur',
    'Download figures (CSV)': 'Télécharger les chiffres (CSV)', 'All dashboards': 'Tous les tableaux de bord', 'Show notes': 'Afficher les notes', 'Add a note': 'Ajouter une note', 'Save note': 'Enregistrer la note',
    'Executive Scorecard': 'Tableau de performance de la direction',
    'Period (YYYY-MM or YYYY-Www)': 'Période (AAAA-MM ou AAAA-Sss)', 'latest': 'dernière',
    'Dashboard widgets': 'Widgets du tableau de bord',
    // E-V03 — the standard state vocabulary (public/lib/stateBadge.js) and the KPI base line
    'Loading…': 'Chargement…', 'No data for this period': 'Aucune donnée pour cette période', 'not measured': 'non mesuré',
    'Source not current — colour withheld': 'Source périmée — couleur retenue', 'Source never synced — colour withheld': 'Source jamais synchronisée — couleur retenue',
    'Source not monitored': 'Source non surveillée', 'Could not load — try again': 'Chargement impossible — réessayez',
    'You do not have access to this figure': 'Vous n’avez pas accès à ce chiffre', 'Value not certified': 'Valeur non certifiée',
    'Export in progress': 'Export en cours', 'Publication blocked': 'Publication bloquée',
    'base not measured': 'base non mesurée', '→ act': '→ agir',
    // F-UX-03 — 'partial' state and the partial-period note ("2026-11 période partielle · données au 4 nov.")
    'Partial — some sources missing, total unknown': 'Partiel — sources manquantes, total inconnu',
    'is partial · data to': 'période partielle · données au',
  };
  // (the state texts are rendered by lib/stateBadge.js / lib/dashboardRender.js, not by the page source)
  root.I18N_FR_DASHBOARDS_RUNTIME = [];
})(typeof window !== 'undefined' ? window : globalThis);
