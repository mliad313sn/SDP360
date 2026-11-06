'use strict';
// G16 — traceable inventory of the R01–R16 reports and A01–A16 automation rules requested by the 2027 brief
// (docs/sdp360/2027/briefs/2026-10-21-MASTER-GOAL-2027.md, "Minimum REPORT CATALOGUE" and "Mandatory AUTOMATION
// RULES"). Each entry names what the code ACTUALLY has today, the files that hold it, the switch that keeps any
// outbound delivery off, and what is missing. Nothing here grants delivery: a status says what exists, never that
// a report or rule is approved, configured in production or accepted by its audience.
//
//   status: 'implemented' = a working surface + delivery path exists (still armed OFF where it leaves the server)
//           'partial'     = the data or part of the workflow exists; the named gaps are open
//           'missing'     = nothing in the code yet
//   gates:  report_config keys that must be set before anything leaves the server, with their shipped default.
//   decision: the owner decision that blocks a full implementation (see docs/sdp360/completion/DECISIONS*).

const REPORTS = [
  { id: 'R01', priority: 'P0', name: 'Daily Site Action & Serious-Risk Exceptions', audience: 'Site IT Lead; site GM limited summary', cadence: 'daily', channels: ['inapp', 'teams', 'email-link'], status: 'partial',
    surfaces: ['public/site-actions.html', 'routes/commitments.js', 'services/engagementJobs.js'], gates: [['commitments_enabled', '0'], ['alert_external_enabled', '0']],
    missing: 'no dedicated daily pack; the site hub and the commitment exceptions list hold the content, the daily digest carries in-app notifications only', decision: 'D-13' },
  { id: 'R02', priority: 'P0', name: 'Friday IT Governance Pack', audience: 'Group Operations IT / division leads', cadence: 'weekly', channels: ['cockpit', 'teams', 'pptx'], status: 'partial',
    surfaces: ['public/cockpit.html', 'routes/governance.js'], gates: [['alert_external_enabled', '0']],
    missing: 'cockpit agenda exists; no PPTX pack and no Teams delivery of the pack', decision: 'D-13' },
  { id: 'R03', priority: 'P0', name: 'Commitment & Business Verification Register', audience: 'IT leadership and process owners', cadence: 'weekly', channels: ['dashboard', 'excel'], status: 'partial',
    surfaces: ['public/commitments.html', 'routes/commitments.js', 'services/commitmentLifecycle.js'], gates: [['commitments_enabled', '0']],
    missing: 'register and verification workflow exist behind a flag; no scheduled Excel delivery', decision: 'D-04' },
  { id: 'R04', priority: 'P0', name: 'Monthly Executive IT–Business Value Pack', audience: 'CIO/VP IT, executive leadership, authorised site leaders', cadence: 'monthly', channels: ['pptx', 'pdf', 'odata'], status: 'partial',
    surfaces: ['public/executive-report.html', 'public/report-studio.html', 'routes/reportStudio.js'], gates: [['publish_cron_enabled', '0']],
    missing: 'deck builder and reviewed/released report runs exist; the five-dimension weights are not approved', decision: 'D-01' },
  { id: 'R05', priority: 'P1', name: 'Department Business Partnering Report', audience: 'Department head and Site IT Lead', cadence: 'monthly', channels: ['link', 'pdf'], status: 'partial',
    surfaces: ['public/meetings-compliance.html', 'reports-pptx-shared.js'], gates: [],
    missing: 'meeting cadence and the department-meetings slide exist; no per-department report addressed to the department head', decision: 'D-13' },
  { id: 'R06', priority: 'P1', name: 'Inspections & Preventive Controls Assurance', audience: 'Infrastructure, Security/GRC, site managers', cadence: 'weekly/monthly', channels: ['dashboard', 'pptx'], status: 'partial',
    surfaces: ['public/inspections.html', 'public/inspection-actions.html', 'inspection-pptx.js'], gates: [],
    missing: 'repeat-finding trend is not computed; PDF is produced from the PPTX by the user; no verified-fix step: closing a corrective action is a status change, not an independent check', decision: null },
  { id: 'R07', priority: 'P1', name: 'Business Incubation & Opportunity Funnel', audience: 'PMO, business owners, CIO', cadence: 'monthly/quarterly', channels: ['dashboard', 'pptx'], status: 'partial',
    surfaces: ['public/meeting.html', 'services/incubationForm.js', 'routes/governance.js'], gates: [['incubation_rfi_link_enabled', '0']],
    missing: 'incubation sessions are captured and (switch on) raise one RFI each with a session → RFI → project lineage (E-I04); no funnel (conversion, business case, decision) report; RFI scoring for incubation is provisional (human)', decision: null },
  { id: 'R08', priority: 'P1', name: 'ServiceDesk Plus ITSM & SLA Reconciliation', audience: 'Service owners and IT Operations', cadence: 'daily/weekly/monthly', channels: ['dashboard', 'excel'], status: 'partial',
    surfaces: ['public/index.html', 'services/metricRegistry.js', 'FORMULA_RECONCILIATION.md'], gates: [],
    missing: 'figures and reconciliation notes exist; KPI definitions are not certified by the KPI Committee', decision: 'D-01' },
  { id: 'R09', priority: 'P1', name: 'OpManager Infrastructure & Network Service Health', audience: 'Infrastructure / Enterprise Architecture / Site', cadence: 'weekly/monthly', channels: ['dashboard', 'teams'], status: 'partial',
    surfaces: ['routes/opmanager.js', 'public/wan-health.html'], gates: [],
    missing: 'OpManager availability and coverage routes exist; OpManager alarms are not read; no Teams delivery. wan-health reads Meraki (kept, D-06) and is listed for the WAN picture, not as OpManager coverage', decision: null },
  { id: 'R10', priority: 'P1', name: 'IT Risk, Controls & Audit Action Pack', audience: 'Security Lead, control owners, auditors', cadence: 'monthly/quarterly', channels: ['pdf', 'excel'], status: 'partial',
    surfaces: ['risk-register-export.js', 'routes/governance.js'], gates: [],
    missing: 'risk register export and governance risks exist; no restricted audit pack', decision: 'D-14' },
  { id: 'R11', priority: 'P1', name: 'Data Integration & Reporting Reliability', audience: 'Platform admins / data engineer', cadence: 'daily and on failure', channels: ['admin', 'teams', 'email'], status: 'partial',
    surfaces: ['public/system-logs.html', 'services/sync/alerts.js', 'services/sync/jobs.js', 'services/deliveryFailures.js'], gates: [['sync_alert_enabled', '1'], ['sync_alert_recipients', ''], ['delivery_failure_alert_enabled', '0']],
    missing: 'sync health and failure alerts exist; alerts reach nobody until recipients or a Teams URL are set; report-delivery failures are listed on System Logs (E-R04) and alerted only with delivery_failure_alert_enabled = 1; export mismatch is not detected', decision: null },
  { id: 'R12', priority: 'P2', name: 'ITSM Asset & Ownership Exceptions', audience: 'IT asset / service owners', cadence: 'monthly', channels: ['excel', 'email'], status: 'implemented',
    surfaces: ['public/assets.html', 'tools/reports/send-hygiene.js', 'services/assetHygieneReport.js'], gates: [['hygiene_send_enabled', '0'], ['hygiene_recipients', '']],
    missing: 'no money is shown by design; renewals only where the SDP fields exist', decision: null },
  { id: 'R13', priority: 'P1', name: 'Native SDP360 Portfolio, Programme & Investment Review', audience: 'CIO / PMO / Finance', cadence: 'monthly/quarterly', channels: ['pptx', 'odata'], status: 'partial',
    surfaces: ['public/portfolio.html', 'routes/governance.js', 'services/portfolioEvidence.js'], gates: [],
    missing: 'portfolio view, plan, baseline, conflicts and money roll-up exist; no PPTX and no approved budget figures', decision: 'D-02' },
  { id: 'R14', priority: 'P2', name: 'Quarterly Business Relationship & Stakeholder Pulse', audience: 'Site GM, function heads, CIO', cadence: 'quarterly', channels: ['survey', 'dashboard'], status: 'missing',
    surfaces: [], gates: [],
    missing: 'only the helpdesk CSAT survey exists; a business-pulse instrument is PROPOSED in docs/ops/BUSINESS-PULSE-DRAFT.md (E-R05, not approved, nothing sent)', decision: 'D-13' },
  { id: 'R15', priority: 'P2', name: 'Change/Incident Post-Implementation Value Review', audience: 'Change/Incident manager and business sponsor', cadence: 'per major event', channels: ['pdf', 'record'], status: 'partial',
    surfaces: ['services/reportPayload.js'], gates: [],
    missing: 'major-incident RCA/CA/PIR/LL fields are read from SDP; no per-event review record or sign-off', decision: null },
  { id: 'R16', priority: 'P2', name: 'Native SDP360 Portfolio Budget & Roadmap Planning', audience: 'CIO / PMO / Finance', cadence: 'annual', channels: ['pptx', 'excel'], status: 'missing',
    surfaces: [], gates: [],
    missing: 'per-currency budget roll-up exists in the portfolio view; no annual planning pack', decision: 'D-02' },
];

const RULES = [
  { id: 'A01', name: 'High/critical finding without owner/date or exception', status: 'partial', surfaces: ['services/escalationRouting.js', 'services/commitmentEscalation.js', 'services/commitmentStore.js'], gates: [['commitments_enabled', '0'], ['commitment_notify_enabled', '0'], ['a01_missing_due_date', '0']],
    dedup: 'commitment_escalations.key', cooldown: 'one episode per key until cleared', missing: 'escalation recorded; outbound notice armed off; a missing due date also raises A01 only with a01_missing_due_date = 1 (E-R02, default off); commitments only, not inspection findings; hourly job, in-app only' },
  { id: 'A02', name: 'High/critical remedy due date breached', status: 'implemented', surfaces: ['services/commitmentEscalation.js', 'services/commitmentStore.js'], gates: [['commitments_enabled', '0'], ['commitment_notify_enabled', '0']],
    dedup: 'commitment_escalations.key', cooldown: 'one episode per key until cleared', missing: 'escalation recorded; outbound notice armed off' },
  { id: 'A03', name: 'Commitment technically completed → independent reviewer sign-off', status: 'partial', surfaces: ['services/commitmentLifecycle.js', 'services/commitmentNotices.js', 'routes/commitments.js'], gates: [['commitments_enabled', '0'], ['notifications_stop', '0']],
    dedup: 'one notice per transition', cooldown: null, missing: 'self-verification refused; the named reviewer (or the commitments.reviewer holders) gets an in-app notice (E-R02); no outbound channel; an unmatched reviewer name reaches nobody' },
  { id: 'A04', name: 'Verification rejected → reopen with reason', status: 'partial', surfaces: ['services/commitmentLifecycle.js', 'services/commitmentNotices.js', 'routes/commitments.js'], gates: [['commitments_enabled', '0'], ['notifications_stop', '0']],
    dedup: 'one notice per transition', cooldown: null, missing: 'reopen requires a reason and keeps history; the accountable owner gets an in-app notice with the reason (E-R02); no outbound channel' },
  { id: 'A05', name: 'Meeting / incubation / inspection approaching its schedule', status: 'missing', surfaces: [], gates: [],
    dedup: null, cooldown: null, missing: 'site calendar exists; no reminder job' },
  { id: 'A06', name: 'Recorded activity not submitted by deadline', status: 'partial', surfaces: ['services/weeklyReportData.js'], gates: [['weekly_report_send_enabled', '0']],
    dedup: null, cooldown: null, missing: '"complete but not submitted" is shown in the weekly e-mail; no exception record' },
  { id: 'A07', name: 'Critical monitored service/link outage or recurring incident pattern', status: 'partial', surfaces: ['tools/teams/poll-sla.js', 'tools/meraki/poll-wan-outages.js'], gates: [['teams_sla_enabled', '0']],
    dedup: 'sla_alert_log (request_id, kind)', cooldown: 'once per ticket and kind', missing: 'SDP SLA alerts and Meraki WAN outages (kept, D-06) exist; OpManager alarms are not read' },
  { id: 'A08', name: 'Source stale / row-count anomaly / failed delivery', status: 'partial', surfaces: ['services/sync/alerts.js', 'services/publishGate.js', 'services/sync/syncRunner.js'], gates: [['sync_alert_enabled', '1'], ['sync_alert_recipients', '']],
    dedup: 'after 2 failures, per job', cooldown: 'per job state', missing: 'stale sources lose their colour and block publication; a report-delivery failure is listed on System Logs (E-R04) and alerted once per new failure only with delivery_failure_alert_enabled = 1 (no automatic retry); export mismatch is not detected' },
  { id: 'A09', name: 'Benefit review date reached', status: 'partial', surfaces: ['services/portfolioBenefits.js', 'services/obligations.js', 'services/myWork.js', 'public/project.html'], gates: [], dedup: 'one line per benefit until verified', cooldown: null,
    missing: 'in-app reminder only (Site obligations + My work), no outbound notice; the benefit owner is free text, so the line goes to the project site, not to the person' },
  { id: 'A10', name: 'Funding review / stage gate / renewal date approaching', status: 'partial', surfaces: ['services/projectSchedule.js', 'services/ppmAlerts.js', 'tools/governance/ppm-alerts.js'], gates: [['ppm_alerts_enabled', '0'], ['a10_gate_lead_days', '']], dedup: 'ppm_alert_state per project, stage and gate date', cooldown: '7 days', missing: 'stage gates enforced; in-app reminder before the next gate (start / planned end) when a10_gate_lead_days is set (E-R02); no funding-review or renewal date exists in the schema; lead days not decided' },
  { id: 'A11', name: 'Milestone / dependency / capacity blocked, late or unowned', status: 'partial', surfaces: ['services/ppmAlerts.js', 'tools/governance/ppm-alerts.js', 'routes/governance.js', 'public/cockpit.html'], gates: [['ppm_alerts_enabled', '0']],
    dedup: 'item key, 7 days', cooldown: '7 days per item; cleared when the item disappears', missing: 'armed off until the committee decides the thresholds; capacity overload waits for A-13' },
  { id: 'A12', name: 'KPI policy / source mapping change → controlled recalculation', status: 'partial', surfaces: ['services/governancePolicy.js'], gates: [], dedup: null, cooldown: null, missing: 'policy history is hash-chained; no RFI and dual-run comparison' },
  { id: 'A13', name: 'Friday review preparation (exception-only agenda)', status: 'partial', surfaces: ['public/cockpit.html', 'routes/governance.js', 'services/agendaDrafts.js'], gates: [['agenda_cron_enabled', '0']], dedup: null, cooldown: null, missing: 'with agenda_cron_enabled = 1 the Monday job compiles a DRAFT agenda per cadence due that week (E-G03); nothing is sent, the secretary still prepares and distributes; distribution list not authorised' },
  { id: 'A14', name: 'Report cutoff → draft, review, freeze, distribute, log receipt', status: 'partial', surfaces: ['routes/reportStudio.js', 'services/reportStore.js', 'services/engagementJobs.js'], gates: [['publish_cron_enabled', '0'], ['notifications_stop', '0']],
    dedup: 'report_runs per template and period', cooldown: null, missing: 'drafts, review, frozen publication exist; recipient receipt is not recorded' },
  { id: 'A15', name: 'Inactive stakeholder closure approval → reminder/escalation', status: 'missing', surfaces: [], gates: [], dedup: null, cooldown: null, missing: 'service window not decided' },
  { id: 'A16', name: 'Evidence retention / sensitive-link expiry → archive/revoke event', status: 'partial', surfaces: ['services/engagementStore.js', 'services/sync/jobs.js'], gates: [], dedup: null, cooldown: null, missing: 'links expire and are revocable with receipts; audit retention job runs; no archive event for evidence' },
];

// E-R01 — the report CONTRACT: who owns it, who checks it before it leaves, which test proves its content and
// where a delivery leaves a trace. owner_role stays 'to be named' wherever the code does not know an owner — naming
// owners and audiences is a human decision (D-13). validation describes the review step the code enforces today
// (null = none in code). delivery_proof: 'report_sent_log' (sender writes one row per send), 'report_runs' (report
// studio run + publish connector log), 'notifications' (in-app rows), or 'none'.
const TO_NAME = 'to be named';
const CONTRACT = {
  R01: { validation: null, test: ['tests/engagement-store.test.js', 'tests/alert-outbound-arm.test.js', 'tests/commitments-routes.smoke.test.js'], delivery_proof: 'notifications' },
  R02: { validation: null, test: ['tests/governance-routes.smoke.test.js'], delivery_proof: 'none' },
  R03: { validation: 'business verification by a reviewer other than the owner (services/commitmentLifecycle.js)', test: ['tests/commitment-lifecycle.test.js', 'tests/commitments-routes.smoke.test.js'], delivery_proof: 'none' },
  R04: { validation: 'report studio: a draft run is moved to reviewed before it can be published (routes/reportStudio.js)', test: ['tests/report-studio-routes.smoke.test.js', 'tests/publish-gate.test.js', 'tests/exec-pptx-python.test.js'], delivery_proof: 'report_runs' },
  R05: { validation: null, test: ['tests/meetings-summary.test.js'], delivery_proof: 'none' },
  R06: { validation: null, test: ['tests/inspection-routes.test.js'], delivery_proof: 'none' },
  R07: { validation: null, test: ['tests/incubation-rfi-link.smoke.test.js'], delivery_proof: 'none' },
  R08: { validation: null, test: ['tests/metrics-registry.test.js'], delivery_proof: 'none' },
  R09: { validation: null, test: ['tests/opm-routes.smoke.test.js'], delivery_proof: 'none' },
  R10: { validation: null, test: ['tests/risk-register-classify.test.js'], delivery_proof: 'none' },
  R11: { validation: null, test: ['tests/sync-schedule.test.js', 'tests/catalogue-dry-run.test.js', 'tests/delivery-failures.test.js'], delivery_proof: 'none' },
  R12: { validation: null, test: ['tests/send-hygiene.test.js', 'tests/asset-hygiene-report.test.js'], delivery_proof: 'report_sent_log' },
  R13: { validation: null, test: ['tests/portfolio-deck.test.js'], delivery_proof: 'none' },
  R14: { validation: null, test: [], delivery_proof: 'none' },
  R15: { validation: null, test: [], delivery_proof: 'none' },
  R16: { validation: null, test: [], delivery_proof: 'none' },
};
for (const r of REPORTS) Object.assign(r, { owner_role: TO_NAME, validation: null, test: [], delivery_proof: 'none' }, CONTRACT[r.id] || {});
const DELIVERY_PROOFS = ['report_sent_log', 'report_runs', 'notifications', 'none'];

const STATUSES = ['implemented', 'partial', 'missing'];
const count = (list) => Object.fromEntries(STATUSES.map((s) => [s, list.filter((x) => x.status === s).length]));

function summary() { return { reports: count(REPORTS), rules: count(RULES) }; }

function toMarkdown() {
  const L = ['# Report and automation-rule catalogue (G16, generated)', '',
    'Generated from `services/reportCatalogue.js` — do not edit by hand. Source of the requested items: the 2027 brief',
    '(`docs/sdp360/2027/briefs/2026-10-21-MASTER-GOAL-2027.md`). A status says what the code has today; it never means a',
    'report or rule is approved, configured in production or accepted by its audience. Every switch that lets something',
    'leave the server ships off; the STOP switch `notifications_stop` halts every engagement outbound channel at once.', '',
    `Reports: ${JSON.stringify(summary().reports)} · Rules: ${JSON.stringify(summary().rules)}`, '',
    '## Reports', '', '| Id | Pri | Report | Audience | Cadence | Status | Where | Switches (default) | Open | Decision |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of REPORTS) L.push(`| ${r.id} | ${r.priority} | ${r.name} | ${r.audience} | ${r.cadence} | ${r.status} | ${r.surfaces.map((s) => '`' + s + '`').join('<br>') || '—'} | ${r.gates.map(([k, v]) => `\`${k}\`=${v === '' ? '(empty)' : v}`).join('<br>') || '—'} | ${r.missing} | ${r.decision || '—'} |`);
  L.push('', '## Report contracts (E-R01)', '', 'Owner = `to be named` wherever the code knows no owner (naming owners and audiences is a human decision, D-13). Validation = the review step the code enforces before release (— = none in code).', '',
    '| Id | Owner | Validation | Test proving the content | Delivery proof |', '|---|---|---|---|---|');
  for (const r of REPORTS) L.push(`| ${r.id} | ${r.owner_role} | ${r.validation || '—'} | ${r.test.map((t) => '`' + t + '`').join('<br>') || '—'} | ${r.delivery_proof} |`);
  L.push('', '## Automation rules', '', '| Id | Rule | Status | Where | Switches (default) | Dedup | Cool-down | Open |', '|---|---|---|---|---|---|---|---|');
  for (const a of RULES) L.push(`| ${a.id} | ${a.name} | ${a.status} | ${a.surfaces.map((s) => '`' + s + '`').join('<br>') || '—'} | ${a.gates.map(([k, v]) => `\`${k}\`=${v === '' ? '(empty)' : v}`).join('<br>') || '—'} | ${a.dedup || '—'} | ${a.cooldown || '—'} | ${a.missing} |`);
  return L.join('\n') + '\n';
}

// ── B-07 — D-13 decision pack: read helpers for the catalogue dry run (tools/reports/catalogue-dry-run.js) ──
// PURE: no database, no SMTP, no network. The CLI reads config + directory + history inside a READ ONLY
// transaction and hands them here. Each helper copies the rule the REAL sender applies, so the pack says who
// WOULD receive today — not who should. Secret-shaped values (webhook URLs, the Teams channel map) are only
// ever reported as "configured"/"not configured"; their content is never read or printed.
const { resolveFromRows } = require('./reportDirectory');

// How each catalogue id leaves the server today. Ids absent from this map have NO outbound sender in code.
const DELIVERY = {
  R01: { kind: 'digest', note: 'only the engagement digest e-mail exists (unread in-app notifications, daily 07:00); there is no daily pack' },
  R04: { kind: 'publish' },
  R11: { kind: 'sync_alert' },
  R12: { kind: 'group_list', arm: 'hygiene_send_enabled', list: 'hygiene_recipients', reportType: 'hygiene' },
  A01: { kind: 'commitment_notify', alert: 'A01' },
  A02: { kind: 'commitment_notify', alert: 'A02' },
  A06: { kind: 'directory', arm: 'weekly_report_send_enabled', role: 'coordinator', reportType: 'weekly_report' },
  A07: { kind: 'teams_sla' },
  A08: { kind: 'sync_alert' },
  A14: { kind: 'publish' },
};
// Scheduled senders that exist in code but carry no R/A id. Shown so the meeting sees every outbound path.
const OTHER_SENDERS = [
  { id: 'coordinator', name: 'Monthly site report to the coordinator (tools/reports/send-reports.js)', kind: 'directory', arm: null, role: 'coordinator', reportType: 'coordinator',
    note: 'NO arm flag: the scheduled task SDP-Report-coordinator-monthly is the only switch' },
  { id: 'scoreboard', name: 'Operational site scoreboard (tools/reports/send-scoreboard.js)', kind: 'directory', arm: 'scoreboard_send_enabled', role: 'coordinator', reportType: 'scoreboard' },
  { id: 'asset_group', name: 'Assets — group digest (tools/reports/send-asset-group.js)', kind: 'group_list', arm: 'asset_group_send_enabled', list: 'asset_group_recipients', reportType: 'asset_group' },
  { id: 'asset_reminder', name: 'Monday asset recap (tools/reports/send-asset-reminders.js)', kind: 'directory', arm: 'asset_reminder_send_enabled', role: 'asset_manager', reportType: 'asset_reminder' },
  { id: 'asset_new_alert', name: 'New-hardware alert after the nightly asset sync', kind: 'directory', arm: 'asset_new_alert_enabled', role: 'asset_manager', reportType: 'asset_new_alert' },
];

const _on = (v) => String(v == null ? '' : v) === '1';
const _set = (v) => String(v == null ? '' : v).trim() !== '';
// The two list syntaxes the senders use: the group digests split on ',' (decideHygieneSend /
// decideAssetGroupSend); the sync alerter and the publish connector split on /[,;\s]+/ (server.js
// getAlertConfig, engagementJobs.publishScheduled).
function splitComma(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }
function splitAny(v) { return String(v || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean); }

/** Effective config = shipped DEFAULTS overlaid with the stored report_config rows (the getConfig rule). */
function effectiveConfig(defaults, storedRows) {
  const cfg = { ...(defaults || {}) };
  for (const r of storedRows || []) if (r && r.key) cfg[r.key] = r.value == null ? '' : String(r.value);
  return cfg;
}

/**
 * Directory recipients exactly as the per-site senders resolve them: inactive sites skipped (send-reports
 * decideSends), confirmed address only unless never_send_unconfirmed='0' (resolveFromRows), and for the asset
 * reminders the asset manager first with the coordinator in cc (send-asset-reminders recipientsFor).
 * Also lists the unconfirmed addresses that the confirmed-only rule keeps out.
 */
function directoryRecipients(rows, role, cfg) {
  const neverUnconfirmed = String((cfg || {}).never_send_unconfirmed) !== '0';
  const sendable = [], skipped = [];
  for (const r of rows || []) {
    const site = r.site_code;
    if (!site) continue;
    if (Number(r.active) === 0) { skipped.push({ site, reason: 'inactive site' }); continue; }
    let rc = null;
    if (role === 'asset_manager') {
      const am = resolveFromRows(rows, site, 'asset_manager', { neverSendUnconfirmed: neverUnconfirmed });
      const co = resolveFromRows(rows, site, 'coordinator', { neverSendUnconfirmed: neverUnconfirmed });
      rc = am ? { to: am.to, cc: co && co.to !== am.to ? [co.to] : [] } : (co ? { to: co.to, cc: [] } : null);
    } else {
      rc = resolveFromRows(rows, site, role, { neverSendUnconfirmed: neverUnconfirmed });
    }
    if (rc) { sendable.push({ site, to: rc.to, cc: rc.cc || [] }); continue; }
    const email = role === 'asset_manager' ? (r.asset_manager_email || r.coordinator_email) : r[`${role === 'fm' ? 'fm' : 'coordinator'}_email`];
    skipped.push({ site, reason: email ? 'address on file but NOT confirmed' : 'no address on file' });
  }
  return { sendable, skipped, neverUnconfirmed };
}

/** One sender, evaluated against today's config + directory. → { switches, armed, recipients, blockers, channels } */
function evaluateDelivery(desc, ctx) {
  const cfg = ctx.cfg || {}, def = ctx.defaults || {};
  const sw = (k) => ({ key: k, value: cfg[k] == null ? '' : String(cfg[k]), default: def[k] == null ? '' : String(def[k]) });
  const smtp = _set(cfg.smtp_host);
  const stop = _on(cfg.notifications_stop);
  const out = { kind: desc.kind, switches: [], armed: false, recipients: [], skipped: [], channels: [], blockers: [], note: desc.note || null };
  const needMail = (list) => { if (list.length && !smtp) out.blockers.push('SMTP not configured (`smtp_host` empty): no e-mail can leave'); };
  switch (desc.kind) {
    case 'group_list': {
      out.switches = [sw(desc.arm), sw(desc.list)];
      out.armed = _on(cfg[desc.arm]);
      const list = splitComma(cfg[desc.list]);
      out.recipients = list.map((to) => ({ to }));
      out.channels = ['email'];
      if (!out.armed) out.blockers.push(`\`${desc.arm}\` is off`);
      if (!list.length) out.blockers.push(`\`${desc.list}\` is empty`);
      needMail(list);
      break;
    }
    case 'directory': {
      out.switches = desc.arm ? [sw(desc.arm), sw('never_send_unconfirmed')] : [sw('never_send_unconfirmed')];
      out.armed = desc.arm ? _on(cfg[desc.arm]) : true;
      const d = directoryRecipients(ctx.directory, desc.role, cfg);
      out.recipients = d.sendable; out.skipped = d.skipped; out.channels = ['email'];
      if (desc.arm && !out.armed) out.blockers.push(`\`${desc.arm}\` is off`);
      if (!d.sendable.length) out.blockers.push(`no site has a confirmed ${desc.role === 'asset_manager' ? 'asset-manager or coordinator' : desc.role} address`);
      if (!d.neverUnconfirmed) out.blockers.push('`never_send_unconfirmed`=0: UNCONFIRMED addresses would also be used');
      needMail(d.sendable);
      break;
    }
    case 'sync_alert': {
      // server.js getAlertConfig: enabled unless '0'; recipients split /[,;\s]+/; Teams webhook optional.
      out.switches = [sw('sync_alert_enabled'), sw('sync_alert_recipients'), { ...sw('sync_alert_teams_url'), value: _set(cfg.sync_alert_teams_url) ? '(configured)' : '' }];
      out.armed = String(cfg.sync_alert_enabled) !== '0';
      const list = splitAny(cfg.sync_alert_recipients);
      const teams = _set(cfg.sync_alert_teams_url);
      out.recipients = list.map((to) => ({ to }));
      if (teams) out.recipients.push({ to: 'Teams channel (webhook configured — URL not shown)' });
      out.channels = ['email', 'teams'];
      if (!out.armed) out.blockers.push('`sync_alert_enabled` is 0');
      if (out.armed && !list.length && !teams) out.blockers.push('`sync_alert_enabled`=1 while `sync_alert_recipients` and `sync_alert_teams_url` are empty: alerts are raised and their dedup mark is stored, then dropped');
      needMail(list);
      break;
    }
    case 'publish': {
      out.switches = [sw('publish_cron_enabled'), sw('notifications_stop'), sw('publish_excel_recipients'),
        { ...sw('publish_webhook_url'), value: _set(cfg.publish_webhook_url) ? '(configured)' : '' }];
      out.armed = _on(cfg.publish_cron_enabled) && !stop;
      const list = splitAny(cfg.publish_excel_recipients);
      out.recipients = list.map((to) => ({ to }));
      if (_set(cfg.publish_webhook_url)) out.recipients.push({ to: 'webhook (configured — URL not shown)' });
      const sp = ['sharepoint_tenant_id', 'sharepoint_client_id', 'sharepoint_client_secret', 'sharepoint_site_id', 'sharepoint_list_id'].every((k) => _set(cfg[k]));
      if (sp) out.recipients.push({ to: 'SharePoint list (Graph app configured)' });
      out.channels = ['email-excel', 'webhook', 'sharepoint'];
      if (!_on(cfg.publish_cron_enabled)) out.blockers.push('`publish_cron_enabled` is off');
      if (stop) out.blockers.push('`notifications_stop`=1 halts it');
      if (!out.recipients.length) out.blockers.push('no Excel recipient, webhook or SharePoint list configured');
      needMail(list);
      break;
    }
    case 'digest': {
      out.switches = [sw('notifications_stop'), sw('alert_external_enabled'), { ...sw('engagement_teams_url'), value: _set(cfg.engagement_teams_url) ? '(configured)' : '' },
        { ...sw('engagement_webhook_url'), value: _set(cfg.engagement_webhook_url) ? '(configured)' : '' }];
      out.armed = !stop;
      out.recipients = (ctx.digestUsers || []).filter((u) => u.digest === 'daily').map((u) => ({ to: u.email || `${u.name} (no e-mail on the account → skipped)`, name: u.name, skip: !u.email }));
      out.channels = ['email-digest', 'inapp'];
      if (stop) out.blockers.push('`notifications_stop`=1 halts the digest');
      if (!out.recipients.some((r) => !r.skip)) out.blockers.push('no user is subscribed to the daily digest with an e-mail on the account');
      needMail(out.recipients.filter((r) => !r.skip));
      const ext = (ctx.alertRules || []).filter((r) => (r.channels || []).some((c) => c !== 'inapp'));
      out.extra = `engagement alert rules: ${(ctx.alertRules || []).length} enabled, ${ext.length} with an outbound channel; outbound ${_on(cfg.alert_external_enabled) && !stop ? 'ARMED' : 'off'} (\`alert_external_enabled\`). In-app recipients are per rule — Admin ▸ Alert rules ▸ dry run lists them.`;
      break;
    }
    case 'commitment_notify': {
      out.switches = [sw('commitments_enabled'), sw('commitment_notify_enabled')];
      out.armed = _on(cfg.commitments_enabled) && _on(cfg.commitment_notify_enabled);
      out.channels = ['inapp'];
      out.recipients = [{ to: 'in-app only: the escalation-matrix target of the commitment\'s site and severity (resolved at run time, not simulated here)' }];
      if (!_on(cfg.commitments_enabled)) out.blockers.push('`commitments_enabled` is off (the escalation job does not run)');
      else if (!_on(cfg.commitment_notify_enabled)) out.blockers.push('`commitment_notify_enabled` is off (escalations are recorded, nobody is told)');
      break;
    }
    case 'teams_sla': {
      const ch = _set(cfg.teams_sla_channels);
      out.switches = [sw('teams_sla_enabled'), { ...sw('teams_sla_channels'), value: ch ? '(configured)' : '' }];
      out.armed = _on(cfg.teams_sla_enabled);
      out.channels = ['teams'];
      if (ch) out.recipients = [{ to: 'Teams channels per SDP group (map is a secret — Admin ▸ Intégration API ▸ Alertes SLA lists the groups)' }];
      if (!out.armed) out.blockers.push('`teams_sla_enabled` is off');
      if (!ch) out.blockers.push('no Teams channel mapped (`teams_sla_channels` empty)');
      if (!_set(cfg.sdp_api_refresh_token)) out.blockers.push('SDP API not connected (`sdp_api_refresh_token` empty)');
      break;
    }
    default: break;
  }
  return out;
}

/** What the history says for one sender over the window. `h` = the history object the CLI gathered. */
function firedSummary(desc, h) {
  if (!h) return 'history not read';
  const sent = (t) => (h.sent_log || []).filter((r) => r.report_type === t).map((r) => `${r.n} × ${r.result || '?'}`).join(', ') || 'nothing logged';
  const err = (k) => (h.errors && h.errors[k] ? `unavailable (${h.errors[k]})` : null);
  switch (desc.kind) {
    case 'group_list': case 'directory': return err('sent_log') || `report_sent_log: ${sent(desc.reportType)}`;
    case 'sync_alert': {
      if (err('sync')) return err('sync');
      const fails = (h.sync_errors || []).map((r) => `${r.job} ${r.n}`).join(', ') || 'none';
      const raised = (h.sync_alerts || []).map((r) => r.key.replace(/^alert:/, '')).join(', ') || 'none';
      return `failed sync runs: ${fails}. Alerts raised (dedup watermark set): ${raised}`;
    }
    case 'publish': return err('runs') || `report runs: ${(h.report_runs || []).map((r) => `${r.n} × ${r.status}`).join(', ') || 'none'}; publish connector runs: ${(h.publish_runs || []).map((r) => `${r.n} × ${r.status}`).join(', ') || 'none'}`;
    case 'digest': return err('notifications') || `in-app notifications created: ${h.notifications == null ? '?' : h.notifications}; engagement alert firings: ${h.alert_firings == null ? '?' : h.alert_firings}`;
    case 'commitment_notify': {
      if (err('escalations')) return err('escalations');
      const r = (h.escalations || []).find((x) => x.kind === desc.alert);
      return r ? `${r.n} escalation(s) seen, ${r.open} still open` : 'no escalation seen';
    }
    case 'teams_sla': return err('sla') || `sla_alert_log: ${(h.sla_alerts || []).map((r) => `${r.n} × ${r.kind}`).join(', ') || 'nothing logged'}`;
    default: return '—';
  }
}

/** The whole pack as data. ctx = { cfg, defaults, directory, digestUsers, alertRules, history, days, now } */
function buildDryRun(ctx) {
  const one = (item, desc) => {
    if (!desc) return { id: item.id, name: item.name, status: item.status, sender: false, decision: item.decision || null, open: item.missing };
    const ev = evaluateDelivery(desc, ctx);
    return { id: item.id, name: item.name, status: item.status, sender: true, decision: item.decision || null, open: item.missing, ...ev, fired: firedSummary(desc, ctx.history) };
  };
  return {
    generated_at: (ctx.now || new Date()).toISOString(), days: ctx.days,
    smtp: _set((ctx.cfg || {}).smtp_host), stop: _on((ctx.cfg || {}).notifications_stop),
    never_send_unconfirmed: String((ctx.cfg || {}).never_send_unconfirmed) !== '0',
    reports: REPORTS.map((r) => one(r, DELIVERY[r.id])),
    rules: RULES.map((a) => one(a, DELIVERY[a.id])),
    others: OTHER_SENDERS.map((o) => ({ ...one({ id: o.id, name: o.name, status: 'implemented', missing: '' }, o) })),
  };
}

const _reach = (x) => x.recipients.filter((r) => !r.skip).length;
const _cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
function _who(x) {
  if (!x.sender) return 'no sender in code';
  if (!x.recipients.length) return 'nobody';
  return x.recipients.map((r) => (r.site ? `${r.site}: ${r.to}${r.cc && r.cc.length ? ' (cc ' + r.cc.join(', ') + ')' : ''}` : r.to)).join('<br>');
}
function _decision(x) {
  if (!x.sender) return x.decision ? `${x.decision} (build the sender first)` : 'build a sender, then D-13';
  return `D-13: arm or keep off? who receives?${x.decision && x.decision !== 'D-13' ? ' · also ' + x.decision : ''}`;
}

function dryRunMarkdown(d) {
  const L = ['# D-13 decision pack — dry run of every report and alert', '',
    `Generated ${d.generated_at} by \`tools/reports/catalogue-dry-run.js\` · history window: last ${d.days} day(s).`,
    '**Read-only**: nothing was sent, nothing was written (the database was read inside a READ ONLY transaction).',
    'Recipients are the ones the real senders would use **today** (confirmed directory addresses, configured lists).',
    'Webhook / Teams URLs are secrets: only "configured" is shown. This pack decides nothing — the meeting does.', '',
    '## Read this first', '',
    `- SMTP (\`smtp_host\`): ${d.smtp ? 'configured' : '**NOT configured — no e-mail can leave the server**'}`,
    `- STOP switch \`notifications_stop\`: ${d.stop ? '**1 — engagement alerts, digests and publication are halted**' : '0'}`,
    `- \`never_send_unconfirmed\`: ${d.never_send_unconfirmed ? '1 — unconfirmed directory addresses are never used' : '**0 — unconfirmed directory addresses WOULD be used**'}`];
  const all = [...d.reports, ...d.rules, ...d.others];
  for (const x of all) if (x.sender && x.armed && !_reach(x)) L.push(`- **${x.id} is armed but reaches nobody**: ${x.blockers.join('; ')}`);
  for (const x of all) if (x.sender && x.armed && _reach(x) && x.id === 'coordinator') L.push(`- **coordinator monthly report has no arm flag**: ${_reach(x)} site(s) would be mailed the moment its scheduled task runs`);
  L.push('', '## Summary', '', '| Id | Report / rule | Sender in code | Armed today | Would reach today | Fired, last ' + d.days + ' d | Decision to take |', '|---|---|---|---|---|---|---|');
  for (const x of all) L.push(`| ${x.id} | ${_cell(x.name)} | ${x.sender ? x.kind : 'none'} | ${x.sender ? (x.armed ? '**yes**' : 'no') : '—'} | ${x.sender ? (x.armed ? _reach(x) + ' recipient(s)' : '0 (off)') : '—'} | ${x.sender ? _cell(x.fired) : '—'} | ${_cell(_decision(x))} |`);
  L.push('', '## Detail — items with an outbound sender', '');
  for (const x of all.filter((y) => y.sender)) {
    L.push(`### ${x.id} — ${x.name}`, '',
      `- Switches: ${x.switches.map((s) => `\`${s.key}\`=${s.value === '' ? '(empty)' : s.value}${s.value !== s.default && !/^\(configured\)$/.test(s.value) ? ` (default ${s.default === '' ? '(empty)' : s.default})` : ''}`).join(' · ')}`,
      `- Armed today: ${x.armed ? '**yes**' : 'no'} · channels: ${x.channels.join(', ')}`,
      `- Would receive today: ${_who(x).replace(/<br>/g, '; ')}`);
    if (x.skipped && x.skipped.length) L.push(`- Kept out: ${x.skipped.map((s) => `${s.site} (${s.reason})`).join('; ')}`);
    if (x.blockers.length) L.push(`- Why nothing leaves / what is missing: ${x.blockers.join('; ')}`);
    if (x.extra) L.push(`- ${x.extra}`);
    if (x.note) L.push(`- Note: ${x.note}`);
    L.push(`- Last ${d.days} day(s): ${x.fired}`, `- Open in the code: ${x.open || '—'}`, `- Decision: ${_decision(x)}`, '');
  }
  L.push('## Items with no outbound sender in code', '', '| Id | Report / rule | Status | Open | Decision |', '|---|---|---|---|---|');
  for (const x of all.filter((y) => !y.sender)) L.push(`| ${x.id} | ${_cell(x.name)} | ${x.status} | ${_cell(x.open)} | ${_cell(_decision(x))} |`);
  return L.join('\n') + '\n';
}

module.exports = { REPORTS, RULES, STATUSES, DELIVERY_PROOFS, summary, toMarkdown,
  DELIVERY, OTHER_SENDERS, splitComma, splitAny, effectiveConfig, directoryRecipients, evaluateDelivery, firedSummary, buildDryRun, dryRunMarkdown };
