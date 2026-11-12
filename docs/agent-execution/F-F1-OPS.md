# F1-OPS — evidence (plan F, bundle F1-OPS: F-ARCH-05, F-ARCH-08, F-ARCH-07)

Branch `goal/f1-ops` (from `sdp-waves` @ `722818b`). Not pushed, not merged. No migration used (none assigned).
Files owned this wave: `tools/pg` restore drill, `tools/agent` inventory, `package.json` / lockfile / CI workflows.
`server.js`, `reports-db.js` and `public/reports.html` were not edited.

## Verdict

| Goal / audit action | Verdict | Proof |
|---|---|---|
| F-ARCH-05 — drill restores files, not only the DB (C13, N6) | **FIXED** (behind `restore_drill_full`, default `0`) | `tests/restore-drill-full.test.js` (6): PG end-to-end — blob copy hashed against the live store, tampered copy → exit 1, completed upload without its file → exit 1 |
| F-ARCH-05 — both keys exercised, values never printed | **FIXED** | same test: `SDP_BACKUP_KEY` opens the encrypted dump; `SDP_CONFIG_KEY` opens the encrypted `report_config` secret of the **restored** copy; wrong / missing config key → `config_key` FAILED; the secret, the key and the passphrase appear in none of report / log / result |
| F-ARCH-05 — duration against an RTO target, empty = UNKNOWN never "met" | **FIXED** | pure test over `''`, blanks, `null`, `'abc'`, `'0'`, `'-5'` → UNKNOWN; a target that cannot be met → exit 1. Report says "NOT PROVEN" when any step is UNKNOWN |
| F-ARCH-05 — monthly job unchanged by default | **FIXED** | default run: no `full` in the result, no "Full-service" section in the report, `system_log` details unchanged (pure + PG tests); `tests/restore-drill.test.js` still green |
| F-ARCH-08 — strict coverage signal (C14, N5: 35/1 vs 76/10 disagreement) | **FIXED** | `node tools/agent/inventory.js --strict [--check]` → `docs/agent-execution/INVENTORY-STRICT.md`; `tests/inventory-strict.test.js` (6): prefix ≠ reference, most-specific route wins, writes need the method named, page names, whole-word job names, `--check` matches the code |
| F-ARCH-08 — criticality class per route | **FIXED** | classes access / finance / export / audit / destructive (+ write / read) from method, path and guard names; pinned by the same test |
| F-ARCH-08 — seed tests for the N5 writes not in E-Q03 | **FIXED** (5 smokes) | `report-helpdesk-write`, `departments-routes`, `roadmap-writes` (2), `risk-register-alias-delete`, `meetings-lookups-writes` — each asserts the role gate, the cross-site/owner scope where it exists, and a read-back. Strict count: **103 → 57** routes without a strict reference (critical 24 → 15), 1 job (`engagement.schedule_reminders`-class item, see the generated file) |
| F-ARCH-07 lot 1 (nodemailer, playwright, codeql-action) | **FIXED** (prepared, merge = human) | see `DEPS-TRIAGE.md` § Execution |
| F-ARCH-07 lot 2 (artifact trio + setup-node; gh-release) | **FIXED** (prepared) | SHAs = peeled upstream tags; ci-config + release tests green |
| F-ARCH-07 major eslint 10 | **FIXED** (with eslint-plugin-security 4.2.1) | `npm run lint` 0 problems + negative control |
| F-ARCH-07 major pptxgenjs 4 | **FIXED** (structural proof only) | golden fingerprints unchanged, not regenerated; 140 PPTX-related tests green |
| F-ARCH-07 major dotenv 18 | **DEFERRED** | stderr banner at every `config()` (43 call sites incl. `server.js`) — see ledger |
| F-ARCH-07 major express 5 | **DEFERRED — blocker** | app does not load (inline-regex route) and **site scoping is silently dropped** (`req.query.site = codes` lost: `req.query` is a getter in 5) — see ledger |

## Test runs (PostgreSQL 16, throwaway databases, `drop-test-dbs` sweep after every run)

| Run | Tests | Pass | Fail | Skip |
|---|---:|---:|---:|---:|
| restore drill (full + base + admin card + readme-truth + flag-register + report-config + jobs registry …) | 101 | 100 | 1 | 0 |
| — the 1 failure: `connector-register` "engagement.schedule_reminders has no connector row" — fails identically on the base `fixinst` checkout (not this bundle; fixed at head per the coordinator) | | | | |
| restore-drill-full + restore-drill, twice | 11 ×2 | 11 ×2 | 0 | 0 |
| inventory-strict + 5 seed smokes + agent-inventory | 16 | 16 | 0 | 0 |
| nodemailer suites | 162 | 162¹ | 0 | 0 |
| playwright: browser tests + ci-config + deps + version | 20 | 20 | 0 | 0 |
| actions: ci-config + release workflow tests | 23 / 14 | all | 0 | 0 |
| eslint 10: deps / ci / version | 20 | 20 | 0 | 0 |
| pptxgenjs 4: pptx / deck / portfolio / exec ; tracker / inspection / meetings exports | 74 + 66 | all² | 0 | 0 |
| guards: flag-register, server-size-budget, authz-route-matrix, error-shape, ui-design-ratchet, agent-inventory, readme-truth, kpi-docs-links, await-precedence, inventory-strict, html-pages-before-static | 43 | 43 | 0 | 0 |

¹ `send-hygiene` hit "Connection terminated unexpectedly" once under parallel host load; 12/12 alone.
² `portfolio-deck` failed once in the group run, 4/4 alone and 74/74 on the group re-run.
A later combined run lost its database to a concurrent sweep (`database "sdp_tracker_test_…" does not exist`):
the sweep drops every `sdp_tracker_test_*`, including databases of tests still running in other processes.

## Changes

- `services/restoreDrill.js` — pure full-service steps (`backupKeyStep`, `configKeyStep`, `compareBlobs`,
  `compareUploadRefs`, `rtoStep`, `fullVerdict`, `renderFullSection`, `sampleEvenly`); report + log row carry them.
- `tools/pg/restore-drill.js` — `--full`, `--blob-backup` / `SDP_BLOB_BACKUP_DIR`, switch read from the live
  `report_config`; steps run while the restored copy exists; a failed step exits 1 and the target is still dropped.
- `services/reportConfig.js` — `restore_drill_full: '0'`, `restore_rto_minutes: ''`; PILOT-PROFILE rows; FLAG-REGISTER regenerated.
- `docs/DB_RECOVERY.md` — "Full-service drill" section.
- `tools/agent/inventory-strict.js` + `inventory.js --strict`; `docs/agent-execution/INVENTORY-STRICT.md` (generated);
  INVENTORY.* regenerated (counts only).
- `tests/_write-smoke-boot.js` (helper) + 5 seed smokes + `tests/inventory-strict.test.js` + `tests/restore-drill-full.test.js`;
  `tests/.suite-manifest.json` (+18 tests).
- `package.json` / lock: nodemailer 10.3.1, playwright 1.64.1, eslint 10.14.0, eslint-plugin-security 4.2.1, pptxgenjs 4.0.1.
- Workflows: codeql-action 4.39.1 (init + analyze), upload 7.0.2, download 8.0.2, setup-node 7.1.0, gh-release 3.0.3;
  runner-pin comments no longer name 1.56 as current.
- `docs/agent-execution/DEPS-TRIAGE.md` — § Execution.

## Deviations

- `tests/restore-drill.test.js`: the "target dropped" check now looks for **its own** target by name instead of
  any `sdp_drill_%` database — two drill tests on one cluster run concurrently, so the old check failed on a
  correct drill. Behaviour under test unchanged.
- eslint 10 needed a second package (eslint-plugin-security 4.2.1) the Dependabot branch did not carry.
- codeql-action: `analyze` moved with `init` (the Dependabot branch moved `init` only).
- nodemailer: lock pinned at the triaged 10.3.1 although the caret allowed 10.5.0.
- F-ARCH-08 smokes boot `server.js` on PostgreSQL through a small shared helper instead of five copies of the boot.
- The F-ARCH-08 job figure stays 1 (the strict job rule agrees with the base one); the panel's "10 jobs" came
  from an older head.

## Left for a person

1. **Operations owner**: the recovery-time / recovery-point targets (`restore_rto_minutes` stays empty = UNKNOWN),
   a backup copy of `data/blobs` (`SDP_BLOB_BACKUP_DIR`), escrow of `SDP_BACKUP_KEY` / `SDP_CONFIG_KEY`, arming
   `restore_drill_full` on TEST, and qualification of the packaged installer — none is asserted by the drill.
2. **Reviewers / CI**: every dependency commit is a proposal; a full CI run (incl. the 22 e2e journeys and a
   release dry run) is owed before merge. Rollback = revert the single commit, then `npm ci`.
3. **Reporting owner**: a visual check of the decks under pptxgenjs 4 (proof here is structural); decide whether
   to refresh the browser bundle `public/pptxgen.min.js` (still 3.12.0).
4. **Express 5 migration goal** (security owner + whoever owns `routes/meetings.js` / `routes/inspection.js` /
   `routes/reportStudio.js`): replace the two `req.query.site = …` writes, rewrite the inline-regex route, add a
   test that fails on Express 5 today, then bump.
5. **dotenv 18**: `quiet: true` at the 43 call sites (`server.js` is F1-SEC's this wave) or `DOTENV_QUIET=true`
   in the service environment, then bump.
6. **Test harness owner**: `tools/test/drop-test-dbs.js` drops databases of tests still running in other
   processes; sweeping only databases older than a few minutes (or owned by a finished PID) would stop the
   cross-bundle interference.
