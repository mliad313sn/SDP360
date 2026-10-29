# Installer v2.1 — design, build and proof

Version 2.1 · 2026-10-29 · Audience: release owner, Windows administrator, developer.
Operator guide (French): `docs/ops/INSTALLATION.md`. The console installer of 2026-09 (`docs/INSTALLER.md`,
`tools/installer/`) stays as it is and is still frozen out of every deploy ZIP (DEC-2).

## 1. What changed and why (UAT 2026-10-29)

The enterprise-architecture review of the previous `SDP-Dashboard-Setup.exe` found it could not complete a new
installation on a clean server (EA-02, 04, 05, 09, 10): the Manager and the dependencies were not in the payload,
`[Run]` exit codes were ignored, the embedded PostgreSQL had no password, nothing registered a service, and the
uninstaller left the application behind. Version 2.1 is a rebuild:

| Concern | v2.1 |
|---|---|
| Offline install | Node.js 22 (win-x64, checked against nodejs.org `SHASUMS256`), `node_modules` built on Windows, the service host and the Manager are all in the payload. No internet on the server. |
| One source of application files | the signed update package (`sdp-dashboard-<v>.zip` + `manifest.json`) is embedded and applied by `sdp-manager update`; install, repair and update cannot diverge. |
| Every system action checked | the wizard copies files only; `post-install.js` does the rest and is run with `Exec` + exit code. A non-zero code raises, Setup rolls the files back and names the log. |
| Service | Windows service `SDPDashboard` (`tools/service`, .NET Framework 4.8 — present on every supported Windows): automatic delayed start, restart on failure (5/10/30/60 s), logs in `logs\service-*.log`, stop kills the whole process tree. pm2 stays supported for existing servers (`SDP_SERVICE=pm2`). |
| Maintenance | **SDP Dashboard Manager** (`tools/manager`, WPF): Overview, Service, Backups & restore, Updates, Diagnostics. Every action runs `node tools\sdp-manager.js … --json`; the GUI holds no logic of its own. |
| Restore | `sdp-manager restore <dump> --confirm "RESTORE yyyymmdd"`: typed phrase, a backup taken first, service stopped, single-transaction restore, service started and probed, audit line. |
| Secrets | none in any file of the installer (`StandardPgSuperPassword` removed — EA-01). Passwords come from the masked wizard field or the environment variables `SDP_SETUP_PGSUPERPASS` / `SDP_SETUP_SVCPASS`; embedded PostgreSQL gets its password through a temporary option file deleted at once. |
| Network | the application listens on `127.0.0.1`; two firewall rules allow the port from loopback only and block it from everywhere else. Optional IIS front end (`iis-setup.ps1`: ARR, URL Rewrite, 5-minute proxy timeout, 150 MB requests, HTTPS binding by certificate thumbprint). |
| Uninstall | removes the service, the firewall rules and the application; keeps `data\`, `.env`, `logs\`, backups unless the operator says otherwise (`/REMOVEDATA=1` when silent). |

## 2. Wizard (English / French)

Welcome · Licence · Folder · What Setup found (installed version or nothing) · Mode (new / update / repair) ·
Unsigned package warning (only if `manifest.json` is not signed) · Data, backups and port · PostgreSQL
(embedded 17 or existing server) · Service account (empty = LocalSystem) · Public address (IIS, optional) ·
Summary · Progress · Finish (open the dashboard, open the Manager).

Silent use — every page has a parameter, secrets only through the environment:

```cmd
set SDP_SETUP_PGSUPERPASS=...
SDP-Dashboard-Setup-<v>.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG=setup.log ^
  /DIR="C:\Apps\SDP-Dashboard" /MODE=new /PORT=3456 /BACKUPDIR="D:\SDP-Backups" ^
  /PGHOST=localhost /PGPORT=5432 /DBNAME=sdp_dashboard /DBUSER=sdp_app
```

`/MODE=update` takes a backup first and rolls back automatically if the health probe (`/ready`, 90 s) fails.

## 3. Manager command line (same engine as the GUI)

| Command | Effect |
|---|---|
| `status [--json]` | version, commit, service kind and state, HTTP probe, backups, rollback point, free disk, sync health |
| `service start\|stop\|restart\|status` | Windows service or pm2; restart is stop → wait 5 s → start, never a reload |
| `backup` · `backups [--json]` | encrypted dump when `SDP_BACKUP_KEY` is set; list newest first with the confirmation phrase |
| `restore <dump> --confirm "RESTORE yyyymmdd"` | see §1 |
| `verify <zip>` · `update <zip>` · `rollback` | signed package check, apply with rollback point, return to the previous version |
| `support-bundle` | logs and configuration with secrets removed |

## 4. Build and proof

`tools/installer-v2/build.ps1 -Version <semver> [-PackageZip <zip>] [-SignTool <wrapper>] [-PgExe <installer>]`
on Windows: package (or reuse the one the release job built and signed) → Node.js verified → dependencies →
`dotnet build` of the service and the Manager → bootstrap → `ISCC`.

- **`.github/workflows/installer.yml`** (every push touching the installer, and on demand): builds Setup.exe on
  `windows-latest`, then `tools/installer-v2/tests/e2e.ps1` installs it silently on the runner's own throwaway
  PostgreSQL and checks: files, `.env` keys, service running and automatic, `/ready`, loopback-only listening,
  firewall rule, Manager status / restart / backup / list, restore refused without the phrase and done with it,
  repair leaving `.env` untouched, a broken configuration making Setup fail while the files stay, uninstall
  removing service, application and firewall rules but keeping `.env`. The Setup.exe and the logs are kept as
  the run artifact.
- **`.github/workflows/release.yml`**: the installer job calls the same `build.ps1` around the signed package,
  Authenticode-signs when the certificate secrets exist, and writes `SIGNING.txt`.
- Linux tests: `tests/service-control.test.js`, `tests/db-restore.test.js`, `tests/sdp-manager.smoke.test.js`,
  `tests/installer-no-stored-password.test.js`, `tests/ci-config.test.js`.

## 5. Human gates left

1. A code-signing certificate and the Ed25519 manifest key (three GitHub secrets — `docs/ops/INSTALLATION.md` §4);
   until then Setup shows the unsigned-package warning and silent installs need `/ALLOWUNSIGNED=1`.
2. The end-to-end run on the TEST instance of the real network (IIS, domain service account, real PostgreSQL)
   before the first production server is installed this way. Existing production stays on the ZIP + pm2 path
   (`docs/sop/SOP-deploy.md`) until that run is signed off.
