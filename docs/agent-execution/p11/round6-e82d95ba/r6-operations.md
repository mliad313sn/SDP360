# P11 qualification — ROUND 6 (confirmation) — seat: operations (Operations / SRE)

**AI review — not an independent human review.** AI panel seat "operations". No live system was touched, no product
code was modified, nothing was pushed, merged or tagged, and no human decision was filled in. Frozen SHA:
`e82d95baf7fa4b554003d32f89e02d634216c1de` (clone `/home/user/qual/operations`; `git log -1` = `e82d95ba`; the
agent-execution narratives were not read, only the gate dossiers). The earlier round files were not changed.

Throwaway work is in `/tmp/claude-0/p11ops-r6/`. Databases I created: `sdp_test_p11ops_r6` (20 000 tickets, via
`tools/test/scale-run.js prepare`), `sdp_test_p11ops_r6_rb` (bare migrations, for the rollback re-check) and
`sdp_tracker_test_opsr6chk_9gecee` (one-file leak check). All three were dropped by name; 0 remain. The scale-run restore
target is dropped by the tool. The credential, env, backup and archive files were deleted. **One caveat about cleanup:**
see O-6. The 38-file evidence run created per-file test databases whose names carry no run id, so I could not tell them
apart from other seats' databases and did **not** drop them. The host is shared (load average up to 16), so latencies
are not comparable across rounds.

## 0. Round-5 findings re-checked at e82d95ba (fix 22 and the related F-07 fix)

| R5 | Claimed fix | Repro re-run at e82d95ba | Verdict |
|---|---|---|---|
| **N-14 (P1)** the file store is not backed up, and the B4 drill passes on the DB only | 277386f1: `services/blobBackup.js`, archive written next to every dump, the drill checks it, `tools/pg/restore-blobs.js`, runbook B2/B4 | `restore-drill.js --backup-first` against my DB, with 1 photo under `SDP_DATA_DIR/blobs`. The backup writes `sdp_dashboard_<stamp>.sql.gz.enc` **and** `sdp_blobs_<stamp>.blobs.enc`. The drill logs "file store: ok — 1 file(s) read back … same SHA-256" and PASS. The code fails the drill when files are on disk and there is no archive, when an archive is unreadable, or when a hash differs (`fileStoreStep`). `restore-blobs --verify` OK. The runbook B2/D1 now name both files. | **FIXED** for the default layout. New gaps in the fix: **O-1, O-2, O-3** |
| **N-12 (P2)** a DB stall (DB_BUSY) logs users out (answered 401/500) | 51b71b47: the gate, `requireReportSession` and `businessGuard` answer `fail(res, e)`; `auth.js` keeps the session on 503 | Same `lock-user.sh` (ACCESS EXCLUSIVE on `weekly_reports` for 45 s, 15 authenticated `GET /api/reports`). The **5 queued requests now answer `503 {"error":"database_busy","code":"DB_BUSY"}` at 10.2 s** (`httpError` sets `Retry-After: 5`). The 10 that held a client returned 200 after the lock was released. `/ready` answered 503 in 2.0 s, then 200 at 0.01 s. `auth.js:170` returns on 503 before the 401 branch. | **FIXED.** P3 residuals carried: no statement timeout on user routes (the 10 waited about 43 s), login under a stall took 38.8 s, and `/itsm-integrations-plan.html` (`server.js:1442`) still redirects to login on DB_BUSY |
| **N-13 (P2)** rollback 125 is half-applied under `psql -f` | a85de330: all rollback scripts wrapped in `BEGIN … COMMIT` + `tests/rollback-scripts-transactional.test.js` | All 40 scripts start with `BEGIN;` (`grep -L` empty); none uses CONCURRENTLY or VACUUM. On `sdp_test_p11ops_r6_rb` with a `gate_to='idea'` checklist: `psql -f` gives an error on statement 2 and a final **ROLLBACK**. The CHECK is still present (1 row), and `created_by,updated_by` are still there. Same result with `-v ON_ERROR_STOP=1`. After deleting the row, the script COMMITs, the CHECK is back to the narrow list, and both columns are gone. | **FIXED** |
| **N-15 (P2)** `activate-switches --apply` writes four-eyes keys with one operator | 5027a081: `4EYES` tag, refusal without a distinct `--second-operator`, or Policy Center requests when the center is on | `--apply --lots=L12` without `--second-operator`: **refused, nothing written** (4 four-eyes keys named). With **`--second-operator=x`**: **"Applied 10 switch(es) (four-eyes, second operator: x)"**, which turned `emergency_access_enabled=1` on. The rollback also asked for a second person and accepted `--second-operator=y`. `skeletonKey` folds case and homoglyphs but accepts `a.lice` vs `alice`, `alice@corp`, and any one-character name. Outside Policy Center mode the second operator is not resolved to any account. | **PARTIAL** → **O-4 (P3)**: the second operator is unverified free text |
| **F-07 (P2)** the write class is OVER because of designed 400s | 5a69b7b9: `DESIGNED_4XX` excluded from the class, counted apart | Load E2: the write class has 0 % errors, p95 449 ms, within budget. `field.envelope` 400 × 128 is still visible per step and per route. | **FIXED** (P3 note in O-5) |
| **F-07b (P3)** a bare path is ignored in blocking mode | same commit | `PERF_BUDGETS_BLOCKING=1 perf-budget-check.js <json>` now checks the file. With no argument, blocking mode exits 1. | **FIXED**, but see **O-5** (a vacuous pass is still possible) |
| P3: `.rejected` dumps are never pruned | — | unchanged (`backup.js:197` "never restored or pruned"); `.rejected` file-store archives behave the same way | NOT FIXED (P3) |
| P3: project document blob folder on hard delete; pilot-metrics actor filter; deck p95 at the budget edge | — | not in the fix diffs. Deck all-sites p95 is now 7.5 s (budget 10 s, proposed). | NOT FIXED (P3), not re-tested |
| Carried P3s: N-04, N-05, F-06, F-08, F-09, F-10 | — | not in the fix diffs | NOT FIXED (P3) |

## 1. Evidence re-run at e82d95ba (command · result)

Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres SDP_TEST_RUN_ID=operations-r6`,
`NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit --test-concurrency=4 <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | 38 files: activate-switches, assets-sync(-status.smoke), **auth-db-busy.smoke**, backup-encrypt/job/schedule, **blob-backup**, boot-integrity, db-restore, health-deps(.smoke), health-public, health-version(-provenance,.smoke), perf-baseline, perf-budget-check, perf-calendar-helpdesk-scan, pg-pool-acquire-timeout, pg-pool-idle-error, ready-probe.smoke, ready-readonly, ready-timeout, restore-drill(-admin-card,-full), **rollback-scripts-transactional**, sli-readings, sync-drift, sync-jobs-registry, sync-routes.smoke, sync-runner, sync-schedule, sync-skip-semantics, sync-write-fence, zoho-sync-survey-truncation, zoho-sync-truncation-anchor, zoho-sync-truncation-guard | **222 tests, 222 pass, 0 fail, 0 skip**, 345 s, exit 0. Log: `/tmp/claude-0/p11ops-r6/e1.out` | VERIFIED |
| E2 | Load: my own `node server.js` on port 3596 against `sdp_test_p11ops_r6`; `tools/test/load.js --sessions=5 --duration=180 --scenarios=reports,helpdesk,field,export,pages,deck --pid --pg-stat-url` | 1 534 requests, 8.5 req/s, **0 × 5xx**. The 128 errors are all designed `field.envelope` 400s. Class p95: page_data 365 ms, sync 231, write 449, export 234, deck_generation 7 070 (all-sites monthly p95 7.5 s, p99 8.0 s). RSS 132 → 384 MB. Max 26 DB connections, 0 lock waits. `/ready` every 3 s: **60/60 = 200**, max 0.17 s. Table: `/home/user/qual/out/r6-operations-load-run.md` | VERIFIED (observation; shared host) |
| E3 | `perf-budget-check.js --load=<json>` (30 s JSON run), warn and blocking, positional form | all 5 classes within the proposed budgets; exit 0. Budgets are still `PROPOSED`, `approved_by: nobody` | VERIFIED |
| E4 | `scale-run.js restore --db=sdp_test_p11ops_r6` | 227 tables, 48 011 rows, encrypted, **0 mismatches**, 7.8 s; target dropped | VERIFIED |
| E5 | Round-5 repros (§0): lock repro, rollback 125, activate-switches L12, perf-budget positional | as in §0 | VERIFIED |
| E6 | Restore drill `--backup-first` with a file store (`restore-drill.js`, report to /tmp, `--no-log`) and `restore-blobs --verify` | PASS (database + file store) | VERIFIED |
| E7 | Installer PowerShell suite (`tools/installer/tests/run-all.ps1`) | no `pwsh` on the host; installer files unchanged since r5 (read only) | NOT VERIFIED |
| E8 | Soak longer than 3 min, production volume, external `/ready` availability SLI, a multi-GB file store on the real Windows server | not run | NOT VERIFIED |

Counts: **6 verified, 2 not verified.**

## 2. New break attempts at e82d95ba (one per capability, aimed at code changed by fixes 19–24)

| Capability · claim | Attack | Outcome |
|---|---|---|
| Backup (fix 22): "the file store is archived with every backup … the drill verifies it" | 300 × 3 MB files (900 MB), `blobBackup.backupStore` with a key, measuring event-loop lag with a 10 ms timer. `db.backup` runs **inside the server process** (`services/sync/jobs.js:128` → `server.js:532` `schedule.start`) | **BROKEN (availability).** **54.4 s of continuous event-loop freeze** for 900 MB. `writeArchive` and `verifyArchive` are fully synchronous (readFileSync, gzipSync, encrypt, writeSync), and the drill hashes the live store again synchronously. A multi-GB photo store freezes every request, `/ready` and the 5-minute jobs for minutes every night. → **O-1 (P2)** |
| Restore drill (fix 22): "a live file missing from the archive fails the drill" | Moved `blobs/ppm-doc` to another disk behind a symlink (on Windows, the usual way to move a big folder is a directory junction). Checked that `blobStore` still serves the file (2 000 bytes read through `BLOB_ROOT`), then ran `restore-drill --backup-first` and `restore-blobs --verify` | **BROKEN.** `listStore` and the drill's `listFiles` both skip non-`isFile()` entries, so the symlinked subtree is excluded from the backup **and** from the live side of the check. Result: **"file store: ok — 1 file(s)… PASS"**, while `contract.pdf` is in no archive. The check uses the same enumeration as the backup, so it is not independent. → **O-2 (P2)** |
| Backup robustness (fix 22) | A file is deleted between the walk and the read (normal activity: an inspection delete calls `blobStore.removeOwner`). Simulated with an fs wrapper | **BROKEN.** `ENOENT` aborts the whole run. It is not marked transient, so it is not retried, and the job fails even though the DB dump of that run was written. A full-size **`sdp_blobs_<stamp>.blobs.part`** is left behind; `isArchiveName` does not match it, so it is never pruned. → **O-3 (P3)** |
| Ops tooling (fix 22): `sdp-manager backup [--dir <install>]` | Fake install dir with `.env` (PG_URL + key, no `SDP_DATA_DIR`) and `data/blobs/…/sig.png`; ran `node tools/sdp-manager.js backup --dir <fake>` from the clone | **BROKEN (P3).** The dump lands in `<install>/data/backups`, but the blob root resolves to the manager's own tree. Output: **"[backup] file store: none on this server"**, a false statement. The default prod invocation (manager inside the install, `DEFAULT_DIR`) is not affected, and runbook B2 expects two files, so a careful operator would notice. → O-3b (P3) |
| Activation four-eyes (fix 22 N-15) | `--second-operator=x` on L12 | Accepted (see §0). → **O-4 (P3)** |
| Perf budgets (fix 22 F-07b): "blocking mode fails on nothing to check" | Blocking mode with a load JSON whose classes are `{}`, and with only `page_data` present | **BROKEN (P3).** Both exit **0**: every missing class is "no sample" and passes. A load file that measured nothing still passes a blocking gate. → **O-5** |
| Health / DB stall (fix 22 N-12) | Looked for any remaining place where DB_BUSY is turned into 401 or a logout: `_hasValidSession`, `/itsm-integrations-plan.html`, field app 401 handlers, `public/*.js` | Holds on the API and in `auth.js`. Residual: `server.js:1442` redirects to login on DB_BUSY (P3, one internal page). `_hasValidSession` serves the page bare and `auth.js` then keeps the session. |
| Rollback scripts (fix 22 N-13) | `psql -f` and `ON_ERROR_STOP` with an offending row, then the success path | Holds (see §0) |
| Sync / truncation (unchanged since r5, except `jobs.js` audit-chain wiring) | Checked that `assets-sync` full-replace also goes through `guardWithAnchor`; the E1 truncation suites pass | Holds |
| Test harness hygiene (the mandated command) | Ran one PG test file with a valid `SDP_TEST_RUN_ID=opsr6chk` and the mandated `--test-force-exit` command | **Leak:** `sdp_tracker_test_opsr6chk_9gecee` remained after exit. `_pg-boot.mjs:37` drops on `beforeExit`, which `--test-force-exit` never fires, so cleanup depends on the forbidden-to-me sweep. In addition, the orchestrator's `SDP_TEST_RUN_ID=operations-r6` contains a hyphen and **fails** the `^[a-z0-9]{1,16}$` check in `tests/pg-helpers.js:98`, so it is silently ignored and the names carry no run id. → **O-6 (P3)** |

## 3. Findings (round 6)

### P0 — none.

### P1 — none. (r5 N-14 is fixed for the default layout.)

### P2
**O-1 — The file-store backup and its verification are synchronous and run in the web server's own process: a large photo store freezes the whole application for minutes at every nightly backup and monthly drill.**
- Where: `services/blobBackup.js` `writeArchive`/`readArchive` (readFileSync + `zlib.gzipSync` + `encryptBuffer` + `writeSync`); `services/backup.js runBackup` → `backupStore`; `services/sync/jobs.js:128-130` (`db.backup` at 03:00) and `:136-139` (`db.restore_drill`, `hashRefs` of the whole live store); `server.js:532` schedules them in-process. The pre-existing `spawnSync` of pg_dump (`backup.js:188`) adds to the freeze.
- Repro: `node /tmp/claude-0/p11ops-r6/bb-time.js <dir with 300 × 3 MB files> <outdir>` (script: 10 ms interval timer plus `BB.backupStore` with a key) gives `{"count":300,"bytes":900000000,"ms":54353,"maxEventLoopLagMs":54350}`.
- Impact: availability (requests, `/ready`, 5-minute WAN and Teams pollers, the SLA alert poller) during the backup window, growing linearly with the store; photos accumulate during the field pilot. There is no free-space check before writing another full copy (retention 14 → 14 × the store). This is not data loss.
- Fix / test to add: run the backup in a child process or worker (like `dump-db.js`), stream files asynchronously, skip gzip for already-compressed media, and check free space first. Test: event-loop lag stays below 1 s during `runBackup` with a 200 MB store. Rollback risk: low.

**O-2 — The restore drill's file-store check uses the same enumeration as the backup: a subtree reached through a symlink or junction is excluded from both and the drill says PASS, while the application keeps serving files that are in no archive.**
- Where: `services/blobBackup.js listStore` (`e.isFile()` only) and `tools/pg/restore-drill.js:111 listFiles` (same rule); `services/blobStore.js` follows links when it reads and writes.
- Repro: `ln -s <other disk>/ppm-doc <DATA_DIR>/blobs/ppm-doc` (on Windows: `mklink /J`, the usual way to move a big folder to another disk); `node tools/pg/restore-drill.js --backup-first --no-log --report-dir /tmp/x` prints "file store: ok … PASS"; `restore-blobs --verify` prints OK; the file under `ppm-doc` is in no archive.
- Impact: silent loss of a whole module's files (project documents or inspection photos) on restore, behind a green drill. It needs an operator storage change, hence P2 and not P1.
- Fix / test to add: follow or refuse links explicitly (`fs.statSync`; a link means archive the target or fail the run loudly), and add an **independent** cross-check: every file referenced in the database (`insp_photos.file_ref`, project documents, completed field uploads) must exist in the archive. Test: a symlinked subtree either appears in the archive or fails the drill. Rollback risk: none.

### P3
- **O-3** — A file deleted during the walk aborts the backup run (non-transient, not retried; the DB dump of that run exists, but the job is marked failed) and leaves an unpruned full-size `.blobs.part`. Fix: skip ENOENT and record it in the manifest as "vanished during backup"; unlink `.part` in `finally` on error. **O-3b** — `sdp-manager backup --dir <install>` run from another tree, with no `SDP_DATA_DIR` in `.env`, reports "file store: none on this server" (resolve the blob root from `--dir`).
- **O-4** — `activate-switches --second-operator` is unverified free text. Any one-character name satisfies four-eyes outside Policy Center mode, and the journal records "second operator: x" as if a second person had reviewed. Center mode resolves the requester only by username (no authentication). Mitigated by needing DB credentials. Fix: resolve the second operator to an active super_admin account distinct from `--operator`, or require Policy Center mode for four-eyes keys.
- **O-5** — `perf-budget-check` in blocking mode passes when no class has a sample ("no sample" is not a failure). `DESIGNED_4XX` excludes every `field.envelope` 400, even when `LOAD_FIELD_ACTION_ID` makes it a real write, so the field write path is never measured in a budget class.
- **O-6** — The mandated test command (`--test-force-exit`) never runs `_pg-boot.mjs`'s `beforeExit` drop, so every PG test file leaks its database until the sweep runs. A run id containing a hyphen is silently ignored (`tests/pg-helpers.js:98`), so parallel seats cannot attribute their databases. My 38-file E1 run therefore left unattributable `sdp_tracker_test_<rand>` databases that I did not drop: **305** unprefixed `sdp_tracker_test_*` databases existed on the shared cluster at the end of the run, from all seats.
- Carried: N-12 residuals (no statement timeout, login under a stall about 39 s, `/itsm-integrations-plan.html` redirect on DB_BUSY); `.rejected` dumps and archives never pruned; project-document blob folder on hard delete; pilot-metrics actor filter; deck generation p95 7.5 s (budget 10 s proposed); N-04, N-05, F-06, F-08, F-09, F-10. Rollback files are written **unsealed** (checksum only) when neither `SDP_CONFIG_KEY` nor `SDP_BACKUP_KEY` is set, as the tool warns; prod with `REQUIRE_POSTGRES=1` requires `SDP_CONFIG_KEY`.

## 4. Per P03 lot touching operations — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L13 Operations resilience (incl. `policy_center_enabled`) | **CONDITIONAL** (AI panel recommendation, not a decision) | Every r5 ops P1/P2 is fixed (N-14, N-12, N-13, F-07) or partial (N-15). Tests 222/222, restore 0 mismatches, `/ready` 60/60 under load, DB stall answered 503. Conditions: O-1 (the backup must not freeze the server, or the store size must be measured and shown small) and O-2 (an independent DB-reference check, or links refused) before the file store grows; G-11 RPO/RTO approved; SRE decisions on truncation, plaintext backup and file-store retention. |
| Business-readiness pack (runbook B2/B4/D1) | **GO PILOT** on the procedure (AI panel recommendation, not a decision) | B2 and D1 now expect two files with the same stamp, and B4 checks the file store. Pilot condition: the operator runs `sdp-manager` from the install (O-3b) and confirms the store does not use links (O-2). |
| Activation tooling (`activate-switches`) | **GO PILOT** for lots without four-eyes keys; **CONDITIONAL** for L03/L11/L12 (AI panel recommendation, not a decision) | The refusal now holds without a second operator, but the second name is unverified (O-4). For four-eyes lots, prefer Policy Center mode or a recorded real second super_admin. |
| Policy Control Center | **GO PILOT on activation** (AI panel recommendation, not a decision) | The catalogue ships and fails closed; the CLI path files center requests when the center is on. |
| L10 Reporting rhythm (connector health) / L11 Site operations evidence (ops part) | **GO PILOT** (AI panel recommendation, not a decision) | The freshness SLI and truncation guards hold (E1). |
| Portfolio Lots 2–6 (ops part: migrations and rollbacks) | **GO PILOT** (ops part only) (AI panel recommendation, not a decision) | All 40 rollback scripts are transactional and verified on an offending row; the migrations survive backup/restore. The functional review belongs to the PPM seat. |
| Others | out of this seat's area — no recommendation. |

## 5. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md` at e82d95ba — every decision column is blank)
- Backup / restore RPO-RTO (G-11) — CAB + SRE: now includes file-store retention, store size vs backup window (O-1), and link policy (O-2).
- Capacity — load / soak result accepted (E-B05) — SRE + DBA; `docs/ops/perf-budgets.json` still PROPOSED, `approved_by: null`; no soak and no production-size store measured.
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05); the test-database leak (O-6) is relevant.
- Penetration test / accepted analysis (E-B05, X-B-03).
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08): four-eyes on the CLI path (O-4).
- CAB — dependency release D-11 / PostgreSQL-only cutover PO-08; Production deployment GO/NO-GO; DBA execution of `harden-audit-grants.sql` (runbook D2, not run here).
- Policy decisions surfaced, **not** filled: `PG_POOL_ACQUIRE_TIMEOUT_MS` and a statement timeout, `SYNC_TRUNCATION_SHRINK_CONFIRMATIONS`, `SDP_BACKUP_ALLOW_PLAINTEXT`, `restore_drill_full`, file-store backup target, retention and size limits, SLO targets, and who is a valid second operator for four-eyes switches applied by CLI.

*AI review — not an independent human review. AI panel recommendations are not decisions.*
