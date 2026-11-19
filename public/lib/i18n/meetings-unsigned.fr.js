/* P09 — French for public/meetings-unsigned.html (static markup; runtime text built in JS is not covered yet — next pass).
 * NOT translated on purpose: site, department and theme values (data, option codes). Inert unless ui_i18n_pages='1'.
 * Terms follow docs/ux/GLOSSARY-FR.md (PROPOSED — to be validated by a French-speaking coordinator).
 */
(function (root) {
  'use strict';
  const STATIC = {
    'Insights · Unsigned PVs': 'Insights · PV non signés', 'PVs awaiting signature': 'PV en attente de signature',
    'Every meeting report (PV) still missing the': 'Chaque compte rendu de réunion (PV) auquel il manque encore la signature du',
    'department head': 'chef de département', 'or': 'ou', 'site IT': 'responsable IT du site',
    'signature, across all sites, in one list — so you can validate them in place without opening each PV. Signing is a validation act in the tool:': ', tous sites confondus, dans une seule liste — pour les valider sur place sans ouvrir chaque PV. Signer est un acte de validation dans l’outil :',
    'signing today = validated today': 'signer aujourd’hui = validé aujourd’hui',
    "; the timestamp is the server's and the first stamp is final. A signed signature can't be changed. Signing feeds the site programme score (": ' ; l’horodatage est celui du serveur et la première signature est définitive. Une signature apposée ne se modifie pas. La signature alimente le score programme du site (',
    'sign-off': 'validation', 'is a scored dimension).': 'est une dimension notée).',
    'Unsigned PVs': 'PV non signés', 'All sites': 'Tous les sites',
  };
  root.I18N_FR_MEETINGS_UNSIGNED = Object.assign({}, STATIC);
  root.I18N_FR_MEETINGS_UNSIGNED_RUNTIME = [];   // JS-built rows: next pass
})(typeof window !== 'undefined' ? window : globalThis);
