# P11 — Audit/risk seat, ROUND 2

**AI review — not an independent human review.** Frozen SHA `b2e85cd08860a57526442797ac711e2fc9defc3a` (clone `/home/user/qual/audit`, narratives under `docs/agent-execution/` removed on purpose, gate dossiers copied back). The reviewer did not write this code, modified no product code, touched no live system, pushed/merged/tagged nothing, filled no human decision. Throwaway attack tests lived only in the session scratchpad (`.../scratchpad/r2/aud1.test.js`, `todo.test.js`), never committed. Round-1 file `/home/user/qual/out/audit.md` left untouched.

## 0. Round-1 findings — status at b2e85cd

| R1 id | Sev | Claimed fixed by | Re-run | Status |
|---|---|---|---|---|
| AUD-1 commitment four-eyes bypass (re-point owner/reviewer while `awaiting_verification`, then self-verify) | P1 | `824b869` (submission snapshot in the `awaiting_verification` event; reviewer re-point refused; old/new values logged) | Original repro re-run on a PG throwaway DB: `update({accountable_owner:'someone.else', reviewer:'it.owner'})` after submission → **403** "the reviewer cannot be the owner, an executor, the creator or the submitter". Same during a rework round (R3) → **403**. Event log now carries `changes:{field:{from,to}}`. | **PARTIAL** — the exact R1 sequence is closed; a variant still breaks the rule (see NEW-1). |
| AUD-2 hash-chain verify blind to tail delete / TRUNCATE, no automatic anchor comparison | P2 | — | `services/sync/jobs.js:145-152` and `services/auditChain.js` unchanged since 7eee895 | **NOT FIXED** |
| AUD-3 failing `todo` test passes the run | P2 | `4233dea` | Throwaway file with `{todo:'later'}` failing, dynamic `t.todo('dyn')` failing: node exits 0, reporter now emits `todo`, `census` counts both under `todo: <reason>`, `checkSkips` returns 2 problems ("unlisted reason") → run would FAIL. `check()` also now adds "N test(s) failed" independent of exit code (visible in the full-suite guard output). | **FIXED** |
| AUD-4 switch activation single-person, prerequisites advisory, `portfolio_editor_plan_writes` no prerequisite | P2 | — | `services/switchPrereqs.js:3-4` still "Nothing is blocked"; `grep portfolio_editor_plan_writes services/switchPrereqs.js` → no hit; `routes/adminConfig.js` unchanged | **NOT FIXED** |
| AUD-5 SWITCH-LOTS.md rollback sentence overclaims | P3 | — | `docs/ops/SWITCH-LOTS.md:52,75` unchanged wording | **NOT FIXED** |
| AUD-6 two-person delete does not exclude the requester's deputy | P3 | — | `services/softDelete.js` `twoPersonStep` compares `actor_id` only | **NOT FIXED** |
| AUD-7 register/code drift: `ui_inject_dash_key` | P3 | — | register: `kind:"secret", default:null`; code `reportConfig.DEFAULTS.ui_inject_dash_key = '1'`. `sync_alert_enabled` still `owner_role:null`. Root cause visible: classified `secret` because the name contains "key". | **NOT FIXED** |
| AUD-8 end-of-run DB sweep drops parallel runs' idle DBs | P3 | `a8a31c3` | Code: run-all sets `SDP_TEST_RUN_ID`, `pg-helpers.testDbName` embeds it, `drop-test-dbs.js --run=<id>` matches `^sdp_tracker_test_<id>_[a-z0-9]+$` only (non-run names have no `_` after the prefix, so no collision). Full run printed `[test-db] dropped 848` = exactly its own file count; parallel seats ran concurrently. | **FIXED** (by code reading + run output; no cross-seat incident observed) |
| AUD-9 ~16 tests depend on narrative files; suite green ≠ product green | P3 | — | Same 16 failures recur at b2e85cd (E1) | **NOT FIXED** (by design; still unlabelled) |

## 1. Evidence re-run at b2e85cd (command · result)

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `node tools/test/run-all.js` (PG max_connections 400; 26 m 15 s) — log `/home/user/qual/out/r2-audit-fullsuite.log` | 848/848 files reported · **5493 tests, 5467 pass, 16 fail, 10 skip, 0 todo** · floor 5477 met · skip 10 × "no prod-snapshot" (allow-list max 10, at the ceiling) · guard FAIL: "16 test(s) failed" + "agent-inventory.test.js reported 1 tests, manifest expects at least 4" · EXIT=1 | reproduced — **FAIL in this clone**. All 16 failures read files under the deliberately removed `docs/agent-execution/` (ENOENT on EVIDENCE-MANIFEST.md, G24-DOSSIER-GO-NOGO-FR.md ×4, GOAL_TRACKER.csv ×2, INVENTORY.json, P08-kpi-dossiers.md, TRACEABILITY.md, F-UAT.md, CONNECTOR-QUALIFICATION-*.md; `kpi-unknown-sweep` reads its justifications from `P08-unknown-sweep.json`; INVENTORY-STRICT / P09 inventory are generated-doc freshness checks). **No failure outside that set.** Pristine-tree green NOT verified. |
| E2 | `node tools/release/gate-dossiers.js --check` | exit 1 — 7 cited files missing + 7 awaited globs empty, all under removed narratives. Dossier `target_sha` = `7148dc5e`; `git diff --name-only 7148dc5e HEAD` outside `docs/agent-execution/` = **empty** | reproduced — FAIL in this clone (environmental); pristine PASS not verified |
| E3 | `node tools/agent/switch-lots.js --check` | exit 0 "switch lots up to date" | **verified PASS** |
| E4 | `node tools/agent/flag-register.js --check` | exit 0 "flag register up to date" | **verified PASS** (but see AUD-7: "up to date" ≠ "correct") |
| E5 | RELEASE-GATES / gate dossiers decision cells | every dossier says "Decision cell … empty — this gate is NO-GO until the approver fills it. This dossier fills nothing." (21/21) | **verified** — no invented approval |
| E6 | AUD-1 repro (R1) + R3 on PG | 403 both | **verified** |
| E7 | AUD-3 todo repro | guard flags both todos | **verified** |

Counts: **verified 6** (E3–E7 + AUD-8 sweep output) · **not verified 2** (E1/E2 pass on a pristine tree; also not verified: CI green on target SHA, per-lot forced-switch runs — not assigned).

## 2. New attacks (claim · attack · outcome)

**NEW-1 — Four-eyes, commitments (claim `services/commitmentLifecycle.js:9-12`: "the verifier is never the accountable owner … re-pointing owner/reviewer after submission cannot open a self-verification").**
Attack (scratch test R2, PG throwaway DB): creator `coord.x`; owner `it.owner`; executor `it.exec`; reviewer `biz.reviewer`. `it.owner` moves it to `in_progress`, then — **before submission** — `update({accountable_owner:'someone.else', reviewer:'it.owner'})` (the new reviewer check only runs when `c.submission` exists, `services/commitmentStore.js:206`). `it.exec` submits normally. `it.owner` verifies.
**Outcome: BROKEN** — `CLOSED by it.owner`. Mitigation now present: the event log shows `changes:{accountable_owner:{from:'it.owner',to:'someone.else'}, reviewer:{from:'biz.reviewer',to:'it.owner'}}`, so it is reconstructable after the fact, and the executor's honest submission is required. Second residual: a commitment already in `awaiting_verification` before upgrade has no snapshot (only `submitted_by = event actor`), so its former owner can re-point and verify (read from `submissionOf`; dark switch, likely 0 rows).

**NEW-2 — Suite integrity (claim run-all/guard: "no hidden skip").** Attack: `describe.skip('hidden suite', …)` with a failing inner test. Outcome: **PARTLY HOLDS** — the suite event carries `skip:"no reason given"` but `census` drops `kind==='suite'` events, so the skip is never checked against the allow-list; inner tests are not reported at all. Caught only if the file's manifest count drops; a NEW file (or a manifest regenerated with `--update-manifest`) absorbs it silently. `grep` → no `describe.skip`/suite-level skip in `tests/` today.

**NEW-3 — Gate dossiers vs evidence (claim: dossiers cite the evidence the approver needs).** G07 (closure policy, scope `commitments_enabled=1`) cites `commitment-lifecycle`, `commitment-escalation`, `commitments-routes.smoke` but **not** `tests/commitment-store.test.js` (where the AUD-1 four-eyes proof lives), and its §5 residual risks omit the four-eyes residual (NEW-1). Outcome: **gap** — the approver of D-04 is not shown the strongest risk.

**NEW-4 — Dark-switch governance (re-attack AUD-4).** No change since round 1; activation remains one super_admin, prerequisites advisory. Outcome: claim holds as documentation only.

## 3. Findings (round 2)

| Id | Sev | Title | Reproduction | Regression test to add | Rollback risk |
|---|---|---|---|---|---|
| AUD-1/NEW-1 | **P1** | Commitment four-eyes still bypassable: owner re-points owner+reviewer **before** submission, executor submits, former owner verifies | NEW-1 above (store API, PG; route `PUT /api/commitments/:id` only checks site-editor) | in `commitment-store.test.js`: owner-at-any-time since `committed` (from the `changes` history) cannot verify; or reviewer cannot be set to anyone who held owner/executor/creator; and legacy-event case | low — behind `commitments_enabled` (default 0) |
| AUD-2 | P2 | Hash-chain verify blind to tail delete/TRUNCATE; no automatic anchor comparison | R1 A2 (unchanged code) | job compares head/row count to previous anchor stored outside purgeable `system_log` | low |
| AUD-4 | P2 | Switch activation single-person; lot deps / prerequisites advisory; `portfolio_editor_plan_writes` lacks a prerequisite | R1 A4 (unchanged) | config PUT refuses a switch whose lot dependency is off; HIGH-risk switch needs a filled `flag-decisions.json` entry or second approver | low |
| NEW-2 | P3 | Suite-level `describe.skip`/`todo` not counted by the skip allow-list | throwaway `describe.skip` + guard (`census` skips `kind:'suite'`) | count suite skips/todos in `census`; case in `test-runner-guard.test.js` | none |
| NEW-3 | P3 | G07 dossier omits the four-eyes test and residual | read `gate-dossiers/en/G07-*.md` §2/§5 | add `tests/commitment-store.test.js` to G07 evidence + residual line | none |
| AUD-5 | P3 | SWITCH-LOTS rollback sentence overclaims | unchanged | reword generator | none |
| AUD-6 | P3 | Two-person delete ignores requester's deputy | unchanged | route via `sodPolicy` | none |
| AUD-7 | P3 | `ui_inject_dash_key` mis-classified `secret`/default null vs code `'1'` (name heuristic); `sync_alert_enabled` arm switch no owner | `node -e` register vs `reportConfig.DEFAULTS` | flag-register: classify by declaration not name; check non-dark defaults | none |
| AUD-9 | P3 | 16 tests depend on narrative docs | E1 | label as evidence-document tests | none |

**P0: 0. P1: 1** (AUD-1 residual / NEW-1). Fixed since round 1: AUD-3, AUD-8 (and AUD-1 partially).

## 4. Per-lot recommendation (AI panel recommendation, not a decision)

| Lot | Audit-area touchpoint | Recommendation |
|---|---|---|
| L01 Daily work | `commitments_enabled`, `mywork_awaiting_me_enabled` | **CONDITIONAL** — GO PILOT for UI-only switches; **NO-GO for `commitments_enabled` / `mywork_awaiting_me_enabled` until NEW-1 closed** (or the pilot verifier role is restricted to admin-tier with procedural control, decided by a human) |
| L03 Change control | `portfolio_editor_plan_writes` | **CONDITIONAL** — access-policy owner decision + AUD-4 prerequisite |
| L07 Publication / soft delete | `soft_delete_two_person` | **CONDITIONAL** (AUD-6 minor) |
| L08 Governance cadence | handoffs, decisions, `a01_missing_due_date` | **CONDITIONAL** — follows L01 commitments; handoff four-eyes not re-broken this round |
| L12 Access security | approvals, recertification, breakglass | **CONDITIONAL** — Security access-policy gate empty; no new break found |
| L13 Ops resilience | `restore_drill_full`, `entra_deprovision_enabled` | **CONDITIONAL** — Backup/restore gate empty; AUD-2 open |

## 5. Human gates (RELEASE-GATES rows) still empty in this area
All 21 rows empty (each dossier: "This dossier fills nothing"). Directly relevant: Security access policy CG-01/CG-02 (G01) · Threat model & findings (G02) · Backup/restore RPO-RTO (G05) · Closure policy D-04 (G07) · Handoffs (G08) · QA lead — CI green on target SHA, skips reviewed (G19) · Product business acceptance (G15) · Production deployment GO/NO-GO (G17) · Penetration test (G18). `docs/ops/flag-decisions.json`: 0 entries.
