# P11 qualification — ROUND 3 — seat: operations (Operations / SRE)

**AI review — not an independent human review.** AI panel seat "operations". No live system touched, no product
code modified, nothing pushed/merged/tagged, no human decision filled. Frozen SHA: `ead6efb6439296a34915b7d9a47f7011cd15fa82`
(clone `/home/user/qual/operations`, `git rev-parse HEAD` confirmed; agent-execution narratives not read).
Round-1 (`operations.md`) and round-2 (`r2-operations.md`) files untouched. Throwaway proofs: `/tmp/claude-0/p11ops-r3/`
and `/tmp/claude-0/p11attack-r3/` (my files: `ratchet-double.js`, `lockhold.js`, `sql.js`; the other files in that second
folder — `r3-ratchet.test.js`, `e1.out`, `e3.out`, `sweep.out`, `uxf/` — belong to other seats and are NOT used as
evidence here). Throwaway DB `sdp_test_p11ops_r3` (made with `tools/test/scale-run.js prepare --rows=20000`), dropped
by name at the end, as was `sdp_test_p11ops_r3_restored`; credential and env files deleted. No other database touched.
The run was cut by a usage-limit pause; server and load were restarted from scratch after the pause.

## 0. Round-2 findings — re-checked at ead6efb

| R2 | Claimed fix | Repro re-run (own DB) | Verdict |
|---|---|---|---|
| **N-01 (P1)** requests sync: an export short by < 20 % deletes tickets permanently | 89f2a3d (live ids missing locally are upserted on the next run) | `PG_URL=<own db> node /tmp/claude-0/p11attack-r2/requests-subtol.js <clone>` → full 1000 · 81 % export → 810 (err null) · **healthy incremental → 1000** · forced → 1000 (round 2: healthy → 810) | **FIXED** (self-heal on the next healthy run; the bad run itself still deletes, see N-02r) |
| **N-02 (P2)** guard compares to the current count only → ratchet | 89f2a3d + 5ffdd57 (anchor = last confirmed count, `sync_truncation_anchors`) | `survey-ratchet.js` (five 81 % runs in a row) → 100 → 81, then runs 2-5 **refused** "fetched 66 rows but 81 are stored, last confirmed count 100 (−34 %)", healthy → 100 | **PARTIAL** — the round-2 sequence is blocked, but a new sequence still ratchets (§2 row 1, N-02r) |
| **N-03 (P2)** `/ready` 200 on a read-only DB | 188d965 + 5ffdd57 | own server :3593, `ALTER DATABASE … SET default_transaction_read_only=on` + terminate backends → `/ready` **503** `{"ok":false,"db":true,"writable":false,"error":"read_only"}` (twice); reset → 200 | **FIXED** |
| R1 F-01 survey truncation | — | `survey-trunc.js` → 100/100 kept, refused at −95 %, healthy 100 | still FIXED |
| R1 F-03 assets partial view | — | `assets-partial.js` → refused at −100 %, 2 473 kept | still FIXED |
| F-04 (P2) `/health` anonymous Zoho OAuth state | — | `curl /health` → still `tokenValid, grantedScope, lastRefreshError, orgId, workspaceId` | **NOT FIXED** |
| F-05 (P2) plaintext backup without `SDP_BACKUP_KEY` | — | `services/backup.js:165` warning only, unchanged | **NOT FIXED** (human policy) |
| F-07 (P2) noisy evidence | — | load: `write` class still OVER (50 % = by-design `field.envelope` 400) | **NOT FIXED** |
| F-07b (P3) positional arg in blocking mode | — | `PERF_BUDGETS_BLOCKING=1 perf-budget-check.js <json>` → "nothing to check", exit 0 | NOT FIXED (P3) |
| N-04, N-05 (P3), F-06/F-08/F-09/F-10 (P3) | — | code unchanged in the diff | NOT FIXED (P3, accepted as later) |

## 1. Evidence re-run at ead6efb (command · result)

Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `NODE_OPTIONS="--require tools/test/blocking-stdio.js --require tests/_default-env.js --import file://tests/_pg-boot.mjs" node --test --test-force-exit --test-concurrency=4 <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | 32 files: assets-sync(-status.smoke), backup-encrypt/job/schedule, boot-integrity, db-restore, health-deps(.smoke), health-version(-provenance,.smoke), perf-baseline, perf-budget-check, perf-calendar-helpdesk-scan, **ready-probe.smoke, ready-readonly**, restore-drill(-admin-card,-full), sdp-manager-probe, sdp-manager.smoke, sli-readings, sync-drift, sync-jobs-registry, sync-routes.smoke, sync-runner, sync-schedule, sync-skip-semantics, sync-write-fence, zoho-sync-survey-truncation, **zoho-sync-truncation-anchor**, zoho-sync-truncation-guard | **177 tests, 177 pass, 0 fail, 0 skip**, 77 s, exit 0. Log `/tmp/claude-0/p11ops-r3/e1.out` | VERIFIED |
| E2 | Load: own `node server.js` PORT 3593 on `sdp_test_p11ops_r3` (20k tickets), `tools/test/load.js --sessions=5 --duration=180 --scenarios=reports,helpdesk,field,export,pages,deck --pid --pg-stat-url` | 4 404 req, 24 req/s (deck-dominated: all-sites monthly deck p50 1.9 s), **0 × 5xx**, errors 367 (8.3 %) = all by-design `field.envelope` 400; p95 page_data 96 ms, sync 57, write 97, export 63, **deck_generation 2 201 ms (first sample — R2 had none)**; RSS **117 → 434 MB** in 3 min; max 30 DB conns, **0 lock waits**. Table: `/home/user/qual/out/r3-operations-load-run.md` | VERIFIED (observation; not comparable to R2 because the deck scenario was added) |
| E3 | `perf-budget-check.js --load=<json>` | within page_data/sync/export/deck_generation; OVER write (by-design 400s); exit 0 warn, exit 1 with `PERF_BUDGETS_BLOCKING=1` | VERIFIED |
| E4 | `scale-run.js restore --db=sdp_test_p11ops_r3` | 219 tables, 30 579 rows, encrypted=true, **0 mismatches**, 6.5 s; `_restored` dropped | VERIFIED |
| E5 | R2/R1 repros (section 0) | as above | VERIFIED |
| E6 | Installer PowerShell (`tools/installer/tests/run-all.ps1`) | no `pwsh` on host — not executed | NOT VERIFIED |
| E7 | Soak > 3 min, production volume, external `/ready` availability SLI | not run | NOT VERIFIED |

Counts: **5 verified, 2 not verified.**

## 2. New claims attacked at ead6efb (one per capability, none repeated from round 2)

| Capability · claim | Attack | Outcome |
|---|---|---|
| Sync — "repeated partial exports can no longer ratchet a table down" (`db/postgres/sync/113_truncation_anchors.sql`, `truncationGuard.js` header) | (a) `/tmp/claude-0/p11attack-r3/ratchet-double.js`: each 81 % export fed **twice** (a deterministic cap behaves like this). (b) pure `assertNotTruncated`/`nextAnchor` with alternating fetches 81, 82, 66, 67, 54, 55, 44 | **BROKEN.** (a) 100 → 81 (anchor stays 100) → 81 again (anchor lowered to 81) → 66 → 66 (anchor 66) → 54 → 44, all accepted. (b) a run that fetches even ONE row more than is stored re-anchors (`nextAnchor`: `fetched >= stored → fetched`), so 100 → 44 with no refusal. → N-02r |
| Health — "/ready answers whether we can serve" | `/tmp/claude-0/p11ops-r3/lockhold.js` holds `LOCK TABLE sync_metadata IN ACCESS EXCLUSIVE MODE` (what a migration / `VACUUM FULL` takes) for 60 s; 12 anonymous `GET /ready` in parallel; then a login | **BROKEN.** All 12 `/ready` hang (curl timeout at 40 s, never a 503); **login hangs 40 s too**. Control: same lock, no `/ready` flood → login 200 in 0.09 s. The readiness query has no timeout and each hanging probe holds a pool connection (`PG_POOL_MAX` default 10) → an unauthenticated endpoint can drain the pool. Lock released → `/ready` 200. → N-06 |
| Health — "/ready stays responsive while decks render" | 10 concurrent all-sites monthly decks while sampling `/ready` 15× | Holds: `/ready` 4-131 ms throughout |
| Backup — "keep the newest `keep` dumps" / drill restores the newest dump | `/tmp/claude-0/p11ops-r3/bk-latest.js`: two timestamped dumps + an operator-named `sdp_dashboard_before-upgrade.sql` | **BROKEN (P3).** `latestDump` → `sdp_dashboard_before-upgrade.sql` (letters sort after digits); `prune(keep=1)` deletes BOTH real backups and keeps the manual file. The nightly drill (`restore-drill.js:220`, `backupFirst:true`) would then restore the manual file, not the fresh dump, and log success. → N-07 |
| SLI — "a reading the server cannot make is null, never green" (`services/sliReadings.js` header) | `/tmp/claude-0/p11ops-r3/sli-neverok.js`: mock PG; `zoho.helpdesk_lite` ok hourly, `zoho.requests` declared in `freshness` but never ok | **BROKEN.** `sync_freshness.value = 100` (the "worst job"), `jobs = ['zoho.helpdesk_lite']` only — a job that never succeeded is dropped from the list (`gather` keys on ok rows only). → N-08 |
| Boot integrity — "every relative require resolves to a tracked file" | `/tmp/claude-0/p11ops-r3/dynreq.js`: resolve the 9 `require(path.join(__dirname,…))` and `jobs.js req('…')` targets the test's literal-only regex does not scan | Holds: 9 checked, 0 missing. Coverage gap only (P3 note, not a finding) |
| Perf — deck generation within budget | load run with `deck` scenario | Holds: p95 2.2 s vs proposed 10 s; RSS climbs to 434 MB in 3 min (no soak → not verified) |

## 3. Findings (round 3)

### P0 — none.
### P1 — none open in this area (N-01 fixed and verified).

### P2
**N-02r — Truncation anchor is re-set by any run that fetches at least as many rows as are stored, so the ratchet still works with a repeated or slightly growing partial export.**
- Where: `services/sync/truncationGuard.js` `nextAnchor` (`if (fetched >= stored) return fetched;`), used by every guarded reconcile (change, cab, survey, requests, assets).
- Repro: own DB, `PG_URL=<throwaway> node /tmp/claude-0/p11attack-r3/ratchet-double.js <clone>` → 100→81→81→66→66→54→54→44→44, anchors 100,81,81,66,66,54,54,44 with no refusal; pure: `node -e` with the sequence 81,82,66,67,54,55,44 → stored 44, no refusal.
- Impact: survey/assets/requests self-heal on the next complete export (N-01 fix), so loss lasts until the source is healthy again; a source stuck on a shrinking cap (row limit, pagination bug) keeps deleting with each run "success". Not P1 because recovery is now automatic once the export is complete.
- Test to add: a sequence 100, 81, 82, 66, 67 must be refused at 66 (cumulative loss vs the last confirmed count > tolerance); and two identical 81-row runs must not lower the anchor without an explicit operator confirmation or N clean runs. The tolerance and the "genuine shrink" rule are SRE policy (not decided here).
- Rollback risk: low; risk of the fix is a stuck sync after a genuine large shrink (already the case > 20 %).

**N-06 — `/ready` has no query timeout: under a long table lock it hangs and, flooded anonymously, exhausts the PostgreSQL pool for every user.**
- Where: `routes/health.js` `/ready` (no `statement_timeout`/race), `services/pgDb.js:82` (pool `max` 10, no statement timeout).
- Repro: own server, hold `ACCESS EXCLUSIVE` on `sync_metadata` (lockhold.js, 60 s); 12 × `curl -m 40 /ready` → all time out (000); login during lock → 000 after 40 s; same lock without the flood → login 200.
- Impact: during a migration or maintenance lock, external probes that retry (load balancer, sdp-manager, monitoring) turn a table lock into a full outage; `/ready` never says "not ready".
- Test to add: with a held lock on the readiness tables, `/ready` answers 503 within N seconds and a concurrent login still succeeds (readiness query bounded by `SET LOCAL statement_timeout` or a timer, or a dedicated tiny pool / single-flight).
- Rollback risk: low.

**N-08 — Sync-freshness SLI drops jobs that never succeeded, so "worst job" can read 100 % while a declared job is dead.**
- Where: `services/sliReadings.js` `gather` (`raw.sync = Object.keys(by)…` — `by` is built from ok rows only).
- Repro: `node /tmp/claude-0/p11ops-r3/sli-neverok.js <clone>` → `value 100 jobs ['zoho.helpdesk_lite']` (`zoho.requests` declared, never ok, absent).
- Impact: `/api/health/deps sli_30d` shows a number that contradicts its own "null, never green" rule; observation surface only (no RAG), hence P2.
- Test to add: a job present in `freshness` with zero ok rows ever → listed with `fresh_pct: 0` (or null with a reason) and the worst-job value is 0/null, not 100.
- Rollback risk: none.

Carried, not fixed: **F-04** (`/health` disclosure), **F-05** (plaintext backup fallback — human policy), **F-07** (noisy load/L13 evidence).

### P3
- **N-07** `latestDump`/`prune` order by file name: an operator-named file with the `sdp_dashboard_` prefix is treated as the newest, kept forever, and the real backups are pruned; the drill restores it. No product writer creates such a name today (installer uses `sdp_dashboard.sql`, no underscore) — P2 if operators are told to park manual dumps in the backup directory. Test: only names matching `sdp_dashboard_\d{8}T\d{6}Z` are counted.
- Boot-integrity test scans literal relative requires only (dynamic `path.join` / `req()` targets all resolve today — verified once).
- Carried: N-04, N-05, F-06, F-07b, F-08, F-09, F-10.
- Load observation: RSS 117 → 434 MB in 3 min with decks; no soak — not verified.

## 4. Per P03 lot touching operations — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L13 Operations resilience | **CONDITIONAL** (AI panel recommendation, not a decision) | N-01 and N-03 fixed and verified; 177/177 tests; restore drill 0 mismatches. Conditions: N-06 fixed (or `/ready` probes rate-limited/single-flighted) before `sdp-manager` update/restore relies on it in pilot; N-02r tolerance/re-anchor rule decided by SRE; G-11 RPO/RTO approved by a human. |
| L10 Reporting rhythm (connector health part) | **CONDITIONAL** (AI panel recommendation, not a decision) | Connector health / SLI can still show success/100 % for a lossy run (N-02r) or a never-ok job (N-08). |
| L11 Site operations evidence (WAN/assets) | **GO PILOT** (AI panel recommendation, not a decision) | F-03 still fixed; assets self-heal on the next complete view; N-02r residual bounded by self-heal. |
| Others | out of this seat's area — no recommendation. |

## 5. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md` at ead6efb — all decision columns blank)
- Backup / restore RPO-RTO (G-11) — CAB + SRE (row 12).
- Capacity — load / soak result accepted (E-B05) — SRE + DBA (row 27); `docs/ops/perf-budgets.json` still `approved_by: null`, status PROPOSED.
- QA lead — CI green on target SHA, skipped tests reviewed (E-B05) (row 26).
- Penetration test / accepted analysis (E-B05) — Information Security (row 25) — F-04, N-06 relevant.
- CAB — production GO/NO-GO and dependency/cutover rows (unchanged since round 2).
- Policy decisions surfaced, not filled: truncation tolerance and re-anchor rule (N-02r), plaintext-backup fallback (F-05), SLO targets, backup naming convention (N-07).
