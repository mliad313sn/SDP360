@echo off
title Prepare Colleague Package — Endeavour IT Dashboard
color 0B
setlocal

echo.
echo  ╔══════════════════════════════════════════════════════════════╗
echo  ║   Endeavour Mining — Prepare Sharing Package                 ║
echo  ║   This creates a ZIP you can send to your colleague          ║
echo  ╚══════════════════════════════════════════════════════════════╝
echo.

:: ── Check .env exists ──────────────────────────────────────────────────────
if not exist ".env" (
    echo  [!] ERROR: .env file not found in this folder.
    echo      Your colleague needs your credentials to connect to Analytics Plus.
    echo      Please make sure .env exists before packaging.
    echo.
    pause
    exit /b 1
)

set "ZIPNAME=Endeavour_IT_Dashboard_SHARE.zip"
set "TMPDIR=%TEMP%\endeavour_pkg_tmp"
set "PS1=%TEMP%\prepare_pkg.ps1"

echo  [1/4] Cleaning up old files...
if exist "%ZIPNAME%" del /f /q "%ZIPNAME%"
if exist "%TMPDIR%" rd /s /q "%TMPDIR%"

echo  [2/4] Writing build script...

:: Write the PowerShell script to a temp file (avoids multiline BAT issues)
(
echo $src  = '%CD%'
echo $tmp  = '%TMPDIR%'
echo $zip  = '%CD%\%ZIPNAME%'
echo.
echo # Files and folders to include
echo $include = @(
echo   'server.js',
echo   'package.json',
echo   'Dockerfile',
echo   'docker-compose.yml',
echo   '.env',
echo   'START.bat',
echo   'stop.bat',
echo   'COLLEAGUE_README.txt'
echo ^)
echo $includeDirs = @('public', 'data'^)
echo.
echo # Create temp staging folder
echo New-Item -ItemType Directory -Force -Path $tmp ^| Out-Null
echo.
echo # Copy individual files (skip if they don't exist^)
echo foreach ($f in $include^) {
echo   $fp = Join-Path $src $f
echo   if (Test-Path $fp^) {
echo     Copy-Item $fp $tmp -Force
echo   }
echo }
echo.
echo # Copy folders (skip if they don't exist^)
echo foreach ($d in $includeDirs^) {
echo   $dp = Join-Path $src $d
echo   if (Test-Path $dp^) {
echo     Copy-Item $dp (Join-Path $tmp $d^) -Recurse -Force
echo   }
echo }
echo.
echo # Also copy package-lock.json if it exists
echo $pl = Join-Path $src 'package-lock.json'
echo if (Test-Path $pl^) { Copy-Item $pl $tmp -Force }
echo.
echo # Zip the staging folder
echo Compress-Archive -Path "$tmp\*" -DestinationPath $zip -Force
echo.
echo # Cleanup staging folder
echo Remove-Item $tmp -Recurse -Force
echo.
echo Write-Host 'ZIP created successfully.'
) > "%PS1%"

echo  [3/4] Creating ZIP package...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"

if errorlevel 1 (
    echo.
    echo  [!] ERROR: Failed to create ZIP.
    echo      Make sure PowerShell is available and try again.
    del /f /q "%PS1%" 2>nul
    pause
    exit /b 1
)

del /f /q "%PS1%" 2>nul

echo  [4/4] Done!
echo.
echo  ╔══════════════════════════════════════════════════════════════╗
echo  ║  Package ready:  %ZIPNAME%
echo  ║                                                              ║
echo  ║  SEND THIS FILE to your colleague.                           ║
echo  ║  They only need to:                                          ║
echo  ║    1. Unzip anywhere (e.g. C:\endeavour-dashboard^)           ║
echo  ║    2. Double-click  START.bat                                ║
echo  ║    (Docker installs automatically if needed^)                 ║
echo  ╚══════════════════════════════════════════════════════════════╝
echo.

:: Open folder so you can see and grab the ZIP
explorer .

pause
