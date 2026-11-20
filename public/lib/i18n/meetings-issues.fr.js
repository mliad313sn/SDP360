/* Adoption Lot A (item 11) — French for public/meetings-issues.html (static markup). JS-built rows: next pass.
 * NOT translated on purpose: site, department, category codes, champions (data). Inert unless ui_i18n_pages='1'.
 * Terms follow docs/ux/GLOSSARY-FR.md (PROPOSED — to be validated by a French-speaking coordinator). */
(function (root) {
  'use strict';
  const STATIC = {
    'Insights · Issues Log': 'Insights · Journal des problèmes', 'Issues across all meetings': 'Problèmes de toutes les réunions',
    'Flat view of every issue raised in any Department Meeting or IT Survey concern.': 'Vue à plat de tous les problèmes soulevés en réunion de département ou par l’enquête IT.',
    'by site, department, category, severity, status or champion —': 'par site, département, catégorie, sévérité, statut ou champion —',
    'change a status inline': 'changez un statut sur place', "(recorded in the issue's audit trail) or": '(enregistré dans l’historique du problème) ou',
    'open in context': 'ouvrez-le dans son contexte', 'to jump to the parent PV. Overdue, HIGH and escalated rows are highlighted.': 'pour aller au PV d’origine. Les lignes en retard, ÉLEVÉES ou escaladées sont mises en évidence.',
    'Issues by category': 'Problèmes par catégorie', 'All sites': 'Tous les sites', 'All departments': 'Tous les départements',
    'All categories': 'Toutes les catégories', 'All severities': 'Toutes les sévérités', 'All statuses': 'Tous les statuts', 'All champions': 'Tous les champions',
    'All issues': 'Tous les problèmes', 'Escalated only': 'Escaladés uniquement', 'Not escalated': 'Non escaladés',
    'Search title / description / champion / affects…': 'Rechercher titre / description / champion / impact…',
    // a11y labels of the filters (Adoption Lot A, item 10)
    'Category': 'Catégorie', 'Severity': 'Sévérité', 'Champion': 'Champion', 'Escalation': 'Escalade', 'Search issues': 'Rechercher des problèmes',
  };
  root.I18N_FR_MEETINGS_ISSUES = Object.assign({}, STATIC);
  root.I18N_FR_MEETINGS_ISSUES_RUNTIME = [];   // JS-built rows: next pass
})(typeof window !== 'undefined' ? window : globalThis);
