# 02 — Decision log (2027 programme)

Human decisions only. Engineering tasks are in [03-DELIVERY-BACKLOG.md](03-DELIVERY-BACKLOG.md). Agent-level default assumptions taken during the remediation programme stay in [`../review/DECISIONS-EN-ATTENTE.md`](../review/DECISIONS-EN-ATTENTE.md) — not duplicated here; rows below that depend on one of them cite it.

Decision rights follow the master brief §C: **Committee** (KPI definitions, taxonomy, publication) · **Business/control owners** (operational closure) · **Sponsors/Finance** (investment, finance benefits) · **CAB** (production change, source writeback) · **Information Security** (controls, connector access).

| ID | Decision required | Decider | Blocks | Default until decided | Status |
|---|---|---|---|---|---|
| D-01 | KPI dictionary: definitions, numerators/denominators, N/A and freshness rules for the five 2027 dimensions | Committee | Goal 03 scorecard publication, R04 | Draft weights 20/20/25/20/15 shown as **"pending Committee approval"**, never certified | Open |
| D-02 | RAG thresholds (deck proposes ≥ 80 / 60–79 / < 60) and anti-gaming red flags | Committee | Goal 03/04 | Indicative only, labelled unapproved | Open |
| D-03 | Reference site score (E9 / remediation D1) and tracker GREEN threshold (remediation D2) | Committee | E9 (suspended), G5.2 | Three score models keep their own labels; E9 not executed | Open — see remediation plan §E9 |
| D-04 | Business closure policy: who may verify, accept residual risk, service window before A15 escalation | Business/control owners + Committee | Goal 02 `verified_closed` | No auto-verification; technical completion ≠ closure | Open |
| D-05 | Pilot sites (2) and optional third offline-readiness site | Sponsor + Group IT | Goal 05, domain 9 | None chosen | Open |
| D-06 | Meraki direct connector: retire, keep dormant as legacy, or keep for WAN SLA chargeback only | Infrastructure + Platform Owner + CAB | G7.1, R09 | **Kept**: the Meraki connectors (WAN health, % Time Up, SLA chargeback, poller/ingester) stay supported product scope; no retirement, no removal | **Decided 2026-10-28 by the requester** ("keep meraki connectors"); CAB still approves any production change |
| D-07 | Meridian connector retirement (already removed from the integrations plan per CLAUDE.md 2026-09-02, keys empty) | Platform Owner + CAB | G3.4 | Dormant; no new work | Open — removal needs CAB |
| D-08 | 4MyPeople lookup: approved for owner-name resolution or not | Information Security + data owner | C07 | Existing route kept, no extension | Open |
| D-09 | Microsoft 365 Calendar (C06): enable or not | Sponsor + Information Security | Goal 03 routines | Not built | Open |
| D-10 | 2026 historical slide figures (53/90, 68/30, 10/30, 117/192, 15/32): reconciliation owner and acceptance of differences | Committee | G5.5 | Shown only as attributed historical reference | Open |
| D-11 | Dependency upgrade for `follow-redirects` / `image-size` (2 high advisories) | CAB (release) | G7.5 | Not applied in Goal 01 | Open |
| D-12 | Real manifest-signing key and verified CI action SHAs before first release | Information Security + CI owner | G8.4 | See `DECISIONS-EN-ATTENTE.md` E1 rows | Open (cross-ref) |
| D-13 | Report release authority per catalogue report (R01–R16) and channel scopes | Reporting owner + audience reviewer | Goal 04 | Nothing released as authoritative without review | Open |
| D-14 | Department-level RBAC model (who owns department grants) | Information Security + business owners | G1.7 | Site-only scoping | Open |

Engineering defaults the agent may apply without these decisions are flagged reversible in the backlog.
