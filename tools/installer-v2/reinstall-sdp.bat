@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "ERRORLEVEL="
rem ===========================================================================
rem  reinstall-sdp.bat - replace SDP Dashboard on this Windows machine with the
rem  claude/sdp360-consolidation build (2.0.0-alpha.14).
rem
rem    1  checks (admin, Setup.exe, PostgreSQL)
rem    2  final backup of the existing sdp_dashboard database (pg_dump)
rem    3  removes the old app (pm2 + old uninstaller), keeps the folder as *.old-<stamp>
rem    4  drops sdp_dashboard + sdp_app ONLY after you type DROP (never fmp_v2)
rem    5  silent install of the new Setup.exe (new mode, existing PostgreSQL)
rem    6  health check on http://localhost:%PORT%/
rem
rem  Double-click it: it asks for admin rights itself, finds the installer next to
rem  it or in Downloads (.exe or the 'setup' zip, unzipped automatically), else
rem  opens the GitHub download page and waits. No PostgreSQL -> Setup installs one.
rem  PostgreSQL itself is never uninstalled (4MyPeople uses the same server).
rem ===========================================================================

set "APPDIR=C:\Apps\SDP-Dashboard"
set "PORT=3456"
set "PGHOST=localhost"
set "PGPORT=5432"
set "DBNAME=sdp_dashboard"
set "DBUSER=sdp_app"
set "BACKUPDIR=C:\Apps\SDP-Backups"
set "RUN_ID=40888993309"
set "REPO=mliad313sn/SDP360"
set "HERE=%~dp0"
for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%t"
set "LOG=%HERE%reinstall-sdp-%STAMP%.log"

call :say "SDP Dashboard reinstall - log: %LOG%"

rem ---- 1. checks ------------------------------------------------------------
net session >nul 2>&1
if not "!errorlevel!"=="0" (
  echo Asking Windows for administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  endlocal & exit /b 0
)

set "DL=%USERPROFILE%\Downloads"
call :findsetup
if not defined SETUP (
  where gh >nul 2>&1
  if "!errorlevel!"=="0" (
    call :say "Downloading the installer with GitHub CLI..."
    gh run download %RUN_ID% -R %REPO% -n setup -D "%HERE%setup" >>"%LOG%" 2>&1
    call :findsetup
  )
)
if not defined SETUP (
  call :say "The installer is not on this machine yet. Opening the download page:"
  call :say "  sign in to GitHub, scroll to Artifacts and click 'setup'. This window waits for the download."
  start "" "https://github.com/%REPO%/actions/runs/%RUN_ID%"
  for /l %%i in (1,1,360) do if not defined SETUP (
    timeout /t 10 /nobreak >nul
    call :findsetup
  )
)
if not defined SETUP ( call :say "ERROR: no installer after 60 minutes (the artifact expires 2026-11-12)." & goto :fail )
call :say "Installer: !SETUP!"

set "PGBIN="
for /d %%d in ("C:\Program Files\PostgreSQL\*") do if exist "%%d\bin\psql.exe" set "PGBIN=%%d\bin"
if not defined PGBIN (
  call :say "No PostgreSQL on this machine: Setup will install its own PostgreSQL 17."
  for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$s=Read-Host 'Choose a password for the new PostgreSQL superuser (postgres)' -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "PGPASSWORD=%%p"
  if not defined PGPASSWORD ( call :say "ERROR: no password entered." & goto :fail )
  call :say "Write this password down: it is needed for backups and future updates."
  set "PGARGS=/PGPORT=%PGPORT% /DBNAME=%DBNAME% /DBUSER=%DBUSER%"
  set "DBEXISTS="
  goto :removeold
)
set "PGARGS=/PGHOST=%PGHOST% /PGPORT=%PGPORT% /DBNAME=%DBNAME% /DBUSER=%DBUSER%"
call :say "PostgreSQL tools: !PGBIN!"

for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$s=Read-Host 'PostgreSQL superuser (postgres) password' -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "PGPASSWORD=%%p"
if not defined PGPASSWORD ( call :say "ERROR: no password entered." & goto :fail )
"!PGBIN!\psql.exe" -h %PGHOST% -p %PGPORT% -U postgres -d postgres -tAc "select 1" >nul 2>>"%LOG%"
if not "!errorlevel!"=="0" ( call :say "ERROR: cannot connect to PostgreSQL as postgres (wrong password or service stopped)." & goto :fail )

set "DBEXISTS="
"!PGBIN!\psql.exe" -h %PGHOST% -p %PGPORT% -U postgres -d postgres -tAc "select 1 from pg_database where datname='%DBNAME%'" > "%TEMP%\sdp-dbexists.txt" 2>>"%LOG%"
set /p DBEXISTS=<"%TEMP%\sdp-dbexists.txt"
del "%TEMP%\sdp-dbexists.txt" >nul 2>&1

rem ---- 2. final backup --------------------------------------------------------
if "!DBEXISTS!"=="1" (
  if not exist "%BACKUPDIR%\final" mkdir "%BACKUPDIR%\final"
  set "DUMP=%BACKUPDIR%\final\%DBNAME%-before-reinstall-%STAMP%.dump"
  call :say "Backing up %DBNAME% to !DUMP! ..."
  "!PGBIN!\pg_dump.exe" -h %PGHOST% -p %PGPORT% -U postgres -Fc -f "!DUMP!" %DBNAME% >>"%LOG%" 2>&1
  if not "!errorlevel!"=="0" ( call :say "ERROR: backup failed - nothing was removed." & goto :fail )
  call :say "Backup OK."
) else (
  call :say "No %DBNAME% database found - nothing to back up."
)
if exist "%APPDIR%\.env" (
  if not exist "%BACKUPDIR%\final" mkdir "%BACKUPDIR%\final"
  copy /Y "%APPDIR%\.env" "%BACKUPDIR%\final\env-before-reinstall-%STAMP%.txt" >nul
  call :say "Old .env saved to %BACKUPDIR%\final (contains secrets - keep it private)."
)

rem ---- 3. remove the old application
:removeold
where pm2 >nul 2>&1
if "!errorlevel!"=="0" (
  call :say "Removing the old pm2 app (endeavour-dashboard)..."
  call pm2 delete endeavour-dashboard >>"%LOG%" 2>&1
  call pm2 save >>"%LOG%" 2>&1
)
sc query SDPDashboard >nul 2>&1
if "!errorlevel!"=="0" ( call :say "Stopping the old SDPDashboard service..." & sc stop SDPDashboard >>"%LOG%" 2>&1 & timeout /t 5 /nobreak >nul )
if exist "%APPDIR%" (
  for %%u in ("%APPDIR%\unins*.exe") do (
    call :say "Running the old uninstaller %%~nxu ..."
    start "" /wait "%%~fu" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
  )
  if exist "%APPDIR%" (
    move "%APPDIR%" "%APPDIR%.old-%STAMP%" >>"%LOG%" 2>&1
    if exist "%APPDIR%" ( call :say "ERROR: could not move %APPDIR% (a file is in use - close it and re-run)." & goto :fail )
    call :say "Old folder kept as %APPDIR%.old-%STAMP% (delete it yourself once the new version is checked)."
  )
)

rem ---- 4. drop the old database (explicit confirmation) ----------------------
if "!DBEXISTS!"=="1" (
  echo.
  echo  The database %DBNAME% and the role %DBUSER% will be DELETED.
  echo  A backup was saved above. fmp_v2 / 4MyPeople is NOT touched.
  set "ANSWER="
  set /p "ANSWER=  Type DROP to continue, anything else to stop: "
  if not "!ANSWER!"=="DROP" ( call :say "Stopped by user before dropping the database. Old app already removed; restore with pg_restore if needed." & goto :fail )
  "!PGBIN!\psql.exe" -h %PGHOST% -p %PGPORT% -U postgres -d postgres -v ON_ERROR_STOP=1 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='%DBNAME%';" -c "DROP DATABASE IF EXISTS %DBNAME%;" -c "DROP ROLE IF EXISTS %DBUSER%;" >>"%LOG%" 2>&1
  if not "!errorlevel!"=="0" ( call :say "ERROR: could not drop %DBNAME% / %DBUSER% - see the log." & goto :fail )
  call :say "Old database and role dropped."
)

rem ---- 5. install the new version --------------------------------------------
call :say "Installing the new version (silent, a few minutes)..."
set "SDP_SETUP_PGSUPERPASS=!PGPASSWORD!"
start "" /wait "!SETUP!" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="%HERE%setup-%STAMP%.log" /DIR="%APPDIR%" /MODE=new /ALLOWUNSIGNED=1 /PORT=%PORT% /BACKUPDIR="%BACKUPDIR%" !PGARGS!
set "RC=!errorlevel!"
set "SDP_SETUP_PGSUPERPASS="
set "PGPASSWORD="
if not "!RC!"=="0" ( call :say "ERROR: Setup exited with code !RC! - see %HERE%setup-%STAMP%.log and %APPDIR%\logs." & goto :fail )

rem ---- 6. health check -------------------------------------------------------
call :say "Checking http://localhost:%PORT%/ ..."
set "OK="
for /l %%i in (1,1,24) do if not defined OK (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://localhost:%PORT%/; if ($r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -lt 500) { exit 0 }; exit 1 }"
  if "!errorlevel!"=="0" ( set "OK=1" ) else ( timeout /t 5 /nobreak >nul )
)
if not defined OK ( call :say "ERROR: the dashboard does not answer on port %PORT% after 2 minutes - see %APPDIR%\logs." & goto :fail )

for /f "tokens=1,* delims==" %%a in ('findstr /B "DASH_USER=" "%APPDIR%\.env" 2^>nul') do set "ADMINUSER=%%b"
call :say "DONE. Open http://localhost:%PORT%/ on this machine."
if defined ADMINUSER call :say "First admin user: !ADMINUSER! (password: DASH_PASS in %APPDIR%\.env - change it after the first login)."
call :say "Final backup of the old data: %BACKUPDIR%\final"
echo.
pause
endlocal & exit /b 0

:fail
set "PGPASSWORD="
set "SDP_SETUP_PGSUPERPASS="
call :say "FAILED - nothing further was done. Log: %LOG%"
echo.
pause
endlocal & exit /b 1

:findsetup
set "SETUP="
for %%f in ("%HERE%SDP-Dashboard-Setup-*.exe") do set "SETUP=%%~ff"
if not defined SETUP if exist "%HERE%setup" for /r "%HERE%setup" %%f in (SDP-Dashboard-Setup-*.exe) do set "SETUP=%%~ff"
if not defined SETUP for %%f in ("%DL%\SDP-Dashboard-Setup-*.exe") do set "SETUP=%%~ff"
if not defined SETUP for %%z in ("%DL%\setup*.zip") do (
  powershell -NoProfile -Command "try { Expand-Archive -Force -LiteralPath '%%~fz' -DestinationPath '%HERE%setup'; exit 0 } catch { exit 1 }" >nul 2>&1
  if exist "%HERE%setup" for /r "%HERE%setup" %%f in (SDP-Dashboard-Setup-*.exe) do set "SETUP=%%~ff"
)
exit /b 0

:say
echo %~1
>>"%LOG%" echo [%date% %time%] %~1
exit /b 0
