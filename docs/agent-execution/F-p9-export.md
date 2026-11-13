# F-p9-export — Goal B7: one export policy

Branch `goal/p9-export` from `222ab4b`. ADR: `docs/ai-decisions/ADR-P9-export-policy.md`.

| Clause | Built | Evidence |
|---|---|---|
| Single sensitivity matrix module × format × role → allow/mask/deny | `services/exportPolicy.js` CATALOGUE (46 rows, 9+ modules: assets, reports, meetings, inspection, tracker/trackers, dashboards, wan_sla, risk_register, finance, governance) + `decide()` | `tests/export-policy.test.js` |
| Consulted by every export route | `gate(id)` on 50 route registrations (server.js 19, routes/* 31) | coverage test walks the live router, documented exemptions (share links, field uploads, minutes e-mail, deck upload) |
| Default reproduces today | default never denies; amount rule = today's (committee exception kept) | matrix test asserts default ≠ deny for every persona; `export-share-boundary.smoke` green; 553 neighbour tests green |
| Stricter PROPOSED matrix behind `export_policy_strict='0'` | viewer refused on PV deck / pre-brief deck / site action register; fleet risk register admin tier only; amounts admin tier + finance-viewer only | `export-policy-routes.smoke` (strict 403s, editor kept) |
| Amounts masked everywhere via the policy | `req.exportPolicy.money` used by portfolio deck/workbook/report.html, annual pack, WAN claim evidence; money-gated routes catalogued `gated` | matrix test: strict money = admin tier ∨ finance-viewer for every row |
| Log every export (category `export`) | finish hook, fire-and-forget, who/module/format/site scope/rows/decision | smoke test reads `system_log` |
| Watermark behind `export_watermark_enabled='0'` | `services/exportWatermark.js` (CSV/HTML/XLSX/PPTX; header for PDF/JSON) | unit + smoke (CSV last line, XLSX `Export` sheet) |

Config: two `DEFAULTS` keys, `PILOT-PROFILE.md` rows, FLAG-REGISTER regenerated. No migration.

Tests: `export-policy.test.js` 48/48, `export-policy-routes.smoke.test.js` 5/5, neighbours (authz-*, rbac-*,
flag-register, inventory-strict, i18n-coverage, error-shape, await-precedence, server-size-budget, readme-truth,
ui-policy*, simplicity-budget, cross-site sweeps, ppm-rollback-scripts, money-scope, portfolio parity, export
route suites) 347 + 549 pass, 0 fail. eslint clean.

## Human decisions (data owner + security)
1. Adopt or amend the sensitivity matrix (the `strict` rows and the amounts column) — it is PROPOSED.
2. Whether the portfolio committee-member amount exception survives (default keeps it; strict ends it).
3. Whether watermarking should be switched on, and whether PDF stamping is required (not built).
