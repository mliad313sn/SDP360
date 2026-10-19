@echo off
:: ---------------------------------------------------------------------------
:: Run on the DEV box AFTER you have confirmed the latest sdp-deploy zip is live
:: on prod (files applied + pm2 restarted + Ctrl+F5 verified).
:: Advances the deploy marker to the current HEAD so the NEXT package only
:: contains changes made after this point -- not the whole backlog again.
:: ---------------------------------------------------------------------------
setlocal
for /f "delims=" %%d in ('git rev-parse --git-common-dir') do set "GD=%%d"
git rev-parse HEAD > "%GD%\last-deployed"
for /f "delims=" %%h in ('git rev-parse --short HEAD') do set "H=%%h"
echo Marked %H% as last-deployed. The next zip will diff from here.
endlocal
