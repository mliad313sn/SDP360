# MODULE-REGISTER — roadmap module ↔ repository (M00 Phase 0)

Status vocabulary per the roadmap. "Source" lists files verified to exist at `758a996`.

| ID | Module | Repository surface (verified) | Status | Owner (human) |
|---|---|---|---|---|
| M01 | Deps / CI | `package.json`, `package-lock.json`, `tools/ci/lint.js`, `eslint.config.js`, `tests/*.test.js` (354 files) | IN_PROGRESS — baseline reproduced, env blocks classified | TBD |
| M02 | Authn / session / authz | `server.js` (global `/api` gate, `requireReportSession`, `requireRole`, `_reportWriteDenial`, site read guard), `routes/accounts.js`, `reports-db.js` (`ROLE_HIERARCHY`, `FEATURE_ROLES_KNOWN`, sessions) | IN_PROGRESS — F-M02-001 FIXED_IN_SOURCE | Security owner TBD |
| M02A-D | Group-first access policy | **Not present.** Current model = per-user roles (`user_roles`) + `users.site_id` + `user_sites`; no groups, packages, policy versions, exceptions or reviews | OPEN — needs ADR + IAM owner (DEC-01) | IAM owner TBD |
| M03 | Navigation / IA | `public/_shell.js`, `public/module-tabs.js`, `public/auth.js`, `services/pages.js`, 74 pages | IN_PROGRESS — PAGE-INVENTORY done | Product TBD |
| M04 | Shared contracts | `services/apiAudit.js`, error shapes per route, `services/*` readers | OPEN | Architect TBD |
| M05 | Executive scorecard / KPI | `public/executive.html`, `direction.html`, `it-review.html`, `routes/metrics.js`, `services/siteScore*.js`, `services/reviewDashboard.js`, `FORMULA_RECONCILIATION.md` | BLOCKED — chart-contract register absent | Data owner TBD |
| M06 | Site Overview / business-only | `public/site-awareness.html`, `routes/siteAwareness.js`, roles `site-business`/`group-business` | OPEN — scope decision DEC-02 | Product owner |
| M07 | IT operations dashboards | `index.html`, `infra-health.html`, `wan.html`, `routes/opmanager.js`, `routes/zohoData.js` | OPEN | IT ops TBD |
| M08 | Portfolio | `public/portfolio.html`, `routes/portfolio.js` | OPEN | Portfolio manager |
| M09 | Dashboard Composer | `public/dashboard-composer.html`, `dashboard.html`, `routes/dashboards.js` | OPEN | — |
| M10 | Dashboard publication | `public/publication.html`, `routes/publication.js` | OPEN | — |
| M11 | Tracker Builder | `public/tracker-builder.html`, `trackers.html`, `routes/trackers.js`, `routes/tracker.js` | OPEN | — |
| M12 | Tracker publication | `routes/trackers.js` (tracker-publisher), `public/lib/trackerMonthLock.js` | OPEN | — |
| M13 | Field / offline | `public/field.html`, `routes/field.js`, `public/inspection.html`, `routes/inspection.js`, `services/blobStore.js` | OPEN — device policy DEC-05 | Security |
| M14 | Reports / exports / sharing | `routes/reports*.js`, `reportgen.js`, `*-pptx.js`, `risk-register-export.js`, `services/tableExcel.js` | OPEN — F-M02-001 removed anonymous reach to `/api/risk-register-export` | — |
| M15 | Actions / notifications | Site Actions routes in `server.js`(*), `notifications.html`, `routes/engagement.js`, `services/mailer.js` | OPEN | — |
| M16 | Integrations | `routes/meridian.js`, `opmanager.js`, `teamsSla.js`, `fourmypeople.js`, `zoho-sync.js`, `services/merakiClient.js`, `sdpApiClient.js` | OPEN | Integration architect |
| M17 | Browser assets / CSP | 19 pages with external hosts (PAGE-INVENTORY), CSP middleware in `server.js` | OPEN — vendoring needs license review | AppSec |
| M18 | UX / WCAG 2.2 AA | all primary pages | OPEN — no browser E2E run here | A11y |
| M19 | Performance | — | OPEN — budgets not approved | Ops |
| M20 | Backup / restore | `db-backup.js`, `tools/installer/Manage-SDP.ps1`, `tools/pg/dump-db.js`, `docs/DB_RECOVERY.md` | OPEN — RPO/RTO not approved | Ops |
| M21 | Persona UAT | — | OPEN — requires humans | QA lead |
| M22 | Release board | — | NO-GO (gates open) | Human |

(*) `routes/` has 27 files: accounts, ai, assets, cockpit, dashboards, engagement, field, fourmypeople, inspection, meetings, meridian, metrics, opmanager, portfolio, publication, reportgen, reports, reportsConfig, reportsDecks, reportsSend, roadmap, siteAwareness, survey, teamsSla, tracker, trackers, zohoData. Site Actions routes live in `server.js`.
