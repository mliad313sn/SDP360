# Traceability matrix (generated)

`node tools/agent/traceability.js` writes this file from `GOAL_TRACKER.csv` and each `Gxx.md`; `--check` fails when a cited file is missing or the file is stale.
Field, deployed and accepted are copied from the tracker — code never sets them.

| Goal | Wave | Status | Tested | Field | Deployed | Accepted | Evidence | Tests cited | Code cited | Missing |
|---|---|---|---|---|---|---|---|---:|---:|---|
| G00 Re-baseline / proof of truth | W0 | IMPLEMENTED | UNIT | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G00.md` | 2 | 3 | — |
| G01 Reproducible toolchain, CI and version integrity | W0 | IMPLEMENTED | UNIT | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G01.md` | 5 | 1 | — |
| G02 Cross-site / cross-department data authorization | W1 | PARTIAL | INTEGRATION_PG | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G02.md` | 3 | 2 | — |
| G03 Secrets, outbound networking and supply-chain security | W1 | PARTIAL | UNIT | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G03.md` | 2 | 2 | — |
| G04 PostgreSQL-only migrations, audit chains and recovery | W1 | IMPLEMENTED | INTEGRATION_PG | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G04.md` | 1 | 1 | — |
| G05 Connector scope and canonical data contracts | W1 | IMPLEMENTED | UNIT | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G05.md` | 3 | 4 | — |
| G06 Canonical KPI definitions and official score | W2 | PARTIAL | UNIT | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G06.md` | 1 | 3 | — |
| G07 Reporting source freshness and publication controls | W2 | IMPLEMENTED | INTEGRATION_PG | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G07.md` | 2 | 4 | — |
| G08 Governance meetings, cadences and decision lifecycle | W2 | PARTIAL | INTEGRATION_PG | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G08.md` | 2 | 3 | — |
| G09 Unified commitment, closure verification and serious-finding control | W2 | IMPLEMENTED | INTEGRATION_PG | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G09.md` | 1 | 2 | — |
| G10 Interdepartmental requests, ownership and escalations | W2 | IMPLEMENTED | INTEGRATION_PG | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G10.md` | 1 | 2 | — |
| G11 Native PPM: full project execution and resource management | W3 | PARTIAL | INTEGRATION_PG | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G11.md` | 2 | 3 | — |
| G12 Native PPM: budget, financial control and benefits realization | W3 | PARTIAL | INTEGRATION_PG | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G12.md` | 1 | 1 | — |
| G13 Native PPM: roadmap consolidation and migrations | W3 | IMPLEMENTED | INTEGRATION_PG | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G13.md` | 1 | 0 | — |
| G14 RFI, incubation and investment decision pipeline | W3 | PARTIAL | INTEGRATION_PG | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G14.md` | 1 | 0 | — |
| G15 Composable trackers, dashboards and catalog contracts | W3 | PARTIAL | INTEGRATION_PG | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G15.md` | 1 | 1 | — |
| G16 R01-R16 report factory, A01-A16 alerts and deliverability | W3 | PARTIAL | INTEGRATION_PG | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G16.md` | 6 | 8 | — |
| G17 UX navigation redesign and role-based workspaces | W4 | PARTIAL | UNIT+BROWSER | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G17.md` | 1 | 3 | — |
| G18 UI modularisation, i18n FR/EN, performance | W4 | PARTIAL | UNIT | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G18.md` | 1 | 4 | — |
| G19 Field offline PWA, conflict-safe sync and on-site adoption | W4 | PARTIAL | INTEGRATION_PG+BROWSER | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G19.md` | 4 | 5 | — |
| G20 Responsible AI commentary and grounded insights | W4 | IMPLEMENTED | INTEGRATION | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G20.md` | 3 | 3 | — |
| G21 E2E, load, security and resilience evidence | W5 | PARTIAL | UNIT | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G21.md` | 2 | 2 | — |
| G22 Windows installer, upgrade, packaging, recovery | W5 | IMPLEMENTED | CI_WINDOWS_E2E | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G22.md` | 3 | 3 | — |
| G23 Product packaging, licensing and go-to-market feasibility | W5 | PARTIAL | UNIT | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G23.md` | 1 | 2 | — |
| G24 Executive validation, adoption measurement and final NO-GO/GO dossier | W6 | PARTIAL | UNIT | UNKNOWN | UNKNOWN | UNKNOWN | `docs/agent-execution/G24.md` | 1 | 0 | — |

## Tests per goal

- **G00**: `tests/agent-inventory.test.js`, `tests/csp-no-inline-handlers-new-pages.test.js`
- **G01**: `tests/node-version-pin.test.js`, `tests/.skip-allowlist.json`, `tests/test-runner-guard.test.js`, `tests/.suite-manifest.json`, `tests/ci-config.test.js`
- **G02**: `tests/authz-route-matrix.test.js`, `tests/access-revocation.smoke.test.js`, `tests/access-denied-log.smoke.test.js`
- **G03**: `tests/sbom.test.js`, `tests/password-compare.test.js`
- **G04**: `tests/audit-grants-rehearsal.test.js`
- **G05**: `tests/connector-register.test.js`, `tests/stale-source-no-colour.test.js`, `tests/sync-jobs-registry.test.js`
- **G06**: `tests/kpi-change-parity.test.js`
- **G07**: `tests/report-release.smoke.test.js`, `tests/audit-chain.test.js`
- **G08**: `tests/governance-routes.smoke.test.js`, `tests/session-lifecycle.test.js`
- **G09**: `tests/commitments-routes.smoke.test.js`
- **G10**: `tests/handoffs.smoke.test.js`
- **G11**: `tests/project-schedule.test.js`, `tests/ppm-project-lifecycle.smoke.test.js`
- **G12**: `tests/ppm-project-lifecycle.smoke.test.js`
- **G13**: `tests/ppm-project-lifecycle.smoke.test.js`
- **G14**: `tests/ppm-project-lifecycle.smoke.test.js`
- **G15**: `tests/dashboards-routes.smoke.test.js`
- **G16**: `tests/report-catalogue.test.js`, `tests/alert-severity-dryrun.test.js`, `tests/engagement-store.test.js`, `tests/engagement-routes.smoke.test.js`, `tests/publish-sharepoint-mock.test.js`, `tests/alert-outbound-arm.test.js`
- **G17**: `tests/shell-navigation.test.js`
- **G18**: `tests/ui-lang-shared.test.js`
- **G19**: `tests/field-no-silent-loss.test.js`, `tests/field-store.test.js`, `tests/pg-field-store.test.js`, `tests/field-routes.smoke.test.js`
- **G20**: `tests/ai-sanitize.test.js`, `tests/ai-proxy-sanitize.smoke.test.js`, `tests/fuzz-inputs.test.js`
- **G21**: `tests/traceability.test.js`, `tests/fuzz-inputs.test.js`
- **G22**: `tests/update-package-signature.test.js`, `tests/ci-config.test.js`, `tests/sbom.test.js`
- **G23**: `tests/update-package-signature.test.js`
- **G24**: `tests/traceability.test.js`
