@echo off
rem ============================================================
rem  _stage_analytics_filters_to_prod.cmd
rem  Run from DEV BOX cmd.exe. Stages the 3 files of the
rem  analytics multi-select filters feature (commit 3a5ad47):
rem    - public\analytics.html  (4 dropdown-checkbox widgets)
rem    - reports-db.js          (getRequestMetrics IN-clauses +
rem                              getRequestFilterOptions)
rem    - server.js              (CSV query params + new route
rem                              /api/metrics/request-filter-options)
rem
rem  server.js changes -> pm2 restart REQUIRED on prod after copy.
rem  Use stop + start (NOT reload) to avoid the EADDRINUSE race
rem  hit twice on 2026-06-11.
rem
rem  Author: Claude — 2026-06-11
rem ============================================================
setlocal

rem --- Auto-remap Z:\ if not present ---
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
    exit /b 1
  )
  echo Z:\ remapped successfully.
  echo.
)

set "SRC=C:\Users\Admin\Documents\SDP-Dashboard"
for %%F in (public\analytics.html reports-db.js server.js) do (
  if not exist "%SRC%\%%F" (
    echo ERROR: %SRC%\%%F missing. Wrong machine?
    exit /b 1
  )
)

rem --- Pre-flight: files must contain the feature markers ---
findstr /c:"getRequestFilterOptions" "%SRC%\reports-db.js" >nul 2>nul
if errorlevel 1 (
  echo ERROR: reports-db.js does NOT contain getRequestFilterOptions.
  echo Run 'git pull' on the dev box first.
  exit /b 1
)
findstr /c:"request-filter-options" "%SRC%\server.js" >nul 2>nul
if errorlevel 1 (
  echo ERROR: server.js does NOT contain the request-filter-options route.
  exit /b 1
)
findstr /c:"_initMFilters" "%SRC%\public\analytics.html" >nul 2>nul
if errorlevel 1 (
  echo ERROR: analytics.html does NOT contain the filter widgets.
  exit /b 1
)

echo.
echo ============================================================
echo  Stage analytics filters (3 files) to Z:\ (prod)
echo ============================================================
echo.

xcopy "%SRC%\public\analytics.html" "Z:\public\" /Y >nul && echo   ^>  public\analytics.html
xcopy "%SRC%\reports-db.js"         "Z:\"        /Y >nul && echo   ^>  reports-db.js
xcopy "%SRC%\server.js"             "Z:\"        /Y >nul && echo   ^>  server.js

echo.
echo ============================================================
echo  Staging complete. server.js changed -- pm2 restart REQUIRED.
echo.
echo  NEXT STEPS on prod via RDP (stop+start, NOT reload):
echo.
echo    pm2 stop endeavour-dashboard
echo    timeout /t 5 /nobreak
echo    pm2 start endeavour-dashboard
echo    pm2 status
echo.
echo  Then in the browser: Ctrl+F5 on
echo    https://itops-dashboard.edv-ops.com/analytics.html
echo.
echo  Expected: 4 new dropdown filters after Period (Statuses /
echo  Types / Impacts / Modes) populated with live Zoho values.
echo  Selecting values re-fetches the Helpdesk Requests KPIs with
echo  server-side SQL filtering. Change/CAB/CSAT sections are
echo  unaffected by design (tooltip explains).
echo ============================================================
echo.
endlocal
