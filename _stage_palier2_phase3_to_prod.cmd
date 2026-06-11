@echo off
rem ============================================================
rem  _stage_palier2_phase3_to_prod.cmd
rem  Run from DEV BOX cmd.exe. Stages the single Phase 3 file:
rem    - tracker-db.js  (orphan pruning: pillar/activity deletes
rem                      now propagate to the normalised schema;
rem                      legacy residual rows auto-cleaned)
rem
rem  Phase 3 unblocks pillar/activity deletes from the Tracker
rem  Setup UI. Also cleans the 11 historical residual rows on prod
rem  at first boot (boot prune).
rem
rem  Author: Claude — 2026-06-11
rem ============================================================
setlocal

if not exist "Z:\" (
  echo Z:\ not mapped -- attempting auto-remap...
  net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes 2>nul
  if not exist "Z:\" (
    echo ERROR: Could not map Z:. Run:
    echo     net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes
    exit /b 1
  )
  echo Z:\ remapped.
)

set "SRC=C:\Users\Admin\Documents\SDP-Dashboard"
findstr /c:"_pruneNewSchemaOrphans" "%SRC%\tracker-db.js" >nul 2>nul
if errorlevel 1 (
  echo ERROR: tracker-db.js does NOT contain Phase 3 markers. Run 'git pull' first.
  exit /b 1
)

echo.
echo ============================================================
echo  Stage Phase 3 (ADR-001) to Z:\ (prod)
echo ============================================================
echo.
xcopy "%SRC%\tracker-db.js" "Z:\" /Y >nul && echo   ^>  tracker-db.js
echo.
echo ============================================================
echo  NEXT STEPS on prod via RDP (stop+start, NOT reload):
echo.
echo    _backup_prod.cmd
echo    pm2 stop endeavour-dashboard
echo    timeout /t 5 /nobreak
echo    pm2 start endeavour-dashboard
echo    pm2 status
echo.
echo  Then trigger a tracker load (open Activity Tracker in browser
echo  or: node -e "require('dotenv').config();require('./tracker-db.js').loadTracker();")
echo  and check the boot prune cleaned the 11 residuals:
echo.
echo    pm2 logs endeavour-dashboard --lines 100 --nostream ^| findstr /i "prune Phase"
echo.
echo  Expected once:
echo    [Tracker-DB] boot prune: {"activities_pruned":0,"pillars_pruned":0,
echo                              "legacy_targets_pruned":11,"legacy_inputs_pruned":0}
echo.
echo  Final check: _audit_tracker_dualwrite.cmd
echo    -> AUDIT PASSED and the INFO about 11 residuals GONE.
echo ============================================================
echo.
endlocal
