/* Adoption Lot B (item 7) — French for public/report-studio.html (static markup; JS-built rows are a later pass).
 * Inert unless report_config ui_i18n_pages = '1'. Terms follow docs/ux/GLOSSARY-FR.md (PROPOSED). NOT translated:
 * the run-status option texts (they are the values sent to the API) and template keys (data). */
(function (root) {
  'use strict';
  const STATIC = {
    'Report studio': 'Studio de rapports',
    "Templates per audience built on a published dashboard → generated packs (figures = the dashboard's, zero manual entry) → deterministic analysis + AI commentary verified against the canonical figures → human review → publication. Outputs HTML · PDF · CSV · XLSX · PPTX (help §26).":
      'Modèles par public construits sur un tableau de bord publié → dossiers générés (chiffres = ceux du tableau de bord, aucune saisie manuelle) → analyse déterministe + commentaire IA vérifié contre les chiffres de référence → relecture humaine → publication. Sorties HTML · PDF · CSV · XLSX · PPTX (aide §26).',
    'Templates': 'Modèles', 'New / edit template': 'Nouveau / modifier un modèle', 'Key': 'Clé', 'Audience': 'Public', 'Dashboard': 'Tableau de bord',
    'Language': 'Langue', 'English': 'Anglais', 'Français': 'Français', 'Cadence': 'Fréquence', 'AI commentary': 'Commentaire IA',
    'on (when a provider is configured)': 'activé (si un fournisseur est configuré)', 'off — deterministic only': 'désactivé — déterministe uniquement',
    'Save template': 'Enregistrer le modèle', 'Generate': 'Générer', 'Template': 'Modèle', 'Site (site templates)': 'Site (modèles de site)',
    '— first site in my scope —': '— premier site de mon périmètre —', 'Window (optional, e.g. 2026-09 or 2026-W40)': 'Période (facultative, ex. 2026-09 ou 2026-W40)',
    'Template default': 'Valeur du modèle', 'Generate draft': 'Générer un brouillon', 'Runs': 'Exécutions', 'all I can see': 'tout ce que je peux voir',
    'Review note': 'Note de relecture', 'Usefulness of the commentary (1-5)': 'Utilité du commentaire (1-5)', 'Mark reviewed': 'Marquer comme relu',
    'Reject': 'Rejeter', 'Publish': 'Publier', 'Withdraw': 'Retirer', 'Regenerate AI commentary': 'Régénérer le commentaire IA',
    'Commentary (editable until publication)': 'Commentaire (modifiable jusqu’à la publication)', 'Save commentary': 'Enregistrer le commentaire',
    'Report preview': 'Aperçu du rapport',
  };
  root.I18N_FR_REPORT_STUDIO = Object.assign({}, STATIC);
  root.I18N_FR_REPORT_STUDIO_RUNTIME = [];   // JS-built rows: later pass
})(typeof window !== 'undefined' ? window : globalThis);
