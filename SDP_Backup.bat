@echo off
:: ============================================================
:: SDP Dashboard — Weekly Backup Script  (v2 — uses robocopy)
:: Backs up:
::   C:\Apps\SDP-Dashboard\            (production server)
::   C:\Users\Admin\Documents\SDP-Dashboard\  (source / dev)
:: Excludes: node_modules
:: Keeps last 8 weekly backups (~2 months)
:: Schedule: Every Friday at 18:00 via Windows Task Scheduler
:: ============================================================

set SOURCE_PROD=C:\Apps\SDP-Dashboard
set SOURCE_DEV=C:\Users\Admin\Documents\SDP-Dashboard
set BACKUP_ROOT=C:\Backups\SDP-Dashboard

:: ── Date stamp (WMIC — reliable YYYY-MM-DD regardless of locale) ─────────
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set DATETIME=%%I
set BDATE=%DATETIME:~0,4%-%DATETIME:~4,2%-%DATETIME:~6,2%
set DEST=%BACKUP_ROOT%\%BDATE%
set LOG=%BACKUP_ROOT%\backup.log

:: ── Create folders ────────────────────────────────────────────────────────
if not exist "%BACKUP_ROOT%" mkdir "%BACKUP_ROOT%"
if not exist "%DEST%"        mkdir "%DEST%"

:: ── Log header ────────────────────────────────────────────────────────────
echo. >> "%LOG%"
echo ============================================================ >> "%LOG%"
echo [%date% %time%] Backup started >> "%LOG%"
echo Destination: %DEST% >> "%LOG%"

echo.
echo  SDP Dashboard Backup
echo  ====================
echo  Destination : %DEST%
echo  Log file    : %LOG%
echo.

:: ── 1. Production server ─────────────────────────────────────────────────
echo [1/2] Backing up production server (C:\Apps\SDP-Dashboard)...
echo [1/2] Production server backup >> "%LOG%"

robocopy "%SOURCE_PROD%" "%DEST%\Apps-production" ^
  /E ^
  /XD node_modules ^
  /NFL /NDL /NJH /NJS ^
  /LOG+:"%LOG%"

:: robocopy exit codes 0-7 = success / informational (not errors)
if %ERRORLEVEL% LSS 8 (
    echo [OK] Production backup complete
    echo [OK] Production backup complete >> "%LOG%"
) else (
    echo [WARNING] Production backup reported errors - check %LOG%
    echo [WARNING] Production backup ERRORS >> "%LOG%"
)

:: ── 2. Documents source folder ────────────────────────────────────────────
echo.
echo [2/2] Backing up Documents source (C:\Users\Admin\Documents\SDP-Dashboard)...
echo [2/2] Documents source backup >> "%LOG%"

robocopy "%SOURCE_DEV%" "%DEST%\Documents-source" ^
  /E ^
  /XD node_modules ^
  /NFL /NDL /NJH /NJS ^
  /LOG+:"%LOG%"

if %ERRORLEVEL% LSS 8 (
    echo [OK] Documents source backup complete
    echo [OK] Documents source backup complete >> "%LOG%"
) else (
    echo [WARNING] Documents source backup reported errors - check %LOG%
    echo [WARNING] Documents source backup ERRORS >> "%LOG%"
)

:: ── Summary ───────────────────────────────────────────────────────────────
echo.
echo  Contents of %DEST%:
dir "%DEST%" /B
echo.

:: ── Rotation: keep only the 8 most recent backup folders ─────────────────
echo  Cleaning old backups (keeping last 8)...
echo Cleaning old backups >> "%LOG%"
for /f "skip=8 delims=" %%F in ('dir "%BACKUP_ROOT%" /AD /B /O-D 2^>nul') do (
    echo   Removing: %%F
    echo Removed old backup: %%F >> "%LOG%"
    rd /S /Q "%BACKUP_ROOT%\%%F"
)

:: ── Done ──────────────────────────────────────────────────────────────────
echo.
echo [%date% %time%] Backup complete. Saved to: %DEST%
echo [%date% %time%] Backup complete >> "%LOG%"
