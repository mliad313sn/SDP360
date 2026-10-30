# Database Recovery Guide (PostgreSQL)

PostgreSQL is the only database of the application (decision PO-08, 2026-10-28 — SQLite was
removed from the code base). There is no `.db` file to copy back any more: every recovery is a
PostgreSQL restore. This guide replaces the former per-module SQLite snapshot procedure.

**TL;DR**: take a restore point before any destructive action
(`powershell -File tools\installer\Manage-SDP.ps1 -Backup -DbOnly -Tag <label>`). To go back, restore that point with
`Manage-SDP.ps1 -Restore -Name <file>` (it first takes a `pre-restore` point of the database it
is about to replace, and refuses a dump that is not complete).

---

## What protects the data

| Protection | When | Where | Notes |
|---|---|---|---|
| Nightly encrypted dump | every night (job `db.backup`, `services/sync/jobs.js`) | `SDP_BACKUP_DIR` (default `data/backups`) | `pg_dump` → gzip → AES-256-GCM with `SDP_BACKUP_KEY`; 14 kept by default (`SDP_BACKUP_KEEP`) |
| Restore drill | monthly (job `db.restore_drill`) | throw-away schema | proves the last dump restores and that the row counts match |
| Restore point | on demand, and before every installer upgrade / restore | `BackupDir` of the installer config | code + `.env` + a complete `sdp_dashboard.sql` |

Destructive actions that have **no undo inside the application** — restore a point if you need
to reverse them:

| Action | Data affected |
|---|---|
| Activity Tracker → delete year N | the year's pillars, activities, targets and monthly inputs (FK cascade) |
| Inspections → delete an inspection | the inspection, its findings, actions, photos, signatures (+ blob folder) |
| Meetings → delete a meeting | the PV, its issues, actions, projects, audit trail |
| Inspections / Meetings → reset lookup tables | the lookup tables (re-seeded) |

Single configuration rows (a user, a site, a department, a Risk Register alias) are re-created
from the admin pages; a full restore for one of them is not worth the downtime.

---

## Recovery in 4 steps

Run from **prod cmd.exe as administrator** at `C:\Apps\SDP-Dashboard\`.

1. **List the restore points** — `powershell -File tools\installer\Manage-SDP.ps1 -List`
   Pick the last point taken
   *before* the mistake. Nightly dumps live in `SDP_BACKUP_DIR` (`*.sql.gz.enc`).
2. **Restore it** — `powershell -File tools\installer\Manage-SDP.ps1 -Restore -Name <file>`.
   The red confirmation screen asks for the exact phrase `RESTORE <yyyymmdd>`. Before dropping
   the live database the script dumps it as a `pre-restore` point, so the restore itself can be
   undone.
3. **Restart** — `pm2 stop endeavour-dashboard`, wait 5 s, `pm2 start endeavour-dashboard` (never `pm2 reload`).
4. **Check** — open the page you repaired, then `node tools/pg/restore-drill.js` if you want the
   row counts compared with the dump.

A nightly encrypted dump (`*.sql.gz.enc`) is restored the same way once decrypted with
`SDP_BACKUP_KEY` (see `docs/ops/INCIDENT-RESPONSE.md`). Restoring on another machine needs the
same `SDP_CONFIG_KEY`, or the encrypted configuration secrets read back empty.
