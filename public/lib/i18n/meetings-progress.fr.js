/* P09 — French for public/meetings-progress.html (static markup; runtime text built in JS is not covered yet — next pass).
 * NOT translated on purpose: site, department and theme values (data, option codes). Inert unless ui_i18n_pages='1'.
 * Terms follow docs/ux/GLOSSARY-FR.md (PROPOSED — to be validated by a French-speaking coordinator).
 */
(function (root) {
  'use strict';
  const STATIC = {
    'Insights · Meetings · Pre-brief': 'Insights · Réunions · Pré-brief', 'Since last meeting — department progress': 'Depuis la dernière réunion — avancement du département',
    "Pick a site + department to see what's standing, what closed since the last PV, what came up new, and the audit trail of every status change. Use this to walk into the next meeting with the full picture.": 'Choisissez un site et un département pour voir ce qui reste ouvert, ce qui a été clôturé depuis le dernier PV, ce qui est nouveau, et l’historique de chaque changement de statut. Pour arriver à la prochaine réunion avec une vue complète.',
    'As of': 'Au', '▶ Load progress': '▶ Charger l’avancement', '📤 PDF': '📤 PDF', '📤 PPTX': '📤 PPTX',
    'Pick a site and a department, then click': 'Choisissez un site et un département, puis cliquez sur', 'Load progress': 'Charger l’avancement',
    'Print or save as PDF (Ctrl+P)': 'Imprimer ou enregistrer en PDF (Ctrl+P)', 'Download server-generated PPTX deck': 'Télécharger la présentation PPTX générée par le serveur',
  };
  root.I18N_FR_MEETINGS_PROGRESS = Object.assign({}, STATIC);
  root.I18N_FR_MEETINGS_PROGRESS_RUNTIME = [];   // JS-built rows: next pass
})(typeof window !== 'undefined' ? window : globalThis);
