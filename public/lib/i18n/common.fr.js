/* A-09a — French words shared by every translated page (exact-text keys for public/lib/i18nText.js).
 * A page installs Object.assign({}, I18N_FR_COMMON, I18N_FR_<PAGE>) — the page dictionary wins on a clash.
 * INERT unless report_config ui_i18n_pages = '1' (window.__uiPolicy.i18n_pages). Keys are visible text only,
 * never a status CODE sent back to the server (option value attributes are never touched).
 * I18N-QUALITY — 'Key@status' is the status sense of an ambiguous word ('Open' → « Ouvrir » on a button, 'Open@status' →
 * « Ouvert » in an <option> or a status pill); lib/i18nText.js picks it from the text's place. Glossary: docs/i18n/GLOSSAIRE-FR.md.
 */
(function (root) {
  'use strict';
  root.I18N_FR_COMMON = {
    // actions
    'Save': 'Enregistrer', 'Save now': 'Enregistrer maintenant', 'Cancel': 'Annuler', 'Close': 'Fermer', 'Open': 'Ouvrir', 'Open@status': 'Ouvert',
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
    // I18N-QUALITY — form validation sentences sent by the server (services/userErrors.js; the raw code stays in error_code)
    'Choose a department before saving.': 'Choisissez un département avant d’enregistrer.',
    'Choose a site before saving.': 'Choisissez un site avant d’enregistrer.',
    'Enter the meeting date before saving.': 'Saisissez la date de la réunion avant d’enregistrer.',
    'The form is empty — reload the page and try again.': 'Le formulaire est vide — rechargez la page et réessayez.',
    'Your role cannot save here — ask an administrator for the editor role.': 'Votre rôle ne permet pas d’enregistrer ici — demandez le rôle « éditeur » à un administrateur.',
    'Your account has no site assigned for this module. Contact your administrator.': 'Aucun site n’est attribué à votre compte pour ce module. Contactez votre administrateur.',
    'Describe the action before saving.': 'Décrivez l’action avant d’enregistrer.',
    'This issue no longer exists — reload the page.': 'Ce problème n’existe plus — rechargez la page.',
    'This action no longer exists — reload the page.': 'Cette action n’existe plus — rechargez la page.',
    'This meeting report no longer exists — reload the page.': 'Ce compte rendu de réunion n’existe plus — rechargez la page.',
  };
  // I18N-QUALITY — display names of the meetings lookups (meetings-init.json name_en → name_fr), merged by boot.js.
  /* <generated:lookup-labels> — tools/i18n/build-code-labels.js, do not edit by hand */
  root.I18N_FR_LOOKUPS = {
    "Mining": "Exploitation minière",
    "Mobile Maintenance": "Maintenance mobile",
    "Process@status": "Process / Procédé",
    "Mill / Plant": "Usine / Plant",
    "Geology": "Géologie",
    "Survey@status": "Topographie",
    "Security@status": "Sécurité",
    "Engineering": "Ingénierie",
    "HR@status": "Ressources Humaines",
    "Other@status": "Autre",
    "Connectivity & Network": "Connectivité & Réseau",
    "End-user hardware & devices": "Matériel utilisateur",
    "Server & infrastructure": "Serveurs & infrastructure",
    "OT / Industrial systems": "Systèmes OT / industriels",
    "Applications & business software": "Applications métier",
    "Cybersecurity": "Cybersécurité",
    "Data & reporting": "Données & reporting",
    "Licensing & vendors": "Licences & fournisseurs",
    "Department Meeting": "Réunion départementale",
    "IT Survey": "Enquête IT",
    "Business Incubation": "Incubation métier",
    "Ad-hoc@status": "Ponctuel",
    "Cross-site impact": "Impact multi-sites",
    "Group decision required": "Décision Groupe requise",
    "CapEx beyond site authority": "CapEx hors autorité site",
    "Strategic / standardisation": "Standardisation / stratégique",
    "Stuck on Group dependency": "Dépendance Groupe bloquante",
    "Vendor / licensing matter": "Vendeur / licence",
    "Connectivity": "Connectivité",
    "Hardware lifecycle": "Cycle de vie matériel",
    "OT-IT convergence": "Convergence OT-IT",
    "Licensing": "Licences",
    "Scoping": "Cadrage",
    "Design@status": "Conception",
    "Build@status": "Construction",
    "Deploy@status": "Déploiement",
    "Closeout": "Clôture",
    "Lead@status": "Pilote",
    "Co-deliver": "Co-livraison",
    "Advisory": "Conseil",
    "None / Inform only": "Aucune / Information"
  };
  /* </generated:lookup-labels> */
  // C-26 (G27) — strings GENERATED by lib/chartTheme.js (ChartTable / edvA11y: data tables + canvas aria-label)
  // and lib/assetHygieneVisuals.js (Hygiene bullets / Pareto). Read by their L() helper, only when the page
  // switch is on and the language is French. {placeholders} carry data (titles, labels, figures) verbatim.
  root.I18N_FR_CHARTS = {
    'Label': 'Libellé', 'Value': 'Valeur', 'Chart': 'Graphique',
    '{title} — data unavailable (load error).': '{title} — données indisponibles (erreur de chargement).',
    '{title} — loading.': '{title} — chargement.',
    '{label}: ': '{label} : ',
    'highest {label} ({value})': 'maximum {label} ({value})',
    ', lowest {label} ({value})': ', minimum {label} ({value})',
    ', {n} not measured': ', {n} non mesuré',
    '{title} — no data for this period.': '{title} — aucune donnée pour cette période.',
    'Source not current. ': 'Source non à jour. ',
    '{title} — {n} rows. ': '{title} — {n} lignes. ',
    '{title} — data table': '{title} — tableau des données',
    'Data table': 'Tableau des données',
    'No data for this period.': 'Aucune donnée pour cette période.',
    'Source not current — figures shown as last synced, colour withheld.': 'Source non à jour — chiffres de la dernière synchronisation, couleur retirée.',
    'Chart data unavailable.': 'Données du graphique indisponibles.',
    // assetHygieneVisuals
    'Owner': 'Responsable', 'Acquisition date': 'Date d’acquisition', 'Cost': 'Coût', 'Scanned': 'Scanné',
    '(no site)': '(sans site)', 'Site': 'Site', 'Assets': 'Actifs',
    'No assets in scope for the current filters.': 'Aucun actif dans le périmètre des filtres actuels.',
    '{label}: not measured': '{label} : non mesuré', '{label}: {pct} present': '{label} : {pct} renseigné',
    'Completeness by site — share of assets with each field present (bands: under 50%, 50–80%, 80% and over)':
      'Complétude par site — part des actifs dont chaque champ est renseigné (bandes : moins de 50 %, 50–80 %, 80 % et plus)',
    'Data-quality anomalies — Pareto': 'Anomalies de qualité des données — Pareto', 'Anomaly': 'Anomalie',
    'Flagged assets': 'Actifs signalés', 'Cumulative share': 'Part cumulée',
  };
})(typeof window !== 'undefined' ? window : globalThis);
