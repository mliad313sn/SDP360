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
    'Download figures (CSV)': 'Télécharger les chiffres (CSV)', 'All dashboards': 'Tous les tableaux de bord',
    'Executive Scorecard': 'Tableau de performance de la direction',
    'Period (YYYY-MM or YYYY-Www)': 'Période (AAAA-MM ou AAAA-Sss)', 'latest': 'dernière',
    'Dashboard widgets': 'Widgets du tableau de bord',
  };
  root.I18N_FR_DASHBOARDS_RUNTIME = [];
})(typeof window !== 'undefined' ? window : globalThis);
