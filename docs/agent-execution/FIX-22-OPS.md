# P11 round 5 — fix lot fix/p11-r5-ops (operations / SRE)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed. Base `0e97838e`. Findings from `/home/user/qual/out/r5-operations.md` (repros in
`/tmp/claude-0/p11ops-r5/`). Each new test was run and seen FAILING before its fix, passing after (the file-store
tests could not exist before: the archive module is new). Nothing was pushed, merged or deployed; no live system was
touched. Out of scope here (other lots): Policy Center four-eyes guard on HTTP routes, approver provenance, session
revocation, authz probe (fix 21).

| Finding | Sev | Cause | Fix | Regression test |
|---|---|---|---|---|
| N-14 nothing backs up the file store; B4 "PASS" proves the database only | P1 | `services/backup.js` dumped PostgreSQL only; inspection photos / signatures, field uploads and project documents (`services/blobStore.js`, `<DATA_DIR>/blobs`) had no copy; the drill compared tables only | new `services/blobBackup.js`: every backup run (`db.backup` job, `sdp-manager backup`, pre-update / pre-restore backups, `restore-drill --backup-first`) also writes `sdp_blobs_<same stamp>.blobs.enc` — streamed archive, one AES-256-GCM record per file (same `SDP_BACKUP_KEY` rules: refused without a key unless `SDP_BACKUP_ALLOW_PLAINTEXT=1` → `.blobs`), manifest record with count + size + SHA-256, read back and verified before the run succeeds, a failing archive quarantined as `.rejected` (never managed), same retention count, off-site copy with the dump. **Every** restore drill (not only `--full`) now reads the run's archive back, checks it against its manifest and against the live store: a live file missing or different, an unreadable archive, or files on disk with no archive → FAIL (exit 1, report section "File store", `system_log` `restore_drill` row `ok:false`). In `--full` mode the verified archive is the backup copy for the blobs / field-upload steps. New `tools/pg/restore-blobs.js --verify / --restore --target <empty dir>` restores files and re-verifies them from disk (never over the live store). Runbook B2 / B4 / D1 and the automatic-jobs note updated; G05 dossier cites the new test | `tests/blob-backup.test.js` (7 — round trip, wrong key / tamper / truncation, restore + path escape + CLI, runBackup integration + retention + off-site + key rules, quarantine, drill step, PG drill pass then FAIL on a missing file and on a missing archive); `tests/restore-drill-full.test.js` updated (the run's archive now proves the files) |
| N-12 a DB stall logs users out | P2 | the global `/api/` gate turned a typed `DB_BUSY` from `validateSession` into "no user" → 401; `requireReportSession` → 500; `services/businessGuard.js` swallowed it too; `public/auth.js` logs out on the 401 | the three layers answer `DB_BUSY` through `httpError.fail` → **503 `database_busy` + `Retry-After: 5`**; any other error keeps its previous answer. `public/auth.js` returns on 503 without touching the session (it only logs out on 401) | `tests/auth-db-busy.smoke.test.js` (4) — REAL reports pool shrunk to ONE client held by `pg_sleep`, acquire bound 400 ms: `/api/ping` and `/api/reports/auth/me` answer 503 + Retry-After, the same session works after the stall |
| N-13 rollback scripts leave a half-rolled-back schema | P2 | 38 of 39 `db/postgres_rollback/*.sql` ran as separate statements; with `psql -f`, rollback 125 dropped the gate CHECK, failed to re-add it, then dropped `created_by` / `updated_by` | every rollback script is ONE transaction (`BEGIN; … COMMIT;`, 120 already was): psql turns the COMMIT of an aborted transaction into ROLLBACK, so a failing rollback changes nothing, with or without `ON_ERROR_STOP` | `tests/rollback-scripts-transactional.test.js` (2 — static: BEGIN first / COMMIT last / no nested control for all 39; PG + real `psql -f`: rollback 125 with an extended-stage checklist fails and the CHECK, the columns and the migration journal are unchanged; after removing the checklist it rolls back fully); `tests/ppm-rollback-scripts.test.js` still green |
| N-15 `activate-switches --apply` writes four-eyes switches with one operator | P2 | no `policyCatalogue.needsSecondPerson` check on the CLI path | steps whose change needs a second super_admin (same rule as the Policy Center) are tagged `4EYES` in the plan. `--apply` refuses them, writing NOTHING, unless `--second-operator=NAME` names a different person (look-alike spellings fold via `skeletonKey`); both names land on every journal row of those keys, in the `switch_rollback_file` event and inside the signed rollback file (`second_operator` joins the hash only when present, so older files keep their signature). With `policy_center_enabled = '1'` the tool writes no four-eyes key: it files one Policy Center request per key (requester = the `--operator` account, which must be an active super_admin) and writes the rest of the lot. A rollback that moves a four-eyes key back to its weaker side needs `--second-operator` too. Lots without four-eyes steps (L01, L02, L13 minus outbound…) behave as before. PLAN-PILOTE (L03, L08, L11, L12, L14 commands + a second-operator role row) and RUNBOOK §5 updated; `business-readiness-check` now refuses a real `--apply` of a four-eyes lot without `--second-operator=` | `tests/activate-switches.test.js` (+3: detection / plan tag / same-person refusal; PG L12 refused with nothing written, then applied with both names recorded, rollback refused then accepted; PG Policy Center on → 4 requests filed, four-eyes keys unwritten, the rest written); `tests/business-readiness.test.js` (+1) |
| F-07 write class OVER because of designed 400s | P2 carried | `field.envelope` without `LOAD_FIELD_ACTION_ID` is a rejected test envelope (400 by design) and counted as a write error | `tools/test/load.js`: designed 4xx (`DESIGNED_4XX`, today `field.envelope`→400) leave the budget CLASS latency and error rate and are counted apart (`designed_4xx_excluded`); per-step / per-route / overall figures still show them; any other 4xx or 5xx still counts; a class made only of designed answers is `no_sample`, never "within" | `tests/perf-budget-check.test.js` (+1) |
| F-07b positional load file ignored in blocking mode | P3 carried | only `--load=` was read | a bare path is the load file; blocking mode with nothing to check exits 1 (warn mode stays 0) | `tests/perf-budget-check.test.js` (+1) |

## Tests run (AI evidence)

Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres SDP_TEST_RUN_ID=fix22`, `NODE_OPTIONS="--require
tools/test/blocking-stdio.js --require tests/_default-env.js --import tests/_pg-boot.mjs"`.

New and touched files, then the requested neighbours (backup*, db-restore, restore-drill*, activate-switches,
switch-lots-rollback, ppm-rollback-scripts, pg-finance/096 rollbacks, pg-migrate*, pg-pool*, http-error, error-shape,
auth*/authz*, session*, perf-budget*, load-harness, business-readiness, readme-truth, agent-inventory, inventory-*,
gate-dossiers, policy-center*, route-authz smoke, sync-jobs-registry, server-size) — 48 files, one run with
`--test-concurrency=4`: **236 tests, 234 pass, 2 fail, 0 skipped**; the 2 failures were `gate-dossiers.test.js`
(the dossiers had been regenerated before `tests/.suite-manifest.json` was updated). Dossiers regenerated again →
`gate-dossiers.test.js` 6/6 pass. Every other file in the run green.

Regenerated: `docs/agent-execution/INVENTORY.{json,md}`, `INVENTORY-STRICT.md` (`--check` and `--strict --check`
green), gate dossiers (`--sha=174fa307`, only G05, G19 (cites the suite manifest), INDEX + manifest changed, `--check` fresh),
`docs/business-readiness/CHECKLIST-GO-LIVE.md` / register (`--check`: 6 documents OK), `tests/.suite-manifest.json`
(+19 tests, 3 new files), `docs/agent-execution/EVIDENCE-MANIFEST.md`. `npx eslint .` clean.

## Left to humans (nothing here is decided)

- **File store**: backup target and retention (default = same count as the dumps), whether the archive goes off-site
  (`backup_offsite_path`, HD-O05), RPO/RTO (G05), and running B4 on the TEST server. Disk: each nightly archive is a
  full copy of `data/blobs` (no deduplication) — the SRE sizes `SDP_BACKUP_KEEP` against the store size.
- **Four-eyes on the CLI**: who is the second operator for each lot (role row added empty in PLAN-PILOTE), and whether
  the Policy Center is used for CLI activations.
- **DB stall**: `PG_POOL_ACQUIRE_TIMEOUT_MS` and a statement timeout on user routes (clients already holding a
  connection still wait for the whole lock; N-12 residual, P3).
- Perf budgets stay `PROPOSED`, `approved_by: null` (E-B05).
- Not addressed: `*.rejected` dumps / archives are never pruned (P3), project-document blob folders after a hard
  project delete (P3), pilot-metrics actor filter (P3), N-04/N-05/F-06/F-08/F-09/F-10 (P3).
