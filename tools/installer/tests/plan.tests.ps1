$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$install = Join-Path $here '..\Install-SDP.ps1'
$empty = New-TempDir 'sdp-plan-empty'
$inst = New-TempDir 'sdp-plan-inst'; Set-Content (Join-Path $inst 'server.js') '//' -Encoding ascii
function CfgFor($dir) { $f = Join-Path (New-TempDir 'sdp-cfg') 'c.psd1'; Set-Content $f ("@{ InstallDir = '" + $dir + "'; ServiceName = 'sdp-unit'; AppPort = 3499; BackupDir = '..\SDP-Backups-unit' }") -Encoding ascii; return $f }
function Plan([string[]]$sw, $dir) {
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $install @sw -PrintPlan -Config (CfgFor $dir) -BundleRoot $env:TEMP
    return ($out | Where-Object { "$_" -like 'PLAN=*' } | Select-Object -Last 1)
}
Assert-Eq (Plan @('-Fresh') $empty)                       'PLAN=1,2,3,4,4b,6,7'    'plain fresh has no step 5'
Assert-Eq (Plan @('-Fresh', '-ForceOverwrite') $inst)     'PLAN=1,2,3,5,4,4b,6,7'  'fresh over existing backs up BEFORE step 4'
Assert-Eq (Plan @('-Reinstall') $inst)                    'PLAN=1,2,3,5,4,4b,6,7'  'reinstall backs up BEFORE step 4'
Assert-Eq (Plan @('-Reinstall', '-ConfirmDataLoss') $inst) 'PLAN=1,2,3,5,4,4b,6,7' 'reinstall+drop: backup precedes the DROP'
Assert-Eq (Plan @('-Patch') $inst)                        'PLAN=1,2,3,5,6,7'       'patch unchanged'
Assert-Eq (Plan @('-Upgrade') $inst)                      'PLAN=1,2,3,4,5,6,7'     'upgrade unchanged'

# -ForceOverwrite on an EMPTY dir: nothing to overwrite, so no backup step is
# inserted - the plain fresh plan runs, same as bare -Fresh.
Assert-Eq (Plan @('-Fresh', '-ForceOverwrite') $empty)    'PLAN=1,2,3,4,4b,6,7'    'ForceOverwrite on an empty dir -> plain fresh plan (nothing to back up)'

# -Fresh -SeedData -ForceOverwrite over an EXISTING dir: the guarded-fresh
# reorder (backup before step 4) AND the seed step both apply.
Assert-Eq (Plan @('-Fresh', '-SeedData', '-ForceOverwrite') $inst) 'PLAN=1,2,3,5,4,4b,6,7,8' 'fresh+seed+ForceOverwrite over existing -> reordered plan ends with ,8'

Write-Host ("plan.tests: " + $script:AssertCount + " assertions ok")

# ---- -PrintPlan is a genuine dry run: no admin check, and no install-*.log
# file is created in C:\ProgramData\SDP-Dashboard\logs. Skip the assertion
# entirely if that folder does not exist on this box (nothing to compare
# against, and nothing this test should create).
$LogDir = 'C:\ProgramData\SDP-Dashboard\logs'
if (Test-Path $LogDir) {
    $before = (Get-ChildItem -Path $LogDir -Filter 'install-*.log' -ErrorAction SilentlyContinue | Measure-Object).Count
    Plan @('-Fresh') $empty | Out-Null
    $after = (Get-ChildItem -Path $LogDir -Filter 'install-*.log' -ErrorAction SilentlyContinue | Measure-Object).Count
    Assert-Eq $after $before '-PrintPlan creates no new install-*.log file'
    Write-Host ("plan.tests: " + $script:AssertCount + " assertions ok (incl. no-log-file check)")
} else {
    Write-Host 'plan.tests: skipped no-log-file check (C:\ProgramData\SDP-Dashboard\logs does not exist on this box)'
}

exit 0
