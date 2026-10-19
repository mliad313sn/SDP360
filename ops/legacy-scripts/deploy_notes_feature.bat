@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM  Deploy: Notes Persistence Feature
REM  Run this ONCE from C:\Users\Admin\Documents\SDP-Dashboard\
REM  (or double-click it from Windows Explorer)
REM ─────────────────────────────────────────────────────────────────────────────

set DOCKER_DIR=C:\endeavour-dashboard

echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║   Deploying Notes Persistence Feature                   ║
echo ╚══════════════════════════════════════════════════════════╝
echo.

echo [1/5] Copying server.js ...
copy /Y "%~dp0server.js" "%DOCKER_DIR%\server.js"

echo [2/5] Copying index.html ...
copy /Y "%~dp0public\index.html" "%DOCKER_DIR%\public\index.html"

echo [3/5] Copying docker-compose.yml ...
copy /Y "%~dp0docker-compose.yml" "%DOCKER_DIR%\docker-compose.yml"

echo [4/5] Creating data folder and empty notes.json ...
if not exist "%DOCKER_DIR%\data" mkdir "%DOCKER_DIR%\data"
if not exist "%DOCKER_DIR%\data\notes.json" echo {} > "%DOCKER_DIR%\data\notes.json"

echo [5/5] Restarting Docker container (adds new volume mount) ...
cd /d "%DOCKER_DIR%"
docker compose down
docker compose up -d

echo.
echo ✅ Done! Dashboard available at http://localhost:3456
echo    Notes will be saved to: %DOCKER_DIR%\data\notes.json
echo.
pause
