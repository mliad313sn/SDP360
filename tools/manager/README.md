# SDP Dashboard Manager (Windows, WPF .NET 8) — specification

Status: **specified, not yet built** (the certificate and the WPF toolchain are the human prerequisites). The CLI core it wraps — `tools/sdp-manager.js` — is built and tested; the Manager adds no logic, only a window and a tray icon.

## Screens
| Screen | Source | Actions |
|---|---|---|
| Overview | `sdp-manager status` (JSON mode to add: `--json`) | Start / stop / restart the pm2 service (stop → start), open the dashboard, open logs |
| Sync health | `GET /api/sync/health` | Per job: state, last ok, last error, run-now (POST `/api/sync/trigger/<job>`) |
| Backups | `sdp-manager backup`, listing of `SDP_BACKUP_DIR` | Backup now, **restore** behind the red confirmation screen (type the dump date), retention |
| Updates | release feed (GitHub releases JSON or a mirrored folder), `sdp-manager verify/update/rollback` | Check, download, verify (manifest + `.sha256` + signature of Setup.exe), apply, rollback; unsigned package = yellow warning |
| Diagnostics | `pm2 jlist`, port check, disk, PostgreSQL ping, `.env` key presence (never values) | Support bundle (`sdp-manager support-bundle`) |
| Secrets | `tools/pg/reencrypt-secrets.js` | Rotate `SDP_CONFIG_KEY` (asks for the old and new key, writes `.env`, re-encrypts, restarts) |
| Tray | — | Green / amber / red dot from the Overview state; right-click: open, restart, quit |

## Rules carried over from the CLI
- Every destructive action goes through a red confirmation screen with a typed phrase (`RESTORE <yyyymmdd>`, `ROLLBACK`), confirmed only on exit code 0 of the CLI.
- No secret value is ever displayed or logged; `.env` is edited as key/value with masked inputs.
- The Manager calls `node tools\sdp-manager.js …` from the install folder; it never reimplements apply/rollback.

## Build
`dotnet publish -c Release -r win-x64 --self-contained false` → `tools\manager\SDP-Dashboard-Manager.exe`, signed by the same CI job as Setup.exe, shipped inside the update package once built (the Inno script already creates its shortcut when the file exists).
