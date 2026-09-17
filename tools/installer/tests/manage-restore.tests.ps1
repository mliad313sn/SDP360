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

# Manage-SDP logs go to a temp dir, never C:\ProgramData (inherited by the child).
$logBefore = $env:SDP_INSTALLER_LOG_DIR
$env:SDP_INSTALLER_LOG_DIR = New-TempDir 'sdp-mg-logs'
$script:TestTempDirs += $env:SDP_INSTALLER_LOG_DIR

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
Assert-True (-not (Test-Path -LiteralPath (Join-Path $f.inst 'sdp_dashboard.sql'))) 'stale root sdp_dashboard.sql removed by the restore (case 1)'
Assert-True ($r.out -match 'Removed a stale sdp_dashboard.sql') 'stale dump removal is logged (case 1)'
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
Assert-Eq (@(Get-ChildItem $g.bak -Filter 'sdp-restore_pre-restore_*.zip')).Count 0 'refused restore leaves no pre-restore zip behind'
Assert-True ($r2.out -match 'Removed the pre-restore point') 'removal of the useless pre-restore zip is logged'
Assert-True (Test-Path -LiteralPath (Join-Path $g.bak $target2)) 'the restore target itself is kept'

# Fixture target: a restore point whose OWN .env names a database and carries a
# complete root dump. $envText is the target's .env.
function New-TargetZip($fx, [string]$zipName, [string]$envText) {
    $st = New-TempDir 'sdp-mg-stgT'; $script:TestTempDirs += $st
    Set-Content (Join-Path $st 'server.js') '// older' -Encoding ascii
    Set-Content (Join-Path $st '.env') $envText -Encoding ascii
    Set-Content (Join-Path $st 'sdp_dashboard.sql') ("-- dump`r`nSELECT 1;`r`n`r`n--`r`n-- PostgreSQL database dump complete`r`n--`r`n") -Encoding ascii
    Compress-Archive -Path (Join-Path $st '*') -DestinationPath (Join-Path $fx.bak $zipName) -Force
}
# A dump tool that succeeds ONLY when process.env.PG_URL is exactly $url
# (proves the URL reached the child through the environment, not the .env file).
function Set-DumpOnlyFor($fx, [string]$url) {
    $js = "const fs=require('fs');if(process.env.PG_URL!=='" + $url + "'){process.exit(1)}" +
          "fs.writeFileSync(process.argv[2],'-- dump\nSELECT 1;\n\n--\n-- PostgreSQL database dump complete\n--\n');process.exit(0)"
    Set-Content (Join-Path $fx.inst 'tools\pg\dump-db.js') $js -Encoding ascii
}
$urlB = 'postgres://sdp_app:x@127.0.0.1:1/x'
$envBefore = $env:PG_URL

# ---- case 3: current .env has NO PG_URL, target's .env has one + complete dump, dump fails -> refuse ----
$h = New-Fixture 'REPORTS_BACKEND=sqlite'
$target3 = 'sdp-restore_manual_20260903-120000.zip'
New-TargetZip $h $target3 ('PG_URL=' + $urlB)
$r3 = Invoke-Manage @('-Restore', '-Name', $target3, '-Force', '-Config', $h.cfg)
Assert-True ($r3.code -ne 0) ('restore refuses when the target''s database cannot be dumped: ' + $r3.out)
Assert-True ($r3.out -match 'refusing to overwrite the database') 'refusal message'
Assert-True ($r3.out -match 'named by the restore point') 'refusal names the restore point''s .env as the source'
Assert-Eq (Get-Content (Join-Path $h.inst 'server.js') -Raw).Trim() '// current' 'code untouched when refused (case 3)'
Assert-Eq (Get-Content (Join-Path $h.inst '.env') -Raw).Trim() 'REPORTS_BACKEND=sqlite' '.env untouched when refused (case 3)'
Assert-True (-not (Test-Path -LiteralPath (Join-Path $h.inst 'sdp_dashboard.sql'))) 'no dump dropped into the install dir (case 3)'
Assert-True (-not ($r3.out -match 'sdp_app:x@')) 'PG_URL value never printed (case 3)'
Assert-True (-not ($r3.out -match '127\.0\.0\.1:1/x')) 'PG_URL host/db never printed (case 3)'
Assert-Eq (@(Get-ChildItem $h.bak -Filter 'sdp-restore_pre-restore_*.zip')).Count 0 'refused restore leaves no pre-restore zip behind (case 3)'

# ---- case 4: current .env has NO PG_URL, dump succeeds only for the target's URL -> guard passes ----
$k = New-Fixture 'REPORTS_BACKEND=sqlite'
Set-DumpOnlyFor $k $urlB
$target4 = 'sdp-restore_manual_20260904-120000.zip'
New-TargetZip $k $target4 ('PG_URL=' + $urlB)
$r4 = Invoke-Manage @('-Restore', '-Name', $target4, '-Force', '-Config', $k.cfg)
# The import then targets an unreachable PG (port 1): a non-zero exit is fine,
# the refusal is not.
Assert-True (-not ($r4.out -match 'refusing to overwrite the database')) ('guard passes when the target''s database was dumped: ' + $r4.out)
$pre4 = @(Get-ChildItem $k.bak -Filter 'sdp-restore_pre-restore_*.zip')
Assert-Eq $pre4.Count 1 'pre-restore point taken (case 4)'
Assert-True ((Get-ZipNames $pre4[0].FullName) -contains 'sdp_dashboard.sql') 'pre-restore point carries a root dump of the target''s database'
Assert-True (-not ($r4.out -match 'sdp_app:x@')) 'PG_URL value never printed (case 4)'

# ---- case 5: current .env names a DIFFERENT database -> the dump follows the one that will be dropped ----
$m = New-Fixture 'PG_URL=postgres://sdp_app:y@127.0.0.1:1/other'
Set-DumpOnlyFor $m $urlB
$target5 = 'sdp-restore_manual_20260905-120000.zip'
New-TargetZip $m $target5 ('PG_URL=' + $urlB)
$r5 = Invoke-Manage @('-Restore', '-Name', $target5, '-Force', '-Config', $m.cfg)
Assert-True (-not ($r5.out -match 'refusing to overwrite the database')) ('dump targets the database the restore drops: ' + $r5.out)
$pre5 = @(Get-ChildItem $m.bak -Filter 'sdp-restore_pre-restore_*.zip')
Assert-True ($pre5.Count -eq 1 -and ((Get-ZipNames $pre5[0].FullName) -contains 'sdp_dashboard.sql')) 'pre-restore point carries the dropped database''s dump (case 5)'
Assert-True (-not ($r5.out -match 'sdp_app:(x|y)@')) 'PG_URL values never printed (case 5)'

# A dump tool that always succeeds with a COMPLETE dump (never touches PG).
function Set-DumpAlwaysOk($fx) {
    $js = "require('fs').writeFileSync(process.argv[2],'-- dump\nSELECT 1;\n\n--\n-- PostgreSQL database dump complete\n--\n');process.exit(0)"
    Set-Content (Join-Path $fx.inst 'tools\pg\dump-db.js') $js -Encoding ascii
}
$importSignal = 'Restoring PostgreSQL database from the dump'

# ---- case 6: stale root dump in the install dir + restore point WITHOUT dump + PG_URL set ----
# -> no drop predicted, the stale file is deleted before the copy, no import attempted.
$n = New-Fixture ('PG_URL=' + $urlB)
Set-DumpAlwaysOk $n
Set-Content (Join-Path $n.inst 'sdp_dashboard.sql') ("-- stale`r`nSELECT 1;`r`n`r`n--`r`n-- PostgreSQL database dump complete`r`n--`r`n") -Encoding ascii
$stage6 = New-TempDir 'sdp-mg-stg6'; $script:TestTempDirs += $stage6
Set-Content (Join-Path $stage6 'server.js') '// older' -Encoding ascii
$target6 = 'sdp-restore_manual_20260906-120000.zip'
Compress-Archive -Path (Join-Path $stage6 '*') -DestinationPath (Join-Path $n.bak $target6) -Force
$r6 = Invoke-Manage @('-Restore', '-Name', $target6, '-Force', '-Config', $n.cfg)
Assert-Eq $r6.code 0 ('restore without a dump exits 0 despite a stale install-dir dump: ' + $r6.out)
Assert-True (-not ($r6.out -match [regex]::Escape($importSignal))) 'no database import attempted (case 6)'
Assert-True (-not ($r6.out -match 'psql')) 'psql never mentioned (case 6)'
Assert-True (-not (Test-Path -LiteralPath (Join-Path $n.inst 'sdp_dashboard.sql'))) 'stale install-dir dump removed (case 6)'
Assert-True ($r6.out -match 'Removed a stale sdp_dashboard.sql') 'stale dump removal logged (case 6)'
Assert-Eq (Get-Content (Join-Path $n.inst 'server.js') -Raw).Trim() '// older' 'code restored (case 6)'
$pre6 = @(Get-ChildItem $n.bak -Filter 'sdp-restore_pre-restore_*.zip')
Assert-True ($pre6.Count -eq 1 -and ((Get-ZipNames $pre6[0].FullName) -contains 'sdp_dashboard.sql')) 'pre-restore point holds the fresh dump, not the stale one (case 6)'
$chk6 = New-TempDir 'sdp-mg-chk6'; $script:TestTempDirs += $chk6
Expand-Archive -LiteralPath $pre6[0].FullName -DestinationPath $chk6 -Force
Assert-True (-not ((Get-Content (Join-Path $chk6 'sdp_dashboard.sql') -Raw) -match 'stale')) 'pre-restore dump is this run''s dump (case 6)'
Assert-True (-not ($r6.out -match 'sdp_app:x@')) 'PG_URL value never printed (case 6)'

# ---- case 7: quoted PG_URL in the current .env is read like an unquoted one ----
# Target has a complete dump and no .env -> the current .env names the dropped
# database. The dump tool only succeeds for the UNQUOTED url, so a quote left in
# the value would make the guard refuse.
$q = New-Fixture ('PG_URL="' + $urlB + '"')
Set-DumpOnlyFor $q $urlB
$stage7 = New-TempDir 'sdp-mg-stg7'; $script:TestTempDirs += $stage7
Set-Content (Join-Path $stage7 'server.js') '// older' -Encoding ascii
Set-Content (Join-Path $stage7 'sdp_dashboard.sql') ("-- dump`r`nSELECT 1;`r`n`r`n--`r`n-- PostgreSQL database dump complete`r`n--`r`n") -Encoding ascii
$target7 = 'sdp-restore_manual_20260907-120000.zip'
Compress-Archive -Path (Join-Path $stage7 '*') -DestinationPath (Join-Path $q.bak $target7) -Force
$r7 = Invoke-Manage @('-Restore', '-Name', $target7, '-Force', '-Config', $q.cfg)
Assert-True (-not ($r7.out -match 'refusing to overwrite the database')) ('double-quoted PG_URL detected like unquoted: ' + $r7.out)
Assert-True ($r7.out -match [regex]::Escape($importSignal)) 'import attempted with the quoted PG_URL (case 7)'
$pre7 = @(Get-ChildItem $q.bak -Filter 'sdp-restore_pre-restore_*.zip')
Assert-True ($pre7.Count -eq 1 -and ((Get-ZipNames $pre7[0].FullName) -contains 'sdp_dashboard.sql')) 'pre-restore point carries the dump (case 7)'
Assert-True (-not ($r7.out -match 'sdp_app:x@')) 'PG_URL value never printed (case 7)'

# ---- case 8: single-quoted PG_URL in the restore point's own .env (+ a comment line) ----
$w = New-Fixture 'REPORTS_BACKEND=sqlite'
Set-DumpOnlyFor $w $urlB
$target8 = 'sdp-restore_manual_20260908-120000.zip'
New-TargetZip $w $target8 ("# PG_URL=postgres://nobody@127.0.0.1:1/commented`r`nPG_URL='" + $urlB + "'")
$r8 = Invoke-Manage @('-Restore', '-Name', $target8, '-Force', '-Config', $w.cfg)
Assert-True (-not ($r8.out -match 'refusing to overwrite the database')) ('single-quoted zip PG_URL detected like unquoted: ' + $r8.out)
Assert-True ($r8.out -match [regex]::Escape($importSignal)) 'import attempted with the single-quoted zip PG_URL (case 8)'
Assert-True (-not ($r8.out -match 'sdp_app:x@')) 'PG_URL value never printed (case 8)'

# ---- case 9: restore point's .env has NO PG_URL (current .env has one) + complete dump ----
# The zip .env overwrites the current one, so the import step sees no PG_URL:
# no drop predicted, no import attempted, restore proceeds.
$v = New-Fixture ('PG_URL=' + $urlB)
$target9 = 'sdp-restore_manual_20260909-120000.zip'
New-TargetZip $v $target9 'REPORTS_BACKEND=sqlite'
$r9 = Invoke-Manage @('-Restore', '-Name', $target9, '-Force', '-Config', $v.cfg)
Assert-Eq $r9.code 0 ('restore to a point without PG_URL exits 0: ' + $r9.out)
Assert-True (-not ($r9.out -match 'refusing to overwrite the database')) 'no refusal (case 9)'
Assert-True (-not ($r9.out -match [regex]::Escape($importSignal))) 'no database import attempted (case 9)'
Assert-Eq (Get-Content (Join-Path $v.inst 'server.js') -Raw).Trim() '// older' 'code restored (case 9)'
Assert-Eq (Get-Content (Join-Path $v.inst '.env') -Raw).Trim() 'REPORTS_BACKEND=sqlite' '.env restored from the point (case 9)'
Assert-Eq (@(Get-ChildItem $v.bak -Filter 'sdp-restore_pre-restore_*.zip')).Count 1 'pre-restore point taken (case 9)'
Assert-True (-not ($r9.out -match 'sdp_app:x@')) 'PG_URL value never printed (case 9)'

# ---- case 10: corrupt restore point -> abort before anything, nothing changed ----
$c10 = New-Fixture ('PG_URL=' + $urlB)
$target10 = 'sdp-restore_manual_20260910-120000.zip'
[System.IO.File]::WriteAllBytes((Join-Path $c10.bak $target10), [byte[]](1..200 | ForEach-Object { $_ % 251 }))
$r10 = Invoke-Manage @('-Restore', '-Name', $target10, '-Force', '-Config', $c10.cfg)
Assert-True ($r10.code -ne 0) ('corrupt restore point -> non-zero exit: ' + $r10.out)
Assert-True ($r10.out -match 'Cannot read the restore point') 'message names the unreadable restore point (case 10)'
Assert-True ($r10.out -match 'nothing changed') 'message says nothing changed (case 10)'
Assert-Eq (Get-Content (Join-Path $c10.inst 'server.js') -Raw).Trim() '// current' 'code untouched (case 10)'
Assert-Eq (@(Get-ChildItem $c10.bak -Filter 'sdp-restore_pre-restore_*.zip')).Count 0 'no pre-restore point taken (case 10)'

# ---- case 11: current .env exists but cannot be read -> fail closed ----
$c11 = New-Fixture ('PG_URL=' + $urlB)
Set-DumpAlwaysOk $c11
$target11 = 'sdp-restore_manual_20260911-120000.zip'
New-TargetZip $c11 $target11 ('PG_URL=' + $urlB)
$lock11 = [System.IO.File]::Open((Join-Path $c11.inst '.env'), 'Open', 'ReadWrite', 'None')
try {
    $r11 = Invoke-Manage @('-Restore', '-Name', $target11, '-Force', '-Config', $c11.cfg)
} finally { $lock11.Dispose() }
Assert-True ($r11.code -ne 0) ('unreadable current .env -> non-zero exit: ' + $r11.out)
Assert-True ($r11.out -match 'Cannot read the current \.env - restore aborted, nothing changed') 'fail-closed message (case 11)'
Assert-Eq (Get-Content (Join-Path $c11.inst 'server.js') -Raw).Trim() '// current' 'code untouched (case 11)'
Assert-Eq (@(Get-ChildItem $c11.bak -Filter 'sdp-restore_pre-restore_*.zip')).Count 0 'no pre-restore point taken (case 11)'
Assert-True (-not ($r11.out -match 'sdp_app:x@')) 'PG_URL value never printed (case 11)'

Assert-Eq $env:PG_URL $envBefore 'test process PG_URL untouched'

Write-Host ("manage-restore.tests: " + $script:AssertCount + " assertions ok")

} finally {
    $env:SDP_INSTALLER_LOG_DIR = $logBefore
    foreach ($d in $script:TestTempDirs) {
        try { if (Test-Path $d) { Remove-Item -Path $d -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
    }
}

exit 0
