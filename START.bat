@echo off
title Endeavour Mining — IT Dashboard
color 0A
setlocal EnableDelayedExpansion

echo.
echo  ╔══════════════════════════════════════════════════════════════╗
echo  ║       Endeavour Mining — IT Executive Dashboard              ║
echo  ║       Starting up... please wait                             ║
echo  ╚══════════════════════════════════════════════════════════════╝
echo.

:: ── STEP 1: Check .env ─────────────────────────────────────────────────────
if not exist ".env" (
    echo  [!] Missing credentials file (.env^).
    echo      This file should have been included in the package.
    echo      Please contact the person who sent you this package.
    echo.
    pause
    exit /b 1
)

:: ── STEP 2: Check if Docker Desktop is installed ───────────────────────────
where docker >nul 2>&1
if errorlevel 1 (
    echo  [!] Docker Desktop is not installed on this computer.
    echo.
    echo  Docker Desktop is a free tool required to run the dashboard.
    echo  Installation takes about 5 minutes.
    echo.

    :: Try winget auto-install (Windows 10/11)
    where winget >nul 2>&1
    if not errorlevel 1 (
        echo  Installing Docker Desktop automatically. This takes 3-5 minutes...
        echo.
        winget install -e --id Docker.DockerDesktop --silent --accept-package-agreements --accept-source-agreements
        if errorlevel 1 goto MANUAL_DOCKER
        echo.
        echo  ✓ Docker Desktop installed!
        echo.
        echo  NEXT STEP: Open Docker Desktop from your Start Menu,
        echo  wait for the whale icon in the system tray to stop animating,
        echo  then run START.bat again.
        echo.
        pause
        exit /b 0
    )

    :MANUAL_DOCKER
    echo  Please install Docker Desktop manually:
    echo.
    echo    1. Go to:  https://www.docker.com/products/docker-desktop
    echo    2. Download and install (free^)
    echo    3. Open Docker Desktop from Start Menu
    echo    4. Wait for the whale icon in system tray to stop animating
    echo    5. Run START.bat again
    echo.
    start https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

:: ── STEP 3: Check if Docker Engine is running, auto-start if not ───────────
echo  [1/4] Checking Docker...
docker info >nul 2>&1
if errorlevel 1 (
    echo  Docker Desktop is not running — starting it automatically...

    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" 2>nul
    if errorlevel 1 (
        start "" "%LOCALAPPDATA%\Docker\Docker Desktop.exe" 2>nul
    )

    echo  Waiting for Docker to start (up to 60 seconds^)...
    set /a WAIT=0
    :WAIT_LOOP
    timeout /t 5 /nobreak >nul
    docker info >nul 2>&1
    if not errorlevel 1 goto DOCKER_READY
    set /a WAIT+=5
    if !WAIT! GEQ 60 (
        echo.
        echo  [!] Docker is taking too long. Please open Docker Desktop manually,
        echo      wait for the whale icon to stop animating, then run START.bat again.
        pause
        exit /b 1
    )
    echo  Still waiting... (!WAIT!s / 60s^)
    goto WAIT_LOOP
)

:DOCKER_READY
echo  Docker is running. ✓
echo.

:: ── STEP 4: Build image ────────────────────────────────────────────────────
echo  [2/4] Building image (first run takes ~2 minutes, subsequent runs are instant^)...
docker compose build --quiet 2>&1
if errorlevel 1 (
    echo.
    echo  [!] Build failed. Check your internet connection and try again.
    pause
    exit /b 1
)
echo  Image ready. ✓
echo.

:: ── STEP 5: Start container ────────────────────────────────────────────────
echo  [3/4] Starting dashboard service...
docker compose up -d 2>&1
if errorlevel 1 (
    echo.
    echo  [!] Could not start the dashboard.
    echo      Port 3456 may already be in use. Run stop.bat first, then try again.
    pause
    exit /b 1
)
echo  Service started. ✓
echo.

:: ── STEP 6: Wait for server ready ──────────────────────────────────────────
echo  [4/4] Waiting for server to be ready...
set /a TRIES=0
:HEALTH_LOOP
timeout /t 3 /nobreak >nul
curl -s -o nul -w "%%{http_code}" http://localhost:3456/health 2>nul | findstr "200" >nul
if not errorlevel 1 goto SERVER_READY
set /a TRIES+=1
if !TRIES! GEQ 10 goto OPEN_BROWSER
goto HEALTH_LOOP

:SERVER_READY
echo  Server is ready. ✓
echo.

:OPEN_BROWSER
echo  ╔══════════════════════════════════════════════════════════════╗
echo  ║   Dashboard is LIVE at:  http://localhost:3456               ║
echo  ║   Opening browser now...                                     ║
echo  ║                                                              ║
echo  ║   To stop the dashboard later, run:  stop.bat                ║
echo  ╚══════════════════════════════════════════════════════════════╝
echo.

start http://localhost:3456/executive.html
pause
