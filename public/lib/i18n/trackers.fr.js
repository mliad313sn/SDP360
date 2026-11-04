/* A-09b — French for public/trackers.html (generic activity trackers: list, scores, entry grid).
 * Static markup first, then RUNTIME_KEYS (table headers, empty states, buttons the page builds in JS).
 * Tracker, unit and item names come from the tracker definition (user data) and are never keys.
 * Strings with an embedded value ("Saved 3 cell(s)", "to Jan") stay English. Inert unless ui_i18n_pages='1'.
 */
(function (root) {
  'use strict';
  const STATIC = {
    'Trackers': 'Trackers', 'Generic activity trackers — every score comes from the engine (help §24).': 'Trackers d’activité génériques — chaque score vient du moteur (aide §24).',
    'Unit': 'Unité', 'Period reached': 'Période atteinte', 'Save entries': 'Enregistrer les saisies', 'Import xlsx': 'Importer un xlsx',
    'Excel': 'Excel', 'PPTX': 'PPTX', 'Open in builder': 'Ouvrir dans le constructeur', 'All trackers': 'Tous les trackers',
    'Scores': 'Scores', 'Entries —': 'Saisies —',
  };
  const RUNTIME_KEYS = {
    'No published tracker yet.': 'Aucun tracker publié pour l’instant.', 'Templates (builder)': 'Modèles (constructeur)', 'New tracker': 'Nouveau tracker',
    'Migrate the IT Activity Tracker': 'Migrer le tracker d’activité IT', 'No score yet.': 'Pas encore de score.', 'Score': 'Score', 'RAG': 'RAG',
    'Item': 'Élément', 'Total': 'Total', 'Nothing to save': 'Rien à enregistrer',
  };
  root.I18N_FR_TRACKERS = Object.assign({}, STATIC, RUNTIME_KEYS);
  root.I18N_FR_TRACKERS_RUNTIME = Object.keys(RUNTIME_KEYS);
})(typeof window !== 'undefined' ? window : globalThis);
