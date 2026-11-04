/* A-09a — French for public/site-actions.html (Site Actions Register). Static markup first, then RUNTIME_KEYS:
 * the strings the page builds in JS (empty states, table headers, toasts, modal). Inert unless ui_i18n_pages='1'.
 * User data (action titles, owners, notes) is never a key. Dynamic strings with an embedded value (e.g.
 * "Failed to load: <error>") cannot be swapped exactly and stay English.
 */
(function (root) {
  'use strict';
  const STATIC = {
    'Insights · Actions': 'Analyses · Actions',
    'Site Actions Register': 'Registre des actions du site',
    'Also:': 'Aussi :', 'Handoffs': 'Demandes inter-services', 'Notifications': 'Notifications', 'Site obligations': 'Obligations du site',
    'Every still-open action — and every still-open': 'Toutes les actions encore ouvertes — et tous les',
    'problem': 'problèmes',
    'raised in a meeting — for one site, gathered from where they live —': 'encore ouverts soulevés en réunion — pour un site, rassemblés depuis leur source —',
    'Meetings': 'Réunions',
    'Business Incubation': 'Incubation métier',
    'sessions,': 'sessions,',
    'Inspections': 'Inspections',
    'and the weekly': 'et le suivi du',
    'Report follow-ups': 'Suivis du rapport',
    '— so you can see it all in one place and close it (or jump to where it is closed). Report follow-ups show the latest weekly report.':
      '— pour tout voir au même endroit et le clôturer (ou aller là où il se clôture). Les suivis du rapport viennent du dernier rapport hebdomadaire.',
    '— Select a site —': '— Choisir un site —',
    'Overdue only': 'En retard seulement',
    'Issues without action only': 'Problèmes sans action seulement',
    'Show closed / cancelled (30 days)': 'Afficher clôturés / annulés (30 jours)',
    'Filter by text…': 'Filtrer par texte…',
    'Open issues that no open action addresses yet': 'Problèmes ouverts qu’aucune action ouverte ne traite encore',
    'Issues and actions closed or cancelled in the last 30 days — change the status to reopen one':
      'Problèmes et actions clôturés ou annulés depuis 30 jours — changez le statut pour en rouvrir un',
  };
  const RUNTIME_KEYS = {
    'Pick a site to see its open actions.': 'Choisissez un site pour voir ses actions ouvertes.',
    'No open actions.': 'Aucune action ouverte.', 'No open actions match the filter.': 'Aucune action ouverte ne correspond au filtre.',
    'No open issues.': 'Aucun problème ouvert.', 'No open issues match the filter.': 'Aucun problème ouvert ne correspond au filtre.',
    'Nothing closed or cancelled in the last 30 days.': 'Rien de clôturé ou d’annulé depuis 30 jours.',
    'Nothing closed or cancelled in the last 30 days matches the filter.': 'Rien de clôturé ou d’annulé depuis 30 jours ne correspond au filtre.',
    'Open issues': 'Problèmes ouverts', 'Closed / cancelled — last 30 days': 'Clôturés / annulés — 30 derniers jours',
    'Report follow-up': 'Suivi du rapport', 'Meeting': 'Réunion', 'Incubation': 'Incubation', 'Inspection': 'Inspection',
    'Champion': 'Champion', 'Item': 'Élément', 'IT owner': 'Responsable IT', 'escalated': 'escaladé', 'incubation': 'incubation',
    '+ Action': '+ Action', '↗ open': '↗ ouvrir', '⏳ awaiting verification': '⏳ en attente de vérification',
    'New action for this issue': 'Nouvelle action pour ce problème', 'Same as which action?': 'Identique à quelle action ?',
    '★ likely': '★ probable', 'No Meetings or Inspection actions on this site to match against.': 'Aucune action de réunion ou d’inspection sur ce site à rapprocher.',
    'Describe the action': 'Décrivez l’action', 'Action added': 'Action ajoutée', 'Issue marked resolved': 'Problème marqué résolu',
    'Merge undone': 'Fusion annulée',
    'Report follow-ups are gathered across all weeks and de-duplicated — carried-forward copies of the same action collapse into one (its latest week). Merged follow-ups fold under their Meetings/Inspection origin. Age is unavailable for report follow-ups (no created timestamp) — they show the due date only.':
      'Les suivis du rapport sont rassemblés sur toutes les semaines et dédoublonnés — les copies reconduites d’une même action n’en font qu’une (sa semaine la plus récente). Les suivis fusionnés se rangent sous leur origine Réunions/Inspections. L’âge n’est pas disponible pour les suivis du rapport (pas de date de création) — seule l’échéance est affichée.',
  };
  root.I18N_FR_SITE_ACTIONS = Object.assign({}, STATIC, RUNTIME_KEYS);
  root.I18N_FR_SITE_ACTIONS_RUNTIME = Object.keys(RUNTIME_KEYS);
})(typeof window !== 'undefined' ? window : globalThis);
