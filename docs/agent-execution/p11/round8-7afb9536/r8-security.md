# P11 qualification — Security seat — ROUND 8 (re-check)

**AI review — not an independent human review.** Reviewer seat: security. I did not write this code and did not modify it. No push, merge, tag, live system or human decision field was touched. Nothing here approves, signs or declares anything production-ready.

- Frozen SHA: `7afb9536ae3e38273aeff47307a78c49637dbd94` (clone `/home/user/qual/security`, `git rev-parse HEAD` checked; only the intentionally removed `docs/agent-execution/` narratives differ — not read). Fixes reviewed: `git log 7ea49070..7afb9536` (fixes 30–33 + `ade91139` PBKDF2 helper move). Security-relevant code read: `4cdc0778` (fix 31: `services/policyRanges.js`, `services/reportConfig.js:840-883` `canonicalValue`/`canonicalPatch`, `services/fourEyesGuard.js:33`, `services/policyCatalogue.js:197-243`, the four readers), `ade91139` (`services/passwordWorkFactor.js`, `reports-db.js:320-333`), `4320dbd6` (fix 33: `services/operatorTokens.js`, `routes/policyCenter.js:170-205`), `5709afbc` (fix 30, R7-2 demand sharing flag: `routes/governancePortfolioPhase2.js:121-158`), `fcc4d77c` (fix 32: `inspection-db.js` `_upsertActionsPg` `removed_action_ids`).
- Earlier rounds unchanged: `security.md`, `r2-`…`r7-security.md`.
- Raw logs: `/home/user/qual/out/sec-logs/r8-outcomes.log`, `r8-batch.log`, `r8-tools.log`, `r8-probe.log`, `r8-probe2.log`, `r8-journal.log`. Throwaway probes (copied into the clone's `tests/` only for the run, deleted right after, never committed; `git status` shows nothing but the removed narratives): `/tmp/claude-0/p11attack-r8/tests/r8-probe.test.js`, `/tmp/claude-0/p11attack-r8/tests/r8-journal.test.js`.
- Env: shared PostgreSQL 16/main on 5432, `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `SDP_TEST_RUN_ID=securityr8`, node_modules symlinked. After the runs `SELECT datname FROM pg_database WHERE datname LIKE '%securityr8%'` → 0 rows (harness dropped its own per-file DBs; I dropped nothing by hand).

## 0. Round-7 findings — fixed or not (repros re-run at 7afb9536)

| R7 item | Trunk claim | Re-test (r8-probe R8-1) | Verdict |
|---|---|---|---|
| **N-R7-1 (P2)** numeric four-eyes key: "stricter-looking" out-of-range value applied by one super_admin, reader falls back to weak default | fix 31: one range table (`services/policyRanges.js`) read by readers, generic write path, Policy Center validate/import and catalogue; `needsSecondPerson` fails closed out of range | center on, super1 alone, `PUT /api/policy-center/rules/<key>`: pbkdf2 `10000000`, `5000001`, `700000.5`, `6e5`, `0x0AAE60`, JSON `1e7` → **400 VALIDATION, stored 600000 unchanged**; throttle_max `0`, `-5`, `1e1`, `2.5`, `''` → **400**, stays 3; window `1441`/`0`/`99999` → 400; breakglass `4`/`1`/`0.5` → 400; emergency `0`/`0.5`/`25` → 400. In-range stricter values (` 700000 `, `+700000`, `700000.0`, `0700000`, `5000000`, throttle `1`, window `1440`, breakglass `5`, emergency `1`) → 200 applied and stored canonical (`700000`). Generic `PUT /api/reports/config` center on: `10000000`/`700000.5`/`6e5` → 400; `700000` → 409 (legacy door, any change refused); center off: throttle `10000000`/`0` → 400. Import dry run: the three out-of-range rows → `invalid`, `emergency 12` → `four_eyes`. Mixed patch (valid `throttle 2` + invalid pbkdf2) → 400, **nothing written** (atomic). | **FIXED** |
| P3 — fix-26 side effect: a blank switch refuses the whole admin form | fix 31: `''` switch = "not sent" | `r8-journal`: `{ui_i18n_pages:'', export_policy_strict:'  '}` → 200, both stay `1`, center on and off; garbage still 400 (unit suite `report-config-switch-canonical` green) | **FIXED** |
| P3 — HD-S04 text stale | fix 31 updated the AI text | `docs/business-readiness/REGISTRE-DECISIONS-HUMAINES.md:93` now says fix 26 merged, N-R7-1 handled by fix 31 (to re-verify — done above) | **FIXED** (text only; decision columns still blank) |
| R1-F2 extension (2 new `KNOWN_OUTCOME_MONEY` patterns) presented as "not a separate decision" | fix 31: comment rewritten as an AI classification that extends the pending R1-F2 decision, to be put to Finance + InfoSec | `tests/_rbac-matrix-core.js:505-510` | **FIXED as wording**; the underlying R1-F2 (P1 policy) remains **NOT FIXED — human decision** |
| P3 — CLIs with a DB URL write `report_config` outside the guard | — | unchanged (`tools/governance/apply-values.js`); now also note that `canonicalValue` refuses out-of-range values on *any* path that goes through `setConfig` | PARTIAL / accepted limitation (unchanged) |
| R1-F3 (P2) dash key injected / scope open | — | `services/reportConfig.js:609` `dashkey_scope_mode:'open'`, `ui_inject_dash_key:'1'` | NOT FIXED (HD-S05 / D-15 blank) |
| R1-F4 (P2) CSP strict on few pages | — | `STRICT_PAGES` still 6 (`services/sessionAuth.js:23`) | NOT FIXED |
| R1-F5 (P2) money sentinels partial | — | `MONEY_SENTINELS` 12 (`tests/_rbac-matrix-core.js:497`), unchanged; abbreviated renderings ("0.54M") still unmatched | PARTIAL (unchanged) |
| `GET /policy-center.html` shell to admin | — | not re-tested (unchanged) | cosmetic, open |

## 1. Evidence re-run at 7afb9536 (command · result)

Prefix: `SDP_TEST_RUN_ID=securityr8 PG_ADMIN_URL=… NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | `tests/authz-outcomes.smoke.test.js` + `tests/authz-outcomes-lots-on.smoke.test.js` | **10/10 pass**, 0 skip, 7 m 14 s, exit 0 | VERIFIED |
| E2 | authz-handler-checks, authz-matrix-json, authz-route-matrix, csp-candidate-pages.smoke, csp-headers.smoke, csp-journey-report, csp-no-inline-handlers-new-pages, csp-report.smoke, csp-strict-pages-config, rbac-external-writes, rbac-matrix.smoke, rbac-mutation.smoke, rbac-scope-frozen.smoke, rbac-ui-gates, rbac-write-scope.smoke, secret-scan, session-security.smoke + four-eyes-guard, p11-r6-security.smoke, **p11-r7-security.smoke**, **p11-r7-audit-ops**, report-config-switch-canonical, approver-provenance, policy-center-control-switches, policy-center-four-eyes-bypass.smoke, policy-center-four-eyes-direction, policy-center-routes.smoke, policy-center-catalogue, access-revocation.smoke, activate-switches, activate-switches-r6-impersonation.smoke, audit-chain-r6, audit-chain (33 files, one run) | **193/193 pass**, 0 skip, 4 m 18 s, exit 0 (route×role invariant: 280 routes, 3000 deny probes, 103 allow probes) | VERIFIED |
| E3 | `node tools/security/secret-scan.js --check` | "no credential in the tracked files", exit 0 | VERIFIED |
| E4 | `node tools/security/csp-journey-report.js --check` | up to date, exit 0 | VERIFIED |
| E5 | `node tools/security/retention-inventory.js --check` | up to date, exit 0 | VERIFIED |
| E6 | `node tools/agent/policy-catalogue.js --check` (range drift check added by fix 31) | OK — 353 catalogued, 3 excluded, exit 0 | VERIFIED |
| E7 | `npm audit --omit=dev` | found 0 vulnerabilities (registry state 2026-11-21) | VERIFIED |
| E8 | R7 repro + R8 attacks: `r8-probe` (3 tests, run twice — second time with `SDP_CONFIG_KEY` set) + `r8-journal` (1 test) | executed, exit 0 (findings are in logged values) | VERIFIED |
| E9 | `tools/security/authz-divergence-report.js`, `dashkey-consumers.js` | not run (need `PG_URL` in `.env` / no `--check`) | NOT VERIFIED |
| E10 | SSO/Entra, dashkey-only-routes, export-share-boundary, route-authz suites (not assigned) | not run | NOT VERIFIED |

**8 verified, 2 not verified.** No full suite (not assigned).

## 2. Break attempts at this SHA (one per capability, preferring code changed by fixes 30–33)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Numeric four-eyes ranges (fix 31) | "the readers, the write path and the catalogue share one table; an out-of-range value is never stored" | 40+ encodings (exponent, hex, decimals, signs, blanks, JSON numbers) on center PUT, generic PUT center on/off, import dry run, mixed patch; reader-by-reader comparison of parsing (`passwordWorkFactor.pbkdf2Target`, `accountThrottle.settings`, `breakglassGuard.minutesFrom`, `emergencyAccess.maxHours`) | **holds** — every value the writer accepts is one the reader honours as-is; every value outside is 400. The writer is stricter than the readers (refuses `1e3` that a reader would read as 1000) — fail closed. |
| Stale out-of-range value already in the DB (old release / CLI) | needsSecondPerson fails closed | stored `throttle_max='0'` (effective 10) then super1 alone → `1000`/`10`/`5` → **202 pending** (fail closed, even for the effectively stricter `5`); stored pbkdf2 `50000` → `100000` applied (effective unchanged), `99999` → 400 | holds (no single-person weakening; over-cautious on `5`, availability only) |
| Approval of a pending request whose value is now out of range (upgrade path of fix 31) | approval re-validates against today's rules | pending request `auth_pbkdf2_iterations 100000→10000000` (simulating one filed before fix 31) approved by super2 | **refused (400), value unchanged — but the request row is left `approved`** → **N-R8-1** (P3) |
| Blank switch "= not sent" (fix 31) vs audit journal | the journal records only real changes | blank four-eyes / non-four-eyes switches, `true` / `'10.0'` re-sends of unchanged values, center on and off; control = a real change | holds — 0 journal rows for blank/unchanged, 1 row for the control (hypothesis "journal records a fake change" refuted) |
| Operator tokens bound by HMAC (fix 33) | "a row INSERTed with the application DB login has no valid binding and is refused; the HMAC key outside the DB is the control" | without `SDP_CONFIG_KEY`: issue → 409 fail closed. With key: own token checks ok; row moved to another account (`user_id` swap) → refused; expiry extended by 1 day → refused; forged row with DB only → refused; forged with DB **and** key, no event → refused; forged with DB + key + inserted `operator_token_issued` event → **accepted as super2** | holds as designed for DB-only; DB+key forging confirmed (ADR residual). See §4 — key and DB URL live in the same `.env` the CLI must read |
| Money / scope outcomes Lots 1–6 | no amount sentinel to a non-reader, lots on or off | E1 re-run | holds (committee exception = R1-F2, 4 patterns) |
| PPM demand sharing flag (fix 30 R7-2) | a partial reader learns nothing about unreadable projects | read `routes/governancePortfolioPhase2.js:130-157` | holds for name/id/figure/cell; residual 1 bit: a partial reader sees `view_partial` only when *some* other project carries demand anywhere (vacuous `fullRead` when none) — observation, not a finding |
| Inspection id-less merge (fix 32) | `removed_action_ids` deletes only rows the form names | read `inspection-db.js` `_upsertActionsPg`: the set is only consulted against `rows` of the inspection being saved, after the site/RBAC check of the save | holds by reading (no cross-inspection delete) |
| PBKDF2 helper move (`ade91139`) | behaviour unchanged | read `reports-db.js:320-333`, session/login suites green in E2 | holds |

## 3. Findings (round 8)

### P0 — none.

### P1 — none open in code. R1-F2 stays a **policy** blocker (human decision, Finance + InfoSec), now explicitly including the CR-impact and money-document routes.

### P2 — no new P2. Carried: R1-F3, R1-F4, R1-F5 (partial).

### P3

**N-R8-1 (P3) — Policy Center: an approval whose apply step fails leaves the request recorded as `approved` with nothing applied and no `policy_change_approved` journal row (claim-then-apply).**
- Where: `services/policyChangeStore.js:57-62` claims the row (`status='approved'`) and only then calls `apply`; `routes/policyCenter.js:198-203` `apply` re-validates with `PC.validateConfigValue` (now range-aware since fix 31) and throws 400 — after the claim. The journal line at `routes/policyCenter.js:204` is never reached.
- Repro (`r8-probe` R8-2b): `policy_center_enabled='1'`; create through `makePolicyChangeStore(...).create` a request `auth_pbkdf2_iterations 100000→10000000` by super1 (simulates a request filed before fix 31, or any value later made invalid); super2 `POST /api/policy-center/requests/pc-2/approve {"reason":"approve legacy request"}` → **400** "maximum 5000000", stored value stays `100000`, `SELECT status FROM policy_change_requests WHERE id=2` → **`approved`**.
- Impact: no weakening (the value is not applied); the request register is untruthful (an "approved" change that never happened, no journal row) and the key is no longer blocked by a pending request. Reachable on upgrade only if a pending out-of-range request exists, or on any other apply failure (outbound URL validation, DB error).
- Regression test: approve a request whose `new_value` fails today's validation → expect 400 AND status still `pending` (or a dedicated `failed`) and a journal row of the refusal.
- Fix direction (not applied): validate `new_value` before the claim, or claim + apply in one transaction / revert the claim on apply failure. Rollback risk low.

**N-R8-2 (P3, documentation/claim) — the operator-token "control" equals read access to `.env`.** `services/operatorTokens.js:9-12` says "the HMAC key held outside the database is the control". `tools/ops/activate-switches.js:3` loads the app `.env`, which holds both `PG_URL` and `SDP_CONFIG_KEY`; whoever can run the CLI on the server can therefore forge a bound token plus its issuance event (proven in R8-3). The ADR states this residual (`docs/ai-decisions/ADR-P11-R7-anchor-kid-token-binding.md:58`); the service comment and any HD-S04 summary should say it too, and InfoSec should decide whether `SDP_CONFIG_KEY` must live outside the CLI operator's reach (e.g. separate service account / secret store).

Other P3 carried: CLIs with a DB URL write `report_config` outside the guard (accepted); `GET /policy-center.html` shell to admin (cosmetic); R1-F7, F8 (not re-tested).

## 4. Optimistic claims challenged
- "Fix 31: numeric four-eyes keys bound to one range table" — **confirmed** by 40+ encodings on three write doors plus stale-DB cases; the unit test `p11-r7-security.smoke` also pins writer = reader = catalogue.
- "A four-eyes change that weakens a control always needs a second person" — now true for every catalogued four-eyes key I could exercise through the app; still false for an operator holding DB credentials (by construction).
- "Operator tokens: a row written directly into the database is refused" — true only for someone with the DB login but **not** the `.env` key; on the real server the CLI operator holds both (N-R8-2).
- "Approving re-validates against today's rules" — it re-validates, but after recording the approval (N-R8-1).
- R1-F2 wording is now honest (pending decision) — the decision itself is still absent.

## 5. Per P03 lot — AI panel recommendation, not a decision

| Lot | Recommendation |
|---|---|
| L01 Daily work | GO PILOT |
| L02 Portfolio reading | CONDITIONAL — R1-F2 decided by Finance/InfoSec, including the CR-impact and money-document routes |
| L03 Change control | GO PILOT |
| L04 Scheduling/collab | GO PILOT |
| L05 Time, money, benefits | CONDITIONAL (pilot plan already NO-GO) — R1-F2 + R1-F5 (partial) |
| L06 Plan exchange | CONDITIONAL — not reviewed in depth by this seat |
| L07 Roadmap publication | CONDITIONAL — one executed roadmap-share test with amounts seeded |
| L08 Governance cadence | GO PILOT |
| L09 KPI trust | GO PILOT |
| L10 Reporting rhythm | GO PILOT |
| L11 Site ops evidence | CONDITIONAL — R1-F5 sentinels for certified asset money |
| L12 Access hardening | CONDITIONAL — N-R7-1 fixed; still needs break-glass drill evidence + InfoSec gate (rows 8/9/25) |
| L13 Ops resilience / identity (incl. `policy_center_enabled`) | CONDITIONAL → **GO PILOT on TEST from this seat** for the double control (N-R6-1, N-R7-1 fixed; N-R8-1 is register hygiene); production reliance waits for HD-S04 (human), R1-F3 / HD-S05 / D-15 and an InfoSec decision on N-R8-2 |
| L14 Portfolio intake register | CONDITIONAL — tied to L02/L05 money decision |
| L15 Adoption Lot B | GO PILOT (lots-on probe green) |
| L16 Portfolio phase 2 (Lot 6) | GO PILOT from this seat; malware scanning of documents remains an open operator decision |
| Portfolio Lots 2–5 switches | GO PILOT |

## 6. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md`, rows verified empty at 7afb9536)
- Row 8 — Security: access policy CG-01/CG-02, authz matrix (G-03…G-08) — Information Security
- Row 9 — Security: threat model and findings register (G27) — Information Security
- Row 10 — CAB: dependency release D-11 / PostgreSQL-only cutover PO-08
- Row 11 — Signing key and CI action SHAs D-12 (G-09) — Information Security + CI owner
- Row 20 — Connectors D-07/D-08/D-09, dash-key clients D-15 — platform owners (R1-F3, HD-S05)
- Row 21 — Finance: budgets and benefits (G14) — Finance (R1-F2)
- Row 24 — Production deployment GO/NO-GO — CAB
- Row 25 — Penetration test / accepted analysis (E-B05, X-B-03) — Information Security
- Business-readiness register rows in this area, decision columns still blank: HD-S04 (Policy Center double control), HD-S05 (dash key), HD-S09 (hash cost), HD-G13.

No approval, signature or production readiness is claimed or implied by this file.
