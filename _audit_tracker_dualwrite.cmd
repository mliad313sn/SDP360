@echo off
rem ============================================================
rem  _audit_tracker_dualwrite.cmd
rem  ADR-001 Phase 1 dual-write health check (cmd wrapper).
rem
rem  Delegates to _audit_tracker_dualwrite.js — keeps the cmd file
rem  trivial so cmd.exe parsing quirks (delayed expansion '!', '<',
rem  parentheses in echo, etc.) can never break the audit logic.
rem
rem  Read-only on the DB. Exit code:
rem    0 = in sync
rem    1 = drift detected
rem    2 = DB unreachable or tracker_config missing
rem
rem  Auto-detects: C:\Apps\SDP-Dashboard\ on prod, Z:\ on dev box.
rem
rem  Author: Claude — 2026-06-09
rem ============================================================
setlocal

if exist "C:\Apps\SDP-Dashboard\server.js" (
  set "ROOT=C:\Apps\SDP-Dashboard"
) else if exist "Z:\server.js" (
  set "ROOT=Z:"
) else (
  echo ERROR: cannot find SDP-Dashboard installation.
  exit /b 2
)

if not exist "%ROOT%\_audit_tracker_dualwrite.js" (
  echo ERROR: %ROOT%\_audit_tracker_dualwrite.js is missing.
  echo Run _stage_palier2_phase1_to_prod.cmd from dev box first.
  exit /b 2
)

echo.
echo ============================================================
echo  Tracker dual-write audit -- %ROOT%\data\tracker.db
echo ============================================================
echo.

cd /d "%ROOT%"
node "_audit_tracker_dualwrite.js"
set "RC=%ERRORLEVEL%"
echo.
exit /b %RC%
