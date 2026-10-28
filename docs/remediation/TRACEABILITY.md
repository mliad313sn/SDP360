# TRACEABILITY (M00 Phase 0)

| Finding / requirement | Source | Module | Work package | Change | Test | Status |
|---|---|---|---|---|---|---|
| F-M02-001 dash key leaked to anonymous visitors on 5 pages | this run (route probe) | M02/M14 | WP-M02-001 | `server.js` `sendKeyedHtmlPage` | T-M02-002 | FIXED_IN_SOURCE · TESTED_SYNTHETICALLY |
| F-M01-001 body-parser <1.20.9 DoS (GHSA-27r3-jxmh-p828) | `npm audit` | M01 | WP-M01-003 | `package-lock.json` | T-M01-004 | FIXED_IN_SOURCE |
| F-M01-002 suite requires DASH_USER/DASH_PASS | T-M01-001 | M01 | WP-M01-001 | `tests/_default-env.js` + `npm test --require` | T-M01-007 | FIXED_IN_SOURCE · TESTED_SYNTHETICALLY |
| F-M01-003 send-weekly-report 2 cancelled tests (test artifact: never-settling promise + unref'd prod timer emptied the loop) | T-M01-002 | M01 | WP-M01-002 | test stub keeps a ref'd timer | T-M01-007 | FIXED_IN_SOURCE |
| F-M02-002 31 `/api` routes with no named guard in chain | RBAC-MATRIX | M02 | WP-M02-002 | reviewed: 5 public-by-design, 1 in-handler admin check (`/api/health/views`), 6 own-key (`/api/actions/open`, `/api/v1/*`), **19 dash-key-only** pinned by T-M02-004 | T-M02-004 | PARTIALLY_VERIFIED — 19 need owner decision (R-02/DEC-06) |
| F-M03-001 `itsm-integrations-plan.html` served anonymously | PAGE-INVENTORY | M03 | WP-M03-001 | — | — | HUMAN_APPROVAL_PENDING (DEC-03) |
| Roadmap "4 redirect/static targets lacking auth.js" | roadmap §1.2 | M03 | WP-M03-002 | none needed | static read | VERIFIED (public-safe redirects) |
| Roadmap "23 dependency-blocked checks (better-sqlite3, xlsx)" | roadmap §1.2 | M01 | — | — | T-M01-001 | NOT REPRODUCED in this env (deps install; remaining skips are PG/snapshot) |
| F01-F24 | `GAP-BACKLOG.csv` | — | — | — | — | **BLOCKED — file not in repository** |
| 41 chart contracts | `CHART-CONTRACT-REGISTER.csv` | M05 | — | — | — | **BLOCKED — file not in repository** |
| WP-M02-004 object-ID substitution on id-keyed meetings/inspection writes (no prior cross-site test) | RBAC-MATRIX | M02 | WP-M02-004 | test only — handlers already enforce | T-M02-005 | TESTED_SYNTHETICALLY |
| F-M02-003 field quick action with empty `site`: visible to every site's coordinator and closable by any editor (site check skipped when site empty) | WP-M02-005 review | M02/M13 | WP-M02-005 | `routes/field.js` — scoped submitter must name an own site; site-less rows listed to their author only and closable by admin tier only | T-M02-005 (tests 6-7, fail on base) | FIXED_IN_SOURCE · TESTED_SYNTHETICALLY |
| F-M02-004 cockpit `POST /api/cockpit/actions/:id`: ownership matched on `username`/`full_name` text, and any `admin` edits any site's action | WP-M02-005 review | M02/M02A | WP-M02A-001 | — | — | OPEN — needs stable owner id (M02A rule 1) + DEC-04 |
| Trackers `/entries` `/import`, field `/inspections/:id`, report `action/:uid/*` cross-site | WP-M02-005 review | M02 | — | — | `trackers-routes.smoke`, `field-routes.smoke`, `audit-report-write-auth.smoke` | VERIFIED (existing tests) |
