$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$confirm = Join-Path $here '..\Confirm-Destructive.ps1'

# Best-effort cleanup list: every temp dir created below is appended here and
# removed at the end (try/catch, non-fatal if a handle is still open). Same
# pattern as detect.tests.ps1.
$script:TestTempDirs = @()

try {

# situation fixture (reachable DB with counts) + a backup dir with several restore points
$bak = New-TempDir 'sdp-bak'; $script:TestTempDirs += $bak
$stage = New-TempDir 'sdp-stg'; $script:TestTempDirs += $stage
Set-Content (Join-Path $stage 'server.js') '//' -Encoding ascii; Set-Content (Join-Path $stage 'sdp_dashboard.sql') '--' -Encoding ascii
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath (Join-Path $bak 'sdp-restore_pre-v2.4.0_20260912-020011.zip') -Force
Set-Content (Join-Path $bak 'sdp-db_20260913-020000.sql') '--' -Encoding ascii

# a real restore point layout WITHOUT a root sdp_dashboard.sql - server.js at
# the root, data\r.db and a NESTED repo file db\postgres\reports\001_init.sql
# (the exact shape "any .sql anywhere" used to false-positive on).
$stage2 = New-TempDir 'sdp-stg2'; $script:TestTempDirs += $stage2
New-Item -ItemType Directory -Path (Join-Path $stage2 'data') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage2 'db\postgres\reports') -Force | Out-Null
Set-Content (Join-Path $stage2 'server.js') '//' -Encoding ascii
Set-Content (Join-Path $stage2 'data\r.db') 'x' -Encoding ascii
Set-Content (Join-Path $stage2 'db\postgres\reports\001_init.sql') '--' -Encoding ascii
Compress-Archive -Path (Join-Path $stage2 '*') -DestinationPath (Join-Path $bak 'sdp-restore_nodump_20260912-030000.zip') -Force

# a corrupt "zip" - a plain text file wearing a restore-point name.
Set-Content (Join-Path $bak 'sdp-restore_x_20260901-120000.zip') 'not a real zip' -Encoding ascii

$sit = @{
    install = @{ dir = 'C:\Apps\X'; version = '2.3.1'; has_env = $true; has_server_js = $true }
    db = @{ reachable = $true; db = 'sdp_dashboard_test'; size_mb = 12.5; counts = @{ sites = 11; weekly_reports = 412; md_meetings = 96; insp_inspections = 41; users = 23; assets = 2400 } }
    backups = @{ dir = $bak; last_full = @{ name = 'sdp-restore_pre-v2.4.0_20260912-020011.zip'; age_hours = 70; size_mb = 1 } }
    bundle = @{ version = '2.4.0' }
    verdict = @{ state = 'installed' }
}
$sitDir = New-TempDir 'sdp-sit'; $script:TestTempDirs += $sitDir
$sitFile = Join-Path $sitDir 'sit.json'
($sit | ConvertTo-Json -Depth 6) | Set-Content $sitFile -Encoding ascii
$sitUnreach = $sit.Clone(); $sitUnreach.db = @{ reachable = $false; error = 'refused' }
$sitDir2 = New-TempDir 'sdp-sit'; $script:TestTempDirs += $sitDir2
$sitFile2 = Join-Path $sitDir2 'sit2.json'
($sitUnreach | ConvertTo-Json -Depth 6) | Set-Content $sitFile2 -Encoding ascii

# an empty situation file (0 bytes).
$emptySitDir = New-TempDir 'sdp-sit'; $script:TestTempDirs += $emptySitDir
$emptySitFile = Join-Path $emptySitDir 'empty.json'
New-Item -ItemType File -Path $emptySitFile -Force | Out-Null

# a malformed (non-JSON) situation file.
$badSitDir = New-TempDir 'sdp-sit'; $script:TestTempDirs += $badSitDir
$badSitFile = Join-Path $badSitDir 'bad.json'
Set-Content $badSitFile '{ this is not json' -Encoding ascii

# Detect-SDP.ps1's own catch-path minimal JSON shape (STATE=unknown): only
# install.dir is populated, backups.dir is null, db unreachable.
$minimal = @{
    install = @{ dir = 'C:\Apps\X'; has_server_js = $false; has_env = $false }
    runtime = @{}
    db = @{ reachable = $false; error = 'detection failed' }
    backups = @{ dir = $null; count = 0 }
    bundle = @{}
    disk = @{}
    verdict = @{ state = 'unknown'; recommended = $null; downgrade = $false; notes = @() }
}
$minimalSitDir = New-TempDir 'sdp-sit'; $script:TestTempDirs += $minimalSitDir
$minimalSitFile = Join-Path $minimalSitDir 'minimal.json'
($minimal | ConvertTo-Json -Depth 6) | Set-Content $minimalSitFile -Encoding ascii

# $stdin: a string to pipe, or the sentinel 'CLOSED' to run with stdin redirected from NUL
# (an untyped parameter - a [string] one would coerce $null to '' and never take the NUL branch).
function Run($stdin, [string[]]$extra) {
    $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $confirm) + $extra
    if ($stdin -eq 'CLOSED') { cmd /c ('powershell ' + (($psArgs | ForEach-Object { '"' + $_ + '"' }) -join ' ') + ' < NUL') | Out-Null }
    else { $stdin | & powershell @psArgs | Out-Null }
    return $LASTEXITCODE
}
# Same as Run, but also captures combined stdout+stderr so tests can assert
# on the SCREEN CONTENT (e.g. "REFUSED:", "DROPPED"), not just the exit code -
# an exit-code-only assertion can pass for the wrong reason (see the .sql /
# missing.zip tests below, which used to pass only because the piped phrase
# happened to be wrong).
function RunOut($stdin, [string[]]$extra) {
    $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $confirm) + $extra
    if ($stdin -eq 'CLOSED') {
        $txt = (cmd /c ('powershell ' + (($psArgs | ForEach-Object { '"' + $_ + '"' }) -join ' ') + ' < NUL 2>&1') | Out-String)
    } else {
        $txt = ($stdin | & powershell @psArgs 2>&1 | Out-String)
    }
    return @{ Code = $LASTEXITCODE; Out = $txt }
}
Assert-Eq (Run 'WRONG' @('-Action', 'reinstall', '-Situation', $sitFile)) 1 'wrong phrase -> 1'
Assert-Eq (Run 'REINSTALL' @('-Action', 'reinstall', '-Situation', $sitFile)) 0 'REINSTALL -> 0'
Assert-Eq (Run 'reinstall' @('-Action', 'reinstall', '-Situation', $sitFile)) 1 'case-sensitive'
Assert-Eq (Run 'CLOSED' @('-Action', 'reinstall', '-Situation', $sitFile)) 1 'closed stdin -> 1'
Assert-Eq (Run 'RESTORE 20260912' @('-Action', 'restore', '-Situation', $sitFile, '-Target', 'sdp-restore_pre-v2.4.0_20260912-020011')) 0 'a name without .zip is accepted (suffix appended like Manage-SDP)'
Assert-Eq (Run '' @('-Action', 'reinstall', '-Situation', $sitFile)) 1 'empty line -> 1'
Assert-Eq (Run 'DROP sdp_dashboard_test' @('-Action', 'dropdb', '-Situation', $sitFile)) 0 'DROP <db> -> 0'
Assert-Eq (Run 'DROP sdp_dashboard' @('-Action', 'dropdb', '-Situation', $sitFile)) 1 'DROP wrong db -> 1'
Assert-Eq (Run 'DROP sdp_dashboard_test' @('-Action', 'dropdb', '-Situation', $sitFile2)) 1 'dropdb refused when DB unreachable, even with the right phrase'
Assert-Eq (Run ('OVERWRITE ' + $env:COMPUTERNAME) @('-Action', 'fresh-over-existing', '-Situation', $sitFile)) 0 'OVERWRITE <computer> -> 0'
Assert-Eq (Run 'RESTORE 20260912' @('-Action', 'restore', '-Situation', $sitFile, '-Target', 'sdp-restore_pre-v2.4.0_20260912-020011.zip')) 0 'RESTORE <date from trailing group> -> 0'
# demo-over-existing: its own phrase; the fresh-over-existing phrase is NOT enough
$rDemo = RunOut ('DEMO ' + $env:COMPUTERNAME) @('-Action', 'demo-over-existing', '-Situation', $sitFile)
Assert-Eq $rDemo.Code 0 'DEMO <computer> -> 0'
Assert-True ($rDemo.Out -match 'DROPPED and replaced by the bundled demo dataset') 'demo screen says the database is dropped and replaced'
Assert-True ($rDemo.Out -match 'user accounts are replaced') 'demo screen says the accounts are replaced'
Assert-True ($rDemo.Out -match 'sdp_dashboard_test') 'demo screen names the database'
Assert-True ($rDemo.Out -match 'pre-restore restore point with a COMPLETE database dump') 'demo screen names the pre-restore dump guard'
Assert-True (-not ($rDemo.Out -match 'NOT deleted')) 'demo screen never claims the database is kept'
Assert-Eq (Run ('OVERWRITE ' + $env:COMPUTERNAME) @('-Action', 'demo-over-existing', '-Situation', $sitFile)) 1 'OVERWRITE <computer> is NOT accepted for demo-over-existing'
Assert-Eq (Run 'DEMO' @('-Action', 'demo-over-existing', '-Situation', $sitFile)) 1 'demo: wrong phrase (no computer name) -> 1'
Assert-Eq (Run ('demo ' + $env:COMPUTERNAME) @('-Action', 'demo-over-existing', '-Situation', $sitFile)) 1 'demo: case-sensitive'
Assert-Eq (Run ('DEMO ' + $env:COMPUTERNAME) @('-Action', 'fresh-over-existing', '-Situation', $sitFile)) 1 'DEMO <computer> is NOT accepted for fresh-over-existing'
Assert-Eq (Run 'CLOSED' @('-Action', 'demo-over-existing', '-Situation', $sitFile)) 1 'demo: closed stdin -> 1'
Assert-Eq (Run (' DEMO ' + $env:COMPUTERNAME + ' ') @('-Action', 'demo-over-existing', '-Situation', $sitFile)) 0 'demo: surrounding whitespace trimmed like the other phrases'
Assert-Eq (Run ' REINSTALL  ' @('-Action', 'reinstall', '-Situation', $sitFile)) 0 'surrounding whitespace tolerated (cmd echo pipe appends a trailing space)'
Assert-Eq (Run 'RE INSTALL' @('-Action', 'reinstall', '-Situation', $sitFile)) 1 'inner content must match exactly - internal whitespace is not tolerated'

# "What protects you" is only what really happens (M1/M2).
$rFo = RunOut ('OVERWRITE ' + $env:COMPUTERNAME) @('-Action', 'fresh-over-existing', '-Situation', $sitFile)
Assert-Eq $rFo.Code 0 'fresh-over-existing with server.js -> 0'
Assert-True ($rFo.Out -match 'automatic rollback applies') 'fresh-over-existing with server.js promises the restore point + rollback'
$sitNoSrv = @{}; foreach ($k in $sit.Keys) { $sitNoSrv[$k] = $sit[$k] }
$sitNoSrv.install = @{ dir = 'C:\Apps\X'; has_env = $true; has_server_js = $false }
$sitNoSrvFile = Join-Path $sitDir 'sit-nosrv.json'
($sitNoSrv | ConvertTo-Json -Depth 6) | Set-Content $sitNoSrvFile -Encoding ascii
$rFo2 = RunOut ('OVERWRITE ' + $env:COMPUTERNAME) @('-Action', 'fresh-over-existing', '-Situation', $sitNoSrvFile)
Assert-Eq $rFo2.Code 0 'fresh-over-existing without server.js -> 0 with the right phrase'
Assert-True ($rFo2.Out -match 'No restore point and no automatic rollback') 'no server.js: the screen says there is no restore point / rollback'
Assert-True (-not ($rFo2.Out -match 'automatic rollback applies')) 'no server.js: never promises a rollback'
# demo-over-existing: the full-restore-point / redeploy wording only with server.js.
Assert-True ($rDemo.Out -match 'A full restore point of the CURRENT state is taken first') 'demo with server.js: full restore point promised'
Assert-True ($rDemo.Out -match 'code and node_modules are redeployed') 'demo with server.js: redeploy wording'
$rDemo2 = RunOut ('DEMO ' + $env:COMPUTERNAME) @('-Action', 'demo-over-existing', '-Situation', $sitNoSrvFile)
Assert-Eq $rDemo2.Code 0 'demo without server.js -> 0 with the right phrase'
Assert-True (-not ($rDemo2.Out -match 'full restore point of the CURRENT state')) 'demo without server.js: no full restore point claimed'
Assert-True (-not ($rDemo2.Out -match 'redeployed')) 'demo without server.js: no redeploy claim'
Assert-True ($rDemo2.Out -match 'protected by the pre-restore point taken right before it is replaced') 'demo without server.js: the pre-restore point is the protection'
Assert-True ($rDemo2.Out -match 'no rollback of the files') 'demo without server.js: says there is no file rollback'
Assert-True ($rDemo2.Out -match 'DROPPED and replaced by the bundled demo dataset') 'demo without server.js: still says the database is replaced'
$rRi = RunOut 'REINSTALL' @('-Action', 'reinstall', '-Situation', $sitFile)
Assert-True ($rRi.Out -match 'code \+ \.env \+ data \+ DB dump\)') 'reinstall, DB reachable: restore point includes the DB dump'
$rRi2 = RunOut 'REINSTALL' @('-Action', 'reinstall', '-Situation', $sitFile2)
Assert-True ($rRi2.Out -match 'DB dump only if the database is reachable') 'reinstall, DB unreachable: the dump claim is qualified'
Assert-True (-not ($rRi2.Out -match 'data \+ DB dump\)')) 'reinstall, DB unreachable: no unconditional dump claim'

# .sql target and missing target: assert the SCREEN says REFUSED, not just exit 1
# (an exit-1 assertion alone passes even if the wrong branch produced it).
$rSql = RunOut 'RESTORE 20260912' @('-Action', 'restore', '-Situation', $sitFile, '-Target', 'sdp-db_20260913-020000.sql')
Assert-Eq $rSql.Code 1 'a .sql dump is rejected before the phrase'
Assert-True ($rSql.Out -match 'REFUSED:') 'a .sql dump rejection screen says REFUSED'

$rMissing = RunOut 'RESTORE 20260912' @('-Action', 'restore', '-Situation', $sitFile, '-Target', 'missing.zip')
Assert-Eq $rMissing.Code 1 'missing target -> 1'
Assert-True ($rMissing.Out -match 'REFUSED:') 'missing target screen says REFUSED'

# Dump detection: ROOT sdp_dashboard.sql only. A restore point whose only
# .sql entries are nested repo files (db\postgres\...\001_init.sql) must NOT
# be reported as containing a DB dump.
$rNoDump = RunOut 'RESTORE 20260912' @('-Action', 'restore', '-Situation', $sitFile, '-Target', 'sdp-restore_nodump_20260912-030000.zip')
Assert-True ($rNoDump.Out -match 'No database change') 'no root sdp_dashboard.sql -> "No database change" on screen'
Assert-True (-not ($rNoDump.Out -match 'DROPPED')) 'no root sdp_dashboard.sql -> screen does NOT say DROPPED'

$rDump = RunOut 'RESTORE 20260912' @('-Action', 'restore', '-Situation', $sitFile, '-Target', 'sdp-restore_pre-v2.4.0_20260912-020011.zip')
Assert-True ($rDump.Out -match 'DROPPED') 'root sdp_dashboard.sql present -> screen says DROPPED'

# Clean refusals (exit 1 + REFUSED, never a stack trace) for the error paths
# added in this pass.
$rEmpty = RunOut 'REINSTALL' @('-Action', 'reinstall', '-Situation', $emptySitFile)
Assert-Eq $rEmpty.Code 1 'empty situation file -> 1'
Assert-True ($rEmpty.Out -match 'REFUSED:') 'empty situation file -> REFUSED'

$rBad = RunOut 'REINSTALL' @('-Action', 'reinstall', '-Situation', $badSitFile)
Assert-Eq $rBad.Code 1 'malformed situation json -> 1'
Assert-True ($rBad.Out -match 'REFUSED:') 'malformed situation json -> REFUSED'

$rMinimal = RunOut 'RESTORE 20260901' @('-Action', 'restore', '-Situation', $minimalSitFile, '-Target', 'whatever.zip')
Assert-Eq $rMinimal.Code 1 'minimal unknown-shaped situation json + restore -> 1'
Assert-True ($rMinimal.Out -match 'REFUSED:') 'minimal unknown-shaped situation json + restore -> REFUSED'

$rCorrupt = RunOut 'RESTORE 20260901' @('-Action', 'restore', '-Situation', $sitFile, '-Target', 'sdp-restore_x_20260901-120000.zip')
Assert-Eq $rCorrupt.Code 1 'corrupt zip -> 1'
Assert-True ($rCorrupt.Out -match 'REFUSED:') 'corrupt zip -> REFUSED'

$rTraversal = RunOut 'RESTORE 20260912' @('-Action', 'restore', '-Situation', $sitFile, '-Target', '..\x.zip')
Assert-Eq $rTraversal.Code 1 'path-traversal target -> 1'
Assert-True ($rTraversal.Out -match 'REFUSED:') 'path-traversal target -> REFUSED'

# Counts really appear on screen (proves "What is at stake" renders real data).
$rCounts = RunOut 'REINSTALL' @('-Action', 'reinstall', '-Situation', $sitFile)
Assert-Eq $rCounts.Code 0 'reinstall with correct phrase -> 0'
Assert-True ($rCounts.Out -match 'sites 11') 'counts line ("sites 11") appears on the reinstall screen'

# Redirected stdin: the phrase reader must consume ONE line only, leaving the
# rest for the caller's next `set /p` (piped Setup.bat sessions). A buffered
# reader used to swallow every following answer after the first red screen.
$wrapDir = New-TempDir 'sdp-wrap'; $script:TestTempDirs += $wrapDir
$wrap = Join-Path $wrapDir 'w.cmd'
[IO.File]::WriteAllText($wrap, ("@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"" + $confirm + "`" -Action reinstall -Situation `"" + $sitFile + "`" >nul 2>&1`r`necho RC=%errorlevel%`r`nset X=`r`nset /p X=`r`necho X=[%X%]`r`n"), [Text.Encoding]::ASCII)
function RunWrapped([string]$inputText, [switch]$Pipe) {
    $in = Join-Path $wrapDir ('in-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.txt')
    [IO.File]::WriteAllText($in, $inputText, [Text.Encoding]::ASCII)
    if ($Pipe) { return (cmd /c ('type "' + $in + '" | "' + $wrap + '"') | Out-String) }
    return (cmd /c ('"' + $wrap + '" < "' + $in + '"') | Out-String)
}
$w1 = RunWrapped "REINSTALL`r`nNEXTLINE`r`n"
Assert-True ($w1 -match 'RC=0') 'file stdin: right phrase confirmed'
Assert-True ($w1 -match 'X=\[NEXTLINE\]') 'file stdin: the next line is left for the caller'
$w2 = RunWrapped "REINSTALL`r`nNEXTLINE`r`n" -Pipe
Assert-True ($w2 -match 'RC=0') 'piped stdin: right phrase confirmed'
Assert-True ($w2 -match 'X=\[NEXTLINE\]') 'piped stdin: the next line is left for the caller'
$w3 = RunWrapped "nope`r`nNEXTLINE`r`n"
Assert-True ($w3 -match 'RC=1') 'wrong phrase followed by another line -> cancel'
Assert-True ($w3 -match 'X=\[NEXTLINE\]') 'wrong phrase: the next line is still left for the caller'
$w4 = RunWrapped "REINSTALL`nNEXT"
Assert-True ($w4 -match 'RC=0' -and $w4 -match 'X=\[NEXT\]') 'LF-only line ending handled, remainder left unread'
$bomIn = Join-Path $wrapDir 'in-bom.txt'
[IO.File]::WriteAllBytes($bomIn, ([byte[]](0xEF, 0xBB, 0xBF) + [Text.Encoding]::ASCII.GetBytes(" REINSTALL `r`nNEXTLINE`r`n")))
$w6 = (cmd /c ('"' + $wrap + '" < "' + $bomIn + '"') | Out-String)
Assert-True ($w6 -match 'RC=0' -and $w6 -match 'X=\[NEXTLINE\]') 'leading UTF-8 BOM + surrounding spaces tolerated (like the old StreamReader)'
$w5 = RunWrapped ""
# Length cap: a 10 KB line is consumed up to its LF but never stored past
# 4096 bytes - the answer is a mismatch and the next line is still readable.
$w7 = RunWrapped (('A' * 10240) + "`r`nNEXT`r`n")
Assert-True ($w7 -match 'RC=1') '10 KB line -> cancel'
Assert-True ($w7 -match 'X=\[NEXT\]') '10 KB line: the next line is still left for the caller'
$w8 = RunWrapped ('REINSTALL' + (' ' * 10240) + "`r`nNEXT`r`n")
Assert-True ($w8 -match 'RC=1' -and $w8 -match 'X=\[NEXT\]') 'right phrase padded past the cap -> cancel, next line intact'
Assert-True ($w5 -match 'RC=1') 'empty redirected stdin (EOF) -> cancel'

Write-Host ("confirm.tests: " + $script:AssertCount + " assertions ok")

} finally {
    foreach ($d in $script:TestTempDirs) {
        try { if (Test-Path $d) { Remove-Item -Path $d -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
    }
}

exit 0
