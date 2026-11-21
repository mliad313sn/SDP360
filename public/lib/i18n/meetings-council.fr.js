/* P09 — French for public/meetings-council.html (static markup; runtime text built in JS is not covered yet — next pass).
 * NOT translated on purpose: site, department and theme values (data, option codes). Inert unless ui_i18n_pages='1'.
 * Terms follow docs/i18n/GLOSSAIRE-FR.md (PROPOSED — to be validated by a French-speaking coordinator).
 */
(function (root) {
  'use strict';
  const STATIC = {
    // I18N-QUALITY — severity options (md_severities name_fr)
    'High@status': 'Haute',
    'Medium@status': 'Moyenne',
    'Low@status': 'Basse',
    // I18N-QUALITY — whole sentence (lib/i18nText.js matches the block first; inline tags kept in the value)
    'Every issue marked Escalate = Yes in a Department Meeting flows here, grouped by Council theme. Click a theme chip to filter. Use this to drive the agenda of the next Mine IT Council session.': 'Chaque problème marqué <strong>Escalader = Oui</strong> lors d’une réunion de département arrive ici, regroupé par <strong>thème du Council</strong>. Cliquez sur un thème pour filtrer. Servez-vous-en pour préparer l’ordre du jour de la prochaine session du Mine IT Council.',
    'Insights · Mine IT Council escalations': 'Analyses · Escalades au Mine IT Council', 'Escalations awaiting the Council': 'Escalades en attente du Council',
'Escalate = Yes': 'Escalader = Oui',
'Council theme': 'Thème du Council',
    'All sites': 'Tous les sites', 'All departments': 'Tous les départements', 'All severities': 'Toutes les gravités', 'All reasons': 'Tous les motifs',
    'Search title / description / champion…': 'Rechercher titre / description / champion…',
  };
  root.I18N_FR_MEETINGS_COUNCIL = Object.assign({}, STATIC);
  root.I18N_FR_MEETINGS_COUNCIL_RUNTIME = [];   // JS-built rows: next pass
})(typeof window !== 'undefined' ? window : globalThis);
