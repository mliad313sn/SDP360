$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$show = Join-Path $here '..\Show-Situation.ps1'

# Best-effort cleanup list: every temp dir created below is appended here and
# removed at the end (try/catch, non-fatal if a handle is still open). Same
# pattern as confirm.tests.ps1 / detect.tests.ps1.
$script:TestTempDirs = @()

try {

function Sit($state, $rec, $down, $reach) {
    $o = @{ install = @{ dir = 'C:\Apps\X'; version = '2.3.1'; has_env = $true; has_server_js = ($state -ne 'empty') }
        runtime = @{ pm2_process = 'online'; port_owner = 'ours' }
        db = @{ reachable = $reach; db = 'sdp_dashboard'; size_mb = 1.8; counts = @{ sites = 11; weekly_reports = 412; md_meetings = 96; insp_inspections = 41; users = 23; assets = 5 } }
        backups = @{ last_full = @{ name = 'sdp-restore_x_20260912-020011.zip'; age_hours = 72; size_mb = 640 }; count = 14 }
        bundle = @{ version = '2.4.0'; lockfile_same_as_installed = $false }
        disk = @{ free_gb = 48 }
        verdict = @{ state = $state; recommended = $rec; downgrade = $down; notes = @('a note') } }
    $d = New-TempDir 'sdp-sit'; $script:TestTempDirs += $d
    $f = Join-Path $d 'sit.json'; ($o | ConvertTo-Json -Depth 6) | Set-Content $f -Encoding ascii; return $f
}

# Output capture form: Write-Host on a CHILD `powershell -File` process lands
# on that process's real stdout (unlike Write-Host between functions in the
# SAME session, which goes to the information stream) - `2>&1 | Out-String`
# captures it reliably, same pattern as confirm.tests.ps1's RunOut. Proven on
# this box: plain `| Out-String` (no 2>&1) also worked in a manual check, but
# `2>&1` additionally folds in stderr so a real .NET exception message would
# still show up in the captured text instead of vanishing - keep it.
function Render([string]$situation, [int]$hasDemo) {
    return (& powershell -NoProfile -ExecutionPolicy Bypass -File $show -Situation $situation -HasDemo $hasDemo 2>&1 | Out-String)
}

$out = Render (Sit 'installed' 'upgrade' $false $true) 0
Assert-True ($out -match 'v2\.3\.1 is installed and this package contains v2\.4\.0') 'state sentence'
Assert-True ($out -match 'RECOMMENDED') 'RECOMMENDED group'
Assert-True ($out -match '2\.\s+Upgrade.*<< recommended') 'upgrade first + tag'
Assert-True ($out -match '4\.\s+Fresh install.*confirmation required') 'fresh guarded wording'
Assert-True ($out -match 'sites 11') 'counts line'
Assert-True ($out -notmatch 'D\.\s+Demo') 'no demo entry when HasDemo=0'

$out2 = Render (Sit 'empty' 'fresh' $false $false) 1
Assert-True ($out2 -match 'Nothing is installed') 'empty sentence'
Assert-True ($out2 -match '4\.\s+Fresh install.*<< recommended') 'fresh recommended on empty'
Assert-True ($out2 -match 'D\.\s+Demo') 'demo entry shown'
Assert-True ($out2 -match '1\.\s+Patch.*not applicable') 'patch n/a on empty'

$out3 = Render (Sit 'installed' 'patch' $true $true) 0
Assert-True ($out3 -match 'OLDER|downgrade|newer bundle') 'downgrade note visible'

# ---- additions: never-throws / fallback / state-unknown wiring / n-a rules / demo not-recommended ----

# (a) Detect-SDP's own catch-path MINIMAL json (STATE=unknown) - valid JSON
# but no real install/runtime/db/bundle facts (see Detect-SDP.ps1's catch
# block and confirm.tests.ps1's identical $minimal fixture). Must render
# cleanly THROUGH the normal situation block (not the "file unreadable"
# fallback branch) - never a raw exception on an operator's screen.
$minimal = @{
    install = @{ dir = 'C:\Apps\X'; has_server_js = $false; has_env = $false }
    runtime = @{}
    db = @{ reachable = $false; error = 'detection failed' }
    backups = @{ dir = $null; count = 0 }
    bundle = @{}
    disk = @{}
    verdict = @{ state = 'unknown'; recommended = $null; downgrade = $false; notes = @('detection failed: refused') }
}
$minDir = New-TempDir 'sdp-sit'; $script:TestTempDirs += $minDir
$minFile = Join-Path $minDir 'minimal.json'
($minimal | ConvertTo-Json -Depth 6) | Set-Content $minFile -Encoding ascii
$outMin = Render $minFile 0
Assert-True ($outMin -match 'Could not read') 'unknown state -> "Could not read" sentence'
Assert-True ($outMin -match 'situation unknown') 'unknown state -> entries reason mentions situation unknown'
Assert-True (-not ($outMin -match 'Exception')) 'unknown state -> no raw exception text'
Assert-True (-not ($outMin -match 'At line')) 'unknown state -> no raw stack-trace text'

# (b) situation file path that does not exist at all.
$missDir = New-TempDir 'sdp-sit'; $script:TestTempDirs += $missDir
$missFile = Join-Path $missDir 'does-not-exist.json'
$outMiss = Render $missFile 0
Assert-True ($outMiss -match 'Situation unavailable') 'missing situation file -> "Situation unavailable"'

# (c) 0-byte situation file.
$emptyDir = New-TempDir 'sdp-sit'; $script:TestTempDirs += $emptyDir
$emptyFile = Join-Path $emptyDir 'empty.json'
New-Item -ItemType File -Path $emptyFile -Force | Out-Null
$outEmpty = Render $emptyFile 0
Assert-True ($outEmpty -match 'Situation unavailable') 'empty situation file -> "Situation unavailable"'

# (d) a PARTIAL install whose install dir has no server.js at all - Reinstall
# (3) must read not-applicable (mirrors the "no server.js - use 4" rule, but
# proven here specifically on a partial situation, not just empty).
function SitPartialNoServer() {
    $o = @{ install = @{ dir = 'C:\Apps\X'; version = $null; has_env = $true; has_server_js = $false }
        runtime = @{ pm2_process = 'stopped'; port_owner = 'ours' }
        db = @{ reachable = $false; error = 'refused' }
        backups = @{ count = 0 }
        bundle = @{ version = '2.4.0' }
        disk = @{ free_gb = 40 }
        verdict = @{ state = 'partial'; recommended = $null; downgrade = $false; notes = @('incomplete install - no server.js') } }
    $d = New-TempDir 'sdp-sit'; $script:TestTempDirs += $d
    $f = Join-Path $d 'sit.json'; ($o | ConvertTo-Json -Depth 6) | Set-Content $f -Encoding ascii; return $f
}
$outPartial = Render (SitPartialNoServer) 0
Assert-True ($outPartial -match '3\.\s+Reinstall.*not applicable') 'partial + no server.js -> Reinstall not applicable'

# (e) -HasDemo 1 on an INSTALLED site: D must be visible but never marked as
# the recommended entry (upgrade is recommended here, never demo).
$outDemo = Render (Sit 'installed' 'upgrade' $false $true) 1
Assert-True ($outDemo -match 'D\.\s+Demo') 'installed + HasDemo=1 -> D line present'
Assert-True (-not ($outDemo -match 'D\.\s+Demo.*<< recommended')) 'installed + HasDemo=1 -> D is not the recommended entry'

Write-Host ("show.tests: " + $script:AssertCount + " assertions ok")

} finally {
    foreach ($d in $script:TestTempDirs) {
        try { if (Test-Path $d) { Remove-Item -Path $d -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
    }
}

exit 0
