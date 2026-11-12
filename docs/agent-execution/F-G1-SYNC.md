# F-G1-SYNC — evidence (R8 sync write fence + UAT-OI-07)

Branch `goal/g1-sync`, worktree `/home/user/w/g1-sync`, base `55dc67c`. Migration used: **`db/postgres/sync/086_lock_token.sql`**
(one idempotent `ALTER TABLE sync_locks ADD COLUMN IF NOT EXISTS token TEXT`; put in the `sync` area because
`sync_locks` is created by `sync/001` and the reports area runs first on a fresh database). `server.js`: only the two
manual sync trigger routes changed. No `report_config` switch (defect fix, ships ON — no FLAG-REGISTER change).

## Verdict table

| Goal / audit action | Verdict | Proof |
|---|---|---|
| R8 hole 1 — two runs both steal a stale lock (SELECT → DELETE → INSERT) | **FIXED** | `acquireLock` is one `INSERT … ON CONFLICT (job) DO UPDATE … WHERE locked_at <= now-ttl RETURNING token`; `tests/sync-write-fence.test.js` "hole 1 FIXED" (50 races, never both; fresh refused / stale stolen) |
| R8 hole 2 — a slow run releases the new holder's lock | **FIXED** | `releaseLock(job, token)` deletes `WHERE job AND token`; test "hole 2 FIXED" (B still holds after A exits) |
| R8 hole 3 — `apply()` gets no fence; a run that lost its lease keeps writing | **FIXED** | runner hands `fence {token, check, assert, transaction}` to `fetch`/`apply`, asserts it before `apply` and before the watermark; a lost lease ends the run `error`, `reason: 'lease_lost'`, never retried, no watermark; heartbeat renews a LIVE run's lease (min(ttl/4, 10 min)); `store.fencedTransaction` = `pg_advisory_xact_lock(hashtext(job))` + fence check in one transaction for DELETE+INSERT replaces. Tests "hole 3 FIXED" ×3 (log `A:delete,B:delete,B:insert`, table holds B only; heartbeat keeps a slow run; transaction refuses a lost lease) |
| R8 hole 4 — manual "sync now" bypasses the runner lock | **FIXED** (visible change, CHANGELOG) | `POST /api/sync/trigger/assets` and `/:job` → `services/sync/manualTrigger.js` → `runner.start()` under the scheduled job's lock name (`assets.sync`, `zoho.requests|change_cab|survey`); **409** `{ok:false, status:'skipped', reason:'overlap', error:"A '<job>' sync is already running …"}` when held; `?force=true` kept; manual runs now recorded in `sync_runs`. Tests "hole 4 FIXED" (source pin + live 409 with the cron entry holding the lease, manual fn never called, free lease → started + force passed) |
| Memory store parity | **FIXED** | `tests/sync-runner.test.js` +3 (lease contract, `start()`, lost lease not retried) |
| UAT-OI-07 — server calls Zoho during browser journeys | **FIXED** | `tests/e2e/fixtures/outboundGuard.js` (test-only) refuses + records every non-loopback connection at `net.Socket.prototype.connect` (http/https/axios/fetch/tls/net) and drops proxy variables; harness boots with EMPTY Zoho credentials, writes `external.server_unexpected` in the artefact and fails the journey on any attempt; `run-e2e.js` counts it. `tests/e2e-outbound-guard.test.js` (5) |

## Fail before / pass after

- `tests/sync-write-fence.test.js` on the pre-fix `services/sync/*` + `server.js` (new test file, old code): **2 pass / 8 fail**
  (the two pre-existing guarantees pass; all eight hole tests fail). After: **10/10**, three consecutive runs.
  Note: on the old code the 50-race test fails at least on the token assertion; the race itself was reproduced
  deterministically by R1-DEMO's scripted characterisation (now removed with the defect).
- `tests/e2e-outbound-guard.test.js`, real token-refresh route: with the OLD harness setup (dummy pair
  `unused-in-e2e`) the server opens a connection to `accounts.zoho.com` (refused and recorded by the guard); with the
  new setup: **0** attempts.
- Finding while testing: the sandbox sets `HTTPS_PROXY=http://127.0.0.1:…`; axios honours it, so the old dummy-credential
  call LEFT through a loopback (allowed) connection. The guard now removes the proxy variables in the journey process.

## Tests run (PostgreSQL 16 local, throwaway databases)

| Files | Result |
|---|---|
| `sync-*` (write-fence, runner, routes.smoke, schedule, drift, jobs-registry, skip-semantics), `jobs-*`, `assets-sync-status.smoke`, `e2e-harness`, `e2e-outbound-guard`, `error-shape`, `server-size-budget`, `await-precedence`, `pg-migrate`, `pg-migrate-from-111`, `flag-register`, `authz-route-matrix`, `readme-truth`, `ui-design-ratchet` | **128 pass / 0 fail / 0 skipped** |
| Journeys (sample, not the full e2e suite): `t1-site-action`, `u2-executive-review`, `u5-scorecard-viewer`, `uat-s5-executive` | 4 pass, `server_unexpected_count = 0` each |

Ratchets: error-shape 444 → **443** (the manual-trigger 400 now goes through `httpError.fail`), server.js budget
6996 → **6977**. `tests/.suite-manifest.json`: sync-write-fence 6→10, sync-runner 15→18, +e2e-outbound-guard 5 → total 4857.
`npx eslint` clean on every touched JS file. FLAG-REGISTER regenerated: no change (no switch).

## Deviations

- Lease token is a random UUID compared by equality, not a monotonically increasing sequence (the R1-DEMO prompt's
  suggestion): equality is what the fence needs and it avoids a sequence object; documented in the migration.
- Legacy jobs (`legacyJob` wrappers — every scheduled job today) write inside their own functions (zoho-sync,
  assets-sync…), which this bundle does not own: they are fenced by the CAS lock, the token release, the heartbeat
  (a live slow run is never taken over) and the check before the watermark/run record; they receive `ctx.fence` but do
  not yet call `fence.assert()` / `fence.transaction()` between their own write batches. A run FROZEN past its lease
  (suspended VM) could still finish one in-flight write of a legacy job. Native jobs get the full fence.
- Manual runs are 1 attempt (the admin sees the result and can click again); the scheduled run keeps its retries.
- UAT-OI-07 asked for an env variable read by the token refresh: that code is in `server.js` outside the two routes
  this bundle may touch, so the same effect is obtained with empty credentials (the refresh stops before any call) and
  the socket-level guard. The route smoke tests (which boot `server.js` with dummy Zoho credentials) do not install
  the guard — they never start the listen-time token refresh, and no change was needed.
- `tools/test/drop-test-dbs.js` drops every test database on the machine (also other bundles'); run once at the end
  as instructed.

## Left for a person

- Release note: the "sync now" buttons can now answer **409 "already running"** (CHANGELOG entry written); tell the admins.
- Decide whether to wire `fence.transaction()` into the big replace writers (assets-sync, zoho-sync reconcile) — owner of those files.
- Run the full e2e suite (`npm run test:e2e -- --runs=2`) when no other bundle is running, and check every artefact has
  `server_unexpected_count: 0`.
- Nothing here proves production behaviour, a field result or an approval.
