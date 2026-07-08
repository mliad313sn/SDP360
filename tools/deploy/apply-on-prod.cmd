@echo off
setlocal enabledelayedexpansion
:: ─────────────────────────────────────────────────────────────────────
:: Apply an SDP Dashboard deploy package on the PROD server.
:: Extract the sdp-deploy_*.zip anywhere on prod, then run this file
:: (shipped inside the zip as _apply_on_prod.cmd) from the extracted folder.
:: ─────────────────────────────────────────────────────────────────────
set "APP=%SDP_PROD_DIR%"
if "%APP%"=="" set "APP=C:\Apps\SDP-Dashboard"
if not exist "%APP%\server.js" (
  echo [ERROR] "%APP%" does not look like the app root ^(no server.js^).
  echo Set SDP_PROD_DIR to the correct path and re-run.
  pause
  exit /b 1
)
echo Applying package to %APP% ...
xcopy "%~dp0files" "%APP%" /E /Y /I
if errorlevel 1 (
  echo [ERROR] file copy failed.
  pause
  exit /b 1
)
if exist "%~dp0DELETIONS.txt" (
  for /f "usebackq delims=" %%F in ("%~dp0DELETIONS.txt") do (
    if exist "%APP%\%%F" ( del /F /Q "%APP%\%%F" && echo   deleted %%F )
  )
)
echo.
echo Files applied. Now RESTART the server ^(server.js + boot-cached HTML need it^):
echo     _pm2_restart_prod.cmd     ^(pm2 stop -^> timeout 5 -^> start; NOT reload^)
echo render.py is copy-only. After the restart, each user presses Ctrl+F5 once.
echo.
pause
