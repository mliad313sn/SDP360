# =====================================================================
# Show-Situation.ps1 - renders the coloured situation block + the grouped menu
# for Setup.bat (cmd cannot colour). Reads the JSON written by Detect-SDP.ps1.
#   -Situation <json> -HasDemo 0|1
# Menu numbers are unchanged; Setup.bat keeps the prompt + dispatch.
# Never throws, exit 0 always: this script only RENDERS a menu, it never
# changes anything, so a crash here would leave Setup.bat with no menu at
# all. Neither parameter is Mandatory (a missing/empty -Situation must not
# make PowerShell prompt interactively and hang) - both default to '' / '0'
# and are validated inside the try. A situation file that is missing, empty,
# malformed, lacking an "install" section, or whose "install" section has
# NEITHER install.dir NOR install.has_server_js (e.g. `{"install":{}}`) falls
# into the fallback branch (a red "Situation unavailable" line + the full
# static menu, every install-affecting entry dark grey). A situation file
# that parses fine but carries STATE=unknown (Detect-SDP's own catch-path
# shape) is rendered through the NORMAL path below with every
# install-affecting entry marked not-applicable.
# KEEP PURE ASCII (no box glyphs).
# =====================================================================
param([string]$Situation = '', [string]$HasDemo = '0', [switch]$ColorProbe)
$ErrorActionPreference = 'Stop'
function W([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }

# Single source of truth for the Install line's colour (spec 4.2), used on
# EVERY state - no branch in the main render prints a hard-coded colour for
# this line. empty -> Gray (nothing to warn about yet); anything that is not
# literally 'installed' (partial, unknown, null, a future value) -> Red;
# otherwise Yellow when ANY of pm2/port/db is not clean, Green only when
# none of those apply. Exposed via -ColorProbe (prints ONLY
# "INSTALL_COLOR=<colour>" and exits 0) so tests can assert the decision
# directly instead of trying to detect a Write-Host colour from captured
# text.
function Get-InstallLineColor($sit) {
    $st = $sit.verdict.state
    if ($st -eq 'empty') { return 'Gray' }
    if ($st -ne 'installed') { return 'Red' }
    $pm2 = if ($sit.runtime -and $sit.runtime.pm2_process) { $sit.runtime.pm2_process } else { 'absent' }
    $port = if ($sit.runtime -and $sit.runtime.port_owner) { $sit.runtime.port_owner } else { 'unknown' }
    $dbOk = [bool]$sit.db.reachable
    if ($pm2 -ne 'online' -or $port -eq 'foreign' -or -not $dbOk) { return 'Yellow' }
    return 'Green'
}

# Every piece of free text that originates OUTSIDE this script's own literals
# (a note composed by SdpSituation.ps1, an install dir from config.psd1, a
# probe error message, a caught exception message) goes through this before
# it reaches Write-Host: control characters (incl. newlines and ESC) become a
# single space, runs of whitespace collapse to one, and the result is
# truncated so one hostile/garbled value can't wrap the menu or split across
# lines.
function Clean([string]$t, [int]$max = 160) {
    if ($null -eq $t) { return '' }
    $c = ($t -replace '[\x00-\x1F\x7F]', ' ')
    $c = ($c -replace '\s+', ' ').Trim()
    if ($c.Length -gt $max) { $c = $c.Substring(0, $max) + '...' }
    return $c
}

# Full static menu for when there is no situation data to reason about at
# all (missing / empty / malformed JSON, or a JSON whose "install" section is
# absent or has neither dir nor has_server_js). DATA and MAINTENANCE never
# depend on the situation, so they are identical to the normal path; every
# install-affecting entry (1/2/3/4/D) is dark grey with the same reason.
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
    # Converted first, inside the try, so it is set before anything that
    # could throw - the catch block passes it to Show-FallbackMenu.
    $demo = if ($HasDemo -eq '1') { 1 } else { 0 }
    if ([string]::IsNullOrWhiteSpace($Situation)) { throw 'no situation file provided' }
    if (-not (Test-Path -LiteralPath $Situation)) { throw ('situation file not found: ' + $Situation) }
    $raw = Get-Content -LiteralPath $Situation -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($raw)) { throw 'situation file empty or unreadable' }
    try { $s = $raw | ConvertFrom-Json } catch { throw 'situation file is not valid JSON' }
    # Rejects: no JSON object at all, no "install" key, OR an "install"
    # object with neither a dir NOR a has_server_js flag (e.g. `{"install":{}}`
    # - a shape Detect-SDP.ps1 never emits itself, but a hand-edited or
    # future-format situation file could, and there is nothing usable to
    # render from it).
    $noInstallFacts = [string]::IsNullOrWhiteSpace($s.install.dir) -and ($null -eq $s.install.has_server_js)
    if ($null -eq $s -or -not $s.install -or $noInstallFacts) { throw 'situation file has no installation data (no install.dir and no install.has_server_js) - rerun detection' }
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
    # per-value colour table beyond the two-way split inside Get-InstallLineColor.
    $pm2Val = Clean $(if ($s.runtime -and $s.runtime.pm2_process) { $s.runtime.pm2_process } else { 'absent' })
    $portVal = Clean $(if ($s.runtime -and $s.runtime.port_owner) { $s.runtime.port_owner } else { 'unknown' })
    $dirTxt = Clean $s.install.dir

    W ''
    W ' -- Situation ---------------------------------------------------------------' 'Cyan'
    if ($v.state -eq 'empty') {
        W ('  Install    : ' + $dirTxt + '   (nothing installed)') (Get-InstallLineColor $s)
    } else {
        $rt = 'pm2 ' + $pm2Val + ', port ' + $portVal
        W ('  Install    : ' + $dirTxt + '   ' + $iv + '   (' + $rt + ')') (Get-InstallLineColor $s)
        if ($s.db.reachable -and $s.db.counts) {
            $c = $s.db.counts
            W ('  Database   : ' + (Clean $s.db.db) + '  ' + $s.db.size_mb + ' MB   sites ' + $c.sites + ' | reports ' + $c.weekly_reports + ' | PV ' + $c.md_meetings + ' | inspections ' + $c.insp_inspections + ' | users ' + $c.users) 'Green'
        } else {
            $dbErr = Clean $s.db.error
            if ($dbErr) { W ('  Database   : not reachable - counts unavailable (' + $dbErr + ')') 'Yellow' }
            else { W '  Database   : not reachable - counts unavailable' 'Yellow' }
        }
        if ($s.backups.last_full) {
            $b = $s.backups.last_full
            $sizeTxt = if ($null -ne $b.size_mb) { $b.size_mb } else { '?' }
            $bNameTxt = Clean $b.name
            if ($null -eq $b.age_hours) {
                W ('  Backups    : last full - age unknown (' + $bNameTxt + ', ' + $sizeTxt + ' MB) | ' + $s.backups.count + ' kept') 'Yellow'
            } else {
                $col2 = if ($b.age_hours -gt 168) { 'Yellow' } else { 'Green' }
                W ('  Backups    : last full ' + [math]::Round($b.age_hours / 24, 1) + ' d ago (' + $bNameTxt + ', ' + $sizeTxt + ' MB) | ' + $s.backups.count + ' kept') $col2
            }
        } else { W '  Backups    : none yet' 'Yellow' }
    }
    # node_modules status always reflects the raw 3-way lockfile comparison;
    # the "-> X recommended" suffix is layered on ONLY when verdict.recommended
    # is itself patch/upgrade (i.e. there is something applicable to suggest -
    # 'fresh', null, or a state that later gets marked not-applicable never
    # gets a suffix). A downgrade bundle overrides the whole clause: it is
    # never "recommended" anything, so the line says so plainly instead.
    $lockWord = if ($null -eq $s.bundle.lockfile_same_as_installed) { 'unknown' } elseif ($s.bundle.lockfile_same_as_installed -eq $true) { 'unchanged' } else { 'changed' }
    $recWord = $null
    if (-not $stateUnknown -and ($v.recommended -eq 'patch' -or $v.recommended -eq 'upgrade')) {
        $recWord = $v.recommended.Substring(0, 1).ToUpper() + $v.recommended.Substring(1)
    }
    $lockTxt =
        if ($v.downgrade) { '   OLDER than the installed version' }
        elseif ($recWord) { '   node_modules ' + $lockWord + ' -> ' + $recWord + ' recommended' }
        else { '   node_modules ' + $lockWord }
    W ('  Bundle     : ' + $bv + $lockTxt) $(if ($v.downgrade) { 'Red' } else { 'Gray' })
    foreach ($n in @($v.notes)) { $cn = Clean $n; if ($cn) { W ('  ! ' + $cn) $(if ($v.downgrade -or $v.state -eq 'partial' -or $stateUnknown) { 'Red' } else { 'Yellow' }) } }
    W ' ---------------------------------------------------------------------------' 'Cyan'
    W ''
    switch ($v.state) {
        'empty'     { W ('  Nothing is installed in ' + $dirTxt + '. This package contains ' + $bv + '.') 'White' }
        'installed' { W ('  SDP Dashboard ' + $iv + ' is installed and this package contains ' + $bv + '.') 'White' }
        'partial'   { W ('  ' + $dirTxt + ' holds an INCOMPLETE installation. This package contains ' + $bv + '.') 'White' }
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
    if ($demo -eq 1) { $entries += @{ n = 'D'; name = 'Demo laptop'; desc = 'Fresh install + load the bundled dataset.'; kind = $(if ($v.state -eq 'empty') { 'ok' } else { 'red' }); why = '' } }
    # Single list of the install-affecting entry keys, reused by both
    # override loops below instead of two copies of the same literal array.
    $installEntryKeys = @('1', '2', '3', '4', 'D')
    if ($stateUnknown) {
        foreach ($e in $entries) { if ($installEntryKeys -contains $e.n) { $e.kind = 'na'; $e.why = 'situation unknown - run 9 (Diagnostics)' } }
    } elseif ($v.downgrade) {
        foreach ($e in $entries) { if ($installEntryKeys -contains $e.n) { $e.kind = 'na'; $e.why = 'bundle older than installed - use a newer bundle' } }
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
    $demoUnderRecommended = ($v.state -eq 'empty' -and $demo -eq 1)
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
    # 'no PG_URL in .env' is the exact error Get-SdpDbCounts (SdpSituation.ps1)
    # writes when .env names no database - that is not an outage, there is no
    # PostgreSQL to reach (sqlite install), so say so instead of "unreachable".
    $restoreNote = ''
    if (-not $s.db.reachable) {
        $restoreNote = if ([string]$s.db.error -eq 'no PG_URL in .env') { '  (no PostgreSQL configured)' } else { '  (database unreachable)' }
    }
    W ('    6.  Restore a previous version      Overwrites the current state - confirmation required.' + $restoreNote) 'Red'
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
    $reason = Clean ([string]$_.Exception.Message)
    if ([string]::IsNullOrWhiteSpace($reason)) { $reason = 'unreadable situation file' }
    W ''
    W ('  Situation unavailable - ' + $reason) 'Red'
    Show-FallbackMenu $demo
    exit 0
}
