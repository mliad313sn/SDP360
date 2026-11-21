/* P09 — French for public/meetings-unsigned.html (static markup; runtime text built in JS is not covered yet — next pass).
 * NOT translated on purpose: site, department and theme values (data, option codes). Inert unless ui_i18n_pages='1'.
 * Terms follow docs/i18n/GLOSSAIRE-FR.md (PROPOSED — to be validated by a French-speaking coordinator).
 */
(function (root) {
  'use strict';
  const STATIC = {
    // I18N-QUALITY — whole sentence (lib/i18nText.js matches the block first; inline tags kept in the value)
    'Every meeting report (PV) still missing the department head or site IT signature, across all sites, in one list — so you can validate them in place without opening each PV. Signing is a validation act in the tool: signing today = validated today; the timestamp is the server\'s and the first stamp is final. A signed signature can\'t be changed. Signing feeds the site programme score (sign-off is a scored dimension).': 'Tous les comptes rendus de réunion (PV) auxquels il manque encore la signature du <strong>chef de département</strong> ou du <strong>responsable IT du site</strong>, tous sites confondus, dans une seule liste — pour les valider sur place sans ouvrir chaque PV. Signer est un acte de validation dans l’outil : <strong>signer aujourd’hui = validé aujourd’hui</strong> ; l’horodatage est celui du serveur et la première signature est définitive. Une signature apposée ne peut plus être modifiée. La signature compte dans le score programme du site (la <strong>validation</strong> est une dimension notée).',
    'Insights · Unsigned PVs': 'Analyses · PV non signés', 'PVs awaiting signature': 'PV en attente de signature',
    'department head': 'chef de département','site IT': 'responsable IT du site',
    'signing today = validated today': 'signer aujourd’hui = validé aujourd’hui',
    'sign-off': 'validation',    'Unsigned PVs': 'PV non signés', 'All sites': 'Tous les sites',
  };
  root.I18N_FR_MEETINGS_UNSIGNED = Object.assign({}, STATIC);
  root.I18N_FR_MEETINGS_UNSIGNED_RUNTIME = [];   // JS-built rows: next pass
})(typeof window !== 'undefined' ? window : globalThis);
