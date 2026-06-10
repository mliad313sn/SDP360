@echo off
rem ============================================================
rem  _audit_tracker_dualwrite.cmd
rem  ADR-001 Phase 1 dual-write health check.
rem
rem  Compares the legacy tracker_config singleton against the
rem  normalised tracker_years / tracker_pillars / tracker_activities
rem  tables. Reports any drift detected — would catch e.g.:
rem    - A year added in legacy but missing from tracker_years
rem    - A pillar weight updated in legacy but stale in tracker_pillars
rem    - An activity added in legacy but absent in tracker_activities
rem    - tracker_targets / tracker_inputs rows still NULL on activity_id
rem
rem  Run from prod via RDP (or schedule daily via Task Scheduler).
rem  Auto-detects: prefers C:\Apps\SDP-Dashboard\ on prod, falls
rem  back to Z:\ if invoked from dev box.
rem
rem  Returns exit code 0 if all in sync, 1 if drift detected.
rem  Always non-destructive (read-only on the DB).
rem
rem  Author: Claude — 2026-06-09
rem ============================================================
setlocal enabledelayedexpansion

if exist "C:\Apps\SDP-Dashboard\server.js" (
  set "ROOT=C:\Apps\SDP-Dashboard"
) else if exist "Z:\server.js" (
  set "ROOT=Z:"
) else (
  echo ERROR: cannot find SDP-Dashboard installation.
  exit /b 2
)

echo.
echo ============================================================
echo  Tracker dual-write audit — %ROOT%\data\tracker.db
echo ============================================================
echo.

cd /d "%ROOT%"

node -e "const Database=require('better-sqlite3');const db=new Database('./data/tracker.db',{readonly:true});let drift=0;function note(msg){console.log('  '+msg);}function ok(msg){console.log('  OK  '+msg);}function warn(msg){console.log('  WARN '+msg);drift++;}const cfg=db.prepare('SELECT activities_json,pillar_weights_json,years_json FROM tracker_config WHERE id=1').get();if(!cfg){console.log('  CRITICAL: tracker_config row 1 missing');process.exit(2);}const legacyYears=JSON.parse(cfg.years_json||'[]');const legacyPillars=JSON.parse(cfg.pillar_weights_json||'{}');const legacyActivities=JSON.parse(cfg.activities_json||'[]');console.log('--- Years ---');const newYears=db.prepare('SELECT year FROM tracker_years ORDER BY year').all().map(r=>r.year);const legacyYS=new Set(legacyYears.map(Number));const newYS=new Set(newYears.map(Number));for(const y of legacyYS){if(newYS.has(y))ok('year '+y+' present in both');else warn('year '+y+' in LEGACY but MISSING in tracker_years');}for(const y of newYS){if(!legacyYS.has(y))warn('year '+y+' in tracker_years but ABSENT from legacy years_json');}console.log('--- Pillars per year ---');const pillarKeys=Object.keys(legacyPillars).sort();for(const y of legacyYS){const newP=db.prepare('SELECT code,name,weight FROM tracker_pillars WHERE year=? ORDER BY display_order').all(y);const newMap=Object.fromEntries(newP.map(p=>[p.code,p]));for(const lk of pillarKeys){const m=String(lk).match(/^(\\d+)/);const expectedCode=m?'P'+m[1]:lk.slice(0,4).toUpperCase();const expectedWeight=legacyPillars[lk];const newRow=newMap[expectedCode];if(!newRow){warn('year '+y+': pillar '+expectedCode+' ('+lk+') in legacy but MISSING in tracker_pillars');continue;}if(Math.abs(newRow.weight-expectedWeight)>0.0001){warn('year '+y+': pillar '+expectedCode+' weight LEGACY='+expectedWeight+' vs NEW='+newRow.weight);}else{ok('year '+y+' / '+expectedCode+' weight='+newRow.weight);}}}console.log('--- Activities per year ---');for(const y of legacyYS){const newA=db.prepare('SELECT COUNT(*) c FROM tracker_activities a JOIN tracker_pillars p ON p.id=a.pillar_id WHERE p.year=?').get(y).c;if(newA<legacyActivities.length){warn('year '+y+': '+newA+' activities in new schema vs '+legacyActivities.length+' in legacy (deficit '+(legacyActivities.length-newA)+')');}else{ok('year '+y+': '+newA+' activities (legacy has '+legacyActivities.length+')');}}console.log('--- activity_id coverage on legacy rows ---');const tNull=db.prepare('SELECT COUNT(*) c FROM tracker_targets WHERE activity_id IS NULL').get().c;const tTot=db.prepare('SELECT COUNT(*) c FROM tracker_targets').get().c;if(tNull>0)warn('tracker_targets: '+tNull+' / '+tTot+' rows have NULL activity_id');else ok('tracker_targets: all '+tTot+' rows mapped to activity_id');const iNull=db.prepare('SELECT COUNT(*) c FROM tracker_inputs WHERE activity_id IS NULL').get().c;const iTot=db.prepare('SELECT COUNT(*) c FROM tracker_inputs').get().c;if(iNull>0)warn('tracker_inputs : '+iNull+' / '+iTot+' rows have NULL activity_id');else ok('tracker_inputs : all '+iTot+' rows mapped to activity_id');console.log('');if(drift===0){console.log('============================================================');console.log('   AUDIT PASSED — legacy and normalised schema in sync');console.log('============================================================');process.exit(0);}else{console.log('============================================================');console.log('   AUDIT FAILED — '+drift+' drift item(s) above');console.log('   Resolution: pm2 reload endeavour-dashboard --update-env');console.log('   (the next boot _backfillFromLegacy fixes ADD/UPDATE drift)');console.log('   DELETE drift requires deleteTrackerYear() to be invoked');console.log('   via UI for legacy cleanup before new schema follows.');console.log('============================================================');process.exit(1);}db.close();"

set "RC=%ERRORLEVEL%"
echo.
exit /b %RC%
