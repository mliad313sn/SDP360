# P11 qualification — ROUND 2 — seat: operations (Operations / SRE)

**AI review — not an independent human review.** AI panel seat "operations". No live system touched, no product
code modified, nothing pushed/merged/tagged, no human decision filled. Frozen SHA: `b2e85cd08860a57526442797ac711e2fc9defc3a`
(clone `/home/user/qual/operations`, `git rev-parse HEAD` confirmed). Round 1 file (`operations.md`, SHA 7eee8955) untouched.
Throwaway proofs: `/tmp/claude-0/p11attack/` (round 1) and `/tmp/claude-0/p11attack-r2/` (round 2) — never committed.
Throwaway DB `sdp_test_p11ops_r2` (created by `tools/test/scale-run.js prepare --rows=20000`), dropped by name at the end;
cred + env files removed. No other database touched.

## 0. Round-1 findings — re-verification at b2e85cd

| R1 | Claimed fix | Repro re-run | Verdict |
|---|---|---|---|
| F-01 (P1) survey sync no truncation guard + permanent loss | e905533 | `PG_URL=<own db> node /tmp/claude-0/p11attack/survey-trunc.js <clone>` → `[100,100]`, truncated run → `[100,100]` error `survey/results: fetched 5 rows but 100 are stored (−95 %) … refusing`, healthy → `[100,100]` (was 100→5→5) | **FIXED** (but see N-01/N-02 below: tolerance window still lossy) |
| F-02 (P1) sdp-manager probe blind to dead DB | 5528e28 | Own server :3592; `ALTER DATABASE … ALLOW_CONNECTIONS false` + terminate backends → `/ready` 503, `/api/auth/config` 200, `probeHealth()` (exported) → `{"ok":false,"reason":"HTTP 503 (database not reachable)"}`; before block `{"ok":true}`. Install-SDP.ps1/Setup.bat now probe `/ready` (read only; no pwsh to execute) | **FIXED** (JS verified; PowerShell not executed) |
| F-03 (P2) assets partial view full-replaces | 817a3cb | `node /tmp/claude-0/p11attack/assets-partial.js <clone>` → `markError … fetched 2 rows but 2473 are stored (−100 %) … refusing`; table kept 2 473 | **FIXED** (same tolerance caveat N-02) |
| F-04 (P2) `/health` discloses Zoho OAuth state anonymously | — | `curl /health` → still `tokenValid, grantedScope, lastRefreshError, orgId, workspaceId` (`server.js:1656-1666`) | **NOT FIXED** |
| F-05 (P2) backup silently plaintext without `SDP_BACKUP_KEY` | — | `services/backup.js:164` unchanged (warning only) | **NOT FIXED** (policy choice — human) |
| F-07 (P2) noisy evidence (L13 forced default-state reds; load `write` class always over budget) | — | load run again: `field.envelope` 400×2431, `write` OVER (errors 50 %) | **NOT FIXED** |
| F-06, F-07b, F-08, F-09, F-10 (P3) | — | F-07b re-checked: `PERF_BUDGETS_BLOCKING=1 perf-budget-check.js <file>` (positional) → "nothing to check", exit 0. Others: code unchanged in diff | **NOT FIXED** (P3, accepted as later) |

## 1. Evidence re-run at b2e85cd (command · result)

Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `NODE_OPTIONS="--require tools/test/blocking-stdio.js --require tests/_default-env.js --import file://tests/_pg-boot.mjs" node --test --test-force-exit --test-concurrency=4 <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | 28 files: assets-sync(-status.smoke), backup-encrypt/job/schedule, boot-integrity, db-restore, health-deps(.smoke), health-version(-provenance,.smoke), perf-baseline, perf-budget-check, perf-calendar-helpdesk-scan, restore-drill(-admin-card,-full), sdp-manager-probe, sli-readings, sync-drift, sync-jobs-registry, sync-routes.smoke, sync-runner, sync-schedule, sync-skip-semantics, sync-write-fence, zoho-sync-survey-truncation, zoho-sync-truncation-guard | **153 tests, 153 pass, 0 fail, 0 skip, 0 todo**, 86 s, exit 0 (no `53300` this time — max_connections 400) | VERIFIED |
| E2 | Load: own `node server.js` PORT 3592 on `sdp_test_p11ops_r2` (20k tickets), `tools/test/load.js --sessions=5 --duration=180 --scenarios=reports,helpdesk,field,export,pages --pid --pg-stat-url` | 24 315 req, 135 req/s, 0 × 5xx; errors 2 431 (10 %) = all by-design `field.envelope` 400; p95 page_data 71 ms, sync 52, write 89, export 66; RSS 118 → 321 MB in 3 min; max 16 DB conns, max 2 lock waits. Table: `/home/user/qual/out/r2-operations-load-run.md` | VERIFIED (observation; vs R1: −12 % throughput, +10-15 % p95, lock waits 0→2 — shared sandbox with parallel seats, not interpretable as regression) |
| E3 | `perf-budget-check.js --load=<json>` | within: page_data/sync/export; OVER: write (by-design 400s); deck_generation no_sample; exit 0 warn / exit 1 `PERF_BUDGETS_BLOCKING=1` | VERIFIED |
| E4 | `scale-run.js restore --db=sdp_test_p11ops_r2` (server running during dump) | 218 tables, 58 860 rows, encrypted=true, **0 mismatches**, 9.3 s; `_restored` dropped | VERIFIED |
| E5 | F-01/F-02/F-03 repros (section 0) | as above | VERIFIED |
| E6 | Installer PowerShell (`tools/installer/tests/run-all.ps1`), Install-SDP.ps1 probe change | no `pwsh` on host — diff read only | NOT VERIFIED |
| E7 | Soak > 3 min, deck-generation latency, production volume, external `/ready` availability SLI | not run | NOT VERIFIED |

Counts: **5 verified, 2 not verified.**

## 2. New claims attacked (one per capability)

| Capability · claim | Attack | Outcome |
|---|---|---|
| Sync — "a partial export must never mass-delete" (`zoho-sync.js:236-238` comment) | `/tmp/claude-0/p11attack-r2/requests-subtol.js`: 1 000 tickets stored; feed an 81 % export; then healthy incremental; then force | **BROKEN.** 1000 → **810** (no error, recorded success); healthy incremental run → **810**; only `force=true` → 1000. → N-01 |
| Sync — guard tolerance is a single-run bound | `/tmp/claude-0/p11attack-r2/survey-ratchet.js`: 5 successive 81 % exports | **BROKEN (ratchet).** 100 → 81 → 66 → 54 → 44 → 36, every run accepted. Survey self-heals on the next healthy run (→100); requests do not (N-01). → N-02 |
| Health — "/ready = can we serve" (now the gate for update auto-rollback / restore) | `ALTER DATABASE … SET default_transaction_read_only=on` + terminate backends (= PG_URL left on a standby/replica or a read-only cluster after restore/failover) | **BROKEN.** `/ready` → **200** `{"ok":true,"db":true}`; `POST /api/reports/auth/login` → **500** `internal_error`. Reset → login 200. → N-03 |
| Backup — "wrong key / tampered file never returns garbage" | `/tmp/claude-0/p11attack-r2/bk.js`: flip one byte of a `.sql.gz.enc`; open with wrong key | Holds: both → `decryptBuffer: wrong SDP_BACKUP_KEY or corrupted backup`. Note fixed scrypt salt `sdp-backup-key-v1` (P3, N-05) |
| Survey answers — "self-heal brings back lost rows" | `/tmp/claude-0/p11attack-r2/survey-answers2.js`: results view healthy, answers view empty for 10 new results | Recovered on the next run **only because** `isNew()` string-compares ISO `…T…` against a PG timestamp string `… …` (`zoho-sync.js:80-84`): every same-day row looks "new". Across a day boundary the 10 results would keep 0 answers. Not reproduced across days → **not verified**, recorded as N-04 (P3) |
| Perf — "budget check blocks in blocking mode" | positional arg with `PERF_BUDGETS_BLOCKING=1` | Still exit 0, "nothing to check" (R1 F-07b) |

## 3. Findings (round 2)

### P0 — none.

### P1
**N-01 — Requests sync: an export short by < 20 % deletes tickets silently and permanently (incremental filter never re-inserts them).**
- Where: `zoho-sync.js:673-674` (guard passes up to the 20 % tolerance, then `reconcileRequestRecords(liveIds)`); re-insert impossible because of `zoho-sync.js:622-628` (only rows with Last Updated > lastSync, plus MIs). The survey fix added a "missing locally → re-insert" self-heal (`zoho-sync.js:448-453`); requests did not get the same.
- Repro: throwaway DB, `PG_URL=<throwaway> node /tmp/claude-0/p11attack-r2/requests-subtol.js <clone>` → `full run 1000`, `81% export -> 810 err null`, `healthy incremental rerun -> 810`, `forced full rerun -> 1000`.
- Impact: helpdesk volumes, SLA %, ageing, Risk Register occurrences computed from up to 19 % fewer tickets per bad run, shown as truth, no alert (run = success; drift detector default off, 50 % threshold on run row counts, not table size). Same class as R1 F-01 (P1); recoverable only by an operator-forced full sync.
- Regression test to add: stored 1 000, fetch 810 (inside tolerance) → after a subsequent healthy incremental run the table is back to 1 000 (self-heal: live ids missing locally are upserted), and/or deletes inside tolerance are capped/logged as warnings in `sync_runs`.
- Fix rollback risk: low (adds upserts of missing live ids; worst case one larger upsert batch after a bad run).

### P2
**N-02 — Truncation guard compares to the CURRENT local count, not a high-water mark: repeated sub-tolerance partial runs ratchet a table down without limit.** Repro: `node /tmp/claude-0/p11attack-r2/survey-ratchet.js <clone>` → 100→81→66→54→44→36, all accepted. Affects every guarded job (change/cab/survey/requests/assets). Survey and assets self-heal on the next healthy run; requests do not (N-01). Test: N consecutive 81 % fetches must be refused once cumulative loss vs a stored high-water mark (or last-N-runs median) exceeds the tolerance. Rollback risk low. (Tolerance value itself = SRE policy, not decided here.)
**N-03 — `/ready` reports ready on a read-only database.** `routes/health.js:30-55` only SELECTs. Repro: section 2 row 3 (own server, `default_transaction_read_only=on`) → `/ready` 200 while login 500. Since 5528e28 `/ready` gates `sdp-manager update` auto-rollback and restore "service answers"; a restore/failover that leaves `PG_URL` on the step-10 standby replica would be declared healthy. Test: `/ready` returns 503 (or `writable:false`) when `SHOW transaction_read_only` = on / `pg_is_in_recovery()` true. Rollback risk low.
Carried, not fixed: **F-04** (`/health` disclosure), **F-05** (plaintext backup fallback — human policy), **F-07** (noisy evidence).

### P3
- **N-04** `isNew()` compares ISO strings with a `T` against a PG timestamp string with a space (`zoho-sync.js:80-84`): same-day rows are always "new" (extra upserts, masks gaps in tests); answers missing after a partial answers view are only recovered the same day. Test: `isNew('2026-11-19T10:00:00Z','2026-11-19 11:00:00+00') === false`.
- **N-05** Backup scrypt salt is a fixed constant (`services/backup.js:28`); with MIN_KEY_CHARS 16 acceptable, note for crypto owner.
- Carried: F-06, F-07b, F-08, F-09, F-10 (unchanged code).
- Load observation: RSS 118 → 321 MB in 3 min again; still no soak — **not verified**.

## 4. Per P03 lot touching operations — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L13 Operations resilience | **CONDITIONAL** | R1 blockers F-01/F-02 fixed and verified; restore drill 0 mismatches; 153/153 tests. Conditions: N-01 (silent permanent ticket loss inside tolerance) fixed before pilot; N-03 fixed before relying on `sdp-manager restore/update` against the replica topology; G-11 RPO/RTO approved by a human; entra_deprovision needs its identity owner. |
| L10 Reporting rhythm (connector health part) | **CONDITIONAL** | Connector health still shows "success" for an N-01/N-02 lossy run. |
| L11 Site operations evidence (WAN/assets) | **GO PILOT** (AI panel recommendation, not a decision) | F-03 fixed and verified; assets self-heal nightly; N-02 residual bounded to one night. |
| Others | out of this seat's area — no recommendation. |

## 5. Human gates still empty in this area (docs/sdp360/completion/RELEASE-GATES.md at b2e85cd — all columns blank)
- Backup / restore RPO-RTO (G-11) — CAB + SRE.
- Capacity — load / soak result accepted (E-B05) — SRE + DBA (`docs/ops/perf-budgets.json` still `approved_by: nobody`, status PROPOSED).
- QA lead — CI green on target SHA, skipped tests reviewed (E-B05).
- Penetration test / accepted analysis (E-B05) — InfoSec (F-04 relevant).
- CAB — D-11 dependency release, PO-08 PostgreSQL-only cutover; connectors D-07/D-08/D-09; dash-key clients D-15; production GO/NO-GO.
- Policy decisions surfaced, not filled: truncation tolerance value (N-02), plaintext-backup fallback (F-05), SLO targets.
