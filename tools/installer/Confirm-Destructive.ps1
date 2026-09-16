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

if (-not (Test-Path $Situation)) { Refuse "situation file not found: $Situation" }
$s = Get-Content $Situation -Raw | ConvertFrom-Json
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
        if ($Target -match '\.sql$') { Refuse ($Target + ' is a DB-only dump; only sdp-restore_*.zip restore points can be restored from the menu.') }
        if ($Target -notmatch '\.zip$') { $Target = $Target + '.zip' }   # same tolerance as Manage-SDP -Restore -Name
        $zip = Join-Path $s.backups.dir $Target
        if (-not (Test-Path $zip)) { Refuse ('restore point not found: ' + $zip) }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [System.IO.Compression.ZipFile]::OpenRead($zip)
        try { $names = @($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() }
        $hasCode = ($names -contains 'server.js'); $hasEnv = ($names -contains '.env')
        $hasData = (($names | Where-Object { $_ -like 'data/*' -or $_ -like 'data\*' }).Count -gt 0)
        $hasDump = (($names | Where-Object { $_ -match '\.sql$' }).Count -gt 0)
        $contents = @(); if ($hasCode) { $contents += 'code' }; if ($hasEnv) { $contents += '.env' }; if ($hasData) { $contents += 'data' }; if ($hasDump) { $contents += 'DB dump' }
        $when = (Get-Item $zip).LastWriteTime.ToString('yyyy-MM-dd HH:mm')
        $what = 'Overwrite the CURRENT ' + (($contents) -join ' + ') + ' with restore point ' + $Target + ' (created ' + $when + ').' + $(if ($hasDump) { ' The database is DROPPED and reloaded from the dump.' } else { ' No database change (no dump inside).' })
        $protect = 'A pre-restore restore point of the CURRENT state is taken first; if it cannot be taken, the restore is aborted.'
        $phrase = if ($Target -match '_(\d{8})-\d{6}\.zip$') { 'RESTORE ' + $Matches[1] } else { 'RESTORE ' + ($Target -replace '\.zip$', '') }
    }
}

# ---- the screen ---------------------------------------------------------------
Write-Host ''
Red '                                                                              '
Red ('   !!  DESTRUCTIVE ACTION - ' + $Action.ToUpper().PadRight(51) + ' ')
Red '                                                                              '
Write-Host ''
Write-Host '  What will happen' -ForegroundColor White
Line ('    ' + $what)
Write-Host ''
Write-Host '  What is at stake right now' -ForegroundColor White
if ($s.db.reachable -and $s.db.counts) {
    $c = $s.db.counts
    Line ('    Database ' + $dbName + '  ' + $s.db.size_mb + ' MB  |  sites ' + $c.sites + '  reports ' + $c.weekly_reports + '  PV ' + $c.md_meetings + '  inspections ' + $c.insp_inspections + '  users ' + $c.users + '  assets ' + $c.assets)
} else { Warn '    Database counts unavailable (not reachable)' }
Line ('    Installed version ' + $(if ($s.install.version) { $s.install.version } else { 'unknown' }) + '  |  .env present: ' + $s.install.has_env)
if ($s.backups.last_full) { Line ('    Last full restore point: ' + $s.backups.last_full.name + ' (' + [math]::Round($s.backups.last_full.age_hours / 24, 1) + ' days ago)') }
else { Warn '    No full restore point exists yet' }
Write-Host ''
Write-Host '  What protects you' -ForegroundColor White
Line ('    ' + $protect)
Write-Host ''
Write-Host ('  Type exactly  ' + $phrase + '  to continue, anything else to cancel:') -ForegroundColor Yellow
Write-Host '  > ' -NoNewline
$typed = $null
try { $typed = [Console]::In.ReadLine() } catch { $typed = $null }
if ($typed -eq $null) { Write-Host ''; Write-Host '  Cancelled - no input (nothing changed).' -ForegroundColor Yellow; exit 1 }
if ($typed.Trim() -cne $phrase) { Write-Host '  Cancelled - phrase did not match (nothing changed).' -ForegroundColor Yellow; exit 1 }
Write-Host ('  Confirmed: ' + $phrase) -ForegroundColor Green
exit 0
