#Requires -Version 5
# =============================================================================
# STANDARD PROD DEPLOY (2026-07-08+): build a self-contained ZIP instead of
# xcopy-ing to the Z: share. No Z: mapping needed on the dev box.
#
#   Dev box:  run _deploy.cmd (the post-commit hook regenerates it to call this
#             script) - or run this .ps1 directly. Produces
#             sdp-deploy_<sha>_<stamp>.zip in the repo root.
#   Prod:     copy the .zip to the server, extract it anywhere, run
#             _apply_on_prod.cmd from the extracted folder, then
#             _pm2_restart_prod.cmd.
#
# The ZIP contains every file changed since the last deploy at its repo-relative
# path under files\, a DELETIONS.txt manifest, a human MANIFEST.txt, and the
# _apply_on_prod.cmd installer.
#
# NOTE: keep this file PURE ASCII - Windows PowerShell 5.1 reads .ps1 as ANSI,
# so non-ASCII chars (em-dashes, box-drawing) corrupt the parse.
# =============================================================================
# -Include a,b : files to ship even though they are unchanged since the marker (a lot that
# sat behind it and is now released by hand). Each must be a tracked file.
param([string[]]$Include = @())
$ErrorActionPreference = 'Stop'

$root = (git rev-parse --show-toplevel).Trim()
if (-not $root) { throw 'Not inside a git repository.' }
Set-Location $root

# Marker = last-deployed commit (shared across worktrees via the common git dir).
$gitCommon = (git rev-parse --git-common-dir).Trim()
if (-not [System.IO.Path]::IsPathRooted($gitCommon)) { $gitCommon = Join-Path $root $gitCommon }
$markerPath = Join-Path $gitCommon 'last-deployed'

$base = ''
if (Test-Path $markerPath) {
  $raw = Get-Content $markerPath -Raw -ErrorAction SilentlyContinue
  if ($raw) { $base = $raw.Trim() }
}
# Validate the marker points at a real commit; else fall back to the last
# confirmed prod baseline (Exec View v1) so a wiped/stale marker never packages
# the whole repo.
if ($base) {
  $null = git rev-parse --verify --quiet $base 2>$null
  if ($LASTEXITCODE -ne 0) { $base = '' }
}
if (-not $base) { $base = '7fb62d9' }

$changed = @(git diff --name-only --diff-filter=ACMR "$base..HEAD")
$deleted = @(git diff --name-only --diff-filter=D    "$base..HEAD")
foreach ($inc in $Include) {
  $p = ($inc -replace '\','/').Trim()
  if (-not $p) { continue }
  $null = git ls-files --error-unmatch -- $p 2>$null
  if ($LASTEXITCODE -ne 0) { throw "-Include: '$p' is not a tracked file." }
  if ($changed -notcontains $p) { $changed += $p; Write-Host "  + included by hand: $p" -ForegroundColor Cyan }
}

# G-10 — name the lots this package can never carry (merged, never deployed, and now
# behind the marker). Warning only: it never blocks a build, and an unreadable register
# is silently skipped.
$frozenCheck = Join-Path $PSScriptRoot 'Check-FrozenLots.ps1'
if (Test-Path $frozenCheck) { & powershell -NoProfile -ExecutionPolicy Bypass -File $frozenCheck -Base $base -Root $root }

# Dev-only paths that never belong on prod (same spirit as the old hook SKIP).
$skip = '^(iis/|docs/|tools/deploy/|tools/installer-build/|tools/installer/tests/|tools/exec-pptx/(fixtures|refs)/|tools/exec-pptx/INTEGRATION_|_deploy\.cmd$|_apply_on_prod\.cmd$|sdp-deploy_.*\.zip$)'
$changed = @($changed | Where-Object { $_ -and ($_ -notmatch $skip) })
$deleted = @($deleted | Where-Object { $_ -and ($_ -notmatch $skip) })

if ($changed.Count -eq 0 -and $deleted.Count -eq 0) {
  Write-Host "Nothing to deploy since $base - no package built." -ForegroundColor Yellow
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

# Step 4 (SDP-DASH-2.0) -- dependencies. When package-lock.json changed, the package carries a
# COMPLETE production node_modules built here (npm ci --omit=dev), so prod never runs npm (corporate
# proxy, native build). better-sqlite3's native binding is copied from this box's node_modules:
# same Windows x64 + Node major as prod. _apply_on_prod.cmd swaps it in with a rollback.
if ($changed -contains 'package-lock.json') {
  Write-Host "package-lock.json changed - building production node_modules ..." -ForegroundColor Cyan
  $nm = Join-Path $stage 'deps'
  New-Item -ItemType Directory -Path $nm -Force | Out-Null
  Copy-Item (Join-Path $root 'package.json'), (Join-Path $root 'package-lock.json') $nm
  if (Test-Path (Join-Path $root 'vendor')) { Copy-Item (Join-Path $root 'vendor') (Join-Path $nm 'vendor') -Recurse }
  Push-Location $nm
  $env:NODE_TLS_REJECT_UNAUTHORIZED = '0'      # dev box behind TLS inspection; this process only
  & npm ci --omit=dev --ignore-scripts --no-audit --no-fund --strict-ssl=false | Out-Host
  $ok = ($LASTEXITCODE -eq 0)
  Remove-Item Env:\NODE_TLS_REJECT_UNAUTHORIZED
  Pop-Location
  if (-not $ok) { throw "npm ci failed - no package built" }
  $bin = Join-Path $root 'node_modules\better-sqlite3\build'
  if (-not (Test-Path $bin)) { throw "better-sqlite3 binding not found in $bin" }
  Copy-Item $bin (Join-Path $nm 'node_modules\better-sqlite3\build') -Recurse -Force
  & node -e "require(process.argv[1]+'/node_modules/better-sqlite3')(':memory:').prepare('select 1').get()" $nm
  if ($LASTEXITCODE -ne 0) { throw "better-sqlite3 does not load from the built node_modules" }
  Move-Item (Join-Path $nm 'node_modules') (Join-Path $stage 'node_modules')
  Remove-Item $nm -Recurse -Force
}

# Deletions manifest (prod-relative, backslashes, ASCII).
@($deleted | ForEach-Object { $_ -replace '/', '\' }) | Set-Content (Join-Path $stage 'DELETIONS.txt') -Encoding ASCII

# Human manifest.
$m = @("SDP Dashboard deploy package", "HEAD $head   base $base   built $stamp", "", "Changed ($($changed.Count)):")
$m += @($changed | ForEach-Object { "  + $_" })
if ($deleted.Count) { $m += @("", "Deleted ($($deleted.Count)):"); $m += @($deleted | ForEach-Object { "  - $_" }) }
$m | Set-Content (Join-Path $stage 'MANIFEST.txt') -Encoding UTF8

# Prod installer - a committed template copied in as _apply_on_prod.cmd.
Copy-Item (Join-Path $PSScriptRoot 'apply-on-prod.cmd') (Join-Path $stage '_apply_on_prod.cmd') -Force

# Zip into the repo root (gitignored). Remove any older packages first so there
# is only ever ONE sdp-deploy_*.zip = the current one (no "which zip?" doubt).
Get-ChildItem -Path $root -Filter 'sdp-deploy_*.zip' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
$zip = Join-Path $root ("sdp-deploy_${head}_${stamp}.zip")
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force

# NOTE: the marker is intentionally NOT advanced here. Building a zip is not the
# same as deploying it. In the ZIP model you may build/commit several times
# before actually applying on prod, so every rebuild must keep the FULL backlog
# since the last CONFIRMED prod deploy. Advance the marker only after you have
# verified the zip is live on prod -- run tools\deploy\mark-deployed.cmd then.

Write-Host ""
Write-Host ("Built " + (Split-Path $zip -Leaf)) -ForegroundColor Green
Write-Host ("  $copied file(s) staged, $($deleted.Count) deletion(s)  (since $base)")
Write-Host ""
Write-Host "Deploy on prod:" -ForegroundColor Cyan
Write-Host "  1. Copy the .zip to the prod server and extract it anywhere."
Write-Host "  2. Run _apply_on_prod.cmd from the extracted folder."
Write-Host "  3. Run _pm2_restart_prod.cmd on prod (server.js + cached HTML need a restart)."
Write-Host "  4. Back on THIS box, once you've confirmed it's live:" -ForegroundColor Cyan
Write-Host "     tools\deploy\mark-deployed.cmd   (so the next zip starts fresh from here)"
