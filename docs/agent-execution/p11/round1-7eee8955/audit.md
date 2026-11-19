# P11 — Audit/risk seat findings

**AI review — not an independent human review.** Frozen SHA `7eee8955568c0bcab2a6329f838ee432ffca9fd1` (clone `/home/user/qual/audit`, `docs/agent-execution/` narratives removed on purpose; gate dossiers copied back). Reviewer did not write this code, modified no product code, touched no live system. Throwaway attack tests lived only in the session scratchpad (not committed).

## 1. Evidence re-run (command · result · SHA)

| # | Command | Result at 7eee895 | Status |
|---|---|---|---|
| E1 | `node tools/test/run-all.js` (run 1, earlier PG max_connections) | 5448 tests, 25 fail, 10 skip; guard FAIL (3 files under manifest). Failures = `sorry, too many clients already` (environment) + removed narratives | reproduced, discarded (environment) |
| E2 | `node tools/test/run-all.js` (run 2, max_connections 400, 26 min) | 839/839 files, **5454 tests, 5428 pass, 16 fail, 10 skip** (10 × "no prod-snapshot", within allow-list max 10); floor 5438 met; guard FAIL: `agent-inventory.test.js reported 1 tests, manifest expects at least 4`; EXIT=1. Log `/home/user/qual/out/audit-fullsuite.log` | reproduced — **FAIL in this clone**; all 16 failures + the manifest drop trace to files under the deliberately removed `docs/agent-execution/` (ENOENT on INVENTORY.json, EVIDENCE-MANIFEST.md, G24-DOSSIER-GO-NOGO-FR.md, GOAL_TRACKER.csv, P08-unknown-sweep.json, INVENTORY-STRICT.md, TRACEABILITY.md, P0x-*.md…). No failure outside that set. |
| E3 | `node tools/release/gate-dossiers.js --check` | exit 1 — STALE: 7 cited files missing + 7 awaited globs now empty (all under removed narratives). Manifest target_sha `ccaeb0a3` = parent of 7eee895; diff ccaeb0a..7eee895 outside docs/agent-execution = none | reproduced — FAIL in this clone (environmental) |
| E4 | `node tools/agent/switch-lots.js --check` | exit 0 "switch lots up to date" | **verified PASS** |
| E5 | `node tools/agent/flag-register.js --check` | exit 0 "flag register up to date" | **verified PASS** |
| E6 | RELEASE-GATES.md decision/name/date/evidence/SHA/conditions cells | all 21 rows empty | **verified** (no invented approval) |
| E7 | `docs/ops/flag-decisions.json` items | 0 items — no owner/canary/expiry/trigger filled by an agent | **verified** |
| E8 | Dark-switch defaults: register `default` vs `services/reportConfig.js DEFAULTS` for all 152 dark entries | 0 mismatches | **verified** |

**Not verified:** (a) full suite green on a pristine tree at 7eee895 (narratives absent here); (b) gate-dossiers `--check` PASS on a pristine tree; (c) CI green on the target SHA (QA-lead gate); (d) each lot's forced-switch targeted runs (not assigned to this seat).
Counts: verified 5 (E4–E8) · reproduced-but-failing-for-environment 3 (E1–E3, conclusion on pristine tree NOT verified).

## 2. Attacks (claim · attack · outcome)

**A1 — Four-eyes on commitment closure (claim: "the verifier is never the accountable owner, never an execution owner and never the creator", `services/commitmentLifecycle.js:7-10`).**
Attack (PG throwaway DB): creator `coord.x` creates a commitment with owner `it.owner`, reviewer `biz.reviewer`; `it.owner` (site editor) moves it to `awaiting_verification`; self-verify → 403 (good). Then `it.owner` calls `store.update(id, {accountable_owner:'someone.else', reviewer:'it.owner'})` — allowed in `awaiting_verification` (only TERMINAL is read-only, `services/commitmentStore.js:173-174`; `EDITABLE` includes `accountable_owner`, `execution_owners`, `reviewer`, line 21; route `PUT /api/commitments/:id` only checks site-editor, `routes/commitments.js:357-362`). Then transition → `verified_closed`.
**Outcome: BROKEN** — `OUTCOME: CLOSED by it.owner`. Event trail shows only `["updated",{"fields":["accountable_owner","reviewer"]}]` — no old/new values, so the re-pointing cannot be reconstructed from the hash-chained log. Contrast: handoffs record `delivered_by` at transition time and check it (`services/handoffLifecycle.js:78`) — not bypassable this way.

**A2 — Append-only + hash-chained audit tables (claim: "a row edited or deleted behind the application … breaks the chain", `db/postgres/reports/034_audit_hash_chain.sql:1-4`).**
Attack on `commitment_events`: UPDATE → refused by trigger (good). As the table-owner role: `ALTER TABLE … DISABLE TRIGGER commitment_events_append_only; DELETE` the last row; re-enable; then `TRUNCATE`.
**Outcome: PARTLY HOLDS** — `auditChain.verify` returns `ok:true` after tail deletion (rows 3→2, new head) and after TRUNCATE (rows 0, head null). Detection relies only on a human comparing today's head with yesterday's anchor logged in `system_log`; `audit.chain_verify` (`services/sync/jobs.js:147-152`) never compares with the previous anchor, and `system_log` is itself purged by `audit.retention`.

**A3 — Suite integrity (claim: "no hidden skip", "proves every file reported", `tools/test/run-all.js`, `tools/test/guard.js`).**
Attack: a test marked `{todo:'later'}` with a failing assertion, fed through `file-reporter.mjs` + `guard.check/checkSkips`.
**Outcome: BROKEN** — node exits 0, reporter emits `ok:false` but `skip:null`, guard `ok:true, problems:[]`, `failed:1` (run-all exits on `r.status` + problems only, `run-all.js:72`). A failing check can be parked as `todo` without tripping the skip allow-list or the exit code. (No `todo` is used in the suite today — verified by grep.) Positive: the manifest floor did catch the file-level collapse in E1/E2.

**A4 — Switch governance (claim: lots are PROPOSED, dependencies ordered, nothing approved).**
Attack (code reading): `PUT /api/reports/config` (`routes/adminConfig.js:84-124`) lets ONE super_admin set any dark switch; prerequisites are warnings only (`services/switchPrereqs.js:3` "Nothing is blocked"); lot `depends_on` (e.g. `mywork_awaiting_me_enabled` → `commitments_enabled`) is not enforced at runtime; the HIGH-risk access-widening `portfolio_editor_plan_writes` (L03, "STOP-AND-REPORT") has no prerequisite entry at all; `flag-decisions.json` being empty does not block activation.
**Outcome: claim holds as documentation, not as a control** — activation without owner/canary/decision is possible and only journalled.

**A5 — Rollback rehearsal (claim in SWITCH-LOTS.md: "data written while on … is no longer shown or acted on; the rehearsal is tests/switch-lots-rollback.test.js").** The test flips config on then off with no traffic/jobs in between and its own header says it "does NOT prove the behaviour while on". **Outcome: overclaim in the generated Markdown** (the test proves only that setConfig does not touch data).

**A6 — Two-person delete (`services/softDelete.js:92-104`).** Requester cannot confirm (good), but a deputy of the requester is not excluded (unlike `sodPolicy` `no_deputy_verification`). Outcome: minor gap, dark switch.

## 3. Findings

| Id | Sev | Title | Reproduction | Regression test to add | Rollback risk |
|---|---|---|---|---|---|
| AUD-1 | **P1** | Commitment four-eyes bypassable by re-pointing `accountable_owner`/`reviewer` while `awaiting_verification`; event log keeps field names only | A1 above (PG test DB, `services/commitmentStore.js` update → transition) | store test: after `awaiting_verification`, owner edits owner/reviewer → verify must 403 (freeze owner/executors/reviewer from `awaiting_verification`, or evaluate `isSelf` against identities recorded at `technical_completed_at`); event must record from/to values | low (behind `commitments_enabled`, default 0) |
| AUD-2 | P2 | Hash-chain verify blind to tail deletion / TRUNCATE; no automatic anchor comparison; owner role can disable the append-only trigger | A2 above | `audit.chain_verify` compares head/row count with the previous anchor (stored outside the purgeable `system_log`) and fails on regression; DB role separation (app role not table owner) | low |
| AUD-3 | P2 | Test guard: failing `todo` tests pass the run (exit 0, not counted as skip) | A3 above | guard: treat `todo` (and `ok:false`) as a problem unless allow-listed like skips; add case to `tests/test-runner-guard.test.js` | none |
| AUD-4 | P2 | Switch activation is single-person, prerequisites/dependencies advisory, flag-decisions not consulted; `portfolio_editor_plan_writes` lacks a prerequisite | A4 above | config PUT: refuse a dark switch whose lot dependency is off; require a filled `flag-decisions.json` entry (or a second super_admin) for HIGH-risk switches | low |
| AUD-5 | P3 | SWITCH-LOTS.md rollback sentence overstates what `switch-lots-rollback.test.js` proves | A5 | reword generator text or add an on-traffic-off rehearsal | none |
| AUD-6 | P3 | Two-person delete does not exclude the requester's deputy | A6 | `twoPersonStep` through `sodPolicy.evaluate` | none |
| AUD-7 | P3 | Register/code drift outside dark set: `ui_inject_dash_key` register default `null`, code default `'1'`; `sync_alert_enabled` arm switch default `'1'` with no owner (inert while recipients empty) | `node -e` compare of `FLAG-REGISTER.json` vs `reportConfig.DEFAULTS` for non-dark keys | flag-register check covers non-dark defaults | none |
| AUD-8 | P3 | `drop-test-dbs.js` (run by run-all) drops idle `sdp_tracker_test_*` DBs of parallel runs (TOCTOU on "busy" check) | read `tools/test/drop-test-dbs.js:13-21` | scope sweep to DBs created by this run (pid tag) | none (test infra only) |
| AUD-9 | P3 | ~16 tests (gate/inventory/traceability/kpi sweep) depend on narrative files in `docs/agent-execution/`; a clone without them fails, so suite green ≠ product green | E2 | label these as "evidence-document" tests in the manifest | none |

P0: **0**. P1: **1** (AUD-1).

## 4. Per-lot recommendation (AI panel recommendation, not a decision)

| Lot | Touches audit area via | Recommendation |
|---|---|---|
| L01 Daily work | `commitments_enabled`, `mywork_awaiting_me_enabled` (four-eyes) | **CONDITIONAL** — GO PILOT for the UI-only switches; **NO-GO for `commitments_enabled` / `mywork_awaiting_me_enabled` until AUD-1 fixed** |
| L03 Change control | `portfolio_editor_plan_writes` (widens writes), baselines append-only | **CONDITIONAL** — access-policy owner decision + AUD-4 prerequisite first |
| L07 Publication / soft delete | `soft_delete_two_person` | **CONDITIONAL** (AUD-6 minor) |
| L08 Governance cadence | handoffs, decisions, `a01_missing_due_date` (commitments) | **CONDITIONAL** — handoff four-eyes held; `a01_missing_due_date` follows L01 commitments status; Closure-policy / Handoffs gates empty |
| L12 Access security | approvals, recertification, breakglass | **CONDITIONAL** — Security access-policy gate empty; no break found in this seat |
| L13 Ops resilience | `restore_drill_full`, `entra_deprovision_enabled` | **CONDITIONAL** — Backup/restore gate empty; AUD-2 anchor gap |

## 5. Human gates (RELEASE-GATES rows) still empty in this area
All 21 rows are empty (verified). Directly relevant to audit/risk: Security — access policy CG-01/CG-02 · Security — threat model and findings register (G27) · Backup / restore RPO-RTO (G-11) · Closure policy D-04 (G-17/G-18) · Handoffs (G-22) · QA lead — CI green on the target SHA, skipped tests reviewed (E-B05) · Product — business acceptance · Production deployment GO/NO-GO · Penetration test / accepted analysis.
No agent filled any decision cell; `flag-decisions.json` holds 0 entries.
