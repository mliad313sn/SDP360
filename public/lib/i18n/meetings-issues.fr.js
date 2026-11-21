/* Adoption Lot A (item 11) — French for public/meetings-issues.html (static markup). JS-built rows: next pass.
 * NOT translated on purpose: site, department, category codes, champions (data). Inert unless ui_i18n_pages='1'.
 * Terms follow docs/i18n/GLOSSAIRE-FR.md (PROPOSED — to be validated by a French-speaking coordinator). */
(function (root) {
  'use strict';
  const STATIC = {
    // I18N-QUALITY — severity options (md_severities name_fr)
    'High@status': 'Haute',
    'Medium@status': 'Moyenne',
    'Low@status': 'Basse',
    // I18N-QUALITY — whole sentence (lib/i18nText.js matches the block first; inline tags kept in the value)
    'Flat view of every issue raised in any Department Meeting or IT Survey concern. Filter by site, department, category, severity, status or champion — change a status inline (recorded in the issue\'s audit trail) or open in context to jump to the parent PV. Overdue, HIGH and escalated rows are highlighted.': 'Vue à plat de tous les problèmes soulevés en réunion de département ou par l’enquête IT. <strong>Filtrez</strong> par site, département, catégorie, gravité, statut ou champion — <strong>changez un statut sur place</strong> (enregistré dans l’historique du problème) ou <strong>ouvrez-le dans son contexte</strong> pour aller au PV d’origine. Les lignes en retard, de gravité haute ou escaladées sont mises en évidence.',
    'Insights · Issues Log': 'Analyses · Journal des problèmes', 'Issues across all meetings': 'Problèmes de toutes les réunions',
    'Issues by category': 'Problèmes par catégorie', 'All sites': 'Tous les sites', 'All departments': 'Tous les départements',
    'All categories': 'Toutes les catégories', 'All severities': 'Toutes les gravités', 'All statuses': 'Tous les statuts', 'All champions': 'Tous les champions',
    'All issues': 'Tous les problèmes', 'Escalated only': 'Escaladés uniquement', 'Not escalated': 'Non escaladés',
    'Search title / description / champion / affects…': 'Rechercher titre / description / champion / impact…',
    // a11y labels of the filters (Adoption Lot A, item 10)
    'Category': 'Catégorie', 'Severity': 'Sévérité', 'Champion': 'Champion', 'Escalation': 'Escalade', 'Search issues': 'Rechercher des problèmes',
  };
  const RUNTIME = {
    // P11 r4 F-12 — texts built in script (toasts, empty states, row buttons, table heads)
    'Editor role or higher required to change status': 'Rôle éditeur ou supérieur requis pour changer le statut',
    'Total issues': 'Problèmes au total',
    'HIGH severity': 'Gravité HAUTE',
    'Open': 'Ouverts', 'Open@status': 'Ouvert',
    'Escalated': 'Escaladé',
    'Overdue': 'En retard',
    'in scope': 'dans le périmètre',
    'production-impact': 'impact sur la production',
    'not yet resolved': 'pas encore résolus',
    'open for Council': 'ouverts pour le Council',
    'past target date': 'échéance dépassée',
    'Issue updated →': 'Problème mis à jour →',
    'Update failed:': 'Échec de la mise à jour :',
    'No issues yet for the active filter.': 'Aucun problème pour le filtre actif.',
    'Ref': 'Réf.',
    'Category': 'Catégorie',
    'Severity': 'Gravité',
    'Champion': 'Champion',
    'Target': 'Échéance',
    'No issues match the current filter.': 'Aucun problème ne correspond au filtre courant.',
    'Open ›': 'Ouvrir ›',
    'Failed to load issues.': 'Échec du chargement des problèmes.',
  };
  root.I18N_FR_MEETINGS_ISSUES = Object.assign({}, STATIC, RUNTIME);
  root.I18N_FR_MEETINGS_ISSUES_RUNTIME = Object.keys(RUNTIME);
})(typeof window !== 'undefined' ? window : globalThis);
