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
| Site IT coordinator | `editor` + `tracker-editor`, own site | Enter this month's activity tracker values | `public/activity-tracker.html` | `public/activity-tracker.html` | not covered |
| Site IT coordinator | `editor`, own site | Write and sign a department PV | `public/meetings.html` | `public/meeting.html` | not covered |
| Site editor | `editor`, own site | Find the site's overdue actions, close one with a justification | `public/site-actions.html` | `public/site-actions.html` | `tests/e2e/t1-site-action.spec.js` |
| Site editor | `editor`, own site | Cannot read another site's report or portfolio project (deny) | `public/reports.html` | `public/portfolio.html` | `tests/e2e/deny-cross-site.spec.js` |
| Site editor | `editor`, own site | Switch the interface to French and open the manual | `public/site-actions.html` | `public/help.html` | `tests/e2e/t7-french-help.spec.js` |
| Site editor | `editor`, own site | Reach Portfolio using only the keyboard | `public/login.html` | `public/portfolio.html` | `tests/e2e/t8-keyboard-portfolio.spec.js` |
| Field technician | `field-tech`, own site | Record a quick inspection with a photo offline, then sync | `public/field/index.html` | `public/inspection.html` | `tests/e2e/t3-field-inspection.spec.js` |
| Admin (Group IT) | `admin` | See the helpdesk backlog and SLA across sites | `public/index.html` | `public/index.html` | not covered |
| Admin (Group IT) | `admin` | Check infrastructure and WAN health of a site | `public/infra-health.html` | `public/wan.html` | not covered |
| Executive | `executive` | Tell which site is worst this month and why | `public/executive.html` | `public/dashboards.html` | not covered |
| Executive | `executive` | Read the IT Review scoreboard and open the scorecard (an editor is refused the review data) | `public/it-review.html` | `public/executive.html` | `tests/e2e/u2-executive-review.spec.js` |
| Multi-site coordinator (two countries) | `editor`, primary + extra site | See only their own sites' reports, then work in French | `public/reports.html` | `public/reports.html` | `tests/e2e/u1-multisite-french.spec.js` |
| super_admin | `super_admin` | Change a delivery setting or a user's role | `public/reports.html` | `public/access.html` | not covered |
| super_admin | `super_admin` | Read the security journal | `public/system-logs.html` | `public/system-logs.html` | not covered |
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
| Scorecard viewer | `scorecard-viewer` | Read the executive scorecard without write powers | `public/executive.html` | `public/analytics.html` | not covered |
| Committee member (Group IT, extra) | `viewer` + `committee-member` | Prepare Friday's agenda from the cadence | `public/cockpit.html` | `public/cockpit.html` | `tests/e2e/t4-cockpit-agenda.spec.js` |

## Coverage summary

- Covered by a browser journey test: coordinator (1 of 3 reporting journeys, plus the C-23 access / SSO /
  shift-handover journeys), site editor (4 of 4), field technician (2 of 2), committee member (1 of 1), site
  admin (access decisions); super_admin: three cross-cutting checks (viewport layout, filter race, exports) and
  the C-23 emergency-access and secret-rotation journeys, not the two task journeys above.
- **Not covered by any browser journey test**: admin, executive, super_admin and scorecard-viewer journeys, two of
  the three coordinator journeys. These are the gaps a person should plan sessions or new e2e journeys for.
- Covered by a browser journey test: coordinator (1 of 3), site editor (4 of 4), field technician (1 of 1),
  committee member (1 of 1); super_admin: three cross-cutting checks (viewport layout, filter race, exports),
  not the two task journeys above.
- AMDEC campaign 2026-11-05 (agent-run, not user acceptance) added: executive IT Review + scorecard (U2) and the
  multi-site coordinator in French (U1).
- **Not covered by any browser journey test**: admin, the executive "worst site" journey, super_admin and
  scorecard-viewer journeys, two of the three single-site coordinator journeys. These are the gaps a person should plan sessions or new e2e journeys for.
- Personas from the committee report not mapped here because they have no separate account role today: analyst,
  business GM/FM (`site-business` lands on `public/site-awareness.html`), PMO.
