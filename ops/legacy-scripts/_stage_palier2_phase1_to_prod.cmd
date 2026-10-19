@echo off
rem ============================================================
rem  _stage_palier2_phase1_to_prod.cmd
rem  Run from DEV BOX cmd.exe. Stages the 2 Phase 1 files on Z:\:
rem    - tracker-db.js              (saveTracker dual-write, deleteTrackerYear
rem                                   dual-delete, resetTracker dual-wipe)
rem    - _audit_tracker_dualwrite.cmd (read-only health check script for prod)
rem
rem  Phase 1 is ADDITIVE on top of Phase 0 — loadTracker still reads the
rem  legacy singleton, App.jsx is untouched, no schema changes, no FK
rem  changes. The only behaviour change is that saveTracker / deleteYear /
rem  resetTracker now also touch the normalised tables. Zero impact on
rem  UX. Zero risk on existing data.
rem
rem  After running this:
rem    1) RDP into prod
rem    2) (recommended) _backup_prod.cmd
rem    3) pm2 reload endeavour-dashboard --update-env
rem    4) Verify via _audit_tracker_dualwrite.cmd (read-only)
rem
rem  Author: Claude — 2026-06-09
rem ============================================================
setlocal

rem --- Auto-remap Z:\ if not present ---
if not exist "Z:\" (
  echo Z:\ not mapped -- attempting auto-remap...
  net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes 2>nul
  if not exist "Z:\" (
    echo.
    echo ERROR: Could not map Z: to \\10.225.99.173\SDP-Dashboard.
    echo From a regular ^(non-admin^) cmd.exe, run:
    echo     net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes
    echo Then re-run this script.
    exit /b 1
  )
  echo Z:\ remapped successfully.
  echo.
)

set "SRC=C:\Users\Admin\Documents\SDP-Dashboard"
for %%F in (tracker-db.js _audit_tracker_dualwrite.cmd _audit_tracker_dualwrite.js) do (
  if not exist "%SRC%\%%F" (
    echo ERROR: %SRC%\%%F missing.
    exit /b 1
  )
)

rem --- Pre-flight: must contain Phase 1 markers ---
findstr /c:"PHASE 1 (ADR-001)" "%SRC%\tracker-db.js" >nul 2>nul
if errorlevel 1 (
  echo ERROR: %SRC%\tracker-db.js does NOT contain Phase 1 markers.
  echo Did you run ^"git pull^" on dev box before staging?
  exit /b 1
)

echo.
echo ============================================================
echo  Stage Phase 1 (ADR-001) to Z:\ (prod)
echo ============================================================
echo.

xcopy "%SRC%\tracker-db.js"                "Z:\" /Y >nul && echo   ^>  tracker-db.js
xcopy "%SRC%\_audit_tracker_dualwrite.cmd" "Z:\" /Y >nul && echo   ^>  _audit_tracker_dualwrite.cmd
xcopy "%SRC%\_audit_tracker_dualwrite.js"  "Z:\" /Y >nul && echo   ^>  _audit_tracker_dualwrite.js

echo.
echo ============================================================
echo  Staging complete. pm2 has NOT been reloaded yet.
echo.
echo  NEXT STEPS on prod via RDP:
echo.
echo  1. (recommended) Fresh backup:
echo       _backup_prod.cmd
echo.
echo  2. Reload pm2 ONCE:
echo       pm2 reload endeavour-dashboard --update-env
echo.
echo  3. Watch the boot log briefly:
echo       pm2 logs endeavour-dashboard --out --lines 30 --nostream
echo.
echo  4. Run the audit (read-only sanity check):
echo       _audit_tracker_dualwrite.cmd
echo.
echo     Expected:  ^"AUDIT PASSED -- legacy and normalised schema in sync^"
echo.
echo  5. Optional smoke test (browser): open Activity Tracker, edit
echo     one cell, click Save. Then re-run the audit -- should still
echo     pass, proving dual-write fires on saves.
echo ============================================================
echo.
endlocal
