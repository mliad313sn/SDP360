@echo off
rem ============================================================
rem  _backup_prod.cmd
rem  Snapshot of the 4 production SQLite DBs + .env.
rem  AUTO-DETECTS dev box vs prod execution context:
rem    - On prod (RDP): copies from C:\Apps\SDP-Dashboard\
rem      to C:\Apps\SDP-Dashboard-Backups\<timestamp>\
rem    - On dev box: copies from Z:\ to C:\Apps\SDP-Dashboard-Backups
rem      ON PROD (writes happen on the prod machine if you scheduled
rem      from dev, BUT that path doesn't exist on dev — so prefer
rem      running this script via RDP on prod).
rem
rem  RECOMMENDED USAGE:
rem    1) From the dev box: xcopy _backup_prod.cmd Z:\ /Y
rem    2) RDP into the prod server
rem    3) cd C:\Apps\SDP-Dashboard
rem    4) _backup_prod.cmd
rem
rem  pm2 does NOT need to be stopped — better-sqlite3 WAL mode lets
rem  us snapshot a consistent state by copying .db + -wal + -shm.
rem
rem  Author: Claude — 2026-06-05
rem ============================================================
setlocal enabledelayedexpansion

rem --- Auto-detect context ------------------------------------
if exist "C:\Apps\SDP-Dashboard\server.js" (
  rem We are likely running ON the prod server.
  set "PROD_ROOT=C:\Apps\SDP-Dashboard\"
  set "BACKUP_ROOT=C:\Apps\SDP-Dashboard-Backups"
  set "CONTEXT=PROD (running on prod server)"
) else if exist "Z:\server.js" (
  rem We are on the dev box, prod mounted as Z:\.
  set "PROD_ROOT=Z:\"
  rem WARNING: this backup folder is on the DEV box. Sub-optimal.
  set "BACKUP_ROOT=C:\Users\%USERNAME%\Documents\SDP-Dashboard-Backups-FromDev"
  set "CONTEXT=DEV box (writes backup locally on DEV, NOT prod)"
) else (
  echo ERROR: cannot find SDP-Dashboard installation.
  echo Tried: C:\Apps\SDP-Dashboard\ and Z:\
  echo If running from dev, ensure Z: is mapped:
  echo     net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes
  exit /b 1
)

rem --- Timestamp YYYY-MM-DD_HHMMSS ----------------------------
for /f "tokens=2 delims==." %%I in ('wmic os get localdatetime /value ^| find "="') do set DT=%%I
set "STAMP=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%_%DT:~8,2%%DT:~10,2%%DT:~12,2%"
set "DEST=%BACKUP_ROOT%\%STAMP%"

echo.
echo ============================================================
echo  Production DB snapshot
echo ============================================================
echo Context: %CONTEXT%
echo Source : %PROD_ROOT%
echo Dest   : %DEST%
echo.

if /i "%CONTEXT%"=="DEV box (writes backup locally on DEV, NOT prod)" (
  echo WARNING: this writes the backup to YOUR DEV BOX, not the prod server.
  echo          Recommended: copy this script to Z:\ and run via RDP on prod.
  echo.
  set /p OK="Continue anyway? Type YES to proceed: "
  if /i not "!OK!"=="YES" (
    echo Aborted. Re-run via RDP on prod for the proper flow.
    exit /b 0
  )
)

mkdir "%DEST%" 2>nul
mkdir "%DEST%\data" 2>nul

rem --- reports.db lives in data\ ------------------------------
echo Snapshotting reports.db ...
if exist "%PROD_ROOT%data\reports.db" (
  copy /Y "%PROD_ROOT%data\reports.db"     "%DEST%\data\reports.db"     >nul && echo   ^>  data\reports.db
  if exist "%PROD_ROOT%data\reports.db-wal" copy /Y "%PROD_ROOT%data\reports.db-wal" "%DEST%\data\reports.db-wal" >nul && echo   ^>  data\reports.db-wal
  if exist "%PROD_ROOT%data\reports.db-shm" copy /Y "%PROD_ROOT%data\reports.db-shm" "%DEST%\data\reports.db-shm" >nul && echo   ^>  data\reports.db-shm
) else (
  echo   WARNING: data\reports.db not found at %PROD_ROOT%data\
)

rem --- Other 3 DBs at the root --------------------------------
echo.
for %%D in (tracker inspection meetings) do (
  if exist "%PROD_ROOT%%%D.db" (
    copy /Y "%PROD_ROOT%%%D.db"     "%DEST%\%%D.db"     >nul && echo   ^>  %%D.db
    if exist "%PROD_ROOT%%%D.db-wal" copy /Y "%PROD_ROOT%%%D.db-wal" "%DEST%\%%D.db-wal" >nul && echo   ^>  %%D.db-wal
    if exist "%PROD_ROOT%%%D.db-shm" copy /Y "%PROD_ROOT%%%D.db-shm" "%DEST%\%%D.db-shm" >nul && echo   ^>  %%D.db-shm
  ) else (
    echo   WARNING: %%D.db not found at %PROD_ROOT%
  )
)

rem --- .env (secrets — invaluable!) ---------------------------
echo.
if exist "%PROD_ROOT%.env" (
  copy /Y "%PROD_ROOT%.env" "%DEST%\.env" >nul && echo   ^>  .env (KEEP THIS SAFE!)
) else (
  echo   NOTE: %PROD_ROOT%.env not found.
)

rem --- Summary -------------------------------------------------
echo.
echo ============================================================
echo Snapshot complete. Verify sizes (each .db should be ^> 0 KB):
echo ============================================================
dir "%DEST%\*.db" 2>nul | findstr ".db"
dir "%DEST%\data\*.db" 2>nul | findstr ".db"
echo.
echo Backup folder: %DEST%
echo.
echo Restore (only if needed):
echo   1) pm2 stop endeavour-dashboard
echo   2) copy backup files back to %PROD_ROOT% preserving the data\ subfolder
echo   3) pm2 start endeavour-dashboard
echo.
endlocal
