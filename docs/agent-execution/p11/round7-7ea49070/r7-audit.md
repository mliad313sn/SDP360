# P11 — Audit/risk seat, ROUND 7 (re-check)

**AI review — not an independent human review.** Frozen SHA `7ea49070d687679109c3c91ef29a8f744835f10c` (clone `/home/user/qual/audit`, `git rev-parse HEAD` checked; the only working-tree changes are the deliberately removed `docs/agent-execution/` narratives, which the reviewer did not read). The reviewer did not write this code. It changed no product code, touched no live system, and pushed, merged and tagged nothing. It filled no human decision. Throwaway attack files live only under `/tmp/claude-0/p11attack-r7/` (`tests/r7chain.test.js`, `tests/r7imp.test.js`, `tests/r7gov.test.js`, `gdmut.js`). None of them is committed. Earlier round files were not modified.

**Databases.** Every targeted run used `SDP_TEST_RUN_ID=auditr7`, which the R6-A4 fix now sanitises instead of ignoring. The full suite (run-all sets its own run id) ends with `[test-db] dropped 1`: since fix 27, per-file databases are dropped at exit. After all runs, a query for `%auditr7%` / `r7%` databases returns **0**. Shadow schemas created by the attacks were dropped in `finally` blocks. No other seat's database was touched.

## 0. Round-6 findings in this area: status at 7ea49070 (after fixes 25–29)

| R6 id | Sev (r6) | Re-check at 7ea49070 (command → observed) | Status |
|---|---|---|---|
| **R6-A1**: `activate-switches --operator=<colleague>` files a four-eyes request as the colleague, and the runner approves it | P2 | `r7imp.test.js` test 1 (the round-6 attack, verbatim): `--operator=pc_super2` with no token → **refused**, "add --operator-token=env … nothing written". `--second-operator=…` → **refused** ("no longer accepted"). The shipped smoke `tests/activate-switches-r6-impersonation.smoke.test.js` passed in E1 (it is not in the failure list). **New attack (R7-A1 below):** a token for pc_super2 forged by a direct `INSERT INTO operator_tokens`, using the app DB role that the CLI needs anyway → the CLI files `pc-1` with `requested_by: pc_super2`; pc_super approves → **200 approved, value 1**. `system_log` holds **0** `operator_token_issued` events. | **PARTIAL.** A typed name no longer works. Deliberate forgery with the DB credentials the tool requires still produces a false "second person" record. This is the same precondition as round 6, now a deliberate SQL act rather than a flag. |
| **R6-A2**: chain verify fails open in the default (unhardened, no `SDP_LEDGER_SCHEMA`) state | P3 (P2 until hardened) | `r7chain.test.js`. **R7-1** (the round-6 shadow, without an anchor table): `ok=false status=unverifiable` → fixed. Partial shadow (one ledger missing) → not ok (shipped test `audit-chain-r6` is green in E1). **R7-3** (forged unsigned anchor `row_count=0` with the key set): `ok=false status=broken`, "anchor row(s) #13 not signed" → fixed. **But two new bypasses** (R7-A2 below): (a) the same shadow **plus one empty `audit_chain_anchors` table** → `ok=true status=ok anchor_integrity=signed`; (b) the owner drops the `sig` column, then inserts a matching anchor after a tail delete → `ok=true`, labelled only "advisory". `SDP_LEDGER_SCHEMA` is still absent from any `.env` template or installer step (grep: only docs, tests and the harden script). | **PARTIAL.** The round-6 repros are fixed. The fail-open is still reachable in the default configuration with one extra DDL statement. |
| **R6-A3**: a changed command script is invisible to the dossier `--check` | P3 | `gdmut.js` on a temp copy: appending to `tools/pg/restore-rehearsal.js` → **flagged** ("script a cited command runs changed"). 51 scripts are hashed in the manifest. Manifest target `3df35be7`; `git diff --name-only 3df35be7 HEAD` outside `docs/agent-execution/` is **empty** (HEAD is a dossier refresh). Residual: a change to a script's **transitive dependency** (`services/auditChain.js`, which `restore-rehearsal.js` requires) is **not** flagged; `npm test -- --update-manifest` is not hashed. | **FIXED** (direct scripts). Residual P3: transitive dependencies are not hashed. |
| **R6-A4**: an invalid `SDP_TEST_RUN_ID` is silently ignored | P3 | `tests/pg-helpers.js` now calls `drop-test-dbs.sanitiseRunId` (`audit-r6` → `audit_r6`). My `auditr7` runs were tagged and swept; 0 left. Cosmetic residual: distinct ids collapse to one tag (`audit-r6`, `AUDIT r6` and `audit_r6` all become `audit_r6`). | **FIXED** |
| **AUD-4**: with the center off, one super_admin can turn off audit/freeze/approval controls | P2 → partial (policy) | `r7gov.test.js`: center OFF, `PUT /api/reports/config {ppm_field_audit_enabled:'0', access_require_approval:'0'}` → **200**, stored 0/0. With the center ON, the CLI now refuses every four-eyes step, and one person cannot turn the center off: legacy PUT `policy_center_enabled:'0'` → **409**; through the center → **202 pending**. | **PARTIAL** (unchanged web behaviour; this is an access-policy decision, HD-S04/G01). The CLI side is closed. |
| Plan lag (pack consolidated round-4 opinions) | P3 | PLAN-PILOTE:40-63 now uses round-6 seat opinions and says fixes 25–29 are "non revérifiés par un panel". New lag: lines 58 and 63 still say fix 26 is "**non fusionné ici**", but fix 26 **is** merged at this SHA (`ee2b50c3`). | **FIXED**, with a new one-line lag (P3) |
| R3-A2r (flag register recognises only `'1'`) | P3 | `git log e82d95ba..HEAD -- tools/agent/flag-register.js` → 0 commits | NOT FIXED |
| PC-log (`policy_change_requests` mutable, not chained) | P3 | Still absent from `auditChain.TABLES`; no append-only trigger in `db/postgres/reports/*.sql`. It matters more now: the requester-of-record row R7-A1 forges is itself editable. | NOT FIXED |
| N2 (reviewer alias accepted at set-up) | P3 | Not re-run; the code paths are unchanged in the fix-25–29 diff | NOT FIXED (assumed; not re-verified) |
| NEW-2 (suite-level `describe.skip` not counted) | P3 | `tools/test/guard.js` → 0 commits | NOT FIXED |
| NEW-3 (G07 stale label) | P3 | `gate-dossiers/en/G07…:28` still says "Routes answer 404 while the switch is off" | NOT FIXED |
| AUD-5 (SWITCH-LOTS rollback overclaim) | P3 | SWITCH-LOTS.md changed twice, but neither change touches the rollback sentence | NOT FIXED |
| AUD-6 (two-person delete ignores deputy) | P3 | `services/softDelete.js` → 0 commits | NOT FIXED |
| AUD-7 (`ui_inject_dash_key` kind `secret`; `sync_alert_enabled` owner "to be named") | P3 | FLAG-REGISTER.md:286,311 unchanged | NOT FIXED |
| AUD-9 (tests depend on the removed narratives) | P3 | 16/16 failures in E1 are of this kind | NOT FIXED (environmental) |

## 1. Evidence re-run at 7ea49070 (command, result)

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `node tools/test/run-all.js` (PG; log `/home/user/qual/out/r7-audit-fullsuite.log`) | files **929/929** · tests **6004** · pass 5978 · **failed 16** · skipped 10 · floor 5979 met · skips 10 × "no prod-snapshot" (allow-list unchanged) · duration 1867 s (31 m) · guard FAIL "16 test(s) failed" + "agent-inventory reported 1, manifest expects ≥ 4". **All 16 failures are environmental**: each reads a removed `docs/agent-execution/` file (agent-inventory, business-readiness, evidence-baseline, gate-dossiers ×3 — the new R6-A3 mutation test fails on `copyfile … CONNECTOR-QUALIFICATION-2026-11-12.md` ENOENT — inventory-strict, p09-adoption-kit, release-dossier ×4, traceability ×3, uat-committee). **0 non-environmental failures.** | Reproduced. **FAIL in this clone, for environmental reasons only.** Green on a pristine tree: **not verified** |
| E2 | `node tools/release/gate-dossiers.js --check` | **exit 1**, 14 problems: 7 cited files missing and 7 awaited globs empty, all under the removed narratives. **0** script-hash or evidence-hash mismatches. Target `3df35be7` = HEAD minus a refresh commit. | Reproduced: FAIL here for environmental reasons. Pristine PASS **not verified** |
| E3 | `node tools/agent/switch-lots.js --check` | exit 0 "switch lots up to date" | **Verified PASS** |
| E4 | `node tools/agent/flag-register.js --check` | exit 0 "flag register up to date". `docs/ops/flag-decisions.json` has no decided items | **Verified PASS** ("up to date" means current, not decided) |
| E5 | Gate dossier decision cells (`manifest.json` rows) | 21 rows, **0** with a decision | **Verified**: no approval invented |
| E6 | Manifest ratchet e82d95ba → HEAD | total 5927→**5979**, files 919→929, **0 decreased, 0 removed**. `tests/.skip-allowlist.json` and `tools/test/guard.js` unchanged | **Verified** |
| E7 | Business-readiness pack (`node tools/release/business-readiness-check.js --check` plus a read of PLAN-PILOTE) | exit 1 entirely on missing `docs/agent-execution/…` sources (environmental). The plan keeps "Avis consolidé (IA)", L05 NO-GO, "non revérifiés par un panel". The approver cells in the plan (for example line 29) are empty. | **Verified: no invented approval.** Lag P3 (fix 26 "non fusionné") |
| E8 | Round-6 repros rewritten (`r7imp`, `r7chain`, `r7gov`, `gdmut`) | see §0 and §2 | **Verified** |

Counts: **verified 6** (E3–E8). E1 and E2 are reproduced, but red here for environmental reasons only. **Not verified 3**: E1 green on a pristine tree, E2 PASS on a pristine tree, and CI green on the target SHA.

## 2. New break attempts (claim · attack · outcome), aimed at code changed by fixes 25–29

**R7-A1: operator tokens (fix 29). Forgeable with the DB role the CLI needs. BROKEN (record forgery).** Claim (ADR-P11-R6-operator-tokens §2-3): "the requester is authenticated by a one-time operator token … issued in the web UI by that account's own session". Attack (`r7imp.test.js` test 2, real server, PG, center ON). Using `rdb.pgHandle()` (the same app role and URL that `activate-switches --db-url=env` uses), insert `operator_tokens(token_hash=sha256(sdpop_…), user_id=<pc_super2>, expires_at=now()+10m)`, then run `main(['--apply','--lots=L03','--operator-token=env',…])` → request `pc-1`, `requested_by: pc_super2`, reason "authenticated by operator token #1". `POST /api/policy-center/requests/pc-1/approve` as pc_super → **200 approved, `portfolio_editor_plan_writes`=1**. No `operator_token_issued` event exists. The precondition is unchanged from round 6: anyone who can run the CLI against the DB can already `UPDATE report_config`. The impact is again a **forged four-eyes record**, not an escalation. The token is not bound to anything the app role cannot write: there is no HMAC over the token row, and approval does not check for an issuance event. The ADR does not state this residual.

**R7-A2: audit chain fail-closed (fix 29, migrations 132/135). Two default-state bypasses. BROKEN.**
(a) `r7chain.test.js` R7-2: search_path shadow with empty copies of the 12 ledgers **and** an empty `audit_chain_anchors` (with the `sig` column), no `SDP_LEDGER_SCHEMA`, key set → `ok=true status=ok schema=r7b_* anchors=true anchor_integrity=signed`. `anchorsExpected` is only consulted when the ledger schema has **no** anchor table, and `anchorHistory` reads the shadow's sequence and system_log, so both see "never anchored". The label "signed" on an empty table is misleading.
(b) R7-4: as the unhardened owner, disable the ledger triggers, delete the tail row (control: verify → `ok=false`, "row count shrank"), `ALTER TABLE audit_chain_anchors DROP COLUMN sig`, then insert an anchor matching the shortened chain → `ok=true status=ok`, `anchor_integrity` "advisory (anchor sig column missing …)". With the key **set** and signed anchors previously written (the nightly system_log events record them), a missing `sig` column should be `broken`/`unverifiable`, not advisory-ok.
Both need the owner role (the default until `tools/pg/harden-audit-grants.sql` is applied), which is exactly the state round 6 asked to make fail closed. Once hardened, the app role cannot create tables in the ledger schema or drop columns, so both are closed.

**R7-A3: canonical switch values before the four-eyes guard (fix 26). HOLDS.** `r7gov.test.js`, center ON, `ppm_field_audit_enabled`=1, legacy `PUT /api/reports/config` with `0, false, "0", " 0", "false", "off", "no"` → **409** each; with `"", null, "0.0", [0], {}` → **400** each; stored value always `1`. Policy Center rule PUT `false` → **202 pending**. Turning the center off: legacy PUT → 409, center → 202. No spelling bypass found.

**R7-A4: gate-dossier script hashing (fix 29). Holds, with a gap.** See R6-A3: direct scripts are caught; transitive modules are not.

**R7-A5: suite integrity. HOLDS.** Floor 5979 met, 0 decreased or removed, skip allow-list unchanged, all 929 files reported. The run-id is sanitised.

## 3. Findings (round 7)

| Id | Sev | Title | Reproduction | Regression test to add | Rollback risk |
|---|---|---|---|---|---|
| R7-A1 | **P3** (P2 if the committee will treat center/CLI request records as evidence of a second person for L03/L14/L16) | An operator token can be forged by a direct INSERT with the app DB role. One person files "as" a colleague and approves; no issuance event exists. | `cd /home/user/qual/audit && PG_ADMIN_URL=postgres://sdptest:sdptest-local-only@localhost:5432/postgres SDP_TEST_RUN_ID=auditr7 NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit /tmp/claude-0/p11attack-r7/tests/r7imp.test.js` → `R7-forge APPROVE by pc_super 200 … value 1`, issued events 0 | Store `HMAC(SDP_CONFIG_KEY, token_hash‖user_id‖expires_at)` on the token row and verify it in `check()`. At approval, require a matching `operator_token_issued` system_log row for the token id named in the reason, and refuse otherwise. Test: forged INSERT → CLI refused. At minimum, state the residual in the ADR and runbook: "a holder of the app DB credentials can forge any four-eyes record". | Low |
| R7-A2 | **P3** (P2 until the hardening is applied in prod) | The chain verify still fails open in the default state: (a) a shadow schema that includes an empty anchor table → ok/"signed"; (b) the owner drops `sig` → a forged anchor is accepted as "advisory" ok | `… node --test --test-force-exit /tmp/claude-0/p11attack-r7/tests/r7chain.test.js` → `R7-2 … ok= true status= ok … integrity= signed`, `R7-4 sig dropped + matching forged anchor: ok= true` | `verify` returns `unverifiable` when the resolved ledger schema ≠ the schema that `schema_migrations` / the anchor events name, or when any other schema in the DB holds the ledgers. With a key set and any prior signed anchor (system_log `anchor_integrity:'signed'`), a missing `sig` column → `broken`. Label an empty anchor table "none", not "signed". Ship `SDP_LEDGER_SCHEMA=public` in the installer and `.env` template. | Low |
| R7-A3 | P3 | Dossier script hash does not cover transitive modules | `node /tmp/claude-0/p11attack-r7/gdmut.js` → `transitive dep services/auditChain.js changed flagged: false` | Hash the local `require` closure of each cited script (or the files it lists) | None |
| R7-A4 | P3 | PLAN-PILOTE:58,63 say fix 26 is "non fusionné ici", but it is merged at this SHA | read lines 58 and 63 | Regenerate the pack at the frozen SHA (still with no human cell filled) | None |
| AUD-4 | P2 → partial (policy) | With the center off (the default), one super_admin turns off audit/approval controls through the legacy PUT | `r7gov.test.js` → `center OFF legacy PUT -> 200 stored 0 0` | Make "center on" a pilot precondition (HD-S04), or refuse while it is off | Low |
| R3-A2r, PC-log, N2, NEW-2, NEW-3, AUD-5, AUD-6, AUD-7, AUD-9 | P3 | Carried over (§0). PC-log now amplifies R7-A1. | earlier rounds | as in r4–r6 | None |

**P0: 0. P1: 0.** Fixed since round 6: R6-A3 (direct scripts), R6-A4, the plan lag (mostly), and the round-6 repros of R6-A1 and R6-A2. Partial: R6-A1 → R7-A1, R6-A2 → R7-A2, AUD-4.

## 4. Per-lot recommendation (AI panel recommendation, not a decision)

| Lot | Audit-area touchpoint | Recommendation |
|---|---|---|
| Product as shipped (no switch changed) | — | **GO PILOT** on the TEST instance, subject to the empty gates below |
| L01 Daily work (`commitments_enabled`) | commitment four-eyes (round-4 repro not re-run this round; code unchanged) | **GO PILOT conditional on G07** (D-04 owner still empty) |
| L03 Change control (`portfolio_editor_plan_writes`) | R7-A1, AUD-4 | **CONDITIONAL**: the four-eyes step now requires the center (HD-S04) and a token. The approver must check the requester actually issued the token (system_log `operator_token_issued`) until R7-A1 is fixed. Restrict who holds the app DB credentials. |
| L05/L06 Finance / PPM ledgers | R7-A2 | **CONDITIONAL** (L05 stays NO-GO for other seats' reasons). Apply `harden-audit-grants.sql` and set `SDP_LEDGER_SCHEMA` **before** relying on ledgers or anchors as evidence. Without that, the chain check can be made to say "ok". |
| L07 Publication / soft delete | AUD-6 | **CONDITIONAL** |
| L08 Governance cadence | four-eyes via the center | **CONDITIONAL** |
| L12 Access security | fix 26 holds (R7-A3) | **CONDITIONAL**: G01 must name who may reset super_admin credentials and who holds the DB credentials |
| L13 Ops resilience, including `policy_center_enabled` | R7-A3 holds; the center cannot be turned off alone | **CONDITIONAL**: G05 empty, DBA hardening step, R7-A2 |
| L14 Portfolio Lots 1–5 | four-eyes switches through the center | **CONDITIONAL**, as L03 |
| L15 Adoption Lot B | none in this area | **GO PILOT** from the audit angle |
| L16 Portfolio phase 2 | out of pilot | **CONDITIONAL / out of pilot** |
| Activation tool | R6-A1 partially fixed | `--plan` / `--dry-run` **GO**; `--apply` on 4EYES lots **CONDITIONAL** (center ON + token + approver check of the issuance event) |
| Business-readiness pack | E7 | **No invented approval** (verified). One stale "non fusionné" line. |

## 5. Human gates (RELEASE-GATES rows) still empty in this area

All 21 dossier rows have 0 decisions, and `docs/ops/flag-decisions.json` has no decided items. The relevant rows:
- G01, access policy. It must name who may reset super_admin credentials, who holds the app DB credentials, and who may run `activate-switches --apply` (R7-A1).
- G02, threat model and findings: take in R7-A1 and R7-A2.
- G05, backup/restore RPO-RTO.
- G07, closure policy D-04.
- G08, handoffs.
- G15, product business acceptance.
- G17, production GO/NO-GO.
- G18, penetration test.
- G19, QA lead: CI green on the target SHA, and skips reviewed.

Also still open: the DBA/CAB step that applies `tools/pg/harden-audit-grants.sql` and sets `SDP_LEDGER_SCHEMA` (R7-A2), the HD-S04 decision to turn the Policy Center on (a precondition for every 4EYES lot through the CLI), and a named independent second super_admin.

*AI review — not an independent human review.*
