# Fix 17 — P11 round 4 operations findings (+ audit items R4-A1, R4-A3, R4-A4)

**AI evidence — not an independent human review.** Branch `fix/p11-r4-ops`, worktree `/home/user/w/fix17`, PostgreSQL
only. No live system touched, nothing pushed / merged / tagged, no human decision filled. Sources:
`/home/user/qual/out/r4-operations.md` (operations seat), `/home/user/qual/out/r4-audit.md` (audit seat).
N-10 (Policy Center catalogue packaging) is NOT in this fix — it belongs to fix 14.

## Findings and fixes (each test failed before the fix, passes after)

| Finding | Sev | Fix | Test |
|---|---|---|---|
| N-09 — freshness SLI ignores failures before a job's first ok run (dead 29 days → 100 %) | P2 | `services/sliReadings.js`: the job's history starts at its **first run** (ok or error, any date; self-skips excluded), read as `first_run` with the error count; failures before the first ok count as not fresh. A job with no runs at all stays `null` (unknown). | `tests/sli-readings.test.js` (compose + gather N-09 tests) |
| N-11 — no acquire timeout on the PostgreSQL pool (requests queued ~43 s behind a lock) | P3 | `services/pgDb.js`: `connectionTimeoutMillis` = `PG_POOL_ACQUIRE_TIMEOUT_MS` (default **10 000 ms**, `0` = unbounded). Bounds only the wait for a free pooled client, never the run time of a held query (migrations keep running; `pg_dump` is a separate process). A timed-out acquire becomes typed `DB_BUSY`; `services/httpError.fail()` answers **503** `{error:'database_busy', code:'DB_BUSY', correlation_id}` + `Retry-After: 5`, no internal message. | `tests/pg-pool-acquire-timeout.test.js` (PG: pool of 1 held by `pg_sleep(1.5)` → second request DB_BUSY in < 1.2 s, held query completes) |
| Truncation (a) — `SYNC_TRUNCATION_SHRINK_CONFIRMATIONS ≥ 2` re-opened the ratchet | P3 | `nextAnchorState` never lowers the anchor; the env knob now only ADDS a requirement to the operator confirmation (pending count must have been seen N consecutive runs). | `tests/zoho-sync-truncation-anchor.test.js` "r4: policy N=2 or N=3 never re-opens…" |
| Truncation (b) — unreadable anchor store degraded silently (100 → 36 accepted) | P3 | `guardWithAnchor` logs `sync_truncation_anchor_unreadable` (category `sync`, risk) to system_log and **fails closed for any shrink** (transient refusal, runner retries); growth / equal still sync; the anchor is not rewritten on that run. Write failures are logged too. | "r4: an unreadable anchor store is logged and fails closed…" |
| Truncation (c) — `confirm-shrink --count` above the anchor | P3 | `confirmShrink` refuses a count above the current anchor. | "r4: confirmShrink refuses…" + CLI case in the confirm-shrink PG test |
| Backup (a) — 16-space key accepted | P3 | `services/backup.js keyQualityProblem`: ≥ 16 non-whitespace chars and ≥ 5 distinct chars, write path only (`deriveKey` unchanged so existing backups still open). | `tests/backup-encrypt.test.js` r4 key test |
| Backup (b) — rejected undersized dump left with a managed name | P3 | quarantined as `<name>.sql.rejected` (ignored by `isDumpName`/`latestDump`/`prune`), deleted if the rename fails. | `tests/backup-encrypt.test.js` r4 quarantine test; `tests/backup-job.test.js` adapted |
| activate-switches rollback pins `'0'` for a key absent before | P3 | apply records `absent: true` (no report_config row / missing nested sub-key); rollback deletes the row (or the sub-key) and journals "returned to default". | `tests/activate-switches.test.js` "rollback of a key that had no report_config row…" (PG) |
| R4-A4 — `--apply` with no `--lots` armed all 14 lots, no reason, no operator | P2 | `--apply` (not dry-run) needs explicit `--lots` and `--reason` ≥ 10 chars; operator = `--operator=NAME` or the OS user, recorded as journal actor `cli:activate-switches:<operator>`, in `updated_by` and in the rollback file. | "r4 A4" + journal actor assertion in the PG apply test |
| R4-A3 — hand-written rollback file arms refused keys | P3 | the tool writes a `sha256` into the file and records it in system_log (`switch_rollback_file`, target = hash). Rollback refuses: hash mismatch or never recorded, keys outside the file's lots, refused keep groups, retired keys, `to` ≠ ON value, non-flag `from`. `--force` never bypasses this. | "r4 A3" |
| R4-A1 — the app role (database owner) can DROP a hardened ledger | P2 | `tools/pg/harden-audit-grants.sql` also hands the schema holding the ledgers to `sdp_audit_owner` and grants the app role `USAGE, CREATE` back. DBA steps documented in `docs/ops/EXPLOITATION.md`. **Applying it stays a human DBA / CAB step.** | `tests/audit-grants-rehearsal.test.js`: app role made database (and schema) owner, then after the script DROP / TRUNCATE / UPDATE / DELETE / RENAME refused on all 12 ledgers, own tables still creatable / droppable |

## Test run

`PG_ADMIN_URL=… NODE_OPTIONS="--require tools/test/blocking-stdio.js --require tests/_default-env.js --import file://tests/_pg-boot.mjs" node --test --test-force-exit --test-concurrency=4 <39 files>`
(sli*, sync*, *truncation*, backup*, db-backup*, db-restore*, activate-switches, switch-lots*, pg-pool*, pg-adapter,
ready*, health*, error-shape, kpi-unknown-sweep, http-error, audit-grants*, no-message-leak, restore-drill*, assets-sync*)
→ **237 tests, 237 pass, 0 fail, 0 skip**. `npx eslint .` clean. Artefacts regenerated: inventory (+ `--strict`),
evidence manifest, `tests/.suite-manifest.json` (5 files' counts updated, 1 new file; total 5651). The unknown-sweep
baseline was not touched.

## Human decisions left (not filled)

- Default acquire timeout (10 s proposed) and whether a statement timeout is wanted on user routes (SRE).
- Truncation shrink policy: operator confirmation only vs N consecutive runs required before confirming (SRE).
- Fail-closed on an unreadable anchor store blocks deletions until the table is readable (SRE accepts or not).
- Minimum backup key quality (16 non-space / 5 distinct proposed) and the plaintext override policy.
- Applying `harden-audit-grants.sql` in production (DBA / CAB); the residual "database owner can DROP DATABASE".
- Who may run `activate-switches --apply` and what a valid `--reason` is (change reference format).
