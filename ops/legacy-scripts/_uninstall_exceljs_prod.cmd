@echo off
rem ─────────────────────────────────────────────────────────────────────
rem  RUN THIS ON THE PRODUCTION HOST ONLY (RDP, not via Z:\).
rem
rem  Removes exceljs and its 80 transitive packages from prod's
rem  C:\Apps\SDP-Dashboard\node_modules\ . Run this AFTER deploying
rem  the risk-register-export.js rewrite that switched from exceljs
rem  to xlsx (SheetJS CE).
rem
rem  Safe because:
rem    - --ignore-scripts protects better-sqlite3 from being rebuilt
rem      (CLAUDE.md known pitfall — would break native binding on
rem      Node 24 + C++17 build tools)
rem    - exceljs is the only thing in package.json depending on this
rem      tree; xlsx, pptxgenjs, express, etc. don't share these
rem      packages (verified via npm ls 2026-05-29)
rem    - npm uninstall only removes packages from node_modules; it
rem      does NOT touch databases, .env, public/, or any other state
rem
rem  Reversible: if anything breaks, `npm install exceljs@4.4.0
rem  --ignore-scripts` puts it back.
rem
rem  Verify after running: the dashboard should load normally, the
rem  Risk Register export should still produce a .xlsx (now via xlsx
rem  not exceljs), and pm2 should show no module-resolution errors
rem  in the logs.
rem ─────────────────────────────────────────────────────────────────────

if not exist "C:\Apps\SDP-Dashboard\package.json" (
  echo ERROR: C:\Apps\SDP-Dashboard\package.json not found.
  echo This script must run on the production host, not the dev box.
  exit /b 1
)

cd /d C:\Apps\SDP-Dashboard

echo.
echo === Step 1/4: Confirm exceljs is currently installed ===
call npm ls exceljs --depth=0 2>nul
if errorlevel 1 (
  echo exceljs is already absent. Nothing to uninstall.
  echo Run "pm2 restart endeavour-dashboard --update-env" if you
  echo just deployed the rewrite, then verify the export.
  exit /b 0
)

echo.
echo === Step 2/4: Uninstall exceljs + its now-orphaned transitive deps ===
echo Running: npm uninstall exceljs --ignore-scripts
echo.
call npm uninstall exceljs --ignore-scripts
if errorlevel 1 (
  echo.
  echo ERROR: npm uninstall failed. Check the output above.
  echo If permission errors mention "better_sqlite3.node", stop pm2
  echo first, re-run, then start pm2:
  echo     pm2 stop endeavour-dashboard
  echo     npm uninstall exceljs --ignore-scripts
  echo     pm2 start endeavour-dashboard
  exit /b 1
)

echo.
echo === Step 3/4: Audit what remains ===
call npm audit --omit=dev 2>&1 | findstr /R "vulnerabilities found"
echo.

echo === Step 4/4: Restart pm2 with refreshed env + module cache ===
call pm2 restart endeavour-dashboard --update-env
echo.
call pm2 logs endeavour-dashboard --lines 10 --nostream

echo.
echo Done. Verify by:
echo   1. Open https://itops-dashboard.edv-ops.com/ in a browser
echo   2. Confirm the dashboard loads (no module-resolution errors)
echo   3. Click "Export Risk Register" in monthly view -- should
echo      download an .xlsx (now produced by the xlsx package)
echo   4. Open the .xlsx in Excel -- data + column widths render;
echo      colored header bands won't (acceptable per the rewrite)
echo.
exit /b 0
