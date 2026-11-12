# F-R1-DEMO — evidence (plan F amendment §6, REBUILD-SPEC R6 / R5 gap list / R8)

Branch `goal/r1-demo`, worktree `/home/user/w/r1-demo`, base `37e93f8`. Built natively from the written spec
(no review.1 artifact). **Migration 079 was NOT used** (nothing needed a schema change: the demo inventory is a file,
the fence findings are tests). No `report_config` switch added; `server.js`, `reports-db.js`, `public/reports.html`,
`services/sync/*`, `services/projectSchedule.js`, `public/lib/ppmVisuals.js`, `routes/governancePpm.js` untouched.

## Verdict table

| Goal / action | Verdict | Proof |
|---|---|---|
| R6 — `tools/demo/seed-demo.js`: synthetic two-site organisation (5 roles, project, 3 tasks, dependency, milestone, risk, change request*, effort hours + actuals in USD and XOF, benefit with baseline/target and NO realised value, published dashboard) | **FIXED** | `tests/demo-seed.test.js` (3/3): seed contents, measured 0 ≠ unknown null, two currencies, ledger written, no password in the inventory |
| R6 — target guard (live `current_database()`/`current_schema()`; production names refused even with the flag; unknown names need `--i-know-this-is-a-test-db`; non-empty portfolio refused) | **FIXED** | `tests/demo-seed.test.js` cases 1–2; CLI run on a throwaway db: 2nd seed refused "already holds 1 portfolio project"; `PG_URL=…/postgres` refused "looks like production" |
| R6 — `--remove` deletes exactly the recorded inventory (other target refused, non-`DEMO` rows skipped, idempotent) | **FIXED** | `tests/demo-seed.test.js` case 3 (tampered inventory naming a real site → skipped, survives; residue 0; second removal no-op); CLI: `removed {dashboards:1,rfis:1,projects:1,objectives:1,programmes:1,users:5,sites:2} · residue 0` |
| R6 — e2e journey Home → portfolio → project → workbook export → audit trail; site B editor denied with `portfolio_site_scope_reads='1'`; export figures = screen figures, zero vs unknown preserved | **FIXED** | `tests/e2e/demo-journey.spec.js` (runnable alone), green 5 of 6 runs; the one red run coincided with concurrent `drop-test-dbs` sweeps from parallel bundles (see notes) |
| R6 — `docs/ops/DEMO-SCENARIO.md` (commands, data, removal, what it does NOT prove) | **FIXED** | file; journey mapped in `docs/ops/PERSONA-JOURNEYS.md` |
| R5 — workbench gap list with ready `/goal` prompts | **FIXED** (list only — nothing implemented, F1-PPM owns the files) | `docs/audits/2026-11-12-enterprise-review/WORKBENCH-GAPS.md`: 6 PRESENT · 5 PARTIAL · 1 MISSING (change requests), 6 goal prompts R2-WB-01…06 |
| R8 — does head guarantee two runs of one sync never interleave writes? | **PARTIAL** — yes for the normal case, **no** for four paths | `tests/sync-write-fence.test.js` (6/6): 2 guarantees pinned + 4 defects pinned as characterisations (invert when fenced) |

\* the change request is a governance RFI stand-in: there is no native change-request entity (WORKBENCH-GAPS item 7).

## R8 — what head guarantees and what it does not

Guaranteed (pinned, `tests/sync-write-fence.test.js` tests 1–2): a second `getRunner().run()` of the same job
while the first holds a FRESH lock returns `{status:'skipped', reason:'overlap'}` and writes nothing — also across
two processes / owners, because `sync_locks.job` is a PRIMARY KEY (`services/sync/syncStore.js` acquireLock).

Not guaranteed (each reproduced, pinned as today's behaviour with the fenced assertion in a comment):

| Hole | Path | Reproduced |
|---|---|---|
| 1 | stale-lock steal is SELECT → DELETE → INSERT in three statements: two runs that both see a stale lock both acquire it | A=true B=true |
| 2 | `releaseLock(job)` deletes by job, not by owner/token: a slow run whose lock was stolen deletes the new holder's lock on exit, letting a third run in | lock row gone after A exits |
| 3 | `apply()` receives no lease/fence: a run whose lease expired (`lockTtlMs`, default 2 h) keeps writing after another run took over → interleaved DELETE+INSERT, table ends with both runs' rows | log `A:delete,B:delete,B:insert,A:insert` |
| 4 | the manual triggers `POST /api/sync/trigger/assets` and `/api/sync/trigger/:job` call `syncAllAssets` / `syncRequestData` directly, outside the runner lock: a manual and a cron run of the same job can write at the same time | source pin on `server.js` |

Practical exposure: hole 4 is the likely one (an admin clicks "sync now" during the hourly cron or the 04:30
assets replace); holes 1–3 need a crashed run or a run longer than 2 h.

### /goal — SDP360 / R8 sync write fence (for F1-SYNC; hole 4 also needs the server.js owner)
Make every write of a sync job happen under a fenced lease. In `services/sync/syncStore.js`: `acquireLock` becomes
ONE statement that returns a monotonically increasing token, e.g.
`INSERT INTO sync_locks (job, locked_at, owner, token) VALUES (?, ?, ?, nextval('sync_lock_token')) ON CONFLICT (job)
DO UPDATE SET locked_at=excluded.locked_at, owner=excluded.owner, token=excluded.token WHERE sync_locks.locked_at <
? RETURNING token` (no row = not acquired); `releaseLock(job, token)` deletes only `WHERE job=? AND token=?`; add
`checkFence(job, token)` (`SELECT 1 … WHERE job=? AND token=?`). Schema: `ALTER TABLE sync_locks ADD COLUMN IF NOT
EXISTS token BIGINT` + a sequence, in a new `db/postgres/sync/00N_lock_token.sql` (sync area, idempotent). In
`services/sync/syncRunner.js`: pass `fence = { token, check: () => store.checkFence(job.name, token) }` to `apply()`,
re-check the fence before `setWatermark`/`finishRun`, and a store write helper for full replaces that runs the
DELETE+INSERT inside one transaction that first takes `pg_advisory_xact_lock(hashtext(job))` and verifies the fence
(a lost lease → throw `LEASE_LOST`, the run ends `error`, nothing written). Memory store: same contract. Hole 4
(server.js owner, F1-SEC this wave): route `POST /api/sync/trigger/:job` and `/assets` through
`getRunner().run(<the same buildJobs entry>)` (answer 202 + `skipped` when the scheduled run holds the lease), keeping
`?force=true`. No switch is needed for holes 1–3 (defect fix ships ON); hole 4 changes a visible behaviour (a manual
run can now be refused) — ship ON, say so in the release note. Tests: in `tests/sync-write-fence.test.js` invert the
four DEFECT tests (the fenced assertion is already written in each comment) and keep tests 1–2; add a pg test that
two runners racing a stale lock 50 times never both acquire; `sync-runner.test.js` memory-store parity.

## Commits

1. `9a64336` R6 — seed/remove tool, demo-seed test, e2e demo journey, DEMO-SCENARIO, harness accepts a per-journey seed.
2. `919b0a5` R5 — WORKBENCH-GAPS.md.
3. (this commit) R8 — sync-write-fence test + this evidence.

## Tests run (PostgreSQL 16 local, throwaway databases, swept with `tools/test/drop-test-dbs.js` after each run)

| Files | Result |
|---|---|
| `tests/demo-seed.test.js` | 3 pass |
| `tests/sync-write-fence.test.js` + `sync-runner`, `sync-routes.smoke`, `sync-schedule` | 28 pass (3 consecutive runs) |
| `tests/e2e/demo-journey.spec.js` | pass ×5, 1 red (see notes) |
| `tests/e2e/c4-pmo-demand-project-benefit.spec.js`, `deny-cross-site.spec.js` (harness change neighbours) | 2 pass |
| `e2e-harness`, `await-precedence`, `flag-register`, `server-size-budget`, `error-shape`, `ui-design-ratchet`, `readme-truth` | pass |
| `evidence-baseline` | 1 FAIL, **pre-existing on base**: `u6-shared-analytics-url.spec.js not mapped to a persona` (W2-UX journey missing from PERSONA-JOURNEYS.md); the demo journey IS mapped |

`npx eslint` clean on every touched JS file. `tests/.suite-manifest.json`: +`demo-seed.test.js` (3),
+`sync-write-fence.test.js` (6) → total 4550.

## Deviations

- No migration 079: the inventory lives in a JSON file next to the operator (no secret in it); a table would have put
  demo bookkeeping into the product schema.
- R8 holes are pinned as passing characterisations, not failing / `todo` tests: `tools/test/guard.js` counts a
  `todo` failure as `failed` in the census, which would have made the suite summary misleading. The fenced
  assertion is written next to each pin.
- The e2e harness (`tests/e2e/fixtures/harness.js`) gained one optional `opts.seed` so the demo journey runs through
  `runJourney` (required by `e2e-harness.test.js`) with its own seed instead of the shared E2E world (whose projects
  would make the demo's empty-portfolio guard refuse).
- Generated registers (FLAG-REGISTER, INVENTORY…) not regenerated: no switch, route or metric was added.

## Notes

- `tools/test/drop-test-dbs.js` drops EVERY `sdp_tracker_test_*` database, including those of bundles running in
  parallel on this machine; the one red demo-journey run happened while such sweeps were running. Run it only when no
  other test process is alive, or scope it per run (suggestion for the QA owner).
- The demo journey logs pre-existing `Cannot find module './generate-site-monthly-pptx.js'` / `executive-new-report.js`
  at boot (legacy local-only files, not in the repo) — unrelated.

## Left for a person

- Run the demo on a real throwaway database and walk it in a browser with the printed accounts (DEMO-SCENARIO).
- Decide whether the demo's change-request stand-in is acceptable until R2-WB-01 lands.
- Schedule the R8 fence goal with F1-SYNC and the hole-4 part with the `server.js` owner.
- Map `tests/e2e/u6-shared-analytics-url.spec.js` in `docs/ops/PERSONA-JOURNEYS.md` (W2-UX follow-up).
- Nothing here proves a field result, a realised benefit, an approval or production readiness.
