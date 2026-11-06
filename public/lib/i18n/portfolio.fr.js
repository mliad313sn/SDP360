/* A-09b — French for public/portfolio.html (programmes → objectives → projects → milestones → risks).
 * Static markup first, then RUNTIME_KEYS (table headers and empty states built in JS).
 * NOT translated on purpose: the "Kind" options (programme, objective, project…) — they have no value
 * attribute, so their text IS the code posted to the API; status codes; element names (user data).
 * Inert unless ui_i18n_pages='1'.
 */
(function (root) {
  'use strict';
  const STATIC = {
    'Capacity per site and week': 'Capacité par site et par semaine',
    'Requests that may become projects:': 'Demandes susceptibles de devenir des projets :', 'RFI register': 'Registre des demandes',
    'WBS code (task)': 'Code WBS (tâche)',
    'Parent task id (task)': 'Id de la tâche parente (tâche)',
    'Duration days (task)': 'Durée en jours (tâche)',
    'Allocation % (task)': 'Allocation % (tâche)',
    'Effort hours (task)': 'Effort en heures (tâche)',
    'Depends on task ids (task, comma)': 'Dépend des tâches (ids, séparés par des virgules)',
    'Portfolio': 'Portefeuille',
    'Programmes → objectives (evidence from the KPI dictionary) → projects → milestones → deliverables, with risks. “—” means not measured, never 0 (help §25).':
      'Programmes → objectifs (preuve issue du dictionnaire de KPI) → projets → jalons → livrables, avec les risques. « — » signifie non mesuré, jamais 0 (aide §25).',
    'Monthly report (HTML)': 'Rapport mensuel (HTML)', 'Roadmap Manager migration — dry run': 'Migration du Roadmap Manager — simulation',
    'Apply migration': 'Appliquer la migration', 'Programmes & objectives': 'Programmes et objectifs', 'Money by programme': 'Montants par programme',
    'Schedule (projects & milestones)': 'Planning (projets et jalons)', 'Table view (dates, plan, alerts)': 'Vue tableau (dates, plan, alertes)',
    'Resource conflicts': 'Conflits de ressources', 'Risks': 'Risques', 'Add / edit an element (committee)': 'Ajouter / modifier un élément (comité)',
    'Kind': 'Nature', 'Id (blank = new)': 'Id (vide = nouveau)', 'Parent id (programme / objective / project)': 'Id parent (programme / objectif / projet)',
    'Key': 'Clé', 'Name / title': 'Nom / titre', 'Start': 'Début', 'Due / end': 'Échéance / fin', 'Baseline end': 'Fin de référence',
    'Progress %': 'Avancement %', 'Weight': 'Poids', 'Evidence metric key': 'Clé de l’indicateur de preuve', 'Evidence target': 'Cible de la preuve',
    'Resource pressure per person and week': 'Charge des ressources par personne et par semaine', 'Risk matrix (probability × impact)': 'Matrice des risques (probabilité × impact)',
    'Keyboard: Tab to a project key, then the arrow keys move between projects and Enter opens the project page. The table view holds the same data.':
      'Clavier : Tab jusqu’à la clé d’un projet, puis les flèches passent d’un projet à l’autre et Entrée ouvre la page projet. La vue tableau contient les mêmes données.',
    'Probability (1-3)': 'Probabilité (1-3)', 'Impact (1-3)': 'Impact (1-3)', 'Description / mitigation / manual evidence': 'Description / atténuation / preuve manuelle',
  };
  const RUNTIME_KEYS = {
    'Add / edit a milestone, deliverable, risk or task of your projects': 'Ajouter / modifier un jalon, un livrable, un risque ou une tâche de vos projets',
    'Amounts are restricted to the committee, the admin tier and the finance role.': 'Les montants sont réservés au comité, au palier admin et au rôle finance.',
    'Programme': 'Programme', 'Spent / budget': 'Dépensé / budget', 'Projects without a budget': 'Projets sans budget', 'No programme.': 'Aucun programme.',
    'Person': 'Personne', 'From': 'Du', 'To': 'Au', 'Peak load': 'Charge maximale', 'Tasks': 'Tâches',
    'Nobody is booked above 100 % on overlapping days.': 'Personne n’est réservé au-delà de 100 % sur des jours qui se chevauchent.',
    'No dated project.': 'Aucun projet daté.', 'Objective': 'Objectif', 'Confidence': 'Confiance', 'Evidence': 'Preuve', 'Slip': 'Glissement',
    'Projects': 'Projets', 'No objective.': 'Aucun objectif.', 'Project': 'Projet', 'Stage': 'Étape', 'Plan': 'Plan', 'End': 'Fin', 'Baseline': 'Référence',
    'Milestones': 'Jalons', 'Alerts': 'Alertes', 'No project.': 'Aucun projet.', 'Programmes': 'Programmes', 'Objectives': 'Objectifs', 'Risk': 'Risque', 'P × I': 'P × I', 'Severity': 'Gravité',
    'Mitigation': 'Atténuation', 'No risk.': 'Aucun risque.', 'Deleted.': 'Supprimé.', 'Roadmap migrated into the portfolio.': 'Roadmap migrée dans le portefeuille.',
  };
  root.I18N_FR_PORTFOLIO = Object.assign({}, STATIC, RUNTIME_KEYS);
  root.I18N_FR_PORTFOLIO_RUNTIME = Object.keys(RUNTIME_KEYS);
})(typeof window !== 'undefined' ? window : globalThis);
