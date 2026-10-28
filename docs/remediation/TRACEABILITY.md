# TRACEABILITY (M00 Phase 0)

| Finding / requirement | Source | Module | Work package | Change | Test | Status |
|---|---|---|---|---|---|---|
| F-M02-001 dash key leaked to anonymous visitors on 5 pages | this run (route probe) | M02/M14 | WP-M02-001 | `server.js` `sendKeyedHtmlPage` | T-M02-002 | FIXED_IN_SOURCE · TESTED_SYNTHETICALLY |
| F-M01-001 body-parser <1.20.9 DoS (GHSA-27r3-jxmh-p828) | `npm audit` | M01 | WP-M01-003 | `package-lock.json` | T-M01-004 | FIXED_IN_SOURCE |
| F-M01-002 suite requires DASH_USER/DASH_PASS | T-M01-001 | M01 | WP-M01-001 | — | — | OPEN |
| F-M01-003 send-weekly-report 2 cancelled tests | T-M01-002 | M01 | WP-M01-002 | — | — | OPEN (pre-existing) |
| F-M02-002 31 `/api` routes with no named guard in chain | RBAC-MATRIX | M02 | WP-M02-002 | — | — | OPEN |
| F-M03-001 `itsm-integrations-plan.html` served anonymously | PAGE-INVENTORY | M03 | WP-M03-001 | — | — | HUMAN_APPROVAL_PENDING (DEC-03) |
| Roadmap "4 redirect/static targets lacking auth.js" | roadmap §1.2 | M03 | WP-M03-002 | none needed | static read | VERIFIED (public-safe redirects) |
| Roadmap "23 dependency-blocked checks (better-sqlite3, xlsx)" | roadmap §1.2 | M01 | — | — | T-M01-001 | NOT REPRODUCED in this env (deps install; remaining skips are PG/snapshot) |
| F01-F24 | `GAP-BACKLOG.csv` | — | — | — | — | **BLOCKED — file not in repository** |
| 41 chart contracts | `CHART-CONTRACT-REGISTER.csv` | M05 | — | — | — | **BLOCKED — file not in repository** |
