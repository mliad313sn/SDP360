/* W2-UI — French texts of the interactive Gantt v2 (lib/ganttV2.js). Keys are the exact English texts; used only
 * when the UI language policy is on (report_config ui_i18n_pages = '1', window.__uiPolicy.i18n_pages). Every key the
 * module asks for is checked by tests/ppm-gantt-v2-page.smoke.test.js. */
window.I18N_FR_GANTT = {
  'MONTHS': 'janv.,févr.,mars,avr.,mai,juin,juil.,août,sept.,oct.,nov.,déc.',
  'Schedule tools': 'Outils du planning', 'View': 'Vue', 'Zoom': 'Zoom', 'Zoom in': 'Zoom avant', 'Zoom out': 'Zoom arrière', 'Timescale': 'Échelle de temps',
  'Days': 'Jours', 'Weeks': 'Semaines', 'Months': 'Mois', 'Quarters': 'Trimestres', 'Today': 'Aujourd’hui', 'today': 'aujourd’hui',
  'Undo': 'Annuler', 'Redo': 'Rétablir', 'Undone': 'Annulé', 'Redone': 'Rétabli', 'Saving…': 'Enregistrement…', 'Saved.': 'Enregistré.',
  'Gantt': 'Gantt', 'Task usage': 'Utilisation des tâches', 'Resource usage': 'Utilisation des ressources', 'Resource graph': 'Graphe des ressources', 'Network diagram': 'Diagramme de réseau', 'List': 'Liste',
  'Task': 'Tâche', 'Resource': 'Ressource', 'Duration': 'Durée', 'Start': 'Début', 'Finish': 'Fin', 'Predecessors': 'Prédécesseurs', '% complete': '% achevé', 'Total (h)': 'Total (h)',
  'Task grid': 'Grille des tâches', 'Gantt chart of the project tasks': 'Diagramme de Gantt des tâches du projet',
  'Bar = scheduled dates · red = critical path · dashed = baseline · ◆ = milestone · orange line = today.': 'Barre = dates planifiées · rouge = chemin critique · pointillés = référence · ◆ = jalon · ligne orange = aujourd’hui.',
  'Drag a bar to move it, its right edge to change the duration, its round handle onto another bar to link them (finish-to-start). Keyboard: Alt + arrows move, Alt + Shift + arrows resize, Ctrl+Z undo.': 'Faites glisser une barre pour la déplacer, son bord droit pour changer la durée, sa poignée ronde sur une autre barre pour les lier (fin-début). Clavier : Alt + flèches déplacent, Alt + Maj + flèches redimensionnent, Ctrl+Z annule.',
  'Read-only: you may not edit this plan.': 'Lecture seule : vous ne pouvez pas modifier ce plan.',
  'No task yet.': 'Aucune tâche pour l’instant.', 'No dated task: nothing to spread over time.': 'Aucune tâche datée : rien à répartir dans le temps.',
  'Only the first 400 tasks are drawn; use the list or the Gantt for the rest.': 'Seules les 400 premières tâches sont dessinées ; utilisez la liste ou le Gantt pour les autres.',
  'Hours = the task effort spread evenly over its working days. "?" = effort unknown, never counted as 0.': 'Heures = l’effort de la tâche réparti également sur ses jours ouvrés. « ? » = effort inconnu, jamais compté comme 0.',
  'Peak daily allocation per person (sum of the allocation % of the open tasks running that day). Red = above 100 %. "?" = tasks without an allocation, never counted as 0.': 'Pic d’affectation quotidienne par personne (somme des % d’affectation des tâches ouvertes en cours ce jour-là). Rouge = au-dessus de 100 %. « ? » = tâches sans affectation, jamais comptées comme 0.',
  'after': 'après', 'critical': 'critique', 'effort unknown': 'effort inconnu', 'moved by the scheduler': 'déplacée par le planificateur', 'no known allocation': 'aucune affectation connue',
  'not reported': 'non renseigné', 'not scheduled': 'non planifiée', 'peak': 'pic', 'progress': 'avancement', 'task(s) with unknown effort, not counted': 'tâche(s) à effort inconnu, non comptée(s)',
  'unassigned': 'non affecté', 'without allocation': 'sans affectation', 'working days': 'jours ouvrés',
  'Move': 'Déplacement', 'Resize': 'Changement de durée', 'Link': 'Lien', 'Edit': 'Modification',
  'A task needs a name.': 'Une tâche doit avoir un nom.', 'Duration: a whole number of working days (0 = milestone).': 'Durée : un nombre entier de jours ouvrés (0 = jalon).',
  'A date is not a real calendar date (YYYY-MM-DD).': 'Une date n’est pas une vraie date du calendrier (AAAA-MM-JJ).', '% complete: a number from 0 to 100.': '% achevé : un nombre de 0 à 100.',
  'Predecessors: task numbers separated by commas (e.g. 12, 13SS+2 when link types are on).': 'Prédécesseurs : numéros de tâches séparés par des virgules (ex. 12, 13SS+2 quand les types de lien sont activés).',
  'A task cannot depend on itself.': 'Une tâche ne peut pas dépendre d’elle-même.', 'A dependency points to a task that does not exist in this project.': 'Une dépendance pointe vers une tâche qui n’existe pas dans ce projet.',
  'The same dependency is listed twice.': 'La même dépendance figure deux fois.', 'These dependencies would make a loop (a task would wait for itself).': 'Ces dépendances formeraient une boucle (une tâche s’attendrait elle-même).',
  'A task cannot depend on its own parent or on one of its sub-tasks.': 'Une tâche ne peut pas dépendre de son parent ni de l’une de ses sous-tâches.', 'This column is read-only here.': 'Cette colonne est en lecture seule ici.',
  'Only finish-to-start links can be drawn while link types are switched off.': 'Seuls les liens fin-début peuvent être tracés tant que les types de lien sont désactivés.'
};
