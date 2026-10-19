@echo off
rem ============================================================
rem  _stage_palier2_phase0_to_prod.cmd
rem  Run from DEV BOX cmd.exe. Stages the single Phase 0 file on Z:\:
rem    - tracker-db.js  (ADR-001 Phase 0 — new tables tracker_years /
rem                       tracker_pillars / tracker_activities + the
rem                       idempotent _backfillFromLegacy function)
rem
rem  This change is STRICTLY ADDITIVE — loadTracker() and saveTracker()
rem  are not modified. The new tables fill themselves at boot from the
rem  existing tracker_config singleton. Zero impact on App.jsx, engine,
rem  PPTX, or any consumer.
rem
rem  After running this:
rem    1) RDP into prod
rem    2) (Optional but recommended) _backup_prod.cmd  -- fresh snapshot
rem    3) pm2 reload endeavour-dashboard --update-env
rem    4) pm2 logs endeavour-dashboard --out --lines 30 --nostream
rem       Look for:
rem         [Tracker-DB] _backfillFromLegacy: {"years_inserted":N,...}
rem    5) Verify the new tables (see commands at bottom of this script
rem       output)
rem
rem  Author: Claude — 2026-06-09
rem ============================================================
setlocal

rem --- Auto-remap Z:\ if not present ---
if not exist "Z:\" (
  echo Z:\ not mapped in this shell -- attempting auto-remap...
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

rem --- Sanity: source file must exist ---
set "SRC=C:\Users\Admin\Documents\SDP-Dashboard"
if not exist "%SRC%\tracker-db.js" (
  echo ERROR: %SRC%\tracker-db.js missing. Are you on the right machine?
  exit /b 1
)

rem --- Sanity: the source file must contain Phase 0 markers ---
findstr /c:"_backfillFromLegacy" "%SRC%\tracker-db.js" >nul 2>nul
if errorlevel 1 (
  echo ERROR: %SRC%\tracker-db.js does NOT contain _backfillFromLegacy.
  echo You are about to ship a stale tracker-db.js without Phase 0!
  echo Make sure you ran ^"git pull^" before staging.
  exit /b 1
)

echo.
echo ============================================================
echo  Stage Phase 0 (ADR-001) to Z:\ (prod)
echo ============================================================
echo Source: %SRC%\tracker-db.js
echo Target: Z:\tracker-db.js
echo.

xcopy "%SRC%\tracker-db.js" "Z:\" /Y >nul && echo   ^>  tracker-db.js

echo.
echo ============================================================
echo  Staging complete. pm2 NOT yet reloaded -- the old code is
echo  still running in memory.
echo.
echo  NEXT STEPS on prod via RDP:
echo.
echo  1. (optional but recommended) Fresh backup:
echo       _backup_prod.cmd
echo.
echo  2. Reload pm2 ONCE -- do NOT chain reloads/restarts:
echo       pm2 reload endeavour-dashboard --update-env
echo.
echo  3. Watch the boot log for the backfill line:
echo       pm2 logs endeavour-dashboard --out --lines 50 --nostream
echo       Look for:
echo         [Tracker-DB] _backfillFromLegacy: {"years_inserted":...}
echo.
echo  4. Verify the new tables actually got populated:
echo       cd /d C:\Apps\SDP-Dashboard
echo       node -e "const Database=require('better-sqlite3'); const db=new Database('./data/tracker.db',{readonly:true}); console.log('tracker_years      rows:', db.prepare('SELECT COUNT(*) AS n FROM tracker_years').get().n); console.log('tracker_pillars    rows:', db.prepare('SELECT COUNT(*) AS n FROM tracker_pillars').get().n); console.log('tracker_activities rows:', db.prepare('SELECT COUNT(*) AS n FROM tracker_activities').get().n); console.log('targets_with_actid:', db.prepare('SELECT COUNT(*) AS n FROM tracker_targets WHERE activity_id IS NOT NULL').get().n, '/', db.prepare('SELECT COUNT(*) AS n FROM tracker_targets').get().n); console.log('inputs_with_actid :', db.prepare('SELECT COUNT(*) AS n FROM tracker_inputs WHERE activity_id IS NOT NULL').get().n, '/', db.prepare('SELECT COUNT(*) AS n FROM tracker_inputs').get().n); db.close();"
echo.
echo  Expected on prod (real data, more sites/years than dev):
echo    - tracker_years      rows: 1 to N (matches years_json)
echo    - tracker_pillars    rows: 4 x N years
echo    - tracker_activities rows: 31 x N years (roughly)
echo    - targets_with_actid: 100%% (all backfilled)
echo    - inputs_with_actid:  100%% (all backfilled)
echo ============================================================
echo.
endlocal
