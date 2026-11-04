# A-03 — stop the running app before replacing files; upgrade from 1.11 under pm2 in Windows CI

Status: code + CI job written on branch `goal/a-03`. **The Windows job has not run yet** (no Windows runner
in the authoring sandbox; nothing is pushed). Nothing here claims the upgrade works on a real server.

## What changed
- `tools/installer-v2/post-install.js`: the update/repair/new flow is `runUpdate(deps)` (steps injected; `main()`
  wires the real ones). New step `stopCurrentHost` = `stopRunningHost()`: after the A-01/A-04 preflight and the
  `.env` plan write, immediately before the dependency swap, it stops a running pm2 process `endeavour-dashboard`
  and/or a running `SDPDashboard` service, then waits (≤ 30 s) until the port no longer answers — otherwise it
  refuses ("no file was replaced"). A failure before any file change starts exactly what was stopped
  (`startHosts`); a failure after files changed keeps the previous behaviour (rollback, then
  `registerService(previousServiceKind)`), and first stops the new process. `swapNodeModules` puts the old
  `node_modules` back if the second rename fails. `setup-last.json` records `stopped`.
- Test seam `SDP_SETUP_TEST_FAIL_PROBE=1` (environment only, logged as `TEST SEAM`) fails the health probe.
- `tools/pg/check-secrets.js --verify` (from A-03a) is the CI decrypt check: exit 0 / exit 2 + key names.
- `tools/installer-v2/tests/e2e.ps1 -UpgradeFrom <1.11 tree>` and job `upgrade-from-111` in
  `.github/workflows/installer.yml` (checks out `claude/confident-pascal-03veex` into `v111`, `npm i -g pm2`).

No switch: the stop is unconditional on update/repair when a `.env` exists (it only stops what is running).

## CI runs (fill in after the push)
| run id | commit | conclusion | cause / fix |
|---|---|---|---|
| — | — | not run yet | — |

Expected first-run suspects (from the goal review): `db/migrate.js` on a schema created by 1.11 `initPg*`;
pm2 not on PATH / other PM2_HOME for the elevated Setup; the 1.11 `/health` route answering 401 (Wait-Up
accepts any answer below 500); `ZOHO_*` dummies needed by the 1.11 `REQUIRED_ENV`.

## Left for a person
- Push, read the `e2e-logs-upgrade-from-111` artifact of the first run (setup log, pm2 summary, backup name),
  fix real defects in the product, and record each run above.
- Confirm on the server which secrets layout production stores (`node tools\pg\check-secrets.js --verify`).
