@echo off
rem ============================================================
rem  _stage_palier1_to_prod.cmd
rem  Run from DEV BOX cmd.exe. Stages the 3 Palier 1 files on Z:\:
rem    - reports-db.js     (new tables site_module_codes + infra_kpi_catalog)
rem    - tracker-db.js     (getActivityCode helper + loadTracker enrichment)
rem    - inspection-db.js  (new table insp_categories + seed)
rem
rem  All changes are ADDITIVE — no existing column, FK or behaviour
rem  is altered. Pm2 on prod can be reloaded any time afterwards;
rem  the new tables and seed will fire at next module init.
rem
rem  After running this:
rem    1) RDP into prod
rem    2) pm2 reload endeavour-dashboard --update-env
rem    3) pm2 logs endeavour-dashboard --lines 30 --nostream
rem       Look for:
rem         [seed] site_module_codes — inserted N (site,module,code) mappings
rem         [seed] infra_kpi_catalog — backfilled N new pairs from history
rem         [inspection-db] ✅ Seeded 17 insp_categories (Palier 1)
rem
rem  Author: Claude — 2026-06-05
rem ============================================================
setlocal

rem --- Auto-remap Z:\ if not present (same pattern as other ops scripts) ---
if not exist "Z:\" (
  echo Z:\ not mapped in this shell -- attempting auto-remap...
  net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes 2>nul
  if not exist "Z:\" (
    echo.
    echo ERROR: Could not map Z: to \\10.225.99.173\SDP-Dashboard.
    echo Possible causes:
    echo   - The server 10.225.99.173 is unreachable
    echo   - The share name has changed
    echo   - This account lacks permission on the share
    echo.
    echo FIX: From a regular ^(non-admin^) cmd.exe, run:
    echo     net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes
    echo Then re-run this script.
    echo.
    exit /b 1
  )
  echo Z:\ remapped successfully.
  echo.
)

rem --- Sanity: source files must exist ---
set "SRC=C:\Users\Admin\Documents\SDP-Dashboard"
for %%F in (reports-db.js tracker-db.js inspection-db.js) do (
  if not exist "%SRC%\%%F" (
    echo ERROR: %SRC%\%%F missing. Are you running this from the right machine?
    exit /b 1
  )
)

echo.
echo ============================================================
echo  Stage Palier 1 files to Z:\ (prod)
echo ============================================================
echo Source: %SRC%
echo Target: Z:\
echo.

xcopy "%SRC%\reports-db.js"     "Z:\" /Y >nul && echo   ^>  reports-db.js
xcopy "%SRC%\tracker-db.js"     "Z:\" /Y >nul && echo   ^>  tracker-db.js
xcopy "%SRC%\inspection-db.js"  "Z:\" /Y >nul && echo   ^>  inspection-db.js

echo.
echo ============================================================
echo  Staging complete. Files are on Z:\ but pm2 has NOT been
echo  reloaded -- the old code is still running in memory.
echo.
echo  NEXT: RDP into prod, then:
echo    pm2 reload endeavour-dashboard --update-env
echo    pm2 logs endeavour-dashboard --lines 30 --nostream
echo.
echo  Expected log lines on first boot:
echo    [seed] site_module_codes -- inserted 37 mappings
echo    [seed] infra_kpi_catalog -- backfilled N pairs
echo    [inspection-db] Seeded 17 insp_categories (Palier 1)
echo ============================================================
echo.
endlocal
