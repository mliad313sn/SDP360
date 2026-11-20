# P11 — Audit/risk seat, ROUND 3

**AI review — not an independent human review.** Frozen SHA `ead6efb6439296a34915b7d9a47f7011cd15fa82` (clone `/home/user/qual/audit`, narratives under `docs/agent-execution/` removed on purpose, gate dossiers copied back). The reviewer did not write this code, modified no product code, touched no live system, pushed/merged/tagged nothing, filled no human decision. Throwaway attack files live only in the session scratchpad (`/tmp/claude-0/-home-user/29383f9d-be53-578b-8518-d98e0b66dcb7/scratchpad/r3/aud1r3.test.js`, `trig.test.js`, and a throwaway tree copy `.../r3/copy/` used to probe the register generators). Round-1 (`audit.md`) and round-2 (`r2-audit.md`) files left untouched.

## 0. Round-2 findings — status at ead6efb

| R2 id | Sev | Claimed fixed by | Re-run (PG throwaway DB, store API) | Status |
|---|---|---|---|---|
| AUD-1 / NEW-1 owner re-points owner+reviewer **before** submission, executor submits, former owner verifies | P1 | `42bc79e` (repro) + `8253c5e` (`historyOf()` from the append-only event log; `isSelf` refuses every past owner/executor/creator/submitter; reviewer check at ANY status) | R2 repro → **403** "the reviewer cannot be a current or past owner, executor, creator or submitter". R1 repro → 403. R3 (rework round) → 403. Regression test at HTTP level added in `tests/commitments-routes.smoke.test.js` ("P11 NEW-1 …") and green in E1. | **FIXED** |
| AUD-2 hash-chain verify blind to tail delete / TRUNCATE, no automatic anchor comparison | P2 | — | `git diff b2e85cd0 ead6efb6 -- services/auditChain.js services/sync/jobs.js` → empty (the "anchored truncation guard" in 89f2a3d is the **sync** reconciler, not the audit chain) | **NOT FIXED** |
| AUD-4 switch activation single-person; prerequisites advisory; `portfolio_editor_plan_writes` no prerequisite | P2 | — | `services/switchPrereqs.js:4` still "Nothing is blocked"; `grep -c portfolio_editor_plan_writes services/switchPrereqs.js` → 0 | **NOT FIXED** |
| NEW-2 suite-level `describe.skip` not counted | P3 | — | `tools/test/guard.js` `census`: `if (!e.file \|\| e.kind === 'suite') continue;` unchanged | **NOT FIXED** |
| NEW-3 G07 dossier omits four-eyes evidence/residual | P3 | partly, via regeneration | G07 §2 now cites `tests/commitments-routes.smoke.test.js` at `8253c5e3` (which now contains the NEW-1 HTTP test) but still labels it "Routes answer 404 while the switch is off"; `tests/commitment-store.test.js` still not cited (`grep -c` → 0); §5 residual risks still omit segregation-of-duties | **PARTIAL** |
| AUD-5 SWITCH-LOTS rollback sentence overclaims | P3 | — | `docs/ops/SWITCH-LOTS.md:52,75,98` same wording | **NOT FIXED** |
| AUD-6 two-person delete ignores requester's deputy | P3 | — | `services/softDelete.js:99` compares `actor_id` only | **NOT FIXED** |
| AUD-7 `ui_inject_dash_key` classified `secret`; `sync_alert_enabled` no owner | P3 | — | register line 288: kind `secret`, "(secret — not shown)"; code `reportConfig.js:532` default `'1'`; `sync_alert_enabled` owner "to be named" | **NOT FIXED** |
| AUD-9 16 tests depend on narrative docs | P3 | — | same 16 failures (E1) | **NOT FIXED** (by design, unlabelled) |

## 1. Evidence re-run at ead6efb (command · result)

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `node tools/test/run-all.js` (PG max_connections 400; 24 m 34 s) — log `/home/user/qual/out/r3-audit-fullsuite.log` | 855/855 files reported · **5533 tests, 16 fail, 10 skip** · floor 5517 met · skip 10 × "no prod-snapshot" (allow-list max 10, at ceiling) · `[test-db] dropped 855` (own run only) · guard FAIL: "16 test(s) failed" + "agent-inventory.test.js reported 1 tests, manifest expects at least 4" · EXIT=1 | reproduced — **FAIL in this clone, environmental**. All 16 failures are in agent-inventory, evidence-baseline, gate-dossiers ×2, inventory-strict, kpi-dossiers, kpi-unknown-sweep, p09-adoption-kit, release-dossier ×4, traceability ×3, uat-committee — each ENOENT / "missing" on a file under the removed `docs/agent-execution/`. **No failure outside that set.** Pristine-tree green NOT verified. |
| E2 | `node tools/release/gate-dossiers.js --check` | exit 1 — 7 cited files missing + 7 awaited globs empty, all under removed narratives. Dossier target SHA `5ffdd57a`; `git diff --name-only 5ffdd57a HEAD` outside `docs/agent-execution/` → **empty** | reproduced — FAIL here (environmental); pristine PASS not verified |
| E3 | `node tools/agent/switch-lots.js --check` | exit 0 "switch lots up to date" | **verified PASS** |
| E4 | `node tools/agent/flag-register.js --check` | exit 0 "flag register up to date" | **verified PASS** (but see R3-A2: "up to date" ≠ "governed") |
| E5 | gate dossiers decision cells | 21/21 dossiers contain "fills nothing"; no approval invented | **verified** |
| E6 | NEW-1 repros R1/R2/R3 + new N1–N4 (below) | all refused 403 | **verified** |
| E7 | append-only + hash-chain triggers on a freshly migrated PG DB, all 12 `auditChain.TABLES` | each has `<t>_append_only` + `<t>_hash_chain` | **verified** |

Counts: **verified 6** (E3–E7, NEW-1 fix) · **not verified 3** (E1 and E2 green on a pristine tree; CI green on target SHA — not runnable here).

## 2. New attacks (claim · attack · outcome) — none repeats round 2

**N1–N4 — four-eyes on commitments** (claim `commitmentLifecycle.js:9-14`: nobody who ever owned/executed/created/submitted may verify; deputies count as the person replaced).
- N1: re-point owner pre-submission, reviewer = `dep.x`; executor submits; `dep.x` with `principals:[it.owner]` verifies → **403** (holds).
- N2: owner removed, then reviewer set to the former owner's **e-mail alias** `it.owner@corp.example` → **set-up accepted**; executor submits; the former owner (username+e-mail) verifies → **403** (holds at verify; the set-up check compares the raw string only — cosmetic, P3).
- N3: former executor removed before submission, made reviewer → 403 at update; accepted-risk-exception path not reachable (holds).
- N4: reviewer cleared (null) → role-reviewer path; former owner with `roleReviewer:true` verifies → **403** (holds).
Outcome: **claim holds.**

**R3-A1 — Append-only evidence (claim `tools/pg/harden-audit-grants.sql:3-5`: "after this script … the application role keeps only SELECT and INSERT on [the audit tables]").** Attack: compare the script's table list with the set the platform actually treats as append-only + hash-chained (`services/auditChain.js:7`, 12 tables; triggers verified in E7). Outcome: **BROKEN for 6 of 12** — the script (and its rehearsal `tests/audit-grants-rehearsal.test.js:13`, which pins the same 6) never transfers ownership of `ppm_events`, `report_publications`, `weekly_report_submissions`, `access_request_events`, `finance_certification_events`, `wan_sla_claim_events`. After the DBA step the app role still OWNS them, so it can `ALTER TABLE … DISABLE TRIGGER`, `DROP TRIGGER`, or `TRUNCATE` (triggers never fire on TRUNCATE) — exactly what the script exists to prevent. The finance-certification and WAN-SLA claim ledgers are among them.

**R3-A2 — Dark-switch governance (claim SWITCH-LOTS / FLAG-REGISTER: every behaviour switch is classified, owned and decided before it changes anything).** Attack (throwaway tree copy, never committed): add `zz_r3_live_enabled: '1'` to `reportConfig.DEFAULTS` plus a consumer, regenerate both registers. Outcome: **BROKEN** — `flag-register --check` and `switch-lots --check` exit 0, and `flag-register`, `switch-lots`, `switch-lots-rollback`, `report-config` tests pass 25/25. The key is filed as "arm switch", owner "to be named", no lot, no decision entry. Control: the same key with default `'0'` IS caught ("dark in the register but not classified", 2 tests fail). So the governance covers only default-OFF switches; a new switch shipped ON — i.e. live behaviour — needs no decision at all. (Caveat: the copy had no `.git`, which only affects orphan detection, not this path.)

**R3-A3 — Suite integrity (claim guard: "no hidden skip").** Attack: look for tests that silently `return` when PostgreSQL is absent (counted as pass, not skip). Found `before()` early returns in `pg-alloc-unspecified`, `pg-ppm-w2-store`, etc. Outcome: **holds** — each test then calls `t.skip('no pg')` (an unlisted reason → run fails), `provisionTestDb` throws under `PG_TESTS_REQUIRED=1`, and CI/release set it (`.github/workflows/ci.yml:23,107`, `release.yml:46`).

**R3-A4 — Gate dossiers vs evidence.** Attack: does the dossier SHA match the tree that carries the evidence? Outcome: **holds** — target `5ffdd57a`, no product/test file changed between it and HEAD.

## 3. Findings (round 3)

| Id | Sev | Title | Reproduction | Regression test to add | Rollback risk |
|---|---|---|---|---|---|
| R3-A1 | **P2** | Audit-table hardening script and its rehearsal cover 6 of the 12 append-only/hash-chained tables | `diff <(node -p "require('./services/auditChain').TABLES.join('\n')") <(grep -o "'[a-z_]*'" tools/pg/harden-audit-grants.sql \| sort -u)` | rehearsal test derives its list from `auditChain.TABLES` (and the script too, or a test asserting equality) | low — script is a manual DBA step, not yet applied |
| R3-A2 | **P2** | A new switch defaulting ON passes every governance check | §2 R3-A2 (throwaway copy) | flag-register/switch-lots: a non-secret `*_enabled` key defaulting `'1'` that is not in a reviewed allow-list (with owner) fails the check | none |
| AUD-2 | P2 | Hash-chain verify blind to tail delete/TRUNCATE (open since R1) | R1 A2 | anchor comparison outside `system_log` | low |
| AUD-4 | P2 | Switch activation single-person; prerequisites advisory (open since R1) | R1 A4 | config PUT refuses a switch whose lot dependency is off | low |
| N2 | P3 | Reviewer set-up check misses identity aliases of past owners (verify still refuses) | §2 N2 | resolve reviewer string to a user and check all its identities | none |
| NEW-3 | P3 | G07 dossier: stale evidence label, no store test, no SoD residual | read `gate-dossiers/en/G07-*.md` §2/§5 | source.js entry + residual line | none |
| NEW-2, AUD-5, AUD-6, AUD-7, AUD-9 | P3 | unchanged from round 2 | see r2-audit.md | as in r2 | none |

**P0: 0. P1: 0.** Fixed since round 2: AUD-1/NEW-1 (the only R2 P1).

## 4. Per-lot recommendation (AI panel recommendation, not a decision)

| Lot | Audit-area touchpoint | Recommendation |
|---|---|---|
| L01 Daily work | `commitments_enabled`, `mywork_awaiting_me_enabled` | **CONDITIONAL → GO PILOT** once the D-04 closure-policy owner names verifier roles (four-eyes now holds against every attack tried) |
| L03 Change control | `portfolio_editor_plan_writes` | **CONDITIONAL** — access-policy decision + AUD-4 prerequisite |
| L05/L06 Finance / PPM ledgers (`finance_certification_enabled`, `ppm_*` events) | R3-A1 | **CONDITIONAL** — extend the audit hardening to these ledgers before relying on them as evidence |
| L07 Publication / soft delete | `soft_delete_two_person`, `report_publications` | **CONDITIONAL** (AUD-6, R3-A1) |
| L08 Governance cadence | handoffs, decisions | **CONDITIONAL** — no new break |
| L12 Access security | approvals, `access_request_events` | **CONDITIONAL** — Security access-policy gate empty; R3-A1 covers its ledger |
| L13 Ops resilience | `restore_drill_full`, `entra_deprovision_enabled` | **CONDITIONAL** — Backup/restore gate empty; AUD-2 open |

## 5. Human gates (RELEASE-GATES rows) still empty in this area
All 21 rows empty (each dossier: "This dossier fills nothing"). Directly relevant: Security access policy CG-01/CG-02 (G01) · Threat model & findings (G02) · Backup/restore RPO-RTO (G05) · Closure policy D-04 (G07) · Handoffs (G08) · Product business acceptance (G15) · Production deployment GO/NO-GO (G17) · Penetration test (G18) · QA lead — CI green on target SHA, skips reviewed (G19). Plus the DBA/CAB step that applies `tools/pg/harden-audit-grants.sql`. `docs/ops/flag-decisions.json`: 0 entries.
