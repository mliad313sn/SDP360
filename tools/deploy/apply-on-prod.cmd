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
if exist "%~dp0node_modules\" (
  echo This package carries a NEW node_modules ^(dependencies changed^).
  echo The server must be stopped to replace it - stopping endeavour-dashboard ...
  call pm2 stop endeavour-dashboard
  timeout /t 5 /nobreak >nul
  set "STAMP=%RANDOM%%RANDOM%"
  if exist "%APP%\node_modules" (
    move "%APP%\node_modules" "%APP%\node_modules.prev-!STAMP!" >nul
    if errorlevel 1 (
      echo [ERROR] could not move the old node_modules aside ^(a process still holds it?^). Nothing changed.
      pause
      exit /b 1
    )
  )
  robocopy "%~dp0node_modules" "%APP%\node_modules" /E /NFL /NDL /NJH /NJS /NP >nul
  pushd "%APP%"
  node -e "require('better-sqlite3')(':memory:').prepare('select 1').get(); require('axios'); require('xlsx'); require('nodemailer'); require('express')"
  set "DEPS_OK=!errorlevel!"
  popd
  if not "!DEPS_OK!"=="0" (
    echo [ERROR] the new node_modules does not load - restoring the previous one.
    rmdir /S /Q "%APP%\node_modules"
    if exist "%APP%\node_modules.prev-!STAMP!" move "%APP%\node_modules.prev-!STAMP!" "%APP%\node_modules" >nul
    pause
    exit /b 1
  )
  echo   node_modules replaced. The previous one is kept as node_modules.prev-!STAMP! - delete it once the server runs.
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
