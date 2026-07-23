@echo off
setlocal EnableExtensions EnableDelayedExpansion
title SDP Dashboard Setup

rem ============================================================================
rem  SDP Dashboard - menu-driven installer & maintenance launcher.
rem  Ships at the ROOT of the SDP-Setup-<version>.exe bundle (the SFX runs it
rem  after extraction). Self-elevates, then drives:
rem    Install-SDP.ps1  (patch / upgrade / reinstall / fresh / configure .env)
rem    Manage-SDP.ps1   (backup / restore / list / check DB)
rem  Options 8 (health) and 9 (diagnostics) are inlined here, adapted from
rem  _sdp_admin.cmd. Install actions always use THIS BUNDLE's scripts;
rem  maintenance actions prefer the INSTALLED copies under
rem  <InstallDir>\tools\installer when present (they carry any on-server
rem  config.psd1 edits; each script resolves config.psd1 next to itself).
rem
rem  KEEP THIS FILE PURE ASCII - cmd.exe reads it as ANSI; accented or
rem  box-drawing characters corrupt parsing. No ')' inside echo within
rem  parenthesized blocks. Never 'if cond call :x & goto y' unparenthesized.
rem
rem  Test hook: set SDP_SETUP_NOELEVATE=1 to skip the UAC self-elevation.
rem ============================================================================

if "%SDP_SETUP_NOELEVATE%"=="1" goto skipelev
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges - a UAC prompt will appear...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
:skipelev

cd /d "%~dp0"
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "PS=powershell -ExecutionPolicy Bypass -NoProfile -File"
set "INSTALL=%HERE%\Install-SDP.ps1"
set "LOGDIR=%ProgramData%\SDP-Dashboard\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1
set "SESSIONLOG=%LOGDIR%\setup-session.log"

if not exist "%INSTALL%" (
    echo ERROR: Install-SDP.ps1 not found next to this launcher.
    echo Extract the WHOLE package and run Setup.bat from inside it.
    pause
    exit /b 1
)
if not exist "%HERE%\config.psd1" (
    echo ERROR: config.psd1 not found next to this launcher.
    pause
    exit /b 1
)

rem --- read InstallDir / ServiceName / AppPort from config.psd1 --------------
set "APPDIR="
set "SVC="
set "PORT="
for /f "usebackq tokens=1,* delims==" %%A in (`powershell -NoProfile -Command "$c=Import-PowerShellDataFile '%HERE%\config.psd1'; 'APPDIR='+$c.InstallDir; 'SVC='+$c.ServiceName; 'PORT='+$c.AppPort"`) do set "%%A=%%B"
if not defined APPDIR set "APPDIR=C:\Apps\SDP-Dashboard"
if not defined SVC set "SVC=endeavour-dashboard"
if not defined PORT set "PORT=3456"

call :slog "Setup launched (bundle %HERE%, target %APPDIR%)"
set "_EMPTY=0"

:menu
rem versions: installed (target version.json) vs bundle (version.json here)
set "IVER=not installed"
set "BVER=unknown"
for /f "usebackq tokens=1,* delims==" %%A in (`powershell -NoProfile -Command "function V($f){ if(Test-Path $f){ try{ (Get-Content $f -Raw | ConvertFrom-Json).version }catch{ 'unknown' } } else { 'not installed' } }; 'IVER='+(V '%APPDIR%\version.json'); 'BVER='+(V '%HERE%\version.json')"`) do set "%%A=%%B"
echo.
echo ==================================================================
echo    SDP Dashboard - Setup ^& Maintenance
echo    Target : %APPDIR%
echo    Installed: %IVER%  -^>  Bundle: %BVER%
echo ==================================================================
echo    Install / Update
echo      1.  Patch                Code only - node_modules + DB untouched.
echo      2.  Upgrade              Code + node_modules; DB kept + verified.
echo      3.  Reinstall            Redeploy everything; DB kept unless asked.
echo      4.  Fresh install        First-time install on a new machine.
if exist "%HERE%\payload\demo\*.zip" echo      D.  Demo laptop         Fresh install + load the bundled dataset. Nothing to copy.
echo.
echo    Maintenance
echo      5.  Backup now           Full restore point (code + data + DB dump).
echo      6.  Restore              Roll back to a previous restore point.
echo      7.  List restore points
echo      8.  Verify health        pm2 status + HTTP probe on :%PORT%.
echo      9.  Diagnostics / logs   Versions, DBs, .env flags, last log lines.
echo      E.  Configure .env       Guided questionnaire (fills placeholders).
echo      C.  Check DB connection  PostgreSQL pre-flight.
echo.
echo      0.  Exit
echo ==================================================================
set "CH="
set /p CH=Choose an action:
if not defined CH (
  rem Guard against a closed stdin (non-interactive run) looping forever.
  set /a _EMPTY+=1
  if !_EMPTY! GEQ 3 exit /b 1
  goto menu
)
set "_EMPTY=0"
if "%CH%"=="1" goto patch
if "%CH%"=="2" goto upgrade
if "%CH%"=="3" goto reinstall
if "%CH%"=="4" goto fresh
if /i "%CH%"=="D" goto demo
if "%CH%"=="5" goto backup
if "%CH%"=="6" goto restorept
if "%CH%"=="7" goto listrp
if "%CH%"=="8" goto health
if "%CH%"=="9" goto diag
if /i "%CH%"=="E" goto envcfg
if /i "%CH%"=="C" goto checkdb
if "%CH%"=="0" goto end
echo.
echo   Invalid choice "%CH%".
goto menu

rem ----------------------------------------------------------------------------
rem  Append a timestamped line to the session log.
:slog
powershell -NoProfile -Command "Add-Content -Path '%SESSIONLOG%' -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + '%~1')" >nul 2>&1
goto :eof

rem  Maintenance script: prefer the INSTALLED copy (carries on-server config
rem  edits); fall back to the bundle copy on a machine with no install yet.
:resolvemanage
set "MANAGE=%HERE%\Manage-SDP.ps1"
if exist "%APPDIR%\tools\installer\Manage-SDP.ps1" set "MANAGE=%APPDIR%\tools\installer\Manage-SDP.ps1"
goto :eof

rem ---------------------------------------------------------------- 1
:patch
call :slog "Patch - start"
echo.
echo   ^>^> PATCH - code only; automatic pre-change backup + rollback on failure.
echo   ^>^> %PS% "%INSTALL%" -Patch
%PS% "%INSTALL%" -Patch -BundleRoot "%HERE%"
call :slog "Patch - finished (exit %errorlevel%)"
goto done

rem ---------------------------------------------------------------- 2
:upgrade
call :slog "Upgrade - start"
echo.
echo   ^>^> UPGRADE - code + node_modules; automatic backup + rollback on failure.
echo   ^>^> %PS% "%INSTALL%" -Upgrade
%PS% "%INSTALL%" -Upgrade -BundleRoot "%HERE%"
call :slog "Upgrade - finished (exit %errorlevel%)"
goto done

rem ---------------------------------------------------------------- 3
:reinstall
echo.
echo   *** REINSTALL ***
echo   Redeploys code + node_modules from this bundle into %APPDIR%.
echo   The database and data\ + blobs\ are KEPT unless you explicitly ask
echo   to drop the database below. A full backup is taken first.
set "SURE="
set /p SURE=  Type REINSTALL to confirm:
if /i not "%SURE%"=="REINSTALL" (
  echo   Cancelled.
  goto menu
)
set "DROPFLAG="
set "DB="
set /p DB=  Also DROP + recreate the PostgreSQL database? Type DROPDB, Enter = keep:
if /i "%DB%"=="DROPDB" set "DROPFLAG=-ConfirmDataLoss"
call :slog "Reinstall - start (db answer: %DB%)"
echo.
echo   ^>^> REINSTALL - redeploying from the bundle...
%PS% "%INSTALL%" -Reinstall %DROPFLAG% -BundleRoot "%HERE%"
call :slog "Reinstall - finished (exit %errorlevel%)"
goto done

rem ---------------------------------------------------------------- 4
:fresh
call :slog "Fresh install - start"
echo.
echo   ^>^> FRESH INSTALL - prerequisites, PostgreSQL, .env questionnaire, app.
echo   ^>^> %PS% "%INSTALL%" -Fresh
%PS% "%INSTALL%" -Fresh -BundleRoot "%HERE%"
call :slog "Fresh install - finished (exit %errorlevel%)"
goto done

rem ---------------------------------------------------------------- D
rem  Demo laptop: option 4 plus the bundled dataset, end to end. The archive
rem  travels INSIDE this bundle (payload\demo\), so the SFX has already put it
rem  on disk - the operator creates no folder and copies no file. The entry is
rem  hidden when a bundle carries no demo payload, so a production package
rem  never advertises an action it cannot perform.
:demo
if not exist "%HERE%\payload\demo\*.zip" (
  echo   This package carries no demo dataset.
  goto menu
)
call :slog "Demo laptop install - start"
echo.
echo   ^>^> DEMO LAPTOP - fresh install, then the bundled dataset is loaded.
echo   ^>^> The dataset REPLACES the accounts: sign in with the credentials
echo   ^>^> that ship with the data, not the admin created during setup.
echo   ^>^> %PS% "%INSTALL%" -Fresh -SeedData
%PS% "%INSTALL%" -Fresh -SeedData -BundleRoot "%HERE%"
call :slog "Demo laptop install - finished (exit %errorlevel%)"
goto done

rem ---------------------------------------------------------------- 5
:backup
call :resolvemanage
call :slog "Backup now"
echo.
echo   ^>^> Full restore point via "%MANAGE%" ...
%PS% "%MANAGE%" -Backup -Tag manual
goto done

rem ---------------------------------------------------------------- 6
:restorept
call :resolvemanage
%PS% "%MANAGE%" -List
echo.
set "RP="
set /p RP=  Restore point file name - e.g. sdp-restore_manual_20260713-120000.zip:
if not defined RP (
  echo   Cancelled.
  goto menu
)
call :slog "Restore %RP%"
%PS% "%MANAGE%" -Restore -Name "%RP%"
call :slog "Restore - finished (exit %errorlevel%)"
goto done

rem ---------------------------------------------------------------- 7
:listrp
call :resolvemanage
%PS% "%MANAGE%" -List
goto done

rem ---------------------------------------------------------------- 8  (inlined; adapted from _sdp_admin.cmd :health)
:health
echo.
call pm2 status %SVC% 2>nul || echo   pm2: NOT FOUND on PATH
echo   HTTP probe http://localhost:%PORT%/api/auth/config ...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:%PORT%/api/auth/config' -UseBasicParsing -TimeoutSec 10; Write-Host ('  [OK] HTTP ' + $r.StatusCode + ' - service is answering.') } catch { Write-Host ('  [FAIL] ' + $_.Exception.Message) }"
goto done

rem ---------------------------------------------------------------- 9  (inlined; adapted from _sdp_admin.cmd :diag)
:diag
echo --- versions ---------------------------------------------------
node -v 2>nul || echo   node: NOT FOUND
call pm2 -v 2>nul || echo   pm2: NOT FOUND
echo --- app --------------------------------------------------------
if exist "%APPDIR%\server.js" ( echo   %APPDIR% : app present ) else ( echo   %APPDIR% : NOT INSTALLED )
echo --- databases in data\ -----------------------------------------
if exist "%APPDIR%\data" ( dir "%APPDIR%\data\*.db" 2>nul | findstr /i ".db" ) else ( echo   data\ not found )
echo --- backend flags in .env --------------------------------------
if exist "%APPDIR%\.env" ( findstr /i "BACKEND PG_URL DATABASE_URL AI_PROVIDER SSO_MODE" "%APPDIR%\.env" 2>nul ) else ( echo   .env not found )
echo --- recent installer logs --------------------------------------
powershell -NoProfile -Command "Get-ChildItem '%LOGDIR%' -Filter *.log -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 8 | ForEach-Object { '  ' + $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm') + '  ' + $_.Name }"
echo --- last 30 app log lines --------------------------------------
call pm2 logs %SVC% --lines 30 --nostream 2>nul || echo   pm2 logs unavailable
goto done

rem ---------------------------------------------------------------- E
:envcfg
call :slog "Configure .env"
echo.
echo   ^>^> .env questionnaire - existing values kept, placeholders prompted.
echo   ^>^> %PS% "%INSTALL%" -ConfigureEnvOnly
%PS% "%INSTALL%" -ConfigureEnvOnly -BundleRoot "%HERE%"
call :slog "Configure .env - finished (exit %errorlevel%)"
goto done

rem ---------------------------------------------------------------- C
:checkdb
call :resolvemanage
%PS% "%MANAGE%" -CheckDb
goto done

rem ----------------------------------------------------------------------------
:done
echo.
echo ------------------------------------------------------------------
echo   Action finished - review the messages above.
echo   Logs: %LOGDIR%
goto menu

:end
call :slog "Setup exited"
endlocal
exit /b 0
