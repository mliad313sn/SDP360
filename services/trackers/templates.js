'use strict';
// Step 7 — the starting TEMPLATES of the tracker builder (study §6.3, étape 7). A template is a definition without
// id, year or units: "Create from a template" fills them (units = the active sites) and opens the draft. Targets are
// written for every unit at creation with each item's default target. Wording and targets are proposals, editable in
// the builder before the first publish.

const T = (code, name, group, kpi, weight, target, extra) => Object.assign({ code, name, group, kpi, weight, start: 1, end: 12, shared: false, default_target: String(target) }, extra || {});

const TEMPLATES = [
  {
    key: 'dispatch-terrain',
    title: { fr: 'Dispatch terrain', en: 'Field dispatch' },
    description: 'Interventions des techniciens sur site : volume, délais, satisfaction.',
    groups: [{ code: 'VOL', name: 'Volume', weight: 0.4 }, { code: 'DELAI', name: 'Délais', weight: 0.4 }, { code: 'SAT', name: 'Satisfaction', weight: 0.2 }],
    items: [
      T('INTERVENTIONS', 'Interventions réalisées', 'VOL', 'COUNT', 1, 240),
      T('DELAI-RESPECTE', 'Interventions dans le délai (%)', 'DELAI', 'PERCENT', 0.6, 90),
      T('SLA-RESOLUTION', 'Délai de résolution respecté (tickets)', 'DELAI', 'PERCENT', 0.4, 90, { source: { metric: 'helpdesk.sla_res_pct' } }),
      T('NOTE-UTILISATEUR', 'Note des utilisateurs (sur 5)', 'SAT', 'RATING', 1, 4),
    ],
  },
  {
    key: 'deploiement-materiel',
    title: { fr: 'Déploiement de matériel', en: 'Hardware roll-out' },
    description: 'Postes, téléphones et équipements réseau livrés et mis en service.',
    groups: [{ code: 'LIVRE', name: 'Livraisons', weight: 0.5 }, { code: 'SERVICE', name: 'Mise en service', weight: 0.5 }],
    items: [
      T('POSTES', 'Postes de travail livrés', 'LIVRE', 'COUNT', 0.5, 120),
      T('TELEPHONES', 'Téléphones livrés', 'LIVRE', 'COUNT', 0.2, 60),
      T('RESEAU', 'Équipements réseau installés', 'LIVRE', 'COUNT', 0.3, 24),
      T('INVENTAIRE', 'Matériel inventorié dans le parc', 'SERVICE', 'PERCENT', 0.5, 100),
      T('RECETTE', 'Recette de mise en service signée', 'SERVICE', 'BOOLEAN', 0.5, 'TRUE/FALSE', { start: 1, end: 12 }),
    ],
  },
  {
    key: 'maintenance-site',
    title: { fr: 'Maintenance de site', en: 'Site maintenance' },
    description: 'Maintenance préventive, inspections et actions correctives du site.',
    groups: [{ code: 'PREV', name: 'Préventif', weight: 0.5 }, { code: 'CORR', name: 'Correctif', weight: 0.5 }],
    items: [
      T('INSPECTIONS', 'Inspections réalisées', 'PREV', 'COUNT', 0.5, 12),
      T('CONFORMITE', 'Conformité des inspections (%)', 'PREV', 'PERCENT', 0.5, 90, { source: { metric: 'inspections.conformity_pct' } }),
      T('ACTIONS-CLOSES', 'Actions correctives closes', 'CORR', 'COUNT', 0.6, 24),
      T('ONDULEURS', 'Remplacement des batteries d\'onduleurs', 'CORR', 'MILESTONE', 0.4, 3),
    ],
  },
  {
    key: 'conformite-reunions',
    title: { fr: 'Conformité des réunions', en: 'Meeting compliance' },
    description: 'Tenue et discipline des réunions de site (les 5 engagements).',
    groups: [{ code: 'TENUE', name: 'Tenue', weight: 0.5 }, { code: 'DISCIPLINE', name: 'Discipline', weight: 0.5 }],
    items: [
      T('PV', 'Procès-verbaux tenus', 'TENUE', 'COUNT', 0.6, 36, { source: { metric: 'meetings.pvs_held' } }),
      T('DEPARTEMENTS', 'Départements couverts', 'TENUE', 'COUNT', 0.4, 60, { source: { metric: 'meetings.depts_with_pv' } }),
      T('ENGAGEMENTS', 'Score des 5 engagements (%)', 'DISCIPLINE', 'PERCENT', 1, 80, { source: { metric: 'meetings.engagements_score' } }),
    ],
  },
];

/** A draft definition from a template, for the given id, year and units. */
function instantiate(key, { id, year, units }) {
  const t = TEMPLATES.find(x => x.key === key);
  if (!t) return null;
  const targets = {};
  for (const u of units) {
    targets[u.code] = {};
    for (const it of t.items) targets[u.code][it.code] = { target: it.default_target, active: true };
  }
  return {
    id, year, title: t.title, description: t.description, units,
    groups: t.groups.map(g => ({ ...g })),
    items: t.items.map(({ default_target, ...it }) => ({ ...it })),
    targets, audience: { roles: ['any'], site_scope: 'all' }, entry: { roles: ['editor'], own_unit_only: true }, rag_policy: 'tracker_activity',
  };
}

module.exports = { TEMPLATES, instantiate };
