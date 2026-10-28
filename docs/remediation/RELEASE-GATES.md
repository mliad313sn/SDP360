# RELEASE-GATES — status as of run 1 (2026-10-28)

Overall: **NO-GO** (development only). An agent cannot grant any gate.

| Gate | Requirement | Status |
|---|---|---|
| A | Focused regression passes after changes | PARTIALLY_VERIFIED — sqlite suite green except env + 2 pre-existing cancelled; pg half BLOCKED |
| B | Expanded full-page evidence for release scope | OPEN — no browser E2E |
| C | Backend permission / data-fidelity closure | OPEN — F-M02-001 fixed; F-M02-002 open; site × object matrix not built |
| D | Business lifecycle disposition | OPEN |
| E | Performance / a11y / recovery / UAT | OPEN — budgets, RPO/RTO not approved |
| F | Human approvals (product, security, data, QA, ops, business) | HUMAN_APPROVAL_PENDING |

## Decisions

DEC-01 to DEC-07 are decided — see [DECISIONS.md](DECISIONS.md). Remaining human gates: key rotation (DEC-06), device encryption standard (DEC-05), M02A ADR sign-off (DEC-01), release (M22).

### Original questions
- **DEC-01** IAM: approve persona→role mapping in PERSONA-COVERAGE.md; commission ADR for the M02A group-first model.
- **DEC-02** Product: exact Site-business vs Group-business scope (M06).
- **DEC-03** Product: may `itsm-integrations-plan.html` and the 22 `design-system/` + `dashboard-preview/` pages stay public?
- **DEC-04** Security: is a site-less `admin` meant to be global (current behaviour) — "inherited site-admin over-privilege".
- **DEC-05** Security/data: field device storage, encryption and retention policy (M13).
- **DEC-06** Ops: rotate `DASHBOARD_API_KEY` after deploying F-M02-001 (R-01).
- **DEC-07** Product/security: should meetings and inspection data be readable only within the reader's site(s) (like reports since lot 4), or stay fleet-wide? Today any viewer reads every site's PVs and inspections, including photos and signatures.
