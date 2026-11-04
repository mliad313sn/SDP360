/* A-09b — French for public/rfi.html (Requests for improvement register).
 * Static markup first, then RUNTIME_KEYS (register headers, empty state, buttons built in JS).
 * NOT translated on purpose: the kind and status options built from the API (no value attribute → their
 * text IS the code sent back), request titles/problems (user data). Inert unless ui_i18n_pages='1'.
 */
(function (root) {
  'use strict';
  const STATIC = {
    'Requests for improvement (RFI)': 'Demandes d’amélioration (RFI)',
    'Anyone may submit an idea (tracker, widget, metric, integration, UX, data quality). The committee triages and scores it: score = impact × 3 − effort − data risk (help §25).':
      'Chacun peut proposer une idée (tracker, widget, indicateur, intégration, ergonomie, qualité des données). Le comité la trie et la note : score = impact × 3 − effort − risque données (aide §25).',
    'Submit a request': 'Soumettre une demande', 'Kind': 'Nature', 'Problem (what hurts today)': 'Problème (ce qui gêne aujourd’hui)',
    'Proposal (optional)': 'Proposition (facultatif)', 'all': 'toutes', 'Register (sorted by score)': 'Registre (trié par score)',
  };
  const RUNTIME_KEYS = {
    'Ref': 'Réf.', 'Impact': 'Impact', 'Effort': 'Effort', 'Data risk': 'Risque données', 'Score': 'Score', 'Decision': 'Décision',
    'Confirm delivery': 'Confirmer la livraison', 'No request.': 'Aucune demande.',
  };
  root.I18N_FR_RFI = Object.assign({}, STATIC, RUNTIME_KEYS);
  root.I18N_FR_RFI_RUNTIME = Object.keys(RUNTIME_KEYS);
})(typeof window !== 'undefined' ? window : globalThis);
