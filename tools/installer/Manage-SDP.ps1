# =====================================================================
# Manage-SDP.ps1 - SDP Dashboard maintenance actions.
# THE single backup/restore/schedule implementation, used by:
#   - Setup.bat (installer menu) and _sdp_admin.cmd (server menu)
#   - Install-SDP.ps1 step 5 (automatic pre-upgrade backup)
#   - the two Task Scheduler jobs (scheduled backups)
#   - the app's admin card via services/backupSchedule.js
#
# KEEP THIS FILE PURE ASCII (Windows PowerShell 5.1 ANSI parse pitfall).
#
# Actions (exactly one):
#   -Backup [-DbOnly] [-Tag <label>]     restore point / db dump
#   -Restore -Name <file>[.zip] [-Force] roll back code+.env (+DB if dump present)
#   -List                                list restore points
#   -Prune [-RetentionFull N] [-RetentionDbOnly M]   (pre-restore points: own lane, newest 2 kept)
#   -CheckDb                             PostgreSQL pre-flight (provision-prod.js --check)
#   -Schedule -Daily HH:mm -Weekly DAY:HH:mm [-RetentionFull N] [-RetentionDbOnly M]
#   -Schedule -Disable                   disable both scheduled tasks
#   -ScheduleStatus                      KEY=VALUE digest of both tasks (parsed by the app)
#   -DailyJob / -WeeklyJob               composite actions the scheduled tasks invoke
# Common: -Config <psd1>  merge overrides (config.test.psd1 = the :3457 test instance)
# =====================================================================
param(
    [switch]$Backup,
    [switch]$DbOnly,
    [string]$Tag = 'manual',
    [switch]$Restore,
    [string]$Name,
    [switch]$List,
    [switch]$Prune,
    [int]$RetentionFull = 0,
    [int]$RetentionDbOnly = 0,
    [switch]$CheckDb,
    [switch]$Schedule,
    [string]$Daily,
    [string]$Weekly,
    [switch]$Disable,
    [switch]$ScheduleStatus,
    [switch]$DailyJob,
    [switch]$WeeklyJob,
    [switch]$Force,
    [string]$Config
)
$ErrorActionPreference = 'Stop'

# --- config -----------------------------------------------------------
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
# Shared readers (Test-SdpZipHasDump: "does this restore point carry a COMPLETE
# root dump?") - one rule for Install-SDP, Detect-SDP and this script.
. (Join-Path $here 'SdpSituation.ps1')
$cfg = Import-PowerShellDataFile (Join-Path $here 'config.psd1')
if ($Config) {
    $ovPath = if (Test-Path $Config) { $Config } else { Join-Path $here $Config }
    $ov = Import-PowerShellDataFile $ovPath
    foreach ($k in $ov.Keys) { $cfg[$k] = $ov[$k] }
}
$InstallDir = $cfg.InstallDir
$BackupDir  = Join-Path $InstallDir $cfg.BackupDir
$BackupDir  = [System.IO.Path]::GetFullPath($BackupDir)
if ($RetentionFull   -le 0) { $RetentionFull   = [int]$cfg.RetentionFull }
if ($RetentionDbOnly -le 0) { $RetentionDbOnly = [int]$cfg.RetentionDbOnly }
$SvcName  = $cfg.ServiceName
$TaskSfx  = if ($SvcName -ne 'endeavour-dashboard') { '-' + $SvcName } else { '' }
$TaskDaily  = 'SDP-Backup-DB-Daily'    + $TaskSfx
$TaskWeekly = 'SDP-Backup-Full-Weekly' + $TaskSfx

# --- logging ----------------------------------------------------------
# SDP_INSTALLER_LOG_DIR overrides the log folder (the unit tests point it at a
# temp dir); the default is unchanged.
$LogDir = if ($env:SDP_INSTALLER_LOG_DIR) { $env:SDP_INSTALLER_LOG_DIR } else { 'C:\ProgramData\SDP-Dashboard\logs' }
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$action = @('backup','restore','list','prune','checkdb','schedule','status','dailyjob','weeklyjob')[
    @($Backup,$Restore,$List,$Prune,$CheckDb,$Schedule,$ScheduleStatus,$DailyJob,$WeeklyJob).IndexOf($true)]
if (-not $action) { Write-Host 'No action switch given. See the header of this file.' -ForegroundColor Yellow; exit 2 }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$LogFile = Join-Path $LogDir ("manage-$action-$stamp.log")
function Log($m, $lvl = 'INFO') {
    $c = switch ($lvl) { 'OK' {'Green'} 'WARN' {'Yellow'} 'ERROR' {'Red'} 'STEP' {'Cyan'} default {'Gray'} }
    $line = (Get-Date -Format 'HH:mm:ss') + " [$lvl] $m"
    Write-Host $line -ForegroundColor $c
    Add-Content -Path $LogFile -Value $line
}
function Die($m) { Log $m 'ERROR'; exit 1 }

# --- helpers ----------------------------------------------------------
function Invoke-Pm2([string[]]$pmArgs) {
    $pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
    if ($pm2) { try { & pm2 @pmArgs 2>$null | Out-Null } catch { Log ("pm2 " + ($pmArgs -join ' ') + " failed: " + $_.Exception.Message) 'WARN' } }
    else { Log 'pm2 not found on this machine - skipping pm2 action' 'WARN' }
}
function Invoke-Robocopy($src, $dst, [string[]]$extra) {
    & robocopy $src $dst /E /NFL /NDL /NJH /NJS @extra | Out-Null
    if ($LASTEXITCODE -ge 8) { Die "robocopy failed ($LASTEXITCODE) $src -> $dst" }
}
# dump-db.js prints progress on stdout: route it to the host (the console /
# the parent's capture), never into this function's return value - otherwise
# the caller's `if (-not (Invoke-PgDump ...))` sees a non-empty array and a
# FAILED dump reads as success.
function Invoke-PgDump($outFile) {
    Push-Location $InstallDir
    try {
        & node (Join-Path $InstallDir 'tools\pg\dump-db.js') $outFile | ForEach-Object { Write-Host $_ }
        return [bool]($LASTEXITCODE -eq 0)
    }
    finally { Pop-Location }
}
# Reads the zip's ROOT .env entry in memory (never extracted to disk) with the
# SAME rule as the current .env (Get-SdpEnvTextValue, aligned with dump-db.js).
# Returns @{ hasEnv = bool; value = string-or-null }. Throws if the zip cannot
# be read - the caller must not guess which database a restore will drop.
function Get-ZipEnvValue([string]$zipPath, [string]$key) {
    $r = Get-SdpZipRootEntryText $zipPath '.env'
    if (-not $r.found) { return @{ hasEnv = $false; value = $null } }
    return @{ hasEnv = $true; value = (Get-SdpEnvTextValue $r.text $key) }
}
# Pre-restore safety points (sdp-restore_pre-restore_*.zip) live in their OWN
# retention lane: they never count toward RetentionFull (so a burst of restores
# cannot push out the weekly/manual points - including the one being restored),
# and only the newest $PreRestoreKeep of them are kept.
$PreRestoreKeep = 2
$PreRestorePattern = 'sdp-restore_pre-restore_*.zip'
# Pure: the files a prune deletes. $full = sdp-restore_*.zip, $dbo = sdp-db_*.sql
# (FileInfo lists, any order).
function Get-PruneTargets($full, $dbo, [int]$keepFull, [int]$keepDb, [int]$keepPre) {
    $all = @($full | Sort-Object LastWriteTime -Descending)
    $pre = @($all | Where-Object { $_.Name -like $PreRestorePattern })
    $reg = @($all | Where-Object { $_.Name -notlike $PreRestorePattern })
    $db  = @($dbo | Sort-Object LastWriteTime -Descending)
    return @(@($reg | Select-Object -Skip $keepFull) + @($pre | Select-Object -Skip $keepPre) + @($db | Select-Object -Skip $keepDb))
}
function Get-EnvValue($key) { return (Get-SdpEnvValue $InstallDir $key) }
function Resolve-SuperPassword {
    # Same convention as provision-prod.js: the standard appliance value.
    #
    # PG_SUPER_PASSWORD (env, then EnvAnswers) overrides it, because a cluster
    # this installer did NOT create - 4MyPeople's, or one the operator set up -
    # has its own postgres password, and a restore that assumes the appliance
    # default fails at DROP DATABASE with an authentication error that names
    # nothing useful. Install-SDP prompts for it; here, where restores also run
    # unattended from Task Scheduler, it is read from the environment.
    if ($env:PG_SUPER_PASSWORD) { return $env:PG_SUPER_PASSWORD }
    if ($cfg.EnvAnswers -and $cfg.EnvAnswers.ContainsKey('PG_SUPER_PASSWORD') -and $cfg.EnvAnswers.PG_SUPER_PASSWORD) {
        return [string]$cfg.EnvAnswers.PG_SUPER_PASSWORD
    }
    return $cfg.StandardPgSuperPassword
}
function Find-PgBin($exe) {
    foreach ($root in @('C:\Program Files\PostgreSQL', 'C:\Program Files (x86)\PostgreSQL')) {
        if (Test-Path $root) {
            foreach ($v in (Get-ChildItem $root -Directory | Sort-Object { [double]$_.Name } -Descending)) {
                $p = Join-Path $v.FullName ("bin\" + $exe)
                if (Test-Path $p) { return $p }
            }
        }
    }
    return $null
}

# =====================================================================
switch ($action) {

'backup' {
    if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
    if ($DbOnly) {
        $out = Join-Path $BackupDir ("sdp-db_$stamp.sql")
        Log "DB-only backup -> $out" 'STEP'
        if (-not (Invoke-PgDump $out)) { Die 'pg dump failed' }
        if (Test-Path -LiteralPath $out) { Log "DB backup done: $out" 'OK' }
        else { Log 'pg dump exited OK but no dump written (no PG_URL configured? sqlite-only install?)' 'WARN' }
        break
    }
    Log "Full restore point (code + .env + data + blobs + pg_dump)" 'STEP'
    $stage = Join-Path $env:TEMP ("sdp-manage-bak-" + (Get-Random))
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    try {
        # data\ and blobs\ INCLUDED by design (sqlite rollback path; photos exist nowhere else).
        # sdp_dashboard.sql EXCLUDED: a stale dump can sit at $InstallDir root
        # from a prior restore (Restore only removes it after a SUCCESSFUL
        # import - see the 'restore' branch below), and if this run's OWN
        # Invoke-PgDump then fails/warns, robocopy would otherwise have already
        # carried that stale dump into the new restore point - making it LOOK
        # complete while actually describing an earlier point in time. Excluding
        # it means the only root sdp_dashboard.sql a restore point can ever
        # contain is the one Invoke-PgDump writes on THIS run, right below.
        Invoke-Robocopy $InstallDir $stage @('/XD','node_modules','node_modules.prev','.git',$BackupDir,'/XF','raw_cache.json','*.log','sdp_dashboard.sql')
        if (-not (Invoke-PgDump (Join-Path $stage 'sdp_dashboard.sql'))) { Log 'pg dump skipped/failed (sqlite-only install?)' 'WARN' }
        $zip = Join-Path $BackupDir ("sdp-restore_" + $Tag + "_$stamp.zip")
        Log "Compressing -> $zip" 'STEP'
        Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
        Log ("Restore point complete: " + (Split-Path $zip -Leaf) + " (" + [math]::Round((Get-Item $zip).Length/1MB,1) + " MB)") 'OK'
        Write-Output $zip   # consumed by Install-SDP.ps1 step 5
    } finally { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
}

'restore' {
    if (-not $Name) { Die 'Restore needs -Name <restore point file name>' }
    if ($Name -notmatch '\.zip$') { $Name = $Name + '.zip' }
    $zip = Join-Path $BackupDir $Name
    if (-not (Test-Path $zip)) { Die "Not found: $zip" }
    if (-not $Force) {
        Write-Host "*** THIS OVERWRITES code + .env (and DB if the point contains a dump) in $InstallDir ***" -ForegroundColor Red
        $ok = Read-Host 'Type YES to proceed'
        if ($ok -ne 'YES') { Log 'Cancelled by user.'; exit 0 }
    }
    # ---- which database will the import step below DROP? ----
    # Mirror it exactly: it runs after the zip is robocopied over $InstallDir,
    # then reads PG_URL from $InstallDir\.env (Get-EnvValue) and imports
    # $InstallDir\sdp_dashboard.sql if that file exists. So:
    #   - PG_URL = the zip's root .env when the zip carries one (it overwrites
    #     the current .env - even a zip .env WITHOUT PG_URL means "no DB step"),
    #     else the current .env's.
    #   - a drop happens when that PG_URL is non-empty AND the zip carries a
    #     root dump (complete or not). A stale install-dir dump left by an
    #     earlier run never counts: it is deleted below, before the zip is
    #     copied, so the import only ever sees a dump from the restore point.
    # The value is never printed.
    try {
        $zipEnv = Get-ZipEnvValue $zip 'PG_URL'
        $zipHasSql = Test-SdpZipHasRootEntry $zip 'sdp_dashboard.sql'
    } catch { Die ('Cannot read the restore point (' + $_.Exception.Message + ') - restore aborted, nothing changed.') }
    # Fail closed: a .env that exists but cannot be read must not be mistaken
    # for "no PG_URL" (that would skip the database guard below).
    try { $curPgUrl = Get-SdpEnvValueStrict $InstallDir 'PG_URL' }
    catch { Die 'Cannot read the current .env - restore aborted, nothing changed.' }
    $effPgUrl = if ($zipEnv.hasEnv) { $zipEnv.value } else { $curPgUrl }
    $willDrop = [bool]$effPgUrl -and $zipHasSql
    $viaTarget = $willDrop -and ($effPgUrl -ne $curPgUrl)

    # ---- safety backup of the CURRENT state, before anything is stopped or overwritten ----
    # Re-invoke this script (one action per invocation - the dailyjob pattern);
    # its LAST stdout line is the zip path, exactly as Install-SDP step 5 reads it.
    # When a drop will happen, the child's dump-db.js is pointed at THAT database
    # through the environment (dump-db.js reads process.env.PG_URL before .env) -
    # never on a command line - so the safety point holds the database we drop,
    # even when the current .env names no database or a different one.
    Log 'Pre-restore restore point of the current state' 'STEP'
    $preArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Backup', '-Tag', 'pre-restore')
    if ($Config) { $preArgs += @('-Config', $Config) }
    $savedPgUrl = $env:PG_URL
    try {
        if ($willDrop) { $env:PG_URL = $effPgUrl }
        $preOut = @(& powershell @preArgs)
        $preCode = $LASTEXITCODE
    } finally { $env:PG_URL = $savedPgUrl }
    # The child's console lines were captured with its output - replay them.
    $preOut | Select-Object -SkipLast 1 | ForEach-Object { Write-Host $_ }
    if ($preCode -ne 0) { Die 'Pre-restore backup FAILED - restore aborted, nothing changed.' }
    $preZip = [string]($preOut | Select-Object -Last 1)
    if (-not ($preZip -and (Test-Path -LiteralPath $preZip))) { Die 'Pre-restore backup returned no zip - restore aborted, nothing changed.' }
    Log ('Pre-restore restore point: ' + (Split-Path $preZip -Leaf)) 'OK'
    # Rule: never drop a database we do not have a COMPLETE dump of.
    if ($willDrop -and -not (Test-SdpZipHasDump $preZip)) {
        # Nothing was changed and this point has no usable dump: do not leave
        # it behind to crowd the pre-restore lane.
        try {
            Remove-Item -LiteralPath $preZip -Force
            Log ('Removed the pre-restore point ' + (Split-Path $preZip -Leaf) + ' (restore refused, nothing changed)') 'WARN'
        } catch { Log ('Could not remove the pre-restore point ' + (Split-Path $preZip -Leaf) + ': ' + $_.Exception.Message) 'WARN' }
        $hint = if ($viaTarget) { ' (the database named by the restore point''s .env)' } else { '' }
        Die ('No database dump in the pre-restore point - refusing to overwrite the database' + $hint + '. Check PG_URL / the PostgreSQL service (menu C), then retry.')
    }
    # A root dump in the install dir can only be a leftover of an earlier run
    # (the import deletes its dump after a SUCCESS; a failed import leaves it).
    # Remove it so the import step never replays old data - the pre-restore
    # point above deliberately excludes it (robocopy /XF), so nothing is lost.
    $staleDump = Join-Path $InstallDir 'sdp_dashboard.sql'
    if (Test-Path -LiteralPath $staleDump) {
        try { Remove-Item -LiteralPath $staleDump -Force }
        catch { Die ('Cannot remove a stale sdp_dashboard.sql from the install dir (' + $_.Exception.Message + ') - restore aborted before any change.') }
        Log 'Removed a stale sdp_dashboard.sql left by an earlier run' 'WARN'
    }
    Log "Restoring $Name" 'STEP'
    Invoke-Pm2 @('stop', $SvcName)
    Start-Sleep -Seconds 3
    $stage = Join-Path $env:TEMP ("sdp-manage-rst-" + (Get-Random))
    try {
        Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
        Invoke-Robocopy $stage $InstallDir @()
        $dump = Join-Path $InstallDir 'sdp_dashboard.sql'
        $pgUrl = Get-EnvValue 'PG_URL'
        if ((Test-Path $dump) -and $pgUrl) {
            Log 'Restoring PostgreSQL database from the dump' 'STEP'
            $psql = Find-PgBin 'psql.exe'
            if (-not $psql) { Die 'psql.exe not found' }
            $u = [Uri]$pgUrl
            $db  = $u.AbsolutePath.TrimStart('/')
            $app = $u.UserInfo.Split(':')[0]
            $appPw = [Uri]::UnescapeDataString($u.UserInfo.Split(':')[1])
            $superPw = Resolve-SuperPassword
            $env:PGPASSWORD = $superPw
            & $psql -h $cfg.PgHost -p $cfg.PgPort -U postgres -d postgres -v ON_ERROR_STOP=1 -c ("DROP DATABASE IF EXISTS " + $db + " WITH (FORCE)") | Out-Null
            & $psql -h $cfg.PgHost -p $cfg.PgPort -U postgres -d postgres -v ON_ERROR_STOP=1 -c ("CREATE DATABASE " + $db + " OWNER " + $app) | Out-Null
            $env:PGPASSWORD = $appPw
            & $psql -h $cfg.PgHost -p $cfg.PgPort -U $app -d $db -q -f $dump | Out-Null
            $env:PGPASSWORD = ''
            if ($LASTEXITCODE -ne 0) { Die 'psql import failed - DB may be incomplete; see log' }
            Log 'Database restored' 'OK'
            Remove-Item $dump -Force -ErrorAction SilentlyContinue
        }
    } finally { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
    Invoke-Pm2 @('start', $SvcName)
    Log "Restored $Name + service started. Users: Ctrl+F5 once." 'OK'
}

'list' {
    Log "Restore points in $BackupDir" 'STEP'
    if (Test-Path $BackupDir) {
        Get-ChildItem $BackupDir -File | Where-Object { $_.Name -like 'sdp-restore_*.zip' -or $_.Name -like 'sdp-db_*.sql' } |
            Sort-Object LastWriteTime -Descending | ForEach-Object {
                Write-Host ("  {0,10:N1} MB  {1}  {2:yyyy-MM-dd HH:mm}" -f ($_.Length/1MB), $_.Name, $_.LastWriteTime) }
    } else { Write-Host '  none yet' }
}

'prune' {
    Log "Prune: keep $RetentionFull full + $RetentionDbOnly db-only + $PreRestoreKeep pre-restore" 'STEP'
    if (Test-Path $BackupDir) {
        $full = @(Get-ChildItem $BackupDir -File -Filter 'sdp-restore_*.zip')
        $dbo  = @(Get-ChildItem $BackupDir -File -Filter 'sdp-db_*.sql')
        $kill = Get-PruneTargets $full $dbo $RetentionFull $RetentionDbOnly $PreRestoreKeep
        foreach ($f in $kill) { Remove-Item $f.FullName -Force; Log ("pruned " + $f.Name) }
        Log ("Prune done (" + $kill.Count + " removed)") 'OK'
    }
}

'checkdb' {
    Push-Location $InstallDir
    try { & node (Join-Path $InstallDir 'tools\pg\provision-prod.js') --check; exit $LASTEXITCODE }
    finally { Pop-Location }
}

'schedule' {
    $ps1 = Join-Path $InstallDir 'tools\installer\Manage-SDP.ps1'
    if ($Disable) {
        foreach ($t in @($TaskDaily, $TaskWeekly)) { & schtasks /Change /TN $t /DISABLE 2>$null | Out-Null }
        Log 'Both scheduled tasks disabled' 'OK'; break
    }
    if (-not $Daily -or -not $Weekly) { Die 'Schedule needs -Daily HH:mm and -Weekly DAY:HH:mm (e.g. SUN:03:00)' }
    $wp = $Weekly.Split(':')
    if ($wp.Count -lt 3) { Die 'Weekly format is DAY:HH:mm e.g. SUN:03:00' }
    $wDay = $wp[0].ToUpper(); $wTime = $wp[1] + ':' + $wp[2]
    $cfgArg = if ($Config) { ' -Config "' + $Config + '"' } else { '' }
    $trD = '"powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "' + $ps1 + '" -DailyJob -RetentionFull ' + $RetentionFull + ' -RetentionDbOnly ' + $RetentionDbOnly + $cfgArg
    $trW = '"powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "' + $ps1 + '" -WeeklyJob -RetentionFull ' + $RetentionFull + ' -RetentionDbOnly ' + $RetentionDbOnly + $cfgArg
    & schtasks /Create /F /RU SYSTEM /SC DAILY  /ST $Daily /TN $TaskDaily  /TR $trD | Out-Null
    if ($LASTEXITCODE -ne 0) { Die "schtasks create $TaskDaily failed" }
    & schtasks /Create /F /RU SYSTEM /SC WEEKLY /D $wDay /ST $wTime /TN $TaskWeekly /TR $trW | Out-Null
    if ($LASTEXITCODE -ne 0) { Die "schtasks create $TaskWeekly failed" }
    Log "Scheduled: $TaskDaily daily $Daily (db-only) + $TaskWeekly weekly $wDay $wTime (full); retention $RetentionFull/$RetentionDbOnly" 'OK'
}

'status' {
    foreach ($pair in @(@('daily', $TaskDaily), @('weekly', $TaskWeekly))) {
        $label = $pair[0]; $tn = $pair[1]
        $t = Get-ScheduledTask -TaskName $tn -ErrorAction SilentlyContinue
        if (-not $t) { Write-Output ($label + '.exists=0'); continue }
        Write-Output ($label + '.exists=1')
        Write-Output ($label + '.enabled=' + $(if ($t.State -ne 'Disabled') {'1'} else {'0'}))
        $i = Get-ScheduledTaskInfo -TaskName $tn -ErrorAction SilentlyContinue
        if ($i) {
            if ($i.LastRunTime -and $i.LastRunTime.Year -gt 2000) { Write-Output ($label + '.lastRun=' + $i.LastRunTime.ToString('yyyy-MM-dd HH:mm')) }
            Write-Output ($label + '.lastResult=' + $i.LastTaskResult)
        }
        $tr = ($t.Actions | Select-Object -First 1).Arguments
        if ($tr -match '-RetentionFull (\d+)')   { Write-Output ($label + '.retentionFull=' + $Matches[1]) }
        if ($tr -match '-RetentionDbOnly (\d+)') { Write-Output ($label + '.retentionDbOnly=' + $Matches[1]) }
        $trg = $t.Triggers | Select-Object -First 1
        if ($trg -and $trg.StartBoundary) { Write-Output ($label + '.startTime=' + ([datetime]$trg.StartBoundary).ToString('HH:mm')) }
        if ($trg -and $trg.DaysOfWeek)    { Write-Output ($label + '.days=' + $trg.DaysOfWeek) }
    }
}

'dailyjob' {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $MyInvocation.MyCommand.Path -Backup -DbOnly -Tag scheduled @(if ($Config) { @('-Config', $Config) })
    & powershell -NoProfile -ExecutionPolicy Bypass -File $MyInvocation.MyCommand.Path -Prune -RetentionFull $RetentionFull -RetentionDbOnly $RetentionDbOnly @(if ($Config) { @('-Config', $Config) })
}

'weeklyjob' {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $MyInvocation.MyCommand.Path -Backup -Tag scheduled @(if ($Config) { @('-Config', $Config) })
    & powershell -NoProfile -ExecutionPolicy Bypass -File $MyInvocation.MyCommand.Path -Prune -RetentionFull $RetentionFull -RetentionDbOnly $RetentionDbOnly @(if ($Config) { @('-Config', $Config) })
}

}
