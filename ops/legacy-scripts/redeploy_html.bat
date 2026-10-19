@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM  Quick redeploy: HTML only (no Docker restart needed)
REM  Run from C:\Users\Admin\Documents\SDP-Dashboard\
REM ─────────────────────────────────────────────────────────────────────────────
set DOCKER_DIR=C:\endeavour-dashboard

echo Copying index.html to Docker folder...
copy /Y "%~dp0public\index.html" "%DOCKER_DIR%\public\index.html"

echo Copying server.js to Docker folder...
copy /Y "%~dp0server.js" "%DOCKER_DIR%\server.js"

echo.
echo Done! Refresh your browser at http://localhost:3456
echo (No Docker restart needed for HTML changes)
pause
