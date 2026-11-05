/* A-09b — French for public/reports.html (Site Reports: weekly editor, monthly view, report list).
 * Scope: everything a site coordinator sees (report list, weekly editor tabs, monthly view, modals).
 * The admin console (#page-admin and its modals) stays English for now — it is skipped by
 * tests/i18n-coverage.test.js with that reason. Static markup first, then RUNTIME_KEYS: strings the page
 * builds in JS (status labels, empty states, select options). User data (KPI names typed by coordinators,
 * action text, comments) is never a key. Option VALUE attributes are never touched, only their text.
 * Inert unless report_config ui_i18n_pages = '1' (public/lib/i18n/boot.js).
 */
(function (root) {
  'use strict';
  const STATIC = {
    'Site Reports': 'Rapports de site', '⚠ Figures changed since submission': '⚠ Les chiffres ont changé depuis la soumission', 'Weekly': 'Hebdomadaire', '📅 Monthly': '📅 Mensuel',
    // change-password modal
    '🔑 Change Password': '🔑 Changer le mot de passe', 'Enter your current password and choose a new one.': 'Saisissez votre mot de passe actuel puis choisissez-en un nouveau.',
    'Current Password': 'Mot de passe actuel', 'New Password': 'Nouveau mot de passe', 'Confirm New Password': 'Confirmer le nouveau mot de passe',
    'Change Password': 'Changer le mot de passe', 'Change your password': 'Changer votre mot de passe', 'Your current password': 'Votre mot de passe actuel',
    'At least 8 characters': 'Au moins 8 caractères', 'Repeat new password': 'Répétez le nouveau mot de passe',
    // report list page
    'Open or create weekly reports · Export monthly & all-sites PPTX · Browse recent submissions':
      'Ouvrir ou créer les rapports hebdomadaires · Exporter les PPTX mensuels et tous sites · Parcourir les derniers rapports',
    'Open or Create a Weekly Report': 'Ouvrir ou créer un rapport hebdomadaire',
    "Pick a group + week, then open the in-app editor to fill or update that week's report (helpdesk KPIs, lights, actions, comments). Saves to the database — used by the All-Sites Summary below.":
      "Choisissez un groupe et une semaine, puis ouvrez l'éditeur pour remplir ou mettre à jour le rapport de cette semaine (KPI helpdesk, faits marquants, actions, commentaires). Enregistré en base — utilisé par la synthèse tous sites ci-dessous.",
    'Group': 'Groupe', 'Year': 'Année', 'Week': 'Semaine', 'Open / Create Report': 'Ouvrir / créer le rapport',
    'Export PPTX': 'Exporter en PPTX', 'Generate slide decks from saved report data': 'Générer les présentations à partir des rapports enregistrés',
    '📅 Monthly Site Report': '📅 Rapport mensuel du site', '7-slide PPTX for one site. Edit lights / actions / objectives in the': 'PPTX de 7 diapositives pour un site. Modifiez faits marquants / actions / objectifs dans l’onglet',
    'Monthly': 'Mensuel', 'tab first, then export.': 'd’abord, puis exportez.', 'Month': 'Mois',
    'Monthly PPTX': 'PPTX mensuel', 'All Sites (combined)': 'Tous les sites (combiné)', 'Weekly All-Sites Summary': 'Synthèse hebdomadaire tous sites',
    "Aggregates every site's submitted weekly report for the chosen week into one consolidated PPTX.": 'Regroupe le rapport hebdomadaire soumis de chaque site pour la semaine choisie dans un seul PPTX consolidé.',
    'Download PPTX': 'Télécharger le PPTX', 'Recent Reports': 'Rapports récents', 'Click any card to reopen its editor': 'Cliquez sur une carte pour rouvrir son éditeur',
    // D-05 — report list filters + paging
    'All my sites': 'Tous mes sites', 'Filter the list by site': 'Filtrer la liste par site', '◀ Previous': '◀ Précédent', 'Next ▶': 'Suivant ▶',
    '7-slide PPTX for the selected site': 'PPTX de 7 diapositives pour le site choisi',
    'Single combined PPTX with one section per active site for the chosen month': 'Un seul PPTX combiné, une section par site actif, pour le mois choisi',
    // weekly editor
    '← Back': '← Retour', 'Report': 'Rapport', '✎ Change Week': '✎ Changer de semaine', 'Reassign this report to a different week': 'Rattacher ce rapport à une autre semaine',
    '1. Infrastructure KPIs': '1. KPI d’infrastructure', '2. Helpdesk Metrics': '2. Indicateurs helpdesk', '3. Low / High Lights': '3. Points faibles / forts',
    '4. Action Items': '4. Actions', 'Infrastructure KPIs': 'KPI d’infrastructure', 'Service / System': 'Service / système', 'KPI Description': 'Description du KPI',
    'Target': 'Cible', 'Current Value': 'Valeur actuelle', 'Trend': 'Tendance', '+ Add Row': '+ Ajouter une ligne', 'Copy from Previous Week': 'Copier la semaine précédente',
    '⚡ Fill from OPManager / Meraki': '⚡ Remplir depuis OPManager / Meraki', 'Save Infrastructure KPIs': 'Enregistrer les KPI d’infrastructure', '↺ Reset to defaults': '↺ Rétablir les valeurs par défaut',
    "Pre-fill all rows from the previous week's report — only update Current Value": 'Pré-remplir toutes les lignes depuis le rapport de la semaine précédente — ne mettez à jour que la valeur actuelle',
    'Fill empty Current Value cells from OPManager / Meraki for this week (WAN1/WAN2/LAN/WLAN/Servers) — never overwrites a value you typed':
      'Remplir les cellules « Valeur actuelle » vides depuis OPManager / Meraki pour cette semaine (WAN1/WAN2/LAN/WLAN/Serveurs) — n’écrase jamais une valeur saisie',
    'Replace all rows with the standard defaults (WAN1/WAN2/LAN/WLAN/Servers/Backup/Radio)': 'Remplacer toutes les lignes par les valeurs standard (WAN1/WAN2/LAN/WLAN/Serveurs/Sauvegarde/Radio)',
    'Helpdesk Metrics': 'Indicateurs helpdesk', 'Group:': 'Groupe :', 'Refresh': 'Actualiser', 'Load Groups': 'Charger les groupes',
    'Click to load available groups, then select one to see charts': 'Cliquez pour charger les groupes, puis choisissez-en un pour voir les graphiques',
    '— select a group —': '— choisir un groupe —', '← Prev Week': '← Semaine précédente', 'Next Week →': 'Semaine suivante →',
    'No data yet — charts will load automatically, or click': 'Pas encore de données — les graphiques se chargent automatiquement, ou cliquez sur', 'to reload.': 'pour recharger.',
    '👥 Team': '👥 Équipe', 'Technicians on Duty': 'Techniciens de service', 'Load groups and select one to see active technicians': 'Chargez les groupes et choisissez-en un pour voir les techniciens actifs',
    'Technicians on Break / Leave': 'Techniciens en pause / congé', 'None selected': 'Aucune sélection', '+ Add': '+ Ajouter',
    'Group techs — click to mark on break:': 'Techniciens du groupe — cliquez pour marquer en pause :', 'Type name (e.g. Oumar — annual leave)…': 'Saisissez un nom (ex. Oumar — congé annuel)…',
    '📝 Comments': '📝 Commentaires', '(auto-filled from charts — editable)': '(rempli depuis les graphiques — modifiable)', 'General Comments on Metrics': 'Commentaires généraux sur les indicateurs',
    '↺ Regenerate': '↺ Régénérer', 'SLA Comments': 'Commentaires SLA', 'Save Helpdesk Metrics': 'Enregistrer les indicateurs helpdesk',
    'Regenerate from chart data (overwrites current text)': 'Régénérer depuis les graphiques (remplace le texte actuel)', 'Load a group to auto-fill...': 'Chargez un groupe pour le remplissage automatique…',
    'Regenerate from SLA & violation data (overwrites current text)': 'Régénérer depuis les données SLA et dépassements (remplace le texte actuel)',
    'Low Lights / High Lights': 'Points faibles / points forts', '↵ Copy from previous week': '↵ Copier la semaine précédente',
    '🔴 Low Lights': '🔴 Points faibles', '🟢 High Lights': '🟢 Points forts', 'Active Changes — ServiceDesk Plus': 'Changements en cours — ServiceDesk Plus',
    '(auto-populated from database)': '(rempli depuis la base)', '↻ Refresh': '↻ Actualiser', '🚨 Active Major Incidents — ServiceDesk Plus': '🚨 Incidents majeurs en cours — ServiceDesk Plus',
    '(open tickets only · auto-populated)': '(tickets ouverts seulement · rempli automatiquement)', 'Save Lights': 'Enregistrer les faits marquants',
    'Action Items & Follow-ups': 'Actions et suivis', 'Task / Action': 'Tâche / action', 'Due Date': 'Échéance', '+ Add Action': '+ Ajouter une action',
    '↵ Import open actions from a previous week': '↵ Importer les actions ouvertes d’une semaine précédente', '↵ Import from Meetings / Inspections': '↵ Importer depuis Réunions / Inspections',
    'CSV Template': 'Modèle CSV', '⬆ Import CSV': '⬆ Importer un CSV', 'ℹ Allowed values': 'ℹ Valeurs autorisées', 'Save Action Items': 'Enregistrer les actions',
    'Download a CSV template with column headers + 3 sample rows': 'Télécharger un modèle CSV avec les en-têtes et 3 lignes d’exemple',
    'Bulk-import action items from a CSV file': 'Importer des actions en masse depuis un fichier CSV', 'Allowed values reference': 'Référence des valeurs autorisées',
    'Report Status': 'Statut du rapport', 'Weekly PPTX': 'PPTX hebdomadaire', '✅ Submit Report': '✅ Soumettre le rapport', '↩ Revert to Draft': '↩ Repasser en brouillon',
    '🗑 Delete': '🗑 Supprimer', 'Delete this draft report': 'Supprimer ce brouillon de rapport',
    'Report Audit Trail': 'Historique du rapport', 'Date / Time': 'Date / heure', 'User': 'Utilisateur', 'Details': 'Détails', 'Load a report to see its audit trail': 'Ouvrez un rapport pour voir son historique',
    // monthly view
    'Monthly Report': 'Rapport mensuel', 'Select site, year and month then click Load': 'Choisissez le site, l’année et le mois puis cliquez sur Charger',
    '📥 Export PPTX': '📥 Exporter en PPTX', '📥 All Sites': '📥 Tous les sites', 'Load Data': 'Charger les données', '↻ Sync Zoho Data': '↻ Synchroniser les données Zoho',
    'Pull latest tickets from Zoho into the database, then reload': 'Récupérer les derniers tickets Zoho en base, puis recharger',
    'Combined Report': 'Rapport combiné', 'Export ALL Sites PPTX': 'Exporter le PPTX de TOUS les sites',
    'All active sites · selected year & month · one file for the monthly meeting': 'Tous les sites actifs · année et mois choisis · un seul fichier pour la réunion mensuelle',
    'Generate one PPTX covering ALL sites for the selected year & month': 'Générer un PPTX couvrant TOUS les sites pour l’année et le mois choisis',
    '1. Infra KPIs': '1. KPI infra', '5. Annual Objectives': '5. Objectifs annuels',
    'Read-only — last week of the month · edit weekly reports to change KPI values': 'Lecture seule — dernière semaine du mois · modifiez les rapports hebdomadaires pour changer les KPI',
    'Load data to see infrastructure KPIs': 'Chargez les données pour voir les KPI d’infrastructure',
    'Read-only monthly aggregate · edit individual weekly reports to update values': 'Agrégat mensuel en lecture seule · modifiez les rapports hebdomadaires pour mettre à jour les valeurs',
    'Inbound': 'Entrants', 'Closed %': '% clôturés', 'Res. SLA OK%': '% SLA résolution OK', '1st Reply OK%': '% 1re réponse OK', 'Load data to see helpdesk metrics': 'Chargez les données pour voir les indicateurs helpdesk',
    '+ Add Item': '+ Ajouter un élément', 'Content': 'Contenu', '💾 Save Changes': '💾 Enregistrer les modifications', 'Actions & Follow-ups': 'Actions et suivis', 'Task': 'Tâche',
    'Annual IT Objectives': 'Objectifs IT annuels', '+ Add Objective': '+ Ajouter un objectif', 'Objective': 'Objectif', 'Target / Metric': 'Cible / indicateur', '💾 Save Objectives': '💾 Enregistrer les objectifs',
    // change-week modal
    '✎ Change Report Week': '✎ Changer la semaine du rapport', 'Currently filed under': 'Actuellement rangé sous', '. Enter the week this report should belong to.': '. Saisissez la semaine à laquelle ce rapport doit appartenir.',
    'Week number': 'Numéro de semaine',
    '⚠ All saved data (infrastructure KPIs, highlights, action items) will be reassigned to the new week. The original week slot will be freed up so a new report can be created for it later.':
      '⚠ Toutes les données enregistrées (KPI d’infrastructure, faits marquants, actions) seront rattachées à la nouvelle semaine. L’emplacement de la semaine d’origine sera libéré pour qu’un nouveau rapport puisse y être créé plus tard.',
    'This cannot be undone.': 'Cette opération est irréversible.', '📋 This report has already been': '📋 Ce rapport a déjà été', 'submitted': 'soumis',
    '. Changing the week will not automatically notify anyone — make sure to re-share the corrected report.': '. Changer la semaine ne prévient personne automatiquement — pensez à repartager le rapport corrigé.',
    'Confirm Change': 'Confirmer le changement',
  };
  const RUNTIME_KEYS = {
    // report cards and status label
    '✅ Submitted': '✅ Soumis', '✔ Ready': '✔ Prêt', '⏳ In Progress': '⏳ En cours', '✏ Draft': '✏ Brouillon', '✔ Ready to Submit': '✔ Prêt à soumettre',
    'No reports yet. Create the first one above.': 'Aucun rapport pour l’instant. Créez le premier ci-dessus.', 'No reports found for this month': 'Aucun rapport pour ce mois',
    // action rows (option text only — the option values stay the codes)
    '— Select —': '— Choisir —', '🔴 High': '🔴 Haute', '🟡 Medium': '🟡 Moyenne', '🟢 Low': '🟢 Basse', 'Open': 'Ouvert', 'On Hold': 'En attente',
    'Type or select…': 'Saisir ou choisir…', 'Click to edit': 'Cliquer pour modifier', 'Done': 'Terminé',
    'Why is this on hold? Blockers? Decisions? (Dashboard-only — not shown in PPTX)': 'Pourquoi en attente ? Blocages ? Décisions ? (tableau de bord seulement — absent du PPTX)',
    // panels and empty states
    'No open changes for this site.': 'Aucun changement ouvert pour ce site.', 'Select a site to see active changes.': 'Choisissez un site pour voir les changements en cours.',
    'Select a site to see active major incidents.': 'Choisissez un site pour voir les incidents majeurs en cours.', 'No active major incidents for this site. ✅': 'Aucun incident majeur en cours pour ce site. ✅',
    'No technician data for this week': 'Aucune donnée technicien pour cette semaine', 'No previous weeks available.': 'Aucune semaine précédente disponible.',
    'No open actions.': 'Aucune action ouverte.', 'No audit entries yet': 'Aucune entrée d’historique pour l’instant', 'No KPI data in last weekly report': 'Aucun KPI dans le dernier rapport hebdomadaire',
    '⏳ Syncing…': '⏳ Synchronisation…',
  };
  root.I18N_FR_REPORTS = Object.assign({}, STATIC, RUNTIME_KEYS);
  root.I18N_FR_REPORTS_RUNTIME = Object.keys(RUNTIME_KEYS);
})(typeof window !== 'undefined' ? window : globalThis);
