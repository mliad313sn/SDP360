/* Adoption Lot A (item 11) — French for public/meetings.html (static markup + the scope wording).
 * NOT translated on purpose: site, department, PV references (data / option codes). Inert unless ui_i18n_pages='1'.
 * Terms follow docs/i18n/GLOSSAIRE-FR.md (PROPOSED — to be validated by a French-speaking coordinator). */
(function (root) {
  'use strict';
  const STATIC = {
    // I18N-QUALITY — severity options (md_severities name_fr)
    // UX committee (visual polish): shorter hero sentence and icon buttons without glyph prefixes
    'One place for department meetings, IT survey concerns and Mine IT Council decisions; issues that meet an escalation criterion flow to the Council view.':
      'Un seul endroit pour les réunions de département, les préoccupations de l’enquête IT et les décisions du Mine IT Council ; les problèmes qui remplissent un critère d’escalade remontent dans la vue Council.',
    'New meeting': 'Nouvelle réunion', 'Bulk import': 'Import en masse', 'Export Excel': 'Export Excel', 'Refresh': 'Actualiser',
    'High@status': 'Haute',
    'Medium@status': 'Moyenne',
    'Low@status': 'Basse',
    // I18N-QUALITY — whole sentence (lib/i18nText.js matches the block first; inline tags kept in the value)
    'Single source of truth for the four-level engagement: Department Meetings (monthly per site IT), IT Survey concerns, and Mine IT Council decisions. Issues captured here flow through to the Council view when they cross any of the six escalation criteria. The 5 Engagements monitor tracks site IT discipline.': 'Source unique de référence pour l’engagement à quatre niveaux : <strong>réunions de département</strong> (mensuelles, menées par l’IT du site), préoccupations remontées par l’<strong>enquête IT</strong> et décisions du <strong>Mine IT Council</strong>. Les problèmes saisis ici remontent dans la vue Council dès qu’ils remplissent l’un des six critères d’escalade. Le suivi des 5 Engagements mesure la discipline de l’IT du site.',
    'Insights · Department Meetings & Council Escalations': 'Analyses · Réunions de département et escalades au Council',
    'Meetings & Decisions': 'Réunions et décisions',    'Department Meetings': 'Réunions de département','IT Survey': 'Enquête IT',
'Mine IT Council': 'Mine IT Council',
    '+ New meeting': '+ Nouvelle réunion', '↑ Bulk import': '↑ Import en masse', '⬇ Export Excel': '⬇ Export Excel', '↻ Refresh': '↻ Actualiser',
    'Since last meeting': 'Depuis la dernière réunion', "Pre-brief for the IT coordinator — what changed, what's new, what closed": 'Pré-brief du coordinateur IT — ce qui a changé, ce qui est nouveau, ce qui est clos',
    'Issues Log': 'Journal des problèmes', 'Every issue across all meetings, with all filters': 'Tous les problèmes de toutes les réunions, avec tous les filtres',
    'Council Escalations': 'Escalades au Council', 'Issues marked escalate=Y, grouped by Council theme': 'Problèmes marqués « escalader = O », regroupés par thème du Council',
    '5 Engagements monitor': 'Suivi des 5 Engagements', 'Site IT discipline scoreboard for the current month': 'Tableau de discipline de l’IT du site pour le mois en cours',
    'All sites': 'Tous les sites', 'All departments': 'Tous les départements', 'All statuses': 'Tous les statuts', 'All sources': 'Toutes les origines',
    'Recent meetings': 'Réunions récentes', 'Show': 'Afficher', 'per page': 'par page', '‹ Prev': '‹ Préc.', 'Page 1': 'Page 1', 'Next ›': 'Suiv. ›',
    'Download all meetings data (Meetings · Issues · Actions · Projects) as Excel': 'Télécharger toutes les données des réunions (réunions · problèmes · actions · projets) en Excel',
    'Search reference / lead / dept-head / priority…': 'Rechercher référence / responsable / chef de département / priorité…',
    'Previous page': 'Page précédente', 'Next page': 'Page suivante',
  };
  const RUNTIME = {
    // P11 r4 F-12 — texts built in script (toasts, empty states, row buttons, table heads)
    'Excel export failed:': 'Échec de l’export Excel :',
    'Failed to load meetings.': 'Échec du chargement des réunions.',
    'Reference': 'Référence',
    'Department · priorities': 'Département · priorités',
    'Dept Head · Site IT Lead': 'Chef de département · Responsable IT du site',
    'Meeting date': 'Date de réunion',
    'Issues · Esc.': 'Problèmes · Esc.',
    'No meetings match the current filter — try widening the date range or use “+ New meeting”.': 'Aucune réunion ne correspond au filtre courant — élargissez la période ou utilisez « + Nouvelle réunion ».',
    'No priorities recorded': 'Aucune priorité enregistrée',
    'Open ›': 'Ouvrir ›',
    'Issues captured': 'Problèmes enregistrés',
    'HIGH severity issues': 'Problèmes de gravité HAUTE',
    'Escalated to Council': 'Escaladé au Council',
    'No site in your scope': 'Aucun site dans votre périmètre',
    'Your account reads no site, so these figures are not measured for you. Ask an administrator to add your site.':
      'Votre compte ne lit aucun site : ces chiffres ne sont pas mesurés pour vous. Demandez à un administrateur d’ajouter votre site.',
    'No site in your scope — no meeting can be listed for your account.': 'Aucun site dans votre périmètre — aucune réunion ne peut être listée pour votre compte.',
    'Meetings YTD': 'Réunions depuis janvier', 'Signed': 'Signés', 'Departments covered': 'Départements couverts', 'HIGH issues': 'Problèmes ÉLEVÉS',
    'Escalations open': 'Escalades ouvertes', 'Overdue issues': 'Problèmes en retard', 'all sites': 'tous les sites', 'finalised PVs': 'PV finalisés',
    'distinct departments': 'départements distincts', 'production-impact': 'impact production', 'awaiting Council': 'en attente du Council', 'past target date': 'date cible dépassée',
  };
  root.I18N_FR_MEETINGS = Object.assign({}, STATIC, RUNTIME);
  root.I18N_FR_MEETINGS_RUNTIME = Object.keys(RUNTIME);
})(typeof window !== 'undefined' ? window : globalThis);
