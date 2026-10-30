# Report and automation-rule catalogue (G16, generated)

Generated from `services/reportCatalogue.js` — do not edit by hand. Source of the requested items: the 2027 brief
(`docs/sdp360/2027/briefs/2026-10-21-MASTER-GOAL-2027.md`). A status says what the code has today; it never means a
report or rule is approved, configured in production or accepted by its audience. Every switch that lets something
leave the server ships off; the STOP switch `notifications_stop` halts every engagement outbound channel at once.

Reports: {"implemented":1,"partial":13,"missing":2} · Rules: {"implemented":1,"partial":12,"missing":3}

## Reports

| Id | Pri | Report | Audience | Cadence | Status | Where | Switches (default) | Open | Decision |
|---|---|---|---|---|---|---|---|---|---|
| R01 | P0 | Daily Site Action & Serious-Risk Exceptions | Site IT Lead; site GM limited summary | daily | partial | `public/site-actions.html`<br>`routes/commitments.js`<br>`services/engagementJobs.js` | `commitments_enabled`=0<br>`alert_external_enabled`=0 | no dedicated daily pack; the site hub and the commitment exceptions list hold the content, the daily digest carries in-app notifications only | D-13 |
| R02 | P0 | Friday IT Governance Pack | Group Operations IT / division leads | weekly | partial | `public/cockpit.html`<br>`routes/governance.js` | `alert_external_enabled`=0 | cockpit agenda exists; no PPTX pack and no Teams delivery of the pack | D-13 |
| R03 | P0 | Commitment & Business Verification Register | IT leadership and process owners | weekly | partial | `public/commitments.html`<br>`routes/commitments.js`<br>`services/commitmentLifecycle.js` | `commitments_enabled`=0 | register and verification workflow exist behind a flag; no scheduled Excel delivery | D-04 |
| R04 | P0 | Monthly Executive IT–Business Value Pack | CIO/VP IT, executive leadership, authorised site leaders | monthly | partial | `public/executive-report.html`<br>`public/report-studio.html`<br>`routes/reportStudio.js` | `publish_cron_enabled`=0 | deck builder and reviewed/released report runs exist; the five-dimension weights are not approved | D-01 |
| R05 | P1 | Department Business Partnering Report | Department head and Site IT Lead | monthly | partial | `public/meetings-compliance.html`<br>`reports-pptx-shared.js` | — | meeting cadence and the department-meetings slide exist; no per-department report addressed to the department head | D-13 |
| R06 | P1 | Inspections & Preventive Controls Assurance | Infrastructure, Security/GRC, site managers | weekly/monthly | partial | `public/inspections.html`<br>`public/inspection-actions.html`<br>`inspection-pptx.js` | — | repeat-finding trend is not computed; PDF is produced from the PPTX by the user; no verified-fix step: closing a corrective action is a status change, not an independent check | — |
| R07 | P1 | Business Incubation & Opportunity Funnel | PMO, business owners, CIO | monthly/quarterly | partial | `public/meeting.html`<br>`services/incubationForm.js` | — | incubation sessions are captured; no funnel (conversion, business case, decision) report | — |
| R08 | P1 | ServiceDesk Plus ITSM & SLA Reconciliation | Service owners and IT Operations | daily/weekly/monthly | partial | `public/index.html`<br>`services/metricRegistry.js`<br>`FORMULA_RECONCILIATION.md` | — | figures and reconciliation notes exist; KPI definitions are not certified by the KPI Committee | D-01 |
| R09 | P1 | OpManager Infrastructure & Network Service Health | Infrastructure / Enterprise Architecture / Site | weekly/monthly | partial | `routes/opmanager.js`<br>`public/wan-health.html` | — | OpManager availability and coverage routes exist; OpManager alarms are not read; no Teams delivery. wan-health reads Meraki (kept, D-06) and is listed for the WAN picture, not as OpManager coverage | — |
| R10 | P1 | IT Risk, Controls & Audit Action Pack | Security Lead, control owners, auditors | monthly/quarterly | partial | `risk-register-export.js`<br>`routes/governance.js` | — | risk register export and governance risks exist; no restricted audit pack | D-14 |
| R11 | P1 | Data Integration & Reporting Reliability | Platform admins / data engineer | daily and on failure | partial | `public/system-logs.html`<br>`services/sync/alerts.js`<br>`services/sync/jobs.js` | `sync_alert_enabled`=1<br>`sync_alert_recipients`=(empty) | sync health and failure alerts exist; alerts reach nobody until recipients or a Teams URL are set; report-delivery failures are logged, not alerted; export mismatch is not detected | — |
| R12 | P2 | ITSM Asset & Ownership Exceptions | IT asset / service owners | monthly | implemented | `public/assets.html`<br>`tools/reports/send-hygiene.js`<br>`services/assetHygieneReport.js` | `hygiene_send_enabled`=0<br>`hygiene_recipients`=(empty) | no money is shown by design; renewals only where the SDP fields exist | — |
| R13 | P1 | Native SDP360 Portfolio, Programme & Investment Review | CIO / PMO / Finance | monthly/quarterly | partial | `public/portfolio.html`<br>`routes/governance.js`<br>`services/portfolioEvidence.js` | — | portfolio view, plan, baseline, conflicts and money roll-up exist; no PPTX and no approved budget figures | D-02 |
| R14 | P2 | Quarterly Business Relationship & Stakeholder Pulse | Site GM, function heads, CIO | quarterly | missing | — | — | only the helpdesk CSAT survey exists; a business-pulse survey instrument is not defined | D-13 |
| R15 | P2 | Change/Incident Post-Implementation Value Review | Change/Incident manager and business sponsor | per major event | partial | `services/reportPayload.js` | — | major-incident RCA/CA/PIR/LL fields are read from SDP; no per-event review record or sign-off | — |
| R16 | P2 | Native SDP360 Portfolio Budget & Roadmap Planning | CIO / PMO / Finance | annual | missing | — | — | per-currency budget roll-up exists in the portfolio view; no annual planning pack | D-02 |

## Automation rules

| Id | Rule | Status | Where | Switches (default) | Dedup | Cool-down | Open |
|---|---|---|---|---|---|---|---|
| A01 | High/critical finding without owner/date or exception | partial | `services/escalationRouting.js`<br>`services/commitmentEscalation.js`<br>`services/commitmentStore.js` | `commitments_enabled`=0<br>`commitment_notify_enabled`=0 | commitment_escalations.key | one episode per key until cleared | escalation recorded; outbound notice armed off; only a missing accountable owner raises A01 (a missing due date does not); commitments only, not inspection findings; hourly job, in-app only |
| A02 | High/critical remedy due date breached | implemented | `services/commitmentEscalation.js`<br>`services/commitmentStore.js` | `commitments_enabled`=0<br>`commitment_notify_enabled`=0 | commitment_escalations.key | one episode per key until cleared | escalation recorded; outbound notice armed off |
| A03 | Commitment technically completed → independent reviewer sign-off | partial | `services/commitmentLifecycle.js` | `commitments_enabled`=0 | — | — | self-verification refused; the reviewer is not notified |
| A04 | Verification rejected → reopen with reason | partial | `services/commitmentLifecycle.js` | `commitments_enabled`=0 | — | — | reopen requires a reason and keeps history; owner is not notified |
| A05 | Meeting / incubation / inspection approaching its schedule | missing | — | — | — | — | site calendar exists; no reminder job |
| A06 | Recorded activity not submitted by deadline | partial | `services/weeklyReportData.js` | `weekly_report_send_enabled`=0 | — | — | "complete but not submitted" is shown in the weekly e-mail; no exception record |
| A07 | Critical monitored service/link outage or recurring incident pattern | partial | `tools/teams/poll-sla.js`<br>`tools/meraki/poll-wan-outages.js` | `teams_sla_enabled`=0 | sla_alert_log (request_id, kind) | once per ticket and kind | SDP SLA alerts and Meraki WAN outages (kept, D-06) exist; OpManager alarms are not read |
| A08 | Source stale / row-count anomaly / failed delivery | partial | `services/sync/alerts.js`<br>`services/publishGate.js`<br>`services/sync/syncRunner.js` | `sync_alert_enabled`=1<br>`sync_alert_recipients`=(empty) | after 2 failures, per job | per job state | stale sources lose their colour and block publication; report-delivery failure is logged, not alerted; export mismatch is not detected |
| A09 | Benefit review date reached | missing | — | — | — | — | no benefit-review date in the portfolio model |
| A10 | Funding review / stage gate / renewal date approaching | partial | `services/projectSchedule.js` | — | — | — | stage gates enforced; no reminder |
| A11 | Milestone / dependency / capacity blocked, late or unowned | partial | `services/projectSchedule.js`<br>`routes/governance.js` | — | — | — | conflicts and dependency problems are shown; no escalation or Friday queue entry |
| A12 | KPI policy / source mapping change → controlled recalculation | partial | `services/governancePolicy.js` | — | — | — | policy history is hash-chained; no RFI and dual-run comparison |
| A13 | Friday review preparation (exception-only agenda) | partial | `public/cockpit.html`<br>`routes/governance.js` | — | — | — | agenda built on demand; not compiled on a schedule |
| A14 | Report cutoff → draft, review, freeze, distribute, log receipt | partial | `routes/reportStudio.js`<br>`services/reportStore.js`<br>`services/engagementJobs.js` | `publish_cron_enabled`=0<br>`notifications_stop`=0 | report_runs per template and period | — | drafts, review, frozen publication exist; recipient receipt is not recorded |
| A15 | Inactive stakeholder closure approval → reminder/escalation | missing | — | — | — | — | service window not decided |
| A16 | Evidence retention / sensitive-link expiry → archive/revoke event | partial | `services/engagementStore.js`<br>`services/sync/jobs.js` | — | — | — | links expire and are revocable with receipts; audit retention job runs; no archive event for evidence |
