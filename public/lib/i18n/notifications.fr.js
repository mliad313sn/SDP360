/* Adoption Lot B (item 7) — French for public/notifications.html (static markup; JS-built rows are a later pass).
 * Inert unless report_config ui_i18n_pages = '1'. Terms follow docs/i18n/GLOSSAIRE-FR.md (PROPOSED — to be validated
 * by a French-speaking coordinator). NOT translated: option texts that are the values sent to the API. */
(function (root) {
  'use strict';
  const STATIC = {
    'Notifications': 'Notifications',
    'Alerts, report packs and governance events addressed to you. Comment from here; subscribe to templates, dashboards or alert rules; choose a daily or weekly digest (help §26).':
      'Alertes, dossiers de rapports et événements de gouvernance qui vous sont adressés. Commentez ici ; abonnez-vous à des modèles, tableaux de bord ou règles d’alerte ; choisissez un récapitulatif quotidien ou hebdomadaire (aide §26).',
    '0 unread': '0 non lue', 'Mark all read': 'Tout marquer comme lu', 'Show': 'Afficher', 'unread': 'non lues', 'all': 'toutes',
    'My subscriptions': 'Mes abonnements', 'Kind': 'Type', 'Target key': 'Clé de la cible', 'Channel': 'Canal', 'Digest': 'Récapitulatif',
    'Subscribe': 'S’abonner', 'Alert rules': 'Règles d’alerte',
    'Rules are evaluated every 15 min by the shared runner; a rule fires after its streak of breaches, then stays quiet for its cool-down. A value that is not measured never fires.':
      'Les règles sont évaluées toutes les 15 min par le planificateur commun ; une règle se déclenche après sa série de dépassements, puis reste silencieuse pendant son délai de répit. Une valeur non mesurée ne déclenche jamais.',
    'Post comment': 'Publier le commentaire',
  };
  root.I18N_FR_NOTIFICATIONS = Object.assign({}, STATIC);
  root.I18N_FR_NOTIFICATIONS_RUNTIME = [];   // JS-built rows: later pass
})(typeof window !== 'undefined' ? window : globalThis);
