# Persona → journey map (C-25 / G02)

Status: **map only**. It links each persona's main journeys to the pages that serve them and to the browser
journey test (`tests/e2e/*.spec.js`) that covers them, if any. No usability session has been run; a journey
marked covered means an automated Playwright run exercises it on a throwaway database (evidence level
**code+test**), never that real users accepted it. Sessions with people follow
`docs/ops/USABILITY-TEST-PROTOCOL.md`.

Landing page per role: `public/lib/landing.js` (switch `ui_role_landing`, default `'0'` = today's mapping).
Every page and test named here is checked to exist by `tests/persona-journeys.test.js`, and every e2e journey
in `tests/e2e/` must appear in this table.

## Journeys

| Persona | Account role | Journey (question → action) | Start page | Action page | Browser journey test |
|---|---|---|---|---|---|
| Site IT coordinator | `editor` + `tracker-editor`, own site | Open last week's report, check helpdesk figures, submit it | `public/reports.html` | `public/reports.html` | `tests/e2e/t2-weekly-report.spec.js` |
| Site IT coordinator | `editor` + `tracker-editor`, own site | Enter this month's activity tracker values (stored for her own site) | `public/activity-tracker.html` | `public/activity-tracker.html` | `tests/e2e/c1-coordinator-tracker-pv.spec.js` (E-Q09) |
| Site IT coordinator | `editor`, own site | Write and sign a department PV (both stamps persisted with the SERVER clock) | `public/meetings.html` | `public/meeting.html` | `tests/e2e/c1-coordinator-tracker-pv.spec.js` (E-Q09) |
| Site editor | `editor`, own site | Find the site's overdue actions, close one with a justification | `public/site-actions.html` | `public/site-actions.html` | `tests/e2e/t1-site-action.spec.js` |
| Site editor | `editor`, own site | See all of my open work in one queue on Home (switches `ui_home_queue` / `ui_nav_*` on in a throwaway database), 320 px and French, never another site's item | `public/home.html` | `public/home.html` | `tests/e2e/r2-home-queue.spec.js` (R2-QUEUE) |
| Site editor | `editor`, own site | Cannot read another site's report or portfolio project (deny) | `public/reports.html` | `public/portfolio.html` | `tests/e2e/deny-cross-site.spec.js` |
| Site editor | `editor`, own site | Switch the interface to French and open the manual | `public/site-actions.html` | `public/help.html` | `tests/e2e/t7-french-help.spec.js` |
| Site editor | `editor`, own site | Reach Portfolio using only the keyboard | `public/login.html` | `public/portfolio.html` | `tests/e2e/t8-keyboard-portfolio.spec.js` |
| Field technician | `field-tech`, own site | Record a quick inspection with a photo offline, then sync | `public/field/index.html` | `public/inspection.html` | `tests/e2e/t3-field-inspection.spec.js` |
| Field technician | `field-tech` + a site `editor` on the same phone, own site | Sync the queue on a bad network without losing anything: 800 ms latency + offline/online flaps, captive-portal HTML page, session expiry mid-photo, 409 in progress, a chunk lost mid-upload, another person signed in, storage full + reload (E-F02 — SIMULATED network, not a real VSAT link; field sign-off = E-F04) | `public/field/index.html` | `public/field/index.html` | `tests/e2e/f1-field-network.spec.js` |
| Admin (Group IT) | `admin` | See the helpdesk backlog and SLA across sites | `public/index.html` | `public/index.html` | `tests/e2e/u3-admin-helpdesk-infra.spec.js` |
| Admin (Group IT) | `admin` | Check infrastructure and WAN health of a site | `public/infra-health.html` | `public/wan.html` | `tests/e2e/u3-admin-helpdesk-infra.spec.js` |
| Executive | `executive` | Tell which site is worst this week and why (Helpdesk resolution-SLA ranking, worst first, with the missed count; then a published dashboard) | `public/executive.html` | `public/index.html` | `tests/e2e/u4-executive-worst-site.spec.js` |
| Executive | `executive` | Read the IT Review scoreboard and open the scorecard (an editor is refused the review data) | `public/it-review.html` | `public/executive.html` | `tests/e2e/u2-executive-review.spec.js` |
| Multi-site coordinator (two countries) | `editor`, primary + extra site | See only their own sites' reports, then work in French | `public/reports.html` | `public/reports.html` | `tests/e2e/u1-multisite-french.spec.js` |
| super_admin | `super_admin` | Change a delivery setting | `public/reports.html` | `public/reports.html` | not covered |
| super_admin | `super_admin` | Remove a user's role: the user's next request is refused (E-Q09) | `public/system-logs.html` | `public/system-logs.html` | `tests/e2e/c5-superadmin-role-removal-log.spec.js` |
| super_admin | `super_admin` | Read the security journal and export it (the role change is in the CSV) | `public/system-logs.html` | `public/system-logs.html` | `tests/e2e/c5-superadmin-role-removal-log.spec.js` (E-Q09) |
| Admin (Group IT) | `admin` | From the worst-gap ranking (Helpdesk resolution SLA) to that site's overdue action, update it, see it in the register (E-Q09; finding: the ranking has no link to the register) | `public/index.html` | `public/site-actions.html` | `tests/e2e/c2-groupit-worst-gap-action.spec.js` |
| Finance reader | `finance-viewer` | Read an asset amount that is "Non certifié" and a site with no currency (UNKNOWN "—", never $0) (E-Q09) | `public/assets.html` | `public/assets.html` | `tests/e2e/c3-finance-not-certified.spec.js` |
| PMO (committee) | `viewer` + `committee-member` | Demand (RFI) → triage → project → benefit realised → verified by another member (E-Q09; capacity conflict NOT built — asserted absent) | `public/portfolio.html` | `public/project.html` | `tests/e2e/c4-pmo-demand-project-benefit.spec.js` |
| PMO (committee) | `viewer` + `committee-member`; site B `editor` | R6 synthetic two-site demonstration: Home → portfolio → project plan (zero vs unknown) → workbook export with the screen's figures → History ledger; site B editor denied site A's project once the read scope is on (SYNTHETIC data, `docs/ops/DEMO-SCENARIO.md`) | `public/home.html` | `public/project.html` | `tests/e2e/demo-journey.spec.js` |
| super_admin | `super_admin` | Key pages at 1440/1024/768/390 px: no horizontal scroll, header visible, no console error (layout check, not a task) | `public/index.html` | `public/access.html` | `tests/e2e/v1-viewport-layout.spec.js` |
| super_admin | `super_admin` | Change a filter twice quickly on Dashboards and Analytics; the newer figures stay on screen | `public/dashboards.html` | `public/analytics.html` | `tests/e2e/r1-filter-race.spec.js` |
| super_admin | `super_admin` | Download the dashboard CSV, the assets inventory and the WAN SLA workbook | `public/dashboards.html` | `public/wan.html` | `tests/e2e/x1-exports.spec.js` |
| Site IT coordinator | `viewer` → `tracker-editor` (requested), own site | Ask for an access, see it approved by the site admin, use it, see it end when its date passes (C-23) | `public/access.html` | `public/access.html` | `tests/e2e/i1-access-request-approval.spec.js` |
| Admin (site) | `admin`, own site | Decide access requests: never one I filed, never as the requester's deputy (separation of duties, C-23) | `public/access.html` | `public/access.html` | `tests/e2e/i2-access-sod.spec.js` |
| Site IT coordinator | `viewer` + approved grant, signs in with Microsoft | A Microsoft sign-in adds the group roles and keeps the approved grant (C-23) | `public/login.html` | `public/access.html` | `tests/e2e/i3-sso-grant-merge.spec.js` |
| Field technician | `field-tech`, own site; recorder + verifier `admin` | Field capture refused until site-induction evidence is recorded and verified by a third person; refused again once expired (C-23) | `public/access.html` | `public/access.html` | `tests/e2e/i4-qualification-gate.spec.js` |
| super_admin | `super_admin` (granter) + a second `super_admin` (reviewer) | Grant an emergency access of at most 24 h, see its review flagged overdue, have it reviewed by someone else, see it end (C-23) | `public/access.html` | `public/access.html` | `tests/e2e/i5-emergency-access.spec.js` |
| Site IT coordinator | `editor`, own site (outgoing / incoming technician) | Hand the shift over; it stays pending until the incoming person accepts it (C-23) | `public/coverage.html` | `public/coverage.html` | `tests/e2e/i6-shift-handover.spec.js` |
| super_admin | `super_admin` | Rotate a stored integration key: the old one stops working, no secret comes back to the browser or the journal; anonymous visitors never get the API key (C-23) | `public/reports.html` | `public/reports.html` | `tests/e2e/i7-secret-rotation.spec.js` |
| Scorecard viewer | `scorecard-viewer` | Read the executive scorecard without write powers | `public/executive.html` | `public/analytics.html` | `tests/e2e/u5-scorecard-viewer.spec.js` |
| Super admin | `super_admin` | Share an Analytics view by its URL: the colleague opens the same filters (site, period, status, type), Back restores, Reset clears | `public/home.html` | `public/analytics.html` | `tests/e2e/u6-shared-analytics-url.spec.js` |
| Site editor | `editor` (own site) | Leave a human note on a dashboard trend so readers see why a point moved (switch `chart_annotations_enabled`) | `public/home.html` | `public/dashboards.html` | `tests/e2e/u7-chart-annotations.spec.js` |
| Committee member (Group IT, extra) | `viewer` + `committee-member` | Prepare Friday's agenda from the cadence | `public/cockpit.html` | `public/cockpit.html` | `tests/e2e/t4-cockpit-agenda.spec.js` |
| Site IT coordinator (UAT-F seat 1, simulation) | `editor`, one site | Daily work in pass A (defaults) and pass B (plan F pilot profile): Home queue, weekly report, action register, PV, inspections, French at 320 px, My work, workspace settings | `public/home.html` | `public/site-actions.html` | `tests/e2e/uat-s1-site-coordinator.spec.js` |
| Two-site coordinator (UAT-F seat 2, simulation) | `editor`, two sites | Reports of both sites never a third, PV on the second site, queue of both sites, site carried in the menu, default site among own sites | `public/home.html` | `public/reports.html` | `tests/e2e/uat-s2-multisite-coordinator.spec.js` |
| Group IT / PMO (UAT-F seat 3, simulation) | `viewer` + `committee-member` | Portfolio list/board, project plan, team, time entries, change request approved by another member, decision as chair, department roll-up, workbook export | `public/portfolio.html` | `public/project.html` | `tests/e2e/uat-s3-pmo.spec.js` |
| Finance reader (UAT-F seat 4, simulation) | `finance-viewer` | Project budget visible (hidden from a viewer), asset amounts not certified, benefit value class, amount without currency, no write, budget-period sheet | `public/portfolio.html` | `public/assets.html` | `tests/e2e/uat-s4-finance.spec.js` |
| Executive (UAT-F seat 5, simulation) | `executive` | IT Review, scorecard charts standard, dashboards with the KPI definition drawer, portfolio and fleet reading, 390 px | `public/it-review.html` | `public/dashboards.html` | `tests/e2e/uat-s5-executive.spec.js` |
| Field technician (UAT-F seat 6, simulation, SIMULATED network) | `field-tech`, one site | Field app at 390 px in French, offline capture then sync, no report/PV write, Home at 390 px, field profile | `public/field/index.html` | `public/field/index.html` | `tests/e2e/uat-s6-field-technician.spec.js` |
| Super admin / IT operations (UAT-F seat 7, simulation) | `super_admin` | Admin console, security journal, source freshness, users and redacted config, controlled roadmap publication, department crosswalk, workspace settings, admin at 320 px | `public/reports.html` | `public/workspace-settings.html` | `tests/e2e/uat-s7-super-admin.spec.js` |
| Site business user (UAT-F seat 8, simulation) | `site-business`, one site | Site IT status, neighbour site refused, no write and no internal list, internal queue never queried, French at 320 px, business profile | `public/site-awareness.html` | `public/site-awareness.html` | `tests/e2e/uat-s8-site-business.spec.js` |

## Coverage summary

- **UAT-F (plan F wave 3, 2026-11-12 — AI-SIMULATED committee of 8 seats on a synthetic organisation, NOT user acceptance)**
  added the eight `uat-s*` seat journeys, each run twice (shipped defaults, then the plan F pilot profile); results and
  verdicts in `docs/audits/2026-11-12-enterprise-review/UAT-COMITE-UTILISATEURS.md`.

- Covered by a browser journey test: coordinator (1 of 3 reporting journeys, plus the C-23 access / SSO /
  shift-handover journeys), site editor (4 of 4), field technician (2 of 2), committee member (1 of 1), site
  admin (access decisions); super_admin: three cross-cutting checks (viewport layout, filter race, exports) and
  the C-23 emergency-access and secret-rotation journeys, not the two task journeys above.
- (before the AMDEC campaign) **Not covered by any browser journey test**: admin, executive, super_admin and scorecard-viewer journeys, two of
  the three coordinator journeys. These are the gaps a person should plan sessions or new e2e journeys for.
- Covered by a browser journey test: coordinator (1 of 3), site editor (4 of 4), field technician (1 of 1),
  committee member (1 of 1); super_admin: three cross-cutting checks (viewport layout, filter race, exports),
  not the two task journeys above.
- AMDEC campaign 2026-11-05 (agent-run, not user acceptance) added: executive IT Review + scorecard (U2) and the
  multi-site coordinator in French (U1); follow-up D-10 added the admin helpdesk + infrastructure/WAN journey (U3),
  the executive "worst site" journey (U4) and the scorecard-viewer read-only journey (U5), on fictitious tickets.
- **E-Q09 (agent committee, 2026-11-06 — automated on a synthetic organisation, NOT user acceptance)** added C1 (tracker
  entry + PV signature, server-time stamp), C2 (Group IT worst gap → site overdue action), C3 (Finance "Non certifié" /
  no-currency UNKNOWN), C4 (PMO demand → project → benefit verification; capacity conflict recorded as not built) and C5
  (super_admin role removal → next request refused → security-log CSV). Still not covered: the super_admin delivery-setting
  journey and a capacity-conflict journey (the capacity feature does not exist).
- **Still not covered after D-10** (superseded by the E-Q09 line above): the two super_admin task journeys (settings / role change, security journal)
  and two of the three single-site coordinator journeys (tracker entry, PV write and sign).
- (after the AMDEC campaign, before D-10) **Not covered by any browser journey test**: admin, the executive "worst site" journey, super_admin and
  scorecard-viewer journeys, two of the three single-site coordinator journeys. These are the gaps a person should plan sessions or new e2e journeys for.
- Personas from the committee report not mapped here because they have no separate account role today: analyst,
  business GM/FM (`site-business` lands on `public/site-awareness.html`). (PMO is now mapped through the committee role, C4.)
