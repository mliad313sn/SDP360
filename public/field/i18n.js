/* Field app — French first (UAT F-03). Static texts are swapped by ../lib/i18nText.js; app.js routes its
 * own messages through window.FT(). French is the default unless the phone was set to English here. */
(function () {
  'use strict';
  var DICT = {
    // G19 — outbox states and messages
    'already applied (earlier version)': 'déjà appliqué (version précédente)', 'unknown author — review': 'auteur inconnu — à vérifier', 'Send as me': 'Envoyer en mon nom',
    '(sending it unchanged will be refused again)': '(renvoyée telle quelle, elle sera de nouveau refusée)', 'Photo upload: ': 'Envoi de la photo : ', 'Could not queue: ': 'Mise en file impossible : ',
    'waiting': 'en attente', 'will retry': 'nouvel essai prévu', 'refused': 'refusé', 'conflict': 'conflit', 'other user': 'autre utilisateur',
    'Send again': 'Renvoyer', 'Discard': 'Abandonner', 'waiting for': 'en attente depuis', 'days': 'jours', 'sign in as': 'connectez-vous en tant que', 'to send it': 'pour l’envoyer',
    'Session expired — sign in again. Nothing was lost: your entries are kept on this phone.': 'Session expirée — reconnectez-vous. Rien n’est perdu : vos saisies restent sur ce téléphone.',
    'Discard this entry for good?': 'Abandonner définitivement cette saisie ?', 'cached data is': 'les données en cache datent de', 'days old, sync when you can': 'jours, synchronisez dès que possible',
    'Skip to content': 'Aller au contenu', 'IT Field': 'IT Terrain', 'My site': 'Mon site', 'Site': 'Site',
    'Sync now': 'Synchroniser', 'Data as of': 'Données au', 'Data as of —': 'Données au —', 'Low-bandwidth mode (no photos, fewer refreshes)': 'Mode faible débit (sans photos, moins de rafraîchissements)',
    'Today': 'Aujourd’hui', 'Pending on this phone': 'En attente sur ce téléphone', 'Nothing queued.': 'Rien en attente.',
    'Quick inspection': 'Inspection rapide', 'Area': 'Zone', 'Category': 'Catégorie', 'Inspector': 'Inspecteur', 'Your name': 'Votre nom',
    'Photo (≤ 300 KB after compression)': 'Photo (≤ 300 Ko après compression)', 'Observations': 'Observations',
    'Queue inspection': 'Mettre l’inspection en file', 'Clear': 'Effacer', 'Tracker entry': 'Saisie tracker', 'Tracker': 'Tracker',
    'Unit': 'Unité', 'Period': 'Période', 'Queue entries': 'Mettre les saisies en file',
    'A closed month is kept as stored on the server (the entry is reported as blocked, never lost silently).': 'Un mois clôturé garde la valeur enregistrée sur le serveur (la saisie est signalée bloquée, jamais perdue en silence).',
    'Open actions': 'Actions ouvertes', 'Report to the helpdesk': 'Signaler au helpdesk',
    'Ticket creation from the field is not enabled by the administrator.': 'La création de ticket depuis le terrain n’est pas activée par l’administrateur.',
    'Subject': 'Objet', 'Details': 'Détails', 'Queue ticket': 'Mettre le ticket en file', 'My site — field': 'Mon site — terrain',
    'Home': 'Accueil', 'Inspect': 'Inspecter', 'Actions': 'Actions', 'Dashboard': 'Tableau de bord', 'Sections': 'Sections',
    'Justification': 'Justification', 'Comment': 'Commentaire', 'SDP ticket number': 'Numéro de ticket SDP', 'Confirm': 'Confirmer', 'Cancel': 'Annuler',
    'items waiting to sync': 'éléments en attente de synchronisation',
    'Online': 'En ligne', 'Offline': 'Hors ligne', 'open actions': 'actions ouvertes', 'overdue': 'en retard', 'trackers to fill': 'trackers à remplir',
    'Working from cached data (offline).': 'Données en cache (hors ligne).', 'Queued — it will sync when online.': 'En file — envoi dès le retour du réseau.',
    'Sync problem: ': 'Problème de synchronisation : ', 'Synced: ': 'Envoyé : ', 'Refused: ': 'Refusé : ', '(cached)': '(cache)',
    'Pick a site with an inspection code first.': 'Choisissez d’abord un site qui a un code d’inspection.',
    'Mark at least one item or add a photo.': 'Notez au moins un point ou ajoutez une photo.', 'Enter at least one value.': 'Saisissez au moins une valeur.',
    'No open action for this site.': 'Aucune action ouverte pour ce site.', 'due': 'échéance', 'Close': 'Clôturer', '→ Ticket': '→ Ticket', '→ Demand': '→ Demande',
    'A justification is required for this status.': 'Une justification est obligatoire pour ce statut.',
    'The SDP ticket number is required.': 'Le numéro de ticket SDP est obligatoire.', 'Subject required.': 'Objet obligatoire.',
    'No widget': 'Aucun indicateur', '— (not measured)': '— (non mesuré)', 'cached': 'cache', 'unavailable': 'indisponible',
    'Photo added': 'Photo ajoutée', 'ok': 'ok', 'minor': 'mineur', 'major': 'majeur', 'critical': 'critique', 'na': 'n/a',
  };
  window.FT = function (s) { return window.I18nText ? window.I18nText.t(s) : s; };
  try { if (!localStorage.getItem('field_lang')) localStorage.setItem('field_lang', 'fr'); } catch (_) { /* private mode: French stays the default below */ }
  if (window.I18nText) {
    window.I18nText.install({ dict: DICT, storageKey: 'field_lang', toggle: { en: document.getElementById('lang-en'), fr: document.getElementById('lang-fr') }, root: document.body });
  }
})();
