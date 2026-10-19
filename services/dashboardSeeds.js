'use strict';
// Step 6 — the dashboards shipped with the platform, as DEFINITIONS (not pages). Each is a
// document the composer could have produced; they are published once at first boot and
// then belong to the installation (edit/retire from the composer, never re-seeded over).
//
// The executive home ("where are we") replaces the first fixed executive page. Every figure
// comes from a registered metric; a widget cannot carry a formula.

const L = (x, y, w, h) => ({ x, y, w, h });

const EXEC_HOME = {
  key: 'exec-home', title: 'Executive home — where are we', audience: 'executive',
  grid: { columns: 12 },
  filters: [{ key: 'site', type: 'site' }, { key: 'window', type: 'window' }],
  widgets: [
    { id: 'intro', type: 'text', layout: L(0, 0, 12, 1), markdown: '**Objective lights** — one figure per objective, fleet-wide, dated. Red = act this week.' },
    { id: 'k-tracker', type: 'kpi', metric: 'tracker.fleet_score_pct', title: 'Strategic roadmap', rag: 'tracker-executive', layout: L(0, 1, 3, 2) },
    { id: 'k-sla', type: 'kpi', metric: 'helpdesk.resolution_sla_pct', title: 'Resolution SLA', rag: 'sla-percent', layout: L(3, 1, 3, 2), compare: 'fleet' },
    { id: 'k-insp', type: 'kpi', metric: 'inspection.conformity_pct', title: 'Inspection conformity', rag: 'sla-percent', layout: L(6, 1, 3, 2), compare: 'fleet' },
    { id: 'k-meet', type: 'kpi', metric: 'meetings.engagement_score', title: '5 Engagements', rag: 'sla-percent', layout: L(9, 1, 3, 2), compare: 'fleet' },
    { id: 'mi', type: 'kpi', metric: 'helpdesk.window_major_incidents', title: 'Major incidents (week)', layout: L(0, 3, 3, 2), compare: 'fleet' },
    { id: 'overdue', type: 'kpi', metric: 'helpdesk.window_overdue', title: 'Overdue tickets (week)', layout: L(3, 3, 3, 2), compare: 'fleet' },
    { id: 'tr-sla', type: 'trend', metric: 'helpdesk.resolution_sla_pct', title: 'Resolution SLA — 13 weeks', window: '13w', layout: L(6, 3, 6, 3) },
    { id: 'sites', type: 'ragGrid', metric: 'helpdesk.resolution_sla_pct', title: 'Where are we — per site', rag: 'sla-percent', layout: L(0, 5, 6, 4) },
    { id: 'sites-tr', type: 'ragGrid', metric: 'tracker.site_score_pct', title: 'Roadmap — per site', rag: 'tracker-executive', layout: L(6, 6, 6, 3) },
    { id: 'acts', type: 'actions', layout: L(0, 9, 12, 3), sources: ['meetings', 'inspection', 'report'], onlyOverdue: true, title: 'Pending actions and decisions (overdue)' },
  ],
};

const SITE_WEEKLY = {
  key: 'site-weekly', title: 'Site weekly — operations', audience: 'site',
  grid: { columns: 12 },
  filters: [{ key: 'site', type: 'site' }, { key: 'window', type: 'window' }],
  widgets: [
    { id: 'created', type: 'kpi', metric: 'helpdesk.window_created', title: 'Tickets created', layout: L(0, 0, 3, 2) },
    { id: 'resolved', type: 'kpi', metric: 'helpdesk.window_resolved', title: 'Tickets resolved', layout: L(3, 0, 3, 2) },
    { id: 'overdue', type: 'kpi', metric: 'helpdesk.window_overdue', title: 'Overdue', layout: L(6, 0, 3, 2) },
    { id: 'mttr', type: 'kpi', metric: 'helpdesk.avg_resolution_h', title: 'Avg resolution (h)', layout: L(9, 0, 3, 2) },
    { id: 'wan1', type: 'kpi', metric: 'wan.wan1_availability_pct', title: 'WAN1 availability', layout: L(0, 2, 3, 2) },
    { id: 'wan2', type: 'kpi', metric: 'wan.wan2_availability_pct', title: 'WAN2 availability', layout: L(3, 2, 3, 2) },
    { id: 'insp', type: 'kpi', metric: 'inspection.open_actions', title: 'Open inspection actions', layout: L(6, 2, 3, 2) },
    { id: 'issues', type: 'kpi', metric: 'meetings.overdue_issues', title: 'Overdue meeting issues', layout: L(9, 2, 3, 2) },
    { id: 'tr', type: 'trend', metric: 'helpdesk.window_created', title: 'Tickets — 13 weeks', window: '13w', layout: L(0, 4, 12, 3) },
    { id: 'acts', type: 'actions', layout: L(0, 7, 12, 3), sources: ['meetings', 'inspection', 'report'], onlyOverdue: false, title: 'Open actions' },
  ],
};

const ASSETS_HYGIENE = {
  key: 'assets-hygiene', title: 'Assets — register hygiene', audience: 'site',
  grid: { columns: 12 },
  filters: [{ key: 'site', type: 'site' }],
  widgets: [
    { id: 'total', type: 'kpi', metric: 'assets.total', title: 'Assets', layout: L(0, 0, 3, 2) },
    { id: 'compl', type: 'kpi', metric: 'assets.completeness_pct', title: 'Completeness', rag: 'sla-percent', layout: L(3, 0, 3, 2) },
    { id: 'effort', type: 'kpi', metric: 'assets.effort_score', title: 'Effort score', rag: 'site-composite', layout: L(6, 0, 3, 2) },
    { id: 'rank', type: 'kpi', metric: 'assets.effort_rank', title: 'Rank', layout: L(9, 0, 3, 2) },
    { id: 'no-owner', type: 'kpi', metric: 'assets.no_owner', title: 'No user', layout: L(0, 2, 3, 2) },
    { id: 'no-age', type: 'kpi', metric: 'assets.no_age', title: 'No acquisition date', layout: L(3, 2, 3, 2) },
    { id: 'no-cost', type: 'kpi', metric: 'assets.no_cost', title: 'No cost', layout: L(6, 2, 3, 2) },
    { id: 'no-tag', type: 'kpi', metric: 'assets.no_asset_tag', title: 'No QR code', layout: L(9, 2, 3, 2) },
    { id: 'sites', type: 'ragGrid', metric: 'assets.completeness_pct', title: 'Completeness — per site', rag: 'sla-percent', layout: L(0, 4, 12, 4) },
  ],
};

const FIELD_SITE = {
  key: 'field-site', title: 'My site — field', audience: 'field',
  grid: { columns: 12 },
  filters: [{ key: 'site', type: 'site' }],
  widgets: [
    { id: 'overdue', type: 'kpi', metric: 'helpdesk.window_overdue', title: 'Overdue tickets', layout: L(0, 0, 6, 2) },
    { id: 'insp', type: 'kpi', metric: 'inspection.overdue_actions', title: 'Overdue inspection actions', layout: L(6, 0, 6, 2) },
    { id: 'wan1', type: 'kpi', metric: 'wan.wan1_availability_pct', title: 'WAN1', layout: L(0, 2, 6, 2) },
    { id: 'wan2', type: 'kpi', metric: 'wan.wan2_availability_pct', title: 'WAN2', layout: L(6, 2, 6, 2) },
    { id: 'acts', type: 'actions', layout: L(0, 4, 12, 3), sources: ['inspection', 'meetings'], onlyOverdue: true, title: 'Overdue actions' },
  ],
};


// Step 8 — governance dashboard for the committee: roadmap, programme score per site, engagements,
// resolution SLA trend and the overdue actions/decisions list. Counts of cadences/decisions/RFIs are
// read on the governance pages (/api/governance/overview); this definition stays metric-only.
const GOVERNANCE = {
  key: 'governance', title: 'Governance — committee view', audience: 'committee',
  grid: { columns: 12 },
  filters: [{ key: 'site', type: 'site' }, { key: 'window', type: 'window' }],
  widgets: [
    { id: 'intro', type: 'text', layout: L(0, 0, 12, 1), markdown: '**Committee view** — strategic roadmap, programme discipline and the decisions still open. Figures are dated; "—" = not measured.' },
    { id: 'roadmap', type: 'kpi', metric: 'tracker.fleet_score_pct', title: 'Strategic roadmap (fleet)', rag: 'tracker-executive', layout: L(0, 1, 3, 2) },
    { id: 'attain', type: 'kpi', metric: 'tracker.fleet_attainment_pct', title: 'Roadmap attainment', rag: 'tracker-executive', layout: L(3, 1, 3, 2) },
    { id: 'prog', type: 'kpi', metric: 'programme.site_score', title: 'Programme score (site)', rag: 'site-score', layout: L(6, 1, 3, 2), compare: 'fleet' },
    { id: 'eng', type: 'kpi', metric: 'meetings.engagement_score', title: '5 Engagements', rag: 'sla-percent', layout: L(9, 1, 3, 2), compare: 'fleet' },
    { id: 'sites', type: 'ragGrid', metric: 'programme.site_score', title: 'Programme score — per site', rag: 'site-score', layout: L(0, 3, 6, 4) },
    { id: 'tr', type: 'trend', metric: 'helpdesk.resolution_sla_pct', title: 'Resolution SLA — 13 weeks', window: '13w', layout: L(6, 3, 6, 4) },
    { id: 'acts', type: 'actions', layout: L(0, 7, 12, 3), sources: ['meetings', 'inspection', 'report'], onlyOverdue: true, title: 'Overdue actions (all registers)' },
  ],
};

const SEED_DASHBOARDS = [EXEC_HOME, SITE_WEEKLY, ASSETS_HYGIENE, FIELD_SITE, GOVERNANCE];

module.exports = { SEED_DASHBOARDS, EXEC_HOME, SITE_WEEKLY, ASSETS_HYGIENE, FIELD_SITE };
