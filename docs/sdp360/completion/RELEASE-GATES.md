# Release gates — human sign-off (G-10)

No cell below may be filled in by the delivery team or by an agent. An empty cell means **not approved**.
The release stays **NO-GO** while any mandatory row is empty.

| Gate | Scope | Approver role | Decision (GO / NO-GO / conditions) | Name | Date | Evidence reviewed |
|---|---|---|---|---|---|---|
| Security — access policy CG-01/CG-02, authz matrix (G-03…G-08) | release | Information Security | | | | |
| Security — threat model and findings register (G27) | release | Information Security | | | | |
| CAB — dependency release D-11 (CG-05) and PostgreSQL-only cutover PO-08 | release | CAB | | | | |
| Signing key and CI action SHAs D-12 (G-09) | first signed release | Information Security + CI owner | | | | |
| Backup / restore RPO-RTO (G-11) | release | CAB + SRE | | | | |
| KPI definitions, thresholds, score D-01/02/03 (G-12) | any official score | KPI Committee | | | | |
| Closure policy D-04 (G-17/G-18) — incl. who is told about A01/A02 escalations | `commitments_enabled=1` | Business/control owners + Committee | | | | |
| Handoffs (G-22) — enable, notification recipients, user↔department mapping if wanted | `handoffs_enabled=1`, `handoff_notify_enabled=1` | Sponsor / PO + Committee | | | | |
| Dashboard and tracker reviewers (G-23/G-24, DEC-6.x) — who reviews which audience | publication without admin override | Committee | | | | |
| Report authority and channels D-13 (G-13/G-25) | external report release | Reporting owner | | | | |
| Pilot sites D-05 and field UAT (G-16/G-35) | field acceptance | Sponsor + Group IT | | | | |
| Data owner — anonymised fixtures (G-15), 2026 history D-10 | data claims | Data owners | | | | |
| Connectors D-07/D-08/D-09, dash-key clients D-15 (D-06 Meraki: kept by requester decision) | connector changes | Platform/infra owners | | | | |
| Finance — budgets and benefits (G14) | financial figures | Finance | | | | |
| Product — business acceptance | release | Sponsor / PO | | | | |
| Legal / commercial (G-38/G-39) | market release | Legal + commercial lead | | | | |
| Production deployment GO/NO-GO | deploy | CAB | | | | |
