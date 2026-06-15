@echo off
rem ============================================================
rem  _diag_meetings_dupes.cmd  —  READ-ONLY
rem  Run on the PROD host via RDP, from C:\Apps\SDP-Dashboard.
rem  Lists duplicate PVs (same site x department x month stored as
rem  separate rows due to reference / department case drift) with
rem  child-row counts so we can choose a safe merge rule.
rem  NEVER writes. Safe any time.
rem
rem  Author: Claude — 2026-06-15
rem ============================================================
setlocal
cd /d "%~dp0"
node _diag_meetings_dupes.js data\meetings.db
endlocal
