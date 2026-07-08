#Requires -Version 5
# ─────────────────────────────────────────────────────────────────────────────
# STANDARD PROD DEPLOY (2026-07-08+): build a self-contained ZIP instead of
# xcopy-ing to the Z: share. No Z: mapping needed on the dev box.
#
#   Dev box:  run _deploy.cmd   (the post-commit hook regenerates it to call
#             this script) — or run this .ps1 directly. Produces
#             sdp-deploy_<sha>_<stamp>.zip in the repo root.
#   Prod:     copy the .zip to the server, extract it anywhere, run
#             _apply_on_prod.cmd from the extracted folder, then
#             _pm2_restart_prod.cmd.
#
# The ZIP contains every file changed since the last deploy at its repo-relative
# path under files\, a DELETIONS.txt manifest, a human MANIFEST.txt, and the
# _apply_on_prod.cmd installer.
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Stop'

$root = (git rev-parse --show-toplevel).Trim()
if (-not $root) { throw 'Not inside a git repository.' }
Set-Location $root

# Marker = last-deployed commit (shared across worktrees via the common git dir).
$gitCommon = (git rev-parse --git-common-dir).Trim()
if (-not [System.IO.Path]::IsPathRooted($gitCommon)) { $gitCommon = Join-Path $root $gitCommon }
$markerPath = Join-Path $gitCommon 'last-deployed'

$base = ''
if (Test-Path $markerPath) { $base = (Get-Content $markerPath -Raw).Trim() }
# Validate the marker points at a real commit; else fall back to the last
# confirmed prod baseline (Exec View v1) so a wiped/stale marker never
# accidentally packages the whole repo.
if (-not $base -or -not (git cat-file -e "$base^{commit}" 2>$null; $?)) { $base = '7fb62d9' }

$changed = @(git diff --name-only --diff-filter=ACMR "$base..HEAD")
$deleted = @(git diff --name-only --diff-filter=D    "$base..HEAD")

# Dev-only paths that never belong on prod (same spirit as the old hook's SKIP).
$skip = '^(iis/|docs/|tools/deploy/|tools/exec-pptx/(fixtures|refs)/|tools/exec-pptx/INTEGRATION_|_deploy\.cmd$|_apply_on_prod\.cmd$|sdp-deploy_.*\.zip$)'
$changed = @($changed | Where-Object { $_ -and ($_ -notmatch $skip) })
$deleted = @($deleted | Where-Object { $_ -and ($_ -notmatch $skip) })

if ($changed.Count -eq 0 -and $deleted.Count -eq 0) {
  Write-Host "Nothing to deploy since $base — no package built." -ForegroundColor Yellow
  exit 0
}

$head  = (git rev-parse --short HEAD).Trim()
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = Join-Path $env:TEMP ("sdp-deploy-$head-$stamp")
$filesDir = Join-Path $stage 'files'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $filesDir -Force | Out-Null

# Stage changed files at their repo-relative paths.
$copied = 0
foreach ($f in $changed) {
  $src = Join-Path $root ($f -replace '/', '\')
  if (-not (Test-Path $src)) { continue }
  $dst = Join-Path $filesDir ($f -replace '/', '\')
  New-Item -ItemType Directory -Path (Split-Path $dst) -Force | Out-Null
  Copy-Item $src $dst -Force
  $copied++
}

# Deletions manifest (prod-relative, backslashes, ASCII).
@($deleted | ForEach-Object { $_ -replace '/', '\' }) | Set-Content (Join-Path $stage 'DELETIONS.txt') -Encoding ASCII

# Human manifest.
$m = @("SDP Dashboard deploy package",
       "HEAD $head   base $base   built $stamp",
       "",
       "Changed ($($changed.Count)):") + @($changed | ForEach-Object { "  + $_" })
if ($deleted.Count) { $m += @("", "Deleted ($($deleted.Count)):") + @($deleted | ForEach-Object { "  - $_" }) }
$m | Set-Content (Join-Path $stage 'MANIFEST.txt') -Encoding UTF8

# Prod installer (runs on the prod host in cmd.exe).
$installer = @'
@echo off
setlocal enabledelayedexpansion
:: Apply this SDP Dashboard deploy package on the PROD server.
:: Extract the zip anywhere on prod, then run this file from the extracted folder.
set "APP=%SDP_PROD_DIR%"
if "%APP%"=="" set "APP=C:\Apps\SDP-Dashboard"
if not exist "%APP%\server.js" (
  echo [ERROR] "%APP%" does not look like the app root ^(no server.js^).
  echo Set SDP_PROD_DIR to the correct path and re-run.
  pause & exit /b 1
)
echo Applying package to %APP% ...
xcopy "%~dp0files" "%APP%" /E /Y /I
if errorlevel 1 ( echo [ERROR] file copy failed. & pause & exit /b 1 )
if exist "%~dp0DELETIONS.txt" (
  for /f "usebackq delims=" %%F in ("%~dp0DELETIONS.txt") do (
    if exist "%APP%\%%F" ( del /F /Q "%APP%\%%F" && echo   deleted %%F )
  )
)
echo.
echo Files applied. Now RESTART the server ^(server.js + boot-cached HTML need it^):
echo     _pm2_restart_prod.cmd     ^(pm2 stop -^> timeout 5 -^> start; NOT reload^)
echo render.py is copy-only. After the restart, each user presses Ctrl+F5 once.
echo.
pause
'@
$installer | Set-Content (Join-Path $stage '_apply_on_prod.cmd') -Encoding ASCII

# Zip into the repo root (gitignored).
$zip = Join-Path $root ("sdp-deploy_${head}_${stamp}.zip")
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force

# Advance the marker (packaged == will be deployed; mirrors the old _deploy.cmd).
(git rev-parse HEAD).Trim() | Set-Content $markerPath -Encoding ASCII

Write-Host ""
Write-Host ("Built " + (Split-Path $zip -Leaf)) -ForegroundColor Green
Write-Host ("  $copied file(s) staged, $($deleted.Count) deletion(s)  (since $base)")
Write-Host ""
Write-Host "Deploy on prod:" -ForegroundColor Cyan
Write-Host "  1. Copy the .zip to the prod server and extract it anywhere."
Write-Host "  2. Run _apply_on_prod.cmd from the extracted folder."
Write-Host "  3. Run _pm2_restart_prod.cmd on prod (server.js + cached HTML need a restart)."
