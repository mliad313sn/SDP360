@echo off
rem ============================================================
rem  _stage_harmonize_to_prod.cmd
rem  Run this from your DEV BOX cmd.exe. It pushes the 4 files
rem  needed for the DB harmonisation onto Z:\ (production):
rem    - tracker-db.js
rem    - inspection-db.js
rem    - meetings-db.js
rem    - _harmonize_dbs_prod.cmd
rem
rem  After running this, RDP into prod and run:
rem      cd /d C:\Apps\SDP-Dashboard
rem      _harmonize_dbs_prod.cmd
rem
rem  No production data is touched at this stage. The new code
rem  is on disk but won't be loaded until pm2 restarts (which
rem  the harmonise script handles on prod).
rem ============================================================
setlocal

rem --- Sanity: Z:\ must be reachable -------------------------
if not exist "Z:\" (
  echo Z:\ not mapped -- attempting auto-remap...
  net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes 2>nul
  if not exist "Z:\" (
    echo ERROR: cannot reach Z:\. Map it first:
    echo     net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes
    exit /b 1
  )
)

rem --- Sanity: we must be on dev (these files must exist here) ---
set "SRC=C:\Users\Admin\Documents\SDP-Dashboard"
if not exist "%SRC%\tracker-db.js" (
  echo ERROR: %SRC%\tracker-db.js missing. Are you running this from the right machine?
  exit /b 1
)

echo.
echo ============================================================
echo  Stage harmonisation files to Z:\ (prod)
echo ============================================================
echo Source: %SRC%
echo Target: Z:\
echo.

xcopy "%SRC%\tracker-db.js"           "Z:\" /Y >nul && echo   ^>  tracker-db.js
xcopy "%SRC%\inspection-db.js"        "Z:\" /Y >nul && echo   ^>  inspection-db.js
xcopy "%SRC%\meetings-db.js"          "Z:\" /Y >nul && echo   ^>  meetings-db.js
xcopy "%SRC%\_harmonize_dbs_prod.cmd" "Z:\" /Y >nul && echo   ^>  _harmonize_dbs_prod.cmd

echo.
echo ============================================================
echo  Staging complete. Files are on Z:\ but pm2 has NOT been
echo  reloaded -- the old code is still running in memory.
echo.
echo  NEXT: RDP into prod, then:
echo    cd /d C:\Apps\SDP-Dashboard
echo    _harmonize_dbs_prod.cmd
echo ============================================================
echo.
endlocal
