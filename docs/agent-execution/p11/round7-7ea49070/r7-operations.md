# P11 qualification — ROUND 7 (re-check) — seat: operations (Operations / SRE)

**AI review — not an independent human review.** AI panel seat "operations". No live system was touched, no product
code was modified, nothing was pushed, merged or tagged, and no human decision was filled in. Frozen SHA:
`7ea49070d687679109c3c91ef29a8f744835f10c` (clone `/home/user/qual/operations`, `git rev-parse HEAD` = `7ea49070`).
The agent-execution narratives were not read; only the code, tests, docs/ops, RELEASE-GATES and gate dossiers. Earlier
round files were not changed. The PostgreSQL cluster on the host is **16** (the target is 17); it had restarted and was
started with `service postgresql start`.

Throwaway work: `/tmp/claude-0/p11ops-r7/` (scripts in `scripts/`, outputs `e1.out`, `drill1..4.out`, `load.*`,
`ready.log`). Databases I created: `sdp_test_p11ops_r7` (20 000 tickets, `scale-run.js prepare`), dropped by name with
`scale-run.js drop`; the drill targets (`sdp_drill_*`) and the scale-run restore target were dropped by the tools; the
40-file evidence run used `SDP_TEST_RUN_ID=operationsr7` and **left 0 databases** (checked by name). Credentials, env file,
data dirs, backups and archives were deleted. One throwaway local test password was echoed to my terminal by a parse
error during setup; it belonged to the dropped disposable database only. The host is shared, so latencies are not
comparable across rounds.

## 0. Round-6 findings re-checked at 7ea49070 (fix 27 and related)

| R6 | Claimed fix | Repro re-run at 7ea49070 | Verdict |
|---|---|---|---|
| **O-1 (P2)** file-store backup and drill freeze the event loop | `services/blobBackupWorker.js` child process for `backup-store`, `pack-dump`, `drill-files`; pg_dump and psql spawned async; busy-wait removed | Same 300 × 3 MB (900 MB) store. `BB.backupStoreAsync` with a 10 ms lag timer: **max event-loop lag 32 ms** (r6: 54 350 ms), 65 s wall time. Full in-process `restore-drill.run({backupFirst:true})` (the `db.restore_drill` job path) with the 860 MB store: **max lag 92 ms** over 38 s. | **FIXED** (P3 residuals: `backup.openDump` still decrypts + gunzips the DB dump synchronously in-process, `rewriteSchema` too; no free-space check before writing another full copy) |
| **O-2 (P2)** a symlinked subtree is excluded from backup and drill | one link-aware walker (`listStoreDetailed`): follows links inside the data dir, refuses links outside (`BLOB_LINK_OUTSIDE`), detects cycles; drill fails on `listError` | Link to a folder **inside** `data/`: followed, archived (`count 2, links:["ppm-doc"]`). Link to **another disk**: backup refused, no `.part` left; `restore-drill --backup-first` exits 1 with the refusal message (no PASS). | **FIXED** (fail-loud). Residual P3: the drill check is still the same enumeration as the backup (no independent DB-reference cross-check, e.g. `insp_photos.file_ref`); three different blob-root resolvers (O-9) |
| **O-3 (P3)** a file vanishing mid-walk aborts the run, `.part` left | ENOENT/ENOTDIR → `vanished` in manifest; `.part` unlinked on error; stale `.part`/`.rejected` pruned | fs wrapper deleting `f2` at read time: `{"count":2,"vanished":["m/o/f2"]}`, archive written. Outside-link refusal left no `.part`. | **FIXED** |
| **O-3b (P3)** `sdp-manager backup --dir <install>` resolves the manager's own blob root | `blobRootOf(dir, env)` | Fake install with `data/blobs/inspection/i9/sig.png`, `SDP_DATA_DIR` unset: archive written in `<install>/data/backups`, "1 file(s), verified". | **FIXED** |
| **O-4 (P3)** `--second-operator` is unverified free text | `--second-operator` refused; four-eyes only via Policy Center + one-time operator token (migration 136) | On my DB: `--second-operator=x` → refused, nothing written. Center off → refused. Center on + literal token on the command line → refused. Center on + unknown token in env → "operator token unknown, already used or expired", nothing written, 0 policy requests. `emergency_access_enabled` stayed unset. | **FIXED** on the CLI path. Residual (P3, unchanged): anyone holding the DB credentials can write `report_config` directly (I set `policy_center_enabled` by SQL); `harden-audit-grants.sql` (DBA gate D2) remains the real control |
| **O-5 (P3)** blocking budget check passes with no sample | fail when no class is measured | `{"classes":{}}` → exit 1. **One class measured, four "no sample"** → exit **0** in blocking mode. `DESIGNED_4XX` still excludes every `field.envelope` 400 (load.js unchanged). | **PARTIAL** (P3) |
| **O-6 (P3)** test DBs leak under `--test-force-exit`; hyphenated run id ignored | detached dropper on `exit`; run id sanitised | 40-file run with `SDP_TEST_RUN_ID=operationsr7`: names carried the tag during the run (7 seen), **0 left** after exit. | **FIXED** (377 untagged `sdp_tracker_test_*` from earlier rounds/seats remain on the cluster; not mine, not dropped) |
| r5 P3 `.rejected` dumps never pruned | prune `.rejected` older than oldest kept | 4 dumps + 2 `.rejected`, keep 2: the old `.rejected` pruned, the recent one kept. | **FIXED** |
| N-12 residuals (no statement timeout on user routes, slow login under stall, `/itsm-integrations-plan.html` redirects to login on DB_BUSY) | — | `server.js:1442-1443` unchanged (validateSession error → `user=null` → login redirect). | NOT FIXED (P3) |
| Carried P3s: project-document blob folder on hard delete, pilot-metrics actor filter, N-04, N-05, F-06, F-08, F-09, F-10, unsealed rollback files without keys | — | not in the fix diffs | NOT FIXED (P3), not re-tested |

## 1. Evidence re-run at 7ea49070 (command · result)

Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres SDP_TEST_RUN_ID=operationsr7`,
`NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit --test-concurrency=4 <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | 40 files: activate-switches(+`-r6-impersonation.smoke`), assets-sync*, auth-db-busy.smoke, **audit-chain-r6**, backup-encrypt/job/schedule, blob-backup, **blob-backup-r6**, boot-integrity, db-restore, health-deps(.smoke), health-public, health-version(-provenance,.smoke), perf-baseline, perf-budget-check, perf-calendar-helpdesk-scan, pg-pool-acquire-timeout, pg-pool-idle-error, ready-probe.smoke, ready-readonly, ready-timeout, **report-config-switch-canonical**, restore-drill(-admin-card,-full), rollback-scripts-transactional, sli-readings, sync-drift, sync-jobs-registry, sync-routes.smoke, sync-runner, sync-schedule, sync-skip-semantics, sync-write-fence, zoho-sync-survey-truncation, zoho-sync-truncation-anchor, zoho-sync-truncation-guard | **231 tests, 231 pass, 0 fail, 0 skip**, 169 s, exit 0. Log `/tmp/claude-0/p11ops-r7/e1.out` | VERIFIED |
| E2 | Load: my own `node server.js` on 127.0.0.1:3597 against `sdp_test_p11ops_r7`; `tools/test/load.js --sessions=5 --duration=180 --scenarios=reports,helpdesk,field,export,pages,deck --pid --pg-stat-url` | 2 160 requests, 11.8 req/s, **0 × 5xx**; the 180 errors are all designed `field.envelope` 400s. Class p95: page_data 255 ms, sync 124, write 334, export 179, deck_generation 4 703 (all-sites monthly p95 4.9 s). RSS 152 → 403 MB. Max 28 DB connections, 0 lock waits. `/ready` every 3 s: **74/74 = 200**, max 0.09 s. Table: `/home/user/qual/out/r7-operations-load-run.md` | VERIFIED (observation; shared host) |
| E3 | `perf-budget-check.js --load=<E2 json>`, warn and blocking | 5 classes within the PROPOSED budgets; budgets still `approved_by: nobody` | VERIFIED |
| E4 | `scale-run.js restore --db=sdp_test_p11ops_r7` | 228 tables, 48 196 rows, encrypted, **0 mismatches**, 10.3 s; target dropped | VERIFIED |
| E5 | Restore drill (CLI and in-process job path) with an 860 MB store and with a 1-file store | 1-file store: PASS (database + file store). 860 MB store with the server running: **FAIL** on `system_log` (see O-7) | VERIFIED (finding) |
| E6 | Round-6 repros (§0) | as in §0 | VERIFIED |
| E7 | Installer PowerShell suite (`tools/installer/tests/run-all.ps1`) | no `pwsh` on the host; read only | NOT VERIFIED |
| E8 | Soak > 3 min, production volume, external `/ready` SLI, multi-GB store on the real Windows server (junctions, antivirus, disk) | not run | NOT VERIFIED |

Counts: **6 verified, 2 not verified.**

## 2. New break attempts at 7ea49070 (one per capability, aimed at code changed by fixes 25–29)

| Capability · claim | Attack | Outcome |
|---|---|---|
| Backup off the event loop (fix 27): "the server keeps serving during backup and drill" | Lag timer during `backupStoreAsync` and during the whole in-process drill with an 860 MB store | Holds: 32 ms / 92 ms max lag (§0) |
| Restore drill (fix 27 + 22): "a PASS means the backup restores to the live state" | Ran the monthly drill (`backupFirst`) against a live server, 860 MB store. The live table counts are taken **after** the dump **and after** the file-store archive + live hash (`tools/pg/restore-drill.js:254-257`, comment "live counts first (closest to the dump in time)"). Now that the server is no longer frozen, it keeps writing during that window | **BROKEN.** Run 1 (server idle, one 5-minute sync failure row at 01:45:00): `system_log live=20908 restored=20907 mismatch` → **FAIL**. Run 3 (failed logins every 2 s, as normal traffic would write audit rows): `live=20912 restored=20909` → FAIL. Same drill with a 1-file store: PASS. → **O-7 (P2)** |
| Links (fix 27 O-2) | Link inside the data dir, link to another disk, drill and `scale-run restore` | Holds (fail loud). Side effect: one outside link makes **every** nightly backup and `scale-run restore` fail; the DB dump of the failed run is kept with no archive (the newest dump has no file-store pair) → P3 note in O-9 |
| Audit chain job (fix 29 R6-A2, HMAC-signed anchors, "unverifiable never ok") — ops view: the nightly job must stay green under documented operations | On my DB: `verify` + `recordAnchors` twice with key A (ok, 12 anchors each), then the **documented** `SDP_CONFIG_KEY` rotation (`docs/ops/EXPLOITATION.md:73`, `INCIDENT-RESPONSE.md:22`: `reencrypt-secrets.js --apply` with `SDP_CONFIG_KEY_OLD`), then two nights with key B | **BROKEN (availability of the control).** Night 3 and 4: `status:"broken"`, "anchor row(s) #1, #13 not signed by the nightly job (forged or altered anchor)", **anchored: 0**. Because no anchor is written over a broken chain and the anchor table is append-only (trigger + migration 132 TRUNCATE refusal), the job fails **every night forever** and the chain is never anchored again. `reencrypt-secrets.js` has no anchor step and no runbook mentions it. Same outcome after one night with `SDP_CONFIG_KEY` missing from `.env` (an unsigned row after a signed one is "forged"). → **O-8 (P2)** |
| Activation four-eyes (fix 29 R6-A1) | `--second-operator`, centre off, literal token, unknown token | Holds (§0) |
| Perf budgets (fix 27 O-5) | Blocking with one measured class | Exit 0 → O-5 PARTIAL (P3) |
| Test harness (fix 27 O-6) | 40-file run with run id, check leftovers by name | Holds: 0 left |
| Ops tooling (fix 27 O-3b) and blob-root resolution | Compared the three resolvers: app `services/blobStore.js:26-27` (`SDP_DATA_DIR` only), backup `services/blobBackup.js:38` (`SDP_BLOB_ROOT` first), drill `tools/pg/restore-drill.js:123` (`SDP_DATA_DIR` only) | Inconsistent (by reading). `SDP_BLOB_ROOT` is listed as a switch in `docs/ops/FLAG-REGISTER.md:446` but the application ignores it: setting it makes the nightly backup archive a folder the app never writes to ("file store: none at …"). The monthly drill (other resolver) would then fail, so it is caught within a month. → O-9 (P3) |
| Sync / truncation guards (unchanged except the anchor TRUNCATE trigger) | E1 truncation suites, migration 132 rollback is `BEGIN … COMMIT` | Holds |

## 3. Findings (round 7)

### P0 — none.

### P1 — none.

### P2
**O-7 — The monthly restore drill compares live row counts taken minutes after the dump: on a live server it now fails spuriously, and the delay grows with the photo store.**
- Where: `tools/pg/restore-drill.js` `run()` — order is `runBackup` (dump, pack, file-store archive) → `openDump` → `drillFilesAsync` (hash the whole live store) → `countTables(live)` (`:254-257`); `services/restoreDrill.js:29` treats any difference as `mismatch`. Fix 27 moved the heavy work out of the event loop, so the server (which runs `db.restore_drill` itself, `services/sync/jobs.js:136-141`) keeps writing `system_log` (API journal, sync failures, logins) during that window. Before, the frozen server hid the race.
- Repro: start `server.js` on a throwaway DB with ~900 MB under `SDP_DATA_DIR/blobs`; while `curl -X POST /api/reports/auth/login` with a wrong password every 2 s, run `node /tmp/claude-0/p11ops-r7/scripts/drill-lag.js <repo> <reportdir>` (calls `restore-drill.run({backupFirst:true})`) → `system_log live=20912 restored=20909 mismatch`, "restore drill FAILED". With a 1-file store the window is ~4 s and it passes.
- Impact: a red monthly drill (alert, `restore_drill` row, admin card) on a healthy backup, every month once the store is large; operators learn to ignore the one check that proves restorability. No data loss.
- Fix / test to add: count the live tables in the dump's snapshot (`pg_export_snapshot()` + `pg_dump --snapshot`, or count inside the same REPEATABLE READ transaction), or at least take the live counts immediately after the dump, before the file-store step; optionally accept growth of append-only logs when every restored id exists live. Test: a writer inserting into `system_log` during the drill must not fail it. Rollback risk: low.

**O-8 — Signed audit anchors break permanently after the documented `SDP_CONFIG_KEY` rotation (or one night without the key): the nightly chain job fails forever and never anchors again.**
- Where: `services/auditChain.js` `anchorKey` (derived from `SDP_CONFIG_KEY` only), `chooseAnchor` (`:66-85`: rows signed with another key → `forged`; an unsigned row after a signed one → `forged`), `verify` (`:168`: any forged id → broken), `nightly` (`:217`: no anchor written unless ok); append-only table (migrations 131/132). The rotation procedure (`docs/ops/EXPLOITATION.md:73`, `docs/ops/INCIDENT-RESPONSE.md:22`, `tools/pg/reencrypt-secrets.js`) has no anchor step.
- Repro: `node /tmp/claude-0/p11ops-r7/scripts/anchor-e2e.js <repo>` against a throwaway DB (`verify` + `recordAnchors` with key A twice, then key B twice) → nights 3-4 `status:"broken"`, `anchored:0`. Pure version: `node /tmp/claude-0/p11ops-r7/scripts/anchor-rotate.js <repo>` → `forged:[1,2,3]` after rotation, `forged:[2]` after one unkeyed night.
- Impact: after a security incident (where rotation is mandated) the audit-chain control goes permanently red and stops anchoring — the protection is lost exactly when it matters, and the only way out is a DBA deleting append-only rows (which is itself what the control is meant to detect). No business data loss.
- Fix / test to add: a re-key procedure (sign a "key-change" anchor with both old and new keys, or keep a key id / accept `SDP_CONFIG_KEY_OLD` for rows before a recorded rotation), add it to `reencrypt-secrets.js` and the runbook; treat an unsigned row written while the key was absent as "advisory gap", not forgery, if recorded as such. Test: rotation with `SDP_CONFIG_KEY_OLD` leaves the nightly job ok. Rollback risk: low. (Belongs jointly to the audit seat; reported here because it turns an ops procedure into a permanent alert.)

### P3
- **O-5 (partial)** — blocking budget check passes when only some classes are measured; `field.envelope` writes never enter a budget class.
- **O-9** — Three blob-root resolvers (app: `SDP_DATA_DIR`; backup and `sdp-manager`: `SDP_BLOB_ROOT` first; drill: `SDP_DATA_DIR`). `SDP_BLOB_ROOT` is registered as a switch but the app ignores it. Also: a backup refused by `BLOB_LINK_OUTSIDE` (or any file-store failure) keeps the DB dump of that run with no archive; it becomes the newest dump and counts toward retention. No free-space check before a full copy (retention 14 × store). A file > 2 GB in the store fails `readFileSync` and the whole run.
- **O-10** — The drill's file-store check is still not independent of the backup's enumeration (no cross-check of DB-referenced files against the archive).
- `openDump` / `rewriteSchema` still synchronous in-process (small at current DB size).
- Carried: N-12 residuals (no statement timeout on user routes; `/itsm-integrations-plan.html` redirects to login on DB_BUSY, `server.js:1442-1443`); project-document blob folder on hard delete; pilot-metrics actor filter; N-04, N-05, F-06, F-08, F-09, F-10; rollback files unsealed without keys; DB-credential holders can write any switch directly (DBA hardening gate).

## 4. Per P03 lot touching operations — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L13 Operations resilience (incl. `policy_center_enabled`) | **CONDITIONAL** (AI panel recommendation, not a decision) | Every r6 ops P2 is fixed (O-1, O-2) and most P3s (O-3, O-3b, O-4, O-6, `.rejected` prune). Tests 231/231, restore 0 mismatches, `/ready` 74/74 under load. Conditions: O-7 (the monthly drill must not fail on live writes — otherwise the RPO/RTO evidence is noise) and O-8 (a rotation path for anchor signatures) before relying on the drill and the audit-chain job as alerts; G-11 approved; store size and retention decided. |
| Business-readiness pack (runbook B2/B4/D1, EXPLOITATION) | **CONDITIONAL** (AI panel recommendation, not a decision) | B2/D1 hold. The key-rotation step (`EXPLOITATION.md:73`) must say what happens to audit anchors (O-8); B4 must say a drill can fail on concurrent writes until O-7 is fixed. |
| Activation tooling (`activate-switches`) | **GO PILOT** (AI panel recommendation, not a decision) | Four-eyes keys can no longer be written by the CLI; they become Policy Center requests filed under a one-time authenticated token. |
| Policy Control Center | **GO PILOT on activation** (AI panel recommendation, not a decision) | Unchanged from r6 for this seat; the CLI path now depends on it for four-eyes keys. |
| L10 Reporting rhythm (connector health) / L11 Site operations evidence (ops part) | **GO PILOT** (AI panel recommendation, not a decision) | Freshness SLI and truncation guards hold (E1). |
| Portfolio Lots 2–6 (ops part: migrations and rollbacks) | **GO PILOT** (ops part only) (AI panel recommendation, not a decision) | New rollbacks 132/133/135/136 are transactional (E1 test); migrations survive backup/restore (E4). |
| Others | out of this seat's area — no recommendation. |

## 5. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md` at 7ea49070 — every decision column is blank)
- Backup / restore RPO-RTO (G-11) — CAB + SRE: includes file-store retention and size, link policy, drill false-failure behaviour (O-7).
- Capacity — load / soak result accepted (E-B05) — SRE + DBA; `docs/ops/perf-budgets.json` still PROPOSED, `approved_by` empty; no soak, no production-size store.
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05).
- Penetration test / accepted analysis (E-B05, X-B-03).
- CAB — dependency release D-11 / PostgreSQL-only cutover PO-08 (note: the test cluster here is PG16, target PG17); Production deployment GO/NO-GO; DBA execution of `harden-audit-grants.sql` (runbook D2, not run here).
- Policy decisions surfaced, **not** filled: statement timeout, `SYNC_TRUNCATION_SHRINK_CONFIRMATIONS`, `SDP_BACKUP_ALLOW_PLAINTEXT`, `restore_drill_full`, file-store backup target / retention / size limit, whether `SDP_BLOB_ROOT` is supported, SLO targets, the `SDP_CONFIG_KEY` rotation procedure for audit anchors, who may issue operator tokens.

*AI review — not an independent human review. AI panel recommendations are not decisions.*
