# P11 fix 15 — round-4 PPM findings R4-1 … R4-4

**AI engineering evidence — not an independent human review, not an approval.** Source: `/home/user/qual/out/r4-ppm.md`
(round 4 at `e43d11d5`). Branch `fix/p11-r4-ppm`. Levelling performance (R1-F4) and the other carried items are out of scope.

## R4-1 (P2) — money recorded as ACTUAL budget periods erased by a hard delete / the purge — FIXED
- Cause: `services/governanceStore.js` `actualsUnder()` counted `ppm_time_entries` only, while `evmStore.hiddenProjectsWithActuals`
  and `evm.js` treat `ppm_budget_periods kind='actual'` as spent money (AC prefers them); the FK cascades the periods away.
- Fix (same pattern as R2-1 / R3-2 for logged hours — refusal, no new switch): new `actualPeriodsUnder(kind, id)` (project,
  objective, programme) and `spentUnder()` (time entries + actual periods, readable phrase). `removePortfolio` hard path →
  **409 HAS_ACTUALS** naming both kinds; `purgeDeletedPortfolio` keeps such a node soft-deleted and lists it in `skipped`
  (`code: 'HAS_ACTUALS'`, reason "has N actual budget period(s) (money already spent) — kept soft-deleted"). The task move
  guard (R3-2) is unchanged (budget periods are project-level). Planned / baseline periods do not block a delete.
- `tests/soft-delete-readers.test.js` allowlist: `actualPeriodsUnder` (counts what a hard delete would cascade, deleted rows on purpose).

## R4-2 (P3) — intake value state contradicts its field after a switch-off write — FIXED
- Contract (migration 117): "a state is only stored while the field value is NULL". With `ppm_intake_register_enabled` off
  the intake columns are ignored on writes (lot rollback), so a value written then leaves the stale state stored.
- Fix: `services/ppm/intakeFields.js` `readIntake()` ignores a state whose field is non-blank (a measured 0 counts as a
  value); `dependencies` / `risks` (list fields, not columns) keep their `none_known`. The column is cleaned by the next
  intake write as before (`normaliseIntake`, unchanged). No write while the switch is off (keeps "ignored on writes").

## R4-3 (P3) — 1 s wall-clock assertion flakes under load — FIXED
- `tests/ppm-schedule-engine.test.js` "benchmark: 10 000 tasks fully rescheduled in under 1 s": the 1 s budget is now CPU
  time of the process (`process.cpuUsage`, user + system) — the engine is synchronous, so that is the work it did; the
  budget itself is unchanged. A 10 s wall-clock bound still catches a hang, and the test now also checks every task got
  dates.

## R4-4 (P3) — soft-deleted task's hours counted but not listable — FIXED
- Consistent with R3-4 (hours stay counted, flagged): `GET /api/governance/ppm/task/:id/time` now answers for a
  soft-deleted task whose project is live — read-only, `task_deleted: true`, entries + hours (a live task answers
  `task_deleted: false`). POST / DELETE keep 404 on a deleted task; a deleted project still hides its tasks' hours (404).
  New store reader `deletedTaskRow(id)` (deleted rows only, project checked live; allowlisted in soft-delete-readers).
- No new route, no guard change: authz matrix rows unchanged.

## Tests — failing before, passing after
- New `tests/ppm-r4-actuals-intake.smoke.test.js` (4, over HTTP): R4-1 hard delete project / objective / programme → 409,
  period intact, portfolio AC unchanged, planned-only project still deletes; R4-1 purge skips (`HAS_ACTUALS`), the empty
  project is purged, AC unchanged; R4-2 switch-off write → read shows `{delivery_lead:'tbc'}` only; R4-4 listing flagged,
  equals `deleted_task_hours`, POST 404, deleted project 404. With the three product files stashed: **0/4 pass**; after: 4/4.
- `tests/ppm-intake-pure.test.js` +1 (readIntake drops a state next to a value, zero counts, `none_known` kept).
- Targeted run (`ppm-*`, `governance*`, `soft-delete-*`, `kpi-unknown-sweep*`, `error-shape*`, `authz-*`, PostgreSQL):
  **452 tests, 452 pass, 0 fail, 0 skipped**. Re-run after the container restart: 53/53 on the touched files.
- `npx eslint` on touched files: clean. Inventory regenerated, `inventory-strict --strict` exit 0; `tests/.suite-manifest.json`
  +5 (ppm-intake-pure 8→9, new file 4).

## Human decisions left (not taken here)
- Finance (G14): whether a project carrying ACTUAL budget periods may ever be removed (today: refused hard delete,
  kept by the purge — restore or cancel the work instead).
- Policy Center classification of money-impacting PPM switches (C8 note) — PROPOSED, committee decision.
