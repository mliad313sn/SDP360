# P11 — Audit/risk seat, ROUND 8 (re-check)

**AI review — not an independent human review.** Frozen SHA `7afb9536ae3e38273aeff47307a78c49637dbd94` (clone `/home/user/qual/audit`, `git rev-parse HEAD` checked; the only working-tree changes are the deliberately removed `docs/agent-execution/` narratives, which the reviewer did not read). The reviewer did not write this code, changed no product code, touched no live system, pushed/merged/tagged nothing and filled no human decision. Throwaway attack files live only under `/tmp/claude-0/p11attack-r8/` (`tests/r8imp.test.js`, `tests/r7chain.test.js` re-run, `tests/r8chain.test.js`, `tests/r7gov.test.js` + new numeric-range test, `gdmut.js`). None is committed. Earlier round files were not modified.

**Databases.** Every targeted run used `SDP_TEST_RUN_ID=auditr8`; the full suite ends `[test-db] dropped 1`. After all runs, `SELECT datname FROM pg_database WHERE datname ILIKE '%auditr8%' OR datname ILIKE 'r8%'` → **0 rows**. Shadow schemas made by the chain attacks were dropped in `finally` blocks. No other seat's database was touched; `drop-test-dbs.js` was not run.

## 0. Round-7 findings in this area — status at 7afb9536 (after fixes 30–33)

| R7 id | Sev (r7) | Re-check at 7afb9536 (command → observed) | Status |
|---|---|---|---|
| **R7-A1** operator token forgeable by a direct `INSERT INTO operator_tokens` with the app DB role | P3 (P2 if CLI records count as second-person evidence) | `r8imp.test.js` (SDP_CONFIG_KEY set in the test env). **R8-1** verbatim r7 forgery (row, no binding) → CLI **refused** "operator token was not issued by the server (no valid binding …)". **R8-2** valid HMAC binding but no `operator_token_issued` event → **refused** "#2 has no operator_token_issued event". **R8-3** forged event, no binding → **refused**. **R8-6** genuine token of pc_super named in a request row whose requester is pc_super2 → approve **409** "the token belongs to another account". **R8-4** (holder of BOTH the DB login and `SDP_CONFIG_KEY`: binding + event) → CLI files `pc-1` as pc_super2, approve **200**, value 1 — this is the residual stated in `ADR-P11-R7-anchor-kid-token-binding.md` §3. **R8-5** (new, see §2): skip the CLI entirely, `INSERT INTO policy_change_requests (… requested_by=pc_super2, source='cli', reason naming no token)` with the DB login only → approve by pc_super **200, value 1**. | **FIXED for the CLI path** (all three r7 variants refused, cross-account reuse refused). Residual **R8-A1** (P3): a request row naming no token is still approvable; ADR §3 mentions it ("shown with no token evidence") and attributes it to PC-log. |
| **R7-A2** chain verify fails open in the default state (shadow + empty anchor table; owner drops `sig`) | P3 (P2 until hardened) | `r7chain.test.js` re-run verbatim. R7-1 shadow w/o anchor table → `ok=false unverifiable`. **R7-2 shadow + empty anchor table → `ok=false status=unverifiable integrity=none`** (was ok/"signed"). R7-3 unsigned anchor → `broken`. **R7-4 sig dropped → `broken`, "signature column removed although signed anchors were written"; sig dropped + matching forged anchor → `ok=false unverifiable`** (was ok/advisory). | **FIXED** (both r7 repros). New regression path via the key-rotation resume → **R8-A2** (§2). `SDP_LEDGER_SCHEMA` still absent from any `.env` template / installer (grep: only `services/auditChain.js`, `tools/pg/harden-audit-grants.sql`, docs, tests); the meta row `ledger_schema` recorded at migration time now covers the default state. |
| **R7-A3** dossier hash misses transitive modules | P3 | `gdmut.js` on a temp copy (manifest + 51 scripts + **472 `script_deps`**): appending to `services/auditChain.js` → **flagged** "a module a cited command loads changed after the dossier was generated: services/auditChain.js". Direct script change still flagged. `services/operatorTokens.js`, `services/policyRanges.js`, `services/passwordWorkFactor.js`, `reports-db.js` all in `script_deps`. | **FIXED** |
| **R7-A4** PLAN-PILOTE says fix 26 "non fusionné" | P3 | `docs/business-readiness/PLAN-PILOTE.md:58,63` now say "fusionné ; revérifié par le panel IA au tour 7 … avis IA, pas une décision". Line 64 names fix 33 (HMAC token). Approver cells still empty. | **FIXED** |
| **AUD-4** center OFF → one super_admin turns audit/approval controls off via legacy PUT | P2 → partial (policy) | `r7gov.test.js`: center OFF, `PUT /api/reports/config {ppm_field_audit_enabled:'0', access_require_approval:'0'}` → **200**, stored 0/0. Center ON: legacy PUT `policy_center_enabled:'0'` → **409**; via center → **202 pending**. | **PARTIAL** (unchanged; HD-S04/G01 decision) |
| R3-A2r flag register recognises only `'1'` | P3 | `git log 7ea49070..HEAD -- tools/agent/flag-register.js` → 0 commits | NOT FIXED |
| PC-log `policy_change_requests` mutable, not chained | P3 | still absent from `auditChain.TABLES`; no append-only trigger. Now the enabler of R8-A1. | NOT FIXED |
| N2 reviewer alias accepted at set-up | P3 | not re-run; code paths untouched by fixes 30–33 | NOT FIXED (assumed, not re-verified) |
| NEW-2 suite-level `describe.skip` not counted | P3 | `tools/test/guard.js` → 0 commits | NOT FIXED |
| NEW-3 G07 stale label | P3 | `gate-dossiers/en/G07…:28` still "Routes answer 404 while the switch is off" | NOT FIXED |
| AUD-5 SWITCH-LOTS rollback overclaim | P3 | SWITCH-LOTS.md changed (test counts only); rollback sentence "set every switch of the lot back to its default 0" unchanged — with the center ON, relaxing a four-eyes switch is a 202 pending, not an immediate single-person rollback | NOT FIXED |
| AUD-6 two-person delete ignores deputy | P3 | `services/softDelete.js` → 0 commits | NOT FIXED |
| AUD-7 `ui_inject_dash_key` kind `secret`; owner "to be named" | P3 | FLAG-REGISTER.md only gained `services/operatorTokens.js` as a consumer of `SDP_CONFIG_KEY` | NOT FIXED |
| AUD-9 tests depend on removed narratives | P3 | same 16 failures in E1 | NOT FIXED (environmental) |

## 1. Evidence re-run at 7afb9536 (command, result)

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `SDP_TEST_RUN_ID=auditr8 node tools/test/run-all.js` (log `/home/user/qual/out/r8-audit-fullsuite.log`) | files **935/935** · tests **6043** · failed **16** · skipped 10 · floor **6018** met · skip 10 × "no prod-snapshot" (allow-list unchanged) · 1666 s · guard FAIL "16 test(s) failed" + "agent-inventory reported 1, manifest expects ≥ 4". Failing files: agent-inventory, business-readiness, evidence-baseline, gate-dossiers ×3, inventory-strict, p09-adoption-kit, release-dossier ×4, traceability ×3, uat-committee — every one reads a removed `docs/agent-execution/` file (ENOENT or "regenerate"/"INVENTORY-STRICT.md missing"). **0 non-environmental failures.** | Reproduced. FAIL in this clone for environmental reasons only. Green on a pristine tree **not verified** |
| E2 | `node tools/release/gate-dossiers.js --check` | exit 1, 14 problems: 7 cited files missing + 7 awaited globs empty, all under the removed narratives. **0** script, script-dep or evidence-hash mismatch. Manifest `target_sha` `ade91139` = HEAD~1 (HEAD is a dossier refresh). | Reproduced: FAIL here for environmental reasons. Pristine PASS **not verified** |
| E3 | `node tools/agent/switch-lots.js --check` | exit 0 "switch lots up to date" | **Verified PASS** |
| E4 | `node tools/agent/flag-register.js --check` | exit 0 "flag register up to date"; `docs/ops/flag-decisions.json` `items` = **0** | **Verified PASS** ("up to date" = current, not decided) |
| E5 | Gate-dossier decision cells (`manifest.json rows`) | 21 rows, **0** with a decision | **Verified**: no approval invented |
| E6 | Manifest ratchet 7ea49070 → HEAD (`tests/.suite-manifest.json`) | total 5979→**6018**, files 929→935, **0 decreased, 0 removed**; `tests/.skip-allowlist.json`, `tools/test/guard.js` unchanged | **Verified** |
| E7 | PLAN-PILOTE read | lag fixed; "Avis consolidé (IA)" kept; approver cells empty | **Verified: no invented approval** |
| E8 | Round-7 repros re-run / rewritten (`r8imp`, `r7chain`, `gdmut`, `r7gov`) | see §0 | **Verified** |

Counts: **verified 6** (E3–E8). E1, E2 reproduced but red for environmental reasons only. **Not verified 3**: E1 green on a pristine tree, E2 PASS on a pristine tree, CI green on the target SHA.

## 2. New break attempts (claim · attack · outcome), aimed at fixes 30–33

**R8-A1 — four-eyes request records (fix 33 token binding). BYPASS by skipping the CLI. Stated residual, P3.** Claim (fix 33 commit message / ADR §3): "operator tokens bound by HMAC outside the DB and to their issuance event" so a CLI-filed request cannot be forged with the DB login. Attack R8-5: with the DB login only (no key), `INSERT INTO policy_change_requests (key='portfolio_editor_plan_writes', new_value='1', requested_by=<pc_super2>, source='cli', reason='… filed via CLI', status='pending', …)`; `POST /api/policy-center/requests/pc-2/approve` as pc_super → **200 approved, value 1**. The approve route only checks token evidence when the reason *names* a token (`routes/policyCenter.js:175-182`, `if (ev && …)`). Since fix 29 every genuine `source='cli'` request names a token, so a `cli` row with no token evidence is by construction not genuine and could be refused. Precondition unchanged (the DB login can also `UPDATE report_config` directly), so the impact is a forged second-person record, not an escalation. ADR §3 states it. R8-4 (key + DB holder) is likewise stated.

**R8-A2 — audit chain key-rotation resume (fix 33, migration 137). Baseline can be lowered. P3 (P2 until hardened); regression vs round 7.** Claim (ADR §1): a made-up kid "cannot lower the baseline". Attack `r8chain.test.js` R8-C1 (unhardened owner, key set): nightly anchors 3 rows → disable ledger triggers, delete tail row (control: `broken`, "row count shrank from 3 to 2") → disable `audit_chain_anchors_append_only`, `DELETE FROM audit_chain_anchors` (→ `broken`, "anchor history missing", correct) → insert one anchor per ledger with `kid='deadbeefdeadbeef'`, garbage sig, matching the shortened chain → verify `unverifiable (key rotated)`, `key_rotated=true` → `AC.nightly(rdb)` re-anchors under the current key and logs `audit_chain_key_rotated` → verify **`ok=true status=ok integrity=signed`** on the 2-row ledger. Control R8-C2 (same foreign anchor appended *without* deleting the valid ones) → stays `broken`, nightly throws: the "cannot lower the baseline" claim holds only while a current-key anchor survives. In round 7, the same deletion + insert gave `broken` ("not signed / forged"); the rotation path is what launders it. Signals that were available and ignored: the previous `audit_chain_anchor` system_log events carry `rows:3` for that ledger, and anchors under the **current** kid existed (meta `signed_anchors`). Requires the owner role (default until `harden-audit-grants.sql`), the same class as ADR §2's stated residual, but the only trace left is an "unverifiable, not forged" rotation event an operator is told to accept.

**R8-A3 — numeric four-eyes ranges (fix 31). HOLDS.** Center ON, legacy PUT and center rule PUT with `auth_account_throttle_max` ∈ {`1000`, `1000.0`, `+1000`, ` 20 `} → 409 (four-eyes / pending exists); {`1e3`, `0x14`, `5.5`, `0`, `1001`, `-1`} → 400; `emergency_access_max_hours` `25`/`0` → 400, `24.0`/`+24` → 409; `auth_pbkdf2_iterations` `99999`/`6e5` → 400, `5000000` (stricter) applied via center 200, `600000.0` canonicalised (stored stays `600000`). Blank switch `""` on legacy PUT → 200 with no change (fix 31 "blank = not sent"). No spelling or range bypass found.

**R8-A4 — gate-dossier dependency hashing (fix 33). HOLDS** (see R7-A3); no mismatch at HEAD.

**R8-A5 — suite integrity. HOLDS.** Floor 6018 met, 0 decreased/removed, skip allow-list unchanged, 935/935 files reported, DBs swept.

## 3. Findings (round 8)

| Id | Sev | Title | Reproduction | Regression test to add | Rollback risk |
|---|---|---|---|---|---|
| R8-A2 | **P3** (P2 until `harden-audit-grants.sql` is applied in prod) | Unhardened owner deletes anchors + inserts foreign-kid anchors → nightly "key rotation" resume re-baselines a truncated ledger to ok/signed | `cd /home/user/qual/audit && PG_ADMIN_URL=postgres://sdptest:sdptest-local-only@localhost:5432/postgres SDP_TEST_RUN_ID=auditr8 NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit /tmp/claude-0/p11attack-r8/tests/r8chain.test.js` → `R8-C1 after resume: true ok signed` | Rotation resume refused (status `broken`) when (a) a ledger's live row count is below the `rows` of its last `audit_chain_anchor` event, or (b) anchors under the current kid were ever recorded (meta should keep the last current-kid anchor id/count) but none survive. Test: R8-C1 → nightly throws. | Low |
| R8-A1 | **P3** | A `source='cli'` policy request that names no operator token is approvable; a direct row insert forges a second-person record (stated in ADR §3) | `… node --test --test-force-exit /tmp/claude-0/p11attack-r8/tests/r8imp.test.js` → `R8-5 APPROVE direct-row 200 … value 1` | Refuse approval of `source='cli'` rows with no verifiable token evidence; chain/append-only `policy_change_requests` (PC-log). | Low |
| AUD-4 | P2 → partial (policy) | Center OFF (default): one super_admin relaxes audit/approval controls | `… r7gov.test.js` → `AUD-4 center OFF legacy PUT -> 200 stored 0 0` | Make "center on" a pilot precondition (HD-S04) | Low |
| R3-A2r, PC-log, N2, NEW-2, NEW-3, AUD-5, AUD-6, AUD-7, AUD-9 | P3 | Carried over (§0) | earlier rounds | as r4–r7 | None |

**P0: 0. P1: 0.** Fixed since round 7: R7-A1 (CLI path, all three variants), R7-A2 (both repros), R7-A3, R7-A4. Fix 31 four-eyes ranges hold. New: R8-A1 (stated residual), R8-A2 (regression path introduced by the rotation resume of fix 33, owner-only).

## 4. Per-lot recommendation (AI panel recommendation, not a decision)

| Lot | Audit-area touchpoint | Recommendation |
|---|---|---|
| Product as shipped (no switch changed) | — | **GO PILOT** on the TEST instance, subject to the empty gates below |
| L01 Daily work (`commitments_enabled`) | commitment four-eyes (code unchanged) | **GO PILOT conditional on G07** |
| L03 Change control (`portfolio_editor_plan_writes`) | R8-A1, AUD-4 | **CONDITIONAL**: center ON (HD-S04) + token flow; approver checks the request screen shows verified token evidence (a `cli` request with none = refuse) until R8-A1 is fixed; restrict holders of the DB login and `SDP_CONFIG_KEY` (G01) |
| L05/L06 Finance / PPM ledgers | R8-A2 | **CONDITIONAL** (L05 NO-GO for other seats' reasons). Apply `harden-audit-grants.sql` before relying on ledgers/anchors as evidence; treat any `audit_chain_key_rotated` event without a documented key rotation as an incident |
| L07 Publication / soft delete | AUD-6 | **CONDITIONAL** |
| L08 Governance cadence | four-eyes via the center | **CONDITIONAL** |
| L12 Access security | fix 26 / fix 31 hold | **CONDITIONAL**: G01 names who resets super_admin credentials and who holds DB login + `SDP_CONFIG_KEY` |
| L13 Ops resilience incl. `policy_center_enabled` | R8-A2; center cannot be turned off alone | **CONDITIONAL**: G05 empty, DBA hardening step |
| L14 Portfolio Lots 1–5 | four-eyes switches through the center | **CONDITIONAL**, as L03 |
| L15 Adoption Lot B | none in this area | **GO PILOT** from the audit angle |
| L16 Portfolio phase 2 | out of pilot | **CONDITIONAL / out of pilot** |
| Activation tool | R7-A1 fixed for the CLI path | `--plan`/`--dry-run` **GO**; `--apply` on 4EYES lots **CONDITIONAL** (center ON + server-bound token + web approval) |
| Business-readiness pack | E7 | **No invented approval** (verified); lag fixed |

## 5. Human gates (RELEASE-GATES rows) still empty in this area

All 21 dossier rows have 0 decisions; `docs/ops/flag-decisions.json` has 0 decided items. Relevant rows: **G01** access policy (who resets super_admin credentials, who holds the app DB login and `SDP_CONFIG_KEY`, who may run `activate-switches --apply`); **G02** threat model (take in R8-A1, R8-A2); **G05** backup/restore RPO-RTO; **G07** closure policy D-04; **G08** handoffs; **G15** business acceptance; **G17** production GO/NO-GO; **G18** penetration test; **G19** QA lead (CI green on target SHA, skips reviewed). Also open: the DBA/CAB step applying `tools/pg/harden-audit-grants.sql` (+ `SDP_LEDGER_SCHEMA`), the HD-S04 decision to turn the Policy Center on, and a named independent second super_admin.

*AI review — not an independent human review.*
