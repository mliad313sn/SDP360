# P11 qualification — ROUND 5 — seat: operations (Operations / SRE)

**AI review — not an independent human review.** AI panel seat "operations". No live system was touched, no product
code was modified, and nothing was pushed, merged or tagged. No human decision was filled in. Frozen SHA:
`3ee4dd23cbe661488f3f693a302358fb62eba6a0` (clone `/home/user/qual/operations`, `git rev-parse HEAD` confirmed; the
agent-execution narratives were not read). The r1–r4 files were not changed. The throwaway proofs are in
`/tmp/claude-0/p11ops-r5/`, and the round-4 repros were re-run from `/tmp/claude-0/p11ops-r4/`. I created two databases,
`sdp_test_p11ops_r5` (20 000 tickets, via `tools/test/scale-run.js prepare`) and `sdp_test_p11ops_r5_rb` (bare
migrations, used for the rollback attack). Both were dropped by name at the end, and 0 databases matching
`sdp_test_p11ops_r5%` remain. The restore round-trip target is dropped by scale-run itself. The credential, env and backup
files were deleted. The host was shared with other seats (load average 12–16 during the run), so latencies are **not
comparable** across rounds.

## 0. Round-4 findings re-checked at 3ee4dd2 (fixes 14 and 17)

| R4 | Claimed fix | Repro re-run at 3ee4dd2 | Verdict |
|---|---|---|---|
| **N-10 (P1)** Policy Center catalogue missing from the update package, silent fallback | 95780319 / fix 14 | `listRuntimeFiles()` now includes `docs/ops/policy-catalogue.json`, `docs/ops/FLAG-REGISTER.json` and `docs/sdp360/completion/CONNECTOR-REGISTER.csv` (all `true`). `pc-nodocs.js hide` (catalogue unreadable) gives **300 four-eyes entries, every key `four_eyes=true`, `needsSecondPerson=true`**, so it fails closed. With the catalogue present: 81 four-eyes entries. | **FIXED** |
| **N-09 (P2)** freshness SLI ignores failures before the first ok | 756c1fa0 / fix 17 (`first_run` = MIN started_at of ok or error runs) | The r4 stub was rewritten to return `first_run` from the new query (`sli-latefirst.js`). A job failing for 29 days and then ok once gives **`value 0.1`, `measured_from` = first failure, `fresh_pct 0.1`**. Variant: first error 60 days ago gives `measured_from` = window start, 0.1. | **FIXED** |
| **N-11 (P3)** pool has no acquire / statement timeout | fix 17 (`connectionTimeoutMillis` = `PG_POOL_ACQUIRE_TIMEOUT_MS`, default 10 s → typed `DB_BUSY` 503) | `lock-user.sh` holds `ACCESS EXCLUSIVE` on `weekly_reports` for 45 s and sends 15 authenticated `GET /api/reports`. **10** requests hold a client and wait the full lock (≈43 s; there is still no statement timeout). The **5 queued** requests fail at 10.0 s, but with **401 "Unauthorized" (2×)** and **500 "Auth check failed" (3×)**, **not 503 DB_BUSY**. Login took 38.5 s: each best-effort DB step (rate-limit store, system-log) waits 10 s and then falls back. `/ready` answered 503 in 2.0 s. | **PARTIAL**: the acquire is now bounded, but the error is mis-typed. See new **N-12** |
| Truncation residuals (P3): knob re-opens the ratchet, unreadable anchor store degrades silently, `confirm-shrink` above the anchor | fix 17 | `guard-pure.js`: confirm=2 and confirm=3 with a repeated cap are **refused from 66 down** (stored stays 81). Failing anchor store: **all shrinks REFUSED**, logged to `sync`. `confirm-shrink.js` refuses a count above the anchor (code + test). | **FIXED** |
| Backup residuals (P3): 16-space key, a rejected dump left with a managed name | fix 17 | `bk-key.js`: 16 spaces gives **REFUSED** ("< 16 non-space chars"), with no spawn and 0 files. An undersized dump is renamed `*.rejected`, which `isDumpName` ignores. | **FIXED** (P3 note: `.rejected` files are "never pruned", so they accumulate) |
| activate-switches rollback `from == null` pinned `'0'` | fix 17 | apply L01 then the genuine rollback gives "restored 10 key(s)", and **0 rows remain** for those keys (absent → absent) | **FIXED** |
| R4-A3/A4 (audit) rollback files signed; `--apply` needs lots/reason/operator | fix 17 | `--apply` without `--lots` is refused; a reason under 10 characters is refused. A tampered file (an `authz_enforce_caps` entry added) is **refused** (sha mismatch and not in the lot). A tampered file **re-signed with the tool's own exported `rollbackHash`** is **refused** ("sha256 never recorded in system_log by --apply"). | **FIXED** |
| F-07 (P2) noisy load evidence (`write` class OVER because of by-design `field.envelope` 400s) | — | still OVER: write errors 50 % | **NOT FIXED** |
| F-07b (P3) positional arg ignored in blocking mode | — | `PERF_BUDGETS_BLOCKING=1 node tools/test/perf-budget-check.js <json>` prints "nothing to check", exit 0 | **NOT FIXED** |
| N-04, N-05, F-06, F-08, F-09, F-10 (P3) | — | not in the fix diffs | NOT FIXED (P3) |

## 1. Evidence re-run at 3ee4dd2 (command · result)

Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit --test-concurrency=4 <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | 35 files: activate-switches, assets-sync*, backup-encrypt/job/schedule, boot-integrity, db-restore, health-deps(.smoke), health-public, health-version(-provenance,.smoke), perf-baseline, perf-budget-check, perf-calendar-helpdesk-scan, **pg-pool-acquire-timeout**, pg-pool-idle-error, ready-probe.smoke, ready-readonly, ready-timeout, restore-drill(-admin-card,-full), sli-readings, sync-drift, sync-jobs-registry, sync-routes.smoke, sync-runner, sync-schedule, sync-skip-semantics, sync-write-fence, zoho-sync-survey-truncation, zoho-sync-truncation-anchor, zoho-sync-truncation-guard | **202 tests, 202 pass, 0 fail, 0 skip**, 203 s, exit 0. Log: `/tmp/claude-0/p11ops-r5/e1.out` | VERIFIED |
| E2 | Load: my own `node server.js` on port 3595 against `sdp_test_p11ops_r5`, running `tools/test/load.js --sessions=5 --duration=180 --scenarios=reports,helpdesk,field,export,pages,deck --pid --pg-stat-url` | 1 316 requests, 7.3 req/s, **0 × 5xx**. The 110 errors (8.4 %) are all by-design `field.envelope` 400s. p95: page_data 432 ms, sync 241, write 448, export 290, **deck_generation 7 441 ms** (all-sites monthly p95 8.8 s, p99 10.0 s). RSS 152 → 387 MB. Max 26 DB connections, **0 lock waits**. `/ready` sampled every 3 s: **60/60 = 200**, max 0.51 s. Table: `/home/user/qual/out/r5-operations-load-run.md` | VERIFIED (observation; host load 12–16) |
| E3 | `tools/test/perf-budget-check.js --load=<json>` | page_data, sync, export and deck_generation are within budget; write is OVER (F-07). Exit 0 in warn mode, exit 1 with blocking. Budgets are still `PROPOSED`, `approved_by: nobody` | VERIFIED |
| E4 | `scale-run.js restore --db=sdp_test_p11ops_r5` (includes migrations 120/121/125/130) | 226 tables, 47 507 rows, encrypted=true, **0 mismatches**, 8.4 s; target dropped | VERIFIED |
| E5 | Round-4 repros (§0) | as above | VERIFIED |
| E6 | Business-readiness runbook commands run against my DB (not live): B4 `restore-drill.js --backup-first` (report dir redirected to /tmp), B1 `check-secrets.js`, D4 `audit-roles.js`, `sdp-manager.js status`, §3 `activate-switches` plan → dry-run → apply → rollback (L01), J5 `pilot/pilot-metrics.js` (+ bad dates, unknown site, no pseudonym key) | All ran: the drill **PASS** (10 tables equal), "Aucun secret en clair", audit-roles lists 1 admin with no site, status shows backups/disk. Activation: 10 switches applied and rolled back to absent. pilot-metrics writes nothing (`SET SESSION … READ ONLY`), validates dates, prints "no data" rather than 0, and omits the per-user section without a key. | VERIFIED (except `sdp-manager verify/update/rollback/backup`, `harden-audit-grants.sql`, `reencrypt-secrets`, which were not run) |
| E7 | Installer PowerShell (`tools/installer/tests/run-all.ps1`) | no `pwsh` on the host | NOT VERIFIED |
| E8 | Soak longer than 3 min, production volume, external `/ready` availability SLI | not run | NOT VERIFIED |

Counts: **6 verified, 2 not verified.**

## 2. New claims attacked at 3ee4dd2 (one per capability, none repeats an earlier attack)

| Capability · claim | Attack | Outcome |
|---|---|---|
| Health / pool (fix 17): "a timed-out acquire is a typed DB_BUSY answered 503 + Retry-After" | §0 N-11 lock repro, looking at the status codes of the 5 queued requests | **BROKEN.** The global `/api/` gate (`server.js:1106`: `try { user = await rdb.validateSession(token) } catch (e) { user = null }`) turns DB_BUSY into **401 Unauthorized**. `requireReportSession` (`server.js:3258`) turns it into **500 "Auth check failed"**. `public/auth.js:170` answers a 401 on `/api/reports/auth/me` with `clearSession(); redirectLogin()`. Under a DB stall of more than 10 s, every page load therefore **logs users out** (while their server session is still valid) instead of showing "busy, retry". → **N-12** |
| Rollback scripts (new lot 5, migration 125): "Fails (and changes nothing) while a gate checklist is defined for an extended stage" (`db/postgres_rollback/125_ppm_lifecycle_audit_drop.sql` header) | On `sdp_test_p11ops_r5_rb`: one programme/objective/project and a checklist with `gate_to='idea'`, then `psql -f` on the rollback (the only psql form the docs show; no `-1`/`BEGIN` in the file) | **BROKEN.** Statement 1 `DROP CONSTRAINT` succeeds, statement 2 `ADD CONSTRAINT` errors ("violated by some row"), statements 3–4 **drop `created_by`/`updated_by`**. Result: **no gate_to CHECK at all**, attribution columns gone, and `schema_migrations` still lists 125. A later `node db/migrate.js` reports `applied=0 already=110` and **does not repair** (checksum unchanged). `services/ppm/reviewStore.js:19` SELECTs `created_by`, so it would fail if the review workflow switch were on. Only 1 of 39 rollback scripts wraps a transaction. → **N-13** |
| Backup / restore (business-readiness pack, new lot 6 documents): "B4 restore drill PASS = restore exercise done" (`RUNBOOK-EXPLOITATION.md` B2/B4, `CHECKLIST-GO-LIVE.md`) | Searched the pack, `services/backup.js`, `tools/sdp-manager.js` and `services/sync/jobs.js` for any copy of `data/blobs` (inspection photos/signatures, field uploads, and now `ppm-doc/` project documents) | **BROKEN (gap).** No product job and no runbook step backs up the file store. `sdp-manager backup` and `backup_offsite_path` carry the DB dump only. B4 runs the DB-only drill. The `--full` drill (which would report blobs as "UNKNOWN — NOT PROVEN") is not in the runbook, and `restore_drill_full` is `0`. The pack never mentions the file store. A server loss during the field pilot loses every photo and document while the runbook shows a green restore exercise. → **N-14** |
| Ops tooling (runbook §3, fix 17): activate-switches is "the single tool" for wave activation, alongside the Policy Center four-eyes (fix 14) | Intersected the keys `--apply` writes for L01–L20 (outbound excluded) with the catalogue's four-eyes keys, then evaluated `needsSecondPerson(e,'0','1')` | **BROKEN (governance gap).** 14 four-eyes keys are applied by one operator. **6 would need a second super_admin** in the center: `portfolio_editor_plan_writes` (L03), `asset_money_certify_display` (L11), `login_limit_failures_only`, `access_grant_expiry_job`, `emergency_access_enabled`, `access_recert_enabled` (L12). The tool neither refuses nor flags them as four-eyes; only "ACC:widens" is shown for some. Mitigating factor: it needs the DB URL (DBA-level) plus a free-text `--operator`. → **N-15 (P2)** |
| Activation rollback integrity (R4-A3) | Tampered file; tampered file re-signed with the exported `rollbackHash` | Holds (both refused; see §0) |
| Pilot measurement (business-readiness J5): pilot-metrics is read-only, never shows 0 for no data, pseudonymised | SQL-ish `--from`, from > to, unknown site, no pseudonym key | Holds. P3 note: the load harness super_admin's 656 writes count as "business events" (so do any admin/scripted writes; no actor filter). |
| Scenario engine (new lot 6) under hostile size | Read `services/ppm/portfolioScenario.js` bounds | Holds (≤ 50 shifts, ±24 months; read-only) |
| Boot / migrations 120–130 survive backup/restore | E4 + E1 boot-integrity | Holds (0 mismatches; rollback scripts exist for 120/121/125/130, but see N-13) |

## 3. Findings (round 5)

### P0 — none.

### P1
**N-14 — The business-readiness runbook proves only the database is restorable. Nothing backs up the file store (photos, signatures, field uploads, PPM project documents), and B4 "PASS" reads as a restore exercise.**
- Where: `docs/business-readiness/RUNBOOK-EXPLOITATION.md` B2/B4/D1; `docs/business-readiness/CHECKLIST-GO-LIVE.md` (no file-store row); `services/backup.js` and `tools/sdp-manager.js backup` (DB dump only); `services/ppm/projectDocuments.js:3` (documents go to `data/blobs/ppm-doc/`); `docs/ops/FLAG-REGISTER.md:244` (`restore_drill_full` = 0).
- Repro: `grep -n -iE "blob|--full|photos|documents" docs/business-readiness/*.md` gives no hit for the file store. `node tools/pg/restore-drill.js --backup-first` (B4) prints PASS with only DB tables compared. `--full` without `--blob-backup` would say "files are NOT proven restorable".
- Impact: the field pilot captures photos and signatures, and Lot 6 adds documents. A disk or server loss restores the DB with references to files that no longer exist, while the go-live evidence shows a passed restore exercise.
- Fix / test to add: a runbook step and a scheduled copy of `data/blobs` (or `SDP_BLOB_BACKUP_DIR`) next to the dump; make B4 `--full --blob-backup <copy>` and require "ok", not "UNKNOWN"; add a checker rule in `tools/release/business-readiness-check.js` that the runbook names the file store. Rollback risk: none (procedure/docs).

### P2
**N-12 — A database stall turns into a forced logout: a pool-acquire timeout (DB_BUSY) is answered 401/500 by the auth layers, and the browser clears the session on 401.**
- Where: `server.js:1106` (global `/api/` gate swallows the error into `user = null`, giving 401), `server.js:3258` (`requireReportSession` gives 500), `public/auth.js:170` (401 on `/auth/me` gives `clearSession(); redirectLogin()`).
- Repro: start a server on a throwaway DB, run `bash /tmp/claude-0/p11ops-r5/lock-user.sh` (it locks `weekly_reports` for 45 s and sends 15 report GETs). The queued requests answer `401 {"error":"Unauthorized"}` / `500 {"error":"Auth check failed"}` at 10.0 s; the server log shows `[auth] validateSession failed: database busy`.
- Impact: before fix 17, users waited about 43 s; now they are logged out. It is wrong state shown to the user and a support incident on every DB stall (VACUUM FULL, migration, long backup lock). No data loss: the field outbox is kept and server sessions stay valid.
- Test to add: with `validateSession` throwing a `DB_BUSY` error, the gate and `requireReportSession` answer 503 + `Retry-After` (via `httpError.fail`), and `auth.js` does not log out on 503. Rollback risk: low.
- Residual (P3): clients already holding a connection still wait for the whole lock (no statement timeout on user routes), and login under saturation costs about 10 s per best-effort step (38.5 s observed).

**N-13 — Rollback 125 claims to "fail and change nothing" but, run with `psql -f`, it leaves the schema half rolled back: no gate CHECK constraint, attribution columns dropped, and the migration still journalled.**
- Where: `db/postgres_rollback/125_ppm_lifecycle_audit_drop.sql` (4 separate statements, no transaction); same pattern in 38 of 39 rollback scripts. No doc tells the operator to use `psql -1` / `--single-transaction`.
- Repro: create a throwaway DB, `node db/migrate.js`, insert one programme/objective/project and one `ppm_gate_checklists` row with `gate_to='idea'`, run `psql "$URL" -f db/postgres_rollback/125_ppm_lifecycle_audit_drop.sql`. Then check: `pg_constraint` has 0 rows for `ppm_gate_checklists_gate_to_check`, `portfolio_projects` has no `created_by`/`updated_by`, and `node db/migrate.js` reports `applied=0` (no repair).
- Impact: the manual-rollback path (CAB rollback of Lot 5) silently produces an unconstrained, inconsistent schema. Not a live path until someone rolls back, hence P2.
- Fix / test to add: wrap each rollback script in `BEGIN; … COMMIT;` (or document `psql -1 -v ON_ERROR_STOP=1`), and add a test that runs every rollback script against a DB with an offending row and asserts all-or-nothing. Rollback risk: none.

**N-15 — `tools/ops/activate-switches.js --apply` writes four-eyes report_config keys with a single operator, including 6 that the Policy Center would hold for a second super_admin (for example `emergency_access_enabled`, L12).**
- Where: `tools/ops/activate-switches.js` (no `policyCatalogue.needsSecondPerson` check); the runbook §3 makes it the single activation tool.
- Repro: run `--plan --lots=L03,L11,L12` and intersect with `policyCatalogue.build()` four-eyes keys. `needsSecondPerson(entry,'0','1')` is `true` for the 6 keys listed in §2.
- Impact: the four-eyes rule exists in the UI and the legacy PUT, but not on the documented bulk path. It needs DB credentials, so it is a governance gap rather than a privilege escalation.
- Fix / test to add: `--apply` refuses (or requires a `--second-operator` recorded in the journal) for a key whose change `needsSecondPerson`; plan output marks four-eyes keys. Rollback risk: none.

Carried, not fixed: **F-07** (load evidence: the write class is OVER because of by-design 400s).

### P3
- `*.rejected` undersized dumps are never pruned, so they accumulate in `SDP_BACKUP_DIR`.
- Project documents: `ON DELETE CASCADE` on `ppm_project_documents` removes rows on a hard project delete. Not tested whether the `ppm-doc/<id>` blob folder is removed too (possible orphan files).
- pilot-metrics "active users on business events" counts scripted/admin writes (no actor filter); the load harness account reads as a 656-event user.
- Deck generation p95 7.4 s / p99 10.0 s at load average 12–16 (budget 10 s proposed). This is at the edge on a shared host; a soak was not run.
- Carried: N-04, N-05, F-06, F-07b, F-08, F-09, F-10.

## 4. Per P03 lot touching operations — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L13 Operations resilience (incl. `policy_center_enabled`) | **CONDITIONAL** (AI panel recommendation, not a decision) | Every r4 ops P1/P2 is fixed or partial (N-10, N-09 fixed; N-11 partial); tests 202/202; restore 0 mismatches; `/ready` bounded. Conditions: N-12 fixed (no logout on DB_BUSY); G-11 RPO/RTO approved; the file-store backup decided (N-14); truncation and plaintext-backup policies decided by the SRE. |
| Policy Control Center | **GO PILOT on activation** (AI panel recommendation, not a decision), **with N-15 as a condition for any lot applied by the CLI** | The catalogue ships and fails closed. The CLI path bypasses four-eyes for 6 keys. |
| Business-readiness pack (runbook / pilot plan) | **CONDITIONAL** (AI panel recommendation, not a decision) | Commands exist and work on a throwaway DB (E6). N-14 must be fixed before the field pilot (P1). |
| Activation tooling (`activate-switches`) | **GO PILOT for lots without four-eyes keys (L01, L02 minus site-scope reads, L13 minus outbound)**; **CONDITIONAL for L03/L11/L12** (AI panel recommendation, not a decision) | Signed rollbacks, lot/reason/operator required, absent-restore verified. N-15 for the four-eyes keys. |
| L10 Reporting rhythm (connector health) | **GO PILOT** (AI panel recommendation, not a decision) | N-09 fixed. |
| L11 Site operations evidence | **GO PILOT** (ops part) (AI panel recommendation, not a decision) | The truncation ratchet holds under every variant tried. |
| Portfolio Lots 2–6 (migrations 121/125/130) | ops part only: **CONDITIONAL** (AI panel recommendation, not a decision) | They apply and survive backup/restore. N-13 must be fixed before relying on the manual rollback scripts in a CAB plan. Functional review belongs to the PPM seat. |
| Others | out of this seat's area — no recommendation. |

## 5. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md` at 3ee4dd2 — decision columns blank)
- Backup / restore RPO-RTO (G-11) — CAB + SRE (row 12); now also the **file-store backup** scope (N-14).
- Capacity — load/soak accepted (E-B05) — SRE + DBA (row 27); `docs/ops/perf-budgets.json` still PROPOSED, `approved_by: null`.
- QA lead — CI green on the target SHA, skipped tests reviewed (row 26).
- Penetration test / accepted analysis (row 25) — N-12 and N-15 relevant.
- Security — access policy CG-01/CG-02, authz matrix (row 8) — four-eyes on the CLI path (N-15).
- CAB — dependency release / PostgreSQL-only cutover (row 10), production GO/NO-GO (row 24), and DBA execution of `harden-audit-grants.sql` (runbook D2, not run here).
- Policy decisions surfaced, **not** filled: `PG_POOL_ACQUIRE_TIMEOUT_MS` and statement timeouts, `SYNC_TRUNCATION_SHRINK_CONFIRMATIONS`, `SDP_BACKUP_ALLOW_PLAINTEXT`, `restore_drill_full`, file-store backup target and retention, SLO targets, `ppm_documents_enabled` storage/retention/malware scanning, and who is the second operator for four-eyes switches applied by CLI.
