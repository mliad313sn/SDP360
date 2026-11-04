/* A-09a — French words shared by every translated page (exact-text keys for public/lib/i18nText.js).
 * A page installs Object.assign({}, I18N_FR_COMMON, I18N_FR_<PAGE>) — the page dictionary wins on a clash.
 * INERT unless report_config ui_i18n_pages = '1' (window.__uiPolicy.i18n_pages). Keys are visible text only,
 * never a status CODE sent back to the server (option value attributes are never touched).
 */
(function (root) {
  'use strict';
  root.I18N_FR_COMMON = {
    // actions
    'Save': 'Enregistrer', 'Save now': 'Enregistrer maintenant', 'Cancel': 'Annuler', 'Close': 'Fermer', 'Open': 'Ouvrir',
    'Edit': 'Modifier', 'Delete': 'Supprimer', 'Add': 'Ajouter', 'Submit': 'Soumettre', 'Print': 'Imprimer',
    'Export': 'Exporter', 'Export CSV': 'Exporter en CSV', 'Filter': 'Filtrer', 'Search': 'Rechercher', 'Clear': 'Effacer',
    'Undo': 'Annuler l’action', 'Post': 'Publier', 'Install': 'Installer', 'Dismiss': 'Ignorer', 'Retry': 'Réessayer',
    'Yes': 'Oui', 'No': 'Non', 'All': 'Tous', 'None': 'Aucun',
    // common labels
    'Status': 'Statut', 'Site': 'Site', 'Owner': 'Responsable', 'Due': 'Échéance', 'Due date': 'Échéance',
    'Date': 'Date', 'Title': 'Titre', 'Name': 'Nom', 'Type': 'Type', 'Department': 'Département', 'Priority': 'Priorité',
    'Notes': 'Notes', 'Comment': 'Commentaire', 'Description': 'Description', 'Action': 'Action', 'Actions': 'Actions',
    'Issue': 'Problème', 'Issues': 'Problèmes', 'Age': 'Âge', 'Progress': 'Avancement', 'Summary': 'Synthèse',
    'Loading…': 'Chargement…', 'Loading...': 'Chargement…', 'Skip to content': 'Aller au contenu',
    // statuses (labels of public/lib/statusTransfer.js STATUS_EN + inspection capitalised variants)
    'In progress': 'En cours', 'In Progress': 'En cours', 'Blocked': 'Bloqué', 'On hold': 'En attente',
    'Resolved': 'Résolu', 'Closed': 'Clôturé', 'Cancelled': 'Annulé', 'Demand / Initiative': 'Demande / Initiative',
    'Helpdesk ticket': 'Ticket Helpdesk', 'Draft': 'Brouillon', 'Submitted': 'Soumis', 'Signed': 'Signé',
    // RAG
    'Green': 'Vert', 'Amber': 'Orange', 'Red': 'Rouge', 'On track': 'Dans les temps', 'At risk': 'À risque',
    'Off track': 'En retard', 'Overdue': 'En retard', 'late': 'en retard',
    // months and weekdays
    'January': 'janvier', 'February': 'février', 'March': 'mars', 'April': 'avril', 'June': 'juin', 'July': 'juillet',
    'August': 'août', 'September': 'septembre', 'October': 'octobre', 'November': 'novembre', 'December': 'décembre',
    'Jan': 'janv.', 'Feb': 'févr.', 'Mar': 'mars', 'Apr': 'avr.', 'May': 'mai', 'Jun': 'juin', 'Jul': 'juil.',
    'Aug': 'août', 'Sep': 'sept.', 'Oct': 'oct.', 'Nov': 'nov.', 'Dec': 'déc.',
    'Monday': 'lundi', 'Tuesday': 'mardi', 'Wednesday': 'mercredi', 'Thursday': 'jeudi', 'Friday': 'vendredi',
    'Saturday': 'samedi', 'Sunday': 'dimanche',
  };
})(typeof window !== 'undefined' ? window : globalThis);
