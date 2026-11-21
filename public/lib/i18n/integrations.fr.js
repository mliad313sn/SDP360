/* Adoption Lot B (item 7) — French for public/integrations.html (admin; static markup, JS-built rows later).
 * Inert unless report_config ui_i18n_pages = '1'. Terms follow docs/i18n/GLOSSAIRE-FR.md (PROPOSED). NOT translated:
 * endpoint paths, header names, configuration key prefixes and option texts that are the values sent to the API. */
(function (root) {
  'use strict';
  const STATIC = {
    'Integrations & alert rules': 'Intégrations et règles d’alerte',
    'Admin. Alert rules (metric, scope, condition, anti-noise, channels, recipients) · API consumers (per-key quota and log) · OData feed for Power BI · connectors (scheduled Excel, webhook, SharePoint list) · share links.':
      'Administration. Règles d’alerte (indicateur, périmètre, condition, anti-bruit, canaux, destinataires) · consommateurs de l’API (quota et journal par clé) · flux OData pour Power BI · connecteurs (Excel planifié, webhook, liste SharePoint) · liens de partage.',
    'Alert rules': 'Règles d’alerte', 'Dry run (nothing sent)': 'Simulation (rien n’est envoyé)', 'Evaluate now': 'Évaluer maintenant',
    'Target: ≥ 10 rules live, false positives < 5 % (mark them in the firings table).': 'Cible : ≥ 10 règles actives, faux positifs < 5 % (à signaler dans le tableau des déclenchements).',
    'New / edit rule': 'Nouvelle / modifier une règle', 'Key': 'Clé', 'Metric': 'Indicateur', 'Scope': 'Périmètre', 'Site id (optional)': 'Id du site (facultatif)',
    'Operator': 'Opérateur', 'Threshold (number, or RAG list e.g. RED)': 'Seuil (nombre, ou liste RAG ex. RED)', 'Streak': 'Série', 'Cool-down (min)': 'Délai de répit (min)',
    'Channels (comma)': 'Canaux (séparés par des virgules)', 'Recipient roles (comma)': 'Rôles destinataires (séparés par des virgules)',
    'Recipient e-mails (comma)': 'E-mails destinataires (séparés par des virgules)', 'Severity': 'Gravité', 'info': 'info', 'warning': 'avertissement',
    'critical': 'critique', 'Enabled': 'Active', 'yes': 'oui', 'no': 'non', 'Save rule': 'Enregistrer la règle', 'Delete rule': 'Supprimer la règle',
    'Recent firings (30 days)': 'Déclenchements récents (30 jours)', 'API consumers': 'Consommateurs de l’API', 'Quota / day': 'Quota / jour',
    'Create key': 'Créer une clé', '· OData (Power BI → Get data → OData feed):': '· OData (Power BI → Obtenir des données → Flux OData) :',
    '· key in a header only:': '· clé dans un en-tête uniquement :', 'or': 'ou', 'is refused) · 60 calls/min per key.': 'est refusé) · 60 appels/min par clé.',
    'Share links': 'Liens de partage',
    'Connector settings (Teams / webhook URLs, SharePoint registration, scheduled Excel recipients, metric keys, embed frame-ancestors) live in Admin ▸ configuration keys':
      'Les réglages des connecteurs (URL Teams / webhook, inscription SharePoint, destinataires de l’Excel planifié, clés d’indicateurs, frame-ancestors d’intégration) se trouvent dans Admin ▸ clés de configuration',
    '; secrets are write-only.': ' ; les secrets sont en écriture seule.',
  };
  root.I18N_FR_INTEGRATIONS = Object.assign({}, STATIC);
  root.I18N_FR_INTEGRATIONS_RUNTIME = [];   // JS-built rows: later pass
})(typeof window !== 'undefined' ? window : globalThis);
