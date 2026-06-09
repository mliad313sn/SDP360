@echo off
rem ============================================================
rem  _diag_prod.cmd
rem  Read-only prod inspection. Tells you:
rem    1) Where each DB lives + their real sizes
rem    2) Whether the 2026-06-05 fixes are already deployed
rem       (URL versioning, Activity Tracker drill-down)
rem    3) .env presence
rem  Safe to run any time, modifies nothing.
rem
rem  AUTO-DETECTS context:
rem    - On prod (RDP): reads from C:\Apps\SDP-Dashboard\
rem    - On dev box: reads from Z:\
rem ============================================================
setlocal enabledelayedexpansion

if exist "C:\Apps\SDP-Dashboard\server.js" (
  set "PROD_ROOT=C:\Apps\SDP-Dashboard\"
  set "CONTEXT=PROD (running on prod server)"
) else if exist "Z:\server.js" (
  set "PROD_ROOT=Z:\"
  set "CONTEXT=DEV box (reading prod via Z:\)"
) else (
  echo ERROR: cannot find SDP-Dashboard installation.
  exit /b 1
)

echo.
echo ============================================================
echo  Production layout diagnostic — %CONTEXT%
echo ============================================================
echo.

echo --- DBs at root (should be EMPTY post-harmonisation 2026-06-05) ---
dir "%PROD_ROOT%*.db" 2>nul | findstr ".db" || echo   ^(no DB at root -- expected after harmonisation^)
echo.

echo --- data\ folder (canonical location of ALL 4 DBs since 2026-06-05) ---
if exist "%PROD_ROOT%data\" (
  dir "%PROD_ROOT%data\*.db*" 2>nul | findstr ".db"
) else (
  echo   NO data\ folder ^| this is a problem if reports.db expected there!
)
echo.

echo --- Zombie reports.db at root (should be 0 KB, harmless) ---
if exist "%PROD_ROOT%reports.db" (
  dir "%PROD_ROOT%reports.db" | findstr "reports.db"
) else (
  echo   ^(no zombie at root — good^)
)
echo.

echo --- WAL files (should be small / absent on idle DB) ---
for %%P in ("%PROD_ROOT%data\reports.db-wal" "%PROD_ROOT%tracker.db-wal" "%PROD_ROOT%inspection.db-wal" "%PROD_ROOT%meetings.db-wal") do (
  if exist "%%~P" dir "%%~P" | findstr ".db-wal"
)
echo.

echo --- .env present? ---
if exist "%PROD_ROOT%.env" (
  echo   YES — %PROD_ROOT%.env
) else (
  echo   NO — missing! App will fail Zoho/Anthropic calls.
)
echo.

echo ============================================================
echo  Is the 2026-06-05 session ALREADY deployed?
echo ============================================================
echo.

echo --- Check 1: server.js contains injectAssetVersion (URL versioning)? ---
findstr /c:"injectAssetVersion" "%PROD_ROOT%server.js" >nul 2>nul
if !errorlevel! == 0 (
  echo   YES ^| URL-versioning code IS in prod server.js
) else (
  echo   NO  ^| URL-versioning code MISSING ^| prod still on old server.js
)
echo.

echo --- Check 2: server.js contains APP_VERSION boot setup? ---
findstr /c:"APP_VERSION" "%PROD_ROOT%server.js" >nul 2>nul
if !errorlevel! == 0 (
  echo   YES ^| APP_VERSION boot code IS in prod
) else (
  echo   NO  ^| APP_VERSION code MISSING
)
echo.

echo --- Check 3: App.jsx contains the drill-down state (drilledPillar) ---
if exist "%PROD_ROOT%public\activity-tracker\App.jsx" (
  findstr /c:"drilledPillar" "%PROD_ROOT%public\activity-tracker\App.jsx" >nul 2>nul
  if !errorlevel! == 0 (
    echo   YES ^| Tracker drill-down IS in prod App.jsx
  ) else (
    echo   NO  ^| Tracker drill-down MISSING from prod App.jsx
  )
) else (
  echo   ?? ^| App.jsx not found at expected path
)
echo.

echo --- Check 4: services\reportPayload.js contains trends block ---
if exist "%PROD_ROOT%services\reportPayload.js" (
  findstr /c:"trends" "%PROD_ROOT%services\reportPayload.js" >nul 2>nul
  if !errorlevel! == 0 (
    echo   YES ^| Trends payload IS in prod reportPayload.js
  ) else (
    echo   NO  ^| Trends payload MISSING from prod reportPayload.js
  )
) else (
  echo   ?? ^| services\reportPayload.js not found
)
echo.

echo --- Check 5: tools\exec-pptx\render.py contains slide 11b ---
if exist "%PROD_ROOT%tools\exec-pptx\render.py" (
  findstr /c:"Pillar Trends" "%PROD_ROOT%tools\exec-pptx\render.py" >nul 2>nul
  if !errorlevel! == 0 (
    echo   YES ^| Slide 11b IS in prod render.py
  ) else (
    echo   NO  ^| Slide 11b MISSING from prod render.py
  )
) else (
  echo   ?? ^| tools\exec-pptx\render.py not found
)
echo.

echo --- Check 6: generate-site-monthly-pptx.js present? ---
if exist "%PROD_ROOT%generate-site-monthly-pptx.js" (
  echo   YES ^| File present in prod -- size:
  dir "%PROD_ROOT%generate-site-monthly-pptx.js" | findstr "generate-site"
) else (
  echo   NO  ^| File MISSING -- /api/reports/monthly/.../site-template/pptx will 503!
)
echo.

echo ============================================================
echo  Date of last server.js modification on prod
echo ============================================================
dir "%PROD_ROOT%server.js" | findstr "server.js"
echo.

echo ============================================================
echo  pm2 status (run on prod host, not here):
echo     pm2 status
echo     pm2 logs endeavour-dashboard --lines 50 --nostream
echo ============================================================
echo.
endlocal
