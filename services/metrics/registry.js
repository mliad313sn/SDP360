'use strict';
// Step 3 (SDP-DASH-2.0) — the KPI dictionary. ONE entry per figure the platform shows: key, labels
// (EN/FR), formula in words, window, unit, direction, owner, source (where it is computed) and the
// RAG policy that colours it (public/lib/kpiRag.js; null = not coloured). `serve` names the reader
// GET /api/metrics/:key dispatches to (services/metrics/dispatch.js); null = documented only.
//
// The formulas are DESCRIBED here, not re-implemented: the numbers still come from the existing
// readers, so a dictionary entry can never drift from the screen it documents.

const OWNER = {
  ops: 'Service & Support Manager',
  coord: 'Site IT coordinators',
  infra: 'Infrastructure lead',
  assets: 'Asset managers',
  pmo: 'IT governance (PMO)',
};

const K = (key, o) => ({ key, unit: '', direction: 'higher', policy: null, serve: null, ...o });

const METRICS = [
  // ── Helpdesk (ServiceDesk Plus) ────────────────────────────────────────────
  K('helpdesk.inbound', { domain: 'helpdesk', en: 'Inbound tickets', fr: 'Tickets entrants', unit: 'count', direction: 'neutral',
    formula: 'Tickets created in the window for the site’s SDP groups (all request types).', window: 'calendar month', owner: OWNER.ops,
    source: 'reports-db.getCalendarMonthlyHelpdesk', serve: 'helpdesk_month' }),
  K('helpdesk.closed', { domain: 'helpdesk', en: 'Closed tickets', fr: 'Tickets clôturés', unit: 'count',
    formula: 'Tickets created in the window and closed (pending status = closed).', window: 'calendar month', owner: OWNER.ops,
    source: 'reports-db.getCalendarMonthlyHelpdesk', serve: 'helpdesk_month' }),
  K('helpdesk.close_pct', { domain: 'helpdesk', en: 'Closure rate', fr: 'Taux de clôture', unit: '%',
    formula: 'closed ÷ inbound × 100.', window: 'calendar month', owner: OWNER.ops,
    source: 'reports-db.getCalendarMonthlyHelpdesk', serve: 'helpdesk_month' }),
  K('helpdesk.sla_res_pct', { domain: 'helpdesk', en: 'Resolution SLA met', fr: 'SLA de résolution respecté', unit: '%',
    formula: 'Closed tickets not overdue ÷ closed tickets (ITSM denominator: only tickets with a verdict). Empty when nothing closed.',
    window: 'calendar month', owner: OWNER.ops, source: 'reports-db.getCalendarMonthlyHelpdesk', policy: 'sla_pct', serve: 'helpdesk_month' }),
  K('helpdesk.sla_reply_pct', { domain: 'helpdesk', en: 'First response SLA met', fr: 'SLA de 1re réponse respecté', unit: '%',
    formula: 'Responded tickets whose first response was on time ÷ responded tickets.', window: 'calendar month', owner: OWNER.ops,
    source: 'reports-db.getCalendarMonthlyHelpdesk', policy: 'sla_pct', serve: 'helpdesk_month' }),
  K('helpdesk.backlog', { domain: 'helpdesk', en: 'Open backlog', fr: 'Backlog ouvert', unit: 'count', direction: 'lower',
    formula: 'Tickets of the window still open (closed statuses excluded on both the flag and the status).', window: 'window', owner: OWNER.ops,
    source: 'reports-db.getSiteHelpdeskWindow', serve: 'helpdesk_window' }),
  K('helpdesk.sla_overdue', { domain: 'helpdesk', en: 'Tickets overdue on SLA', fr: 'Tickets en dépassement SLA', unit: 'count', direction: 'lower',
    formula: 'Tickets of the window whose resolution SLA is overdue (tickets with no SLA rule are not counted).', window: 'window', owner: OWNER.ops,
    source: 'reports-db.getSiteHelpdeskWindow', serve: 'helpdesk_window' }),
  K('helpdesk.major_incidents', { domain: 'helpdesk', en: 'Major incidents raised', fr: 'Incidents majeurs ouverts', unit: 'count', direction: 'lower',
    formula: 'Major incidents (request type or SDP template) created in the window.', window: 'window', owner: OWNER.ops,
    source: 'reports-db.getSiteHelpdeskWindow', serve: 'helpdesk_window' }),
  K('helpdesk.reopen_rate', { domain: 'helpdesk', en: 'Reopen rate', fr: 'Taux de réouverture', unit: '%', direction: 'lower',
    formula: 'Closed tickets reopened at least once ÷ closed tickets.', window: 'calendar month', owner: OWNER.ops, source: 'reports-db.getRequestMetrics' }),
  K('helpdesk.fcr_rate', { domain: 'helpdesk', en: 'First contact resolution', fr: 'Résolution au premier contact', unit: '%',
    formula: 'Survey responses saying the issue was solved at first contact ÷ responses.', window: 'calendar month', owner: OWNER.ops, source: 'executive-report.html (survey)' }),
  K('helpdesk.mttr_hours', { domain: 'helpdesk', en: 'Mean time to resolve', fr: 'Délai moyen de résolution', unit: 'h', direction: 'lower',
    formula: 'Average (resolved − created) over tickets resolved in the window.', window: 'calendar month', owner: OWNER.ops, source: 'reports-db.getRequestMetrics' }),
  K('helpdesk.csat_pct', { domain: 'helpdesk', en: 'Customer satisfaction', fr: 'Satisfaction client', unit: '%',
    formula: 'Rated responses with an overall score ≥ 80 % ÷ rated responses, scoped to the site’s support groups.', window: 'calendar month', owner: OWNER.ops, source: 'reports-db.getSurveyKpisDB', serve: 'survey_month' }),
  K('helpdesk.nps', { domain: 'helpdesk', en: 'Net promoter score', fr: 'Net promoter score', unit: 'pts',
    formula: '% promoters (score ≥ 90) − % detractors (< 70) among rated responses.', window: 'calendar month', owner: OWNER.ops, source: 'reports-db.getSurveyKpisDB', serve: 'survey_month' }),

  // ── Changes ────────────────────────────────────────────────────────────────
  K('changes.total', { domain: 'changes', en: 'Changes', fr: 'Changements', unit: 'count', direction: 'neutral',
    formula: 'Change records of the site’s SDP groups created in the window.', window: 'window', owner: OWNER.ops,
    source: 'reports-db.getSiteChangesWindow', serve: 'changes_window' }),
  K('changes.success_pct', { domain: 'changes', en: 'Change success rate', fr: 'Taux de succès des changements', unit: '%',
    formula: 'successful ÷ executed, executed = successful + partial + failed (incl. backed out) + cancelled; outcome read from the implementation-outcome / review fields. Empty when nothing executed.',
    window: 'window', owner: OWNER.ops, source: 'reports-db.getSiteChangesWindow', serve: 'changes_window' }),

  // ── Meetings (PV) ─────────────────────────────────────────────────────────
  K('meetings.pvs_held', { domain: 'meetings', en: 'PVs held', fr: 'PV tenus', unit: 'count',
    formula: 'Department meetings (PV) of the site dated in the month.', window: 'calendar month', owner: OWNER.coord,
    source: 'meetings-db.getSiteMonthlyMeetingSummary', serve: 'meetings_month' }),
  K('meetings.depts_with_pv', { domain: 'meetings', en: 'Departments met', fr: 'Départements rencontrés', unit: 'count',
    formula: 'Distinct departments with a PV in the month (Engagement #1 target: 3).', window: 'calendar month', owner: OWNER.coord,
    source: 'meetings-db.getSiteMonthlyMeetingSummary', serve: 'meetings_month' }),
  K('meetings.open_issues', { domain: 'meetings', en: 'Open issues', fr: 'Problèmes ouverts', unit: 'count', direction: 'lower',
    formula: 'Issues of the site not resolved / cancelled / transferred, all time.', window: 'all time', owner: OWNER.coord,
    source: 'meetings-db.getSiteMonthlyMeetingSummary', serve: 'meetings_month' }),
  K('meetings.high_open', { domain: 'meetings', en: 'HIGH issues open', fr: 'Problèmes HIGH ouverts', unit: 'count', direction: 'lower',
    formula: 'Open issues of severity HIGH, all time.', window: 'all time', owner: OWNER.coord, source: 'meetings-db.getSiteMonthlyMeetingSummary', serve: 'meetings_month' }),
  K('meetings.resolved_month', { domain: 'meetings', en: 'Issues resolved this month', fr: 'Problèmes résolus dans le mois', unit: 'count',
    formula: 'Issues closed during the month (any PV).', window: 'calendar month', owner: OWNER.coord, source: 'meetings-db.getSiteMonthlyMeetingSummary', serve: 'meetings_month' }),
  K('meetings.escalations_open', { domain: 'meetings', en: 'Open escalations', fr: 'Escalades ouvertes', unit: 'count', direction: 'lower',
    formula: 'Open issues flagged for the Mine IT Council.', window: 'all time', owner: OWNER.coord, source: 'meetings-db.getSiteMonthlyMeetingSummary', serve: 'meetings_month' }),
  K('meetings.engagements_score', { domain: 'meetings', en: '5 Engagements compliance', fr: 'Conformité aux 5 Engagements', unit: '%',
    formula: 'Unweighted mean of the measured engagements (E1 3 depts/month, E2 diffusion ≤ 48 h, E3 champion per action, E5 escalation discipline; E4 not measured).',
    window: 'selected months', owner: OWNER.coord, source: 'meetings-db.insights (site_leaderboard)', policy: 'meetings_compliance', serve: 'meetings_engagements' }),

  // ── Inspections ───────────────────────────────────────────────────────────
  K('inspections.done', { domain: 'inspections', en: 'Inspections done', fr: 'Inspections réalisées', unit: 'count',
    formula: 'Inspections of the site dated in the window.', window: 'window', owner: OWNER.coord, source: 'inspection-db.aggregate', serve: 'inspections_window' }),
  K('inspections.conformity_pct', { domain: 'inspections', en: 'Inspection conformity', fr: 'Conformité des inspections', unit: '%',
    formula: 'Findings “OK” ÷ applicable findings (N/A excluded). Empty when nothing applicable.', window: 'window', owner: OWNER.coord,
    source: 'services/metrics/formulas.conformityPct (also the scoreboard)', serve: 'inspections_window' }),
  K('inspections.open_actions', { domain: 'inspections', en: 'Open corrective actions', fr: 'Actions correctives ouvertes', unit: 'count', direction: 'lower',
    formula: 'Corrective actions of the window’s inspections not closed / cancelled.', window: 'window', owner: OWNER.coord, source: 'inspection-db.aggregate', serve: 'inspections_window' }),
  K('inspections.overdue_actions', { domain: 'inspections', en: 'Overdue corrective actions', fr: 'Actions correctives en retard', unit: 'count', direction: 'lower',
    formula: 'Open corrective actions past their due date.', window: 'window', owner: OWNER.coord, source: 'inspection-db.aggregate', serve: 'inspections_window' }),

  // ── Scores ────────────────────────────────────────────────────────────────
  K('score.programme', { domain: 'scores', en: 'Programme score (6 dimensions)', fr: 'Score programme (6 dimensions)', unit: 'pts',
    formula: '6 dimensions × 0/1/2 points ÷ 12 (reviews, resolution, overdue, sign-off, inspections, findings) — the IT Review model. “Not applicable” with no data.',
    window: 'rolling 3 months', owner: OWNER.pmo, source: 'services/siteScore.js', policy: 'programme_score' }),
  K('score.composite', { domain: 'scores', en: 'Problem-handling composite', fr: 'Composite de traitement des problèmes', unit: 'pts',
    formula: 'composite() of the IT Review model (engagement, resolution, MTTR vs fleet median, escalations).', window: 'programme to date',
    owner: OWNER.pmo, source: 'services/siteComposite.js', policy: 'composite' }),
  K('score.scoreboard', { domain: 'scores', en: 'Operational scoreboard', fr: 'Scoreboard opérationnel', unit: 'pts',
    formula: 'Weighted 40/20/20/20 of helpdesk SLA, inspection conformity, 5 Engagements, asset effort — renormalised over the measured dimensions.',
    window: 'calendar month', owner: OWNER.pmo, source: 'services/siteScoreboard.js', policy: 'scoreboard', serve: 'scoreboard_month' }),
  K('score.tracker_site', { domain: 'scores', en: 'Activity tracker site score', fr: 'Score du site (tracker d’activité)', unit: '%',
    formula: 'Weighted mean of the activity scores (actual ÷ pro-rated target, capped at 100 %), pillar weights × activity weights.',
    window: 'year to date', owner: OWNER.pmo, source: 'public/activity-tracker/engine.js + tracker-pptx.js', policy: 'tracker_site' }),
  K('score.tracker_activity', { domain: 'scores', en: 'Activity status', fr: 'État d’une activité', unit: '%',
    formula: 'Per KPI type: COUNT/PERCENT/CURRENCY/RATING actual ÷ pro-rated target; BOOLEAN done or not; MILESTONE phase ÷ target.',
    window: 'year to date', owner: OWNER.pmo, source: 'public/activity-tracker/engine.js + tracker-pptx.js', policy: 'tracker_activity' }),

  // ── Assets ────────────────────────────────────────────────────────────────
  K('assets.effort_score', { domain: 'assets', en: 'Asset register effort score', fr: 'Score de tenue du parc', unit: 'pts',
    formula: 'Mean of six “good state” rates (cost, age, owner, scan, QR code, enrolment) × 100; sites under 20 assets are scored but not ranked.',
    window: 'daily snapshot', owner: OWNER.assets, source: 'assets-db.snapshotEffort / getEffortLeaderboard', serve: 'assets_effort' }),
  K('assets.no_qr', { domain: 'assets', en: 'Assets without QR code', fr: 'Actifs sans QR code', unit: 'count', direction: 'lower',
    formula: 'Active assets whose SDP Barcode / QR code field is empty.', window: 'today', owner: OWNER.assets, source: 'assets-db (FOLLOWUP predicates)' }),
  K('assets.no_owner', { domain: 'assets', en: 'Assets without user', fr: 'Actifs sans utilisateur', unit: 'count', direction: 'lower',
    formula: 'Assets In Use / In Store / In Repair with no user name.', window: 'today', owner: OWNER.assets, source: 'assets-db (FOLLOWUP predicates)' }),
  K('assets.no_cost', { domain: 'assets', en: 'Assets without cost', fr: 'Actifs sans coût', unit: 'count', direction: 'lower',
    formula: 'Assets whose purchase cost is 0 / empty.', window: 'today', owner: OWNER.assets, source: 'assets-db HYGIENE_KINDS.no_cost' }),
  K('assets.no_age', { domain: 'assets', en: 'Assets without acquisition date', fr: 'Actifs sans date d’acquisition', unit: 'count', direction: 'lower',
    formula: 'Assets with no acquisition date.', window: 'today', owner: OWNER.assets, source: 'assets-db HYGIENE_KINDS.no_age' }),
  K('assets.under_licensed', { domain: 'assets', en: 'Under-licensed software titles', fr: 'Logiciels sous-licenciés', unit: 'count', direction: 'lower',
    formula: 'Metered titles whose SDP compliance verdict is “Under Licensed”.', window: 'today', owner: OWNER.assets, source: 'assets-db.getSoftwareComplianceSummary' }),
  K('assets.book_value_usd', { domain: 'assets', en: 'Computed book value', fr: 'Valeur nette comptable calculée', unit: 'USD', direction: 'neutral',
    formula: 'Σ computed depreciation (policy per product type) × XOF→USD rate. Admin+ only.', window: 'as of today', owner: OWNER.assets, source: 'services/depreciation.js' }),

  // ── Infrastructure ────────────────────────────────────────────────────────
  K('infra.wan_timeup_pct', { domain: 'infra', en: 'WAN % time up', fr: '% de disponibilité WAN', unit: '%',
    formula: 'Share of Meraki loss samples below the calibrated loss threshold (≥ 5 % loss = down), per uplink.', window: 'week / month',
    owner: OWNER.infra, source: 'services/merakiWanQuality.js (wan_link_snapshots)', policy: 'availability_target', serve: 'wan_period' }),
  K('infra.wan_sla_pct', { domain: 'infra', en: 'WAN contractual availability', fr: 'Disponibilité WAN contractuelle', unit: '%',
    formula: 'Service hours minus ISP-attributed total outages (notification → recovery) ÷ service hours.', window: 'calendar month',
    owner: OWNER.infra, source: 'services/wanSla.js', policy: 'wan_sla' }),
  K('infra.lan_availability', { domain: 'infra', en: 'LAN availability', fr: 'Disponibilité LAN', unit: '%',
    formula: 'Mean device availability (OpManager) of the LAN family; unmonitored counts as unavailable.', window: 'recent',
    owner: OWNER.infra, source: 'services/opmanagerAvailability.js', policy: 'opm_availability' }),
  K('infra.wifi_availability', { domain: 'infra', en: 'Wi-Fi availability', fr: 'Disponibilité Wi-Fi', unit: '%',
    formula: 'Mean device availability (OpManager) of the WLAN family.', window: 'recent', owner: OWNER.infra,
    source: 'services/opmanagerAvailability.js', policy: 'opm_availability' }),
  K('infra.servers_availability', { domain: 'infra', en: 'Server availability', fr: 'Disponibilité serveurs', unit: '%',
    formula: 'Mean device availability (OpManager) of the server family.', window: 'recent', owner: OWNER.infra,
    source: 'services/opmanagerAvailability.js', policy: 'opm_availability' }),

  // ── Governance / risk ─────────────────────────────────────────────────────
  K('risk.occurrences', { domain: 'risk', en: 'Risk occurrences', fr: 'Occurrences de risque', unit: 'count', direction: 'lower',
    formula: 'Operational incidents per site × risk domain (declared “Services affected” first, else category).', window: 'calendar month',
    owner: OWNER.ops, source: 'risk-register-export.js' }),
  K('reports.weekly_submitted', { domain: 'reports', en: 'Weekly report submitted', fr: 'Rapport hebdo soumis', unit: 'yes/no',
    formula: 'The site’s weekly report for the previous week has status “submitted” (“ready” = complete but not submitted).', window: 'previous week',
    owner: OWNER.coord, source: 'reports-db.getReport' }),
  K('sync.success_pct', { domain: 'platform', en: 'Sync success rate', fr: 'Taux de succès des synchronisations', unit: '%',
    formula: 'Successful runs ÷ (successful + failed) per scheduled job.', window: '28 days', owner: OWNER.pmo, source: 'services/sync/store.successStats' }),
];

const BY_KEY = new Map(METRICS.map(m => [m.key, m]));
function get(key) { return BY_KEY.get(String(key)) || null; }
function list() { return METRICS.slice(); }

module.exports = { METRICS, get, list };
