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

# ---- spec-review fixes: warning colours (extracted decision function), no
# recommendation on a refused entry, demo placement ----

# (fix-a) Get-InstallLineColor is exercised directly via -ColorProbe, which
# prints ONLY "INSTALL_COLOR=<colour>" and exits 0 - colour can't be read
# back from captured text any other way (Write-Host colour never reaches
# the piped string), so the script exposes the decision as data instead.
function SitColor($state, $pm2, $port, $reach) {
    $o = @{
        install = @{ dir = 'C:\Apps\X' }
        runtime = @{ pm2_process = $pm2; port_owner = $port }
        db = @{ reachable = $reach }
        verdict = @{ state = $state }
    }
    $d = New-TempDir 'sdp-sit'; $script:TestTempDirs += $d
    $f = Join-Path $d 'sit.json'; ($o | ConvertTo-Json -Depth 6) | Set-Content $f -Encoding ascii; return $f
}
function ColorOf([string]$file) {
    $txt = (& powershell -NoProfile -ExecutionPolicy Bypass -File $show -Situation $file -ColorProbe 2>&1 | Out-String)
    if ($txt -match 'INSTALL_COLOR=(\S+)') { return $Matches[1] }
    return ''
}
Assert-Eq (ColorOf (SitColor 'installed' 'online' 'ours' $true)) 'Green' 'pm2 online + port ours + db reachable -> Green'
Assert-Eq (ColorOf (SitColor 'installed' 'online' 'foreign' $true)) 'Yellow' 'port foreign -> Yellow'
Assert-Eq (ColorOf (SitColor 'installed' 'online' 'ours' $false)) 'Yellow' 'db unreachable -> Yellow'
Assert-Eq (ColorOf (SitColor 'installed' 'stopped' 'ours' $true)) 'Yellow' 'pm2 stopped -> Yellow'
Assert-Eq (ColorOf (SitColor 'partial' 'online' 'ours' $true)) 'Red' 'partial -> Red regardless of pm2/port/db'

# (fix-b) downgrade + recommended upgrade: the recommendation itself is
# refused, so RECOMMENDED must say "no recommendation" (not print Upgrade
# with a "<< recommended" tag), the old lockfile-based "Upgrade recommended"
# bundle-line suffix must not appear, and 2. Upgrade must read n/a.
$outB = Render (Sit 'installed' 'upgrade' $true $true) 0
Assert-True ($outB -match '\(no recommendation') 'downgrade + recommended upgrade -> "(no recommendation" shown'
Assert-True (-not ($outB -match 'Upgrade recommended')) 'downgrade + recommended upgrade -> no "Upgrade recommended" text anywhere'
Assert-True ($outB -match '2\.\s+Upgrade.*not applicable') 'downgrade + recommended upgrade -> 2. Upgrade line reads not applicable'

# (fix-c) partial install -> Patch (1) reads "installation incomplete", not
# the empty-state "nothing installed" wording.
$outC = Render (Sit 'partial' $null $false $true) 0
Assert-True ($outC -match '1\.\s+Patch.*installation incomplete') 'partial -> 1. Patch reason mentions installation incomplete'

# (fix-d) empty + HasDemo=1: D must sit INSIDE the RECOMMENDED group, right
# under Fresh install, and must not appear a second time under OTHER - prove
# it by position (D's first occurrence comes before the OTHER heading).
$outD = Render (Sit 'empty' 'fresh' $false $false) 1
$idxD = $outD.IndexOf('D.  Demo')
$idxOther = $outD.IndexOf('OTHER')
Assert-True ($idxD -ge 0) 'empty + HasDemo=1 -> D line present'
Assert-True ($idxOther -ge 0) 'empty + HasDemo=1 -> OTHER heading present'
Assert-True ($idxD -lt $idxOther) 'empty + HasDemo=1 -> D line appears before the OTHER heading (i.e. inside RECOMMENDED)'
Assert-Eq (([regex]::Matches($outD, 'D\.\s+Demo')).Count) 1 'empty + HasDemo=1 -> D line appears exactly once'

# ---- code-quality review fixes: single colour source, safe params, sanitised text ----

# (cq-1) Get-InstallLineColor is the SINGLE source for the Install line's
# colour on every state, not just installed/partial - empty must read Gray
# and an unrecognised state must read Red, exactly like partial.
Assert-Eq (ColorOf (SitColor 'empty' 'online' 'ours' $true)) 'Gray' 'state empty -> Gray (single colour source, no hard-coded branch)'
Assert-Eq (ColorOf (SitColor 'some-future-state' 'online' 'ours' $true)) 'Red' 'unrecognised state -> Red, same as partial'

# (cq-2) safe parameters: neither -Situation nor -HasDemo is Mandatory, so a
# missing/empty value must never make PowerShell prompt (which would hang a
# non-interactive caller like Setup.bat) - proved by running with CLOSED
# stdin (same pattern as confirm.tests.ps1's Run helper): if the script were
# still prompting for a mandatory parameter, this would hang until the
# harness's own timeout, not return promptly.
# cmd's own quoting turns an empty array element into a literal `""`, which
# both cmd and powershell.exe's argv parser read back as an empty string
# argument - splatting an empty string straight to a native exe via `&` is
# unreliable in Windows PowerShell 5.1 (the element can vanish entirely, as
# it did here on the first attempt), so route BOTH new tests through this
# same cmd wrapper (already proven to work by confirm.tests.ps1's Run/RunOut).
function RunClosedStdin([string[]]$extraArgs) {
    $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $show) + $extraArgs
    $txt = (cmd /c ('powershell ' + (($psArgs | ForEach-Object { '"' + $_ + '"' }) -join ' ') + ' < NUL 2>&1') | Out-String)
    return @{ Code = $LASTEXITCODE; Out = $txt }
}
$rNoSituation = RunClosedStdin @()
Assert-Eq $rNoSituation.Code 0 'no -Situation at all (closed stdin) -> exit 0, no hang'
Assert-True ($rNoSituation.Out -match 'Situation unavailable') 'no -Situation at all -> "Situation unavailable"'

$rEmptyDemo = RunClosedStdin @('-Situation', (Sit 'installed' 'upgrade' $false $true), '-HasDemo', '')
Assert-Eq $rEmptyDemo.Code 0 '-HasDemo '''' -> exit 0'
Assert-True ($rEmptyDemo.Out -match 'RECOMMENDED') '-HasDemo '''' -> a menu is printed'

# (cq-3) untrusted text (a note here) with an embedded newline AND an ESC
# control character must render on exactly ONE "  ! " line, with the control
# characters collapsed to spaces rather than splitting the screen.
function SitNote($note) {
    $o = @{ install = @{ dir = 'C:\Apps\X'; version = '2.3.1'; has_env = $true; has_server_js = $true }
        runtime = @{ pm2_process = 'online'; port_owner = 'ours' }
        db = @{ reachable = $true; db = 'sdp_dashboard'; size_mb = 1.8; counts = @{ sites = 11; weekly_reports = 412; md_meetings = 96; insp_inspections = 41; users = 23; assets = 5 } }
        backups = @{ last_full = @{ name = 'sdp-restore_x_20260912-020011.zip'; age_hours = 72; size_mb = 640 }; count = 14 }
        bundle = @{ version = '2.4.0'; lockfile_same_as_installed = $false }
        disk = @{ free_gb = 48 }
        verdict = @{ state = 'installed'; recommended = 'upgrade'; downgrade = $false; notes = @($note) } }
    $d = New-TempDir 'sdp-sit'; $script:TestTempDirs += $d
    $f = Join-Path $d 'sit.json'; ($o | ConvertTo-Json -Depth 6) | Set-Content $f -Encoding ascii; return $f
}
$dirtyNote = 'bad' + [char]10 + 'note' + [char]27 + 'here'
$outNote = Render (SitNote $dirtyNote) 0
Assert-Eq (([regex]::Matches($outNote, '(?m)^  ! ')).Count) 1 'note with newline + ESC -> exactly one "  ! " line'
Assert-True ($outNote -match '  ! bad note here') 'note with newline + ESC -> control chars collapsed to spaces on one line'

# (cq-6) Detect-SDP.ps1 always writes the situation JSON with -Encoding UTF8
# (BOM) - every other fixture in this file uses -Encoding ascii, which would
# never catch a BOM-handling regression in the script's `Get-Content -Raw`
# (no -Encoding, BOM-tolerant in 5.1). Prove the real encoding round-trips.
function SitUtf8($state, $rec, $down, $reach) {
    $o = @{ install = @{ dir = 'C:\Apps\X'; version = '2.3.1'; has_env = $true; has_server_js = ($state -ne 'empty') }
        runtime = @{ pm2_process = 'online'; port_owner = 'ours' }
        db = @{ reachable = $reach; db = 'sdp_dashboard'; size_mb = 1.8; counts = @{ sites = 11; weekly_reports = 412; md_meetings = 96; insp_inspections = 41; users = 23; assets = 5 } }
        backups = @{ last_full = @{ name = 'sdp-restore_x_20260912-020011.zip'; age_hours = 72; size_mb = 640 }; count = 14 }
        bundle = @{ version = '2.4.0'; lockfile_same_as_installed = $false }
        disk = @{ free_gb = 48 }
        verdict = @{ state = $state; recommended = $rec; downgrade = $down; notes = @('a note') } }
    $d = New-TempDir 'sdp-sit'; $script:TestTempDirs += $d
    $f = Join-Path $d 'sit.json'; ($o | ConvertTo-Json -Depth 6) | Set-Content $f -Encoding UTF8; return $f
}
$outUtf8 = Render (SitUtf8 'installed' 'upgrade' $false $true) 0
Assert-True ($outUtf8 -match 'v2\.3\.1 is installed and this package contains v2\.4\.0') 'UTF8-with-BOM fixture (Detect-SDP''s real encoding) renders correctly'

# (cq-7) `{"install":{}}` - no dir, no has_server_js - must be treated as
# unavailable (the fallback branch), not rendered as if it were a real,
# if sparse, installation.
$emptyInstallDir = New-TempDir 'sdp-sit'; $script:TestTempDirs += $emptyInstallDir
$emptyInstallFile = Join-Path $emptyInstallDir 'empty-install.json'
'{"install":{}}' | Set-Content $emptyInstallFile -Encoding ascii
$outEmptyInstall = Render $emptyInstallFile 0
Assert-True ($outEmptyInstall -match 'Situation unavailable') '{"install":{}} (no dir, no has_server_js) -> Situation unavailable'

Write-Host ("show.tests: " + $script:AssertCount + " assertions ok")

} finally {
    foreach ($d in $script:TestTempDirs) {
        try { if (Test-Path $d) { Remove-Item -Path $d -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
    }
}

exit 0
