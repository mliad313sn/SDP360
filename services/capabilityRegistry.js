'use strict';
// C-17 (G37 / A01) — capability catalogue. PURE: no database, no I/O.
//
// A capability NAMES an action the platform already guards today; it never adds a right.
// Each entry maps onto today's role strings (`legacy`, ANY-of, hierarchy implied by
// reports-db.userHasRole). The catalogue was seeded from the guards actually used on the live
// router (node tools/agent/authz-walk.js) and from the inline `userHasRole(..., '<role>')`
// checks in server.js + routes/*.js. tests/capability-registry.test.js proves that every
// guarded route maps to a capability whose decision equals the guard's for every role set
// (zero escalation) — a new guard or role set fails that test until it is catalogued here.
//
// Fields: id · en/fr label · risk low|med|high|critical · resource · legacy roles · scope
// site|platform · requires_request (PROPOSED sensitivity, not an approved list — human gate) ·
// prereq (qualification kinds; none today) · routes (path prefixes that pick this capability
// among several with the same role set) · inline (true = checked inside handlers, not a guard).

const C = (id, en, fr, risk, resource, legacy, scope, extra = {}) => Object.freeze({
  id, en, fr, risk, resource, legacy: Object.freeze([...legacy]), scope,
  requires_request: !!extra.requires_request, prereq: Object.freeze(extra.prereq || []),
  routes: Object.freeze(extra.routes || []), inline: !!extra.inline,
});

const CAPABILITIES = Object.freeze([
  // ── super_admin — platform settings and identity
  C('platform.identity.manage', 'Manage user accounts, roles and sessions', 'Gérer les comptes, rôles et sessions', 'critical', 'user', ['super_admin'], 'platform',
    { requires_request: true, routes: ['/api/reports/users', '/api/reports/sessions', '/api/access/templates', '/api/access/recert'] }),
  C('platform.audit_log.read', 'Read the system security log', 'Lire le journal de sécurité', 'high', 'system_log', ['super_admin'], 'platform',
    { routes: ['/api/reports/system-log'] }),
  C('platform.reference_data.manage', 'Manage reference codes and reset module lookups', 'Gérer les codes de référence et réinitialiser les listes', 'high', 'lookup', ['super_admin'], 'platform',
    { routes: ['/api/meetings/lookups', '/api/meetings/reset', '/api/inspection/reset', '/api/qualifications/kinds'] }),
  C('platform.roadmap.manage', 'Manage the personal ITSM roadmap', 'Gérer la feuille de route ITSM', 'med', 'roadmap', ['super_admin'], 'platform',
    { routes: ['/api/roadmap'] }),
  C('governance.roles.assign', 'Assign governance roles and deputies', 'Attribuer les rôles de gouvernance et les suppléants', 'high', 'governance_role', ['super_admin'], 'platform',
    { requires_request: true, routes: ['/api/governance/roles'] }),
  C('governance.sites.configure', 'Configure site codes and site attributes', 'Configurer les codes et attributs de site', 'high', 'site', ['super_admin'], 'platform',
    { routes: ['/api/governance/site-codes', '/api/governance/sites'] }),
  C('metrics.targets.set', 'Set or end metric targets', 'Fixer ou clore les cibles des indicateurs', 'high', 'metric_target', ['super_admin'], 'platform',
    { routes: ['/api/metrics/targets'] }),
  C('trackers.legacy.migrate', 'Migrate legacy tracker data', 'Migrer les données de l’ancien tracker', 'high', 'tracker', ['super_admin'], 'platform',
    { routes: ['/api/trackers/legacy'] }),
  C('platform.settings.manage', 'Manage platform settings, integrations and report delivery', 'Gérer les réglages, intégrations et envois de rapports', 'critical', 'config', ['super_admin'], 'platform',
    { requires_request: true }),
  // ── executive
  C('platform.sites.structure', 'Create or remove sites and departments', 'Créer ou supprimer des sites et départements', 'high', 'site', ['executive'], 'platform'),
  C('review.read', 'Read the IT Review dashboard', 'Lire le tableau IT Review', 'low', 'review', ['executive', 'scorecard-viewer'], 'platform'),
  // ── admin tier
  C('governance.policies.administer', 'Administer governance policies and role holders', 'Administrer les politiques et titulaires de gouvernance', 'high', 'governance_policy', ['admin'], 'platform',
    { routes: ['/api/governance/policies', '/api/governance/roles'] }),
  C('engagement.rules.manage', 'Manage alert rules, consumers and firings', 'Gérer les règles d’alerte, consommateurs et déclenchements', 'med', 'engagement_rule', ['admin'], 'platform',
    { routes: ['/api/engagement'] }),
  C('field.outbox.administer', 'See and resolve unresolved field outbox entries', 'Voir et résoudre les envois terrain en souffrance', 'high', 'field_record', ['admin'], 'platform',
    { routes: ['/api/field/admin'] }),
  C('ops.operate', 'Run operational jobs (syncs, cache, exports, group decks)', 'Lancer les traitements opérationnels (synchros, cache, exports, decks groupe)', 'med', 'operation', ['admin'], 'platform'),
  C('analytics.data.read', 'Read helpdesk analytics data', 'Lire les données d’analyse du helpdesk', 'low', 'analytics', ['admin', 'scorecard-viewer'], 'platform'),
  // ── feature roles (with the admin tier where the guard admits it)
  C('finance.read', 'Read asset amounts (finance, licences, investment, depreciation)', 'Lire les montants des actifs', 'high', 'asset_money', ['admin', 'finance-viewer'], 'platform',
    { requires_request: true }),
  // A1 — Finance verifier: certifies a money figure (held EXACTLY; the handler also requires the money-read rule and
  // refuses the last editor of the figures). B8 — dated FX rates and the Pronto actuals FILE import (admin tier).
  C('finance.certify', 'Certify or revoke a Finance figure', 'Certifier ou révoquer un chiffre financier', 'critical', 'finance_certification', ['finance-verifier'], 'platform',
    { requires_request: true, routes: ['/api/finance/certifications'] }),
  C('finance.fx_rates.manage', 'Enter or retire dated FX rates', 'Saisir ou retirer les taux de change datés', 'high', 'fx_rate', ['admin'], 'platform',
    { routes: ['/api/finance/fx-rates'] }),
  C('finance.actuals.import', 'Import Pronto actuals from a file (dry run, reconcile, commit)', 'Importer les réels Pronto depuis un fichier', 'high', 'budget_actual', ['admin'], 'platform',
    { routes: ['/api/finance/actuals'] }),
  // C-31 — KPI policy builder: drafts, proposals, shadow comparison, committee decisions (adoption = SoD in the store)
  C('kpi.policy.manage', 'Draft, propose, shadow-test and decide KPI policies', 'Rédiger, proposer, tester en ombre et décider les politiques KPI', 'high', 'kpi_policy', ['super_admin', 'kpi-committee'], 'platform',
    { routes: ['/api/kpi-policies'] }),
  C('governance.committee', 'Work in governance as a committee member', 'Travailler en comité de gouvernance', 'med', 'governance', ['admin', 'committee-member'], 'platform'),
  C('trackers.build', 'Build and administer generic trackers', 'Construire et administrer les trackers', 'med', 'tracker', ['admin', 'tracker-admin'], 'platform',
    { routes: ['/api/trackers'] }),
  C('tracker.export', 'Export the activity tracker deck', 'Exporter la présentation du tracker d’activités', 'low', 'tracker', ['admin', 'tracker-admin'], 'platform',
    { routes: ['/api/tracker/export'] }),
  C('tracker.read', 'Load the activity tracker', 'Charger le tracker d’activités', 'low', 'tracker', ['admin', 'tracker-admin', 'tracker-editor'], 'site'),
  C('tracker.save', 'Enter activity tracker figures', 'Saisir les chiffres du tracker d’activités', 'med', 'tracker', ['super_admin', 'tracker-admin', 'tracker-editor'], 'site'),
  C('tracker.reset', 'Reset the tracker or delete a tracker year', 'Réinitialiser le tracker ou supprimer une année', 'critical', 'tracker', ['super_admin', 'tracker-admin'], 'platform'),
  C('dashboards.publish', 'Publish and manage dashboards', 'Publier et gérer les tableaux de bord', 'med', 'dashboard', ['admin', 'dashboard-publisher'], 'platform'),
  C('field.capture', 'Capture field records and uploads', 'Saisir les relevés terrain et pièces jointes', 'med', 'field_record', ['admin', 'editor', 'field-tech'], 'site'),
  C('reports.studio.author', 'Author report-studio templates', 'Rédiger les modèles du studio de rapports', 'med', 'report_template', ['admin', 'report-author'], 'platform'),
  C('reports.deck.author', 'Build executive decks and run report analysis', 'Construire les présentations de direction', 'med', 'deck', ['report-author'], 'platform'),
  C('reports.audit.read', 'Read a report’s audit trail', 'Lire la piste d’audit d’un rapport', 'low', 'report_audit', ['audit-viewer', 'editor'], 'site'),
  C('assets.reconcile.decide', 'Record an asset reconciliation decision', 'Enregistrer une décision de réconciliation', 'med', 'asset', ['editor'], 'site'),
  // ── checked INSIDE handlers (no route guard) — named so refusals can say what is missing
  C('scope.all_sites', 'Act on every site (admin tier)', 'Agir sur tous les sites (palier admin)', 'high', 'site', ['admin'], 'platform', { inline: true }),
  C('site.records.edit', 'Edit the records of one’s own sites', 'Modifier les enregistrements de ses sites', 'med', 'site_record', ['editor'], 'site', { inline: true }),
  C('platform.override', 'Super-administrator decision inside a handler', 'Décision de super-administrateur dans un traitement', 'critical', 'platform', ['super_admin'], 'platform', { inline: true }),
  C('exec.override', 'Executive decision inside a handler', 'Décision de direction dans un traitement', 'high', 'platform', ['executive'], 'platform', { inline: true }),
  C('business.group.view', 'Group business view', 'Vue métier groupe', 'low', 'business_view', ['group-business'], 'platform', { inline: true }),
  C('audit.read', 'Read the audit log of every site', 'Lire le journal d’audit de tous les sites', 'med', 'audit', ['audit-viewer'], 'platform', { inline: true }),
]);

const _BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));
const _key = (roles) => [...new Set((roles || []).map(String))].sort().join('|');

function get(id) { return _BY_ID.get(String(id || '')) || null; }
function list() { return CAPABILITIES; }

/** Every capability whose legacy role set equals `roles` (order-insensitive). */
function byRoles(roles) {
  const k = _key(roles);
  return CAPABILITIES.filter((c) => _key(c.legacy) === k);
}

/**
 * The capability a route guard enforces: same role set, and — when several share it — the one
 * whose `routes` prefix matches the path (longest prefix wins), else the one without prefixes.
 * Inline capabilities are never chosen for a guard. null = not catalogued (deny by `can`).
 */
function forRoute(method, path, roles) {
  const p = String(path || '');
  const cands = byRoles(roles).filter((c) => !c.inline);
  let best = null, bestLen = -1;
  for (const c of cands) {
    for (const pre of c.routes) if (p.startsWith(pre) && pre.length > bestLen) { best = c; bestLen = pre.length; }
  }
  return best || cands.find((c) => !c.routes.length) || null;
}

module.exports = { CAPABILITIES, RISKS: Object.freeze(['low', 'med', 'high', 'critical']), get, list, byRoles, forRoute };
