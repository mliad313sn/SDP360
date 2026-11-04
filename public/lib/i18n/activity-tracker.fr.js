/* A-09a — French for the Activity Tracker (public/activity-tracker.html, React app activity-tracker/dist/app.js).
 * The page body is rendered by React, so every key here is a RUNTIME string taken from App.jsx (JSX text
 * nodes, tab labels, title/placeholder attributes). React re-renders change text nodes in place — i18nText
 * observes characterData for exactly that. Activity names, pillar names and site codes are configuration
 * data and are never keys. Inert unless ui_i18n_pages='1'. Canvas chart labels (Chart.js) are not DOM text
 * and stay English.
 */
(function (root) {
  'use strict';
  const RUNTIME_KEYS = {
    // header, tabs, toolbar
    'IT Activity Tracker': "Suivi d'activité IT", 'Year': 'Année', 'Period': 'Période',
    'Dashboard': 'Tableau de bord', 'Scoring': 'Notation', 'Input': 'Saisie', 'Heatmap': 'Carte de chaleur',
    'Tracker Setup': 'Paramétrage du suivi', 'Targets': 'Objectifs', 'Roadmap': 'Feuille de route',
    '📊 Export PPTX': '📊 Exporter en PPTX', '↻ Reset': '↻ Réinitialiser',
    'Saving…': 'Enregistrement…', 'Save failed — retry': 'Échec de l’enregistrement — réessayer',
    'Unsaved changes': 'Modifications non enregistrées', 'Synced': 'Synchronisé',
    // export modal
    'Export the Activity Tracker as a multi-slide PPTX': 'Exporter le suivi d’activité en PPTX (plusieurs diapositives)',
    'Generates a multi-slide PowerPoint deck from the current tracker data — KPI strip, site cards, charts and per-pillar breakdowns. Inactive sites are filtered out on the server side regardless of selection.':
      'Génère une présentation PowerPoint à partir des données actuelles du suivi — indicateurs, cartes par site, graphiques et détail par pilier. Les sites inactifs sont écartés côté serveur quelle que soit la sélection.',
    'Reporting month': 'Mois de reporting', 'Sites': 'Sites', 'All active': 'Tous les actifs',
    '⏳ Generating PPTX server-side — this can take 10–30 seconds for a fleet-wide report.':
      '⏳ Génération du PPTX côté serveur — cela peut prendre 10 à 30 secondes pour l’ensemble des sites.',
    // dashboard
    'of activities': 'des activités', 'on target': 'dans l’objectif', 'showing progress': 'en progression',
    'Best': 'Meilleur', 'Watch': 'À surveiller', '6-month trend': 'Tendance sur 6 mois',
    'Pillar Health': 'Santé des piliers', 'Strategic dimensions · weighted by importance': 'Dimensions stratégiques · pondérées par importance',
    'Site Leaderboard': 'Classement des sites', 'Activities': 'Activités', 'Score': 'Score', 'vs prev': 'vs précédent',
    '📍 Site-Specific': '📍 Propre au site',
    '🎯 Target Attainment — by Activity Count': '🎯 Atteinte des objectifs — par nombre d’activités',
    '⚖ Target Attainment — by Weight': '⚖ Atteinte des objectifs — par poids',
    'Average Score by Site': 'Score moyen par site', 'RAG Distribution by Pillar': 'Répartition RAG par pilier',
    'Site G/A/R Stacks': 'Répartition V/O/R par site', 'your sites only': 'vos sites seulement',
    // scoring / input / heatmap
    'Pillar': 'Pilier', 'Activity': 'Activité', 'Weight': 'Poids', 'YTD': 'Cumul annuel', 'Target': 'Objectif',
    'SHARED': 'PARTAGÉ', 'INACTIVE': 'INACTIF', 'KPI': 'KPI',
    'The orange weight on a row means the activity was redistributed because other activities in this pillar are inactive at this site.':
      'Un poids orange signifie que l’activité a été repondérée parce que d’autres activités de ce pilier sont inactives sur ce site.',
    '👁 View-only': '👁 Lecture seule', '— your role cannot edit actuals. Ask an admin for the': '— votre rôle ne permet pas de saisir les réalisations. Demandez à un administrateur le rôle',
    '🔒 Closed months': '🔒 Mois clôturés', 'can correct a closed month.': 'peut corriger un mois clôturé.',
    '⬇ Export CSV': '⬇ Exporter en CSV', 'actual value': 'valeur réelle',
    'Auto-saves to the database 0.8 s after the last edit. Watch the indicator in the toolbar.':
      'Enregistrement automatique 0,8 s après la dernière modification. Surveillez l’indicateur de la barre d’outils.',
    'Export this site\'s 12-month input matrix as CSV, with the engine\'s YTD / target / score per row for cross-checking':
      'Exporter en CSV la saisie sur 12 mois de ce site, avec cumul / objectif / score calculés par ligne pour contrôle',
    'Pull the real departmental-meeting counts from the Meetings module into the Monthly Department Meeting row (still editable after)':
      'Reprendre le nombre réel de réunions départementales depuis le module Réunions dans la ligne correspondante (modifiable ensuite)',
    'On target': 'Dans l’objectif', 'Pillar →': 'Pilier →', 'Site / Activity': 'Site / Activité',
    // setup
    '1 · Years': '1 · Années', '+ Add year': '+ Ajouter une année', '· current': '· en cours',
    'No years configured yet — click "Add year" to create one.': 'Aucune année configurée — cliquez sur « Ajouter une année ».',
    '2 · Pillars': '2 · Piliers', 'Strategic dimensions and their weights. The four weights must total 100%.': 'Dimensions stratégiques et leurs poids. Les quatre poids doivent totaliser 100 %.',
    '+ Add pillar': '+ Ajouter un pilier', 'Total weight:': 'Poids total :',
    '3 · Active sites': '3 · Sites actifs',
    'Toggle which sites participate in the tracker. Inactive sites still show in the Setup tables but contribute nothing to the score.':
      'Choisissez les sites qui participent au suivi. Les sites inactifs restent visibles dans le paramétrage mais ne comptent pas dans le score.',
    '4 · Activities': '4 · Activités', '+ Activity': '+ Activité', 'Activity name': 'Nom de l’activité', 'Window': 'Période',
    'Shared': 'Partagé', 'Pillar total:': 'Total du pilier :',
    'Changes auto-save 0.8 s after the last edit. Watch the indicator in the toolbar.': 'Les modifications s’enregistrent 0,8 s après la dernière saisie. Surveillez l’indicateur de la barre d’outils.',
    'Deleting a pillar or activity opens a redistribute dialog so the totals stay at 100%.': 'Supprimer un pilier ou une activité ouvre une fenêtre de répartition pour garder les totaux à 100 %.',
    'This year is empty — add pillars and activities below.': 'Cette année est vide — ajoutez des piliers et des activités ci-dessous.',
    'Edit and blur to rename. Format: P{N}-Name': 'Modifiez puis quittez le champ pour renommer. Format : P{N}-Nom',
    'First month the activity is in scope': 'Premier mois où l’activité s’applique', 'Last month the activity is in scope': 'Dernier mois où l’activité s’applique',
    'Proportional': 'Proportionnelle', 'Equal': 'Égale', 'Custom': 'Personnalisée',
    'Edit each weight manually — must total 100% to confirm.': 'Modifiez chaque poids — le total doit faire 100 % pour confirmer.',
    'Was': 'Avant', 'Will become': 'Deviendra', '· must equal 100%': '· doit faire 100 %',
    '⚠ This action is permanent and cannot be undone.': '⚠ Cette action est définitive et irréversible.',
    'What gets deleted': 'Ce qui est supprimé', 'What is preserved': 'Ce qui est conservé', 'Recovery instructions:': 'Procédure de récupération :',
    'Add a new pillar to the tracker?': 'Ajouter un nouveau pilier au suivi ?', 'Add new pillar': 'Nouveau pilier', 'Add new activity': 'Nouvelle activité',
    // targets / roadmap
    'All on': 'Tout activer', 'All off': 'Tout désactiver', 'Active': 'Actif', 'Targets are': 'Les objectifs sont',
    'per-site': 'par site', 'Activity windows by pillar': 'Périodes des activités par pilier', 'Each bar shows when an activity is': 'Chaque barre montre quand une activité est',
    'in scope': 'applicable', 'green ≥ 65%': 'vert ≥ 65 %', 'amber 55–64%': 'orange 55–64 %', 'Pillar / activity': 'Pilier / activité',
    'Open the legacy tracker →': 'Ouvrir l’ancien suivi →',
  };
  root.I18N_FR_ACTIVITY_TRACKER = Object.assign({}, RUNTIME_KEYS);
  root.I18N_FR_ACTIVITY_TRACKER_RUNTIME = Object.keys(RUNTIME_KEYS);
})(typeof window !== 'undefined' ? window : globalThis);
