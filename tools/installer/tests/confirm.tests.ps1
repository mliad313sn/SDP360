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
    install = @{ dir = 'C:\Apps\X'; version = '2.3.1'; has_env = $true }
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
Assert-Eq (Run ' REINSTALL  ' @('-Action', 'reinstall', '-Situation', $sitFile)) 0 'surrounding whitespace tolerated (cmd echo pipe appends a trailing space)'
Assert-Eq (Run 'RE INSTALL' @('-Action', 'reinstall', '-Situation', $sitFile)) 1 'inner content must match exactly - internal whitespace is not tolerated'

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

Write-Host ("confirm.tests: " + $script:AssertCount + " assertions ok")

} finally {
    foreach ($d in $script:TestTempDirs) {
        try { if (Test-Path $d) { Remove-Item -Path $d -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
    }
}

exit 0
