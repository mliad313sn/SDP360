$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$confirm = Join-Path $here '..\Confirm-Destructive.ps1'

# Best-effort cleanup list: every temp dir created below is appended here and
# removed at the end (try/catch, non-fatal if a handle is still open). Same
# pattern as detect.tests.ps1.
$script:TestTempDirs = @()

try {

# situation fixture (reachable DB with counts) + a backup dir with two restore points
$bak = New-TempDir 'sdp-bak'; $script:TestTempDirs += $bak
$stage = New-TempDir 'sdp-stg'; $script:TestTempDirs += $stage
Set-Content (Join-Path $stage 'server.js') '//' -Encoding ascii; Set-Content (Join-Path $stage 'sdp_dashboard.sql') '--' -Encoding ascii
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath (Join-Path $bak 'sdp-restore_pre-v2.4.0_20260912-020011.zip') -Force
Set-Content (Join-Path $bak 'sdp-db_20260913-020000.sql') '--' -Encoding ascii
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

# $stdin: a string to pipe, or the sentinel 'CLOSED' to run with stdin redirected from NUL
# (an untyped parameter - a [string] one would coerce $null to '' and never take the NUL branch).
function Run($stdin, [string[]]$extra) {
    $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $confirm) + $extra
    if ($stdin -eq 'CLOSED') { cmd /c ('powershell ' + (($psArgs | ForEach-Object { '"' + $_ + '"' }) -join ' ') + ' < NUL') | Out-Null }
    else { $stdin | & powershell @psArgs | Out-Null }
    return $LASTEXITCODE
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
Assert-Eq (Run 'RESTORE 20260912' @('-Action', 'restore', '-Situation', $sitFile, '-Target', 'sdp-db_20260913-020000.sql')) 1 'a .sql dump is rejected before the phrase'
Assert-Eq (Run 'RESTORE 20260912' @('-Action', 'restore', '-Situation', $sitFile, '-Target', 'missing.zip')) 1 'missing target -> 1'
Assert-Eq (Run ' REINSTALL  ' @('-Action', 'reinstall', '-Situation', $sitFile)) 0 'surrounding whitespace tolerated (cmd echo pipe appends a trailing space)'
Assert-Eq (Run 'RE INSTALL' @('-Action', 'reinstall', '-Situation', $sitFile)) 1 'inner content must match exactly - internal whitespace is not tolerated'
Write-Host ("confirm.tests: " + $script:AssertCount + " assertions ok")

} finally {
    foreach ($d in $script:TestTempDirs) {
        try { if (Test-Path $d) { Remove-Item -Path $d -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
    }
}

exit 0
