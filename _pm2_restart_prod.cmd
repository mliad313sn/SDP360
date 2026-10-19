@echo off
REM ============================================================================
REM  _pm2_restart_prod.cmd  —  clean STOP + START of the dashboard on prod
REM ----------------------------------------------------------------------------
REM  Run this ON THE PRODUCTION HOST after a deploy that touches server.js or an
REM  _htmlCache'd HTML (index/executive/reports/exec-view/...). Uses STOP -> wait
REM  -> START (NOT `pm2 reload`) to avoid the EADDRINUSE crash-loop where the old
REM  process keeps serving the stale _htmlCache on port 3456.
REM
REM  For a full asset-key refresh (external X-Dash-Key clients), follow with:
REM      iisreset
REM ============================================================================

setlocal
set APP=endeavour-dashboard
set APPDIR=C:\Apps\SDP-Dashboard

cd /d "%APPDIR%"
if errorlevel 1 (
  echo [pm2-restart] ERROR: could not cd to %APPDIR%
  exit /b 1
)

echo [pm2-restart] Working dir: %CD%
echo [pm2-restart] Stopping %APP% ...
call pm2 stop %APP%

echo [pm2-restart] Waiting 5s for port 3456 to release ...
timeout /t 5 /nobreak >nul

echo [pm2-restart] Starting %APP% ...
call pm2 start %APP%

echo [pm2-restart] Current status:
call pm2 status %APP%

echo.
echo [pm2-restart] Done. If external clients still 401 on /api, run: iisreset
endlocal
