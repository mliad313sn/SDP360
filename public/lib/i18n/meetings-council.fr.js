/* P09 — French for public/meetings-council.html (static markup; runtime text built in JS is not covered yet — next pass).
 * NOT translated on purpose: site, department and theme values (data, option codes). Inert unless ui_i18n_pages='1'.
 * Terms follow docs/ux/GLOSSARY-FR.md (PROPOSED — to be validated by a French-speaking coordinator).
 */
(function (root) {
  'use strict';
  const STATIC = {
    'Insights · Mine IT Council escalations': 'Insights · Escalades au Mine IT Council', 'Escalations awaiting the Council': 'Escalades en attente du Council',
    'Every issue marked': 'Chaque problème marqué', 'Escalate = Yes': 'Escalader = Oui',
    'in a Department Meeting flows here, grouped by': 'lors d’une réunion de département arrive ici, regroupé par', 'Council theme': 'Thème Council',
    '. Click a theme chip to filter. Use this to drive the agenda of the next Mine IT Council session.': '. Cliquez sur un thème pour filtrer. Servez-vous-en pour bâtir l’ordre du jour de la prochaine session du Mine IT Council.',
    'All sites': 'Tous les sites', 'All departments': 'Tous les départements', 'All severities': 'Toutes les sévérités', 'All reasons': 'Tous les motifs',
    'Search title / description / champion…': 'Rechercher titre / description / champion…',
  };
  root.I18N_FR_MEETINGS_COUNCIL = Object.assign({}, STATIC);
  root.I18N_FR_MEETINGS_COUNCIL_RUNTIME = [];   // JS-built rows: next pass
})(typeof window !== 'undefined' ? window : globalThis);
