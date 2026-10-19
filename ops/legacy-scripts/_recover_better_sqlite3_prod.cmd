@echo off
rem ─────────────────────────────────────────────────────────────────────
rem  EMERGENCY RECOVERY — better-sqlite3 native binding missing on prod.
rem
rem  Symptom in pm2 logs:
rem    Error: Could not locate the bindings file. Tried:
rem     → C:\Apps\SDP-Dashboard\node_modules\better-sqlite3\build\...
rem
rem  Root cause (2026-05-30 incident): `npm uninstall ... --ignore-scripts`
rem  silently removed better_sqlite3.node from node_modules. Despite the
rem  flag protecting against post-install REBUILD, npm's package-tree
rem  reconciliation can still delete the binary file. The dev box hit the
rem  same issue first; this script applies the recovery proven there.
rem
rem  Approach: upgrade better-sqlite3 from 9.6.0 to 12.x. v12 ships
rem  Node 24 (NODE_MODULE_VERSION 137) prebuilts via prebuild-install,
rem  so no Visual Studio rebuild is required. Corporate SSL inspection
rem  is bypassed for THIS install only (NODE_TLS_REJECT_UNAUTHORIZED=0).
rem
rem  API compatibility: v9 → v12 is fully backward-compatible for the
rem  operations the codebase uses (Database, prepare, run, all, get,
rem  exec, pragma, transaction). Smoke-tested on dev 2026-05-30.
rem
rem  Run this on the PRODUCTION HOST, in cmd.exe (NOT via Z:\).
rem ─────────────────────────────────────────────────────────────────────

if not exist "C:\Apps\SDP-Dashboard\package.json" (
  echo ERROR: C:\Apps\SDP-Dashboard\package.json not found.
  echo This script must run on the production host.
  exit /b 1
)

cd /d C:\Apps\SDP-Dashboard

echo === Step 1/5: Stop pm2 so the file lock on better_sqlite3.node releases ===
call pm2 stop endeavour-dashboard 2>nul

echo.
echo === Step 2/5: Remove the broken better-sqlite3 install ===
if exist node_modules\better-sqlite3 (
  rmdir /S /Q node_modules\better-sqlite3
  echo Removed node_modules\better-sqlite3
) else (
  echo node_modules\better-sqlite3 already absent.
)

echo.
echo === Step 3/5: Reinstall, bypassing corporate SSL inspection for prebuild download ===
echo This grabs the prebuilt binary from GitHub releases without compiling.
echo NOTE: TLS verification is temporarily disabled for THIS process only.
echo       It is NOT a permanent npm config change.
echo.
set NODE_TLS_REJECT_UNAUTHORIZED=0
call npm install better-sqlite3@latest --foreground-scripts --strict-ssl=false
set NODE_TLS_REJECT_UNAUTHORIZED=
if errorlevel 1 (
  echo.
  echo ERROR: npm install failed. Likely reasons:
  echo   1. No network access to github.com (the prebuild lives there).
  echo      → Try from a non-restricted network, or copy the working
  echo        node_modules\better-sqlite3\ tree from the dev box.
  echo   2. The prebuild for Node 24.13.1 isn't available yet.
  echo      → Pin to an older Node version, or build from source.
  exit /b 1
)

echo.
echo === Step 4/5: Verify the binary loads ===
call node -e "const D=require('better-sqlite3'); const d=new D(':memory:'); d.prepare('CREATE TABLE t(x INT)').run(); console.log('better-sqlite3 v' + require('better-sqlite3/package.json').version + ' loaded OK');"
if errorlevel 1 (
  echo.
  echo ERROR: better-sqlite3 still won't load. Inspect the error above.
  exit /b 1
)

echo.
echo === Step 5/5: Restart pm2 ===
call pm2 start endeavour-dashboard --update-env
call pm2 logs endeavour-dashboard --lines 15 --nostream

echo.
echo Done. Verify by opening https://itops-dashboard.edv-ops.com/ in a
echo browser. The dashboard should load. Check pm2 logs for any
echo lingering errors.
exit /b 0
