# P11 — Audit/risk seat, ROUND 9 (re-check)

*AI review — not an independent human review.* Clean clone `/home/user/qual/audit` at **928ca8f03c0680acfb2b3eb0c871ba286934c8dd** (tag `qual-p11-928ca8f0`; `docs/agent-execution/` narratives removed on purpose, gate dossiers copied back). Run id `auditr9`. No product code changed; throwaway attack tests live under `/tmp/claude-0/p11attack-r9/` (not committed). Nothing pushed, merged, tagged; no human decision filled.

## 0. Round-8 findings in this area — status at 928ca8f0 (after fixes 34–36)

| Id | r8 sev | Re-check (command / outcome) | Status |
|---|---|---|---|
| **R8-A2** rotation resume re-baselines a truncated ledger (owner deletes anchors + foreign-kid anchors) | P3 (P2 until hardened) | `r8chain.test.js` re-run verbatim (paths point at this clone). R8-C1: after anchor delete + `kid=deadbeefdeadbeef` anchors → verify `broken … row count shrank from 3 (last anchor) to 2 … (highest position the nightly job logged as anchored in system_log)`; nightly **throws** "unknown key id … audit_chain_meta has no 'kid:deadb…'"; after: `ok=false broken`. R8-C2: `broken`, nightly throws. | **FIXED** (for the stated repro). Owner-only residual remains, see R9-A1 (stated in ADR-P11-R8 §1). |
| **R8-A1** `source='cli'` request with no token approvable | P3 | `r8imp.test.js` re-run: **R8-5 → 409** "filed outside the web session flow (source cli) but names no operator token … refused", value stays 0; R8-1/2/3 still refused; R8-4 (DB + key holder) still 200 (stated residual); R8-6 → 409 when run in isolation (failed once in the combined run because of state left by earlier subtests in my own file, not the product). | **FIXED for the literal repro; class still open** — see R9-A2 (forger controls `source`; ADR §3 states it). |
| AUD-4 center OFF → one super_admin relaxes audit/approval controls | P2 → partial (policy) | `r7gov.test.js`: `AUD-4 center OFF legacy PUT -> 200 stored 0 0` | **PARTIAL / unchanged** (HD-S04 / G01 decision) |
| R3-A2r flag register recognises only `'1'` | P3 | `git log 7afb9536..HEAD -- tools/agent/flag-register.js` → 0 | NOT FIXED |
| PC-log `policy_change_requests` mutable, not chained | P3 | no trigger / not in `auditChain.TABLES`; enabler of R9-A2 | NOT FIXED |
| N2 reviewer alias at set-up | P3 | not re-run; code untouched | NOT FIXED (assumed, not re-verified) |
| NEW-2 suite-level `describe.skip` not counted | P3 | `tools/test/guard.js` → 0 commits | NOT FIXED |
| NEW-3 G07 stale label | P3 | `gate-dossiers/en/G07…:28` still "Routes answer 404 while the switch is off" | NOT FIXED |
| AUD-5 SWITCH-LOTS rollback overclaim | P3 | SWITCH-LOTS.md changed (counts only); lines 55/78 still "set every switch of the lot back to its default 0" | NOT FIXED |
| AUD-6 two-person delete ignores deputy | P3 | `services/softDelete.js` → 0 commits | NOT FIXED |
| AUD-7 `ui_inject_dash_key` kind `secret`, owner unnamed | P3 | FLAG-REGISTER.md → 0 commits | NOT FIXED |
| AUD-9 tests depend on removed narratives | P3 | same 16 failures (E1) | NOT FIXED (environmental) |

## 1. Evidence re-run at 928ca8f0

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `PG_ADMIN_URL=… SDP_TEST_RUN_ID=auditr9 node tools/test/run-all.js` (log `/home/user/qual/out/r9-audit-fullsuite.log`) | files **941/941** · tests **6075** · failed **16** · skipped 10 · floor **6050** met · skip 10 × "no prod-snapshot" (2 files) · 1721 s · guard FAIL "16 test(s) failed" + "agent-inventory reported 1, manifest expects ≥ 4". Failing files: agent-inventory, business-readiness, evidence-baseline, gate-dossiers ×3, inventory-strict, p09-adoption-kit, release-dossier ×4, traceability ×3, uat-committee — same 9 files / 16 tests as r8, every one an ENOENT / "regenerate" on a removed `docs/agent-execution/` file. **0 non-environmental failures.** Test DBs swept (`[test-db] dropped 1`; 0 `auditr9` databases left). | Reproduced; red for environmental reasons only. Green on a pristine tree **not verified** |
| E2 | `node tools/release/gate-dossiers.js --check` | exit 1, 14 problems: 7 cited files missing + 7 awaited globs empty, all under the removed narratives; **0** script / script-dep / evidence-hash mismatch. Manifest `target_sha` `bcc729eb` = HEAD~1 (HEAD is a dossier refresh). | Reproduced (environmental FAIL). Pristine PASS **not verified** |
| E3 | `node tools/agent/switch-lots.js --check` | exit 0 "switch lots up to date" | **Verified PASS** |
| E4 | `node tools/agent/flag-register.js --check` | exit 0 "flag register up to date"; `docs/ops/flag-decisions.json` items **0** | **Verified PASS** ("up to date" ≠ decided) |
| E5 | Gate-dossier manifest decisions | 21 rows, **0** decided | **Verified**: no invented approval |
| E6 | Manifest ratchet 7afb9536 → HEAD | total 6018→**6050**, files 935→941, **0 decreased, 0 removed**; `tests/.skip-allowlist.json` and `tools/test/guard.js` unchanged (only `perf-budget-check.js` changed under `tools/test/`) | **Verified** |
| E7 | RELEASE-GATES.md decision column | 21/21 rows EMPTY | **Verified** |
| E8 | r8 repros re-run (`r8chain`, `r8imp`, `r7gov`) | see §0 | **Verified** |

Counts: **verified 6** (E3–E8). E1, E2 reproduced but red for environmental reasons. **Not verified 3**: E1 green on a pristine tree, E2 PASS on a pristine tree, CI green on the target SHA.

## 2. New break attempts (claim · attack · outcome), aimed at fixes 34–36

**R9-A1 — audit chain, rotation resume (fix 36 kid history + system_log high-water mark). Owner can still launder. P3, stated residual.** Claim: an unknown kid never resumes; the logged high-water mark stops a truncated ledger. Attack `/tmp/claude-0/p11attack-r9/tests/r9chain.test.js` R9-C1 (owner, unhardened): anchor 3 rows → delete tail row → delete all anchors → `DELETE FROM system_log WHERE action LIKE 'audit_chain%'` (`system_log` has **no** trigger at all: `[]`) → insert `kid=deadbeefdeadbeef` anchors matching the 2-row chain → `INSERT INTO audit_chain_meta ('kid:deadbeefdeadbeef','attacker')` → verify `unverifiable (key rotated)` → nightly resumes (`key_rotated from deadbeef…`) → verify **`ok=true status=ok integrity=signed rows=2`**. R9-C2 (log scrubbed, no meta kid) → `broken`, nightly throws (holds). **R9-C3 (app-role-feasible after hardening: no anchor delete; scrub log + meta kid + foreign anchor appended) → `broken`, nightly throws (holds).** ADR-P11-R8 §1 "Residual" states exactly this owner path and the app-role meta INSERT; so honest, but the two fix-36 signals (meta, system_log) are both in the owner's reach and `system_log` is not even append-only for the app role. Control remains `harden-audit-grants.sql` (DBA/CAB, not applied as far as this repo shows).

**R9-A2 — "token evidence required for every CLI-filed request" (fix 36). Bypass by labelling the forged row as a web request. P3, stated residual.** Claim: a request filed outside the web flow must name a verifiable operator token. The check keys on `pr.source === 'cli'` or the reason marker (`routes/policyCenter.js:181`) — both written by the forger. Attack `/tmp/claude-0/p11attack-r9/tests/r9imp.test.js` (DB login only, no key): `INSERT INTO policy_change_requests (… requested_by=pc_super2, reason='pilot wave 2 change', status='pending', source=X)` then approve as pc_super: `source='web'` → **200, value 1**; `'CLI'` → **200**; `'cli '` (trailing space) → **200**; `'session'` → **200**; omitting `source` gives the column default `'policy_center'` (120_policy_change_requests.sql:21), identical to a genuine web request. No CHECK constraint on `source`. ADR-P11-R8 §3 states the default-source case; the case/whitespace variants (`'CLI'`, `'cli '`) are not mentioned and are cheap to close (`lower(trim(source))`), though they do not change the class. Impact unchanged: the same login can `UPDATE report_config` directly, so this is a forged second-person record, not an escalation.

**R9-A3 — failed Policy Center apply (fix 34). HOLDS.** `/tmp/claude-0/p11attack-r9/tests/r9fail.test.js`: pending request `auth_account_throttle_max 20→99999` approved by a second super_admin → **400** "maximum 1000"; row `status=failed`, `decision_reason="approve it | apply failed: …"`, value stays **20**, `policy_change_failed` event journalled with request/from/to/cause.

**R9-A4 — restore-drill counts bound to their dump by sha256 (fix 36). Downgrade by stripping the binding. P3.** `/tmp/claude-0/p11attack-r9/cnt.js`: counts file with a wrong `dump_sha256` → refused ("another sha256"); the **same foreign counts file with `dump`, `dump_sha256`, `dump_bytes` removed** → `{counts:{users:999}, problem:null, unbound:true}` — used as the reference. `services/backup.js:116-123`: the name check runs only `if (j.dump && …)`, so with no `dump` field nothing is checked, while `tools/pg/restore-drill.js:264` prints "only its dump name was checked" — a false statement in the drill report. Binding is opt-in by the file it is meant to verify. Impact: wrong reference counts in the G05 restore drill (false mismatch or a forged match); requires write access to the backup directory. Fix: refuse (or use live counts, labelled) when a counts file has no `dump` field; time-box the legacy acceptance; fix the note wording.

**R9-A5 — perf minimum samples (fix 36, PROPOSED 5). Fail-open on a non-numeric `n`. P3.** `check({c:{p95:10,n:'x'}},{c:{p95_ms:100}})` → **`within`** (`Number('x') < 5` is false). `n` missing → `no_sample` (correct), `n:1` → `insufficient_sample` (correct). Only malformed input; our own `tools/test/load.js` emits numeric `n`. Fix: `!(Number(o.n) >= min)`.

**R9-A6 — suite integrity. HOLDS.** Floor 6050 met (6075), 0 decreased/removed, skip allow-list unchanged, 941/941 files reported, DBs swept. NEW-2 (`describe.skip`) still uncounted (carried).

## 3. Findings (round 9)

| Id | Sev | Title | Reproduction | Regression test to add | Rollback risk |
|---|---|---|---|---|---|
| R9-A1 | **P3** (P2 until `harden-audit-grants.sql` applied) | Unhardened owner scrubs `system_log` audit_chain events + adds `kid:` meta row → rotation resume re-baselines a truncated ledger to ok/signed (stated residual) | `cd /home/user/qual/audit && PG_ADMIN_URL=postgres://sdptest:sdptest-local-only@localhost:5432/postgres SDP_TEST_RUN_ID=auditr9 NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit /tmp/claude-0/p11attack-r9/tests/r9chain.test.js` → `R9-C1 after resume: true ok signed 2` | Hardening step proven in a test against a hardened schema; optionally sign the kid history / HWM outside the DB; make `system_log` audit_chain rows append-only for the app role | Low |
| R9-A2 | **P3** | Forged policy request with `source` ≠ `'cli'` (`web`, `CLI`, `cli `, default) approvable with no token evidence (stated residual for the default; case/space variants not stated) | same harness, `/tmp/claude-0/p11attack-r9/tests/r9imp.test.js` → `R9-P1 src="web" APPROVE 200 … value 1` | Normalise `lower(trim(source))`; CHECK constraint on allowed values; bind web requests to their `policy_change_requested` event or chain the table (PC-log) | Low |
| R9-A4 | **P3** | Restore-drill counts binding is opt-in: a counts file with no `dump`/hash fields is used unchecked; drill note claims a name check that did not happen | `cd /home/user/qual/audit && node /tmp/claude-0/p11attack-r9/cnt.js` → `B fields stripped -> {…"unbound":true}` | Refuse/ignore a counts file without `dump`; assert the note | Low |
| R9-A5 | **P3** | `perf-budget-check` treats non-numeric `n` as `within` | `node -e 'console.log(require("./tools/test/perf-budget-check.js").check({c:{p95:10,n:"x"}},{c:{p95_ms:100}}))'` → `status:"within"` | `!(Number(o.n) >= min)` + test | None |
| AUD-4 | P2 → partial (policy) | Center OFF (default): one super_admin relaxes audit/approval controls | `… r7gov.test.js` → `AUD-4 center OFF legacy PUT -> 200 stored 0 0` | Make "center on" a pilot precondition (HD-S04) | Low |
| R3-A2r, PC-log, N2, NEW-2, NEW-3, AUD-5, AUD-6, AUD-7, AUD-9 | P3 | Carried over (§0) | earlier rounds | as r4–r8 | None |

**P0: 0. P1: 0.** Fixed since round 8: R8-A2 (repro), R8-A1 (literal repro). Fix 34 failed-apply journalling holds. New: R9-A1 and R9-A2 are the residuals the fix-36 ADR itself states (verified true), R9-A4 and R9-A5 are small fail-open edges in fix-36 code.

## 4. Per-lot recommendation (AI panel recommendation, not a decision)

| Lot | Audit-area touchpoint | Recommendation |
|---|---|---|
| Product as shipped (no switch changed) | — | **GO PILOT** on the TEST instance, subject to the empty gates below |
| L01 Daily work (`commitments_enabled`) | commitment four-eyes (unchanged) | **GO PILOT conditional on G07** |
| L03 Change control (`portfolio_editor_plan_writes`) | R9-A2, AUD-4 | **CONDITIONAL**: center ON (HD-S04); approver checks each request's provenance (requester confirms out of band) until PC-log is closed; restrict holders of the DB login and `SDP_CONFIG_KEY` (G01) |
| L05/L06 Finance / PPM ledgers | R9-A1 | **CONDITIONAL** (L05 NO-GO for other seats' reasons). Apply `harden-audit-grants.sql` (re-run after migration 137) before relying on ledgers/anchors as evidence; any `audit_chain_key_rotated` event without a documented rotation = incident |
| L07 Publication / soft delete | AUD-6 | **CONDITIONAL** |
| L08 Governance cadence | four-eyes via the center | **CONDITIONAL** |
| L12 Access security | fix 31 ranges, fix 33/36 token checks | **CONDITIONAL**: G01 names who resets super_admin credentials and who holds DB login + `SDP_CONFIG_KEY` |
| L13 Ops resilience incl. `policy_center_enabled`, restore drill | R9-A1, R9-A4 | **CONDITIONAL**: G05 empty; DBA hardening; drill operator checks the counts-file note |
| L14 Portfolio Lots 1–5 | four-eyes switches through the center | **CONDITIONAL**, as L03 |
| L15 Adoption Lot B | none in this area | **GO PILOT** from the audit angle |
| L16 Portfolio phase 2 | out of pilot | **CONDITIONAL / out of pilot** |
| Activation tool | token binding holds for the CLI path | `--plan`/`--dry-run` **GO**; `--apply` on 4EYES lots **CONDITIONAL** (center ON + server-bound token + web approval) |
| Business-readiness pack | E5/E7 | **No invented approval** (verified) |

## 5. Human gates (RELEASE-GATES rows) still empty in this area

All 21 RELEASE-GATES rows have an empty decision; all 21 dossier manifest rows have 0 decisions; `docs/ops/flag-decisions.json` has 0 items. Relevant: **Security — access policy CG-01/CG-02 (G01)** (who resets super_admin credentials, who holds the app DB login and `SDP_CONFIG_KEY`, who may run `activate-switches --apply`); **Security — threat model (G27)** (take in R9-A1, R9-A2, R9-A4); **CAB — PO-08 cutover** (incl. the DBA step `tools/pg/harden-audit-grants.sql` + `SDP_LEDGER_SCHEMA`); **Backup / restore RPO-RTO (G-11/G05)**; **Closure policy D-04 (G07)**; **Handoffs (G-22/G08)**; **Product — business acceptance**; **Production deployment GO/NO-GO**; **Penetration test**; **QA lead — CI green on target SHA, skips reviewed**. Also open: HD-S04 (Policy Center on), a named independent second super_admin, SRE approval of `min_samples_per_class` (PROPOSED 5).

*AI review — not an independent human review.*
