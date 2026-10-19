@echo off
:: ============================================================
:: SDP Dashboard — Weekly Backup Script
:: Backs up: entire C:\Apps\SDP-Dashboard\ except node_modules
:: Keeps last 8 weekly backups (~2 months)
:: Schedule: Every Friday at 18:00 via Windows Task Scheduler
:: ============================================================

set SOURCE=C:\Apps\SDP-Dashboard
set BACKUP_ROOT=C:\Backups\SDP-Dashboard

:: Create dated folder — use WMIC for reliable YYYY-MM-DD format regardless of regional settings
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set DATETIME=%%I
set BDATE=%DATETIME:~0,4%-%DATETIME:~4,2%-%DATETIME:~6,2%
set DEST=%BACKUP_ROOT%\%BDATE%

echo [%date% %time%] Starting SDP Dashboard backup...
echo Destination: %DEST%

:: Create exclusions file (skip node_modules and the backups folder itself)
set EXCL=%TEMP%\sdp_backup_excl.txt
echo node_modules\ > "%EXCL%"
echo backups\ >> "%EXCL%"

:: Create backup destination
if not exist "%BACKUP_ROOT%" mkdir "%BACKUP_ROOT%"
if not exist "%DEST%" mkdir "%DEST%"

:: Copy everything except excluded folders
xcopy "%SOURCE%\*" "%DEST%\" /E /I /Y /Q /EXCLUDE:"%EXCL%" >nul
echo [OK] Full backup complete (excluding node_modules)

:: Clean up temp file
del "%EXCL%" >nul 2>&1

:: Show summary
echo.
echo Contents of %DEST%:
dir "%DEST%" /B

:: Clean up — keep only the 8 most recent backups
echo.
echo Cleaning old backups (keeping last 8)...
for /f "skip=8 delims=" %%F in ('dir "%BACKUP_ROOT%" /AD /B /O-D 2^>nul') do (
    echo Removing old backup: %%F
    rd /S /Q "%BACKUP_ROOT%\%%F"
)

echo.
echo [%date% %time%] Backup complete.
echo Backup saved to: %DEST%
