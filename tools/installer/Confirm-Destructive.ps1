# =====================================================================
# Confirm-Destructive.ps1 - the ONE red screen before anything destructive.
#   -Action reinstall | dropdb | fresh-over-existing | restore
#   -Situation <json written by Detect-SDP.ps1>   -Target <restore point file name> (restore)
# Prints what will happen, what is at stake (real counts), what protects you,
# then requires an EXACT case-sensitive phrase. Exit 0 only on a match.
# Closed/empty stdin -> exit 1 (never auto-confirmed). A piped phrase is accepted
# like a typed one (tests + piped Setup.bat runs). KEEP PURE ASCII.
# =====================================================================
param(
    [Parameter(Mandatory = $true)][ValidateSet('reinstall', 'dropdb', 'fresh-over-existing', 'restore')][string]$Action,
    [Parameter(Mandatory = $true)][string]$Situation,
    [string]$Target
)
$ErrorActionPreference = 'Stop'
function Red([string]$t)  { Write-Host $t -ForegroundColor White -BackgroundColor DarkRed }
function Line([string]$t) { Write-Host $t -ForegroundColor Gray }
function Warn([string]$t) { Write-Host $t -ForegroundColor Yellow }
function Refuse([string]$why) { Write-Host ''; Write-Host ('  REFUSED: ' + $why) -ForegroundColor Red; exit 1 }
function OrQ($v) { if ($null -eq $v) { '?' } else { $v } }

# Safety net: any unexpected terminating error becomes a clean refusal
# (exit 1, "REFUSED: ...") instead of a raw .NET stack trace on an operator's
# screen. Errors we anticipate are still caught locally (see below) so they
# get a specific message; this is the catch-all for everything else.
trap { Refuse ('unexpected error: ' + (($_.Exception.Message) -replace '[\r\n]+', ' ')) }

if (-not (Test-Path $Situation)) { Refuse "situation file not found: $Situation" }
$raw = Get-Content $Situation -Raw -ErrorAction SilentlyContinue
if ([string]::IsNullOrWhiteSpace($raw)) { Refuse 'situation file empty or unreadable' }
try { $s = $raw | ConvertFrom-Json } catch { Refuse 'situation file empty or unreadable' }
if ($null -eq $s -or -not $s.install) { Refuse 'situation file has no installation data - rerun detection' }
$dbName = if ($s.db -and $s.db.db) { $s.db.db } else { 'sdp_dashboard' }

# ---- per-action facts -------------------------------------------------------
$phrase = ''; $what = ''; $protect = ''
switch ($Action) {
    'reinstall' {
        $what = 'Re-deploy code + node_modules from this bundle over ' + $s.install.dir + '. Database, data\ and blobs\ are KEPT.'
        $protect = 'A full restore point of the CURRENT state (code + .env + data + DB dump) is taken FIRST, before anything is touched.'
        $phrase = 'REINSTALL'
    }
    'dropdb' {
        if (-not $s.db.reachable) { Refuse 'database not reachable - counts unavailable. Take a backup (option 5) and check the DB (option C) before dropping anything.' }
        $what = 'DROP DATABASE ' + $dbName + ' and recreate it EMPTY. Every report, PV, inspection, user and asset record in it is destroyed.'
        $protect = 'The restore point taken first MUST contain the DB dump - the installer refuses the DROP otherwise.'
        $phrase = 'DROP ' + $dbName
    }
    'fresh-over-existing' {
        $what = 'Fresh install over an EXISTING installation in ' + $s.install.dir + ': code and node_modules are replaced. Your database, data\, blobs\ and .env are NOT deleted.'
        $protect = 'A full restore point of the CURRENT state is taken first; automatic rollback applies if the app does not come back.'
        $phrase = 'OVERWRITE ' + $env:COMPUTERNAME
    }
    'restore' {
        if (-not $Target) { Refuse 'restore needs -Target <restore point file name>' }
        if ($Target -match '[\\/]') { Refuse 'restore point name must be a file name, not a path' }
        if (-not $s.backups -or -not $s.backups.dir) { Refuse 'backup folder unknown' }
        if ($Target -match '\.sql$') { Refuse ($Target + ' is a DB-only dump; only sdp-restore_*.zip restore points can be restored from the menu.') }
        if ($Target -notmatch '\.zip$') { $Target = $Target + '.zip' }   # same tolerance as Manage-SDP -Restore -Name
        $zip = Join-Path $s.backups.dir $Target
        if (-not (Test-Path $zip)) { Refuse ('restore point not found: ' + $zip) }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        try { $z = [System.IO.Compression.ZipFile]::OpenRead($zip) } catch { Refuse 'restore point unreadable (corrupt or locked)' }
        try { $names = @($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() }
        $hasCode = ($names -contains 'server.js'); $hasEnv = ($names -contains '.env')
        $hasData = (($names | Where-Object { $_ -like 'data/*' -or $_ -like 'data\*' }).Count -gt 0)
        # ROOT entry only. A real restore point is a full copy of the install
        # dir, so it always contains repo files that happen to end in .sql
        # (db\postgres\...\NNN_init.sql) - "any .sql anywhere" would false-
        # positive on every restore point. sdp_dashboard.sql AT THE ROOT is
        # exactly what Manage-SDP.ps1's 'restore' action looks for
        # ($dump = Join-Path $InstallDir 'sdp_dashboard.sql') - match that
        # same rule here so the screen agrees with what actually happens.
        $hasDump = ($names -contains 'sdp_dashboard.sql')
        $contents = @(); if ($hasCode) { $contents += 'code' }; if ($hasEnv) { $contents += '.env' }; if ($hasData) { $contents += 'data' }; if ($hasDump) { $contents += 'DB dump' }
        $when = (Get-Item $zip).LastWriteTime.ToString('yyyy-MM-dd HH:mm')
        $what = 'Overwrite the CURRENT ' + (($contents) -join ' + ') + ' with restore point ' + $Target + ' (created ' + $when + ').' + $(if ($hasDump) { ' The database is DROPPED and reloaded from the dump.' } else { ' No database change (no dump inside).' })
        $protect = 'A pre-restore restore point of the CURRENT state is taken first; if it cannot be taken, the restore is aborted.'
        $phrase = if ($Target -match '_(\d{8})-\d{6}\.zip$') { 'RESTORE ' + $Matches[1] } else { 'RESTORE ' + ($Target -replace '\.zip$', '') }
    }
}

# ---- the screen ---------------------------------------------------------------
Write-Host ''
$bannerTitle = ('   !!  DESTRUCTIVE ACTION - ' + $Action.ToUpper() + ' ')
Red (''.PadRight(78))
Red ($bannerTitle.PadRight(78))
Red (''.PadRight(78))
Write-Host ''
Write-Host '  What will happen' -ForegroundColor White
Line ('    ' + $what)
Write-Host ''
Write-Host '  What is at stake right now' -ForegroundColor White
if ($s.db.reachable -and $s.db.counts) {
    $c = $s.db.counts
    Line ('    Database ' + $dbName + '  ' + (OrQ $s.db.size_mb) + ' MB  |  sites ' + (OrQ $c.sites) + '  reports ' + (OrQ $c.weekly_reports) + '  PV ' + (OrQ $c.md_meetings) + '  inspections ' + (OrQ $c.insp_inspections) + '  users ' + (OrQ $c.users) + '  assets ' + (OrQ $c.assets))
} else { Warn '    Database counts unavailable (not reachable)' }
Line ('    Installed version ' + $(if ($s.install.version) { $s.install.version } else { 'unknown' }) + '  |  .env present: ' + $(if ($null -ne $s.install.has_env) { $s.install.has_env } else { 'unknown' }))
if ($s.backups.last_full) { Line ('    Last full restore point: ' + $s.backups.last_full.name + ' (' + [math]::Round($s.backups.last_full.age_hours / 24, 1) + ' days ago)') }
else { Warn '    No full restore point exists yet' }
Write-Host ''
Write-Host '  What protects you' -ForegroundColor White
Line ('    ' + $protect)
Write-Host ''
Write-Host ('  Type exactly  ' + $phrase + '  to continue, anything else to cancel:') -ForegroundColor Yellow
Write-Host '  > ' -NoNewline
# Redirected stdin (pipe / file - piped Setup.bat runs, tests): read ONE line
# byte by byte from the raw stream. [Console]::In is a buffered StreamReader
# that reads ahead and swallows the lines meant for the caller's next
# `set /p` (the handle is shared with cmd). Reading 1 byte at a time stops
# exactly after the LF, so the rest stays unread. EOF before any byte ->
# $null (cancel). Interactive console keeps ReadLine (line editing, echo).
function Read-OneLineRaw {
    $stream = [Console]::OpenStandardInput()
    $buf = New-Object System.Collections.Generic.List[byte]
    $sawAny = $false
    while ($true) {
        $b = $stream.ReadByte()
        if ($b -lt 0) { break }
        $sawAny = $true
        if ($b -eq 10) { break }
        $buf.Add([byte]$b)
    }
    if (-not $sawAny) { return $null }
    if ($buf.Count -gt 0 -and $buf[$buf.Count - 1] -eq 13) { $buf.RemoveAt($buf.Count - 1) }
    # A PowerShell parent with a UTF-8 $OutputEncoding pipes a BOM first; the
    # StreamReader used to drop it silently - do the same (else Trim() stops at it).
    if ($buf.Count -ge 3 -and $buf[0] -eq 0xEF -and $buf[1] -eq 0xBB -and $buf[2] -eq 0xBF) { $buf.RemoveRange(0, 3) }
    return [Console]::InputEncoding.GetString($buf.ToArray())
}
$typed = $null
try {
    if ([Console]::IsInputRedirected) { $typed = Read-OneLineRaw }
    else { $typed = [Console]::In.ReadLine() }
} catch { $typed = $null }
Write-Host ''
if ($null -eq $typed) { Write-Host '  Cancelled - no input (nothing changed).' -ForegroundColor Yellow; exit 1 }
# Trim only leading/trailing whitespace (cmd's `echo PHRASE | script` pipes a
# trailing space) - case and inner content still must match exactly.
if ($typed.Trim() -cne $phrase) { Write-Host '  Cancelled - phrase did not match (nothing changed).' -ForegroundColor Yellow; exit 1 }
Write-Host ('  Confirmed: ' + $phrase) -ForegroundColor Green
exit 0
