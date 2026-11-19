# P11 qualification — seat: operations (Operations / SRE)

**AI review — not an independent human review.** Reviewer: AI panel seat "operations". No live system touched,
no product code modified, nothing pushed. Frozen SHA under review: `7eee8955568c0bcab2a6329f838ee432ffca9fd1`
(clone `/home/user/qual/operations`, `git rev-parse HEAD` confirmed). Date: 2026-11-19.
Throwaway artefacts (proof scripts) in `/tmp/claude-0/p11attack/` — never committed.

## 1. Evidence re-run (command · result · SHA)

Env for every test run: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`,
`NODE_OPTIONS="--require tools/test/blocking-stdio.js --require tests/_default-env.js --import file://tests/_pg-boot.mjs" node --test --test-force-exit <files>`, SHA 7eee895.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | 24 files: `backup-encrypt, backup-job, backup-schedule, boot-integrity, db-restore, health-deps(.smoke), health-version(-provenance,.smoke), perf-baseline, perf-budget-check, perf-calendar-helpdesk-scan, restore-drill(-admin-card,-full), sli-readings, sync-drift, sync-jobs-registry, sync-routes.smoke, sync-runner, sync-schedule, sync-skip-semantics, sync-write-fence, zoho-sync-truncation-guard` (one parallel run) | 122 tests: 119 pass, 3 file-level fails — all three `FATAL 53300 too many clients` at `_pg-boot.mjs` (shared PG, parallel seats) | 21 files VERIFIED |
| E2 | Serial re-run (`--test-concurrency=1`) of `restore-drill-full`, `restore-drill`, `sli-readings` after max_connections raised | 6/6, 5/5, 5/5 pass | VERIFIED |
| E3 | Load run: own server process (`node server.js`, PORT 3591, own DB `sdp_test_p11ops` from `tools/test/scale-run.js prepare --rows=20000`), `tools/test/load.js --sessions=5 --duration=180 --scenarios=reports,helpdesk,field,export,pages --pid=<server> --pg-stat-url=<own db>` | 27 515 requests, 152.8 req/s, 0 × 5xx; errors 2 750 (10 %) = all `field.envelope` 400 (by design: no `LOAD_FIELD_ACTION_ID`); p95 page_data 61 ms, sync 45 ms, write 80 ms, export 58 ms; RSS 116 → 326 MB in 3 min; max 15 DB conns, 0 lock waits. Full table: `/home/user/qual/out/operations-load-run.md` | VERIFIED (observation only, 20k tickets, 1 sandbox) |
| E4 | `node tools/test/perf-budget-check.js --load=<json>` | page_data/sync/export within PROPOSED budgets; `write` OVER (50 % errors — the by-design 400s); deck_generation `no_sample`; exit 0 (warn mode), exit 1 with `PERF_BUDGETS_BLOCKING=1` | VERIFIED |
| E5 | `scale-run.js restore` (backup → encrypted dump → restore into `<db>_restored` → reconcile) | 218 tables, 60 466 rows, encrypted=true, **0 mismatches**, total 9.2 s; `_restored` DB dropped | VERIFIED |
| E6 | L13 lot tests with switches forced (`SDP_FORCE_SWITCHES` from `switch-lots.js --lot=L13 --force`) | 100 tests: 93 pass, 7 fail — all 7 assert the default/off state (forcing makes "switch off" impossible). Same 4 files re-run unforced: 30/30 pass | VERIFIED (with harness caveat F-07) |
| E7 | Installer PowerShell tests (`tools/installer/tests/run-all.ps1`) | no `pwsh` on this host | NOT VERIFIED (read-only review only) |
| E8 | Deck-generation latency, soak > 3 min, production volume, external `/ready` probe availability SLI | not run | NOT VERIFIED |

Counts: **6 evidence items verified, 2 not verified.** Cleanup: server process stopped, `sdp_test_p11ops` dropped by name (`scale-run.js drop`), cred file removed; no other DB touched.

## 2. Claims attacked

| Claim | Attack | Outcome |
|---|---|---|
| "Truncation guard in the Zoho reconcilers: >20 % shrink → refused, nothing deleted" (CLAUDE.md step 1 says "les 6 réconciliateurs") | Read call sites; then `/tmp/claude-0/p11attack/survey-trunc.js` against my DB: 100 survey results+answers stored, feed a 5-row export, then a healthy 100-row export | **BROKEN.** Only `change`, `cab`, `requests` call `assertNotTruncated` (`zoho-sync.js:378-379,676`). `syncSurveyData` reconciles with no guard (`zoho-sync.js:523`). Result: 100 → **5** results and answers, no error, run marked success; healthy re-run leaves **5** (incremental filter on `Survey Sent on > lastSync`, `zoho-sync.js:454-459`, never re-inserts the deleted history). → F-01 |
| "Assets C1 guard prevents a partial view wiping the table" | `/tmp/claude-0/p11attack/assets-partial.js`: `syncAssetView` with 2 473 stored, fetch returns 2 rows | **BROKEN for partial.** Guard only refuses an empty fetch (`assets-sync.js:41-47`); 2 473 → 2 rows, `markSuccess(…, 2)`. Next healthy nightly run restores, but the effort snapshot and `asset_first_seen` of that night are written from the partial set. → F-03 |
| "/ready = can we reach the database" | Terminate all backends of my DB; then `ALTER DATABASE … ALLOW_CONNECTIONS false` | Holds: pool recovers after kill (200); DB refusing → `/ready` 503 in < 15 ms, recovers to 200 when re-allowed. `/health` stays 200 `status:"ok"` (liveness — acceptable). |
| "sdp-manager restore/update probes the service before declaring success" | Same DB-refusing state, request the probe endpoint `tools/sdp-manager.js:188` uses | **BROKEN.** Probe hits `/api/auth/config` → **200 while `/ready` = 503**. `restore` prints "service answers" and `update` declares OK / skips auto-rollback with a dead DB. → F-02 |
| "Boot integrity: every relative require resolves in git" | Scan for requires the regex cannot see (`path.join`, template literals) | Holds today (all 7 dynamic `tools/${p}` requires in `services/sync/jobs.js:88` resolve) but the test is blind to that form. → F-06 |
| "Restore never leaves a half-restored DB; incomplete dump refused" | Read `services/dbRestore.js:52-70`; drill E5 | Holds (single transaction, trailer check, confirm phrase). Phrase binds only the file-name timestamp, not the source DB identity (→ F-08). |
| "perf-budget-check compares against budgets" | Ran with positional arg | Prints "nothing to check", exit 0 even in blocking mode intent → F-07b (P3). |

## 3. Findings

### P0 — none.
(F-01 is data loss on a live job, but the source of record — Zoho — still holds the data; recoverable by a manual full re-sync. Classified P1, not P0; a human may legitimately upgrade it.)

### P1
**F-01 — Survey sync has no truncation guard: a partial Zoho export permanently deletes local survey history (CSAT/NPS inputs).**
- Where: `zoho-sync.js:523` (`reconcileSurveyResults(liveResultIds)`, no `assertNotTruncated`); permanent because of the incremental filter `zoho-sync.js:454-459`; job `zoho.survey` runs hourly (`services/sync/jobs.js:94`).
- Repro: on a throwaway DB, `PG_URL=<throwaway> node /tmp/claude-0/p11attack/survey-trunc.js <clone>` → prints `[100,100]`, `[5,5] error=null`, `[5,5]`.
- Impact: wrong CSAT/NPS shown as truth on executive decks/scorecards until someone resets `sync_metadata` and forces a full survey fetch; nothing alerts (run is a success).
- Regression test to add: `syncSurveyData` with stored N and fetched < 80 % N must throw `{transient:true, truncation:true}` and leave `survey_results`/`survey_answers` counts unchanged; plus a test that answers are never deleted when results are refused.
- Rollback risk of the fix: low (adds a refusal before a delete; worst case a legitimate mass deletion in Zoho is delayed until an operator raises the tolerance).
- Also: CLAUDE.md/ETAPE-01 claim of guard coverage on "6 reconcilers" is inaccurate — 3 call sites, 4 reconcilers (survey uncovered).

**F-02 — `sdp-manager` health probe cannot see a dead database; restore/update report success and skip auto-rollback.**
- Where: `tools/sdp-manager.js:183-195` (probes `/api/auth/config`), used by update (`:256`, gates auto-rollback), restore (`:357`), service ops (`:417`), status (`:302`).
- Repro: start the server on a throwaway DB, `ALTER DATABASE <db> ALLOW_CONNECTIONS false` + terminate its backends, then `curl /api/auth/config` → 200 while `curl /ready` → 503.
- Impact: an operator restore/upgrade that leaves PostgreSQL unreachable is announced as "service answers"; update auto-rollback never fires for that case.
- Test to add: probeHealth must return `ok:false` when `/ready` is 503 (inject fetch); switch probe to `/ready` (unauthenticated, already DB-backed).
- Rollback risk: low.

### P2
**F-03 — Assets full-replace accepts any non-empty partial view** (`assets-sync.js:41-47`); repro `node /tmp/claude-0/p11attack/assets-partial.js <clone>` → 2 473 → 2, recorded success. Self-heals next night, but that night's `asset_effort_history` snapshot (permanent history) and `asset_first_seen` are computed from the partial set (later false "new asset" alerts). Test: shrink > tolerance must throw, table untouched. Rollback risk low.
**F-04 — Unauthenticated `/health` discloses Zoho OAuth state** (`server.js:1656-1666`): `tokenValid`, `grantedScope`, raw `lastRefreshError` body (Zoho error JSON, `server.js:432,470`), org/workspace IDs. Exempt from the rate limiter (`server.js:287`). Listed as public in `docs/ops/AUTHZ-MATRIX.md:447` but the payload is not a liveness answer. Fix: reduce to `{status, uptime}`, move the rest behind session. Test: anonymous `/health` keys ⊆ {status, uptime}.
**F-05 — Backups silently fall back to plaintext** when `SDP_BACKUP_KEY` is unset/short (`services/backup.js:164-165`: warning log only). A plaintext dump carries password hashes and the (config-key-encrypted) secrets table. Proposal: refuse under `REQUIRE_POSTGRES=1` unless an explicit `SDP_BACKUP_PLAINTEXT_OK=1`; test both. (Policy choice — human.)
**F-07 — Lot-run harness produces 7 expected red tests for L13** (default-state assertions cannot pass with forcing) and the default load scenario always puts the `write` class "over budget" (field envelope 400 by design). Both make the evidence noisy and invite "known failures". Fix: skip default-state tests when `SDP_FORCE_SWITCHES` is set / label them; have `load.js` exclude by-design 400 or require `LOAD_FIELD_ACTION_ID`.

### P3
- **F-06** boot-integrity scan ignores template-literal / `path.join` requires (`tests/boot-integrity.test.js` regex); today all resolve.
- **F-07b** `perf-budget-check.js <file>` (positional) silently checks nothing, exit 0.
- **F-08** restore confirm phrase binds only the timestamp of the file name, not the source database identity (a mislabelled foreign dump would restore).
- **F-09** `sdp-manager restore` takes the pre-restore backup before stopping the service (`tools/sdp-manager.js:342-349`) → writes in that window are lost.
- **F-10** DB-latency SLI buffer (`services/sliCounters.js`, MAX 10 080) is fed by anonymous `/ready` calls; a burst replaces the week of samples (rate-limited globally, so bounded).
- Load observation: RSS 116 → 326 MB in 3 min (same pattern as the 2026-11-06 note); not interpretable without a soak — **soak not run**.

## 4. Per P03 lot touching operations — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L13 Operations resilience (sync_drift_alerts, delivery_failure_alert_enabled, restore_drill_full, entra_deprovision_enabled, site_code_shared_block) | **CONDITIONAL** | Tests green (unforced 30/30 + forced 93/100 with the 7 explained); restore drill verified with 0 mismatches. Conditions: fix F-01 (survey history can vanish without any drift alert firing — the drift detector would see a one-off drop at best), fix F-02 before using `sdp-manager restore` in the pilot; G-11 RPO/RTO approved by a human; entra_deprovision needs its identity owner. |
| L10 Reporting rhythm (connector_health_page_enabled part) | **CONDITIONAL** | Connector/sync health reads are sound; condition: F-01/F-03 (health shows "success" for a destructive partial sync). |
| L11 Site operations evidence (WAN/assets parts) | **CONDITIONAL** | F-03 affects asset effort history. |
| Other lots (L01-L09, L12) | out of this seat's area — no recommendation. |

## 5. Human gates still empty in this area (docs/sdp360/completion/RELEASE-GATES.md — every column blank at this SHA)
- Backup / restore RPO-RTO (G-11) — CAB + SRE.
- Capacity — load / soak result accepted (E-B05) — SRE + DBA (`docs/ops/perf-budgets.json` `approved_by: null`).
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05).
- CAB — dependency release D-11 and PostgreSQL-only cutover PO-08.
- Connectors D-07/D-08/D-09, dash-key clients D-15 — platform/infra owners.
- Production deployment GO/NO-GO — CAB.
Also empty: every L13 dossier owner / canary site / decision date / rollback trigger (`docs/ops/SWITCH-LOTS.md`), SLO targets (`UNKNOWN — to be approved by SRE`).
