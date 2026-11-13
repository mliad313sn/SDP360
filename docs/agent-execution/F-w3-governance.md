# F-w3-governance — PPM parity wave W3 (executive & governance)

- **Branch:** `goal/w3-governance` (base `222ab4b`, merged `sdp-waves` `df506f0`). **Migration:** 110 + rollback, listed in
  `tests/ppm-rollback-scripts.test.js`. **ADR:** `docs/ai-decisions/ADR-W3-GOVERNANCE-executive-governance.md`.
- **Every behaviour is behind a PROPOSED switch defaulting to '0' (today)**; DEFAULTS in `services/reportConfig.js`, rows in
  `docs/ops/pilot/PILOT-PROFILE.md`, `docs/ops/FLAG-REGISTER.md` regenerated.

## Built, per clause
| Clause | Where | Proof |
|---|---|---|
| Simplified ↔ Expert (per user, default off) | `public/lib/ppmGovernanceW3.js`, `GET/PUT /api/governance/ppm/view-mode`, `ppm_user_view_prefs` | smoke "T10 summary … view mode per user" |
| KPI cards + phase strip reconciled to engine/EVM | `services/ppm/projectKpis.js`, `GET …/project/:id/summary` | pure "KPI cards reconcile …" (recomputed from rows), smoke "T10 summary" |
| Gate checklist, artifacts, multi-approver sign-off | `services/ppm/gateChecklist.js`, `governanceW3Store.js`, stage refusal in `routes/governance.js` | pure ×3, smoke "T9 gate checklist" (owner, non-approver, reason, 409, reject blocks, append-only, ledger, server time) |
| Composite RAG + hysteresis | `services/ppm/projectRag.js`, `ppm_project_rag_state` | pure ×5 (every edge, flapping series), smoke "T9 composite RAG" |
| RAID with P×I, exposure (masked) | `services/ppm/raid.js`, `ppm_raid_details`, `GET/PUT …/raid` | pure "RAID …", smoke "RAID …" (no amount in body or ledger for a committee-member) |
| DCMA 14 points | `services/ppm/dcma.js`, `GET …/dcma` | pure ×3 hand-built fixtures, smoke "T11 DCMA" |
| Scheduled PDF/Excel reports (armed off) | `tools/reports/send-ppm-reports.js`, `ppm_project` in `services/reportSchedule.js`, `GET …/report.{html,xlsx}`, export policy `governance.project_report` | smoke "reports", "scheduled project report" |
| Paginated Gantt print | `public/lib/ppmGovernanceW3.{js,css}` (SVG sliced per page with legend; ganttV2 CSS) | no automated test (print layout) — human browser check |

## Shared files touched (minimal, delimited)
`routes/governance.js` (stage refusal + dry run, helper `w3GateRefusal`), `routes/governancePpm.js` (register + feature flags),
`services/exportPolicy.js` (one catalogue row), `services/reportSchedule.js` (type `ppm_project`), `public/project.html`
(7 `<!-- W3-GOVERNANCE begin/end -->` blocks), `tests/ppm-rollback-scripts.test.js`.

## Tests
`ppm-w3-pure.test.js` 13/13, `ppm-w3.smoke.test.js` 8/8; neighbours (authz-*, rbac-*, flag-register, inventory-strict,
i18n-coverage, error-shape, await-precedence, server-size-budget, readme-truth, ui-policy*, simplicity-budget, cross-site-*,
ppm-*, export-policy*, report-schedule*, project-page, report-config*) 75 files green; full suite: see the report.

## Left / human decisions
RAG thresholds, phase model, gate approvers per gate, report recipients and schedule (PMO); residual P×I; per-milestone slip;
admin card for the scheduled report; drill-down from the cards; browser checks of the toggle and the print.
