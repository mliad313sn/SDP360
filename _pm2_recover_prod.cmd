@echo off
setlocal EnableDelayedExpansion
REM ============================================================================
REM  _pm2_recover_prod.cmd  —  recover from the ":3456 crash-loop"
REM ----------------------------------------------------------------------------
REM  Symptom this fixes: the dashboard is unreachable / half-broken, pm2 shows a
REM  climbing restart counter, and MULTIPLE node.exe instances are fighting over
REM  port 3456 (an orphan keeps serving the stale _htmlCache while pm2 respawns
REM  a fresh one that can't bind -> EADDRINUSE -> loop).
REM
REM  Strategy (surgical — leaves the 4MyPeople node app UNTOUCHED):
REM    1. cd to the app dir.
REM    2. pm2 delete endeavour-dashboard  -> stops pm2 respawning OUR app
REM       (does NOT touch any other pm2 app; does NOT `pm2 kill` the daemon).
REM    3. taskkill ONLY the PID(s) still LISTENING on :3456  (never /IM node.exe).
REM    4. pm2 start server.js fresh with the 4 GB heap ceiling.
REM    5. pm2 save + status + port check.
REM
REM  Run this ON THE PRODUCTION HOST.
REM ============================================================================

set APP=endeavour-dashboard
set APPDIR=C:\Apps\SDP-Dashboard
set PORT=3456

cd /d "%APPDIR%"
if errorlevel 1 (
  echo [recover] ERROR: could not cd to %APPDIR%
  exit /b 1
)
if not exist "server.js" (
  echo [recover] ERROR: server.js not found in %CD% — wrong directory?
  exit /b 1
)
echo [recover] Working dir: %CD%

echo.
echo [recover] --- BEFORE ---
call pm2 status %APP% 2>nul
echo [recover] node instances currently listening on :%PORT%:
netstat -ano | findstr "LISTENING" | findstr /R ":%PORT%\>"

echo.
echo [recover] Step 1/4 — removing %APP% from pm2 (stops the respawn loop) ...
call pm2 delete %APP% >nul 2>&1
echo [recover] waiting 3s ...
timeout /t 3 /nobreak >nul

echo [recover] Step 2/4 — killing ONLY orphan process(es) holding :%PORT% ...
set FOUND=0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr /R ":%PORT%\>"') do (
  if not "%%P"=="0" (
    set FOUND=1
    echo [recover]   taskkill /F /PID %%P
    taskkill /F /PID %%P >nul 2>&1
  )
)
if "!FOUND!"=="0" echo [recover]   ^(no orphan was still holding the port — good^)
echo [recover] waiting 3s for the port to release ...
timeout /t 3 /nobreak >nul

echo [recover] Step 3/4 — starting %APP% fresh (4 GB heap) ...
call pm2 start server.js --name %APP% --node-args="--max-old-space-size=4096"
if errorlevel 1 (
  echo [recover] ERROR: pm2 start failed. Check `pm2 logs %APP% --lines 50`.
  exit /b 1
)

echo [recover] Step 4/4 — saving pm2 process list ...
call pm2 save >nul 2>&1

echo.
echo [recover] --- AFTER ---
call pm2 status %APP%
echo [recover] node instance(s) now listening on :%PORT% (expect exactly ONE):
netstat -ano | findstr "LISTENING" | findstr /R ":%PORT%\>"

echo.
echo [recover] Done. If external clients still 401 on /api, also run: iisreset
echo [recover] Verify heap arg: pm2 show %APP% ^| findstr "node args"
endlocal
