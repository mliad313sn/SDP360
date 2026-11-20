# P11 fix13 — operations seat, round 3 findings (N-06, N-07, N-08) + carried F-04, F-05

AI fix work, not an independent review. Branch `qual/p11-fix13` (worktree `/home/user/w/p11-fix13`), not pushed or merged.
Findings: `/home/user/qual/out/r3-operations.md` (N-06/N-07/N-08), `operations.md` + `r2-operations.md` (F-04, F-05).
Every fix has a test that fails on the old code and passes on the new one.

| Finding | Cause | Fix | Test |
|---|---|---|---|
| **N-06 (P2)** `/ready` drains the pool under a table lock | readiness queries had no timeout; every anonymous call held a pooled connection while waiting on the lock | `routes/health.js`: the DB work runs in one transaction with `SET LOCAL statement_timeout` + `lock_timeout` (`SDP_READY_STATEMENT_TIMEOUT_MS`, default 1000); one probe in flight shared by every concurrent caller; hard timer (timeout + 1 s, covers waiting for a pool connection) → 503 `{ok:false, db:false, error:'timeout'}`; a non-200 answer reused for `SDP_READY_FAIL_CACHE_MS` (default 2000); a 200 is never cached (`last_job_at` must move). Public 200 shape unchanged. | `tests/ready-timeout.test.js`: real PG, `ACCESS EXCLUSIVE` on `sync_metadata` held, 12 parallel `/ready` → all 503 `timeout` in < 4 s, ≤ 1 DB probe, a `SELECT 1` on the shared pool still answers; 5 healthy concurrent callers → 1 probe. Old code: no answer in 5 s, 5 probes. |
| **N-08 (P2)** freshness SLI reads 100 % while a declared job is dead | `gather` built the job list from ok rows only | `services/sliReadings.js`: every job in the freshness map is listed. No ok run + errors in the window → `fresh_pct 0` (`failing`); no ok run, no error, optional job → `not_configured`, outside the worst-job reading; no ok run otherwise → `null` (`never_ok`). Worst job = min of measured values, `null` when an unknown job could be worse (unless a measured job is already 0); basis names the never-ok jobs. | `tests/sli-readings.test.js` (+2): failing job → value 0; silent job → value null; optional skip-only job does not mask a fresh value. |
| **N-07 (P3)** operator-named dump treated as newest | `isDumpName` = prefix + extension; name sort put `sdp_dashboard_before-upgrade.sql` after every stamp | `services/backup.js` `isDumpName`: exact generator pattern `sdp_dashboard_<yyyymmdd>T<hhmmss>Z.sql[.gz[.enc]]`; with a fixed-width stamp name order is time order. Other files are never read, pruned or drilled (`latestDump`, `prune`, `dbRestore.listBackups` all go through it). | `tests/backup-encrypt.test.js` (+1): manual files survive `prune(keep:1)`, `latestDump` returns the real newest. |
| **F-04 (P2)** anonymous `/health` disclosed Zoho OAuth state | `server.js` handler returned token validity, scope, raw refresh error body, org/workspace ids, survey view id | `/health` moved to `routes/health.js`: `{status:'ok'|'degraded', uptime}`, always 200 while the process is up (`degraded` = last refresh failed and no valid token). The detail moved to admin-tier `/api/health/deps` → `zoho_detail` (never the token). Installer e2e only checks `/health` status < 500; sdp-manager uses `/ready` — both unaffected. | `tests/health-public.test.js` (3): key set = `{status, uptime}`, no leak strings, degraded state, admin detail present, viewer 403. |
| **F-05 (P2)** backups fell back to plaintext without a key | `runBackup` only logged a warning | `services/backup.js`: no / short `SDP_BACKUP_KEY` → **refused before `pg_dump` runs** (nothing written), non-transient error `code BACKUP_KEY_MISSING`, logged as `[backup] ERROR`, recorded as a failed `db.backup` run (sync alerting raises it). Explicit override `SDP_BACKUP_ALLOW_PLAINTEXT=1` (exact value) keeps the old plaintext gzip with a loud warning each run; result carries `plaintext_override`. Documented in `docs/ops/EXPLOITATION.md` and `docs/DB_RECOVERY.md`. | `tests/backup-encrypt.test.js` (rewritten case): refusal, nothing dumped, short key refused, `yes` is not an override, override → plaintext + one warning. Existing plaintext-path tests now set the override. |

## Operational effect to know before deploy (F-05)

An install with no `SDP_BACKUP_KEY` in `.env` stops producing backups and the `db.backup` job turns red, as do
`sdp-manager backup / update / restore` (their pre-backup refuses). The installer's `repairEnv` already adds
`SDP_BACKUP_KEY` to a `.env` that lacks it, so installed instances should be unaffected; check with
`findstr SDP_BACKUP_KEY .env` before applying. Emergency escape: `SDP_BACKUP_ALLOW_PLAINTEXT=1`, then remove it.
Whether plaintext backups should ever be allowed is a human policy decision (r3 §5) — this change only makes the
choice explicit; it does not fill that gate.

## Not touched

`services/sync/truncationGuard.js` (N-02r, another agent). F-07, F-07b, F-08/F-09/F-10, N-04, N-05 — out of scope.
