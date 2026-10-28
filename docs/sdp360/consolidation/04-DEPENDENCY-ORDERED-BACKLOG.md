# 04 — Dependency-ordered backlog (consolidation)

Source backlogs: [2027 delivery backlog](../2027/03-DELIVERY-BACKLOG.md) (E0…E4, P1, P2),
[remediation plan](../review/2026-10-20-PLAN-DE-REMEDIATION-PROMPTS.md). Ordered by dependency; a package
starts only when its dependencies are met; human gates never block independent packages.

| # | Package | Depends on | Status |
|---|---|---|---|
| 1 | P0-C test census, default env, skip reasons | — | done `645f940` |
| 2 | P0 security transplant (business-only, DEC-07 reads, CSV, rate-limit switch) | 1 | done `efd92e9` |
| 3 | P0-D dependency advisories | 1 | done `9e7d5f1` (CAB gate for release) |
| 4 | DEC-03 integrations plan behind login | 2 | done `6a556de` |
| 5 | P0-E authenticated version/build endpoint (E0.3) + version consistency | 1 | next |
| 6 | P0-B/D persona × site × object × action matrix with deny tests (extends `authz-route-matrix`) | 2 | queued |
| 7 | P0-C remediation-plan items C1, C2, E1-E6, E11, M4, M7, M9: verify real completion with tests | 1 | queued |
| 8 | CG-08 dash-key-only routes: pin test now; restrict after D-15 | 2 | queued (test part independent) |
| 9 | ESLint + security plugin on 2.0 (CG-10) | 1 | queued |
| 10 | P1 commitments (Goal 02) shadow-mode validation: lifecycle, backfill dry-run, two end-to-end scenarios on sqlite + PG | 7 | queued — `commitments_enabled` stays 0 (D-04) |
| 11 | P1 native portfolio: hierarchy, stage gates, declarations, benefits ledger, roadmap linkage | 10 | queued |
| 12 | P1 KPI dictionary metadata + 2027 scorecard in SHADOW/DRAFT | 7 | queued — D-01/02/03 |
| 13 | P1 report catalogue R01-R16 + alerts A01-A16 (fixtures, release workflow) | 10, 12 | queued — D-13 |
| 14 | P1 connector register (honest states) + OpManager coverage view + excluded-connector audit | 7 | queued — D-06/07 |
| 15 | P1 UX simplicity charter S-1…S-8 | 6 | queued |
| 16 | P2 server.js modularisation on 2.0 (WP-P2-01), backup/restore drill, UAT pack | all | queued — D-05, CAB |
