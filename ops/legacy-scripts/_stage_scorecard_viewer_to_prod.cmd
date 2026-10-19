@echo off
rem ============================================================
rem  _stage_scorecard_viewer_to_prod.cmd
rem  Run from DEV BOX cmd.exe. Stages the 6 files of the
rem  scorecard-viewer feature role (commit 5704d7c):
rem    - reports-db.js            (FEATURE_ROLES_KNOWN + scorecard-viewer)
rem    - public\auth.js           (data-require OR list "a|b")
rem    - public\_shell.js         (nav: Analytics + Scorecard for the role)
rem    - public\executive.html    (gate: executive|scorecard-viewer)
rem    - public\analytics.html    (gate: admin|scorecard-viewer)
rem    - public\reports.html      (admin user modal: new checkbox)
rem
rem  NO schema migration, NO .env change. Safe deploy.
rem  HTML pages are in _htmlCache -> pm2 stop+start REQUIRED.
rem
rem  Author: Claude — 2026-06-12
rem ============================================================
setlocal

if not exist "Z:\" (
  echo Z:\ not mapped -- attempting auto-remap...
  net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes 2>nul
  if not exist "Z:\" (
    echo ERROR: Could not map Z:. Run:
    echo     net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes
    exit /b 1
  )
  echo Z:\ remapped.
)

set "SRC=C:\Users\Admin\Documents\SDP-Dashboard"

rem --- Pre-flight: scorecard-viewer markers must be present ---
findstr /c:"scorecard-viewer" "%SRC%\reports-db.js" >nul 2>nul
if errorlevel 1 ( echo ERROR: reports-db.js missing scorecard-viewer. git pull first. & exit /b 1 )
findstr /c:"scorecard-viewer" "%SRC%\public\auth.js" >nul 2>nul
if errorlevel 1 ( echo ERROR: auth.js missing OR-list support. git pull first. & exit /b 1 )
findstr /c:"scorecard-viewer" "%SRC%\public\_shell.js" >nul 2>nul
if errorlevel 1 ( echo ERROR: _shell.js missing scorecard-viewer nav roles. git pull first. & exit /b 1 )

echo.
echo ============================================================
echo  Stage scorecard-viewer role to Z:\ (prod)
echo ============================================================
echo.
xcopy "%SRC%\reports-db.js"            "Z:\"        /Y >nul && echo   ^>  reports-db.js
xcopy "%SRC%\public\auth.js"           "Z:\public\" /Y >nul && echo   ^>  public\auth.js
xcopy "%SRC%\public\_shell.js"         "Z:\public\" /Y >nul && echo   ^>  public\_shell.js
xcopy "%SRC%\public\executive.html"    "Z:\public\" /Y >nul && echo   ^>  public\executive.html
xcopy "%SRC%\public\analytics.html"    "Z:\public\" /Y >nul && echo   ^>  public\analytics.html
xcopy "%SRC%\public\reports.html"      "Z:\public\" /Y >nul && echo   ^>  public\reports.html

echo.
echo ============================================================
echo  NEXT STEPS on prod via RDP (stop+start, NOT reload):
echo.
echo    pm2 stop endeavour-dashboard
echo    timeout /t 5 /nobreak
echo    pm2 start endeavour-dashboard
echo    pm2 status
echo.
echo  Then assign the role (reports.html#admin, super_admin):
echo    Edit Serge -^> Hierarchical: Viewer
echo                -^> Feature roles: check scorecard-viewer
echo                -^> Save User
echo.
echo  Smoke tests (Serge's account, Ctrl+F5 once):
echo    - Insights menu shows Analytics + Executive Scorecard
echo    - executive.html loads (no bounce to index.html)
echo    - analytics.html loads, filters work
echo    - AI Analyze / PPTX export still rejected (403 report-author)
echo ============================================================
echo.
endlocal
