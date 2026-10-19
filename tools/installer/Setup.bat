@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem An inherited ERRORLEVEL variable would shadow the real exit code read as !errorlevel!.
set "ERRORLEVEL="
title SDP Dashboard Setup

rem ============================================================================
rem  SDP Dashboard - menu-driven installer & maintenance launcher.
rem  Ships at the ROOT of the SDP-Setup-<version>.exe bundle (the SFX runs it
rem  after extraction). Self-elevates, then drives:
rem    Detect-SDP.ps1          (what is on this machine - once per menu round)
rem    Show-Situation.ps1      (coloured situation block + grouped menu)
rem    Confirm-Destructive.ps1 (red screen + exact phrase before anything destructive)
rem    Install-SDP.ps1  (patch / upgrade / reinstall / fresh / configure .env)
rem    Manage-SDP.ps1   (backup / restore / list / check DB)
rem  Options 8 (health) and 9 (diagnostics) are inlined here, adapted from
rem  _sdp_admin.cmd. EVERY script run from here is THIS BUNDLE's copy - an
rem  installed Manage-SDP.ps1 can predate the red-screen guarantees (pre-restore
rem  point, dump check) that the confirmation screen promises. Detection and
rem  Manage-SDP get the INSTALLED config.psd1 as -Config when it exists (merged
rem  over the bundle's config, so on-server edits are honoured). Install-SDP
rem  does NOT: that file is a full copy of the previous bundle's config and would
rem  override every default this bundle ships (NodeMinMajor, PgMinMajor ...).
rem
rem  KEEP THIS FILE PURE ASCII + CRLF - cmd.exe reads it as ANSI; accented or
rem  box-drawing characters corrupt parsing, and LF-only line endings break
rem  label lookup. No ')' inside echo within parenthesized blocks. Never
rem  'if cond call :x & goto y' unparenthesized. Delayed expansion is ON:
rem  never write a literal exclamation mark in an echo, and read any variable SET inside a
rem  parenthesized block as !VAR! (never %VAR%) within that same block.
rem
rem  The gating in the dispatch below MUST mirror what Show-Situation.ps1
rem  labels "not applicable" - an entry shown greyed out is refused here.
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
rem  Detection + the menu cannot work without these three - stop here.
for %%F in (Detect-SDP.ps1 SdpSituation.ps1 Show-Situation.ps1) do (
  if not exist "%HERE%\%%F" (
    echo ERROR: %%F not found next to this launcher.
    echo Extract the WHOLE package and run Setup.bat from inside it.
    pause
    exit /b 1
  )
)
rem  Without the red screen the menu stays usable for maintenance, but every
rem  destructive action refuses (see :confirm).
if not exist "%HERE%\Confirm-Destructive.ps1" (
    echo WARNING: Confirm-Destructive.ps1 not found next to this launcher.
    echo          Reinstall, fresh-over-existing, demo-over-existing and restore are DISABLED.
)

rem --- read InstallDir / ServiceName / AppPort from config.psd1 --------------
set "APPDIR="
set "SVC="
set "PORT="
for /f "usebackq tokens=1,* delims==" %%A in (`powershell -NoProfile -Command "$c=Import-PowerShellDataFile '%HERE%\config.psd1'; 'APPDIR='+$c.InstallDir; 'SVC='+$c.ServiceName; 'PORT='+$c.AppPort"`) do set "%%A=%%B"
if not defined APPDIR set "APPDIR=C:\Apps\SDP-Dashboard"
if not defined SVC set "SVC=endeavour-dashboard"
if not defined PORT set "PORT=3456"

rem --- session state -----------------------------------------------------------
rem  Detection runs once at start and again after every finished action (:done),
rem  never after a refusal or a cancelled confirmation (nothing changed).
rem  Per-session file name (two open menus never share a situation), deleted
rem  before every detection (a failed detection can never leave an older
rem  situation behind for Show-Situation / Confirm-Destructive to read) and on exit.
set "SITJSON=%TEMP%\sdp-situation-%RANDOM%%RANDOM%.json"
set "NEED_DETECT=1"
set "HASDEMO=0"
if exist "%HERE%\payload\demo\*.zip" set "HASDEMO=1"
rem  Detection and Manage-SDP overlay the INSTALLED config.psd1 when present, so
rem  the backup folder detection reports (used by the restore confirmation) is
rem  the one Manage-SDP actually uses.
set "INSTCFG="
if exist "%APPDIR%\tools\installer\config.psd1" set "INSTCFG=-Config "%APPDIR%\tools\installer\config.psd1""

call :slog "Setup launched (bundle %HERE%, target %APPDIR%)"
set "_EMPTY=0"

:menu
if "%NEED_DETECT%"=="1" (
  set "STATE=unknown"
  set "RECOMMENDED=none"
  set "DOWNGRADE=0"
  set "DB_REACHABLE=0"
  set "HAS_SERVER=0"
  set "IVER=unknown"
  set "BVER=unknown"
  del "%SITJSON%" >nul 2>&1
  for /f "usebackq tokens=1,* delims==" %%A in (`%PS% "%HERE%\Detect-SDP.ps1" -BundleRoot "%HERE%" -OutFile "%SITJSON%" %INSTCFG%`) do (
    if "%%A"=="STATE" set "STATE=%%B"
    if "%%A"=="RECOMMENDED" set "RECOMMENDED=%%B"
    if "%%A"=="DOWNGRADE" set "DOWNGRADE=%%B"
    if "%%A"=="DB_REACHABLE" set "DB_REACHABLE=%%B"
    if "%%A"=="HAS_SERVER" set "HAS_SERVER=%%B"
    if "%%A"=="INSTALLED_VER" set "IVER=%%B"
    if "%%A"=="BUNDLE_VER" set "BVER=%%B"
  )
  set "NEED_DETECT=0"
)
rem  Any state Show-Situation does not recognise is rendered as unknown - same here.
set "KNOWNSTATE=0"
if "%STATE%"=="installed" set "KNOWNSTATE=1"
if "%STATE%"=="partial" set "KNOWNSTATE=1"
if "%STATE%"=="empty" set "KNOWNSTATE=1"
echo.
echo ==================================================================
echo    SDP Dashboard - Setup ^& Maintenance      Target : %APPDIR%
echo ==================================================================
%PS% "%HERE%\Show-Situation.ps1" -Situation "%SITJSON%" -HasDemo "%HASDEMO%"
set "CH="
set /p CH=Choose an action:
if not defined CH (
  rem Guard against a closed stdin (non-interactive run) looping forever.
  set /a _EMPTY+=1
  if !_EMPTY! GEQ 3 goto end_fail
  goto menu
)
set "_EMPTY=0"
rem  D on a bundle without a demo payload: the entry is not even shown.
if /i "!CH!"=="D" if "%HASDEMO%"=="0" goto demo
rem  Gating - mirrors Show-Situation.ps1: unknown state first, then downgrade,
rem  then the per-state not-applicable entries.
if "%KNOWNSTATE%"=="0" (
  if "!CH!"=="1" goto refuse_unknown
  if "!CH!"=="2" goto refuse_unknown
  if "!CH!"=="3" goto refuse_unknown
  if "!CH!"=="4" goto refuse_unknown
  if /i "!CH!"=="D" goto refuse_unknown
)
if "%DOWNGRADE%"=="1" (
  if "!CH!"=="1" goto refuse_downgrade
  if "!CH!"=="2" goto refuse_downgrade
  if "!CH!"=="3" goto refuse_downgrade
  if "!CH!"=="4" goto refuse_downgrade
  if /i "!CH!"=="D" goto refuse_downgrade
)
if "%STATE%"=="empty" (
  if "!CH!"=="1" goto refuse_empty
  if "!CH!"=="2" goto refuse_empty
  if "!CH!"=="3" goto refuse_empty
)
if "%STATE%"=="partial" (
  if "!CH!"=="1" goto refuse_partial
  if "!CH!"=="2" goto refuse_partial
)
if "!CH!"=="3" if "%HAS_SERVER%"=="0" goto refuse_partial
if "!CH!"=="1" goto patch
if "!CH!"=="2" goto upgrade
if "!CH!"=="3" goto reinstall
if "!CH!"=="4" goto fresh
if /i "!CH!"=="D" goto demo
if "!CH!"=="5" goto backup
if "!CH!"=="6" goto restorept
if "!CH!"=="7" goto listrp
if "!CH!"=="8" goto health
if "!CH!"=="9" goto diag
if /i "!CH!"=="E" goto envcfg
if /i "!CH!"=="C" goto checkdb
if "!CH!"=="0" goto end
echo.
echo   Invalid choice "!CH!".
goto menu

rem ----------------------------------------------------------------------------
rem  Append a timestamped line to the session log. The text travels in the
rem  environment (SLOG_MSG), never inside the PowerShell command line, so a
rem  quote typed by the operator cannot break or inject into it. Callers with
rem  operator-typed content set SLOG_MSG themselves and call :slog with no argument.
:slog
if not "%~1"=="" set "SLOG_MSG=%~1"
powershell -NoProfile -Command "Add-Content -LiteralPath $env:SESSIONLOG -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $env:SLOG_MSG)" >nul 2>&1
set "SLOG_MSG="
goto :eof

rem  The ONE red-screen gate. %1 = action; optional target in CONF_TARGET.
rem  Sets CONFIRMED=1 only when Confirm-Destructive.ps1 exits EXACTLY 0 - a
rem  missing script, a crash, a negative exit code (powershell -File on a
rem  missing file gives -196608, which "if errorlevel 1" does NOT catch) or
rem  any other code all mean NOT confirmed.
:confirm
set "CONFIRMED=0"
if not exist "%HERE%\Confirm-Destructive.ps1" (
  echo.
  echo   ERROR: Confirm-Destructive.ps1 is missing from the bundle - destructive actions are disabled.
  set "CONF_TARGET="
  goto :eof
)
if defined CONF_TARGET (
  %PS% "%HERE%\Confirm-Destructive.ps1" -Action %~1 -Situation "%SITJSON%" -Target "!CONF_TARGET!"
) else (
  %PS% "%HERE%\Confirm-Destructive.ps1" -Action %~1 -Situation "%SITJSON%"
)
if "!errorlevel!"=="0" set "CONFIRMED=1"
set "CONF_TARGET="
goto :eof

rem  Refusals - nothing is run, no re-detection needed.
:refuse_downgrade
echo.
echo   Refused: this bundle %BVER% is OLDER than the installed version %IVER%. Use a newer bundle.
goto menu
:refuse_empty
echo.
echo   Not applicable: nothing is installed in %APPDIR% yet. Use 4 - Fresh install.
goto menu
:refuse_unknown
echo.
echo   Refused: the installation state could not be read - see the note above.
echo   Run 9 - Diagnostics, fix the cause, then retry.
goto menu
:refuse_partial
echo.
echo   Not applicable: the installation in %APPDIR% is incomplete - see the note above.
echo   With server.js present: use E - Configure .env, then 3 - Reinstall.
echo   Without server.js: use 4 - Fresh install; your .env is kept.
goto menu

rem  Maintenance script: ALWAYS the bundle copy (next to this file) - never the
rem  installed one, which may be an older, unguarded version. On-server config
rem  edits still apply: every call passes %INSTCFG%.
:resolvemanage
set "MANAGE=%HERE%\Manage-SDP.ps1"
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
rem  Two red screens: REINSTALL first; the database drop is only offered when
rem  the database is reachable (never drop what cannot be dumped first), and
rem  needs its own "DROP <db>" phrase.
:reinstall
set "CONF_TARGET="
call :confirm reinstall
if not "!CONFIRMED!"=="1" (
  echo   Cancelled - nothing changed.
  goto menu
)
set "DROPFLAG="
if "%DB_REACHABLE%"=="1" (
  set "DB="
  set /p DB=  Also DROP + recreate the PostgreSQL database? [y/N] - Enter = keep:
  if /i "!DB!"=="y" (
    set "CONF_TARGET="
    call :confirm dropdb
    if not "!CONFIRMED!"=="1" (
      echo   Cancelled - nothing changed.
      goto menu
    )
    set "DROPFLAG=-ConfirmDataLoss"
  )
) else (
  echo   Database not reachable - it is KEPT; dropping it is not offered.
)
set "SLOG_MSG=Reinstall - start (drop: !DROPFLAG!)"
call :slog
echo.
echo   ^>^> REINSTALL - redeploying from the bundle...
%PS% "%INSTALL%" -Reinstall !DROPFLAG! -BundleRoot "%HERE%"
call :slog "Reinstall - finished (exit %errorlevel%)"
goto done

rem ---------------------------------------------------------------- 4
:fresh
set "FOFLAG="
if not "%STATE%"=="empty" (
  set "CONF_TARGET="
  call :confirm fresh-over-existing
  if not "!CONFIRMED!"=="1" (
    echo   Cancelled - nothing changed.
    goto menu
  )
  set "FOFLAG=-ForceOverwrite"
)
set "SLOG_MSG=Fresh install - start (!FOFLAG!)"
call :slog
echo.
echo   ^>^> FRESH INSTALL - prerequisites, PostgreSQL, .env questionnaire, app.
echo   ^>^> %PS% "%INSTALL%" -Fresh !FOFLAG!
%PS% "%INSTALL%" -Fresh !FOFLAG! -BundleRoot "%HERE%"
call :slog "Fresh install - finished (exit %errorlevel%)"
goto done

rem ---------------------------------------------------------------- D
rem  Demo laptop: option 4 plus the bundled dataset, end to end. The archive
rem  travels INSIDE this bundle (payload\demo\), so the SFX has already put it
rem  on disk - the operator creates no folder and copies no file. The entry is
rem  hidden when a bundle carries no demo payload, so a production package
rem  never advertises an action it cannot perform.
rem  Over an existing install this is NOT option 4's red screen: step 8 drops
rem  the database and reloads the demo dump, so it has its own screen + phrase.
:demo
if "%HASDEMO%"=="0" (
  echo   This package carries no demo dataset - option D is not available.
  goto menu
)
set "FOFLAG="
if not "%STATE%"=="empty" (
  set "CONF_TARGET="
  call :confirm demo-over-existing
  if not "!CONFIRMED!"=="1" (
    echo   Cancelled - nothing changed.
    goto menu
  )
  set "FOFLAG=-ForceOverwrite"
)
set "SLOG_MSG=Demo laptop install - start (!FOFLAG!)"
call :slog
echo.
echo   ^>^> DEMO LAPTOP - fresh install, then the bundled dataset is loaded.
echo   ^>^> The dataset REPLACES the accounts: sign in with the credentials
echo   ^>^> that ship with the data, not the admin created during setup.
echo   ^>^> %PS% "%INSTALL%" -Fresh -SeedData !FOFLAG!
%PS% "%INSTALL%" -Fresh -SeedData !FOFLAG! -BundleRoot "%HERE%"
call :slog "Demo laptop install - finished (exit %errorlevel%)"
goto done

rem ---------------------------------------------------------------- 5
:backup
call :resolvemanage
call :slog "Backup now"
echo.
echo   ^>^> Full restore point via "%MANAGE%" ...
%PS% "%MANAGE%" -Backup -Tag manual %INSTCFG%
goto done

rem ---------------------------------------------------------------- 6
rem  Red screen with the zip's real contents + "RESTORE <yyyymmdd>", then
rem  -Force (Manage-SDP takes its own pre-restore restore point first).
:restorept
call :resolvemanage
%PS% "%MANAGE%" -List %INSTCFG%
echo.
set "RP="
set /p RP=  Restore point file name - e.g. sdp-restore_manual_20260713-120000.zip:
if not defined RP (
  echo   Cancelled.
  goto menu
)
rem  A double quote would break out of the quoted argument - refuse it.
set "RPCHK=!RP:"=!"
if not "!RPCHK!"=="!RP!" (
  echo   Refused: a restore point name never contains a double quote.
  goto menu
)
set "CONF_TARGET=!RP!"
call :confirm restore
if not "!CONFIRMED!"=="1" (
  echo   Cancelled - nothing changed.
  goto menu
)
set "SLOG_MSG=Restore !RP!"
call :slog
%PS% "%MANAGE%" -Restore -Name "!RP!" -Force %INSTCFG%
call :slog "Restore - finished (exit %errorlevel%)"
goto done

rem ---------------------------------------------------------------- 7
:listrp
call :resolvemanage
%PS% "%MANAGE%" -List %INSTCFG%
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
%PS% "%MANAGE%" -CheckDb %INSTCFG%
goto done

rem ----------------------------------------------------------------------------
:done
echo.
echo ------------------------------------------------------------------
echo   Action finished - review the messages above.
echo   Logs: %LOGDIR%
set "NEED_DETECT=1"
goto menu

:end
call :slog "Setup exited"
del "%SITJSON%" >nul 2>&1
endlocal
exit /b 0

rem  Closed stdin (non-interactive run with no more input): leave with an error.
:end_fail
call :slog "Setup exited - no more input"
del "%SITJSON%" >nul 2>&1
endlocal
exit /b 1
