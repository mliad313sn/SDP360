# P11 qualification — Security seat — ROUND 7 (re-check)

**AI review — not an independent human review.** Reviewer seat: security. I did not write this code and did not modify it. No push, merge, tag, live system or human decision field was touched. Nothing here approves, signs or declares anything production-ready.

- Frozen SHA: `7ea49070d687679109c3c91ef29a8f744835f10c` (clone `/home/user/qual/security`, `git rev-parse HEAD` checked; only the intentionally removed `docs/agent-execution/` narratives differ — not read). Fixes reviewed: `git log e82d95ba..7ea49070` (fixes 25–29). Security-relevant code read: `3b7687d3` (fix 26: `services/reportConfig.js` `canonicalValue`/`canonicalPatch`, `services/fourEyesGuard.js:30`, `services/ppm/reviewWorkflow.js:77-104`, `services/ppmWorkbench.js:77-84`, `services/governanceStore.js:710-745`, `tests/_rbac-matrix-core.js:239-254,497-508`), `afc07f86` (fix 29: `services/operatorTokens.js`, `routes/policyCenter.js` operator-token route, `tools/ops/activate-switches.js:345-380,560-650`, `services/auditChain.js` anchor signatures), `cf33a2db` (fix 25 run-id sanitiser).
- Earlier rounds unchanged: `security.md`, `r2-`…`r6-security.md`.
- Raw logs: `/home/user/qual/out/sec-logs/r7-outcomes.log`, `r7-batch.log`, `r7-tools.log`, `r7-probe.log`, `r7-cr.log`. Throwaway probes (copied into the clone's `tests/` only for the run, deleted right after, never committed): `/tmp/claude-0/p11attack-r7/tests/r7-probe.test.js`, `/tmp/claude-0/p11attack-r7/tests/r7-cr.test.js`.
- Env: shared PostgreSQL 16/main on 5432, `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `SDP_TEST_RUN_ID=securityr7`, node_modules symlinked. After the runs `SELECT datname FROM pg_database WHERE datname LIKE '%securityr7%'` → 0 rows (harness dropped its own per-file DBs; I dropped nothing by hand).

## 0. Round-6 findings — fixed or not (repros re-run at 7ea49070)

| R6 item | Trunk claim | Re-test | Verdict |
|---|---|---|---|
| **N-R6-1 (P2)** JSON booleans slip past the four-eyes guard on `PUT /api/reports/config` | fix 26: `reportConfig.canonicalValue` is the single mapping; `setConfig` stores it, `fourEyesGuard.blockedKeys` compares it | `r7-probe` R7-1, center on, three strict keys at `'1'`: `true`, `"true"`, `1`, `"on"`, `" YES "`, `"TRUE"` → **200, stored `'1'`** ×3; `false`, `"false"`, `0`, `"off"`, `"no"` → **409 CONFLICT**, stays `'1'`; `""`, `null`, `"maybe"`, `"1 0"`, `[]`, `{}` → **400 VALIDATION**, stays `'1'`. Center off: `true` stored **`"1"`**. `PUT /api/teams-sla/settings {enabled:true}` → 409, stays `0`. | **FIXED** (for the switch class). A new, adjacent hole in the *numeric* four-eyes keys → **N-R7-1** below. Side effect: a blank switch from an admin card (`{hygiene_send_enabled:''}`) is now a 400 (availability, not security) — P3 note. |
| **N-R6-2 (P3)** CR value-bound on budget only | fix 26: `ppm_change_requests.scope_fields` (migration 133), only named fields unlock | `r7-probe` R7-3 (intake off) and `r7-cr` R7-3b (`ppm_intake_register_enabled='1'`, DB row read after every call): budget-only CR + charter → **409 CHANGE_REQUEST_SCOPE**, row unchanged; same CR budget-only → 200; charter-scoped CR + `business_need` → **409**, row unchanged; then charter alone → 200; `budget_reference`-scoped CR + `expected_value` 5000→99 999 999 → **409**, unchanged; scope_fields `currency`/`budget` → **400 BAD_SCOPE**; mixed-case duplicates `"charter, Charter ,expected_value"` → 400 | **FIXED** |
| R6-2 (PPM P3) concurrent CR edits | fix 26: project row `SELECT … FOR UPDATE` | code read `services/governanceStore.js:716`; r6 parallel race repro still 200 + 409 (r6-probe not re-run; covered by `tests/p11-r6-security.smoke.test.js`, green in E2) | FIXED (by reading + suite) |
| **T-R6-1 (P3)** run id with `-` silently ignored | fix 25: sanitised | `require('./tools/test/drop-test-dbs').sanitiseRunId('security-r6')` → `security_r6` | **FIXED** |
| P3 — CLIs write `report_config` without the guard | fix 29: four-eyes steps of `tools/ops/activate-switches.js` only become Policy Center requests filed by the account of a one-time operator token; `--second-operator` refused | code read `tools/ops/activate-switches.js:379,588-599,640-644`; `tests/activate-switches-r6-impersonation.smoke.test.js` green (E2). Other CLIs (`tools/governance/apply-values.js`) still take a DB URL and write directly — an operator holding DB credentials is outside any app control by construction. | PARTIAL (activation path fixed; DB-credential holder unchanged, accepted limitation) |
| R1-F2 (P1 policy) committee reads portfolio amounts | — | `KNOWN_OUTCOME_MONEY` at `tests/_rbac-matrix-core.js:502-508` now has **4** entries (2 added by fix 26: CR `impact_budget` list and money documents list/download) | **NOT FIXED — human decision**; the exception was *widened* by an AI comment ("not a separate decision") — see §4 |
| R1-F3 (P2) dash key injected / scope open | — | `services/reportConfig.js:609` `dashkey_scope_mode:'open'`, `ui_inject_dash_key:'1'` | NOT FIXED (HD-S05 / D-15 blank) |
| R1-F4 (P2) CSP strict on few pages | — | `STRICT_PAGES` still 6 (`services/sessionAuth.js:23`) | NOT FIXED |
| R1-F5 (P2) money sentinels partial | fix 26: sentinels for `budget_reference`, CR `impact_budget`, money document title | `MONEY_SENTINELS` 7 → 12 (`tests/_rbac-matrix-core.js:497`); E1 green in both probes. Document sentinel is only live in the lots-on probe (upload 404 when `ppm_documents_enabled` is off). Abbreviated renderings ("0.54M", "543.2 k") would still not match. | PARTIAL (improved) |
| `GET /policy-center.html` shell to admin | — | not re-tested (unchanged code) | cosmetic, open |

## 1. Evidence re-run at 7ea49070 (command · result)

Prefix: `SDP_TEST_RUN_ID=securityr7 PG_ADMIN_URL=… NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | `tests/authz-outcomes.smoke.test.js` + `tests/authz-outcomes-lots-on.smoke.test.js` | **10/10 pass**, 0 skip, 7 m 34 s, exit 0 | VERIFIED |
| E2 | authz-handler-checks, authz-matrix-json, authz-route-matrix, csp-candidate-pages.smoke, csp-headers.smoke, csp-journey-report, csp-no-inline-handlers-new-pages, csp-report.smoke, csp-strict-pages-config, rbac-external-writes, rbac-matrix.smoke, rbac-mutation.smoke, rbac-scope-frozen.smoke, rbac-ui-gates, rbac-write-scope.smoke, secret-scan, session-security.smoke + four-eyes-guard, p11-r6-security.smoke, report-config-switch-canonical, approver-provenance, policy-center-control-switches, policy-center-four-eyes-bypass.smoke, policy-center-four-eyes-direction, policy-center-routes.smoke, access-revocation.smoke, activate-switches, activate-switches-r6-impersonation.smoke, audit-chain-r6 (29 files, one run) | **162/162 pass**, 0 skip, 4 m 10 s, exit 0 | VERIFIED |
| E3 | `node tools/security/secret-scan.js --check` | "no credential in the tracked files", exit 0 | VERIFIED |
| E4 | `node tools/security/csp-journey-report.js --check` | up to date, exit 0 | VERIFIED |
| E5 | `node tools/security/retention-inventory.js --check` | up to date, exit 0 | VERIFIED |
| E6 | `npm audit --omit=dev` | found 0 vulnerabilities (registry state 2026-11-21) | VERIFIED |
| E7 | R6 repros + R7 attacks: `r7-probe` (4 tests) + `r7-cr` (1 test) | executed, exit 0 (findings are in logged values) | VERIFIED |
| E8 | `tools/security/authz-divergence-report.js`, `dashkey-consumers.js` | not run (needs `PG_URL` in `.env` / no `--check`) | NOT VERIFIED |
| E9 | SSO/Entra, dashkey-only-routes, export-share-boundary, route-authz suites (not assigned) | not run | NOT VERIFIED |

**7 verified, 2 not verified.** No full suite (not assigned).

## 2. Break attempts at this SHA (one per capability, preferring code changed by fixes 25–29)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Canonical switch values (fix 26) | "the value the guard checks is the value that is stored is the value the readers see" (`services/reportConfig.js:832-838`) | 17 encodings of on/off/garbage on the legacy PUT, center on and off | holds (200→`'1'`, 409, 400 as expected) |
| Four-eyes direction on NUMERIC keys (Policy Center, unchanged code exposed by fix 26's reasoning) | "a change is immediate only when it moves TOWARDS the strict direction" (`services/policyCatalogue.js:216-232`) | center on, super1 alone: `auth_pbkdf2_iterations` 600000 → `10000000`; `auth_account_throttle_max` 3 → `0`, then `-5` | **applied immediately** (status `applied`, no request); readers fall back to the weak defaults: new-hash target **100000** (was 600000, `reports-db.js:323-326`), throttle max **10** (was 3, `services/accountThrottle.js:13-14`) → **N-R7-1** |
| CR scope binding (fix 26) | a CR unlocks only the fields it names | out-of-scope fields with a scoped CR, odd encodings, currency/budget in scope | holds (409 / 400) |
| Operator tokens (fix 29) | one-time, 10 min, caller's own account, hash only | issue as admin/viewer/committee/anon → 403/403/403/401; as super1 → 200; DB stores `sha256` only (raw ≠ stored, hash matches); two **parallel** consumes → one success, one refusal; wrong purpose → refusal; journal row carries no token text | holds |
| Money sentinels Lots 1–6 (fix 26) | no amount sentinel to a non-reader, lots on or off | re-run E1 (both probes) | holds (committee exception = R1-F2, now 4 route patterns) |
| Audit chain anchors (fix 29) | unverifiable never ok, HMAC-signed anchors | code read `services/auditChain.js` `chooseAnchor`/`verify`; `tests/audit-chain-r6.test.js` green (E2) | holds by reading for forged/unsigned rows; deleting the newest signed anchors needs the app role to bypass the append-only trigger (UPDATE/DELETE/TRUNCATE refused; real protection = `tools/pg/harden-audit-grants.sql`, an operator step). Deferred to the audit seat. |

## 3. Findings (round 7)

### P0 — none.

### P1 — none open in code. R1-F2 stays a **policy** blocker (human decision, Finance + InfoSec).

### P2

**N-R7-1 (P2) — Policy Center: a "stricter-looking" numeric value that the reader rejects is applied by ONE super_admin and silently falls back to the weak default (four-eyes direction check vs reader range mismatch; same class as N-R6-1).**
- Where: `services/policyCatalogue.js:223-232` decides direction with `Number(next)` only; `validateConfigValue` (`:190-212`) checks the catalogue `min`/`max`, but the catalogue has no `max` for `auth_pbkdf2_iterations` and no `min` for `auth_account_throttle_max` (`docs/ops/policy-catalogue.json`). The readers then discard the out-of-range value: `reports-db.js:323-326` `_pbkdf2Target` returns 100000 unless `Number.isInteger(n) && 100000 ≤ n ≤ 5000000`; `services/accountThrottle.js:13` returns 10 unless `n ≥ 1`.
- Repro (`r7-probe` test R7-2; `policy_center_enabled='1'`, `auth_pbkdf2_iterations='600000'`, `auth_account_throttle_enabled='1'`, `auth_account_throttle_max='3'`): super1 `PUT /api/policy-center/rules/auth_pbkdf2_iterations {"value":"10000000","reason":"harden the work factor a lot"}` → **200 `applied`**, stored `10000000`, effective target for new hashes **100000**; super1 `PUT …/auth_account_throttle_max {"value":"0",…}` → **200 `applied`**, effective max **10**; `"-5"` → 200 applied. Control: `"6e5"` (equal value) → 202 pending. By reading, a non-integer such as `"700000.5"` takes the same path (not `Number.isInteger` → 100000). The same `needsSecondPerson` is used by the import plan (`routes/policyCenter.js:255`) — same exposure.
- Impact: bounded to the code defaults (100000 iterations — today's value, HD-S09 recommends keeping it; 10 failures) and journalled, super_admin only. But it is again a single-person weakening while the center is on, i.e. HD-S04 ("can we rely on the double control?") is not yet a clean yes.
- Regression test to add: for every four-eyes key with `strict_direction`, feed values outside the reader's accepted range (≤0, negative, non-integer, above the reader cap, exponent notation) through `PUT /api/policy-center/rules/:key` and the import dry run; assert 400 or `pending`, never `applied`. A unit test that the catalogue `min`/`max`/integer constraints equal each reader's clamp.
- Fix direction (not applied): give the catalogue the readers' real bounds (`auth_pbkdf2_iterations` integer, max 5000000; `auth_account_throttle_max` integer, min 1) and/or make `needsSecondPerson` compare the *effective* value (reader-normalised) rather than `Number(next)`. Rollback risk low.

Carried P2: R1-F3, R1-F4, R1-F5 (partial).

### P3
- Fix 26 side effect: `PUT /api/reports/config` now refuses (400) a whole patch when any switch is sent as `''` — an admin card that serialises an unchecked box as an empty string will fail to save *all* its fields. Verify the admin cards send `'0'`/`false`.
- `docs/business-readiness/REGISTRE-DECISIONS-HUMAINES.md:93` (HD-S04) still says N-R6-1 is "correctif 26, non fusionné ici" — stale at this SHA (fix 26 is merged). Update before the human reads it.
- CLIs with a DB URL (`tools/governance/apply-values.js` and similar) write `report_config` outside the guard — accepted limitation for a DB-credential holder; document it in the HD-S04 row.
- `GET /policy-center.html` shell to admin — cosmetic.
- R1-F7, F8 still open (not re-tested).

## 4. Optimistic claims challenged
- "Fix 26: canonical switch values close the four-eyes boolean bypass" — confirmed for switches. The broader claim "a four-eyes change that weakens a control always needs a second person" is still false for two numeric keys (N-R7-1). The static and direction tests (`tests/four-eyes-guard.test.js`, `tests/policy-center-four-eyes-direction.test.js`) cannot see a reader clamp.
- "R1-F5 money sentinels Lots 1–6" — the sentinel list grew, **and so did the committee exception**: two new `KNOWN_OUTCOME_MONEY` patterns (CR list, documents list/download) are justified in a code comment as "not a separate decision". That is an AI classification extending a pending human policy decision (R1-F2) to new routes; it must be listed in the R1-F2 decision request, not assumed.
- "Fix 29: CLI four-eyes activation only via operator token" — confirmed for `activate-switches.js`; it does not bind other CLIs that hold a DB URL.
- "Audit chain fails closed with HMAC-signed anchors" — confirmed by reading and tests for forged/unsigned rows; integrity still depends on the operator applying `harden-audit-grants.sql` and on `SDP_CONFIG_KEY` (without the key the anchors are labelled advisory, which the result says).

## 5. Per P03 lot — AI panel recommendation, not a decision

| Lot | Recommendation |
|---|---|
| L01 Daily work | GO PILOT |
| L02 Portfolio reading | CONDITIONAL — R1-F2 decided by Finance/InfoSec, now including the CR-impact and money-document routes |
| L03 Change control | GO PILOT (N-R6-2 fixed) |
| L04 Scheduling/collab | GO PILOT |
| L05 Time, money, benefits | CONDITIONAL (pilot plan already NO-GO) — R1-F2 + R1-F5 (partial) |
| L06 Plan exchange | CONDITIONAL — not reviewed in depth by this seat |
| L07 Roadmap publication | CONDITIONAL — one executed roadmap-share test with amounts seeded |
| L08 Governance cadence | GO PILOT |
| L09 KPI trust | GO PILOT |
| L10 Reporting rhythm | GO PILOT |
| L11 Site ops evidence | CONDITIONAL — R1-F5 sentinels for certified asset money |
| L12 Access hardening | CONDITIONAL — break-glass drill evidence + InfoSec gate; N-R7-1 lets one super_admin reset the account throttle max / hash target to the defaults while the center is on |
| L13 Ops resilience / identity (incl. `policy_center_enabled`) | **CONDITIONAL** — switch class fixed (N-R6-1); for HD-S04 the center can be enabled on TEST, but relying on its four-eyes for the numeric access keys waits for N-R7-1; pair with R1-F3 / HD-S05 / D-15 |
| L14 Portfolio intake register | CONDITIONAL — tied to L02/L05 money decision |
| L15 Adoption Lot B | GO PILOT (lots-on probe green) |
| L16 Portfolio phase 2 (Lot 6) | GO PILOT from this seat; malware scanning of documents remains an open operator decision |
| Portfolio Lots 2–5 switches | GO PILOT (Lot 5: N-R6-2 fixed) |

## 6. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md`, rows verified empty at 7ea49070)
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08) — Information Security (row 8)
- Security — threat model and findings register (G27) — Information Security (row 9)
- CAB — dependency release D-11 / PostgreSQL-only cutover PO-08 (row 10)
- Signing key and CI action SHAs D-12 (G-09) — Information Security + CI owner (row 11)
- Connectors D-07/D-08/D-09, dash-key clients D-15 — platform owners (row 20; R1-F3, HD-S05)
- Finance — budgets and benefits (G14) — Finance (row 21; R1-F2)
- Production deployment GO/NO-GO — CAB (row 24)
- Penetration test / accepted analysis (E-B05, X-B-03) — Information Security (row 25)
- Business-readiness register rows in this area still blank: HD-S04 (Policy Center double control — N-R7-1), HD-S05 (dash key), HD-S09 (hash cost), HD-G13.

No approval, signature or production readiness is claimed or implied by this file.
