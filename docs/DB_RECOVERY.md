# Database Recovery Guide

When something destructive happened by mistake — a wrong delete, a botched reset, a corrupt save — this is the canonical guide to roll back. The dashboard uses an automatic pre-destructive backup system that snapshots the relevant DB **before** every destructive operation, so a one-step rollback is always available.

**TL;DR**: snapshots live in `C:\Apps\SDP-Dashboard\data\backups\`, named with the DB, a timestamp, and the reason. Stop pm2, copy the snapshot over the live DB file, start pm2. Done.

---

## When this guide applies

Use this guide when you need to undo any of:

| Operation | DB affected | Backup label |
|---|---|---|
| Activity Tracker → reset to defaults | `tracker.db` | `pre-reset` |
| Activity Tracker → delete year N | `tracker.db` | `pre-delete-year-N` |
| Inspections → delete an inspection | `inspection.db` | `pre-delete-<inspection-id>` |
| Inspections → reset lookup tables | `inspection.db` | `pre-reset-lookups` |
| Meetings → delete a meeting | `meetings.db` | `pre-delete-meeting-<id>` |
| Meetings → reset lookup tables | `meetings.db` | `pre-reset-lookups` |

If the operation you want to undo isn't in this list (e.g. a single user/site/dept/Risk-Register-alias delete from `reports.db`), there's no automatic backup. Those operations are low-impact (a single config row) and were intentionally left out of the auto-backup scope — undo them by manually re-creating the row from the admin UI.

---

## Recovery in 5 steps (the happy path)

Run all commands from **prod cmd.exe as administrator** at `C:\Apps\SDP-Dashboard\`.

### 1. Stop the application

```cmd
pm2 stop endeavour-dashboard
```

This releases the file lock on the live `.db` file. SQLite locks DB files exclusively while a process is using them; pm2 must be stopped before the file can be overwritten.

### 2. Find the right backup file

```cmd
dir data\backups\
```

Filenames look like:

```
tracker-20260531T144530-pre-delete-year-2027.db
inspection-20260531T144530-pre-delete-EM-IT-20260524-9514.db
meetings-20260531T144530-pre-delete-meeting-42.db
```

Format: `<dbname>-<UTC timestamp>-<reason>.db`
- **dbname** — `tracker`, `inspection`, or `meetings`
- **UTC timestamp** — `YYYYMMDDTHHMMSS` (no separators)
- **reason** — short tag describing what was about to happen

Pick the file matching the destructive operation you want to undo. The timestamp tells you exactly when the backup was taken — i.e. the state of the DB immediately before the bad change.

If you're not sure which file to pick, check pm2 logs from when the bad operation happened:

```cmd
pm2 logs endeavour-dashboard --lines 200 --nostream | findstr Backup
```

You'll see lines like:

```
[Backup] tracker -> C:\Apps\SDP-Dashboard\data\backups\tracker-20260531T144530-pre-delete-year-2027.db
```

That's the exact file you want.

### 3. Make a safety copy of the live (broken) DB

Even though you're about to overwrite it, save the current state somewhere outside the backups folder so you can compare or recover from it if needed:

```cmd
copy "tracker.db" "data\backups\tracker-BEFORE-RESTORE-%RANDOM%.db"
```

(Substitute `inspection.db` or `meetings.db` depending on which DB you're restoring.)

This is paranoia, but it costs almost nothing and saves you if you picked the wrong backup file.

### 4. Restore the backup

```cmd
copy /Y "data\backups\<the-backup-file>.db" "tracker.db"
```

Replace `<the-backup-file>` with the filename from step 2.

For an inspection restore:
```cmd
copy /Y "data\backups\inspection-20260531T144530-pre-delete-EM-IT-20260524-9514.db" "inspection.db"
```

For a meetings restore:
```cmd
copy /Y "data\backups\meetings-20260531T144530-pre-delete-meeting-42.db" "meetings.db"
```

### 5. Also clean up the WAL files (important!)

SQLite uses Write-Ahead Logging — there are usually two sibling files: `<dbname>.db-shm` and `<dbname>.db-wal`. After a restore, those need to go so SQLite doesn't replay stale write-ahead entries from the BROKEN state on top of your restored DB.

```cmd
del /Q tracker.db-shm tracker.db-wal 2>nul
```

(Use `inspection.db-shm` / `inspection.db-wal` or `meetings.db-shm` / `meetings.db-wal` as appropriate.)

The `2>nul` swallows the "file not found" error if there are no WAL files (which is fine — SQLite recreates them on next open).

### 6. Restart the application

```cmd
pm2 start endeavour-dashboard
```

Wait ~5 seconds. Check the logs:

```cmd
pm2 logs endeavour-dashboard --lines 30 --nostream
```

You should see the normal startup sequence:

```
[Tracker] ✅ tracker-db loaded
[Inspection] ✅ inspection-db loaded
[Meetings] ✅ meetings-db loaded
...
```

If you see crashes or "file is not a database" errors, the backup file was corrupted — see "Troubleshooting" below.

### 7. Verify in the browser

Hard refresh the dashboard (`Ctrl+Shift+R`) and:
- For a tracker year restore: check the Year dropdown shows the restored year again
- For an inspection restore: check the inspection appears in `inspections.html` and re-opens with all its data
- For a meeting restore: check `meetings.html` shows the meeting and all its nested issues / actions

If everything looks right, you're done. The "safety copy" from step 3 can be deleted whenever you're confident the restore is good.

---

## Test on a copy first (when you're not sure)

If you're uncertain which backup is the right one, you can test a candidate restore **without touching the live DB**:

```cmd
copy "data\backups\tracker-20260531T144530-pre-delete-year-2027.db" "tracker-test.db"
sqlite3 tracker-test.db ".tables"
sqlite3 tracker-test.db "SELECT years_json FROM tracker_config WHERE id=1;"
sqlite3 tracker-test.db "SELECT COUNT(*) FROM tracker_inputs WHERE year=2027;"
del tracker-test.db
```

(This requires `sqlite3.exe` on PATH. If it's not, install it via [SQLite Tools](https://www.sqlite.org/download.html) or just trust the timestamp — the auto-backup never produces corrupt files because it uses `VACUUM INTO` which is transactional.)

If the test queries return the expected data (`years_json` includes 2027, row count is sensible), you have the right backup. Proceed to step 1 of the recovery.

---

## Troubleshooting

### "file is not a database" after restart

The backup file is corrupted (very unusual — `VACUUM INTO` produces atomic snapshots, so this should never happen except in disk-failure scenarios). Pick a different (older) backup file and try again.

If no backup is good, restore the safety-copy from step 3:

```cmd
pm2 stop endeavour-dashboard
copy /Y "data\backups\tracker-BEFORE-RESTORE-<random>.db" "tracker.db"
pm2 start endeavour-dashboard
```

That at least gets you back to the (broken but functional) state you were in before attempting the restore.

### "database is locked" when running the `copy` command

pm2 didn't fully release the file. Check:

```cmd
pm2 status
```

If `endeavour-dashboard` shows `stopped`, but the file is still locked, the OS hasn't released it yet. Wait 10 seconds and retry. If it persists, restart the Windows file system cache:

```cmd
pm2 kill
```

(That kills the pm2 daemon entirely; relaunch with `pm2 start ...` afterward.)

### Live data accumulated AFTER the backup

The backup captures the state at the moment of the destructive operation. Any data entered AFTER that point — but before you ran the restore — will be LOST when you copy the backup over the live DB.

Strategies:
1. **Accept the loss** — usually the right call. The time window between the destructive op and the restore is short (minutes to hours).
2. **Merge manually** — export any data entered after the destructive op (e.g. via the dashboard's CSV / PPTX exports), restore, then re-enter.
3. **Wait** — if it's been days since the bad operation and lots of new data has accumulated, the restore might do more harm than good. Better to leave the broken state and live with the missing rows.

### Can't find the backup in pm2 logs

pm2 only retains the last few thousand log lines. If the bad operation happened long ago, the `[Backup]` line might have rolled out of the log buffer. Use the filename pattern in `dir data\backups\` to find it instead — the timestamp tells you when it was created.

---

## Frequently asked

**Q: How often are backups created?**
A: One per destructive operation, automatic. No scheduled backup; the system relies on every dangerous op snapshotting itself before running.

**Q: Where do backups live?**
A: `C:\Apps\SDP-Dashboard\data\backups\` on prod. The folder is created on demand the first time it's needed.

**Q: How big are they?**
A: Roughly the size of the live DB at that moment. `tracker.db` is ~100 KB; `inspection.db` with photos can be 50-300 MB; `meetings.db` is usually a few MB.

**Q: Will the backups fill the disk?**
A: Eventually, yes — there's no auto-cleanup. After 6 months of heavy use you might have 100+ files taking 1-5 GB. Plan to either review + delete manually every quarter, or schedule a cleanup task (see "Housekeeping" below).

**Q: Can I delete old backups?**
A: Yes, freely. They're just snapshot files — deleting them doesn't affect anything except your ability to roll back to that point.

**Q: Are backups copied off-server?**
A: NO. They live on the same server as the live DB. A full server failure (disk crash, ransomware) loses both. For real DR, schedule an additional copy to a different machine or cloud storage — that's outside the scope of the auto-backup system.

**Q: What about `reports.db`?**
A: Not covered by the auto-backup system. The destructive operations there (user delete, site delete, etc.) are single-row config changes that are easy to redo through the admin UI. If you do something catastrophic to `reports.db` directly (e.g. `DELETE FROM request_records` via sqlite3 CLI), there's no automatic recovery — you'd need to re-sync from Zoho, which takes 10-20 min.

---

## Housekeeping (recommended quarterly)

After 3-6 months, eyeball the backups folder:

```cmd
dir data\backups\ /O-D
```

(That lists newest first.) Delete anything older than ~90 days — it's vanishingly unlikely you'd need to roll back that far.

For an automated approach, save this as `_purge_old_backups.cmd` at the worktree root and schedule it weekly via Windows Task Scheduler:

```cmd
@echo off
rem Delete any backup files older than 90 days.
forfiles /P "C:\Apps\SDP-Dashboard\data\backups" /S /M *.db /D -90 /C "cmd /c del @path"
echo Cleanup done.
```

Adjust the `-90` to your preferred retention window.

---

## Quick reference cheat sheet

```
Found the bug: ----------------------------------------
  ↓
pm2 stop endeavour-dashboard
  ↓
dir data\backups\                    ← find the right file
  ↓
copy tracker.db data\backups\BEFORE-RESTORE-tracker.db   ← safety copy
  ↓
copy /Y data\backups\<file>.db tracker.db   ← actual restore
  ↓
del /Q tracker.db-shm tracker.db-wal 2>nul   ← clear WAL
  ↓
pm2 start endeavour-dashboard
  ↓
Verify in browser
```

Substitute `inspection`, `meetings` for `tracker` wherever applicable.
