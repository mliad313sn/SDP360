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
| Executive | `executive` | Read the IT Review scoreboard | `public/it-review.html` | `public/it-review.html` | not covered |
| super_admin | `super_admin` | Change a delivery setting or a user's role | `public/reports.html` | `public/access.html` | not covered |
| super_admin | `super_admin` | Read the security journal | `public/system-logs.html` | `public/system-logs.html` | not covered |
| Scorecard viewer | `scorecard-viewer` | Read the executive scorecard without write powers | `public/executive.html` | `public/analytics.html` | not covered |
| Committee member (Group IT, extra) | `viewer` + `committee-member` | Prepare Friday's agenda from the cadence | `public/cockpit.html` | `public/cockpit.html` | `tests/e2e/t4-cockpit-agenda.spec.js` |

## Coverage summary

- Covered by a browser journey test: coordinator (1 of 3), site editor (4 of 4), field technician (1 of 1),
  committee member (1 of 1).
- **Not covered by any browser journey test**: admin, executive, super_admin and scorecard-viewer journeys, two of
  the three coordinator journeys. These are the gaps a person should plan sessions or new e2e journeys for.
- Personas from the committee report not mapped here because they have no separate account role today: analyst,
  business GM/FM (`site-business` lands on `public/site-awareness.html`), PMO.
