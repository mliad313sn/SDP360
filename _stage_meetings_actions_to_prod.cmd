@echo off
rem ============================================================
rem  _stage_meetings_actions_to_prod.cmd   (run on DEV BOX)
rem  Stages the Meetings Actions Register feature to Z:\ (prod).
rem
rem  Server-side files (meetings-db.js + server.js) AND _htmlCache'd
rem  HTML pages → prod needs pm2 STOP + START (not reload).
rem
rem  Files:
rem    meetings-db.js                 (md_action_updates + listActions + addActionUpdate)
rem    server.js                      (GET /actions, POST /actions/:id/update, route + cache)
rem    public\meetings-actions.html   (NEW — the register page)
rem    public\meetings.html           (+ Actions tab)
rem    public\meetings-issues.html    (+ Actions tab)
rem    public\meetings-council.html   (+ Actions tab)
rem    public\meetings-compliance.html(+ Actions tab)
rem    public\meetings-setup.html     (+ Actions tab)
rem    public\meetings-insights.html  (+ Actions tab)
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

findstr /c:"listActions" "%SRC%\meetings-db.js" >nul 2>nul
if errorlevel 1 ( echo ERROR: meetings-db.js missing listActions. git pull first. & exit /b 1 )
findstr /c:"/api/meetings/actions" "%SRC%\server.js" >nul 2>nul
if errorlevel 1 ( echo ERROR: server.js missing actions route. git pull first. & exit /b 1 )

echo.
echo Staging Meetings Actions Register to Z:\ ...
xcopy "%SRC%\meetings-db.js"                    "Z:\"        /Y >nul && echo   ^>  meetings-db.js
xcopy "%SRC%\server.js"                         "Z:\"        /Y >nul && echo   ^>  server.js
xcopy "%SRC%\public\meetings-actions.html"      "Z:\public\" /Y >nul && echo   ^>  public\meetings-actions.html
xcopy "%SRC%\public\meetings.html"              "Z:\public\" /Y >nul && echo   ^>  public\meetings.html
xcopy "%SRC%\public\meetings-issues.html"       "Z:\public\" /Y >nul && echo   ^>  public\meetings-issues.html
xcopy "%SRC%\public\meetings-council.html"      "Z:\public\" /Y >nul && echo   ^>  public\meetings-council.html
xcopy "%SRC%\public\meetings-compliance.html"   "Z:\public\" /Y >nul && echo   ^>  public\meetings-compliance.html
xcopy "%SRC%\public\meetings-setup.html"        "Z:\public\" /Y >nul && echo   ^>  public\meetings-setup.html
xcopy "%SRC%\public\meetings-insights.html"     "Z:\public\" /Y >nul && echo   ^>  public\meetings-insights.html

echo.
echo ============================================================
echo  NOW on prod (RDP) — server.js changed, so STOP + START:
echo     pm2 stop endeavour-dashboard
echo     timeout /t 5 /nobreak
echo     pm2 start endeavour-dashboard
echo.
echo  Then (Ctrl+F5): Insights -^> Meetings -^> tab "Actions".
echo  Editor+ sees an inline status dropdown per action; changing it
echo  closes/updates the action even on a closed PV. The md_action_updates
echo  audit table is created automatically on first load.
echo ============================================================
endlocal
