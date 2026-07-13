# SDP Dashboard Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A monolithic `SDP-Setup-<version>.exe` that fresh-installs / patches / upgrades the SDP Dashboard on any Windows server with zero network access, automatic pre-upgrade backup and automatic rollback — plus a scheduled-backup admin card driving Windows Task Scheduler.

**Architecture:** A committed runtime bundle `tools/installer/` (Setup.bat menu → Install-SDP.ps1 steps 1-7 with modes → Manage-SDP.ps1 backup/restore/schedule, config.psd1 declarative) modeled on the 4MyPeople installer; a dev-only `tools/installer-build/` that assembles the self-extracting exe (7-Zip SFX) from a clean git tag + node_modules + cached third-party installers. The app gains `GET/POST /api/admin/backup-schedule` + an admin card that shell out to `schtasks`/Manage-SDP.ps1.

**Tech Stack:** Windows batch (pure ASCII), PowerShell 5.1 (pure ASCII), 7-Zip SFX, schtasks, Node/Express (existing app), node:test.

**Spec:** `docs/superpowers/specs/2026-07-13-sdp-installer-design.md` — read it FIRST. Non-negotiable project rules: scripts are PURE ASCII (Windows ANSI parse pitfall); NEVER `pm2 reload` (EADDRINUSE crash-loop); NEVER `npm install` on the server; `.env` is never overwritten; `data\`, `blobs\`, `SDP-Backups\` never touched by deploys; after any sync→async JS edit run the `(await f()).method()` precedence grep.

**Testing doctrine:** PowerShell units are exercised through a **parallel test instance** (`C:\Apps\SDP-Dashboard-TEST`, port 3457, pm2 name `sdp-test`, DB `sdp_dashboard_test`) driven by `tools/installer/config.test.psd1` — prod (`C:\Apps\SDP-Dashboard` on the server; on the DEV box the "prod-like" target is the TEST dir too) is never touched. Node-side API code is TDD'd with `node --test` and a `SCHTASKS_CMD` override so tests never create real scheduled tasks.

---

## File structure

| Path | Responsibility | Deployed? |
|---|---|---|
| `tools/installer/config.psd1` | All declarative config + silent-mode answers (AppName, ServiceName=`endeavour-dashboard`, InstallDir, AppPort=3456, NodeMinMajor=24, PgMajor=17, StandardPgSuperPassword, DbName/DbUser, BackendsDefault=`postgres`, HeapMB=4096, BackupDir=`..\SDP-Backups`, RetentionFull=8, RetentionDbOnly=14) | ✔ with app |
| `tools/installer/config.test.psd1` | Test overrides (InstallDir=`C:\Apps\SDP-Dashboard-TEST`, AppPort=3457, ServiceName=`sdp-test`, DbName=`sdp_dashboard_test`, DbUser=`sdp_app` reuse) | ✔ (harmless) |
| `tools/installer/env.template` | `.env` template: every key with a `#WHERE:` hint line and `__ASK__`/`__GEN__`/literal-default markers consumed by the questionnaire | ✔ |
| `tools/installer/Manage-SDP.ps1` | `-Backup [-DbOnly]` / `-Restore` / `-List` / `-Prune` / `-CheckDb` / `-Schedule` — THE single backup implementation | ✔ |
| `tools/installer/Install-SDP.ps1` | Steps 1-7, modes `-Fresh/-Upgrade/-Patch/-Reinstall`, `-ConfigureEnvOnly`, rollback | ✔ |
| `tools/installer/Setup.bat` | Self-elevating console menu (mirrors `_sdp_admin.cmd` conventions) | in bundle only |
| `tools/installer-build/build-installer.ps1` | Payload assembly + SFX build → `SDP-Setup-<v>.exe` | dev-only (skip list) |
| `tools/installer-build/download-cache.ps1` | One-time fetch of node MSI / PG exe / python-embed / wheels / pm2 offline tree / 7zr+7zSD into `cache/` (gitignored) | dev-only |
| `server.js` (modify) | `GET/POST /api/admin/backup-schedule`, `POST /api/admin/backup-now` (super_admin) | ✔ |
| `services/backupSchedule.js` (create) | schtasks wrapper (query/create/update/disable) + Manage-SDP invocation; `SCHTASKS_CMD`/`MANAGE_CMD` env overrides for tests | ✔ |
| `public/reports.html` (modify) | Admin card "Scheduled Backups" | ✔ |
| `_sdp_admin.cmd` (modify) | Options 5/6/7 delegate to Manage-SDP.ps1 | ✔ |
| `tests/backup-schedule.test.js` | node:test for services/backupSchedule.js + routes | dev |

Update `tools/deploy/make-deploy-zip.ps1` skip regex: add `tools/installer-build/`.
Update `.gitignore`: `tools/installer-build/cache/`, `SDP-Setup-*.exe`, `SDP-Dashboard-*.7z`.

---

### Task 1: Scaffold — config files, env.template, gitignore, deploy-skip

**Files:** Create `tools/installer/config.psd1`, `tools/installer/config.test.psd1`, `tools/installer/env.template`. Modify `.gitignore`, `tools/deploy/make-deploy-zip.ps1` (skip regex).

- [ ] **Step 1:** Write `config.psd1` with every key from the spec table (copy the 4MyPeople shape: a single `@{ ... }` literal; ASCII only). `StandardPgSuperPassword` value: copy from `C:\Users\Admin\AppData\Local\Temp\4MyPeople-Installer\config.psd1` at authoring time (same appliance convention).
- [ ] **Step 2:** Write `config.test.psd1` overriding InstallDir/AppPort/ServiceName/DbName as above (it is MERGED over config.psd1 by scripts when `-Config config.test.psd1` is passed).
- [ ] **Step 3:** Write `env.template` — one block per key. Format (parsed by the questionnaire):
```
## PORT | default=3456 | where=Application HTTP port
PORT=3456
## DASH_PASS | ask=secret | validate=minlen:12 | where=Choose the dashboard admin password (>=12 chars)
DASH_PASS=__ASK__
## ZOHO_CLIENT_ID | ask=text | optional=1 | where=https://api-console.zoho.com > Self Client > Client Secret tab (runbook: RENEW_ZOHO_TOKEN.html)
ZOHO_CLIENT_ID=__ASK__
## PG_URL | computed=pg_url | where=Built from the sdp_app password chosen in step 4
PG_URL=__COMPUTED__
## TRACKER_BACKEND | default=postgres
TRACKER_BACKEND=postgres
```
(+ MEETINGS/INSPECTION/REPORTS_BACKEND, DASH_USER, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, CACHE_TTL, NODE_ENV=production. `__ASK__` remaining in a written .env == "placeholder" for the E-option re-run.)
- [ ] **Step 4:** `.gitignore`: append `tools/installer-build/cache/`, `SDP-Setup-*.exe`, `SDP-Dashboard-*.7z`. `make-deploy-zip.ps1` skip regex: add `|tools/installer-build/` before the closing paren.
- [ ] **Step 5:** Verify ASCII: `python -c "print(sum(1 for c in open('tools/installer/config.psd1','rb').read() if c>127))"` → 0 for all three files. Verify psd1 parses: `powershell -NoProfile -Command "Import-PowerShellDataFile tools\installer\config.psd1"` → prints hashtable.
- [ ] **Step 6:** Commit `feat(installer): scaffold config + env template + build hygiene`.

### Task 2: Manage-SDP.ps1 — Backup / DbOnly / List / Prune

**Files:** Create `tools/installer/Manage-SDP.ps1`.

Contract: `powershell -File Manage-SDP.ps1 -Backup [-DbOnly] [-Config <psd1>] [-Tag <label>]`. Reads config (merge test psd1 if given). Full backup staging via robocopy `/E /XD node_modules <BackupDir> .git /XF raw_cache.json *.log` — **`data\` and `blobs\` INCLUDED** (spec) — then `node tools\pg\dump-db.js <stage>\sdp_dashboard.sql` (tolerates sqlite-only exit 0), then `Compress-Archive` → `<BackupDir>\sdp-restore_<tag>_<stamp>.zip`. DbOnly = dump straight to `<BackupDir>\sdp-db_<stamp>.sql`. `-List` prints both kinds newest-first with sizes. `-Prune [-RetentionFull N] [-RetentionDbOnly M]` keeps N zips + M sqls (params OVERRIDE config.psd1 defaults), deletes older. **Retention persistence mechanism**: the admin card's values are embedded as `-RetentionFull N -RetentionDbOnly M` flags inside the schtasks `/TR` command string when (re)creating the tasks — no config.psd1 rewrite; `getStatus()` parses them back out of the queried /TR for display. Log `[STEP]/[OK]/[ERROR]` to console + `C:\ProgramData\SDP-Dashboard\logs\manage-<action>-<stamp>.log` (create dir).

- [ ] **Step 1:** Write the script (param block: `[switch]$Backup,$DbOnly,$List,$Prune,$Restore,$CheckDb,$Schedule…` — full set now, later tasks fill bodies; unimplemented actions `Die 'not implemented yet'`).
- [ ] **Step 2 (test):** On the dev box create a disposable fake install dir with a `data\x.db`, `blobs\p.jpg`, `node_modules\junk.js`, `.env`; run `-Backup -Config config.test.psd1` pointed at it (test psd1 InstallDir). Expected: zip created; `Expand-Archive` shows data\x.db + blobs\p.jpg + .env present, node_modules absent; log file exists.
- [ ] **Step 3 (test):** `-Backup -DbOnly` with PG_URL set to the local `sdp_dashboard` → `sdp-db_*.sql` contains `CREATE TABLE`. `-List` shows both. Create 10 fake old zips → `-Prune` leaves 8.
- [ ] **Step 4:** ASCII check + commit `feat(installer): Manage-SDP.ps1 backup/list/prune`.

### Task 3: Manage-SDP.ps1 — Restore + CheckDb

- [ ] **Step 1:** `-Restore <name>`: confirm `YES` typed (skip with `-Force`); pm2 stop (tolerate absent); `Expand-Archive` to temp; robocopy stage → InstallDir (`/E`, no purge); if zip contains `sdp_dashboard.sql` AND PG_URL configured: `dropdb`-equivalent via psql (`DROP DATABASE IF EXISTS ... WITH (FORCE); CREATE DATABASE ... OWNER sdp_app;` as postgres using the provision-prod.js standard-password resolution — implement by shelling `node tools\pg\provision-prod.js --check` first, and for the drop/create use psql with `PGPASSWORD`) then `psql -f sdp_dashboard.sql`; pm2 start; probe.
- [ ] **Step 2:** `-CheckDb` = `node tools\pg\provision-prod.js --check` passthrough exit code.
- [ ] **Step 3 (test):** Round-trip on the TEST instance dir: backup → modify a file + drop a test row → restore → file back + row back.
- [ ] **Step 4:** Commit `feat(installer): Manage-SDP.ps1 restore + checkdb`.

### Task 4: Manage-SDP.ps1 — Schedule (schtasks)

Contract: `-Schedule -Daily "02:00" -Weekly "SUN:03:00" [-Disable]` (weekly format `DAY:HH:mm` everywhere — spec's `Day-HH:mm` is superseded). Creates/updates `SDP-Backup-DB-Daily` (runs `powershell -NoProfile -ExecutionPolicy Bypass -File <InstallDir>\tools\installer\Manage-SDP.ps1 -Backup -DbOnly; -Prune` — combine via a tiny `-DailyJob` composite switch) and `SDP-Backup-Full-Weekly` (`-Backup; -Prune`). Use `schtasks /Create /F /RU SYSTEM /SC DAILY /ST 02:00 /TN ... /TR "..."` and `/SC WEEKLY /D SUN`. `-Disable` = `schtasks /Change /TN ... /DISABLE` both. Also `-ScheduleStatus` prints `schtasks /Query /TN ... /FO LIST /V` digest (exists/enabled/last run/last result) as `KEY=VALUE` lines (consumed by the server API).

- [ ] **Step 1:** Implement; task names suffixed by ServiceName when != `endeavour-dashboard` (so TEST tasks are `SDP-Backup-DB-Daily-sdp-test` — never collide with prod).
- [ ] **Step 2 (test):** With config.test: `-Schedule -Daily 02:00 -Weekly SUN:03:00` → `schtasks /Query` shows both; `schtasks /Run /TN SDP-Backup-DB-Daily-sdp-test` → a `sdp-db_*.sql` appears in the test BackupDir; `-Disable` → status shows disabled; delete test tasks (`schtasks /Delete /F`).
- [ ] **Step 3:** Commit `feat(installer): scheduled backups via Task Scheduler`.

### Task 5: server API — services/backupSchedule.js + routes (TDD)

**Files:** Create `services/backupSchedule.js`, `tests/backup-schedule.test.js`. Modify `server.js` (3 routes, super_admin).

`backupSchedule.js` exports `getStatus()`, `setSchedule({daily, weeklyDay, weeklyTime, enabled, retentionFull, retentionDbOnly})`, `backupNow({dbOnly})`, `listRestorePoints()`. Implementation: `child_process.execFile` on `process.env.SCHTASKS_CMD || 'schtasks'` and `process.env.MANAGE_CMD || 'powershell'` (args arrays, never string concat). `listRestorePoints` reads the BackupDir (resolve from config.psd1 via a tiny parser or duplicate the two needed keys in `.env`? — NO: read `tools/installer/config.psd1` with a 5-line regex parser for BackupDir/Retention defaults).

- [ ] **Step 1 (failing test):** `tests/backup-schedule.test.js` — set `SCHTASKS_CMD` to a Node stub script (writes its argv to a tmp file, prints canned `/Query` output); assert `setSchedule` produced two `/Create` invocations with `/ST 02:00` and `/D SUN`; `getStatus()` parses the canned output into `{daily:{exists,enabled,lastRun,lastResult}, weekly:{...}}`; `listRestorePoints` on a tmp BackupDir with 2 fake files returns them sorted.
- [ ] **Step 2:** Run → fails (module missing). **Step 3:** implement. **Step 4:** green.
- [ ] **Step 5:** server.js routes: `GET /api/admin/backup-schedule` (requireReportSession + super_admin) → `{status, restorePoints}`; `POST /api/admin/backup-schedule` body `{daily,weeklyDay,weeklyTime,enabled,...}`; `POST /api/admin/backup-now` `{dbOnly}` → runs and returns `{ok, output}`. All async/await — mind `(await …)` precedence.
- [ ] **Step 6:** `node -e "new Function(require('fs').readFileSync('server.js','utf8'))"` + suite green + commit `feat(admin): backup-schedule API`.

### Task 6: Admin card UI (reports.html)

- [ ] **Step 1:** Add a "Scheduled Backups" card on `reports.html#admin` (super_admin-gated like the Exec View card — copy that card's markup/wiring pattern): status table (daily/weekly: enabled, last run, last result), settings form (daily time, weekly day+time, retention ×2, enable toggle), restore-points list (name/size/date), "Backup now (DB)" button. Uses the existing `api()`/auth-header helper of the page.
- [ ] **Step 2 (verify):** Run the app locally (`SDP_DATA_DIR` scratch + dummy env per tests/server-routes-smoke pattern) with `SCHTASKS_CMD` stubbed; login as seeded super_admin; card renders, POST round-trips, backup-now returns output. (Manual browser check acceptable; add route asserts to `tests/backup-schedule.test.js` if quick.)
- [ ] **Step 3:** Commit `feat(admin): scheduled-backups card`. NOTE: reports.html is `_htmlCache`'d — prod needs restart on deploy.

### Task 7: Install-SDP.ps1 — skeleton, steps 1-2, questionnaire

**Files:** Create `tools/installer/Install-SDP.ps1`.

- [ ] **Step 1:** Param block (`-Fresh,$Upgrade,$Patch,$Reinstall,$ConfigureEnvOnly,$NoRollback,$Force,$ConfirmDataLoss,-Config,-BundleRoot`), config merge, logging helpers (`Log/Step/Die`, transcript to ProgramData logs, `summary.txt` writer, **`installs.log` appender** — one line per run: `<stamp> | <user> | <mode> | <bundle-ver> | <result>` in `C:\ProgramData\SDP-Dashboard\logs\installs.log`, written on every exit path), step framework (`Invoke-Step -N 1 -Name '...' -Body {…}` records OK/FAILED and aborts).
- [ ] **Step 2:** Step 1 preflight: admin check ([Security.Principal]), disk >= 2 GB free, port check: free OR owned by our pm2 process name (netstat parse), InstallDir existence rules per mode (Fresh: must NOT contain server.js unless -Force; others: MUST).
- [ ] **Step 3:** Step 2 runtime deps: `node -v` >= NodeMinMajor else `msiexec /i payload\installers\node-*.msi /qn`; `python --version` else expand python-embed zip to `C:\Program Files\SDP-Python` + add app-local shim; wheels: `python -m pip install --no-index --find-links payload\installers\wheels matplotlib python-pptx pillow`. **Embeddable gotchas**: bundle `get-pip.py`; after extraction EDIT `python3xx._pth` to UNCOMMENT `import site` (otherwise pip installs succeed but `import matplotlib` fails at runtime).
- [ ] **Step 4:** Questionnaire engine (also `-ConfigureEnvOnly`): parse `env.template` blocks; for each key: existing real value → `[already configured - Enter to keep]`; `__ASK__`/missing → prompt showing the `where=` hint; `ask=secret` → `Read-Host -AsSecureString` (converted); `validate=minlen:12` enforced; `optional=1` allows Enter=placeholder + collects into a final WARN list; `computed=pg_url` built from step-4 outputs (or asked directly in ConfigureEnvOnly mode). Silent mode: any key present in config psd1 `EnvAnswers = @{...}` skips its prompt. Writes `.env` atomically (temp + move), NEVER deletes unknown existing keys (merge).
- [ ] **Step 5 (test):** `-ConfigureEnvOnly -Config config.test.psd1` against a scratch dir with a partial `.env` (real DASH_PASS, `ZOHO_CLIENT_ID=__ASK__`): only Zoho keys prompted (feed via piped CRLF input); result preserves DASH_PASS, fills/persists placeholders, appends missing new keys.
- [ ] **Step 6:** ASCII check + commit `feat(installer): Install-SDP skeleton + preflight + deps + env questionnaire`.

### Task 8: Install-SDP.ps1 — steps 3-4 (pm2/service, PostgreSQL)

- [ ] **Step 1:** Step 3: `pm2 -v` else **xcopy the bundled global tree**: `payload\installers\pm2-global
ode_modules\*` into `%APPDATA%
pm
ode_modules\` + the `pm2*` shims into `%APPDATA%
pm\` (create dir; Node MSI puts it on PATH). NO npm invocation at all; service: `Get-Service pm2*` else `pm2-service-install -n pm2` equivalent (bundle `pm2-windows-service` offline too — RESEARCH note for the executor: if pm2-windows-service proves unreliable, fall back to a schtasks ONSTART `pm2 resurrect` task and record the decision in the summary). App registration (Fresh/Reinstall): `pm2 start server.js --name <ServiceName> --node-args="--max-old-space-size=<HeapMB>"` in InstallDir, `pm2 save`.
- [ ] **Step 2:** Step 4: PG service exists? (`Get-Service postgresql*`) else run payload installer silent (`postgresql-17.exe --mode unattended --superpassword <StandardPgSuperPassword> --serverport 5432`); then provisioning: `node tools\pg\provision-prod.js` with `SDP_APP_PASSWORD` from questionnaire/generated (`PG_SUPER_PASSWORD` blank → standard, matching existing behavior); write PG_URL into `.env` via the questionnaire's computed slot.
- [ ] **Step 3 (blank-path smoke):** Simulate absence: temporarily point the script at a scratch `%APPDATA%
pm` (param/env override `NPM_GLOBAL_DIR`) and a scratch python dir → the xcopy-pm2 path and the python-embed + wheels path actually execute and `pm2 -v` / `python -c "import matplotlib"` succeed from the scratch locations.
- [ ] **Step 3b (test, TEST instance):** On the dev box (Node/PG/pm2 already present → the "verify/reuse" paths): `-Fresh -Config config.test.psd1 -BundleRoot <fake payload>` with steps 5-7 stubbed `Log 'skipped'` → creates `C:\Apps\SDP-Dashboard-TEST` deps-verified, `.env` written, `sdp_dashboard_test` DB exists (provision output), pm2 app `sdp-test` registered + saved. Clean up pm2 app after.
- [ ] **Step 4:** Commit `feat(installer): pm2/service + PostgreSQL steps`.

### Task 9: Install-SDP.ps1 — steps 5-7 (backup, deploy, verify+rollback) + modes

- [ ] **Step 1:** Step 5 (Upgrade/Patch/Reinstall): `Manage-SDP.ps1 -Backup -Tag "pre-<newver>"` → remember zip path. Step 6: expand `payload\app.zip` to staging; robocopy staging → InstallDir with hard-coded `/XD data blobs SDP-Backups /XF .env`; Upgrade/Reinstall additionally: rename `node_modules` → `node_modules.prev`, move payload node_modules in; Patch: leave node_modules; write `version.json`; `.env` new-keys append (from env.template, commented `# NEW in <ver>:`). Step 7: `pm2 stop <name>` → 5 s → `pm2 start` → poll `pm2 jlist` for online ≤30 s → probe `http://localhost:<port>/api/auth/config` ×3 (10 s apart). Any restart in this step (initial AND rollback) uses the **orphan-safe sequence**: pm2 stop → if port still LISTENING, netstat→PID→`taskkill /F /PID` (surgical, mirrors `_pm2_recover_prod.cmd` — NEVER `taskkill /IM node.exe`) → pm2 start. Failure → rollback: restore code+.env from step-5 zip (robocopy, same exclusions), restore `node_modules.prev` if present, orphan-safe restart, re-probe, exit 2 `ROLLED BACK`. Success → delete `node_modules.prev`.
- [ ] **Step 2:** Modes wiring per the spec table (which steps run in which mode); `-Reinstall` without `-ConfirmDataLoss` keeps DB (skips any DB drop — DB drop ONLY happens with the flag, implemented as drop/create before provisioning); downgrade check: bundle `version.json` < installed → `Die` unless `-Force`.
- [ ] **Step 3 (E2E test on TEST instance):** Build two fake bundles (task-10 script `-DevBuild` can be used once available; before that, hand-assemble payload dirs): v-t1 fresh install → app answers on :3457; v-t2 (visible change: a marker string in server.js console.log) upgrade → marker in pm2 logs + backup zip exists; v-t3 BROKEN (`server.js` syntax error) upgrade → automatic ROLLED BACK, marker still v-t2, exit code 2.
- [ ] **Step 4:** Commit `feat(installer): deploy + verify + automatic rollback + modes`.

### Task 10: Setup.bat menu + build-installer.ps1 + SFX

- [ ] **Step 1:** `Setup.bat`: self-elevation header (copy 4MyPeople's Start-Process -Verb RunAs trick), menu: `1 Patch / 2 Upgrade / 3 Reinstall / 4 Fresh install / 5 Backup now / 6 Restore / 7 List restore points / 8 Verify health / 9 Diagnostics / E Configure .env / C Check DB / 0 Exit`. Options 1-7/E/C dispatch to Install-SDP.ps1/Manage-SDP.ps1; **options 8 and 9 are INLINED in Setup.bat** (copy the `:health` and `:diag` blocks from `_sdp_admin.cmd` — no new PS switches). The menu header shows **`Installed: vA  ->  Bundle: vB`** (reads InstallDirersion.json vs bundle version.json; `not installed` when absent). Session log like 4MyPeople. Parenthesized if-blocks (the `if cond call :x & goto` pitfall), pure ASCII.
- [ ] **Step 2:** `download-cache.ps1`: fetches into `cache/`: node-v24 MSI, postgresql-17 EDB installer, python-3.12 embeddable zip + get-pip.py, wheels (`pip download matplotlib python-pptx pillow -d cache\wheels`), a **pre-installed global pm2 TREE** (copy `%APPDATA%
pm
ode_modules\pm2` + `pm2*.cmd`/`pm2*.ps1` shims from the dev box into `cache\pm2-global\` — `npm pack` tarballs do NOT contain transitive deps and `npm i --offline` would ENOTCACHED on a blank server) + `pm2-windows-service` tree the same way, 7zr.exe + 7zSD.sfx (7-zip extra). Idempotent (skip existing).
- [ ] **Step 3:** `build-installer.ps1`: require clean tree + tag (or `-DevBuild`); `git archive HEAD` → staging; copy dev `node_modules` (prune `.cache`); copy `tools/installer/*` to bundle root; copy cache installers to `payload\installers\`; zip app+node_modules → `payload\app.zip`; write bundle `version.json`; `7zr a` → `.7z`; `copy /b 7zSD.sfx + sfx-config.txt + archive.7z SDP-Setup-<v>.exe` (sfx config: `RunProgram="Setup.bat"`).
- [ ] **Step 4 (test):** `-DevBuild` produces an exe; run it in a sandbox dir → menu appears; option 7 works (empty list). Fresh-install E2E via the exe into the TEST dir (repeat of task 9's assertion through the real artifact).
- [ ] **Step 5:** Commit `feat(installer): Setup.bat menu + exe build pipeline`.

### Task 11: _sdp_admin.cmd delegation + docs + handover

- [ ] **Step 1:** `_sdp_admin.cmd` options 5/6/7 → `powershell -File tools\installer\Manage-SDP.ps1 -Backup|-Restore|-List` (remove the inline robocopy/Compress logic); keep the rest untouched.
- [ ] **Step 2:** Docs: `docs/INSTALLER.md` (operator guide: build, distribute, each menu option, rollback semantics, scheduled backups) + CLAUDE.md current-state note + spec/plan cross-links.
- [ ] **Step 3:** Full regression: `node --test` suites green (backup-schedule + exec/sso quick set), golden PPTX untouched, deploy zip builds, ASCII checks all scripts.
- [ ] **Step 4:** Commit `feat(installer): admin menu delegation + operator docs`.
