$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$manage = Join-Path $here '..\Manage-SDP.ps1'

# Manage-SDP -Restore takes a pre-restore restore point of the CURRENT state
# before it stops or overwrites anything, and refuses to drop a database it
# could not dump first. Everything runs in temp dirs with a temp -Config
# (unknown pm2 name, unreachable PG) - never against config.psd1's paths.

# Best-effort cleanup list (same pattern as confirm.tests.ps1).
$script:TestTempDirs = @()

Add-Type -AssemblyName System.IO.Compression.FileSystem
function Get-ZipNames([string]$path) {
    $z = [System.IO.Compression.ZipFile]::OpenRead($path)
    try { return @($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() }
}

# Builds an install dir + a sibling backup dir + a temp config pointing at them.
# BackupDir is RELATIVE (Manage-SDP joins it onto InstallDir, like config.psd1).
function New-Fixture([string]$envText) {
    $inst = New-TempDir 'sdp-mg-inst'; $script:TestTempDirs += $inst
    Set-Content (Join-Path $inst 'server.js') '// current' -Encoding ascii
    Set-Content (Join-Path $inst '.env') $envText -Encoding ascii
    New-Item -ItemType Directory -Path (Join-Path $inst 'tools\pg') -Force | Out-Null
    # A dump tool that always fails: no PostgreSQL is ever touched.
    Set-Content (Join-Path $inst 'tools\pg\dump-db.js') 'process.exit(1)' -Encoding ascii
    $bakLeaf = (Split-Path $inst -Leaf) + '-bak'
    $bak = Join-Path (Split-Path $inst -Parent) $bakLeaf
    New-Item -ItemType Directory -Path $bak -Force | Out-Null
    $script:TestTempDirs += $bak
    $cfgDir = New-TempDir 'sdp-cfg'; $script:TestTempDirs += $cfgDir
    $cfg = Join-Path $cfgDir 'c.psd1'
    Set-Content $cfg ("@{ InstallDir = '" + $inst + "'; ServiceName = 'sdp-unit-none'; AppPort = 3499; BackupDir = '..\" + $bakLeaf + "'; PgHost = '127.0.0.1'; PgPort = 1; DbName = 'x' }") -Encoding ascii
    return @{ inst = $inst; bak = $bak; cfg = $cfg }
}

function Invoke-Manage([string[]]$mArgs) {
    # 2>&1 on a native exe under 'Stop' turns any stderr line into a thrown
    # NativeCommandError (PS 5.1) - relax it for this call only.
    $ErrorActionPreference = 'Continue'
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $manage @mArgs 2>&1
    return @{ code = $LASTEXITCODE; out = (@($out) -join "`n") }
}

try {

# ---- case 1: sqlite-shaped install (no PG_URL) - pre-restore point taken, restore works ----
$f = New-Fixture 'REPORTS_BACKEND=sqlite'
# a stale root dump left by an earlier restore must NOT ride into the safety point
Set-Content (Join-Path $f.inst 'sdp_dashboard.sql') '-- stale' -Encoding ascii
$stage = New-TempDir 'sdp-mg-stg'; $script:TestTempDirs += $stage
Set-Content (Join-Path $stage 'server.js') '// older' -Encoding ascii
$target = 'sdp-restore_manual_20260901-120000.zip'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath (Join-Path $f.bak $target) -Force

$r = Invoke-Manage @('-Restore', '-Name', $target, '-Force', '-Config', $f.cfg)
Assert-Eq $r.code 0 ('restore exits 0: ' + $r.out)
Assert-Eq (Get-Content (Join-Path $f.inst 'server.js') -Raw).Trim() '// older' 'code restored'
$pre = @(Get-ChildItem $f.bak -Filter 'sdp-restore_pre-restore_*.zip')
Assert-Eq $pre.Count 1 'exactly one pre-restore restore point was taken'
$names = Get-ZipNames $pre[0].FullName
Assert-True ($names -contains 'server.js') 'pre-restore point holds the CURRENT code'
Assert-True ($names -contains '.env') 'pre-restore point holds the CURRENT .env'
Assert-True (-not ($names -contains 'sdp_dashboard.sql')) 'stale root sdp_dashboard.sql is NOT carried into the pre-restore point'
Assert-True ($r.out -match 'Pre-restore restore point') 'the pre-restore point is announced'
# the safety point really is the state BEFORE the restore
$chk = New-TempDir 'sdp-mg-chk'; $script:TestTempDirs += $chk
Expand-Archive -LiteralPath $pre[0].FullName -DestinationPath $chk -Force
Assert-Eq (Get-Content (Join-Path $chk 'server.js') -Raw).Trim() '// current' 'pre-restore point server.js is the pre-restore code'

# ---- case 2: PG install + target with a complete dump + no dump possible -> refuse, nothing changed ----
$g = New-Fixture 'PG_URL=postgres://sdp_app:x@127.0.0.1:1/x'
$stage2 = New-TempDir 'sdp-mg-stg2'; $script:TestTempDirs += $stage2
Set-Content (Join-Path $stage2 'server.js') '// older' -Encoding ascii
Set-Content (Join-Path $stage2 'sdp_dashboard.sql') ("-- dump`r`nSELECT 1;`r`n`r`n--`r`n-- PostgreSQL database dump complete`r`n--`r`n") -Encoding ascii
$target2 = 'sdp-restore_manual_20260902-120000.zip'
Compress-Archive -Path (Join-Path $stage2 '*') -DestinationPath (Join-Path $g.bak $target2) -Force

$r2 = Invoke-Manage @('-Restore', '-Name', $target2, '-Force', '-Config', $g.cfg)
Assert-True ($r2.code -ne 0) ('restore refuses (non-zero exit): ' + $r2.out)
Assert-True ($r2.out -match 'refusing to overwrite the database') 'message says it refuses to overwrite the database'
Assert-Eq (Get-Content (Join-Path $g.inst 'server.js') -Raw).Trim() '// current' 'code untouched when refused'
Assert-True (-not (Test-Path -LiteralPath (Join-Path $g.inst 'sdp_dashboard.sql'))) 'no dump dropped into the install dir when refused'
Assert-Eq (Get-Content (Join-Path $g.inst '.env') -Raw).Trim() 'PG_URL=postgres://sdp_app:x@127.0.0.1:1/x' '.env untouched when refused'
Assert-True (-not ($r2.out -match 'sdp_app:x@')) 'PG_URL value never printed'

Write-Host ("manage-restore.tests: " + $script:AssertCount + " assertions ok")

} finally {
    foreach ($d in $script:TestTempDirs) {
        try { if (Test-Path $d) { Remove-Item -Path $d -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
    }
}

exit 0
