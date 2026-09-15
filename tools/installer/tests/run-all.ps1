# Runs every *.tests.ps1 in this folder in a child PowerShell; exit 1 if any fails.
# No Pester: each test file uses Assert-True / Assert-Eq below (dot-sourced via _assert.ps1).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$fail = 0
foreach ($t in (Get-ChildItem $here -Filter '*.tests.ps1' | Sort-Object Name)) {
    Write-Host ("== " + $t.Name) -ForegroundColor Cyan
    & powershell -NoProfile -ExecutionPolicy Bypass -File $t.FullName
    if ($LASTEXITCODE -ne 0) { $fail++; Write-Host ("   FAILED " + $t.Name) -ForegroundColor Red }
    else { Write-Host ("   ok") -ForegroundColor Green }
}
if ($fail -gt 0) { Write-Host "$fail test file(s) failed" -ForegroundColor Red; exit 1 }
Write-Host 'all installer tests passed' -ForegroundColor Green
exit 0
