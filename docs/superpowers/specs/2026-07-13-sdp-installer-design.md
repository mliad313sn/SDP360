# SDP Dashboard Installer — Design

> Approved by Azize on 2026-07-13 (brainstorming session). Model: the 4MyPeople
> installer (Setup.bat + Install-4MyPeople.ps1 + Manage-4MyPeople.ps1 +
> config.psd1), whose scripts were studied locally. Reuses the project's proven
> pieces: `_sdp_admin.cmd`, `tools/deploy/make-deploy-zip.ps1`,
> `tools/pg/provision-prod.js`, `tools/pg/dump-db.js`, idempotent PG schemas
> applied at boot.

## Goal

One distributable **`SDP-Setup-<version>.exe`** (monolithic, self-extracting)
that can, on any Windows server — including a blank one behind the corporate
proxy — install, patch, upgrade, back up, restore and roll back the SDP
Dashboard with **zero network access and zero `npm install`**. Plus a
**scheduled-backup admin card** in the app (reports.html#admin) driving Windows
Task Scheduler.

## Decisions locked with the user

| Decision | Choice |
|---|---|
| Fresh-install target | **Blank server**: installer can lay down Node.js, pm2 (+ Windows service), PostgreSQL, provision `sdp_app`/`sdp_dashboard`, generate `.env` |
| Deliverable format | **True monolithic .exe** (7-Zip SFX wrapping the bundle; extracts to %TEMP%, auto-runs Setup.bat) |
| Payload | **Fully self-contained**: app code + complete `node_modules` (native binaries prebuilt on the dev box, same OS/arch/Node major) + cached Node.js MSI + PostgreSQL installer |
| Scheduled backups | **Windows Task Scheduler** (via `schtasks`), configured from the app's admin UI — backups run even when the app is down |
| Fresh questionnaire UX | Every prompt: **Enter = sensible default/known value**; shows **"where to find this"** hints; values can be **skipped and completed later** via a re-runnable menu option |

## Architecture

```
DEV BOX                                            BUNDLE (inside the .exe)
build-installer.ps1 (new, tools/installer-build/)   Setup.bat            console menu, self-elevating
  1. git archive at a clean tag  → app code          Install-SDP.ps1      steps 1-7, modes, rollback
  2. + node_modules (dev copy, natives included)     Manage-SDP.ps1       backup/restore/list/checkdb/
  3. + payload/installers/ (node MSI, PG exe —                            prune/schedule
       downloaded once, cached under tools/          config.psd1          declarative config + silent-
       installer-build/cache/, gitignored)                                mode answers
  4. + tools/installer/* (the 4 runtime files)       payload/app.zip      code + node_modules
  5. Compress-Archive → SDP-Dashboard-<v>.7z         payload/installers/  node-v24.x.msi, postgresql-17.exe
  6. 7z SFX module + config → SDP-Setup-<v>.exe      version.json         {version, sha, builtAt}
```

- `tools/installer/` (Setup.bat, Install-SDP.ps1, Manage-SDP.ps1, config.psd1)
  is **committed** and also **deployed with the app** (so the server always has
  Manage-SDP.ps1 for backups/restore/scheduled tasks).
- `tools/installer-build/` (build-installer.ps1 + cache/) is dev-only
  (deploy-skip list).
- `_sdp_admin.cmd` remains the day-to-day server menu; its backup/restore
  options **delegate to Manage-SDP.ps1** (single backup implementation).
- Pure-ASCII rule applies to every .cmd/.ps1 (ANSI parse pitfall).

## Install-SDP.ps1 — steps and modes

| # | Step | Fresh | Upgrade (default) | Patch | Reinstall |
|---|---|---|---|---|---|
| 1 | Preflight: admin rights, OS, disk, port free / owned by our pm2 app | ✔ | ✔ | ✔ | ✔ |
| 2 | Node.js ≥ NodeMinMajor — install from payload if absent | ✔ | verify | verify | ✔ |
| 3 | pm2 + Windows service — global install **from payload cache** (`npm i -g` against a bundled offline tarball or a bundled pm2 tree; NEVER the network), `pm2-service-install`; skip if service exists | ✔ | verify | verify | ✔ |
| 4 | PostgreSQL: install from payload OR reuse an existing cluster (4MyPeople convention: blank password = StandardPgSuperPassword from config.psd1, auto-read like `provision-prod.js` does today); provision `sdp_app` + `sdp_dashboard` (reuses `tools/pg/provision-prod.js`) | ✔ | verify | — | ✔ |
| 4b | **.env questionnaire** (below) | ✔ | preserve + append new keys commented | preserve | ✔ |
| 5 | **Automatic backup** via `Manage-SDP.ps1 -Backup` (code + `.env` + `pg_dump`) → `restore-point-pre-<v>-<stamp>` | — | ✔ before touching anything | ✔ | ✔ |
| 6 | Deploy code (+ node_modules from payload) + write `version.json`; hard-coded exclusions: `data\`, `blobs\`, `SDP-Backups\`, `.env` | ✔ | ✔ | ✔ code only, node_modules untouched | ✔ |
| 7 | pm2 stop → wait → start (NEVER reload) + verify: pm2 "online" within 30 s AND HTTP probe `GET :<port>/api/auth/config` (3 tries) → on failure **automatic rollback** to the step-5 restore point (code + .env; see Rollback), unless `-NoRollback` | ✔ | ✔ | ✔ | ✔ |

- `-Reinstall` keeps the database; a brand-new DB requires `-ConfirmDataLoss`.
- Every step logs `[STEP]/[OK]/[WARN]/[ERROR]` to console + `C:\ProgramData\SDP-Dashboard\logs\install-<stamp>.log`; a per-run `summary.txt` records per-step results and the exact resume command. Steps are idempotent — re-running after a failure is always safe.
- DB migrations: none needed beyond deploy+restart — the app applies idempotent PG schemas/seeds at boot (established architecture).

### .env questionnaire (step 4b — also menu option "E. Configure .env")

- Prompts grouped: Application (port) · Security (admin user, password ≥12 validated) · Zoho (CLIENT_ID/SECRET/REFRESH_TOKEN) · PostgreSQL (superuser: blank = appliance standard; sdp_app password: default = generated, shown once) · Backends (default `postgres` ×4 on fresh).
- **Every prompt**: Enter = default/current value; a "Where to find this" hint line (Zoho → api-console.zoho.com Self Client + RENEW_ZOHO_TOKEN.html; PG superuser → 4MyPeople config.psd1; …).
- **Skippable**: empty Zoho values write placeholders; install completes with a clear warning ("service will not start until filled — rerun Setup → E").
- **Re-runnable**: menu option E detects placeholder/missing keys in the existing `.env` and asks ONLY for those; filled values show as `[already configured — Enter to keep]`.
- **Silent mode**: every answer pre-fillable in `config.psd1` for scripted DR.

## Manage-SDP.ps1

| Action | Behaviour |
|---|---|
| `-Backup [-DbOnly]` | Restore point under `<InstallDir>\..\SDP-Backups\`: full (code, `.env`, `pg_dump` via the dump-db.js logic) or DB-only (`sdp_dashboard.sql`) |
| `-Restore <name>` | pm2 stop → restore code+`.env` → recreate DB + `psql < dump` → pm2 start. Explicit, destructive, asks YES |
| `-List` / `-Prune` | List restore points / apply retention (defaults: 8 full, 14 db-only; config.psd1) |
| `-CheckDb` | The existing PG pre-flight |
| `-Schedule -Daily HH:mm -Weekly Day-HH:mm [-Disable]` | Creates/updates 2 Task Scheduler jobs: `SDP-Backup-DB-Daily` (db-only) and `SDP-Backup-Full-Weekly`, running `Manage-SDP.ps1 -Backup [-DbOnly]` + `-Prune` |

`_sdp_admin.cmd` options 5/6/7 delegate here (duplicated batch logic removed).

## Scheduled-backup admin card (reports.html#admin, super_admin)

- Shows: both tasks' existence, last run time + result, recent restore points.
- Settings: daily time, weekly day+time, retention counts, enable/disable.
- `GET/POST /api/admin/backup-schedule` (super_admin): server shells out to
  `schtasks` (create/update/query/delete) and to `Manage-SDP.ps1 -Backup -DbOnly`
  for a "Backup now" button with visible result.
- Rationale: tasks fire even when the app is crashed — the app only *configures*
  them.

## config.psd1 (defaults for our context)

AppName, ServiceName (`endeavour-dashboard`), InstallDir (`C:\Apps\SDP-Dashboard`),
AppPort (3456), NodeMinMajor (24), PgMajor (17), PgHost/PgPort,
StandardPgSuperPassword (same value/convention as 4MyPeople), DbName/DbUser,
BackendsDefault (`postgres`), BackupDir, RetentionFull/RetentionDbOnly, and
every questionnaire answer for silent mode.

## Versioning

- Version = git tag (`vX.Y.Z`); `build-installer.ps1` refuses a dirty tree or
  missing tag (explicit `-DevBuild` suffix allowed).
- `version.json` written on install `{version, sha, installedAt, mode}`; menu
  shows "Installed vA → Bundle vB"; **downgrade refused** without `-Force`.
- `installs.log` in `C:\ProgramData\SDP-Dashboard\logs\` appends every run
  (who/what/when/result).

## Rollback semantics

1. Step-5 restore point exists before any mutation.
2. Verify failure → automatic restore of **code + `.env`**, restart, re-probe,
   exit `ROLLED BACK` with the log path highlighted.
3. **DB is NOT auto-rolled-back**: migrations are additive/idempotent, old code
   reads the same DB safely (proven by the per-module PG cutovers). DB restore
   stays a manual explicit `-Restore`.
4. `-NoRollback` for on-site debugging.

## Error handling & known-pitfall guards

Fail-fast per step; idempotent steps; never `pm2 reload` (EADDRINUSE);
orphan-on-port surgical recovery (netstat→PID→taskkill) built into step 7;
never `npm install` on the server; pure ASCII scripts; `(await …)` precedence
rule for any JS touched; `.env` never overwritten; `data\`/`blobs\`/backups
never touched by deploys.

## Test strategy (never touches prod)

1. **Parallel test instance** on the dev box (or a VM): Fresh install into
   `C:\Apps\SDP-Dashboard-TEST`, port 3457, pm2 name `sdp-test`, DB
   `sdp_dashboard_test` — via a test `config.psd1`. Exercises questionnaire,
   reuse-existing-Node/PG paths, probe.
2. **Upgrade cycle**: install bundle v-test-1 → build v-test-2 with a visible
   change → upgrade → assert code+backup+verify. Then a deliberately broken
   bundle (invalid server.js) → assert **automatic rollback**.
3. **Scheduled backups**: `-Schedule` → `schtasks /query` + force-run → restore
   point appears; `-Prune` respects retention.
4. **Restore**: `-Restore` back to v-test-1 including DB.
5. First real prod use = a **Patch** (smallest mode).

## Out of scope (YAGNI)

Multi-instance on one server, Linux, GUI wizard (console menu only), code
signing of the .exe (revisit if AV complains), auto-update checks, remote
distribution.
