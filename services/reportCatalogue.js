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
    surfaces: ['public/meeting.html', 'services/incubationForm.js'], gates: [],
    missing: 'incubation sessions are captured; no funnel (conversion, business case, decision) report', decision: null },
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
    surfaces: ['public/system-logs.html', 'services/sync/alerts.js', 'services/sync/jobs.js'], gates: [['sync_alert_enabled', '1'], ['sync_alert_recipients', '']],
    missing: 'sync health and failure alerts exist; alerts reach nobody until recipients or a Teams URL are set; report-delivery failures are logged, not alerted; export mismatch is not detected', decision: null },
  { id: 'R12', priority: 'P2', name: 'ITSM Asset & Ownership Exceptions', audience: 'IT asset / service owners', cadence: 'monthly', channels: ['excel', 'email'], status: 'implemented',
    surfaces: ['public/assets.html', 'tools/reports/send-hygiene.js', 'services/assetHygieneReport.js'], gates: [['hygiene_send_enabled', '0'], ['hygiene_recipients', '']],
    missing: 'no money is shown by design; renewals only where the SDP fields exist', decision: null },
  { id: 'R13', priority: 'P1', name: 'Native SDP360 Portfolio, Programme & Investment Review', audience: 'CIO / PMO / Finance', cadence: 'monthly/quarterly', channels: ['pptx', 'odata'], status: 'partial',
    surfaces: ['public/portfolio.html', 'routes/governance.js', 'services/portfolioEvidence.js'], gates: [],
    missing: 'portfolio view, plan, baseline, conflicts and money roll-up exist; no PPTX and no approved budget figures', decision: 'D-02' },
  { id: 'R14', priority: 'P2', name: 'Quarterly Business Relationship & Stakeholder Pulse', audience: 'Site GM, function heads, CIO', cadence: 'quarterly', channels: ['survey', 'dashboard'], status: 'missing',
    surfaces: [], gates: [],
    missing: 'only the helpdesk CSAT survey exists; a business-pulse survey instrument is not defined', decision: 'D-13' },
  { id: 'R15', priority: 'P2', name: 'Change/Incident Post-Implementation Value Review', audience: 'Change/Incident manager and business sponsor', cadence: 'per major event', channels: ['pdf', 'record'], status: 'partial',
    surfaces: ['services/reportPayload.js'], gates: [],
    missing: 'major-incident RCA/CA/PIR/LL fields are read from SDP; no per-event review record or sign-off', decision: null },
  { id: 'R16', priority: 'P2', name: 'Native SDP360 Portfolio Budget & Roadmap Planning', audience: 'CIO / PMO / Finance', cadence: 'annual', channels: ['pptx', 'excel'], status: 'missing',
    surfaces: [], gates: [],
    missing: 'per-currency budget roll-up exists in the portfolio view; no annual planning pack', decision: 'D-02' },
];

const RULES = [
  { id: 'A01', name: 'High/critical finding without owner/date or exception', status: 'partial', surfaces: ['services/escalationRouting.js', 'services/commitmentEscalation.js', 'services/commitmentStore.js'], gates: [['commitments_enabled', '0'], ['commitment_notify_enabled', '0']],
    dedup: 'commitment_escalations.key', cooldown: 'one episode per key until cleared', missing: 'escalation recorded; outbound notice armed off; only a missing accountable owner raises A01 (a missing due date does not); commitments only, not inspection findings; hourly job, in-app only' },
  { id: 'A02', name: 'High/critical remedy due date breached', status: 'implemented', surfaces: ['services/commitmentEscalation.js', 'services/commitmentStore.js'], gates: [['commitments_enabled', '0'], ['commitment_notify_enabled', '0']],
    dedup: 'commitment_escalations.key', cooldown: 'one episode per key until cleared', missing: 'escalation recorded; outbound notice armed off' },
  { id: 'A03', name: 'Commitment technically completed → independent reviewer sign-off', status: 'partial', surfaces: ['services/commitmentLifecycle.js'], gates: [['commitments_enabled', '0']],
    dedup: null, cooldown: null, missing: 'self-verification refused; the reviewer is not notified' },
  { id: 'A04', name: 'Verification rejected → reopen with reason', status: 'partial', surfaces: ['services/commitmentLifecycle.js'], gates: [['commitments_enabled', '0']],
    dedup: null, cooldown: null, missing: 'reopen requires a reason and keeps history; owner is not notified' },
  { id: 'A05', name: 'Meeting / incubation / inspection approaching its schedule', status: 'missing', surfaces: [], gates: [],
    dedup: null, cooldown: null, missing: 'site calendar exists; no reminder job' },
  { id: 'A06', name: 'Recorded activity not submitted by deadline', status: 'partial', surfaces: ['services/weeklyReportData.js'], gates: [['weekly_report_send_enabled', '0']],
    dedup: null, cooldown: null, missing: '"complete but not submitted" is shown in the weekly e-mail; no exception record' },
  { id: 'A07', name: 'Critical monitored service/link outage or recurring incident pattern', status: 'partial', surfaces: ['tools/teams/poll-sla.js', 'tools/meraki/poll-wan-outages.js'], gates: [['teams_sla_enabled', '0']],
    dedup: 'sla_alert_log (request_id, kind)', cooldown: 'once per ticket and kind', missing: 'SDP SLA alerts and Meraki WAN outages (kept, D-06) exist; OpManager alarms are not read' },
  { id: 'A08', name: 'Source stale / row-count anomaly / failed delivery', status: 'partial', surfaces: ['services/sync/alerts.js', 'services/publishGate.js', 'services/sync/syncRunner.js'], gates: [['sync_alert_enabled', '1'], ['sync_alert_recipients', '']],
    dedup: 'after 2 failures, per job', cooldown: 'per job state', missing: 'stale sources lose their colour and block publication; report-delivery failure is logged, not alerted; export mismatch is not detected' },
  { id: 'A09', name: 'Benefit review date reached', status: 'missing', surfaces: [], gates: [], dedup: null, cooldown: null, missing: 'no benefit-review date in the portfolio model' },
  { id: 'A10', name: 'Funding review / stage gate / renewal date approaching', status: 'partial', surfaces: ['services/projectSchedule.js'], gates: [], dedup: null, cooldown: null, missing: 'stage gates enforced; no reminder' },
  { id: 'A11', name: 'Milestone / dependency / capacity blocked, late or unowned', status: 'partial', surfaces: ['services/projectSchedule.js', 'routes/governance.js'], gates: [], dedup: null, cooldown: null, missing: 'conflicts and dependency problems are shown; no escalation or Friday queue entry' },
  { id: 'A12', name: 'KPI policy / source mapping change → controlled recalculation', status: 'partial', surfaces: ['services/governancePolicy.js'], gates: [], dedup: null, cooldown: null, missing: 'policy history is hash-chained; no RFI and dual-run comparison' },
  { id: 'A13', name: 'Friday review preparation (exception-only agenda)', status: 'partial', surfaces: ['public/cockpit.html', 'routes/governance.js'], gates: [], dedup: null, cooldown: null, missing: 'agenda built on demand; not compiled on a schedule' },
  { id: 'A14', name: 'Report cutoff → draft, review, freeze, distribute, log receipt', status: 'partial', surfaces: ['routes/reportStudio.js', 'services/reportStore.js', 'services/engagementJobs.js'], gates: [['publish_cron_enabled', '0'], ['notifications_stop', '0']],
    dedup: 'report_runs per template and period', cooldown: null, missing: 'drafts, review, frozen publication exist; recipient receipt is not recorded' },
  { id: 'A15', name: 'Inactive stakeholder closure approval → reminder/escalation', status: 'missing', surfaces: [], gates: [], dedup: null, cooldown: null, missing: 'service window not decided' },
  { id: 'A16', name: 'Evidence retention / sensitive-link expiry → archive/revoke event', status: 'partial', surfaces: ['services/engagementStore.js', 'services/sync/jobs.js'], gates: [], dedup: null, cooldown: null, missing: 'links expire and are revocable with receipts; audit retention job runs; no archive event for evidence' },
];

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
  L.push('', '## Automation rules', '', '| Id | Rule | Status | Where | Switches (default) | Dedup | Cool-down | Open |', '|---|---|---|---|---|---|---|---|');
  for (const a of RULES) L.push(`| ${a.id} | ${a.name} | ${a.status} | ${a.surfaces.map((s) => '`' + s + '`').join('<br>') || '—'} | ${a.gates.map(([k, v]) => `\`${k}\`=${v === '' ? '(empty)' : v}`).join('<br>') || '—'} | ${a.dedup || '—'} | ${a.cooldown || '—'} | ${a.missing} |`);
  return L.join('\n') + '\n';
}

module.exports = { REPORTS, RULES, STATUSES, summary, toMarkdown };
