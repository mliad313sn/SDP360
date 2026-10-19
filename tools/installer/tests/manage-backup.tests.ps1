$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$manage = Join-Path $here '..\Manage-SDP.ps1'

# Manage-SDP -Backup (dump status) and -Prune (retention lanes). Everything
# runs in temp dirs with a temp -Config; no PostgreSQL is ever touched.

$script:TestTempDirs = @()
$logBefore = $env:SDP_INSTALLER_LOG_DIR
$env:SDP_INSTALLER_LOG_DIR = New-TempDir 'sdp-mb-logs'
$script:TestTempDirs += $env:SDP_INSTALLER_LOG_DIR

function New-Fixture([string]$dumpJs) {
    $inst = New-TempDir 'sdp-mb-inst'; $script:TestTempDirs += $inst
    Set-Content (Join-Path $inst 'server.js') '// current' -Encoding ascii
    Set-Content (Join-Path $inst '.env') 'REPORTS_BACKEND=sqlite' -Encoding ascii
    New-Item -ItemType Directory -Path (Join-Path $inst 'tools\pg') -Force | Out-Null
    Set-Content (Join-Path $inst 'tools\pg\dump-db.js') $dumpJs -Encoding ascii
    $bakLeaf = (Split-Path $inst -Leaf) + '-bak'
    $bak = Join-Path (Split-Path $inst -Parent) $bakLeaf
    New-Item -ItemType Directory -Path $bak -Force | Out-Null
    $script:TestTempDirs += $bak
    $cfgDir = New-TempDir 'sdp-mb-cfg'; $script:TestTempDirs += $cfgDir
    $cfg = Join-Path $cfgDir 'c.psd1'
    Set-Content $cfg ("@{ InstallDir = '" + $inst + "'; ServiceName = 'sdp-unit-none'; AppPort = 3499; BackupDir = '..\" + $bakLeaf + "'; PgHost = '127.0.0.1'; PgPort = 1; DbName = 'x'; RetentionFull = 2; RetentionDbOnly = 1 }") -Encoding ascii
    return @{ inst = $inst; bak = $bak; cfg = $cfg }
}

# Captures stdout only (what Install-SDP step 5 and the restore path read).
function Invoke-ManageOut([string[]]$mArgs) {
    $ErrorActionPreference = 'Continue'
    $out = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $manage @mArgs)
    return @{ code = $LASTEXITCODE; lines = $out; out = ($out -join "`n") }
}

try {

# ---- 1. full backup: dump tool prints to stdout then FAILS -> WARN, zip is still the last line ----
$f = New-Fixture "console.log('dump-chatter-line'); process.exit(1)"
$r = Invoke-ManageOut @('-Backup', '-Config', $f.cfg)
Assert-Eq $r.code 0 ('full backup exits 0 when only the dump fails: ' + $r.out)
Assert-True ($r.out -match 'pg dump skipped/failed') ('failed dump is reported as a WARN (stdout chatter must not mask it): ' + $r.out)
Assert-True ($r.out -match 'dump-chatter-line') 'dump tool output is still shown'
$last = [string]($r.lines | Select-Object -Last 1)
Assert-True ($last -like '*.zip' -and (Test-Path -LiteralPath $last)) ('last stdout line is the zip path (got: ' + $last + ')')
Assert-True ($last.StartsWith($f.bak)) 'zip written in the configured backup dir'

# ---- 2. full backup: dump tool prints then succeeds with a dump -> no WARN ----
$g = New-Fixture "console.log('dump-ok-line'); require('fs').writeFileSync(process.argv[2], '-- dump\n-- PostgreSQL database dump complete\n'); process.exit(0)"
$r2 = Invoke-ManageOut @('-Backup', '-Config', $g.cfg)
Assert-Eq $r2.code 0 ('full backup ok: ' + $r2.out)
Assert-True (-not ($r2.out -match 'pg dump skipped/failed')) 'no WARN when the dump succeeded'
$last2 = [string]($r2.lines | Select-Object -Last 1)
Assert-True ($last2 -like '*.zip' -and (Test-Path -LiteralPath $last2)) 'last stdout line is the zip path (case 2)'

# ---- 3. -DbOnly: dump exits 0 but writes nothing -> WARN, not "done" ----
$h = New-Fixture "console.log('no PG_URL'); process.exit(0)"
$r3 = Invoke-ManageOut @('-Backup', '-DbOnly', '-Config', $h.cfg)
Assert-Eq $r3.code 0 ('-DbOnly with nothing to dump exits 0: ' + $r3.out)
Assert-True ($r3.out -match 'no dump written') '-DbOnly warns when no dump file was written'
Assert-True (-not ($r3.out -match 'DB backup done')) '-DbOnly does not claim success without a file'

# ---- 4. -DbOnly: dump fails (with chatter) -> non-zero ----
$k = New-Fixture "console.log('chatter'); process.exit(1)"
$r4 = Invoke-ManageOut @('-Backup', '-DbOnly', '-Config', $k.cfg)
Assert-True ($r4.code -ne 0) ('-DbOnly dump failure exits non-zero: ' + $r4.out)
Assert-True ($r4.out -match 'pg dump failed') '-DbOnly failure message'

# ---- 5. -DbOnly: dump succeeds -> done ----
$m = New-Fixture "require('fs').writeFileSync(process.argv[2], '-- dump'); process.exit(0)"
$r5 = Invoke-ManageOut @('-Backup', '-DbOnly', '-Config', $m.cfg)
Assert-Eq $r5.code 0 '-DbOnly success exits 0'
Assert-True ($r5.out -match 'DB backup done') '-DbOnly success logged'
Assert-Eq (@(Get-ChildItem $m.bak -Filter 'sdp-db_*.sql')).Count 1 '-DbOnly wrote one dump'

# ---- 6. prune: pre-restore points have their own lane ----
$p = New-Fixture 'process.exit(0)'
$now = Get-Date
function New-Point([string]$name, [double]$hoursAgo) {
    $path = Join-Path $p.bak $name
    Set-Content $path 'x' -Encoding ascii
    (Get-Item -LiteralPath $path).LastWriteTime = $now.AddHours(-$hoursAgo)
}
# regular full points (older), newest first: weekly-a, manual-b, target-c, old-d
New-Point 'sdp-restore_scheduled_20260910-030000.zip' 48
New-Point 'sdp-restore_manual_20260909-120000.zip' 72
New-Point 'sdp-restore_manual_20260908-120000.zip' 96
New-Point 'sdp-restore_pre-v2.3.0_20260901-120000.zip' 200
# pre-restore points, ALL newer than every regular one
New-Point 'sdp-restore_pre-restore_20260912-100000.zip' 1
New-Point 'sdp-restore_pre-restore_20260912-090000.zip' 2
New-Point 'sdp-restore_pre-restore_20260912-080000.zip' 3
New-Point 'sdp-restore_pre-restore_20260912-070000.zip' 4
# db-only dumps
New-Point 'sdp-db_20260912-010000.sql' 5
New-Point 'sdp-db_20260911-010000.sql' 29
New-Point 'sdp-db_20260910-010000.sql' 53
$r6 = Invoke-ManageOut @('-Prune', '-Config', $p.cfg)   # config: RetentionFull 2, RetentionDbOnly 1
Assert-Eq $r6.code 0 ('prune exits 0: ' + $r6.out)
$left = @(Get-ChildItem $p.bak -File | ForEach-Object { $_.Name } | Sort-Object)
$expected = @(
    'sdp-db_20260912-010000.sql',
    'sdp-restore_manual_20260909-120000.zip',
    'sdp-restore_pre-restore_20260912-090000.zip',
    'sdp-restore_pre-restore_20260912-100000.zip',
    'sdp-restore_scheduled_20260910-030000.zip'
) | Sort-Object
Assert-Eq ($left -join ',') ($expected -join ',') 'prune keeps 2 newest regular + 2 newest pre-restore + 1 db-only'
Assert-True ($r6.out -match '\(6 removed\)') 'prune reports the removed count'

# ---- 7. prune with only pre-restore points and RetentionFull 1 -> still keeps 2 of them ----
$q = New-Fixture 'process.exit(0)'
$p = $q
New-Point 'sdp-restore_pre-restore_20260912-100000.zip' 1
New-Point 'sdp-restore_pre-restore_20260912-090000.zip' 2
New-Point 'sdp-restore_pre-restore_20260912-080000.zip' 3
New-Point 'sdp-restore_manual_20260901-120000.zip' 300
$r7 = Invoke-ManageOut @('-Prune', '-RetentionFull', '1', '-Config', $q.cfg)
Assert-Eq $r7.code 0 'prune (case 7) exits 0'
$left7 = @(Get-ChildItem $q.bak -File | ForEach-Object { $_.Name } | Sort-Object)
Assert-Eq ($left7 -join ',') ((@('sdp-restore_manual_20260901-120000.zip', 'sdp-restore_pre-restore_20260912-090000.zip', 'sdp-restore_pre-restore_20260912-100000.zip') | Sort-Object) -join ',') 'newer pre-restore points never push out the older regular point'

Write-Host ("manage-backup.tests: " + $script:AssertCount + " assertions ok")

} finally {
    $env:SDP_INSTALLER_LOG_DIR = $logBefore
    foreach ($d in $script:TestTempDirs) {
        try { if (Test-Path $d) { Remove-Item -Path $d -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
    }
}

exit 0
