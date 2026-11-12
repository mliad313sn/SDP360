# Persona × task × screen matrix (F-UX-07)

**Generated** by `node tools/agent/persona-matrix.js` — do not edit by hand (`--check` fails when stale).
Sources: vision pack v2.0 §3.2 (seven personas), `public/_shell.js` WORKSPACES (head), `docs/ops/PERSONA-JOURNEYS.md`,
`docs/ops/USABILITY-TEST-PROTOCOL.md`. The persona → workspace column is a **proposal** for decision D2; the review.1 build's
11 presentation profiles are **NEEDS-REVIEW.1-ARTIFACT** (not in this repository). Nothing here is a usability result.

## 1. Vision personas and the head workspaces

| Vision persona | Primary question (vision §3.2) | Head workspace (proposal) | Workspace pages | review.1 profile | Journeys mapped |
|---|---|---|---|---|---|
| Executive / Group Management | Where are the critical exceptions, decisions, cross-site gaps and strategic risks? | Executive (`executive`) | `dashboards.html?key=exec-home`, `it-review.html`, `executive.html`, `portfolio.html`, `cockpit.html` | NEEDS-REVIEW.1-ARTIFACT | 10 |
| Site Management / Business Lead | What is the site posture, business impact and management action required? | Site business view (`business`) | `site-awareness.html` | NEEDS-REVIEW.1-ARTIFACT | 0 |
| Site IT Lead | What is failing, at risk, overdue or awaiting evidence at my site? | Site IT (`site-it`), Technician (`technician`) | `home.html`, `site-actions.html`, `inspections.html`, `meetings.html`, `reports.html`, `activity-tracker.html`, `obligations.html`, `field/index.html` | NEEDS-REVIEW.1-ARTIFACT | 19 |
| Department Member | What is assigned to my department and what do I need to update or submit? | **none at head — gap** | — | NEEDS-REVIEW.1-ARTIFACT | 0 |
| Validator | What requires my decision, by when, with what evidence and conflict check? | **none at head — gap** | — | NEEDS-REVIEW.1-ARTIFACT | 0 |
| Administrator | What configuration, mapping, access, connector or quality issue requires control? | Group IT (`super`), Group IT (`admin`) | `index.html`, `site-actions.html`, `cockpit.html`, `dashboards.html`, `report-studio.html`, `integrations.html`, `system-logs.html` | NEEDS-REVIEW.1-ARTIFACT | 12 |
| Guest / Invited User | What approved and sanitized information may I see? | **none at head — gap** | — | NEEDS-REVIEW.1-ARTIFACT | 0 |

## 2. Journeys (persona → start → expected first click → test)

Expected first click = the action page when it differs from the start page (a **candidate**, decision D4 confirms it in
`docs/ops/pilot/FIRST-CLICK-SHEET.csv`); "in-page control" = the task is done on the start page.

| Vision persona | Journey persona | Journey | Start page | Candidate first click | Browser test |
|---|---|---|---|---|---|
| Site IT Lead | Site IT coordinator | Open last week's report, check helpdesk figures, submit it | `public/reports.html` | in-page control | `tests/e2e/t2-weekly-report.spec.js` |
| Site IT Lead | Site IT coordinator | Enter this month's activity tracker values (stored for her own site) | `public/activity-tracker.html` | in-page control | `tests/e2e/c1-coordinator-tracker-pv.spec.js` (E-Q09) |
| Site IT Lead | Site IT coordinator | Write and sign a department PV (both stamps persisted with the SERVER clock) | `public/meetings.html` | `public/meeting.html` | `tests/e2e/c1-coordinator-tracker-pv.spec.js` (E-Q09) |
| Site IT Lead | Site editor | Find the site's overdue actions, close one with a justification | `public/site-actions.html` | in-page control | `tests/e2e/t1-site-action.spec.js` |
| Site IT Lead | Site editor | See all of my open work in one queue on Home (switches `ui_home_queue` / `ui_nav_*` on in a throwaway database), 320 px and French, never another site's item | `public/home.html` | in-page control | `tests/e2e/r2-home-queue.spec.js` (R2-QUEUE) |
| Site IT Lead | Site editor | Cannot read another site's report or portfolio project (deny) | `public/reports.html` | `public/portfolio.html` | `tests/e2e/deny-cross-site.spec.js` |
| Site IT Lead | Site editor | Switch the interface to French and open the manual | `public/site-actions.html` | `public/help.html` | `tests/e2e/t7-french-help.spec.js` |
| Site IT Lead | Site editor | Reach Portfolio using only the keyboard | `public/login.html` | `public/portfolio.html` | `tests/e2e/t8-keyboard-portfolio.spec.js` |
| Site IT Lead | Field technician | Record a quick inspection with a photo offline, then sync | `public/field/index.html` | `public/inspection.html` | `tests/e2e/t3-field-inspection.spec.js` |
| Site IT Lead | Field technician | Sync the queue on a bad network without losing anything: 800 ms latency + offline/online flaps, captive-portal HTML page, session expiry mid-photo, 409 in progress, a chunk lost mid-upload, another person signed in, storage full + reload (E-F02 — SIMULATED network, not a real VSAT link; field sign-off = E-F04) | `public/field/index.html` | in-page control | `tests/e2e/f1-field-network.spec.js` |
| Administrator | Admin (Group IT) | See the helpdesk backlog and SLA across sites | `public/index.html` | in-page control | `tests/e2e/u3-admin-helpdesk-infra.spec.js` |
| Administrator | Admin (Group IT) | Check infrastructure and WAN health of a site | `public/infra-health.html` | `public/wan.html` | `tests/e2e/u3-admin-helpdesk-infra.spec.js` |
| Executive / Group Management | Executive | Tell which site is worst this week and why (Helpdesk resolution-SLA ranking, worst first, with the missed count; then a published dashboard) | `public/executive.html` | `public/index.html` | `tests/e2e/u4-executive-worst-site.spec.js` |
| Executive / Group Management | Executive | Read the IT Review scoreboard and open the scorecard (an editor is refused the review data) | `public/it-review.html` | `public/executive.html` | `tests/e2e/u2-executive-review.spec.js` |
| Site IT Lead | Multi-site coordinator (two countries) | See only their own sites' reports, then work in French | `public/reports.html` | in-page control | `tests/e2e/u1-multisite-french.spec.js` |
| Administrator | super_admin | Change a delivery setting | `public/reports.html` | in-page control | not covered |
| Administrator | super_admin | Remove a user's role: the user's next request is refused (E-Q09) | `public/system-logs.html` | in-page control | `tests/e2e/c5-superadmin-role-removal-log.spec.js` |
| Administrator | super_admin | Read the security journal and export it (the role change is in the CSV) | `public/system-logs.html` | in-page control | `tests/e2e/c5-superadmin-role-removal-log.spec.js` (E-Q09) |
| Administrator | Admin (Group IT) | From the worst-gap ranking (Helpdesk resolution SLA) to that site's overdue action, update it, see it in the register (E-Q09; finding: the ranking has no link to the register) | `public/index.html` | `public/site-actions.html` | `tests/e2e/c2-groupit-worst-gap-action.spec.js` |
| Executive / Group Management | Finance reader | Read an asset amount that is "Non certifié" and a site with no currency (UNKNOWN "—", never $0) (E-Q09) | `public/assets.html` | in-page control | `tests/e2e/c3-finance-not-certified.spec.js` |
| Executive / Group Management | PMO (committee) | Demand (RFI) → triage → project → benefit realised → verified by another member (E-Q09; capacity conflict NOT built — asserted absent) | `public/portfolio.html` | `public/project.html` | `tests/e2e/c4-pmo-demand-project-benefit.spec.js` |
| Executive / Group Management | PMO (committee) | R6 synthetic two-site demonstration: Home → portfolio → project plan (zero vs unknown) → workbook export with the screen's figures → History ledger; site B editor denied site A's project once the read scope is on (SYNTHETIC data, `docs/ops/DEMO-SCENARIO.md`) | `public/home.html` | `public/project.html` | `tests/e2e/demo-journey.spec.js` |
| Administrator | super_admin | Key pages at 1440/1024/768/390 px: no horizontal scroll, header visible, no console error (layout check, not a task) | `public/index.html` | `public/access.html` | `tests/e2e/v1-viewport-layout.spec.js` |
| Administrator | super_admin | Change a filter twice quickly on Dashboards and Analytics; the newer figures stay on screen | `public/dashboards.html` | `public/analytics.html` | `tests/e2e/r1-filter-race.spec.js` |
| Administrator | super_admin | Download the dashboard CSV, the assets inventory and the WAN SLA workbook | `public/dashboards.html` | `public/wan.html` | `tests/e2e/x1-exports.spec.js` |
| Site IT Lead | Site IT coordinator | Ask for an access, see it approved by the site admin, use it, see it end when its date passes (C-23) | `public/access.html` | in-page control | `tests/e2e/i1-access-request-approval.spec.js` |
| Administrator | Admin (site) | Decide access requests: never one I filed, never as the requester's deputy (separation of duties, C-23) | `public/access.html` | in-page control | `tests/e2e/i2-access-sod.spec.js` |
| Site IT Lead | Site IT coordinator | A Microsoft sign-in adds the group roles and keeps the approved grant (C-23) | `public/login.html` | `public/access.html` | `tests/e2e/i3-sso-grant-merge.spec.js` |
| Site IT Lead | Field technician | Field capture refused until site-induction evidence is recorded and verified by a third person; refused again once expired (C-23) | `public/access.html` | in-page control | `tests/e2e/i4-qualification-gate.spec.js` |
| Administrator | super_admin | Grant an emergency access of at most 24 h, see its review flagged overdue, have it reviewed by someone else, see it end (C-23) | `public/access.html` | in-page control | `tests/e2e/i5-emergency-access.spec.js` |
| Site IT Lead | Site IT coordinator | Hand the shift over; it stays pending until the incoming person accepts it (C-23) | `public/coverage.html` | in-page control | `tests/e2e/i6-shift-handover.spec.js` |
| Administrator | super_admin | Rotate a stored integration key: the old one stops working, no secret comes back to the browser or the journal; anonymous visitors never get the API key (C-23) | `public/reports.html` | in-page control | `tests/e2e/i7-secret-rotation.spec.js` |
| Executive / Group Management | Scorecard viewer | Read the executive scorecard without write powers | `public/executive.html` | `public/analytics.html` | `tests/e2e/u5-scorecard-viewer.spec.js` |
| — | Super admin | Share an Analytics view by its URL: the colleague opens the same filters (site, period, status, type), Back restores, Reset clears | `public/home.html` | `public/analytics.html` | `tests/e2e/u6-shared-analytics-url.spec.js` |
| Site IT Lead | Site editor | Leave a human note on a dashboard trend so readers see why a point moved (switch `chart_annotations_enabled`) | `public/home.html` | `public/dashboards.html` | `tests/e2e/u7-chart-annotations.spec.js` |
| Executive / Group Management | Committee member (Group IT, extra) | Prepare Friday's agenda from the cadence | `public/cockpit.html` | in-page control | `tests/e2e/t4-cockpit-agenda.spec.js` |
| Site IT Lead | Site IT coordinator (UAT-F seat 1, simulation) | Daily work in pass A (defaults) and pass B (plan F pilot profile): Home queue, weekly report, action register, PV, inspections, French at 320 px, My work, workspace settings | `public/home.html` | `public/site-actions.html` | `tests/e2e/uat-s1-site-coordinator.spec.js` |
| Site IT Lead | Two-site coordinator (UAT-F seat 2, simulation) | Reports of both sites never a third, PV on the second site, queue of both sites, site carried in the menu, default site among own sites | `public/home.html` | `public/reports.html` | `tests/e2e/uat-s2-multisite-coordinator.spec.js` |
| Executive / Group Management | Group IT / PMO (UAT-F seat 3, simulation) | Portfolio list/board, project plan, team, time entries, change request approved by another member, decision as chair, department roll-up, workbook export | `public/portfolio.html` | `public/project.html` | `tests/e2e/uat-s3-pmo.spec.js` |
| Executive / Group Management | Finance reader (UAT-F seat 4, simulation) | Project budget visible (hidden from a viewer), asset amounts not certified, benefit value class, amount without currency, no write, budget-period sheet | `public/portfolio.html` | `public/assets.html` | `tests/e2e/uat-s4-finance.spec.js` |
| Executive / Group Management | Executive (UAT-F seat 5, simulation) | IT Review, scorecard charts standard, dashboards with the KPI definition drawer, portfolio and fleet reading, 390 px | `public/it-review.html` | `public/dashboards.html` | `tests/e2e/uat-s5-executive.spec.js` |
| Site IT Lead | Field technician (UAT-F seat 6, simulation, SIMULATED network) | Field app at 390 px in French, offline capture then sync, no report/PV write, Home at 390 px, field profile | `public/field/index.html` | in-page control | `tests/e2e/uat-s6-field-technician.spec.js` |
| — | Super admin / IT operations (UAT-F seat 7, simulation) | Admin console, security journal, source freshness, users and redacted config, controlled roadmap publication, department crosswalk, workspace settings, admin at 320 px | `public/reports.html` | `public/workspace-settings.html` | `tests/e2e/uat-s7-super-admin.spec.js` |
| — | Site business user (UAT-F seat 8, simulation) | Site IT status, neighbour site refused, no write and no internal list, internal queue never queried, French at 320 px, business profile | `public/site-awareness.html` | in-page control | `tests/e2e/uat-s8-site-business.spec.js` |

## 3. Usability tasks (protocol)

| Task | Wording | Persona |
|---|---|---|
| T1 | Find the overdue actions of your site and close one with a justification | Site IT |
| T2 | Open last week's report, check the helpdesk figures, submit it | Site IT |
| T3 | On the phone, record a quick inspection with one photo while offline, then sync (real-device network / storage / user-switch scenarios: [`pilot/FIELD-DEVICE-UAT.md`](pilot/FIELD-DEVICE-UAT.md), sheet `pilot/FIELD-DEVICE-SHEET.csv`) | Technician |
| T4 | Find the Meeting Cockpit and prepare Friday's agenda | Group IT |
| T5 | Tell which site is worst this month and why, from the executive home | Executive |
| T6 | Find the projects whose plan slipped versus baseline | Committee |
| T7 | Change the interface to French and open the manual | any |
| T8 | Using only the keyboard, reach "Portfolio" from any page | any |
| T9 | Find the worst site this month on the dashboard you normally use, and say on which figure | see protocol |
| T10 | Explain why one figure changed versus last period: what moved, by how much, from which data | see protocol |
| T11 | From a figure that is off target, find the action (or the page) that handles it | see protocol |
| T12 | Compare two sites named by the facilitator on one figure: which is better, by how much | see protocol |

## 4. Gaps for decision (not decided here)

- **Department Member**: no workspace, no inbox and no journey at head.
- **Validator**: no workspace, no inbox and no journey at head.
- **Guest / Invited User**: no workspace, no inbox and no journey at head.
