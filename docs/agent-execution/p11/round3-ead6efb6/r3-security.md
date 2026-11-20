# P11 qualification — Security seat — ROUND 3

**AI review — not an independent human review.** Reviewer seat: security. I did not write this code and did not modify it.

- Frozen SHA: `ead6efb6439296a34915b7d9a47f7011cd15fa82` (clone `/home/user/qual/security`, `git rev-parse HEAD` checked; only the intentionally removed `docs/agent-execution/` narratives differ, not read).
- Previous rounds (unchanged): `/home/user/qual/out/security.md` (R1), `/home/user/qual/out/r2-security.md` (R2 at b2e85cd).
- Raw logs: `/home/user/qual/out/sec-logs/r3-outcomes.log`, `r3-batch.log`, `r3-probe.log`; throwaway probe copy `r3-probe.test.js.txt` (run from `/tmp/claude-0/p11attack-r3/tests/`, never committed).
- Env: shared PG (max_connections 400), `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, node_modules symlinked from `/home/user/SDP360`.

## 0. Round-2 findings — fixed or not (round-2 repro re-run at ead6efb)

| R2 | Trunk claim | Re-test (r3-probe tests 1–4) | Verdict |
|---|---|---|---|
| **R2-N1 (P2)** subscriptions bypass site scope + audience | fixed by `a01ba61` (`services/reportVisibility.js`, `routes/engagement.js:56-64`, `services/engagementJobs.js:113-133`, `routes/reportStudio.js:155`) + `tests/report-subscription-scope.smoke.test.js` | Round-2 calls verbatim: site-A viewer subscribe site template **200**, executive template **403** (was 200). Draft job: 12 runs, notified 0, withheld 11 → viewer 0 notifications (was 12). Published job: viewer gets exactly 1 (`r3 site — Hounde`), no MANA, no exec. Extra: multi-site viewer (A + extra B) gets A and B; viewer moved A→B after subscribing gets **B only** (current scope); deactivated subscriber gets nothing, its session → 401 | **FIXED** |
| R2-N2 (P3) pre-fix editor share link revives on promotion | not claimed | pre-fix editor link → 404; editor promoted to admin → **200** | **NOT FIXED** (unchanged, P3) |
| R2-N3 (P3) field 409 discloses existence + status of another site's inspection id | not claimed (F-6 replay fix `fcf0fab` touched the same block, `routes/field.js:165-172`) | site-A field-tech sends own-site meta with a MANA inspection id → **409** body `"… already exists on the server (submitted) …"` + `detail.status`; foreign row untouched (`submitted`, `MGO`); fresh id → 200 applied | **NOT FIXED** (write still refused; oracle remains, P3) |
| R1-F2 (P1 policy) committee-member reads portfolio amounts | not claimed | outcome probe still passes with the `KNOWN_OUTCOME_MONEY` committee exception (`tests/_rbac-matrix-core.js:480`) | **NOT FIXED — human decision pending** (Finance + InfoSec) |
| R1-F3 (P2) dash key injected / scope open | not claimed | `services/reportConfig.js:532` `dashkey_scope_mode:'open'`, `ui_inject_dash_key:'1'` | **NOT FIXED** (D-15) |
| R1-F4 (P2) CSP strict only on 2 built-in pages | not claimed | `services/sessionAuth.js:23` unchanged | **NOT FIXED** |
| R1-F5 (P2) money sentinels partial | not claimed | `MONEY_SENTINELS` unchanged (`tests/_rbac-matrix-core.js:476`); EVM/actuals code changed again (`24e0092`, `27782ab`) with no new sentinel | **NOT FIXED** |
| R1-F7, F8 (P3) | — | not re-tested | open |

## 1. Evidence re-run at ead6efb (command · result)

Prefix: `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | `tests/authz-outcomes.smoke.test.js` | **5/5 pass**, 321 s, exit 0 (log shows hostile-input 500s, see N-R3-3) | VERIFIED |
| E2 | authz-matrix-json, authz-route-matrix, authz-handler-checks, rbac-external-writes, rbac-matrix.smoke, rbac-mutation.smoke, rbac-scope-frozen.smoke, rbac-ui-gates, rbac-write-scope.smoke, csp-candidate-pages.smoke, csp-headers.smoke, csp-journey-report, csp-no-inline-handlers-new-pages, csp-report.smoke, csp-strict-pages-config, session-security.smoke, secret-scan, report-run-group-share.smoke, report-subscription-scope.smoke (19 files, one run) | **109/109 pass**, 0 skip, 148 s, exit 0 | VERIFIED |
| E3 | `node tools/security/secret-scan.js --check` | "no credential in the tracked files", exit 0 | VERIFIED |
| E4 | `node tools/security/csp-journey-report.js --check` | up to date, exit 0 | VERIFIED |
| E5 | `node tools/security/retention-inventory.js --check` | up to date, exit 0 | VERIFIED |
| E6 | `npm audit --omit=dev` | found 0 vulnerabilities (registry-dependent, run 2026-11-20) | VERIFIED |
| E7 | R2 repros + new probes (§2), 6 tests | executed, exit 0 | VERIFIED |
| E8 | `authz-divergence-report.js`, `dashkey-consumers.js` (no `--check`) | not run | NOT VERIFIED |
| E9 | access-revocation, dashkey-only-routes, export-share-boundary, SSO/Entra, route-authz suites (not assigned) | not run | NOT VERIFIED |

**7 verified, 2 not verified.** No full suite (not assigned).

## 2. New claims I tried to break (none repeat a round-2 attack)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Notifications / site scope | "every notification re-checks the run against the subscriber's CURRENT roles and sites" (`a01ba61`) | subscribe, then move the user to another site / deactivate / give an extra site; run published job | holds: moved → new site only, deactivated → none, extra site → both |
| Session revocation | deactivated account loses access | reuse the deactivated user's existing token | 401 on `/auth/me` and notifications — holds |
| Notifications IDOR | read/unsubscribe scoped to the session user | mark another user's notification id read; DELETE a subscription id not owned | `marked:0`; victim's subscriptions unchanged — holds (200 no-op, no oracle) |
| Health | `/ready` read-only check (`188d965`) leaks nothing | anonymous GET `/ready` | `{ok,db,last_job_at}` only — holds |
| Separation of duties (commitments) | "no past owner/executor/creator/submitter verifies" (`8253c5e`, NEW-1) | owner field set to a visually identical identity: `alice​` (zero-width space), `alіce` (Cyrillic i), `Alice  A` (double space) against reviewer `alice` | **BROKEN** — `isSelf` false, `checkTransition(verified_closed)` ok → N-R3-1 |
| Field write path | F-6 "full-state replay check" never rewrites | foreign-site id with own-site meta (R2-N3 shape) | write refused (holds); oracle remains (R2-N3) |

## 3. Findings (round 3)

### P0 — none.

### P1 — none open in code. R1-F2 stays a **policy** blocker (human decision).

### P2

**N-R3-1 (P2) — Four-eyes on commitments can be bypassed with a look-alike owner identity.**
- Where: `services/commitmentLifecycle.js:49-52` `_s()` = `trim().toLowerCase()` only; `isSelf` compares free-text owner/executor/creator strings to the actor's username / full name / e-mail / id. `services/commitmentStore.js:92-94` records `{from,to}` of an owner change but **not the actor** who made it. `accountable_owner` is free text (`EDITABLE`, `commitmentStore.js:21,127`).
- Attack: an admin (or the site's role reviewer) Alice edits a commitment owned by Bob and sets `accountable_owner = "alice​"` (renders as "alice"); she does the work; Bob (or any editor) submits; Alice verifies → allowed. Same with homoglyphs or an extra inner space in the full name.
- Evidence: pure-function run (r3-probe test 6) — owners `alice`, ` ALICE `, `alice `, `alice@x` → refused; `alice​`, `alіce`, `Alice  A` → **verify allowed**. Route-level path established by code reading (historyOf), not executed end-to-end → partial verification.
- Why P2: needs an insider holding verify rights; the event log keeps the edit (detectable afterwards). Raises to P1 if verified commitments feed a certified KPI or a compliance claim at pilot.
- Regression test to add: owner/executor values with zero-width chars, NFKC-confusables, collapsed whitespace must count as the actor; an actor who re-pointed owner/executors to a non-matching value is excluded from verifying.
- Fix direction (not applied): NFKC-normalise + strip `\p{Cf}` + collapse whitespace in `_s`; validate owner against the user directory (`commitmentOwner.ownerAccount` already exists) and refuse unresolved names for high/critical; add the editing actor to `history.owners` when they change owner/executors. Rollback risk low (narrows).

Carried P2: R1-F3, R1-F4, R1-F5 (unchanged).

### P3
- **R2-N2** (carried) share links re-check the creator's current roles — revoke non-admin `report_run` links on site-less runs once at deploy.
- **R2-N3** (carried) field 409 reveals existence + status of any inspection id across sites — answer without status, or 403 when out of scope.
- **N-R3-3** hostile path params give 500 instead of 400 on `GET /api/reports/monthly/:site/:y/:m` (`Invalid time value`) and `/edits` (`invalid input syntax for type integer: "NaN"`), plus `GET /api/reports/weekly-summary/…/pptx` (22P02) — seen in `r3-outcomes.log`. Bodies do not expose the stack (`services/httpError.js:79-89`); robustness, not a leak.
- R1-F7, F8 still open.

## 4. Optimistic claims challenged
- "R2-N1 fixed" — **confirmed**, including subscriptions written before the fix and users whose scope changed.
- "Four-eyes over the whole history" (NEW-1) — true for exact identities; identity matching is not normalised (N-R3-1).
- "authz-outcomes green" — still seed-dependent; no scenario for commitments verification with spoofed names, nor for hostile path params returning 400.

## 5. Per P03 lot — AI panel recommendation, not a decision

| Lot | Recommendation |
|---|---|
| L01 Daily work | GO PILOT |
| L02 Portfolio reading | CONDITIONAL — R1-F2 decided by Finance/InfoSec and recorded |
| L03 Change control | GO PILOT |
| L04 Scheduling/collab | GO PILOT |
| L05 Time, money, benefits | CONDITIONAL — R1-F2 decided + R1-F5 sentinels (finance actuals, EVM) |
| L06 Plan exchange | CONDITIONAL — not reviewed in depth by this seat |
| L07 Roadmap publication | CONDITIONAL — one executed roadmap-share test with amounts seeded |
| L08 Governance cadence | CONDITIONAL — N-R3-1 fixed, or verification of commitments not used as compliance evidence during the pilot |
| L09 KPI trust | GO PILOT |
| L10 Reporting rhythm | GO PILOT (R2-N1 fixed) — revoke pre-fix share links at deploy (R2-N2) |
| L11 Site ops evidence | CONDITIONAL — R1-F5 sentinels for certified asset money |
| L12 Access hardening | CONDITIONAL — break-glass drill evidence + InfoSec gate |
| L13 Ops resilience / identity | CONDITIONAL — pair with R1-F3 / D-15 |

## 6. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md`)
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08) — Information Security
- Security — threat model and findings register (G27) — Information Security
- Signing key and CI action SHAs D-12 (G-09) — Information Security + CI owner
- Connectors D-07/D-08/D-09, dash-key clients D-15 — platform owners (R1-F3)
- Finance — budgets and benefits (G14) — Finance (R1-F2)
- Report authority and channels D-13 (G-13/G-25)
- Penetration test / accepted analysis (E-B05, X-B-03) — Information Security
- QA lead — CI green on target SHA (E-B05); production deployment GO/NO-GO — CAB

No approval, signature or production readiness is claimed or implied by this file.
