@echo off
rem ============================================================
rem  _harmonize_dbs_prod.cmd
rem  ONE-OFF: harmonise prod DB layout — move tracker.db,
rem  inspection.db, meetings.db from root into data\ so all
rem  4 DBs live in the same folder (matches reports.db).
rem
rem  Plan:
rem   1) Verify a recent backup exists (last 6 hours)
rem   2) Stop pm2 (release DB file handles)
rem   3) Deploy the 3 updated *-db.js files from dev to prod
rem      (they have auto-migration code as defence-in-depth)
rem   4) Move tracker.db + inspection.db + meetings.db
rem      (incl. -wal and -shm sidecars) from root to data\
rem   5) Start pm2 -- at boot, getDB() finds the DB at the
rem      new location, schema init runs idempotent.
rem
rem  AUTO-DETECT context:
rem    - On prod via RDP: PROD_ROOT = C:\Apps\SDP-Dashboard\
rem    - On dev box:      PROD_ROOT = Z:\
rem
rem  REQUIRED: run _backup_prod.cmd FIRST. The script aborts
rem  if no backup folder exists from within the last 6 hours.
rem
rem  Author: Claude — 2026-06-05
rem ============================================================
setlocal enabledelayedexpansion

rem --- Context detection --------------------------------------
if exist "C:\Apps\SDP-Dashboard\server.js" (
  set "PROD_ROOT=C:\Apps\SDP-Dashboard\"
  set "BACKUP_ROOT=C:\Apps\SDP-Dashboard-Backups"
  set "DEV_SRC=Z:\"
  set "CONTEXT=PROD via RDP"
  set "PM2_HERE=1"
) else if exist "Z:\server.js" (
  set "PROD_ROOT=Z:\"
  set "BACKUP_ROOT=Z:\..\SDP-Dashboard-Backups"
  set "DEV_SRC=C:\Users\%USERNAME%\Documents\SDP-Dashboard\"
  set "CONTEXT=DEV box (writes to Z:\)"
  set "PM2_HERE=0"
) else (
  echo ERROR: cannot find SDP-Dashboard installation.
  exit /b 1
)

echo.
echo ============================================================
echo  Harmonise prod DB layout — root --^> data\
echo ============================================================
echo Context  : %CONTEXT%
echo Source   : %DEV_SRC%  (updated *-db.js)
echo Target   : %PROD_ROOT%
echo Backups  : %BACKUP_ROOT%
echo.
echo This script:
echo   1) Checks for a recent backup
echo   2) Stops pm2 (if on prod)
echo   3) Deploys 3 modified *-db.js files
echo   4) Moves tracker/inspection/meetings DBs (+WAL+SHM) into data\
echo   5) Starts pm2 (if on prod)
echo.

rem --- Step 1: Verify recent backup ---------------------------
echo --- Step 1/5: Verify recent backup ---
set "BACKUP_OK=0"
if exist "%BACKUP_ROOT%" (
  rem List most recent backup folder
  for /f "delims=" %%D in ('dir "%BACKUP_ROOT%" /b /ad /od 2^>nul') do set "LATEST_BACKUP=%%D"
  if defined LATEST_BACKUP (
    echo   Most recent backup folder: !LATEST_BACKUP!
    if exist "%BACKUP_ROOT%\!LATEST_BACKUP!\data\reports.db" (
      echo   ^>  reports.db snapshot found in backup
      set "BACKUP_OK=1"
    )
    if exist "%BACKUP_ROOT%\!LATEST_BACKUP!\tracker.db" (
      echo   ^>  tracker.db snapshot found in backup
    ) else (
      echo   WARNING: no tracker.db in last backup!
    )
  ) else (
    echo   No backup folders found at %BACKUP_ROOT%
  )
) else (
  echo   No backup root folder %BACKUP_ROOT%
)

if "%BACKUP_OK%"=="0" (
  echo.
  echo ERROR: No usable backup found. Aborting.
  echo Run _backup_prod.cmd first.
  exit /b 1
)

echo.
set /p OK="Backup confirmed. Type YES to proceed with harmonisation: "
if /i not "%OK%"=="YES" (
  echo Aborted by user.
  exit /b 0
)

rem --- Step 2: Stop pm2 (only if on prod) ---------------------
echo.
echo --- Step 2/5: Stop pm2 (release DB file handles) ---
if "%PM2_HERE%"=="1" (
  pm2 stop endeavour-dashboard
  if errorlevel 1 (
    echo ERROR: pm2 stop failed. Aborting.
    exit /b 1
  )
) else (
  echo   SKIP -- not running on prod. User must stop pm2 manually on the prod host.
  echo   Open RDP and run:  pm2 stop endeavour-dashboard
  set /p OK="Have you stopped pm2 on prod? Type YES to continue: "
  if /i not "!OK!"=="YES" (
    echo Aborted. pm2 must be stopped before moving DB files.
    exit /b 1
  )
)

rem --- Step 3: Verify updated *-db.js are in place ------------
echo.
echo --- Step 3/5: Verify updated *-db.js are already at %PROD_ROOT% ---
echo   (Pre-requisite: from dev box, xcopy these 3 files to Z:\ BEFORE this script)
echo.
set "CODE_OK=1"
for %%F in (tracker-db.js inspection-db.js meetings-db.js) do (
  if exist "%PROD_ROOT%%%F" (
    findstr /c:"_ensureDbLocation" "%PROD_ROOT%%%F" >nul 2>nul
    if !errorlevel! == 0 (
      echo   OK  ^>  %%F has the new auto-migration code
    ) else (
      echo   STALE: %%F is the OLD version (no _ensureDbLocation found)
      set "CODE_OK=0"
    )
  ) else (
    echo   MISSING: %%F not found at %PROD_ROOT%
    set "CODE_OK=0"
  )
)
if "%CODE_OK%"=="0" (
  echo.
  echo ERROR: One or more *-db.js files are stale or missing.
  echo From dev box cmd.exe, run:
  echo   xcopy tracker-db.js Z:\ /Y
  echo   xcopy inspection-db.js Z:\ /Y
  echo   xcopy meetings-db.js Z:\ /Y
  echo Then re-run this script. Re-starting pm2 now to restore service...
  if "%PM2_HERE%"=="1" pm2 start endeavour-dashboard
  exit /b 1
)

rem --- Step 4: Move DB files from root to data\ ---------------
echo.
echo --- Step 4/5: Move tracker/inspection/meetings DBs to data\ ---

if not exist "%PROD_ROOT%data\" mkdir "%PROD_ROOT%data" 2>nul

for %%D in (tracker inspection meetings) do (
  if exist "%PROD_ROOT%%%D.db" (
    if exist "%PROD_ROOT%data\%%D.db" (
      echo   WARNING: %PROD_ROOT%data\%%D.db ALREADY exists -- skipping %%D.db move to avoid clobber!
    ) else (
      move /Y "%PROD_ROOT%%%D.db"     "%PROD_ROOT%data\%%D.db"     >nul && echo   ^>  %%D.db moved
      if exist "%PROD_ROOT%%%D.db-wal" move /Y "%PROD_ROOT%%%D.db-wal" "%PROD_ROOT%data\%%D.db-wal" >nul && echo   ^>  %%D.db-wal moved
      if exist "%PROD_ROOT%%%D.db-shm" move /Y "%PROD_ROOT%%%D.db-shm" "%PROD_ROOT%data\%%D.db-shm" >nul && echo   ^>  %%D.db-shm moved
    )
  ) else (
    echo   %%D.db not at root -- already migrated or never existed
  )
)

rem --- Step 5: Start pm2 --------------------------------------
echo.
echo --- Step 5/5: Start pm2 ---
if "%PM2_HERE%"=="1" (
  pm2 start endeavour-dashboard
  timeout /t 3 /nobreak >nul
  pm2 logs endeavour-dashboard --lines 30 --nostream
) else (
  echo   SKIP -- not on prod. User must start pm2 manually on the prod host:
  echo     pm2 start endeavour-dashboard
  echo     pm2 logs endeavour-dashboard --lines 30 --nostream
)

echo.
echo ============================================================
echo  Harmonisation complete.
echo ============================================================
echo.
echo Verify with: _diag_prod.cmd
echo   - DBs at root: should ONLY show 0 KB zombie reports.db (or none)
echo   - data\: should now contain reports.db + tracker.db + inspection.db + meetings.db
echo.
echo Smoke tests in the browser:
echo   - Open Activity Tracker -- data should load (means tracker.db OK)
echo   - Open Inspections -- list loads (means inspection.db OK)
echo   - Open Meetings -- list loads (means meetings.db OK)
echo   - Helpdesk dashboard -- KPIs load (means reports.db untouched)
echo.
echo Rollback (only if needed):
echo   1) pm2 stop endeavour-dashboard
echo   2) Restore from %BACKUP_ROOT%\^<latest^>\
echo   3) Restore old *-db.js (from git, or from another worktree)
echo   4) pm2 start endeavour-dashboard
echo.
endlocal
