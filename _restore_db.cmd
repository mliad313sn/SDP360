@echo off
rem ─────────────────────────────────────────────────────────────────────
rem  Guided restore of a SQLite DB from data\backups\.
rem
rem  Walks the operator through:
rem    1. Picking which DB to restore (tracker / inspection / meetings)
rem    2. Picking which backup file (lists them, newest first)
rem    3. Stops pm2
rem    4. Creates a safety copy of the current state
rem    5. Copies the chosen backup over the live DB
rem    6. Clears the WAL files
rem    7. Restarts pm2 + tails logs
rem
rem  Run from C:\Apps\SDP-Dashboard\ on the prod host, in cmd.exe as admin.
rem  No arguments — fully interactive.
rem
rem  Full background on the recovery procedure is in docs\DB_RECOVERY.md.
rem ─────────────────────────────────────────────────────────────────────

setlocal EnableDelayedExpansion

if not exist "data\backups\" (
  echo.
  echo No backups directory found at data\backups\.
  echo Nothing has been backed up yet — there's nothing to restore.
  exit /b 1
)

echo.
echo ═══════════════════════════════════════════════════════════════
echo   SDP-Dashboard — Guided DB Restore
echo ═══════════════════════════════════════════════════════════════
echo.
echo This will:
echo   1. Stop the dashboard (pm2 stop)
echo   2. Copy the current live DB aside as a safety net
echo   3. Replace the live DB with a backup of your choice
echo   4. Restart the dashboard
echo.
echo You can cancel at any prompt by pressing Ctrl+C.
echo.

rem ── Step 1: Pick which DB to restore ────────────────────────────
echo Which database do you want to restore?
echo   [1] tracker.db     (Activity Tracker)
echo   [2] inspection.db  (IT Inspections)
echo   [3] meetings.db    (Meetings ^& Council)
echo.
set /p DBCHOICE="Enter 1, 2 or 3: "

if "%DBCHOICE%"=="1" set DBNAME=tracker
if "%DBCHOICE%"=="2" set DBNAME=inspection
if "%DBCHOICE%"=="3" set DBNAME=meetings

if not defined DBNAME (
  echo.
  echo Invalid choice. Aborting.
  exit /b 1
)
set DBFILE=%DBNAME%.db

if not exist "%DBFILE%" (
  echo.
  echo WARNING: %DBFILE% does not exist at the current path.
  echo You may be running this from the wrong directory.
  echo Expected: C:\Apps\SDP-Dashboard\
  echo Current:  %CD%
  echo.
  set /p PROCEED="Continue anyway? (y/N): "
  if /i not "!PROCEED!"=="y" exit /b 1
)

rem ── Step 2: List backups for that DB, newest first ──────────────
echo.
echo ─────────────────────────────────────────────────────────────
echo Available backups for %DBNAME%.db (newest first):
echo ─────────────────────────────────────────────────────────────
dir /B /O-D "data\backups\%DBNAME%-*.db" 2>nul
if errorlevel 1 (
  echo No backups found for %DBNAME%.db.
  echo Aborting — nothing to restore from.
  exit /b 1
)
echo.
set /p BAKFILE="Paste the filename you want to restore from: "

if not exist "data\backups\%BAKFILE%" (
  echo.
  echo File not found: data\backups\%BAKFILE%
  echo Check the spelling and try again.
  exit /b 1
)

rem ── Step 3: Confirm before doing anything destructive ───────────
echo.
echo ─────────────────────────────────────────────────────────────
echo You are about to:
echo   - Stop pm2  endeavour-dashboard
echo   - Replace   %CD%\%DBFILE%
echo   - With      %CD%\data\backups\%BAKFILE%
echo   - Restart   pm2  endeavour-dashboard
echo.
echo A safety copy of the CURRENT %DBFILE% will be saved to
echo   data\backups\BEFORE-RESTORE-%DBNAME%-%RANDOM%.db
echo so you can roll BACK the restore if you pick the wrong file.
echo ─────────────────────────────────────────────────────────────
echo.
set /p CONFIRM="Proceed? Type YES to continue: "
if not "%CONFIRM%"=="YES" (
  echo.
  echo Cancelled. No changes made.
  exit /b 0
)

rem ── Step 4: Stop pm2 ────────────────────────────────────────────
echo.
echo Stopping pm2 endeavour-dashboard...
call pm2 stop endeavour-dashboard
if errorlevel 1 (
  echo.
  echo Could not stop pm2. Is it running? Is pm2 on PATH?
  echo Aborting — no changes made.
  exit /b 1
)

rem ── Step 5: Safety copy ─────────────────────────────────────────
set SAFETY=data\backups\BEFORE-RESTORE-%DBNAME%-%RANDOM%.db
if exist "%DBFILE%" (
  copy /Y "%DBFILE%" "%SAFETY%" >nul
  if errorlevel 1 (
    echo.
    echo Could not create safety copy at %SAFETY%.
    echo Aborting — no changes made. Restarting pm2.
    call pm2 start endeavour-dashboard
    exit /b 1
  )
  echo  ^>  Safety copy saved: %SAFETY%
)

rem ── Step 6: Restore ─────────────────────────────────────────────
copy /Y "data\backups\%BAKFILE%" "%DBFILE%" >nul
if errorlevel 1 (
  echo.
  echo Restore failed during copy. Trying to roll back safety copy...
  if exist "%SAFETY%" copy /Y "%SAFETY%" "%DBFILE%" >nul
  call pm2 start endeavour-dashboard
  exit /b 1
)
echo  ^>  %DBFILE% replaced with %BAKFILE%

rem ── Step 7: Clear WAL files ─────────────────────────────────────
if exist "%DBFILE%-shm" del /Q "%DBFILE%-shm" 2>nul
if exist "%DBFILE%-wal" del /Q "%DBFILE%-wal" 2>nul
echo  ^>  Cleared %DBFILE%-shm and %DBFILE%-wal

rem ── Step 8: Restart pm2 ─────────────────────────────────────────
echo.
echo Restarting pm2 endeavour-dashboard...
call pm2 start endeavour-dashboard
if errorlevel 1 (
  echo.
  echo Could not restart pm2. Investigate manually:
  echo   pm2 logs endeavour-dashboard --lines 30
  exit /b 1
)

rem ── Step 9: Tail logs briefly ───────────────────────────────────
echo.
echo ─── Recent logs ──────────────────────────────────────────────
call pm2 logs endeavour-dashboard --lines 12 --nostream

echo.
echo ═══════════════════════════════════════════════════════════════
echo   Restore complete.
echo ═══════════════════════════════════════════════════════════════
echo.
echo Next steps:
echo   1. Hard-refresh the dashboard in your browser (Ctrl+Shift+R)
echo   2. Verify the restored data appears as expected
echo   3. If anything looks wrong, run this script again and pick
echo      the safety copy: %SAFETY%
echo      (that puts you back to the state BEFORE this restore)
echo.
endlocal
exit /b 0
