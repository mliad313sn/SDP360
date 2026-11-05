/* C-26 (G27) — French for public/analytics.html (Requests · Change + CAB · Survey). Site names, category /
 * technician / status values and every figure come from the API and are data: never keys here. Chart axis titles
 * drawn on the canvas stay English; the accessible data tables are localised by lib/chartTheme.js.
 * Inert unless ui_i18n_pages='1'. Glossary: docs/ux/GLOSSARY-FR.md. */
(function (root) {
  'use strict';
  root.I18N_FR_ANALYTICS = {
    'Performance': 'Performance', 'Analytics': 'Analyses', '↻ Refresh': '↻ Actualiser', 'All Sites': 'Tous les sites',
    'All Time': 'Depuis le début', 'Last 7 Days': '7 derniers jours', 'Last 30 Days': '30 derniers jours',
    'Last 90 Days': '90 derniers jours', 'Last 180 Days': '180 derniers jours', 'Last 12 Months': '12 derniers mois',
    '▾ All Statuses': '▾ Tous les statuts', 'Statuses': 'Statuts', '▾ All Types': '▾ Tous les types', 'Types': 'Types',
    '▾ All Impacts': '▾ Tous les impacts', 'Impacts': 'Impacts', '▾ All Modes': '▾ Tous les canaux', 'Modes': 'Canaux',
    'Requests': 'Demandes', 'Change + CAB': 'Changements + CAB', 'Survey': 'Enquête',
    'Local cache · hourly sync from ServiceDesk Plus ·': 'Cache local · synchronisation horaire depuis ServiceDesk Plus ·',
    'sync status': 'état de la synchronisation',
    'Helpdesk Requests': 'Demandes au helpdesk', 'All tickets — incidents and service requests': 'Tous les tickets — incidents et demandes de service',
    'Backlog (Overdue)': 'Backlog (en retard)', 'SLA Compliance': 'Respect du SLA', 'within SLA': 'dans le SLA',
    'Avg Resolution': 'Résolution moyenne', 'hours (closed tickets)': 'heures (tickets clôturés)',
    '1st Reply SLA Fail': 'Échec SLA 1re réponse', 'Reopen Rate': 'Taux de réouverture', 'Service Requests': 'Demandes de service',
    '— Incidents': '— Incidents', 'Escalated': 'Escaladé', 'tickets escalated': 'tickets escaladés',
    'Monthly Ticket Volume': 'Volume mensuel de tickets',
    'Tickets (top) and SLA OK % (bottom) — last 12 months': 'Tickets (haut) et % SLA respecté (bas) — 12 derniers mois',
    'Volume by Site': 'Volume par site', 'Total requests per site': 'Total des demandes par site',
    'Top Categories': 'Principales catégories', 'Most common request categories': 'Catégories de demande les plus fréquentes',
    'Top Technicians': 'Principaux techniciens', 'Requests handled per technician': 'Demandes traitées par technicien',
    'Change Management': 'Gestion des changements', 'Change requests — pipeline, success rate, risk': 'Demandes de changement — pipeline, taux de réussite, risque',
    'Total Changes': 'Total des changements', 'Success Rate': 'Taux de réussite', 'Target ≥90%': 'Cible ≥ 90 %',
    'scheduled, not closed': 'planifiés, non clôturés', 'Emergency': 'Urgence', 'bypassed CAB': 'sans passage au CAB',
    'Completed': 'Terminés', 'Avg Completion': 'Réalisation moyenne', 'days start → done': 'jours début → fin',
    'Changes by Status': 'Changements par statut', 'Distribution across all lifecycle stages': 'Répartition sur toutes les étapes du cycle de vie',
    'Changes by Risk Level': 'Changements par niveau de risque', 'Low / Medium / High / Very High': 'Faible / Moyen / Élevé / Très élevé',
    'Changes by Type': 'Changements par type', 'Standard / Normal / Emergency breakdown': 'Répartition Standard / Normal / Urgence',
    'Changes by Site': 'Changements par site', 'Volume per mining site': 'Volume par site minier',
    'CAB Approvals': 'Approbations CAB', 'Change Advisory Board recommendations and compliance': 'Recommandations et conformité du CAB (comité consultatif des changements)',
    'Total Approvals': 'Total des approbations', 'CAB Compliance': 'Conformité CAB', 'changes with approval': 'changements approuvés',
    'Approved': 'Approuvé', 'Avg Turnaround': 'Délai moyen de traitement', 'minutes': 'minutes',
    'Approval Status': 'Statut d’approbation', 'Approved / Rejected / Pending distribution': 'Répartition approuvé / rejeté / en attente',
    'By Approval Stage': 'Par étape d’approbation', 'Volume per CAB stage': 'Volume par étape du CAB',
    'By Rule Type': 'Par type de règle', 'Approval rule categories': 'Catégories de règles d’approbation',
    'Service Satisfaction (CSAT)': 'Satisfaction du service (CSAT)', 'Post-resolution survey scores from ServiceDesk Plus': 'Scores de l’enquête post-résolution ServiceDesk Plus',
    'Surveys Sent': 'Enquêtes envoyées', 'Response Rate': 'Taux de réponse', 'Target ≥20%': 'Cible ≥ 20 %',
    'Avg CSAT Score': 'Score CSAT moyen', 'out of 100': 'sur 100', 'Satisfied (≥80)': 'Satisfaits (≥ 80)',
    'Monthly CSAT Trend': 'Tendance mensuelle du CSAT',
    'Average score (top) and response rate (bottom) — last 12 months': 'Score moyen (haut) et taux de réponse (bas) — 12 derniers mois',
    'CSAT Distribution': 'Répartition du CSAT', 'Satisfied (≥80) · Neutral (60-79) · Dissatisfied (<60)': 'Satisfaits (≥ 80) · Neutres (60-79) · Insatisfaits (< 60)',
    'Applies to the Helpdesk Requests section only': 'S’applique uniquement à la section Demandes au helpdesk',
    'Page reads from local SQLite cache. Hourly cron syncs from ServiceDesk Plus.': 'La page lit le cache local. Une tâche horaire synchronise depuis ServiceDesk Plus.',
    // runtime (set by the page script)
    '↻ Loading…': '↻ Chargement…', 'No sync yet': 'Pas encore de synchronisation',
  };
  root.I18N_FR_ANALYTICS_RUNTIME = ['↻ Loading…', 'No sync yet'];
})(typeof window !== 'undefined' ? window : globalThis);
