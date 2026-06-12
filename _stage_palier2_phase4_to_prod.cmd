@echo off
rem ============================================================
rem  _stage_palier2_phase4_to_prod.cmd
rem  Run from DEV BOX cmd.exe. Stages the 3 Phase 4 files:
rem    - tracker-db.js                       (4a schema/backfill +
rem                                           4b byYear read +
rem                                           4c-1 _saveV2 write path)
rem    - public\activity-tracker\engine.js   (4c-2 forYear resolver)
rem    - public\activity-tracker\App.jsx     (4c-3 per-year view + UI)
rem
rem  SAFE TO DEPLOY ANY TIME: everything is gated behind
rem  TRACKER_PER_YEAR_EDITS, which is NOT set yet. In compat mode the
rem  behaviour is byte-identical to Phase 3 (proven by parity tests),
rem  the dual-write + shadow + audit all keep running.
rem
rem  THE FLIP ITSELF (Phase 4d) is a separate, later decision — see
rem  the 5-condition checklist in ADR-001 (v2 UI stable >= 1 week,
rem  audit PASSED, fresh backup, calm point in the monthly cycle,
rem  explicit owner go).
rem
rem  Author: Claude — 2026-06-12
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

rem --- Pre-flight: Phase 4 markers must be present ---
findstr /c:"_saveV2" "%SRC%\tracker-db.js" >nul 2>nul
if errorlevel 1 ( echo ERROR: tracker-db.js missing Phase 4 markers. git pull first. & exit /b 1 )
findstr /c:"forYear" "%SRC%\public\activity-tracker\engine.js" >nul 2>nul
if errorlevel 1 ( echo ERROR: engine.js missing forYear. git pull first. & exit /b 1 )
findstr /c:"perYearEnabled" "%SRC%\public\activity-tracker\App.jsx" >nul 2>nul
if errorlevel 1 ( echo ERROR: App.jsx missing per-year view. git pull first. & exit /b 1 )

echo.
echo ============================================================
echo  Stage Phase 4 (compat mode) to Z:\ (prod)
echo ============================================================
echo.
xcopy "%SRC%\tracker-db.js"                     "Z:\"                          /Y >nul && echo   ^>  tracker-db.js
xcopy "%SRC%\public\activity-tracker\engine.js" "Z:\public\activity-tracker\"  /Y >nul && echo   ^>  public\activity-tracker\engine.js
xcopy "%SRC%\public\activity-tracker\App.jsx"   "Z:\public\activity-tracker\"  /Y >nul && echo   ^>  public\activity-tracker\App.jsx

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
echo  Then trigger a tracker load and verify the v2 seed:
echo    node -e "require('dotenv').config();require('./tracker-db.js').loadTracker();console.log('ok');"
echo    pm2 logs endeavour-dashboard --lines 50 --nostream ^| findstr /i "v2 prune Phase"
echo  Expected once:  [Tracker-DB] boot v2 sync: {"targets_v2_synced":~700,"inputs_v2_synced":~650}
echo.
echo  Smoke tests (browser, Ctrl+F5 on Activity Tracker):
echo    - Tracker loads, values identical, save round-trip OK
echo    - NO new UI appears (per-year is OFF until the 4d flip)
echo.
echo  Audit:  _audit_tracker_dualwrite.cmd  -^>  AUDIT PASSED
echo.
echo  THE 4d FLIP (later, after the ADR checklist):
echo    1) _backup_prod.cmd
echo    2) Add to .env:  TRACKER_PER_YEAR_EDITS=1
echo    3) pm2 stop + start
echo    4) Setup tab shows the blue 'Editing year N' banner; per-year
echo       edits + Copy button live; legacy singleton frozen.
echo  ROLLBACK of the flip is possible ONLY until the first divergent
echo  edit (remove the env line + restart). After divergence:
echo  backup-restore only.
echo ============================================================
echo.
endlocal
