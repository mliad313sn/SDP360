# RISKS (M00 Phase 0)

| ID | Risk | Severity | Disposition |
|---|---|---|---|
| R-01 | The production `DASHBOARD_API_KEY` has been delivered to anonymous visitors since keyed pages existed (F-M02-001); it must be presumed exposed. | High | **Human gate**: rotate the key in prod `.env` after deploying the fix (secret rotation is out of agent scope). |
| R-02 | Even post-fix, the dash key is a shared role-less bearer secret given to every signed-in user; 19 routes accept it with no session, role or site check. | Medium | WP-M02-002/003: move those routes behind `requireReportSession` + role, or retire the key for browsers. Needs consumer inventory (server-to-server callers unknown). |
| R-03 | Access is per-user role flags; no group/package/policy-version model (M02A-D). | Medium | DEC-01 + ADR before any migration. |
| R-04 | pg parity tests (~105) never ran here; prod is 100 % PostgreSQL. | High | Run `PG_TESTS_REQUIRED=1 npm test` in an approved nonprod with PG. |
| R-05 | Batch 2 registers absent → F01-F24 and chart contracts cannot be traced. | Medium | Supply the artifacts. |
| R-06 | 19 pages load external CDN/fonts; CSP + offline field use depend on third-party hosts. | Medium | M17, license review before vendoring. |
