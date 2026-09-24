# G-10 (audit 2026-09-24) — warn about work a cumulative ZIP can never carry.
#
# A lot that was merged on main but applied to prod through a STRIPPED zip, after which
# HEAD was marked, now sits behind the deploy marker: `git diff marker..HEAD` will never
# list its files again, so every future cumulative package omits it in silence. The only
# guard until now was a paragraph in CLAUDE.md.
#
# This prints a warning and ALWAYS exits 0 — packaging is never blocked by it. Entries
# live in frozen-lots.json and are removed once the files have been packaged by hand.
#
#   powershell -File tools\deploy\Check-FrozenLots.ps1 -Base <marker-sha> [-Root <repo>]
param(
  [Parameter(Mandatory = $true)][string]$Base,
  [string]$Root = ''
)

$ErrorActionPreference = 'Continue'
if (-not $Root) { $Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$lotsFile = Join-Path $PSScriptRoot 'frozen-lots.json'

if (-not (Test-Path $lotsFile)) { exit 0 }

try {
  # -Encoding UTF8 is load-bearing: Windows PowerShell 5.1 reads as ANSI by default and
  # turns every accented character of the register into mojibake in the warning.
  $lots = (Get-Content $lotsFile -Raw -Encoding UTF8 | ConvertFrom-Json).lots
} catch {
  Write-Host "[frozen-lots] register unreadable - skipped: $($_.Exception.Message)" -ForegroundColor Yellow
  exit 0
}
if (-not $lots) { exit 0 }

Push-Location $Root
try {
  # An unusable base is not this script's problem to solve: the packager already falls
  # back to a known baseline. Say nothing rather than guess.
  $null = & git rev-parse --verify --quiet "$Base" 2>$null
  if ($LASTEXITCODE -ne 0) { exit 0 }

  $behind = @()
  foreach ($lot in $lots) {
    # Behind the marker = the lot's commit is an ancestor of the base, so a diff from
    # the base cannot contain it.
    $null = & git merge-base --is-ancestor $lot.commit "$Base" 2>$null
    if ($LASTEXITCODE -eq 0) { $behind += $lot }
  }

  if ($behind.Count -gt 0) {
    Write-Host ''
    Write-Host '  ATTENTION - lots geles DERRIERE le marqueur de deploiement' -ForegroundColor Yellow
    Write-Host '  Ce paquet ne les contient pas, et aucun paquet cumulatif ne les contiendra jamais.' -ForegroundColor Yellow
    Write-Host '  Ils doivent etre empaquetes A LA MAIN.' -ForegroundColor Yellow
    foreach ($lot in $behind) {
      Write-Host ("   - {0} ({1}, gele depuis {2})" -f $lot.id, $lot.commit, $lot.since) -ForegroundColor Yellow
      Write-Host ("     {0}" -f $lot.why)
      Write-Host ("     fichiers : {0}" -f ($lot.paths -join ' '))
    }
    Write-Host ''
  }
} catch {
  Write-Host "[frozen-lots] check skipped: $($_.Exception.Message)" -ForegroundColor Yellow
} finally {
  Pop-Location
}

exit 0
