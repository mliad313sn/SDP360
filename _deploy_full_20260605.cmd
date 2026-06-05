@echo off
rem ============================================================
rem  _deploy_full_20260605.cmd
rem  ------------------------------------------------------------
rem  ONE-OFF deploy for the 2026-06-05 session.
rem
rem  The auto-generated _deploy.cmd is incomplete because the
rem  .git/last-deployed marker points to a hash that no longer
rem  exists (history was squashed). This script lists every file
rem  the 2026-06-05 session actually touched, so the user can
rem  push a complete deployment to prod.
rem
rem  CRITICAL SAFETY: this script NEVER touches any *.db / *.db-wal
rem  / *.db-shm file, and NEVER touches the data\ folder where
rem  reports.db lives. Production DBs are preserved untouched.
rem
rem  REQUIREMENT: run _backup_prod.cmd FIRST so you have a snapshot
rem  if anything goes wrong.
rem
rem  Author: Claude — 2026-06-05
rem ============================================================
setlocal

rem --- Auto-map Z:\ if not present (same logic as hook script) ---
if not exist "Z:\" (
  echo Z:\ not mapped -- attempting auto-remap...
  net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes 2>nul
  if not exist "Z:\" (
    echo.
    echo ERROR: Could not map Z: to \\10.225.99.173\SDP-Dashboard.
    echo From a regular ^(non-admin^) cmd.exe, run:
    echo     net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes
    echo Then re-run this script.
    exit /b 1
  )
)

rem --- SAFETY CHECK: confirm backup was done -------------------
echo.
echo ============================================================
echo  Deploy full session 2026-06-05 to Z:\
echo ============================================================
echo.
echo BEFORE proceeding, you MUST have run _backup_prod.cmd at least
echo once today. The backup gives you a rollback path if anything
echo breaks.
echo.
echo Files about to be copied:
echo   - server.js  (URL versioning + injectAssetVersion)
echo   - reports-db.js
echo   - services\reportPayload.js  (trends payload for slide 11b)
echo   - services\groupPresets.js
echo   - tools\exec-pptx\render.py  (slide 11b matplotlib)
echo   - public\activity-tracker.html
echo   - public\activity-tracker\App.jsx  (drill-down UI)
echo   - public\activity-tracker\styles.css
echo   - public\activity-tracker\engine.js
echo   - public\activity-tracker\api.js
echo   - generate-site-monthly-pptx.js  (newly tracked)
echo   - CLAUDE.md
echo   - .gitignore
echo.
echo NO database files are touched. Reports.db / tracker.db /
echo inspection.db / meetings.db on Z:\ remain UNCHANGED.
echo.
set /p CONFIRM="Type YES to proceed (anything else aborts): "
if /i not "%CONFIRM%"=="YES" (
  echo Aborted by user. Nothing copied.
  exit /b 0
)

echo.
echo Deploying...
echo.

set "SRC=C:\Users\Admin\Documents\SDP-Dashboard"

rem --- Root-level files ---------------------------------------
xcopy "%SRC%\server.js"                        "Z:\"                              /Y >nul && echo   ^>  server.js
xcopy "%SRC%\reports-db.js"                    "Z:\"                              /Y >nul && echo   ^>  reports-db.js
xcopy "%SRC%\generate-site-monthly-pptx.js"    "Z:\"                              /Y >nul && echo   ^>  generate-site-monthly-pptx.js
xcopy "%SRC%\CLAUDE.md"                        "Z:\"                              /Y >nul && echo   ^>  CLAUDE.md
xcopy "%SRC%\.gitignore"                       "Z:\"                              /Y >nul && echo   ^>  .gitignore

rem --- services\ ----------------------------------------------
if not exist "Z:\services\" mkdir "Z:\services" 2>nul
xcopy "%SRC%\services\reportPayload.js"        "Z:\services\"                     /Y >nul && echo   ^>  services\reportPayload.js
xcopy "%SRC%\services\groupPresets.js"         "Z:\services\"                     /Y >nul && echo   ^>  services\groupPresets.js

rem --- tools\exec-pptx\ ---------------------------------------
if not exist "Z:\tools\exec-pptx\" mkdir "Z:\tools\exec-pptx" 2>nul
xcopy "%SRC%\tools\exec-pptx\render.py"        "Z:\tools\exec-pptx\"              /Y >nul && echo   ^>  tools\exec-pptx\render.py

rem --- public\ + public\activity-tracker\ ---------------------
xcopy "%SRC%\public\activity-tracker.html"     "Z:\public\"                       /Y >nul && echo   ^>  public\activity-tracker.html
if not exist "Z:\public\activity-tracker\" mkdir "Z:\public\activity-tracker" 2>nul
xcopy "%SRC%\public\activity-tracker\App.jsx"  "Z:\public\activity-tracker\"      /Y >nul && echo   ^>  public\activity-tracker\App.jsx
xcopy "%SRC%\public\activity-tracker\styles.css" "Z:\public\activity-tracker\"    /Y >nul && echo   ^>  public\activity-tracker\styles.css
xcopy "%SRC%\public\activity-tracker\engine.js" "Z:\public\activity-tracker\"     /Y >nul && echo   ^>  public\activity-tracker\engine.js
xcopy "%SRC%\public\activity-tracker\api.js"   "Z:\public\activity-tracker\"      /Y >nul && echo   ^>  public\activity-tracker\api.js

echo.
echo ============================================================
echo  Deploy complete.
echo ============================================================
echo.
echo NEXT STEPS on the production host (NOT here):
echo   1) pm2 reload endeavour-dashboard --update-env
echo   2) Open the dashboard in a browser, press Ctrl+F5 ONCE.
echo   3) Open DevTools -^> Network, reload again, verify:
echo      - App.jsx is requested with ?v=^<APP_VERSION^> in URL
echo      - Cache-Control: public, max-age=31536000, immutable
echo   4) Tell users to do ONE Ctrl+F5 on any dashboard page.
echo      After that, URL-versioning handles future deploys auto.
echo.
echo Rollback (if needed):
echo   - Stop pm2:        pm2 stop endeavour-dashboard
echo   - Restore from:    C:\Apps\SDP-Dashboard-Backups\^<latest^>\
echo   - Restart pm2:     pm2 start endeavour-dashboard
echo.
endlocal
