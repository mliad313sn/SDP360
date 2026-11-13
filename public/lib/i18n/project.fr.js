/* PPM parity W4 — French for public/project.html (charter, plan, milestones, RAID, benefits, budget, RACI, changes,
 * board, comments, gates, history). Static markup first, then RUNTIME_KEYS (texts built in JS by the page and by
 * lib/ppmCollabUi.js / lib/ppmBoard.js).
 * NOT translated on purpose: options without a value attribute (task / milestone / RAID status codes, constraint codes
 * ASAP…MFO, RAID kinds) — their text IS the code posted to the API; element names and people (user data).
 * Inert unless ui_i18n_pages='1'.
 */
(function (root) {
  'use strict';
  const STATIC = {
    'Portfolio': 'Portefeuille', '▸ project': '▸ projet', 'Project': 'Projet',
    'Charter, plan, milestones, risks and gates of one project. “—” means not measured, never 0 (help §25).': 'Charte, plan, jalons, risques et jalons de décision d’un projet. « — » signifie non mesuré, jamais 0 (aide §25).',
    'Overview': 'Vue d’ensemble', 'Charter': 'Charte', 'Plan': 'Plan', 'Milestones': 'Jalons', 'RAID': 'RAID', 'Benefits': 'Bénéfices', 'Budget': 'Budget',
    'RACI': 'RACI', 'Changes': 'Changements', 'Board': 'Tableau', 'Gates': 'Jalons de décision', 'Comments': 'Commentaires', 'History': 'Historique',
    'Team': 'Équipe', 'Role': 'Rôle', 'Allocation to the project % (empty = unknown)': 'Affectation au projet % (vide = inconnue)', 'From': 'Du', 'To': 'Au',
    'Linked user account (optional — leave “not linked” for an external person)': 'Compte utilisateur lié (facultatif — laisser « non lié » pour une personne externe)',
    '— not linked —': '— non lié —', 'Save member': 'Enregistrer le membre', 'Project roles': 'Rôles projet',
    'Edit the charter (committee, while the project is in proposal or approval)': 'Modifier la charte (comité, tant que le projet est en proposition ou en approbation)',
    'Objective': 'Objectif', 'Scope — in': 'Périmètre — inclus', 'Scope — out': 'Périmètre — exclu', 'Success criteria': 'Critères de succès', 'Constraints': 'Contraintes',
    'Sponsor': 'Sponsor', 'Save the charter': 'Enregistrer la charte',
    'The approval gate reads the text of these fields (20 characters or more), not their layout.': 'Le jalon d’approbation lit le texte de ces champs (20 caractères ou plus), pas leur mise en forme.',
    'Schedule': 'Planning',
    'Keyboard: Tab to the chart, then the arrow keys move from task to task (Home / End: first / last) and Enter opens the task in the table below (and in the editor when you may edit). The table view holds the same data.':
      'Clavier : Tab jusqu’au graphique, puis les flèches passent d’une tâche à l’autre (Début / Fin : première / dernière) et Entrée ouvre la tâche dans le tableau ci-dessous (et dans l’éditeur si vous pouvez modifier). La vue tableau contient les mêmes données.',
    'Table view (the same data)': 'Vue tableau (les mêmes données)', 'Baseline versions': 'Versions de référence', 'Show as the dashed baseline': 'Afficher comme référence en pointillés',
    'Current task baselines': 'Références actuelles des tâches', 'Save this structure as a template': 'Enregistrer cette structure comme modèle',
    'Task names, WBS, durations and milestone names only — no people, dates or money. The template stays a draft until another committee member approves it (portfolio page).':
      'Noms des tâches, OTP, durées et noms des jalons seulement — ni personnes, ni dates, ni montants. Le modèle reste un brouillon jusqu’à ce qu’un autre membre du comité l’approuve (page portefeuille).',
    'Template name': 'Nom du modèle', 'Save as template': 'Enregistrer comme modèle', 'Resource conflicts on this project': 'Conflits de ressources sur ce projet',
    'Resource pressure per person and week': 'Charge par personne et par semaine', 'Add / edit a task': 'Ajouter / modifier une tâche', 'Task': 'Tâche', 'WBS code': 'Code OTP',
    'Parent task': 'Tâche parente', 'Start': 'Début', 'End': 'Fin', 'Duration (working days; 0 = milestone)': 'Durée (jours ouvrés ; 0 = jalon)', 'Allocation %': 'Affectation %',
    'Effort (hours)': 'Effort (heures)', 'Progress %': 'Avancement %',
    'Depends on (finish-to-start unless a link type is set below; Ctrl/⌘-click for several)': 'Dépend de (fin-début sauf type de lien indiqué ci-dessous ; Ctrl/⌘-clic pour plusieurs)',
    'Scheduling': 'Ordonnancement', 'auto (moved by its links)': 'auto (déplacée par ses liens)', 'manual (keeps its dates)': 'manuel (garde ses dates)', 'Constraint': 'Contrainte',
    'none (entered start = start no earlier than)': 'aucune (début saisi = début au plus tôt le)', 'Constraint date': 'Date de contrainte', 'Deadline': 'Échéance', 'Task type': 'Type de tâche',
    'none': 'aucun', 'fixed units': 'unités fixes', 'fixed duration': 'durée fixe', 'fixed work': 'travail fixe', 'Effort-driven': 'Pilotée par l’effort', 'default (on)': 'par défaut (oui)',
    'on': 'oui', 'off': 'non', 'Link types (e.g. 12:SS+2, 13:FF-1)': 'Types de lien (ex. 12:SS+2, 13:FF-1)', 'Save task': 'Enregistrer la tâche', 'Delete task': 'Supprimer la tâche',
    'Hours — planned, actual, variance': 'Heures — prévues, réelles, écart', 'Time entries': 'Saisies de temps', 'Person (empty = you)': 'Personne (vide = vous)', 'Day': 'Jour',
    'Hours (0-24)': 'Heures (0-24)', 'Note': 'Note', 'Record hours': 'Enregistrer les heures', 'Timesheet weeks — submit, approve, reject': 'Semaines de feuilles de temps — soumettre, approuver, rejeter',
    'Note for the next step (required to reject, 10 characters or more)': 'Note pour l’étape suivante (obligatoire pour rejeter, 10 caractères ou plus)',
    'Deliverables': 'Livrables', 'Add / edit a milestone': 'Ajouter / modifier un jalon', 'Milestone': 'Jalon', 'Baseline': 'Référence', 'Save milestone': 'Enregistrer le jalon',
    'Risks, assumptions, issues': 'Risques, hypothèses, problèmes', 'Show': 'Afficher', 'all kinds': 'tous les types', 'risks': 'risques', 'issues': 'problèmes', 'assumptions': 'hypothèses',
    'Dependencies are the task links of the Plan tab; decisions live in the decision register (DEC-…). Only an open': 'Les dépendances sont les liens de tâches de l’onglet Plan ; les décisions vivent dans le registre des décisions (DEC-…). Seul un',
    'with P × I ≥ 6 blocks the closed gate.': 'ouvert avec P × I ≥ 6 bloque le jalon de clôture.', 'Risk matrix (probability × impact)': 'Matrice des risques (probabilité × impact)',
    'Add / edit an entry': 'Ajouter / modifier une entrée', 'Entry': 'Entrée', 'Kind': 'Type', 'Probability (1-3)': 'Probabilité (1-3)', 'Impact (1-3)': 'Impact (1-3)',
    'Mitigation / response': 'Atténuation / réponse', 'Save entry': 'Enregistrer l’entrée', 'Expected and realised benefits': 'Bénéfices attendus et réalisés',
    'From its review date a benefit appears on the Site obligations view and on “My work” until a realised value with evidence is entered and verified by someone other than the person who entered it. Nothing is e-mailed.':
      'À partir de sa date de revue, un bénéfice apparaît dans la vue Obligations du site et dans « Mon travail » jusqu’à ce qu’une valeur réalisée avec preuve soit saisie et vérifiée par une autre personne que celle qui l’a saisie. Rien n’est envoyé par e-mail.',
    'Add / edit an expected benefit': 'Ajouter / modifier un bénéfice attendu', 'Benefit': 'Bénéfice', 'Measure': 'Mesure', 'Unit': 'Unité', 'Kind of value': 'Nature de la valeur',
    'quantity': 'quantité', 'money (amounts)': 'argent (montants)', 'Currency (money only)': 'Devise (argent seulement)', 'Baseline value': 'Valeur de référence', 'Target value': 'Valeur cible',
    'Benefit owner': 'Responsable du bénéfice', 'Owner as a user (reminder on “My work”)': 'Responsable comme utilisateur (rappel dans « Mon travail »)', 'Benefit review date': 'Date de revue du bénéfice',
    'Value class': 'Classe de valeur', '— unclassified —': '— non classé —', 'realised cash': 'trésorerie réalisée', 'cost avoidance (estimate)': 'coût évité (estimation)',
    'productivity time': 'temps de productivité', 'risk reduction': 'réduction du risque', 'other': 'autre', 'Basis of the realised value': 'Base de la valeur réalisée', '— not stated —': '— non indiqué —',
    'observed (measured)': 'observée (mesurée)', 'estimated avoidance': 'évitement estimé', 'Baseline period from': 'Période de référence du', 'Baseline period to': 'Période de référence au',
    'Measured from': 'Mesuré du', 'Measured to': 'Mesuré au', 'Source': 'Source', 'manual': 'manuelle', 'metric': 'indicateur', 'Metric key (metric source only)': 'Clé de l’indicateur (source indicateur seulement)',
    'Method note (how it was measured or estimated)': 'Note de méthode (comment c’est mesuré ou estimé)', 'Save benefit': 'Enregistrer le bénéfice', 'Delete benefit': 'Supprimer le bénéfice',
    'Changing the measure, unit, kind, baseline or target clears a verification.': 'Changer la mesure, l’unité, la nature, la référence ou la cible annule une vérification.',
    'Record a realised value': 'Saisir une valeur réalisée', 'Realised value': 'Valeur réalisée', 'Evidence link (http or https)': 'Lien de preuve (http ou https)', 'Record realised value': 'Enregistrer la valeur réalisée',
    'A new value clears an earlier verification; someone else then verifies it.': 'Une nouvelle valeur annule une vérification précédente ; une autre personne la vérifie ensuite.',
    'Budget per period (baseline, actual, forecast)': 'Budget par période (référence, réel, prévision)', 'Enter an amount (committee)': 'Saisir un montant (comité)', 'Month': 'Mois', 'Currency': 'Devise',
    'baseline': 'référence', 'actual': 'réel', 'forecast': 'prévision', 'Amount': 'Montant',
    'Justification (required when an amount changes or differs from the baseline)': 'Justification (obligatoire quand un montant change ou diffère de la référence)', 'Save amount': 'Enregistrer le montant',
    'Every entry is kept in the History tab with its old and new value.': 'Chaque saisie est conservée dans l’onglet Historique avec son ancienne et sa nouvelle valeur.',
    'Who does what (RACI)': 'Qui fait quoi (RACI)', 'Edit the RACI': 'Modifier le RACI', 'Names separated by commas. Every task that has letters needs exactly one A.': 'Noms séparés par des virgules. Chaque tâche qui a des lettres a exactement un A.',
    'Save RACI': 'Enregistrer le RACI', 'Change requests': 'Demandes de changement',
    'Note for the next step (required to reject or withdraw, 10 characters or more)': 'Note pour l’étape suivante (obligatoire pour rejeter ou retirer, 10 caractères ou plus)',
    'Propose a change': 'Proposer un changement', 'Reason (10 characters or more)': 'Motif (10 caractères ou plus)',
    'Dates impact (days, + later / − earlier; empty = not known)': 'Impact sur les dates (jours, + plus tard / − plus tôt ; vide = inconnu)',
    'Task changes to simulate (optional, one task per line: task id duration=5 effort=40 start=YYYY-MM-DD end=YYYY-MM-DD depends=3,4)': 'Changements de tâches à simuler (facultatif, une tâche par ligne : id tâche duration=5 effort=40 start=AAAA-MM-JJ end=AAAA-MM-JJ depends=3,4)',
    'Money impact (empty = not known)': 'Impact financier (vide = inconnu)', 'Currency (with an amount)': 'Devise (avec un montant)', 'Propose the change': 'Proposer le changement',
    'Board — work packages by status': 'Tableau — lots de travail par statut', 'Stage gates': 'Jalons de décision', 'History (append-only ledger)': 'Historique (registre en ajout seul)',
    'Project sections': 'Sections du projet', 'e.g. network engineer': 'ex. ingénieur réseau', 'Legend of the schedule': 'Légende du planning', 'Baseline version': 'Version de référence',
    'e.g. unplanned downtime': 'ex. arrêts non planifiés', 'e.g. hours / month': 'ex. heures / mois',
  };
  // Texts built in JS (lib/ppmCollabUi.js, lib/ppmBoard.js) — translated when they appear on the page.
  const RUNTIME_KEYS = {
    'To do': 'À faire', 'In progress': 'En cours', 'Blocked': 'Bloquée', 'Done': 'Terminée', 'Cancelled': 'Annulée', 'Other status': 'Autre statut', 'Move to': 'Déplacer vers',
    'Work packages are the tasks without sub-tasks; a summary task rolls up from its children. Drag a card, or use “Move to”.':
      'Les lots de travail sont les tâches sans sous-tâche ; une tâche récapitulative se calcule à partir de ses enfants. Glissez une carte, ou utilisez « Déplacer vers ».',
    'Post comment': 'Publier le commentaire', 'No comment yet.': 'Aucun commentaire pour l’instant.', 'Loading…': 'Chargement…', '— the whole project —': '— tout le projet —',
    'About a task (optional)': 'À propos d’une tâche (facultatif)', 'Comment (type @username to notify someone who can read this project)': 'Commentaire (tapez @identifiant pour prévenir une personne qui peut lire ce projet)',
    'Comments cannot be edited or deleted: post a correction instead.': 'Un commentaire ne se modifie ni ne se supprime : publiez une correction.',
    'You follow this project as a client: comments are read-only for you.': 'Vous suivez ce projet en tant que client : les commentaires sont en lecture seule pour vous.',
    'Comment posted.': 'Commentaire publié.', 'Your role on this project:': 'Votre rôle sur ce projet :', 'Member': 'Membre', 'Job': 'Fonction', 'Project role': 'Rôle projet', '— none —': '— aucun —',
    'No team member yet: add members in the Team panel first.': 'Aucun membre pour l’instant : ajoutez d’abord des membres dans le panneau Équipe.', '(no account)': '(sans compte)',
    'Project manager': 'Chef de projet', 'Scheduler': 'Planificateur', 'Resource manager': 'Gestionnaire des ressources', 'Contributor': 'Contributeur', 'Client (read-only)': 'Client (lecture seule)',
    'Project role saved.': 'Rôle projet enregistré.', 'Offline': 'Hors ligne', 'Online': 'En ligne', 'Apply my choices': 'Appliquer mes choix', 'Discard my edit': 'Abandonner ma modification',
    'Discard this edit': 'Abandonner cette modification', 'Field': 'Champ', 'When you edited': 'Quand vous avez modifié', 'Keep mine': 'Garder la mienne', 'Keep theirs': 'Garder la leur',
    'The change could not be re-applied automatically.': 'La modification n’a pas pu être réappliquée automatiquement.',
    'Saved on this device — it will be sent when the connection is back.': 'Enregistré sur cet appareil — envoyé au retour de la connexion.',
    'You follow this project as a client: you can read it, not change it.': 'Vous suivez ce projet en tant que client : vous pouvez le lire, pas le modifier.',
    'Your project role does not cover this change — the project manager makes it.': 'Votre rôle projet ne couvre pas cette modification — le chef de projet la fait.',
    'Your project role lets you change only some fields of this task.': 'Votre rôle projet ne vous permet de modifier que certains champs de cette tâche.',
    'As a contributor you update only the tasks you own.': 'En tant que contributeur, vous ne mettez à jour que vos propres tâches.',
    'The committee or the project manager assigns project roles.': 'Le comité ou le chef de projet attribue les rôles projet.',
    'A project role needs a team member linked to a user account.': 'Un rôle projet demande un membre de l’équipe lié à un compte utilisateur.',
  };
  root.I18N_FR_PROJECT = Object.assign({}, STATIC, RUNTIME_KEYS);
  root.I18N_FR_PROJECT_RUNTIME = Object.keys(RUNTIME_KEYS);
})(typeof window !== 'undefined' ? window : globalThis);
