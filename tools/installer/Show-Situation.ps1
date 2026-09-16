# =====================================================================
# Show-Situation.ps1 - renders the coloured situation block + the grouped menu
# for Setup.bat (cmd cannot colour). Reads the JSON written by Detect-SDP.ps1.
#   -Situation <json> -HasDemo 0|1
# Menu numbers are unchanged; Setup.bat keeps the prompt + dispatch.
# Never throws, exit 0 always: this script only RENDERS a menu, it never
# changes anything, so a crash here would leave Setup.bat with no menu at
# all. A situation file that is missing, empty, malformed, or lacking an
# "install" section falls into the fallback branch (a red "Situation
# unavailable" line + the full static menu, every install-affecting entry
# dark grey). A situation file that parses fine but carries STATE=unknown
# (Detect-SDP's own catch-path shape) is rendered through the NORMAL path
# below with every install-affecting entry marked not-applicable.
# KEEP PURE ASCII (no box glyphs).
# =====================================================================
param([Parameter(Mandatory = $true)][string]$Situation, [int]$HasDemo = 0, [switch]$ColorProbe)
$ErrorActionPreference = 'Stop'
function W([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }

# spec 4.2: red when the install is partial; otherwise yellow when ANY of
# pm2/port/db is not clean; green only when none of those apply. Extracted
# so -ColorProbe (below) can assert the decision directly instead of trying
# to detect a Write-Host colour from captured text.
function Get-InstallLineColor($sit) {
    if ($sit.verdict.state -eq 'partial') { return 'Red' }
    $pm2 = if ($sit.runtime -and $sit.runtime.pm2_process) { $sit.runtime.pm2_process } else { 'absent' }
    $port = if ($sit.runtime -and $sit.runtime.port_owner) { $sit.runtime.port_owner } else { 'unknown' }
    $dbOk = [bool]$sit.db.reachable
    if ($pm2 -ne 'online' -or $port -eq 'foreign' -or -not $dbOk) { return 'Yellow' }
    return 'Green'
}

# Full static menu for when there is no situation data to reason about at
# all (missing / empty / malformed JSON, or a JSON with no "install"
# section). DATA and MAINTENANCE never depend on the situation, so they are
# identical to the normal path; every install-affecting entry (1/2/3/4/D) is
# dark grey with the same reason.
function Show-FallbackMenu([int]$demo) {
    W ''
    W '  RECOMMENDED' 'White'
    W '    (no recommendation - situation unknown)' 'DarkGray'
    W '  OTHER' 'White'
    W '    1.  Patch                Code only. No node_modules or database change at all.  (not applicable here - situation unknown)' 'DarkGray'
    W '    2.  Upgrade              Code + node_modules. Database, data and .env preserved.  (not applicable here - situation unknown)' 'DarkGray'
    W '    3.  Reinstall            Re-deploy over the top; DB kept unless you ask to drop it.  (not applicable here - situation unknown)' 'DarkGray'
    W '    4.  Fresh install        First-time install on this machine.  (not applicable here - situation unknown)' 'DarkGray'
    if ($demo -eq 1) { W '    D.  Demo laptop          Fresh install + load the bundled dataset.  (not applicable here - situation unknown)' 'DarkGray' }
    W '  DATA' 'White'
    W '    5.  Backup now           Full restore point (code + .env + data + DB dump).' 'Gray'
    W '    6.  Restore a previous version      Overwrites the current state - confirmation required.' 'Red'
    W '    7.  List restore points' 'Gray'
    W '  MAINTENANCE' 'White'
    W '    8.  Verify health        pm2 status + HTTP probe.' 'Gray'
    W '    9.  Diagnostics / logs   Versions, DBs, .env flags, last log lines.' 'Gray'
    W '    E.  Configure .env       Guided questionnaire (fills placeholders).' 'Gray'
    W '    C.  Check DB connection  PostgreSQL pre-flight.' 'Gray'
    W ''
    W '    0.  Exit' 'Gray'
    W ' ---------------------------------------------------------------------------' 'Cyan'
}

try {
    if (-not (Test-Path $Situation)) { throw ('situation file not found: ' + $Situation) }
    $raw = Get-Content $Situation -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($raw)) { throw 'situation file empty or unreadable' }
    try { $s = $raw | ConvertFrom-Json } catch { throw 'situation file is not valid JSON' }
    if ($null -eq $s -or -not $s.install) { throw 'situation file has no installation data - rerun detection' }
    if ($ColorProbe) { Write-Output ('INSTALL_COLOR=' + (Get-InstallLineColor $s)); exit 0 }

    $v = $s.verdict
    $iv = if ($s.install.version) { 'v' + ($s.install.version -replace '^v', '') } else { 'unknown version' }
    $bv = if ($s.bundle.version) { 'v' + ($s.bundle.version -replace '^v', '') } else { 'unknown version' }
    # Any verdict.state we don't recognise (unknown, null, a future value) is
    # treated the same way: no install facts can be trusted, so every
    # install-affecting menu entry reads not-applicable rather than guessing.
    $knownStates = @('installed', 'partial', 'empty')
    $stateUnknown = ($knownStates -notcontains $v.state)
    # Raw pm2 status text (online/stopped/errored/launching/absent) - no
    # per-value colour table beyond the two-way split below.
    $pm2Val = if ($s.runtime -and $s.runtime.pm2_process) { $s.runtime.pm2_process } else { 'absent' }
    $portVal = if ($s.runtime -and $s.runtime.port_owner) { $s.runtime.port_owner } else { 'unknown' }

    W ''
    W ' -- Situation ---------------------------------------------------------------' 'Cyan'
    if ($v.state -eq 'empty') {
        W ('  Install    : ' + $s.install.dir + '   (nothing installed)') 'Gray'
    } else {
        $rt = 'pm2 ' + $pm2Val + ', port ' + $portVal
        W ('  Install    : ' + $s.install.dir + '   ' + $iv + '   (' + $rt + ')') (Get-InstallLineColor $s)
        if ($s.db.reachable -and $s.db.counts) {
            $c = $s.db.counts
            W ('  Database   : ' + $s.db.db + '  ' + $s.db.size_mb + ' MB   sites ' + $c.sites + ' | reports ' + $c.weekly_reports + ' | PV ' + $c.md_meetings + ' | inspections ' + $c.insp_inspections + ' | users ' + $c.users) 'Green'
        } else { W '  Database   : not reachable - counts unavailable' 'Yellow' }
        if ($s.backups.last_full) {
            $b = $s.backups.last_full
            $col2 = if ($b.age_hours -gt 168) { 'Yellow' } else { 'Green' }
            W ('  Backups    : last full ' + [math]::Round($b.age_hours / 24, 1) + ' d ago (' + $b.name + ', ' + $b.size_mb + ' MB) | ' + $s.backups.count + ' kept') $col2
        } else { W '  Backups    : none yet' 'Yellow' }
    }
    # A downgrade bundle is never "recommended" anything - say so plainly
    # instead of the lockfile-based suffix, which would otherwise still
    # print "-> Upgrade recommended" on the very line reporting an older
    # bundle.
    $lockTxt = if ($v.downgrade) { '   OLDER than the installed version' } elseif ($v.state -ne 'installed') { '' } elseif ($s.bundle.lockfile_same_as_installed -eq $true) { '   node_modules unchanged -> Patch recommended' } else { '   node_modules changed -> Upgrade recommended' }
    W ('  Bundle     : ' + $bv + $lockTxt) $(if ($v.downgrade) { 'Red' } else { 'Gray' })
    foreach ($n in @($v.notes)) { if ($n) { W ('  ! ' + $n) $(if ($v.downgrade -or $v.state -eq 'partial' -or $stateUnknown) { 'Red' } else { 'Yellow' }) } }
    W ' ---------------------------------------------------------------------------' 'Cyan'
    W ''
    switch ($v.state) {
        'empty'     { W ('  Nothing is installed in ' + $s.install.dir + '. This package contains ' + $bv + '.') 'White' }
        'installed' { W ('  SDP Dashboard ' + $iv + ' is installed and this package contains ' + $bv + '.') 'White' }
        'partial'   { W ('  ' + $s.install.dir + ' holds an INCOMPLETE installation. This package contains ' + $bv + '.') 'White' }
        default     { W ('  Could not read the installation state. This package contains ' + $bv + '.') 'Red' }
    }
    W ''
    # ---- entries -------------------------------------------------------------------
    $rec = $v.recommended
    $installed = ($v.state -eq 'installed')
    # Patch/Upgrade need SOMETHING installed to patch/upgrade - "nothing
    # installed" only makes sense on state=empty; a partial install has
    # something on disk, just not enough of it (see the note line above).
    $noPatchUpgradeWhy = $(if ($v.state -eq 'partial') { 'installation incomplete - see the note above' } else { 'nothing installed' })
    $entries = @(
        @{ n = '1'; name = 'Patch';         desc = 'Code only. No node_modules or database change at all.';                  kind = $(if ($installed) { 'ok' } else { 'na' }); why = $noPatchUpgradeWhy },
        @{ n = '2'; name = 'Upgrade';       desc = 'Code + node_modules. Database, data and .env preserved.';                 kind = $(if ($installed) { 'ok' } else { 'na' }); why = $noPatchUpgradeWhy },
        @{ n = '3'; name = 'Reinstall';     desc = 'Re-deploy over the top; DB kept unless you ask to drop it.';             kind = $(if ($v.state -eq 'empty' -or -not $s.install.has_server_js) { 'na' } else { 'red' }); why = $(if ($v.state -eq 'empty') { 'nothing installed' } else { 'no server.js - use 4' }) },
        @{ n = '4'; name = 'Fresh install'; desc = $(if ($v.state -eq 'empty') { 'First-time install on this machine.' } else { 'Overwrites the existing installation''s code - confirmation required.' }); kind = $(if ($v.state -eq 'empty') { 'ok' } else { 'red' }); why = '' }
    )
    if ($HasDemo -eq 1) { $entries += @{ n = 'D'; name = 'Demo laptop'; desc = 'Fresh install + load the bundled dataset.'; kind = $(if ($v.state -eq 'empty') { 'ok' } else { 'red' }); why = '' } }
    if ($stateUnknown) {
        foreach ($e in $entries) { if (@('1', '2', '3', '4', 'D') -contains $e.n) { $e.kind = 'na'; $e.why = 'situation unknown - run 9 (Diagnostics)' } }
    } elseif ($v.downgrade) {
        foreach ($e in $entries) { if (@('1', '2', '3', '4', 'D') -contains $e.n) { $e.kind = 'na'; $e.why = 'bundle older than installed - use a newer bundle' } }
    }
    $recMap = @{ patch = '1'; upgrade = '2'; fresh = '4' }
    $recN = if ($rec -and $recMap.ContainsKey($rec)) { $recMap[$rec] } else { $null }
    function Entry($e, [bool]$isRec) {
        $label = ('    ' + $e.n + '.  ' + $e.name.PadRight(20) + ' ' + $e.desc)
        if ($e.kind -eq 'na') { W ($label + '  (not applicable here - ' + $e.why + ')') 'DarkGray'; return }
        if ($isRec) { W ($label + '   << recommended') 'Green'; return }
        if ($e.kind -eq 'red') { W ($label) 'Red'; return }
        W $label 'Gray'
    }
    W '  RECOMMENDED' 'White'
    $recEntry = $entries | Where-Object { $_.n -eq $recN } | Select-Object -First 1
    # An entry that IS the recommendation but is itself marked not-applicable
    # (a downgrade, an unknown state) is not a real recommendation - say so,
    # and let it appear once, in OTHER, with its greyed-out reason like any
    # other n/a entry (instead of silently vanishing from both sections).
    $recApplicable = ($recEntry -and $recEntry.kind -ne 'na')
    if ($recApplicable) { Entry $recEntry $true } else { W '    (no recommendation - see the notes above)' 'DarkGray' }
    # On a fresh machine with the demo bundled, Demo belongs right next to
    # the Fresh-install recommendation - not buried in OTHER - but it is
    # never itself "the recommendation" (no <<  tag).
    $demoUnderRecommended = ($v.state -eq 'empty' -and $HasDemo -eq 1)
    if ($demoUnderRecommended) {
        $dEntry = $entries | Where-Object { $_.n -eq 'D' } | Select-Object -First 1
        if ($dEntry) { Entry $dEntry $false }
    }
    W '  OTHER' 'White'
    foreach ($e in $entries) {
        if ($recApplicable -and $e.n -eq $recN) { continue }
        if ($demoUnderRecommended -and $e.n -eq 'D') { continue }
        Entry $e $false
    }
    W '  DATA' 'White'
    W '    5.  Backup now           Full restore point (code + .env + data + DB dump).' 'Gray'
    W ('    6.  Restore a previous version      Overwrites the current state - confirmation required.' + $(if (-not $s.db.reachable) { '  (database unreachable)' } else { '' })) 'Red'
    W '    7.  List restore points' 'Gray'
    W '  MAINTENANCE' 'White'
    W '    8.  Verify health        pm2 status + HTTP probe.' 'Gray'
    W '    9.  Diagnostics / logs   Versions, DBs, .env flags, last log lines.' 'Gray'
    W '    E.  Configure .env       Guided questionnaire (fills placeholders).' 'Gray'
    W '    C.  Check DB connection  PostgreSQL pre-flight.' 'Gray'
    W ''
    W '    0.  Exit' 'Gray'
    W ' ---------------------------------------------------------------------------' 'Cyan'
    exit 0
} catch {
    if ($ColorProbe) { Write-Output 'INSTALL_COLOR=unknown'; exit 0 }
    $reason = (([string]$_.Exception.Message) -replace '[\r\n]+', ' ')
    if ([string]::IsNullOrWhiteSpace($reason)) { $reason = 'unreadable situation file' }
    W ''
    W ('  Situation unavailable - ' + $reason) 'Red'
    Show-FallbackMenu $HasDemo
    exit 0
}
