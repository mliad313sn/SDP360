# SDP360 — truth matrix (EX-00)

Reference: branch `claude/sdp360-consolidation`, 2026-10-29. Re-run the evidence commands below to refresh it;
never upgrade a status by hand.

**Statuses** — each column needs its own evidence; a later column never implies an earlier one is done.

| Column | Means | Evidence accepted |
|---|---|---|
| Documented | the behaviour is written down | a file in `docs/` |
| Implemented | code on this branch | a file path |
| Tested | an automated test proves it | a test in the suite (CI green on the SHA) |
| Field-validated | real users, real site, real data | a signed UAT record from a pilot site — **none yet** |
| Deployed | running in production | the deploy marker (`.git/last-deployed`) — **this branch is not deployed** |
| Business-accepted | the owner accepted it | a signed decision — **none yet** |

Field-validated, deployed and business-accepted are **empty for every SDP360 2.0 item**. That is the honest
state: the CI, the Windows runners and the synthetic UAT panel prove the software, not its adoption.

## Matrix

| Capability | Doc | Impl | Tested | Evidence | Open gate |
|---|---|---|---|---|---|
| PostgreSQL-only backend, migrator | ✓ | ✓ | ✓ | `db/migrate.js`, CI "Apply schema migrations", `tests/pg-*.test.js` | DBA rehearsal on an authorised copy |
| Backup / restore / rollback | ✓ | ✓ | ✓ | `tools/pg/restore-rehearsal.js` (PG 17 in CI, PG 16 locally: `docs/ops/rehearsals/`), `tests/db-restore.test.js` | RPO/RTO targets (owners) |
| Windows installer: blank server and existing server | ✓ | ✓ | ✓ | workflow `Installer` (build + e2e `blank` + e2e `existing-postgresql`) | signing keys (D-11/12), TEST-instance run on the real network |
| Windows service + Manager | ✓ | ✓ | ✓ | `tools/service`, `tools/manager`, e2e Manager checks | — |
| Site isolation, business-only boundary, object authorisation | ✓ | ✓ | ✓ | `tests/authz-route-matrix.test.js`, `tests/business-only-boundary.smoke.test.js`, `AUTHZ-OBJECT-MATRIX.csv` | security sign-off |
| Key-only API routes (16) | ✓ | ✓ | ✓ | `tests/dashkey-only-routes.smoke.test.js`; call evidence logged (`dashkey_call`) | D-15 (owner lists callers) |
| Secret hygiene | ✓ | ✓ | ✓ | `tools/security/secret-scan.js` blocking in CI and release; `docs/security/EX-01-CREDENTIAL-INCIDENT.md` | rotation + history decision |
| KPI dictionary, RAG policies | ✓ | ✓ | ✓ | `services/metricRegistry.js`, `tests/metrics-*.test.js` | D-01/02/03 (`KPI-DISPUTES.md`) |
| Change success rate | ✓ | ✓ (2 definitions, DRAFT) | ✓ | `tests/kpi-change-parity.test.js` | D-01 |
| Governance (roles, deputies, policies, calendars, sessions, minutes) | ✓ | ✓ | ✓ | `tests/governance-*.test.js`, `GOVERNANCE-POLICIES.md` | committee values (`tools/governance/apply-values.js`) |
| Commitments, handoffs, obligations | ✓ | ✓ | ✓ | `tests/commitment-*.test.js`, `tests/handoffs*.test.js`, `tests/obligations*.test.js` | D-04 (verification, alert recipients) |
| Reports R01–R16 / alerts A01–A16 | partial | partial | partial | publication lifecycle + SoD tests; catalogue incomplete | D-13 (roles, channels) |
| Portfolio / projects (native PPM) | partial | partial | partial | `portfolio.html`, governance store | EX-05 witness project with PMO + Finance |
| Field app (offline, French first) | ✓ | ✓ | ✓ | `tests/field-*.test.js`, `tests/field-french.test.js` | pilot on devices (D-05) |
| Phone layout of the weekly report editor | ✓ | ✓ | browser 390 px | UAT F-05 | pilot |
| Finance read-only role | ✓ | ✓ | ✓ | `tests/assets-money-scope.smoke.test.js` | holder to name |
| Third-party licences | ✓ | ✓ | ✓ | `tools/release/licence-inventory.js`, `LICENCE-INVENTORY.csv` | Legal: bundled installers' redistribution, external use (LICENSE) |

## Tests not executed in CI (11 skips) and why

| Tests | Reason | How to run them |
|---|---|---|
| 10 in `tests/review-data.test.js` and `tests/site-window-readers.test.js` | need `prod-snapshot/` (a copy of production data, deliberately not in the repository) | on the dev box with the snapshot present |
| 1 in `exec-pptx` render | needs Python with matplotlib + python-pptx | `pip install matplotlib python-pptx` then the suite |

## Evidence commands

```bash
node tools/test/run-all.js
```

```bash
node tools/security/secret-scan.js --history
```

```bash
node tools/release/licence-inventory.js
```

```bash
PG_ADMIN_URL=<disposable cluster> node tools/pg/restore-rehearsal.js --rows 100000
```
