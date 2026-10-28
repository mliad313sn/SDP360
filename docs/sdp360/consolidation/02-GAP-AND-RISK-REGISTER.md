# 02 — Gap and risk register (consolidation)

Existing registers stay authoritative for their scope: [2027 gap register](../2027/01-GAP-REGISTER.md),
[remediation plan](../review/2026-10-20-PLAN-DE-REMEDIATION-PROMPTS.md). This file holds the **consolidation**
findings (prefix `CG-`). Status vocabulary: `NOT_PRESENT · PARTIAL · IMPLEMENTED · UNIT_TESTED ·
INTEGRATION_TESTED · FIELD_VALIDATED · DEPLOYED · BUSINESS_ACCEPTED` (never collapsed into "done").

| ID | Finding | Evidence | Persona / site | Sev | Owner | Status | Test | Dependency | Rollback | Approval |
|---|---|---|---|---|---|---|---|---|---|---|
| CG-01 | Business-only accounts restricted in the browser only; a `site-business` session got 2xx from 104 API routes | bizsweep run on `fb78494`; `public/auth.js:83` | Site business owner, group sponsor / all sites | **P0** | Delivery team | IMPLEMENTED · INTEGRATION_TESTED (in-process) | `business-only-boundary.smoke` (4/5 fail without) | — | revert `efd92e9` (1 middleware line) | Security sign-off for release |
| CG-02 | Meetings + inspection reads fleet-wide for any session (photos, signatures) | 1.11 tests 8-10 fail on 2.0 | Viewer/editor / every site | **P0** | Delivery team | IMPLEMENTED · INTEGRATION_TESTED (sqlite+PG) | `cross-site-object-writes.smoke` | D-14 | revert `efd92e9` route blocks | User decision DEC-07 (given); security sign-off for release |
| CG-03 | CSV exports executable as formulas (CWE-1236) | no writer neutralised | Every exporting persona | P1 | Delivery team | IMPLEMENTED · UNIT_TESTED | `csv-safe.test` | — | revert | — |
| CG-04 | Internal integrations plan served anonymously | 200 for anonymous on 2.0 | Public network | P1 | Delivery team | IMPLEMENTED · INTEGRATION_TESTED | `integrations-plan-gate.smoke` | — | revert `6a556de` | — |
| CG-05 | 3 high npm advisories (body-parser, follow-redirects, image-size) | `npm audit` on 2.0 | Server | P1 | Delivery team | IMPLEMENTED · UNIT_TESTED (full suite + goldens) | suite | D-11 | revert `9e7d5f1` | **CAB (D-11)** for release |
| CG-06 | Test floor `tests/.min-test-count = 1` gave no protection against dropped subtests | file content | CI | P0 | Delivery team | IMPLEMENTED · UNIT_TESTED | `test-runner-guard.test` | — | revert `645f940` | — |
| CG-07 | 2.0 suite failed 64/94 on any box without `.env` (handoff "94 to triage") | `b20.log` signature | CI | P0 | Delivery team | IMPLEMENTED | full suite 0 fail | — | — | — |
| CG-08 | 2 routes reachable with the dash key alone: `GET /api/ping` (harmless), `GET /api/data/ticket-volume` (Zoho view proxy) | `tools/qa/route-matrix.js` on 2.0 | Server-to-server | P2 | Delivery team | OPEN | — | inventory of key clients (D-15) | — | — |
| CG-09 | No authenticated runtime version/build endpoint (E0.3) | `routes/health.js` | Ops | P2 | Delivery team | OPEN → next package | — | — | — | — |
| CG-10 | No ESLint/SAST config on 2.0 (1.11 ships `eslint.config.js` + security plugin); CodeQL present | `package.json` scripts | CI | P2 | Delivery team | OPEN | — | — | — | — |
| G-ENV-01 | PostgreSQL 17 target; tests ran on PG 16 here | Ubuntu package | CI | P2 | Delivery team | BLOCKED (PG 17 not available offline here) | — | CI service image (`.github/workflows/ci.yml`) | — | — |
| G-ENV-02 | 10 tests need `prod-snapshot/`, 1 needs python+matplotlib | skip report | CI | P2 | Data owner | BLOCKED | — | approved snapshot | — | Data owner |
| CG-11 | F01-F24 and the 41 chart contracts (Batch 2) | inputs absent from both repos | — | — | Requester | **BLOCKED** — not fabricated | — | genuine `GAP-BACKLOG.csv`, `CHART-CONTRACT-REGISTER.csv` | — | — |
