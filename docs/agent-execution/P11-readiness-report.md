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

---

# Round 2 — frozen SHA `b2e85cd08860a57526442797ac711e2fc9defc3a` (CI run 363 green)

> AI panel report — not an independent human review, not a decision. Seat reports: `docs/agent-execution/p11/round2-b2e85cd0/`.

## Round-1 P1 re-verification (original repros re-run)

| ID | Round-2 verdict |
|---|---|
| SEC-F1 group-run share/read | FIXED |
| SEC-F2 committee money | NOT FIXED — **human policy decision** (Finance + InfoSec) |
| DATA-F-01 CSAT 0 % when unmeasured | FIXED |
| OPS-F-01 survey truncation · OPS-F-03 assets partial view | FIXED |
| OPS-F-02 manager probe on /ready | FIXED (PowerShell side read only, no pwsh) |
| PPM-F1 extreme task value | FIXED |
| PPM-F2 EVM actual cost | PARTIAL → residual R2-1 (deleted tasks) fixed after round 2 (fix 7) |
| UX-F-1 field overwrite | PARTIAL → residual F-6 (same-author replay) fixed after round 2 (fix 8) |
| AUD-1 commitment four-eyes | PARTIAL → residual NEW-1 (owner re-pointing before submission) **fix 9 in progress** |

## New round-2 findings: P0 = 0, P1 = 4

| ID | Finding | Status |
|---|---|---|
| OPS-N-01 (P1) | Requests sync deletes tickets for good when an export is short by < 20 % | **fix 6 in progress** (with N-02 ratchet, N-03 /ready on read-only DB, SEC-R2-N1 report subscriptions) |
| PPM-R2-1 (P1, L05 only) | Deleting a task drops its logged hours from EVM AC | **Fixed** (fix 7: 409 HAS_ACTUALS on hard delete; soft-deleted tasks' hours kept) + R2-2 rebaseline bounds / constant-time EVM |
| UX-F-5 (P1) | Field app stores demand/ticket/lowercase cancelled on inspection actions → wrong overdue counts | **Fixed** (fix 8) — human step: run `node tools/field/inspection-action-status-check.js` on the live DB, owners close/cancel listed rows |
| AUD-NEW-1 (P1, behind `commitments_enabled`) | Former owner can still verify (re-point before submission) | **fix 9 in progress** |

Remaining P2/P3 (not fixed, carried to the residual-risk register): SEC-F3/F4/F5, DATA-F-02..F-05, F-10..F-13, OPS-F-04/F-05/N-04/N-05,
PPM F3–F6/R2-4/R2-5, AUD-2/AUD-4/AUD-5..9 + describe.skip gap, UX-F-4 remainder (meetings justification text), UX A4.

## Round-2 per-lot recommendation (AI panel recommendation, not a decision)
| Lot | Recommendation |
|---|---|
| Today's portfolio (default switches), L02, L09 UX side, L11 (ops side) | GO PILOT |
| L01 | CONDITIONAL — NO-GO for `commitments_enabled` / `mywork_awaiting_me_enabled` until fix 9 merged and verified |
| L03, L04, L06, L07, L08, L10, L12, L13 | CONDITIONAL |
| L05 time, money, benefits | **NO-GO** until Finance gate G14 + SEC-F2 decision |
| Group IT deck | CONDITIONAL (was NO-GO in round 1) |

All 21 RELEASE-GATES rows remain empty; `flag-decisions.json` has 0 entries. Round 3 runs once fixes 6 and 9 are merged and CI is green.

---

# Round 3 — frozen SHA `ead6efb6439296a34915b7d9a47f7011cd15fa82` (CI run 370 green)

> AI panel report — not an independent human review, not a decision. Seat reports: `docs/agent-execution/p11/round3-ead6efb6/`.

**Result: P0 = 0 and P1 = 0 open in code across all six seats.** All round-1 and round-2 P1 code findings are confirmed
FIXED with their original repros. The only open P1 is the **policy decision SEC-F2** (committee members read portfolio amounts).

| Seat | P0 | P1 | New P2 | Evidence |
|---|---|---|---|---|
| Security | 0 | 0 (+F2 policy) | N-R3-1 look-alike names bypass four-eyes | 7 verified / 2 not |
| Data/KPI | 0 | 0 | F-14 alternating partial exports still ratchet | 6 / 1 partial / 1 not |
| PPM | 0 | 0 | R3-1 impossible rebaseline dates; R3-2 AC lost on task move / project soft delete; R3-3 offline dependency overwrite | 5 / 0 failing |
| Operations | 0 | 0 | N-02r guard ratchet (same as F-14); N-06 /ready drains the pool; N-08 freshness ignores dead jobs | 5 / 2 not |
| UX/field | 0 | 0 | — (F-9 P3, P2 if field techs are viewer-tier) | 2 / 0 (42 journeys, 170 unit) |
| Audit | 0 | 0 | R3-A1 6 append-only tables not hardened; R3-A2 default-ON switches ungoverned | 6 / 3 not |

P2/P3 fixes in progress after round 3: fix 10 (sync guard F-14/N-02r, reconcile tool, migrator re-run, deck fallback),
fix 11 (identity normalisation, audit grants, default-ON switch governance, small security/field items), fix 12 (PPM dates,
AC on move/delete, offline compare, frozen timesheets), fix 13 (/ready timeout, freshness SLI, backup file selection,
/health disclosure, plaintext backup refusal).

## Round-3 per-lot recommendation (AI panel recommendation, not a decision)
| Lot | Recommendation |
|---|---|
| Default switches, L01, L02, L03, L04, L09, L10, field outbox | GO PILOT (seat-level; L03: fix R3-1 before general deployment) |
| L05 time, money, benefits | CONDITIONAL (was NO-GO): Finance gate G14 signed + R3-2 fixed or accepted + SEC-F2 decision |
| L06, L07, L08, L11, L12, L13 | CONDITIONAL |

**P11 stop condition (prompt pack step 5):** no P0/P1 left in code at the frozen SHA. The run ends when the human release
committee has this report; it does not end with a release. All 21 RELEASE-GATES rows remain empty.

## Round 4 — frozen SHA e43d11d5 (2026-11-20) — AI panel, not an independent human review

Six AI seats, clean clones without docs/agent-execution narratives (gate dossiers copied back). Seat reports:
`docs/agent-execution/p11/round4-e43d11d5/r4-<seat>.md`.

| Seat | P0 | P1 | New P2 | Round-3 items re-tested |
|---|---|---|---|---|
| security | 0 | 0 (R1-F2 remains a policy decision) | N-R4-1 Policy Center four-eyes bypass; N-R4-2 center reads open to admin | N-R3-1, N-R3-3, R2-N2 fixed; R2-N3 partial |
| data-kpi | 0 | 0 | F-16 site SLA % ≠ ranking rule (Lot A, ships ON); F-02/F-05 partial | F-14, F-03, F-10, F-04 fixed |
| ppm | 0 | 0 | R4-1 budget-period actuals lost on delete/purge | R3-1..R3-4, R1-F3 fixed |
| operations | 0 | 1 — N-10 Policy Center catalogue not shipped in packages (four-eyes keys drop to 0) | N-09 freshness SLI ignores failures before first success | all 6 fixed |
| ux-field | 0 | 0 | F-10 conditional (field-tech reopens meetings action) | F-8 fixed; F-9, R2-N3 inspection-only; F-4 partial |
| audit | 0 | 1 — R4-A2 Policy Center four-eyes bypass (legacy config PUT, self-made second super_admin, reset to weak default) | R4-A1 app role can DROP ledgers; R4-A4 activate-switches without `--lots` arms all | R3-A1 fixed; R3-A2 partial |

Both P1s concern the Policy Control Center, which is **off by default** (`policy_center_enabled='0'`); neither
affects a live path today. The panel's AI recommendation is **NO-GO for turning the center on** until they are fixed.

Corrections in progress (branches, not yet merged): fix 14 (security + N-10 + R4-A2), fix 15 (PPM), fix 16
(data/KPI), fix 17 (operations + R4-A1/A3/A4), fix 18 (field/UX). Human gates: all 21 RELEASE-GATES rows remain
empty; nothing in this report is an approval.
