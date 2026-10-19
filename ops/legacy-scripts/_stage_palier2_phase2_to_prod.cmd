@echo off
rem ============================================================
rem  _stage_palier2_phase2_to_prod.cmd
rem  Run from DEV BOX cmd.exe. Stages the single Phase 2 file:
rem    - tracker-db.js (switchable loadTracker with shadow mode)
rem
rem  Phase 2 introduces TWO env vars (BOTH optional, BOTH safe to
rem  toggle at runtime via pm2 reload --update-env):
rem
rem    TRACKER_READ_SOURCE = 'legacy' (default) | 'new'
rem      Which backend loadTracker() reads from.
rem
rem    TRACKER_READ_SHADOW = '1' | unset
rem      If set, the OTHER backend runs in shadow and any structural
rem      diff vs the primary is logged as a WARN. No UX impact.
rem
rem  Recommended progression (per ADR-001 §5 Phase 2):
rem    Day 0  Deploy this commit (defaults to legacy, no shadow). Zero
rem           change for users.
rem    Day 1  Add 'TRACKER_READ_SHADOW=1' to .env, pm2 reload --update-env.
rem           Watch pm2 logs for [Tracker-DB] shadow diff messages.
rem    Day 1-7  Confirm 'shadow diff' is empty (or all-known/expected).
rem    Day 7+ Add 'TRACKER_READ_SOURCE=new' to .env, pm2 reload.
rem           Now loadTracker reads from the normalised schema.
rem    Rollback at any point: remove the env vars and reload.
rem
rem  Also adds 4 PHASE 2 columns to tracker_activities (legacy_id,
rem  legacy_num, weight, shared) so the new schema can reconstruct
rem  the byte-identical D.activities[] shape. ALTER TABLEs are
rem  idempotent (additive, try/catch).
rem
rem  Author: Claude — 2026-06-09
rem ============================================================
setlocal

if not exist "Z:\" (
  echo Z:\ not mapped -- attempting auto-remap...
  net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes 2>nul
  if not exist "Z:\" (
    echo ERROR: Could not map Z:.
    exit /b 1
  )
  echo Z:\ remapped.
)

set "SRC=C:\Users\Admin\Documents\SDP-Dashboard"
if not exist "%SRC%\tracker-db.js" (
  echo ERROR: %SRC%\tracker-db.js missing.
  exit /b 1
)

findstr /c:"_loadFromNewSchema" "%SRC%\tracker-db.js" >nul 2>nul
if errorlevel 1 (
  echo ERROR: %SRC%\tracker-db.js does NOT contain Phase 2 markers.
  echo Run 'git pull' on dev box first.
  exit /b 1
)

echo.
echo ============================================================
echo  Stage Phase 2 (ADR-001) to Z:\ (prod)
echo ============================================================
echo.

xcopy "%SRC%\tracker-db.js" "Z:\" /Y >nul && echo   ^>  tracker-db.js

echo.
echo ============================================================
echo  Staging complete. NEXT STEPS on prod via RDP:
echo.
echo  1. (recommended) Fresh backup:
echo       _backup_prod.cmd
echo.
echo  2. Reload pm2 ONCE (defaults: legacy + no shadow):
echo       pm2 reload endeavour-dashboard --update-env
echo.
echo  3. Verify (still reads legacy, no behavior change):
echo       _audit_tracker_dualwrite.cmd
echo       (should still pass; the 4 PHASE-2 columns are populated
echo        on tracker_activities through the boot-time backfill)
echo.
echo  4. ENABLE SHADOW MODE (day +1):
echo       Edit C:\Apps\SDP-Dashboard\.env, add line:
echo         TRACKER_READ_SHADOW=1
echo       Then: pm2 reload endeavour-dashboard --update-env
echo       Watch:
echo         pm2 logs endeavour-dashboard --lines 50 --nostream ^| findstr shadow
echo       Expected over the next week: no diff, or only expected diffs.
echo.
echo  5. SWITCH TO NEW (day +7, after observation):
echo       Edit .env, add line:
echo         TRACKER_READ_SOURCE=new
echo       Then: pm2 reload --update-env
echo.
echo  6. ROLLBACK at any time:
echo       Remove TRACKER_READ_SOURCE / TRACKER_READ_SHADOW from .env
echo       pm2 reload --update-env
echo ============================================================
echo.
endlocal
