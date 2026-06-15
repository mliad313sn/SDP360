@echo off
rem ============================================================
rem  _cleanup_meetings_dupes.cmd
rem  Run on the PROD host via RDP, from C:\Apps\SDP-Dashboard.
rem
rem  DRY-RUN by default (no changes, writes a .preview.json archive):
rem      _cleanup_meetings_dupes.cmd
rem
rem  COMMIT (backs up the DB first, archives deleted rows, then deletes):
rem      _cleanup_meetings_dupes.cmd --commit
rem
rem  Recommended: run once with no args, read the plan, THEN --commit.
rem  Ideally stop pm2 first so nothing writes mid-cleanup:
rem      pm2 stop endeavour-dashboard
rem      _cleanup_meetings_dupes.cmd --commit
rem      pm2 start endeavour-dashboard
rem
rem  Author: Claude — 2026-06-15
rem ============================================================
setlocal
cd /d "%~dp0"
node _cleanup_meetings_dupes.js data\meetings.db %1
endlocal
