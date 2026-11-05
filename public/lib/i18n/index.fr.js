/* C-26 (G27) — French for public/index.html (Helpdesk · IT Operations Center). Site / group / category /
 * technician names, statuses read from ServiceDesk Plus and every figure are data: never keys here. The
 * "AP formula" tooltips keep the Analytics Plus function names verbatim (they are code).
 * Inert unless ui_i18n_pages='1'. Glossary: docs/ux/GLOSSARY-FR.md. */
(function (root) {
  'use strict';
  root.I18N_FR_INDEX = {
    'Loading dashboard data…': 'Chargement des données du tableau de bord…', '⟳ Retry': '⟳ Réessayer',
    'Helpdesk · IT Operations Center': 'Helpdesk · Centre des opérations IT', 'Connecting…': 'Connexion…',
    '⟳ Refresh': '⟳ Actualiser', 'Force Sync': 'Forcer la synchronisation', '📥 Export Risk Register': '📥 Exporter le registre des risques',
    '👤 Unassigned (—)': '👤 Non assignés (—)', '👤 Unassigned Open Tickets': '👤 Tickets ouverts non assignés',
    'Tickets not yet assigned to a technician · sorted oldest first': 'Tickets pas encore assignés à un technicien · les plus anciens d’abord',
    'Download CSV': 'Télécharger le CSV', 'Weekly': 'Hebdomadaire', 'Monthly': 'Mensuel', 'Quarterly': 'Trimestriel', 'Yearly': 'Annuel',
    'All Sites': 'Tous les sites', 'Group': 'Groupe', 'Operations': 'Opérations', 'Applications': 'Applications',
    '▾ Custom': '▾ Personnalisé', 'Select groups': 'Choisir les groupes', 'Category': 'Catégorie', 'All Categories': 'Toutes les catégories',
    'All Priorities': 'Toutes les priorités', 'Critical': 'Critique', 'High': 'Élevée', 'Medium': 'Moyenne', 'Low': 'Faible',
    'Report Week': 'Semaine du rapport', '▾ All Statuses': '▾ Tous les statuts', 'Select statuses': 'Choisir les statuts',
    '▾ All Types': '▾ Tous les types', 'Select types': 'Choisir les types', 'Impact': 'Impact', '▾ All Impacts': '▾ Tous les impacts',
    'Select impacts': 'Choisir les impacts', 'Mode': 'Canal', '▾ All Modes': '▾ Tous les canaux', 'Select modes': 'Choisir les canaux',
    'Trend': 'Tendance', '8 wks': '8 sem.', '12 wks': '12 sem.', '16 wks': '16 sem.',
    'Inbound Tickets': 'Tickets entrants', 'Closed Tickets': 'Tickets clôturés',
    '1st Reply SLA %': '% SLA 1re réponse', '(on-time responses)': '(réponses dans les délais)',
    'Resolution SLA %': '% SLA de résolution', '(on-time closures)': '(clôtures dans les délais)',
    'Time to Assign': 'Délai d’assignation', '(hrs to assignment)': '(heures jusqu’à l’assignation)',
    'First Reply': 'Première réponse', '(hrs to first response)': '(heures jusqu’à la première réponse)',
    'Resolution Time': 'Délai de résolution', '(days to resolve)': '(jours pour résoudre)',
    'Closing Time': 'Délai de clôture', '(days to close)': '(jours pour clôturer)',
    'Ageing Report — Open Tickets': 'Ancienneté — tickets ouverts',
    '(how long currently unresolved tickets have been waiting)': '(depuis combien de temps les tickets non résolus attendent)',
    'Top 10 Resolution SLA Breaches by Category': 'Top 10 des dépassements du SLA de résolution par catégorie',
    '(categories where tickets most often missed their resolution deadline)': '(catégories où les tickets ont le plus souvent manqué leur échéance de résolution)',
    'Tickets by Category — Pareto': 'Tickets par catégorie — Pareto',
    'Top: tickets per category, largest first · Bottom: cumulative % of all tickets in the period. “Other (k)” groups the remaining k categories with their full count — click a bar to see its tickets.':
      'Haut : tickets par catégorie, du plus grand au plus petit · Bas : % cumulé de tous les tickets de la période. « Other (k) » regroupe les k catégories restantes avec leur total — cliquez sur une barre pour voir ses tickets.',
    'Resolution SLA % — worst first': '% SLA de résolution — les moins bons d’abord', 'By': 'Par',
    'Closed (n)': 'Clôturés (n)', 'Missed SLA': 'SLA manqué', 'Request Volume Trend': 'Tendance du volume de demandes',
    'Top: tickets per period · Bottom: % that missed SLA': 'Haut : tickets par période · Bas : % ayant manqué le SLA', '(lower = better)': '(plus bas = mieux)',
    'Technician Activity': 'Activité des techniciens',
    '(technicians who handled at least one ticket — green = active this period, grey = inactive)': '(techniciens ayant traité au moins un ticket — vert = actif sur la période, gris = inactif)',
    'Technician Performance — Report Period': 'Performance des techniciens — période du rapport', 'Technician': 'Technicien',
    'Inbound': 'Entrants', 'Ongoing': 'En cours', 'On Hold': 'En attente', '1st Reply avg (h)': '1re réponse moy. (h)', 'Resolution avg (d)': 'Résolution moy. (j)',
    'Endeavour Mining · IT Operations Center · Helpdesk Dashboard ·': 'Endeavour Mining · Centre des opérations IT · Tableau de bord helpdesk ·',
    'Configure Team Groups': 'Configurer les groupes d’équipe', 'Assign groups to each team preset. Click': 'Affectez des groupes à chaque équipe prédéfinie. Cliquez sur',
    'on a chip to remove. Add groups using the dropdowns below each team.': 'sur une étiquette pour la retirer. Ajoutez des groupes avec les listes sous chaque équipe.',
    'Clear server cache and fetch fresh data from Zoho': 'Vider le cache du serveur et récupérer des données fraîches depuis Zoho',
    'Export current period ticket data to CSV': 'Exporter les tickets de la période en CSV',
    'Export Risk Register Occurrence sheet for the selected month (Excel)': 'Exporter la feuille des occurrences du registre des risques pour le mois choisi (Excel)',
    'View open tickets not yet assigned to a technician — respects current Site & Group filters': 'Voir les tickets ouverts pas encore assignés — respecte les filtres Site et Groupe actuels',
    'Configure team presets': 'Configurer les équipes prédéfinies',
    'Total tickets created during this period (all statuses). Counts every new request logged via portal or email.':
      'Total des tickets créés sur la période (tous statuts). Compte chaque nouvelle demande enregistrée par le portail ou par e-mail.',
    'Closed Tickets — AP formula: countif(Request Pending Status = 0). Includes Closed, Resolved, Confirmed Resolution, Cancelled and any other non-pending status. Closure rate = Closed ÷ Inbound.':
      'Tickets clôturés — formule AP : countif(Request Pending Status = 0). Inclut Closed, Resolved, Confirmed Resolution, Cancelled et tout autre statut non en attente. Taux de clôture = clôturés ÷ entrants.',
    '1st Reply SLA % — percentage of tickets that received their first technician response within the SLA target time. Does NOT measure resolution. Higher is better. Target ≥80%.':
      '% SLA 1re réponse — part des tickets ayant reçu la première réponse d’un technicien dans le délai SLA. Ne mesure PAS la résolution. Plus haut = mieux. Cible ≥ 80 %.',
    'Resolution SLA % — percentage of tickets fully resolved within the SLA target time. Separate from first reply. Higher is better. Target ≥90%.':
      '% SLA de résolution — part des tickets entièrement résolus dans le délai SLA. Distinct de la première réponse. Plus haut = mieux. Cible ≥ 90 %.',
    'Time to Assign (hrs) — average hours from ticket creation to technician assignment. AP formula: dateandtimediff(HOUR,Created Time,Assigned Time). Lower is better.':
      'Délai d’assignation (h) — heures moyennes entre la création du ticket et son assignation. Formule AP : dateandtimediff(HOUR,Created Time,Assigned Time). Plus bas = mieux.',
    'First Reply (hrs) — average hours from ticket creation to first technician reply. AP formula: (Responded Time − Created Time) ÷ 3600. Lower is better.':
      'Première réponse (h) — heures moyennes entre la création du ticket et la première réponse d’un technicien. Formule AP : (Responded Time − Created Time) ÷ 3600. Plus bas = mieux.',
    'Resolution Time (days) — average calendar days from ticket creation to resolution. AP formula: datediff(Resolved Time, Created Time). Lower is better.':
      'Délai de résolution (j) — jours calendaires moyens entre la création et la résolution. Formule AP : datediff(Resolved Time, Created Time). Plus bas = mieux.',
    'Closing Time (days) — average calendar days from ticket creation to full closure. AP formula: datediff(Completed Time, Created Time). Lower is better.':
      'Délai de clôture (j) — jours calendaires moyens entre la création et la clôture complète. Formule AP : datediff(Completed Time, Created Time). Plus bas = mieux.',
    'Total tickets created in this period assigned to this technician': 'Total des tickets créés sur la période et assignés à ce technicien',
    'Tickets with status Closed / Resolved / Confirm Resolution': 'Tickets au statut Closed / Resolved / Confirm Resolution',
    'Inbound minus Closed — tickets still open or in progress': 'Entrants moins clôturés — tickets encore ouverts ou en cours',
    'Tickets placed on hold at least once (OnHold Count > 0). High numbers may indicate avoidance.': 'Tickets mis en attente au moins une fois (OnHold Count > 0). Un nombre élevé peut signaler un évitement.',
    'Average hours from ticket creation to first technician reply. Lower is better.': 'Heures moyennes entre la création du ticket et la première réponse d’un technicien. Plus bas = mieux.',
    'Average calendar days from ticket creation to closure. Lower is better.': 'Jours calendaires moyens entre la création du ticket et sa clôture. Plus bas = mieux.',
    '1st Reply SLA % — % of this technician\'s tickets that received a first reply within the SLA target. Higher is better. Target ≥80%.':
      '% SLA 1re réponse — part des tickets de ce technicien ayant reçu une première réponse dans le délai SLA. Plus haut = mieux. Cible ≥ 80 %.',
    'Resolution SLA % — % of this technician\'s tickets fully resolved within the SLA target time. Higher is better. Target ≥90%.':
      '% SLA de résolution — part des tickets de ce technicien entièrement résolus dans le délai SLA. Plus haut = mieux. Cible ≥ 90 %.',
    // runtime (set by the page script)
    '⏳ Exporting…': '⏳ Export en cours…',
  };
  root.I18N_FR_INDEX_RUNTIME = ['⏳ Exporting…'];
})(typeof window !== 'undefined' ? window : globalThis);
