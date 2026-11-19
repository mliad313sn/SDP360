# P11 — Independent qualification run: readiness report (round 1)

> **AI panel report — not an independent human review, not a decision.** Six AI reviewer seats, each in a
> clean clone at the frozen SHA without the agent narratives, re-ran their own evidence and tried to break
> one claim per capability. The run ends when the human release committee has this report; it does not end
> with a release. Seat reports: `docs/agent-execution/p11/round1-7eee8955/`.

- **Frozen SHA (round 1):** `7eee8955568c0bcab2a6329f838ee432ffca9fd1` (local tag `qual-p11-7eee8955`), CI run 353 green (test + e2e).
- **Environment limits:** PostgreSQL 16 locally (target 17; CI runs 17); no `pwsh` (installer scripts covered statically only);
  synthetic data only; the six seats shared one PostgreSQL (first runs hit "too many clients" at 100 connections —
  raised to 400 and re-run serially; recorded as environmental).

## Findings round 1

| Seat | P0 | P1 | P2 | P3 | Evidence verified / not verified |
|---|---|---|---|---|---|
| Security | 0 | 2 | 3 | 3 | 7 / 2 |
| Data/KPI | 0 | 1 (P0 candidate for a human) | 4 | 2 | 5 (+1 partial) / 3 |
| PPM | 0 | 2 | 4 | 5 | 3 / 4 |
| Operations | 0 | 2 | 4 | 5 | 6 / 2 |
| UX/field | 0 | 1 | 2 | 1 | 3 / 0 (42 journeys green twice) |
| Audit | 0 | 1 | 3 | 5 | 5 / 4 |

## P1 findings and what happened (step 5: back to implementation)

| ID | Finding | Status |
|---|---|---|
| SEC-F1 | Site editor could publicly share / read group-wide report runs | **Fixed** (fix 1, merged) — regression test from the repro |
| SEC-F2 | Committee member reads portfolio amounts on 6 endpoints | **Human decision** (Finance/InfoSec): accept and amend the invariant, restrict to admin + finance-viewer, or totals only |
| DATA-F-01 | Deck slide 7 shows CSAT 0 % when nothing was measured | **Fixed** (fix 1); inverse bug (measured 0 → "not measured") fixed too |
| OPS-F-01 | Survey sync had no truncation guard (partial export deleted history for good) | **Fixed** (fix 2); assets partial view (F-03) fixed too |
| OPS-F-02 | Manager/installer health probe blind to a dead database | **Fixed** (fix 2), probe on `/ready`; `.ps1/.bat` covered by a static test only |
| PPM-F1 | One extreme task value took the whole portfolio down (500 for every user) | **Fixed** (fix 3): bounds at write (ADR-P11-F1) + resilient portfolio reads |
| PPM-F2 | EVM actual cost dropped money spent on cancelled/summary tasks | **Fixed** (fix 3, ADR-P11-F2); EVM stays uncertified until Finance gate G14 |
| UX-F-1 | Field-tech could overwrite a submitted inspection through the field outbox | **Fixed** (fix 4): 409, collision-resistant field ids; F-2 (stale status override) and F-3 (SW cached /api/) fixed too |
| AUD-1 | Commitment four-eyes bypass by reassigning owner/reviewer | **In progress** (fix 5); behind dark switch `commitments_enabled` |

P2/P3 findings stay listed in the seat reports (residual-risk register below). Per P11 step 5, **round 2 restarts
at a new frozen SHA once fix 5 is merged and CI is green.**

## Residual-risk register (open after the fixes)

| Risk | Area | Class | Owner role (to be named) |
|---|---|---|---|
| Committee-member money exposure (SEC-F2) | Security/Finance | P1 decision | Information Security + Finance |
| Dash key injected in session pages; keeps working after deactivation (SEC-F3) | Security | P2 | Security owner |
| Only 2/62 pages under strict CSP (SEC-F4) | Security | P2 | Security owner (switch `csp_strict_pages` proposed list) |
| Probe money sentinels miss finance actuals / EVM / time entries (SEC-F5) | Security | P2 | QA lead |
| Group IT deck tracker fallback scores no-data as red (DATA-F-02) | KPI | P2 | KPI committee |
| Migrator re-runs a changed applied script (DATA-F-03) | Data | P2 | DBA |
| Reconciliation tool guesses dd/mm dates (DATA-F-04) | Data | P2 | Data owner |
| Unauthenticated /health exposes Zoho error bodies / org ids (OPS-F-04) | Ops/Security | P2 | SRE |
| Backups fall back to plaintext without key (OPS-F-05) | Ops | P2 | SRE + DBA |
| Levelling blocks the request 8.8–18.7 s (PPM-F4); offline edit without base overwrites (PPM-F3) | PPM | P2 | PMO + platform |
| Audit chain head not anchored (AUD-2); one super_admin can switch on anything (AUD-4) | Audit | P2 | Risk owner |
| English refusal texts on the field app (UX-F-4) | UX | P3 | Product |

## Per-lot recommendation (AI panel recommendation, not a decision)

| Lot | Recommendation | Main condition |
|---|---|---|
| L01 daily work | CONDITIONAL | NO-GO for `commitments_enabled` / `mywork_awaiting_me_enabled` until AUD-1 fix merged |
| L02, L06, L07 | CONDITIONAL | Security F1 fixed (done); PPM/field fixes verified in round 2 |
| L03 | CONDITIONAL | Access-policy owner accepts or moves `portfolio_editor_plan_writes` (widens access) |
| L04, L08 | GO PILOT (security seat) / CONDITIONAL (PPM seat) | Round-2 confirmation |
| L05 time, money, benefits | **NO-GO** | Finance gate G14 + a named verifier; EVM certification |
| L09 KPI trust | CONDITIONAL | KPI committee decisions D-01..D-03 |
| L10, L11, L12, L13 | CONDITIONAL | Field fix verified (L11); RPO/RTO + capacity gates (L13) |

## Human gates still empty
All 21 RELEASE-GATES rows. Critical path for a two-site pilot (from the gate dossiers): G19 QA/CI → G01 access policy →
G03 CAB → G02 threat model + secret rotation → G05 backup/restore → G12 data owner → G11 pilot sites + field
acceptance → G21 business witness project. Plus: pentest rules of engagement, Finance G14, KPI definitions G-12.
