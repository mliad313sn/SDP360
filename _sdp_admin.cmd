@echo off
setlocal enabledelayedexpansion
title SDP Dashboard - Install ^& Maintenance
:: =====================================================================
::  SDP Dashboard - Install & Maintenance menu   (modeled on the
::  4MyPeople installer). Ships in the deploy ZIP; lives at the app
::  root on prod (C:\Apps\SDP-Dashboard\_sdp_admin.cmd).
::
::  KEEP THIS FILE PURE ASCII - cmd.exe reads it as ANSI; accented or
::  box-drawing characters corrupt parsing (same pitfall as .ps1).
:: =====================================================================

set "APP=%~dp0"
if "%APP:~-1%"=="\" set "APP=%APP:~0,-1%"
if not "%SDP_PROD_DIR%"=="" set "APP=%SDP_PROD_DIR%"
set "BAK=%APP%\..\SDP-Backups"
set "PM2APP=endeavour-dashboard"
set "PORT=3456"

:menu
echo.
echo =============================================================
echo   SDP Dashboard - Install ^& Maintenance
echo   App: %APP%
echo =============================================================
echo   Install / Update
echo    1. Apply deploy ZIP     Extract + apply an sdp-deploy_*.zip.
echo    2. Restart service      pm2 stop - wait 5 - start (NOT reload).
echo    3. Apply ZIP + restart  1 then 2 in one go.
echo.
echo   Maintenance
echo    5. Backup now           Restore point (code + data; skips
echo                            node_modules + raw_cache.json + blobs).
echo    6. Restore              Roll back to a restore point + restart.
echo    7. List restore points
echo    8. Verify health        pm2 status + HTTP probe on :%PORT%.
echo    9. Diagnostics / logs   Versions, DB sizes, last log lines.
echo    C. Check DB connection  PostgreSQL pre-flight (PG_URL in .env).
echo    P. Provision PostgreSQL Create sdp_app role + sdp_dashboard DB.
echo    R. Recover pm2          EADDRINUSE crash-loop recovery.
echo.
echo    0. Exit
echo =============================================================
set "CH="
set /p CH=Choose an action:
if not defined CH (
  rem Guard against a closed stdin (non-interactive run) looping forever.
  set /a _EMPTY+=1
  if !_EMPTY! GEQ 3 exit /b 1
  goto menu
)
set "_EMPTY=0"
if "%CH%"=="0" exit /b 0
if /i "%CH%"=="1" ( call :apply )
if /i "%CH%"=="2" ( call :restart )
if /i "%CH%"=="3" ( call :apply && call :restart )
if /i "%CH%"=="5" ( call :backup )
if /i "%CH%"=="6" ( call :restore )
if /i "%CH%"=="7" ( call :listbak )
if /i "%CH%"=="8" ( call :health )
if /i "%CH%"=="9" ( call :diag )
if /i "%CH%"=="C" ( call :checkdb )
if /i "%CH%"=="P" ( call :provision )
if /i "%CH%"=="R" ( call :recover )
goto menu

:: ---------------------------------------------------------------- 1
:apply
set "ZIP="
set /p ZIP=Path to sdp-deploy_*.zip (drag the file here):
set "ZIP=%ZIP:"=%"
if not exist "%ZIP%" ( echo [ERROR] File not found: "%ZIP%" & exit /b 1 )
set "STAGE=%TEMP%\sdp-apply-%RANDOM%"
echo Extracting to %STAGE% ...
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%STAGE%' -Force"
if errorlevel 1 ( echo [ERROR] extraction failed. & exit /b 1 )
if not exist "%STAGE%\files" ( echo [ERROR] Not a deploy package: no files\ folder inside. & exit /b 1 )
echo Applying files to %APP% ...
xcopy "%STAGE%\files" "%APP%" /E /Y /I >nul
if errorlevel 1 ( echo [ERROR] file copy failed. & exit /b 1 )
if exist "%STAGE%\DELETIONS.txt" (
  for /f "usebackq delims=" %%F in ("%STAGE%\DELETIONS.txt") do (
    if exist "%APP%\%%F" ( del /F /Q "%APP%\%%F" && echo   deleted %%F )
  )
)
rd /s /q "%STAGE%" 2>nul
echo [OK] Package applied. Remember: server.js + cached HTML need a RESTART (option 2).
exit /b 0

:: ---------------------------------------------------------------- 2
:restart
echo Stopping %PM2APP% ...
call pm2 stop %PM2APP%
echo Waiting 5s for the port to release (EADDRINUSE pitfall - never use pm2 reload) ...
timeout /t 5 /nobreak >nul
call pm2 start %PM2APP%
call pm2 save
echo [OK] Restarted. Each user should press Ctrl+F5 once.
exit /b 0

:: ---------------------------------------------------------------- 5
:backup
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP%\tools\installer\Manage-SDP.ps1" -Backup -Tag menu
echo NOTE: full restore point now INCLUDES data\ + blobs\ + pg_dump (Manage-SDP.ps1).
exit /b 0

:: ---------------------------------------------------------------- 6
:: Same red screen as Setup.bat option 6: the zip's real contents + the exact
:: "RESTORE <yyyymmdd>" phrase, then -Force (Manage-SDP takes its own
:: pre-restore restore point first). Detection + Manage-SDP both resolve
:: config.psd1 next to themselves, so they agree on the backup folder.
:restore
call :listbak
set "RP="
set /p RP=Restore point file name (e.g. sdp-restore_menu_20260713-120000.zip):
if not defined RP (
  echo Cancelled.
  exit /b 0
)
set "INST=%APP%\tools\installer"
if not exist "%INST%\Confirm-Destructive.ps1" (
  echo ERROR: Confirm-Destructive.ps1 missing under tools\installer - deploy the installer tools first.
  exit /b 1
)
set "SIT=%TEMP%\sdp-admin-situation.json"
powershell -NoProfile -ExecutionPolicy Bypass -File "%INST%\Detect-SDP.ps1" -BundleRoot "%INST%" -OutFile "%SIT%" >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%INST%\Confirm-Destructive.ps1" -Action restore -Situation "%SIT%" -Target "%RP%"
if errorlevel 1 (
  echo Cancelled - nothing changed.
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%INST%\Manage-SDP.ps1" -Restore -Name "%RP%" -Force
exit /b %errorlevel%

:: ---------------------------------------------------------------- 7
:listbak
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP%\tools\installer\Manage-SDP.ps1" -List
exit /b 0

:: ---------------------------------------------------------------- 8
:health
call pm2 status %PM2APP%
echo HTTP probe http://localhost:%PORT%/api/auth/config ...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:%PORT%/api/auth/config' -UseBasicParsing -TimeoutSec 10; Write-Host ('[OK] HTTP ' + $r.StatusCode + ' - service is answering.') } catch { Write-Host ('[FAIL] ' + $_.Exception.Message) }"
exit /b 0

:: ---------------------------------------------------------------- 9
:diag
echo --- versions ---------------------------------------------------
node -v 2>nul || echo node: NOT FOUND
call pm2 -v 2>nul || echo pm2: NOT FOUND
echo --- databases (data\) ------------------------------------------
if exist "%APP%\data" ( dir "%APP%\data\*.db" 2>nul | findstr /i ".db" ) else ( echo   data\ not found )
echo --- backend flags (.env) ---------------------------------------
if exist "%APP%\.env" ( findstr /i "BACKEND PG_URL DATABASE_URL AI_PROVIDER SSO_MODE" "%APP%\.env" 2>nul ) else ( echo   .env not found )
echo --- last 30 log lines ------------------------------------------
call pm2 logs %PM2APP% --lines 30 --nostream
exit /b 0

:: ---------------------------------------------------------------- C
:checkdb
node "%APP%\tools\pg\provision-prod.js" --check
exit /b 0

:: ---------------------------------------------------------------- P
:provision
echo One-time PostgreSQL provisioning - creates role sdp_app + database
echo sdp_dashboard on this cluster. Never touches fmp_v2 / 4MyPeople.
echo.
echo   PostgreSQL 'postgres' superuser password.
echo   Leave BLANK to use the standard appliance password - same convention
echo   as the 4MyPeople installer; auto-read from its config.psd1.
set "SUPW="
set /p SUPW=postgres password:
set "APPPW="
set /p APPPW=New password for the sdp_app role:
if not defined APPPW ( echo [ERROR] sdp_app password cannot be blank. & exit /b 1 )
set "PG_SUPER_PASSWORD=%SUPW%"
set "SDP_APP_PASSWORD=%APPPW%"
node "%APP%\tools\pg\provision-prod.js"
set "PG_SUPER_PASSWORD="
set "SDP_APP_PASSWORD="
exit /b 0

:: ---------------------------------------------------------------- R
:recover
echo Recovering from a pm2 EADDRINUSE crash-loop (surgical, per runbook) ...
call pm2 stop %PM2APP%
for /f "tokens=5" %%P in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
  echo Killing orphan PID %%P on port %PORT% ...
  taskkill /F /PID %%P
)
timeout /t 3 /nobreak >nul
call pm2 start %PM2APP%
call pm2 save
echo [OK] Recovery done. Check option 8 (health).
exit /b 0
