@echo off
rem ============================================================
rem  _stage_inspection_actions_to_prod.cmd   (run on DEV BOX)
rem  Stages the Inspection Corrective-Actions Register to Z:\ (prod),
rem  plus the meetings DB-path bugfix + getActionParent/getIssueParent
rem  helper refactor that rode along.
rem
rem  Server-side files (inspection-db.js + meetings-db.js + server.js)
rem  AND _htmlCache'd HTML → prod needs pm2 STOP + START (not reload).
rem
rem  Files:
rem    inspection-db.js                 (insp_action_updates + listActions +
rem                                      addActionUpdate + getActionParent)
rem    meetings-db.js                   (getActionParent + getIssueParent helpers)
rem    server.js                        (inspection /actions routes + meetings
rem                                      route refactor to data/ path)
rem    public\inspection-actions.html   (NEW — the register page)
rem    public\inspections.html          (+ "Actions register" button)
rem
rem  Author: Claude — 2026-06-15
rem ============================================================
setlocal
if not exist "Z:\" (
  echo Z:\ not mapped -- attempting auto-remap...
  net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes 2>nul
  if not exist "Z:\" ( echo ERROR: map Z: first: net use Z: \\10.225.99.173\SDP-Dashboard /persistent:yes & exit /b 1 )
)
set "SRC=C:\Users\Admin\Documents\SDP-Dashboard"

findstr /c:"listActions" "%SRC%\inspection-db.js" >nul 2>nul
if errorlevel 1 ( echo ERROR: inspection-db.js missing listActions. git pull first. & exit /b 1 )
findstr /c:"/api/inspection/actions" "%SRC%\server.js" >nul 2>nul
if errorlevel 1 ( echo ERROR: server.js missing inspection actions route. git pull first. & exit /b 1 )

echo.
echo Staging Inspection Actions Register to Z:\ ...
xcopy "%SRC%\inspection-db.js"                  "Z:\"        /Y >nul && echo   ^>  inspection-db.js
xcopy "%SRC%\meetings-db.js"                    "Z:\"        /Y >nul && echo   ^>  meetings-db.js
xcopy "%SRC%\server.js"                         "Z:\"        /Y >nul && echo   ^>  server.js
xcopy "%SRC%\public\inspection-actions.html"    "Z:\public\" /Y >nul && echo   ^>  public\inspection-actions.html
xcopy "%SRC%\public\inspections.html"           "Z:\public\" /Y >nul && echo   ^>  public\inspections.html

echo.
echo ============================================================
echo  NOW on prod (RDP) — server.js changed, so STOP + START:
echo     pm2 stop endeavour-dashboard
echo     timeout /t 5 /nobreak
echo     pm2 start endeavour-dashboard
echo.
echo  Then (Ctrl+F5): Insights -^> Inspections -^> "Actions register"
echo  button (top right). Editor+ gets an inline status dropdown per
echo  action; changing it closes/updates the action even on a
echo  submitted/closed inspection. The insp_action_updates audit table
echo  is created automatically on first load.
echo ============================================================
endlocal
