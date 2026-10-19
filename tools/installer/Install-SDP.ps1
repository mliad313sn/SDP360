# =====================================================================
# Install-SDP.ps1 - SDP Dashboard installer engine (steps 1-7).
# Invoked by Setup.bat (bundle menu) or directly:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File Install-SDP.ps1 `
#       [-Fresh | -Upgrade | -Patch | -Reinstall]   (default: -Upgrade)
#       [-ConfigureEnvOnly]                         (questionnaire only)
#       [-Config <psd1>]     merge overrides (config.test.psd1 = :3457 test instance)
#       [-BundleRoot <dir>]  bundle root holding payload\ (default: script dir)
#       [-StopAfterStep <n>] stop after step n (1,2,3,4,4b,5,6,7,8) - staged runs / tests
#       [-SeedData]          Fresh only: load payload\demo\*.zip after the install
#       [-NoBrowser]         do not open the dashboard when a fresh install ends
#       [-NoRollback]        keep the broken state for on-site debugging
#       [-Force]             override downgrade refusal / fresh-into-nonempty
#       [-ForceOverwrite]    menu-guarded Fresh over an existing install: lifts ONLY
#                            the non-empty-dir refusal (downgrade still refused)
#       [-ConfirmDataLoss]   Reinstall only: DROP + recreate the database
#       [-PrintPlan]         print PLAN=<steps> and exit 0 - dry run, no admin needed
#
# Steps (spec docs/superpowers/specs/2026-07-13-sdp-installer-design.md):
#   1  preflight (admin, disk, port, install dir rules, downgrade check)
#   2  runtime deps: Node.js >= NodeMinMajor, Python 3 + offline wheels
#   3  pm2 (offline global tree from payload) + Windows service
#   4  PostgreSQL install/reuse + provision role/db (tools\pg\provision-prod.js)
#   4b .env questionnaire (also -ConfigureEnvOnly / menu option E)
#   5  automatic pre-change backup via Manage-SDP.ps1 -Backup
#   6  deploy code + node_modules; exclusions HARD-CODED: data\ blobs\ SDP-Backups\ .env
#   7  orphan-safe restart + verify (pm2 online + HTTP probe); FAILURE -> automatic
#      rollback to the step-5 restore point, exit code 2 'ROLLED BACK'
#   8  OPTIONAL seed data (-SeedData, fresh only): copy payload\demo\*.zip into
#      the backup dir and restore it, so a demo machine needs zero manual file
#      handling. NON-FATAL by design - the app is already installed and working,
#      so a seed failure WARNs, never rolls back, and the run exits 3.
#
# Exit codes: 0 = OK, 1 = failed, 2 = failed AND rolled back,
#             3 = installed and verified, but the demo dataset was NOT loaded
#                 (-SeedData only; the summary says whether the database was
#                 left untouched or is in an uncertain state).
#
# NEVER: pm2 reload (EADDRINUSE crash-loop), npm install / pip download from
# the network (everything comes from payload\), overwrite .env.
#
# TEST-ONLY FALLBACK (documented, not for prod): when pm2 is absent on the
# machine AND the payload carries no pm2-global tree, step 3 degrades to
# WARN+skip ('NoService mode') and step 7 starts the app as a plain background
# 'node server.js' process for the HTTP probe, then stops it. The started PID
# is recorded in <InstallDir>\.sdp-node.pid so restarts stay orphan-safe.
#
# Env overrides for blank-path smoke tests:
#   NPM_GLOBAL_DIR  - treat global pm2 as absent; install the payload pm2 tree here
#   SDP_PYTHON_DIR  - treat system python as absent; install python-embed here
#
# KEEP THIS FILE PURE ASCII (Windows PowerShell 5.1 ANSI parse pitfall).
# =====================================================================
param(
    [switch]$Fresh,
    [switch]$Upgrade,
    [switch]$Patch,
    [switch]$Reinstall,
    [switch]$ConfigureEnvOnly,
    [switch]$NoRollback,
    [switch]$Force,
    [switch]$ForceOverwrite,   # menu-guarded Fresh over an existing install: lifts ONLY the non-empty-dir refusal (downgrade still refused)
    [switch]$ConfirmDataLoss,
    [string]$Config,
    [string]$BundleRoot,
    [string]$StopAfterStep,
    [switch]$SeedData,
    [switch]$NoBrowser,
    [switch]$PrintPlan        # print PLAN=<steps> and exit 0 - dry run for the harness, no admin needed
)
$ErrorActionPreference = 'Stop'

# --- config -----------------------------------------------------------
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg = Import-PowerShellDataFile (Join-Path $here 'config.psd1')
if ($Config) {
    $ovPath = if (Test-Path $Config) { $Config } else { Join-Path $here $Config }
    $ov = Import-PowerShellDataFile $ovPath
    foreach ($k in $ov.Keys) { $cfg[$k] = $ov[$k] }
}
$InstallDir = $cfg.InstallDir
$BackupDir  = [System.IO.Path]::GetFullPath((Join-Path $InstallDir $cfg.BackupDir))
$SvcName    = $cfg.ServiceName
$AppPort    = [int]$cfg.AppPort
if (-not $BundleRoot) { $BundleRoot = $here }
$PayloadDir = Join-Path $BundleRoot 'payload'
$PayloadInst = Join-Path $PayloadDir 'installers'

# --- mode -------------------------------------------------------------
$picked = @()
if ($Fresh)     { $picked += 'fresh' }
if ($Upgrade)   { $picked += 'upgrade' }
if ($Patch)     { $picked += 'patch' }
if ($Reinstall) { $picked += 'reinstall' }
if ($ConfigureEnvOnly) { $picked += 'env-only' }
if ($picked.Count -gt 1) { Write-Host "Pick ONE mode (got: $($picked -join ', '))" -ForegroundColor Red; exit 1 }
$Mode = if ($picked.Count -eq 1) { $picked[0] } else { 'upgrade' }

# --- plan ---------------------------------------------------------------
# Computed here, BEFORE the logging section and any admin/preflight checks,
# so -PrintPlan is a genuine dry run: no C:\ProgramData\SDP-Dashboard\logs
# folder or install-*.log file is ever created and no elevation is needed.
# Step 5 (full restore point) ALWAYS precedes step 4 wherever step 4 can
# DROP the database (reinstall -ConfirmDataLoss) or where the install
# overwrites an existing one (fresh -ForceOverwrite/-Force with server.js
# present) - 2026-09-15. On both of those paths this also means step 7's
# automatic rollback is now armed (a restore point exists), where before
# fresh-over-existing had none.
$hasAppAtStart = Test-Path -LiteralPath (Join-Path $InstallDir 'server.js')
$plan = @()
switch ($Mode) {
    'fresh'     {
        if ($hasAppAtStart -and ($Force -or $ForceOverwrite)) { $plan = @('1','2','3','5','4','4b','6','7') }
        else { $plan = @('1','2','3','4','4b','6','7') }
        if ($SeedData) { $plan += '8' }
    }
    'upgrade'   { $plan = @('1','2','3','4','5','6','7') }   # 4 = verify only; new .env keys appended in 6
    'patch'     { $plan = @('1','2','3','5','6','7') }
    'reinstall' { $plan = @('1','2','3','5','4','4b','6','7') }
    'env-only'  { $plan = @('4b') }
}
if ($PrintPlan) { Write-Output ('PLAN=' + ($plan -join ',')); exit 0 }

# Dot-sourced AFTER the -PrintPlan exit above, so a dry run stays side-effect
# free even if this file is ever missing or gains one. Defines functions only
# (Get-SdpEnvValue, Get-SdpDbCounts, Test-SdpZipHasDump, ...) plus two
# $script: arrays ($SdpCountTables, $SdpPgRoots) - shared with Detect-SDP.ps1
# so there is exactly ONE counts query and ONE zip-has-dump check.
. (Join-Path $here 'SdpSituation.ps1')
$script:CountsBefore = $null
$script:DataCheck = 'skipped'

# --- logging ----------------------------------------------------------
$LogDir = 'C:\ProgramData\SDP-Dashboard\logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$LogFile = Join-Path $LogDir ("install-$stamp.log")
$SummaryFile = Join-Path $LogDir ("install-summary-$stamp.txt")
$InstallsLog = Join-Path $LogDir 'installs.log'
function Log($m, $lvl = 'INFO') {
    $c = switch ($lvl) { 'OK' {'Green'} 'WARN' {'Yellow'} 'ERROR' {'Red'} 'ALERT' {'Red'} 'STEP' {'Cyan'} default {'Gray'} }
    $line = (Get-Date -Format 'HH:mm:ss') + " [$lvl] $m"
    Write-Host $line -ForegroundColor $c
    Add-Content -Path $LogFile -Value $line
}
function Die($m) { Log $m 'ERROR'; throw $m }

$script:BoundParams = $PSBoundParameters   # captured here: inside functions $PSBoundParameters is the FUNCTION's
$script:ExitCode    = 1          # main catch exits with this (2 = rolled back)
$script:StepResults = New-Object System.Collections.ArrayList
$script:WarnKeys    = @()        # questionnaire keys left as placeholders
$script:BundleVer   = '?'
$script:BundleSha   = '?'
$script:RollbackZip = $null
$script:Pm2         = $null      # resolved in step 3; $null = NoService test mode
$script:NodeProc    = $null      # NoService mode: the plain background node process
# Task 7 summary facts. These assignments only document the INITIAL values
# (what the summary reports when nothing has happened yet); the real values are
# set later - the two *AtStart facts right after Write-EnvHeader in main, the
# four Db* facts inside Step4-Postgres as each action actually happens.
$script:InstalledVerAtStart = $null
$script:EnvExistedAtStart   = $false
$script:Step4Reached        = $false   # Step4-Postgres started
$script:DbDropped           = $false   # DROP DATABASE actually succeeded
$script:DbCreated           = $false   # the database did not exist and was created by this run
$script:DbExistedBefore     = $null    # probe result before provisioning ($null = probe never ran)
$script:DbSeeded            = $false   # step 8's restore succeeded: the database now holds the demo dataset
$script:SeedFailed          = $false   # step 8's restore failed AFTER it may have changed things (database state not known)
$script:SeedRefused         = $false   # step 8's restore was REFUSED in its pre-flight (Manage-SDP exit 3): database untouched
$script:SeedWarning         = $null    # why the demo dataset was NOT loaded (any step-8 non-success) -> exit 3
$script:SeedZipName         = $null    # leaf name of that demo archive

function Invoke-Step([string]$N, [string]$Name, [scriptblock]$Body) {
    Log ("---- Step $N : $Name ----") 'STEP'
    try {
        & $Body
        [void]$script:StepResults.Add("OK      step $N  $Name")
        Log ("Step $N done") 'OK'
    } catch {
        [void]$script:StepResults.Add("FAILED  step $N  $Name : " + $_.Exception.Message)
        throw
    }
}
# Spec 4.4: the console box AND summary.txt carry the SAME eight lines in the
# SAME order on every run. They are built ONCE here and both writers consume
# this list, so the two can never drift. Must never throw (it also runs on
# the FAILED path, from Complete-Run in the main catch).
# The Database line describes what HAPPENED (the Db* facts set by Step4-Postgres),
# never what the plan intended - a run that died before the DROP must not claim
# the database was dropped. ONE place decides it; Get-DataCheck reads the same fact.
function Get-DatabaseOutcome {
    # A refused seed changed nothing: report what steps 1-7 did, and say the
    # demo dataset is not in it.
    if ($script:SeedRefused) {
        return ((Get-BaseDatabaseOutcome) + ' - NOT replaced: demo dataset refused before any change (' + $script:SeedZipName + '), see the log')
    }
    return (Get-BaseDatabaseOutcome)
}
function Get-BaseDatabaseOutcome {
    if ($script:DbDropped) {
        if ($script:DbCreated) { return 'DROPPED and recreated' }
        return 'DROPPED - NOT recreated (restore from the restore point)'
    }
    # Step 8 replaced whatever step 4 created or kept - say so, never 'preserved'.
    if ($script:DbSeeded) { return ('replaced by demo dataset (' + $script:SeedZipName + ')') }
    if ($script:SeedFailed) { return ('uncertain - demo dataset restore failed (' + $script:SeedZipName + '), see the log') }
    if ($Mode -eq 'reinstall' -and $ConfirmDataLoss) { return 'preserved (drop not performed)' }
    if ($script:DbCreated) { return 'created' }
    if ($Mode -eq 'fresh' -and -not $script:Step4Reached) { return 'not created (run stopped before step 4)' }
    if ($Mode -eq 'fresh' -and $script:DbExistedBefore -eq $false) { return 'not created (step 4 failed)' }
    return 'preserved'
}
function Get-SummaryLines {
  try {
    $isEnvOnly = ($Mode -eq 'env-only')
    $modeVal = ([string]$Mode).ToUpper()
    if ($Mode -eq 'patch' -or $Mode -eq 'upgrade') { $modeVal += ' (code updated; database + data preserved)' }
    $verVal = $(if ($script:InstalledVerAtStart) { $script:InstalledVerAtStart } else { 'none' }) + ' -> ' + $script:BundleVer
    # env-only never touches the database, never takes a restore point and
    # never runs the data check - dedicated values say so plainly instead of
    # reusing the fresh-install wording, which would mislead on a run that
    # only wrote .env.
    if ($isEnvOnly) {
        $rpVal = 'not applicable (configure .env only)'
        $dbVal = 'untouched (configure .env only)'
        $dcVal = 'not applicable'
    } else {
        $rpVal = $(if ($script:RollbackZip) { $script:RollbackZip } else { 'none (fresh install)' })
        $dbVal = Get-DatabaseOutcome
        $dcVal = [string]$script:DataCheck
    }
    $envVal = $(if ($script:EnvExistedAtStart) { 'preserved (merged)' } else { 'created' })
    return @(
        [pscustomobject]@{ Label = 'Mode';          Value = $modeVal }
        [pscustomobject]@{ Label = 'Version';       Value = $verVal }
        [pscustomobject]@{ Label = 'Restore point'; Value = $rpVal }
        [pscustomobject]@{ Label = 'Database';      Value = $dbVal }
        [pscustomobject]@{ Label = '.env';          Value = $envVal }
        [pscustomobject]@{ Label = 'Data check';    Value = $dcVal }
        [pscustomobject]@{ Label = 'Log';           Value = [string]$LogFile }
        [pscustomobject]@{ Label = 'Summary';       Value = [string]$SummaryFile }
    )
  } catch {
    # Never mask the original error on the failure path with a summary error.
    return @([pscustomobject]@{ Label = 'Summary'; Value = ('unavailable: ' + $_.Exception.Message) })
  }
}
# The green console box - same lines as summary.txt (Get-SummaryLines).
function Write-SummaryBox([string]$title) {
    Log '==================================================' 'OK'
    Log (' ' + $title) 'OK'
    foreach ($s in (Get-SummaryLines)) {
        $lvl = 'OK'
        if ($s.Label -eq 'Data check' -and $s.Value -like 'WARNING*') { $lvl = 'ALERT' }
        Log ('   ' + $s.Label.PadRight(14) + ': ' + $s.Value) $lvl
    }
    Log '==================================================' 'OK'
}
function Write-RunSummary([string]$result) {
    $lines = @()
    $lines += "SDP Dashboard install run $stamp"
    $lines += "Result: $result"
    foreach ($s in (Get-SummaryLines)) { $lines += ($s.Label + ': ' + $s.Value) }
    $lines += "Config: $Config"
    $lines += "Bundle: $BundleRoot (version $($script:BundleVer))"
    $lines += ''
    $lines += $script:StepResults
    if ($script:WarnKeys.Count -gt 0) {
        $lines += ''
        $lines += ('WARNING - .env keys left unconfigured: ' + ($script:WarnKeys -join ', '))
        $lines += 'The service may not fully work until they are filled. Rerun Setup -> option E.'
    }
    $lines += ''
    $resume = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + $MyInvocation.ScriptName + '"'
    foreach ($kv in $script:BoundParams.GetEnumerator()) {
        if ($kv.Value -is [switch] -or $kv.Value -is [bool]) { if ($kv.Value) { $resume += ' -' + $kv.Key } }
        else { $resume += ' -' + $kv.Key + ' "' + $kv.Value + '"' }
    }
    $lines += "Resume command: $resume"
    Set-Content -Path $SummaryFile -Value $lines -Encoding ascii
}
function Complete-Run([string]$result) {
    # installs.log: one line per run, on EVERY exit path.
    $who = "$env:USERDOMAIN\$env:USERNAME"
    Add-Content -Path $InstallsLog -Value ("$stamp | $who | $Mode | $($script:BundleVer) | $result")
    Write-RunSummary $result
}

# Environment header at the top of every log (mirrors the 4MyPeople installer).
# Secrets are reported as (set)/(not set) ONLY. Every probe below is wrapped in
# its OWN try/catch -> 'unknown' - a WMI/CIM hiccup, a missing DriveInfo root,
# node/psql not on PATH, or a netstat parse failure must never abort the run
# just for a log-header cosmetic (this function runs before step 1).
function Write-EnvHeader {
    $os = 'unknown'
    try {
        $osInfo = Get-CimInstance Win32_OperatingSystem   # ONE call, two fields
        $os = $osInfo.Caption + ' build ' + $osInfo.BuildNumber
    } catch { $os = 'unknown' }
    $free = 'unknown'
    try { $free = [math]::Round((New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($InstallDir)))).AvailableFreeSpace / 1GB, 1) } catch { $free = 'unknown' }
    $nodeV = 'unknown'
    try { $nodeV = (& node -v 2>$null); if ([string]::IsNullOrWhiteSpace($nodeV)) { $nodeV = 'not on PATH' } } catch { $nodeV = 'unknown' }
    $psqlV = 'unknown'
    try { $psqlV = if (Find-PgBin 'psql.exe') { 'found' } else { 'not found' } } catch { $psqlV = 'unknown' }
    $ports = @('unknown')
    try {
        $arr = @()
        foreach ($p in @($AppPort, [int]$cfg.PgPort)) { $arr += ('' + $p + '=' + $(if ((Get-PortListenerPids $p).Count -gt 0) { 'IN USE' } else { 'free' })) }
        $ports = $arr
    } catch { $ports = @('unknown') }
    $lines = @(
        '----- ENVIRONMENT -----',
        ('Timestamp        : ' + (Get-Date -Format 'o')),
        ('Run as user      : ' + $env:USERDOMAIN + '\' + $env:USERNAME),
        ('Computer         : ' + $env:COMPUTERNAME),
        ('OS               : ' + $os),
        ('PowerShell       : ' + $PSVersionTable.PSVersion + ' (' + $PSVersionTable.PSEdition + ')'),
        ('Free space       : ' + $free + ' GB on the install drive'),
        ('Mode / Config    : ' + $Mode + ' / ' + $(if ($Config) { $Config } else { 'config.psd1' })),
        ('Config (resolved): InstallDir=' + $InstallDir + '; AppPort=' + $AppPort + '; Service=' + $SvcName + '; PgHost=' + $cfg.PgHost + '; PgPort=' + $cfg.PgPort + '; DbName=' + $cfg.DbName),
        ('PG super password: ' + $(if ($cfg.StandardPgSuperPassword -or ($cfg.EnvAnswers -and $cfg.EnvAnswers.PG_SUPER_PASSWORD)) { '(set)' } else { '(not set)' })),
        ('node             : ' + $nodeV),
        ('psql             : ' + $psqlV),
        ('Ports            : ' + ($ports -join '  ')),
        '-----------------------')
    foreach ($l in $lines) { Add-Content -Path $LogFile -Value $l }
    Write-Host ($lines -join "`n") -ForegroundColor DarkGray
}

# --- generic helpers --------------------------------------------------
function Invoke-Robocopy($src, $dst, [string[]]$extra) {
    & robocopy $src $dst /E /NFL /NDL /NJH /NJS @extra | Out-Null
    if ($LASTEXITCODE -ge 8) { Die "robocopy failed ($LASTEXITCODE) $src -> $dst" }
}
function Get-JsonVersion($path) {
    if (Test-Path $path) { try { return (Get-Content $path -Raw | ConvertFrom-Json).version } catch { return $null } }
    return $null
}
function Get-PortListenerPids([int]$port) {
    $pids = @()
    foreach ($line in (netstat -ano)) {
        if ($line -match '^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$') {
            if ([int]$Matches[1] -eq $port -and [int]$Matches[2] -ne 0) { $pids += [int]$Matches[2] }
        }
    }
    return ($pids | Select-Object -Unique)
}
function Read-Secret($prompt) {
    # -AsSecureString reads the CONSOLE device directly and HANGS when stdin is
    # redirected (piped answers), so detect redirection and read plain lines then.
    $redirected = $false
    try { $redirected = [Console]::IsInputRedirected } catch { }
    if ($redirected) { return Read-Host -Prompt ($prompt + ' [input not masked - piped]') }
    try {
        $s = Read-Host -Prompt $prompt -AsSecureString
        $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
        try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
    } catch {
        return Read-Host -Prompt ($prompt + ' [input not masked]')
    }
}
function Get-EnvValue($key) {
    # One implementation only - SdpSituation.ps1's Get-SdpEnvValue (dot-sourced
    # below, after the -PrintPlan exit). Name kept so every existing caller here
    # is unchanged.
    return (Get-SdpEnvValue $InstallDir $key)
}
function New-RandomPassword([int]$len = 24) {
    $chars = ([char[]](48..57)) + ([char[]](65..90)) + ([char[]](97..122))
    return -join (1..$len | ForEach-Object { $chars | Get-Random })
}
function Resolve-Pm2 {
    # NPM_GLOBAL_DIR (test/blank-path override) forces the local dir and ONLY it.
    $npmDir = if ($env:NPM_GLOBAL_DIR) { $env:NPM_GLOBAL_DIR } else { Join-Path $env:APPDATA 'npm' }
    $local = Join-Path $npmDir 'pm2.cmd'
    if (Test-Path $local) { return $local }
    if (-not $env:NPM_GLOBAL_DIR) {
        $c = Get-Command pm2 -ErrorAction SilentlyContinue
        if ($c) { return $c.Source }
    }
    return $null
}
function Find-PgBin($exe) {
    # One implementation only - SdpSituation.ps1's Find-SdpPgBin (dot-sourced
    # above, after the -PrintPlan exit): never throws, TryParse-sorted, and
    # its roots ($script:SdpPgRoots) are the ones Detect-SDP.ps1 also uses.
    return (Find-SdpPgBin $exe)
}

# =====================================================================
# .env questionnaire (step 4b + -ConfigureEnvOnly)
# Parses env.template '## KEY | directive | ...' blocks. Precedence per key:
#   EnvAnswers[key] (silent) > existing real value (Enter keeps) >
#   computed slot > prompt (with where= hint) > default > __ASK__ placeholder.
# The existing .env is MERGED in place: unknown keys, comments and layout are
# preserved; template keys get their line replaced; missing keys appended.
# cfg.EnvSilent = $true suppresses ALL prompts (scripted DR / tests).
# =====================================================================
function Get-EnvTemplate {
    $tpl = Join-Path $here 'env.template'
    if (-not (Test-Path $tpl)) { Die "env.template not found next to the script: $tpl" }
    $items = @()
    $lines = Get-Content $tpl
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $l = $lines[$i]
        if ($l -notmatch '^##\s+(\S+)\s*(\|.*)?$') { continue }
        $spec = @{ Key = $Matches[1]; Default = $null; Ask = $null; Optional = $false; Validate = $null; Computed = $null; Where = '' }
        if ($Matches[2]) {
            foreach ($part in ($Matches[2].TrimStart('|').Split('|'))) {
                $p = $part.Trim()
                if ($p -match '^default=(.*)$')  { $spec.Default  = $Matches[1].Trim() }
                elseif ($p -match '^ask=(.*)$')      { $spec.Ask      = $Matches[1].Trim() }
                elseif ($p -match '^optional=1')     { $spec.Optional = $true }
                elseif ($p -match '^validate=(.*)$') { $spec.Validate = $Matches[1].Trim() }
                elseif ($p -match '^computed=(.*)$') { $spec.Computed = $Matches[1].Trim() }
                elseif ($p -match '^where=(.*)$')    { $spec.Where    = $Matches[1].Trim() }
            }
        }
        # template value line follows the directive (KEY=value)
        if ($i + 1 -lt $lines.Count -and $lines[$i + 1] -match ('^' + [regex]::Escape($spec.Key) + '=(.*)$')) {
            if ($null -eq $spec.Default -and $Matches[1] -notin @('__ASK__', '__COMPUTED__')) { $spec.Default = $Matches[1] }
        }
        $items += New-Object psobject -Property $spec
    }
    return $items
}
function Test-EnvValid($spec, $value) {
    if (-not $spec.Validate) { return $true }
    if ($spec.Validate -match '^minlen:(\d+)$') { return ($value.Length -ge [int]$Matches[1]) }
    return $true
}
function Invoke-EnvQuestionnaire {
    $envFile = Join-Path $InstallDir '.env'
    $silent  = ($cfg.ContainsKey('EnvSilent') -and $cfg.EnvSilent)
    $answers = if ($cfg.ContainsKey('EnvAnswers') -and $cfg.EnvAnswers) { $cfg.EnvAnswers } else { @{} }
    $existingLines = @()
    $existing = @{}
    if (Test-Path $envFile) {
        $existingLines = @(Get-Content $envFile)
        foreach ($l in $existingLines) {
            if ($l -match '^\s*([A-Za-z0-9_]+)\s*=(.*)$' -and -not $l.Trim().StartsWith('#')) {
                $existing[$Matches[1]] = $Matches[2].Trim()
            }
        }
        Log ".env exists ($($existing.Count) keys) - merging, nothing is deleted"
    } else {
        Log 'No .env yet - creating from the questionnaire'
    }
    $resolved = @{}
    foreach ($spec in (Get-EnvTemplate)) {
        $key = $spec.Key
        $cur = $null
        if ($existing.ContainsKey($key)) { $cur = $existing[$key] }
        $isReal = ($null -ne $cur -and $cur -ne '' -and $cur -ne '__ASK__' -and $cur -ne '__COMPUTED__')
        $val = $null

        if ($answers.ContainsKey($key)) {
            $val = [string]$answers[$key]
            if (-not (Test-EnvValid $spec $val)) { Die "EnvAnswers.$key fails validation ($($spec.Validate))" }
            Log "  $key <- silent answer from config"
        }
        elseif ($isReal) {
            if ($silent) { $val = $cur }
            else {
                $shown = if ($spec.Ask -eq 'secret') { '(hidden)' } else { $cur }
                $inp = Read-Host ("  $key [already configured = $shown - Enter to keep]")
                if ([string]::IsNullOrWhiteSpace($inp)) { $val = $cur }
                else {
                    while (-not (Test-EnvValid $spec $inp)) { $inp = Read-Host ("  $key invalid ($($spec.Validate)) - retry") }
                    $val = $inp
                }
            }
        }
        elseif ($spec.Computed) {
            if ($script:ComputedEnv -and $script:ComputedEnv.ContainsKey($spec.Computed)) {
                $val = $script:ComputedEnv[$spec.Computed]
                Log "  $key <- computed ($($spec.Computed))"
            }
            elseif ($silent) {
                $val = if ($null -ne $cur) { $cur } else { '__COMPUTED__' }
                if ($val -eq '__COMPUTED__') { $script:WarnKeys += $key }
            }
            else {
                if ($spec.Where) { Write-Host ("     where: " + $spec.Where) -ForegroundColor DarkGray }
                $inp = Read-Host ("  $key [Enter = leave for the installer to compute]")
                if ([string]::IsNullOrWhiteSpace($inp)) { $val = '__COMPUTED__'; $script:WarnKeys += $key }
                else { $val = $inp }
            }
        }
        elseif ($spec.Ask) {
            if ($silent) {
                if ($spec.Optional) { $val = '__ASK__'; $script:WarnKeys += $key }
                else { Die "EnvSilent mode: required key $key has no EnvAnswers entry" }
            } else {
                if ($spec.Where) { Write-Host ("     where: " + $spec.Where) -ForegroundColor DarkGray }
                $hint = if ($spec.Optional) { ' [Enter = skip, fill later via Setup option E]' } else { '' }
                while ($true) {
                    $inp = if ($spec.Ask -eq 'secret') { Read-Secret ("  $key$hint") } else { Read-Host ("  $key$hint") }
                    if ([string]::IsNullOrWhiteSpace($inp)) {
                        if ($spec.Optional) { $val = '__ASK__'; $script:WarnKeys += $key; break }
                        Write-Host '     required - please enter a value' -ForegroundColor Yellow; continue
                    }
                    if (-not (Test-EnvValid $spec $inp)) {
                        Write-Host ("     invalid (" + $spec.Validate + ")") -ForegroundColor Yellow; continue
                    }
                    $val = $inp; break
                }
            }
        }
        else {
            $def = if ($null -ne $spec.Default) { $spec.Default } else { '' }
            if ($silent) { $val = $def }
            else {
                $inp = Read-Host ("  $key [Enter = $def]")
                $val = if ([string]::IsNullOrWhiteSpace($inp)) { $def } else { $inp }
            }
        }
        $resolved[$key] = $val
    }

    # merge in place: replace known key lines, keep everything else verbatim
    $outLines = New-Object System.Collections.ArrayList
    $written = @{}
    foreach ($l in $existingLines) {
        if ($l -match '^\s*([A-Za-z0-9_]+)\s*=' -and -not $l.Trim().StartsWith('#') -and $resolved.ContainsKey($Matches[1])) {
            $k = $Matches[1]
            [void]$outLines.Add("$k=$($resolved[$k])")
            $written[$k] = $true
        } else { [void]$outLines.Add($l) }
    }
    if ($existingLines.Count -eq 0) {
        [void]$outLines.Add('# SDP Dashboard .env - created by Install-SDP.ps1 ' + $stamp)
    }
    foreach ($spec in (Get-EnvTemplate)) {
        if (-not $written.ContainsKey($spec.Key)) { [void]$outLines.Add("$($spec.Key)=$($resolved[$spec.Key])") }
    }
    if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
    $tmp = $envFile + '.tmp'
    Set-Content -Path $tmp -Value $outLines -Encoding ascii
    Move-Item -Path $tmp -Destination $envFile -Force
    Log ".env written ($($resolved.Count) template keys merged, unknown keys preserved)" 'OK'
    if ($script:WarnKeys.Count -gt 0) {
        Log ("Unconfigured keys (placeholders): " + (($script:WarnKeys | Select-Object -Unique) -join ', ') + " - rerun Setup option E to fill them") 'WARN'
    }
}
# Upgrade mode: NEVER touch existing values - just append template keys that
# are missing from .env, commented, so the operator sees what is new.
function Add-NewEnvKeys([string]$newVer) {
    $envFile = Join-Path $InstallDir '.env'
    if (-not (Test-Path $envFile)) { Log '.env missing on upgrade - run Setup option E' 'WARN'; return }
    $existing = @{}
    foreach ($l in (Get-Content $envFile)) {
        if ($l -match '^\s*#?\s*([A-Za-z0-9_]+)\s*=') { $existing[$Matches[1]] = $true }
    }
    $added = @()
    foreach ($spec in (Get-EnvTemplate)) {
        if (-not $existing.ContainsKey($spec.Key)) {
            $def = if ($null -ne $spec.Default) { $spec.Default } else { '__ASK__' }
            $added += ('# NEW in ' + $newVer + ': ' + $spec.Key + '=' + $def)
        }
    }
    if ($added.Count -gt 0) {
        Add-Content -Path $envFile -Value $added
        Log ("Appended " + $added.Count + " new commented key(s) to .env: " + (($added -join '; '))) 'WARN'
    } else { Log 'No new .env keys in this version' }
}

# =====================================================================
# Step 1 - preflight
# =====================================================================
function Step1-Preflight {
    # admin
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $isAdmin = (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        if ($cfg.ContainsKey('AllowNonAdmin') -and $cfg.AllowNonAdmin) { Log 'Not elevated - AllowNonAdmin set, continuing (test config)' 'WARN' }
        else { Die 'Administrator rights required. Re-run from an elevated prompt (Setup.bat self-elevates).' }
    } else { Log 'Administrator: yes' }

    # disk >= 2 GB free on the InstallDir drive
    $drive = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($InstallDir))
    $free = (New-Object System.IO.DriveInfo($drive)).AvailableFreeSpace
    if ($free -lt 2GB) { Die ("Less than 2 GB free on " + $drive + " (" + [math]::Round($free/1GB,1) + " GB)") }
    Log ("Disk " + $drive + " free: " + [math]::Round($free/1GB,1) + " GB")

    # port free OR owned by our own app
    $pids = Get-PortListenerPids $AppPort
    if ($pids.Count -gt 0) {
        $ours = $false
        $pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
        if ($pm2) {
            try {
                $jl = (cmd /c 'pm2 jlist 2>nul' | Out-String | ConvertFrom-Json)
                foreach ($p in $jl) { if ($p.name -eq $SvcName -and $pids -contains [int]$p.pid) { $ours = $true } }
            } catch { }
        }
        $pidFile = Join-Path $InstallDir '.sdp-node.pid'
        if (-not $ours -and (Test-Path $pidFile)) {
            $rec = (Get-Content $pidFile | Select-Object -First 1)
            if ($pids -contains [int]$rec) { $ours = $true }
        }
        if ($ours) { Log ("Port $AppPort is held by our own app (pid " + ($pids -join ',') + ") - it will be restarted in step 7") }
        else { Die ("Port $AppPort is in use by a foreign process (pid " + ($pids -join ',') + "). Free it first.") }
    } else { Log "Port $AppPort is free" }

    # install dir rules per mode
    $hasApp = Test-Path -LiteralPath (Join-Path $InstallDir 'server.js')
    if ($Mode -eq 'fresh') {
        if ($hasApp -and -not $Force -and -not $ForceOverwrite) { Die "Fresh mode but $InstallDir already contains server.js. Use -Upgrade / -Reinstall, or the menu's guarded Fresh (-ForceOverwrite)." }
        if ($hasApp) { Log 'Fresh over an EXISTING installation: a full restore point is taken (step 5) before the database step' 'WARN' }
        if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null; Log "Created $InstallDir" }
    } else {
        if (-not $hasApp) { Die "$Mode mode requires an existing install (no server.js in $InstallDir). Use -Fresh." }
    }

    # bundle payload + downgrade check
    if (-not (Test-Path (Join-Path $PayloadDir 'app.zip'))) { Die "Bundle payload missing: $PayloadDir\app.zip (pass -BundleRoot)" }
    $bv = $null
    $bvPath = Join-Path $BundleRoot 'version.json'
    if (Test-Path $bvPath) {
        try {
            $bvObj = Get-Content $bvPath -Raw | ConvertFrom-Json
            $bv = $bvObj.version
            if ($bvObj.sha) { $script:BundleSha = "$($bvObj.sha)" }
        } catch { }
    }
    if ($bv) { $script:BundleVer = $bv }
    $iv = Get-JsonVersion (Join-Path $InstallDir 'version.json')
    if ($bv -and $iv) {
        Log "Installed version: $iv -> bundle version: $bv"
        $pv = $null; $pi = $null
        if ([version]::TryParse(($bv -replace '^v',''), [ref]$pv) -and [version]::TryParse(($iv -replace '^v',''), [ref]$pi)) {
            if ($pv -lt $pi -and -not $Force) { Die "Downgrade refused: bundle $bv is older than installed $iv. Use -Force to override." }
        } else { Log 'Version strings are not numeric - downgrade check skipped' 'WARN' }
    }
    if ($Mode -eq 'reinstall' -and $ConfirmDataLoss) {
        Log '*** -ConfirmDataLoss: the database WILL BE DROPPED and recreated in step 4 ***' 'WARN'
    }
}

# =====================================================================
# Step 2 - runtime deps (Node.js, Python + wheels) - all offline from payload
# =====================================================================
function Step2-RuntimeDeps {
    # ---- Node.js ----
    $script:NodeExe = $null
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    $major = 0
    if ($nodeCmd) {
        $v = (& node -v) -replace '^v',''
        $major = [int]($v.Split('.')[0])
        if ($major -ge [int]$cfg.NodeMinMajor) { $script:NodeExe = $nodeCmd.Source; Log "Node.js v$v OK (>= $($cfg.NodeMinMajor))" }
        else { Log "Node.js v$v too old (< $($cfg.NodeMinMajor)) - installing from payload" 'WARN' }
    } else { Log 'Node.js not found - installing from payload' 'WARN' }
    if (-not $script:NodeExe) {
        $msi = Get-ChildItem $PayloadInst -Filter 'node-*.msi' -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $msi) { Die "Node.js absent/too old and no node-*.msi in $PayloadInst" }
        Log ("msiexec /i " + $msi.Name + " /qn") 'STEP'
        $p = Start-Process msiexec -ArgumentList '/i', ('"' + $msi.FullName + '"'), '/qn' -Wait -PassThru
        if ($p.ExitCode -ne 0) { Die "Node.js MSI install failed (exit $($p.ExitCode))" }
        $cand = 'C:\Program Files\nodejs\node.exe'
        if (-not (Test-Path $cand)) { Die 'Node.js MSI finished but node.exe not found' }
        $script:NodeExe = $cand
        $env:Path = 'C:\Program Files\nodejs;' + $env:Path
        Log ("Node.js installed: " + (& node -v)) 'OK'
    }

    # ---- Python 3 + wheels (exec-PPTX hard dependency) ----
    $forceLocalPy = [bool]$env:SDP_PYTHON_DIR
    $PyDir = if ($env:SDP_PYTHON_DIR) { $env:SDP_PYTHON_DIR } else { 'C:\Program Files\SDP-Python' }
    $script:PythonExe = $null
    if (-not $forceLocalPy) {
        $py = Get-Command python -ErrorAction SilentlyContinue
        if ($py) {
            try { $pv = (cmd /c 'python --version 2>&1'); if ("$pv" -match 'Python 3') { $script:PythonExe = $py.Source; Log "System $pv OK" } } catch { }
        }
    }
    if (-not $script:PythonExe -and (Test-Path (Join-Path $PyDir 'python.exe'))) {
        $script:PythonExe = Join-Path $PyDir 'python.exe'
        Log "Using existing embedded Python at $PyDir"
    }
    if (-not $script:PythonExe) {
        $zip = Get-ChildItem $PayloadInst -Filter 'python-*embed*.zip' -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $zip) { Die "Python absent and no python-*embed*.zip in $PayloadInst" }
        Log ("Extracting " + $zip.Name + " -> $PyDir") 'STEP'
        if (-not (Test-Path $PyDir)) { New-Item -ItemType Directory -Path $PyDir -Force | Out-Null }
        Expand-Archive -LiteralPath $zip.FullName -DestinationPath $PyDir -Force
        # EMBEDDABLE GOTCHA: python3xx._pth ships with 'import site' commented out.
        # Without it, pip installs succeed but 'import matplotlib' fails at runtime.
        $pth = Get-ChildItem $PyDir -Filter 'python3*._pth' | Select-Object -First 1
        if ($pth) {
            (Get-Content $pth.FullName) | ForEach-Object { $_ -replace '^\s*#\s*import\s+site\s*$', 'import site' } |
                Set-Content $pth.FullName -Encoding ascii
            Log ("Enabled 'import site' in " + $pth.Name)
        }
        $script:PythonExe = Join-Path $PyDir 'python.exe'
        $getPip = Join-Path $PayloadInst 'get-pip.py'
        if (Test-Path $getPip) {
            Log 'Bootstrapping pip (offline, get-pip.py is self-contained)' 'STEP'
            & $script:PythonExe $getPip --no-warn-script-location | Out-Null
            if ($LASTEXITCODE -ne 0) { Die 'get-pip.py failed' }
        } else { Die "get-pip.py missing from $PayloadInst (needed for the embedded Python)" }
        Log ("Embedded Python installed: " + (& $script:PythonExe --version)) 'OK'
    }
    # wheels: matplotlib / python-pptx / pillow (offline --no-index)
    cmd /c ('"' + $script:PythonExe + '" -c "import matplotlib, pptx, PIL" 2>nul') | Out-Null
    if ($LASTEXITCODE -ne 0) {
        $wheels = Join-Path $PayloadInst 'wheels'
        if (Test-Path $wheels) {
            Log 'Installing wheels offline: matplotlib python-pptx pillow' 'STEP'
            & $script:PythonExe -m pip install --no-index --find-links $wheels matplotlib python-pptx pillow --no-warn-script-location --quiet
            if ($LASTEXITCODE -ne 0) { Die 'offline pip install of the PPTX wheels failed' }
            & $script:PythonExe -c 'import matplotlib, pptx, PIL'
            if ($LASTEXITCODE -ne 0) { Die 'wheels installed but import still fails' }
            Log 'PPTX python deps OK (matplotlib, python-pptx, pillow)' 'OK'
        } else {
            Log "Python misses matplotlib/pptx/PIL and no wheels in payload - exec-PPTX export will fail until installed" 'WARN'
        }
    } else { Log 'PPTX python deps already importable' }
    # app-local shim so "python" resolves for server.js spawns when only the
    # embedded runtime exists (system python absent from PATH)
    if ($script:PythonExe -like (Join-Path $PyDir 'python.exe')) {
        if (Test-Path $InstallDir) {
            Set-Content -Path (Join-Path $InstallDir 'python.cmd') -Value ('@echo off' + "`r`n" + '"' + $script:PythonExe + '" %*') -Encoding ascii
            Log "Wrote app-local python.cmd shim -> $($script:PythonExe)"
        }
    }
}

# =====================================================================
# Step 3 - pm2 + Windows service. NO npm invocation EVER: pm2 comes as a
# pre-installed global tree in payload\installers\pm2-global\ (node_modules\pm2
# + the pm2* shims) xcopied into %APPDATA%\npm (or NPM_GLOBAL_DIR override).
# When pm2 is absent AND the payload has no tree -> 'NoService mode' (WARN):
# step 7 probes via a plain background node process (test boxes only).
# App registration with pm2 happens in STEP 7, not here - on a fresh install
# server.js only exists after step 6 deploys the code.
# =====================================================================
function Step3-Pm2Service {
    $npmDir = if ($env:NPM_GLOBAL_DIR) { $env:NPM_GLOBAL_DIR } else { Join-Path $env:APPDATA 'npm' }
    $pm2 = Resolve-Pm2
    if (-not $pm2) {
        $tree = Join-Path $PayloadInst 'pm2-global'
        if (Test-Path $tree) {
            Log "pm2 absent - installing the bundled offline global tree into $npmDir" 'STEP'
            if (-not (Test-Path (Join-Path $npmDir 'node_modules'))) { New-Item -ItemType Directory -Path (Join-Path $npmDir 'node_modules') -Force | Out-Null }
            Invoke-Robocopy (Join-Path $tree 'node_modules') (Join-Path $npmDir 'node_modules') @()
            Get-ChildItem $tree -File -Filter 'pm2*' | ForEach-Object { Copy-Item $_.FullName $npmDir -Force }
            $pm2 = Resolve-Pm2
            if (-not $pm2) { Die "pm2 tree copied but $npmDir\pm2.cmd still missing - bad payload" }
        } else {
            Log 'pm2 not installed and no pm2-global tree in the payload - NoService mode (probe via plain node in step 7)' 'WARN'
            $script:Pm2 = $null
            return
        }
    }
    $script:Pm2 = $pm2
    $v = (cmd /c ('"' + $pm2 + '" -v 2>nul') | Select-Object -Last 1)
    if (-not $v) { Die "pm2 found at $pm2 but 'pm2 -v' produced nothing" }
    Log "pm2 $v OK ($pm2)"

    # Windows service so pm2 resurrects at boot. Skipped under NPM_GLOBAL_DIR
    # (blank-path smoke override) - never register services from a test tree.
    if ($env:NPM_GLOBAL_DIR) { Log 'NPM_GLOBAL_DIR override set - skipping Windows-service registration (test mode)' 'WARN'; return }
    $svc = Get-Service pm2* -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($svc) { Log ("pm2 Windows service present: " + $svc.Name + " (" + $svc.Status + ")") }
    else {
        # pm2-windows-service is unreliable on modern Node; the recorded decision
        # (plan task 8) is the schtasks ONSTART fallback: SYSTEM runs pm2 resurrect.
        $tn = 'SDP-Pm2-Resurrect' + $(if ($SvcName -ne 'endeavour-dashboard') { '-' + $SvcName } else { '' })
        $tr = '"' + $pm2 + '" resurrect'
        & schtasks /Create /F /RU SYSTEM /SC ONSTART /TN $tn /TR $tr | Out-Null
        if ($LASTEXITCODE -ne 0) { Log 'Could not register the ONSTART pm2 resurrect task - register a pm2 service manually' 'WARN' }
        else { Log "No pm2 service found - registered scheduled task $tn (ONSTART: pm2 resurrect)" 'OK' }
    }
}

# =====================================================================
# Step 4 - PostgreSQL: install from payload OR reuse the existing cluster,
# then provision role sdp_app + the database and compute PG_URL for step 4b.
# Provisioning prefers tools\pg\provision-prod.js (blank super password ->
# standard appliance value, same convention everywhere); when node_modules\pg
# is not reachable yet (blank server, code not deployed until step 6) it falls
# back to the SAME idempotent logic via psql. SDP_FORCE_PSQL_PROVISION=1
# forces the fallback (test hook).
# =====================================================================
function Find-ProvisionScript {
    # 1) deployed app  2) dev/repo layout (this script lives in <repo>\tools\installer)
    $c = Join-Path $InstallDir 'tools\pg\provision-prod.js'
    if ((Test-Path $c) -and (Test-Path (Join-Path $InstallDir 'node_modules\pg'))) { return @{ Script = $c; Cwd = $InstallDir } }
    $repo = Split-Path (Split-Path $here -Parent) -Parent
    $c = Join-Path $repo 'tools\pg\provision-prod.js'
    if ((Test-Path $c) -and (Test-Path (Join-Path $repo 'node_modules\pg'))) { return @{ Script = $c; Cwd = $repo } }
    return $null
}
# Resolved ONCE and cached, so a password typed at the cohabitation prompt below
# is reused by every later superuser call instead of falling back to the
# appliance default and failing again.
$script:SuperPw = $null
function Get-SuperPassword {
    if ($script:SuperPw) { return $script:SuperPw }
    $script:SuperPw = if ($cfg.EnvAnswers -and $cfg.EnvAnswers.ContainsKey('PG_SUPER_PASSWORD') -and $cfg.EnvAnswers.PG_SUPER_PASSWORD) {
        [string]$cfg.EnvAnswers.PG_SUPER_PASSWORD
    } else { [string]$cfg.StandardPgSuperPassword }
    return $script:SuperPw
}
function Invoke-PsqlSuper([string]$sql) {
    $psql = Find-PgBin 'psql.exe'
    if (-not $psql) { Die 'psql.exe not found under Program Files\PostgreSQL' }
    $env:PGPASSWORD = Get-SuperPassword
    # -w: never prompt (a closed-stdin interactive password prompt hangs the installer).
    try { return (& $psql -h $cfg.PgHost -p $cfg.PgPort -U postgres -d postgres -w -v ON_ERROR_STOP=1 -t -A -c $sql) }
    finally { $env:PGPASSWORD = '' }
}
# Same as Invoke-PsqlSuper but the SQL travels on STDIN, never on the command line:
# a statement carrying a password (CREATE ROLE ... PASSWORD) must not be visible in
# process listings or a PowerShell transcript (the 4MyPeople transcript of 2026-09-15
# leaked its superuser password exactly that way).
function Invoke-PsqlSuperStdin([string]$sql) {
    $psql = Find-PgBin 'psql.exe'
    if (-not $psql) { Die 'psql.exe not found under Program Files\PostgreSQL' }
    $env:PGPASSWORD = Get-SuperPassword
    # A generated/typed password can carry non-ASCII characters; the SQL travels
    # through the PowerShell pipeline to psql's stdin, so the pipeline's own
    # encoding (OutputEncoding) and what psql is told to expect on the wire
    # (PGCLIENTENCODING) must agree, or the CREATE ROLE statement gets mangled
    # and the app's own connection later fails to authenticate.
    #
    # MUST be $global:OutputEncoding, not a bare $OutputEncoding assignment:
    # inside a function, a bare assignment only creates a NEW LOCAL variable
    # that shadows the global one for the rest of THIS scope - PowerShell 5.1's
    # native-pipe encoding is read from the actual global preference variable
    # when it pipes text to a child process, so the local shadow has ZERO
    # effect on what psql actually receives (proven: without this, an e-acute
    # arrived at the child process as the single byte 0x3F, a literal '?').
    # UTF8 also makes psql skip the single BOM that PS 5.1 prepends on a 65001
    # console; with any other client encoding that BOM is a syntax error
    # (verified against psql 17).
    $prevOutputEncoding = $global:OutputEncoding
    $global:OutputEncoding = New-Object System.Text.UTF8Encoding $false
    $prevPgClientEncoding = $env:PGCLIENTENCODING
    $env:PGCLIENTENCODING = 'UTF8'
    try { return ($sql | & $psql -h $cfg.PgHost -p $cfg.PgPort -U postgres -d postgres -w -v ON_ERROR_STOP=1 -t -A -f -) }
    finally { $env:PGPASSWORD = ''; $env:PGCLIENTENCODING = $prevPgClientEncoding; $global:OutputEncoding = $prevOutputEncoding }
}

# Probe the cluster we will ACTUALLY use - host+port+superuser credentials -
# rather than trusting that a service named postgresql* is the one answering on
# PgPort. On a machine where another product (4MyPeople) already ships a
# cluster, those two can easily be different things.
#
# -w so psql NEVER prompts: an interactive password prompt on a closed stdin
# hangs the installer forever. $ErrorActionPreference is dropped to Continue
# around the call because psql writes its diagnostics to stderr, which under
# 'Stop' becomes a terminating NativeCommandError and hides the real message.
function Test-PgSuper {
    $psql = Find-PgBin 'psql.exe'
    if (-not $psql) { return @{ Ok = $false; Err = 'psql.exe not found under Program Files\PostgreSQL' } }
    $env:PGPASSWORD = Get-SuperPassword
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $psql -h $cfg.PgHost -p $cfg.PgPort -U postgres -d postgres -w -t -A -c 'SHOW server_version_num' 2>&1
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $old; $env:PGPASSWORD = '' }
    $text = (($out | ForEach-Object { $_.ToString() }) -join ' ').Trim()
    if ($code -eq 0) {
        $num = 0
        if ($text -match '(\d{5,6})') { $num = [int]$Matches[1] }
        return @{ Ok = $true; Version = $num }
    }
    return @{ Ok = $false; Err = $text }
}
function Step4-Postgres {
    $script:Step4Reached = $true
    # ---- cluster present? ----
    $svc = Get-Service postgresql* -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($svc) {
        Log ("PostgreSQL service present: " + $svc.Name + " (" + $svc.Status + ")")
        if ($svc.Status -ne 'Running') { Log 'Starting the PostgreSQL service' 'STEP'; Start-Service $svc.Name }
    } else {
        $exe = Get-ChildItem $PayloadInst -Filter 'postgresql-*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $exe) { Die "No PostgreSQL cluster and no postgresql-*.exe in $PayloadInst" }
        Log ("Installing PostgreSQL unattended: " + $exe.Name + " (port $($cfg.PgPort))") 'STEP'
        $a = @('--mode', 'unattended', '--unattendedmodeui', 'none', '--superpassword', $cfg.StandardPgSuperPassword, '--serverport', "$($cfg.PgPort)")
        $p = Start-Process $exe.FullName -ArgumentList $a -Wait -PassThru
        if ($p.ExitCode -ne 0) { Die "PostgreSQL installer failed (exit $($p.ExitCode))" }
        $svc = Get-Service postgresql* -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $svc) { Die 'PostgreSQL installed but no postgresql* service found' }
        Log 'PostgreSQL installed' 'OK'
    }

    # ---- COHABITATION GUARD ------------------------------------------------
    # A service named postgresql* existing is NOT proof that the cluster we are
    # about to provision into is reachable, is the right one, or accepts our
    # credentials. Three ways that goes wrong on a machine that already runs
    # someone else's PostgreSQL (typically 4MyPeople's bundled cluster):
    #   * it listens on another port  -> every psql call fails against PgPort
    #   * several clusters coexist    -> Select-Object -First 1 picked the wrong
    #                                    service, and the port decides anyway
    #   * it is not an appliance box  -> the standard superuser password is not
    #                                    that cluster's password
    # Probing once, here, turns all three into one readable sentence instead of
    # an opaque failure three steps later.
    #
    # SKIPPED in upgrade mode, deliberately: an upgrade provisions nothing, and
    # a sqlite-only install has no superuser to probe with. Making it fatal
    # there would fail upgrades that used to pass. The early return below keeps
    # upgrade on its old, lenient path.
    if ($Mode -eq 'upgrade') {
        # verify only - the DB and .env already exist; nothing is provisioned.
        $url = Get-EnvValue 'PG_URL'
        if ($url) { Log 'Upgrade mode: PostgreSQL verify only (PG_URL present in .env)' } else { Log 'Upgrade mode: no PG_URL in .env (sqlite-only install?) - skipping DB checks' 'WARN' }
        return
    }

    $probe = Test-PgSuper
    if (-not $probe.Ok -and $probe.Err -match 'password|authentication|role .* does not exist') {
        if ($cfg.ContainsKey('EnvSilent') -and $cfg.EnvSilent) {
            Die ("PostgreSQL on port " + $cfg.PgPort + " refused the superuser credentials. This cluster was not installed by us - put its postgres password in config EnvAnswers.PG_SUPER_PASSWORD. (" + $probe.Err + ")")
        }
        Log 'The existing PostgreSQL did not accept the standard superuser password.' 'WARN'
        Write-Host '     where: this machine already runs a PostgreSQL we did not install (4MyPeople, or one you set up).' -ForegroundColor DarkGray
        Write-Host '     We only ADD a sdp_app role + a sdp_dashboard database; nothing else is touched.' -ForegroundColor DarkGray
        $inp = Read-Secret ('  postgres superuser password for the cluster on port ' + $cfg.PgPort)
        if ($inp) { $script:SuperPw = $inp; $probe = Test-PgSuper }
    }
    if (-not $probe.Ok) {
        $listening = @(Get-PortListenerPids ([int]$cfg.PgPort))
        $svcNames = ((Get-Service postgresql* -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + '=' + $_.Status }) -join ', ')
        $hint = if ($listening.Count -eq 0) {
            "NOTHING is listening on port $($cfg.PgPort). The existing cluster almost certainly uses another port - set PgPort in config.psd1 to match it."
        } else {
            "Something IS listening on port $($cfg.PgPort) but rejected us."
        }
        Die ("Cannot reach PostgreSQL at " + $cfg.PgHost + ":" + $cfg.PgPort + " as superuser. " + $hint + " Services found: " + $svcNames + ". psql said: " + $probe.Err)
    }
    $pgMin = [int]$cfg.PgMinMajor
    $pgMajor = [math]::Floor($probe.Version / 10000)
    if ($probe.Version -gt 0 -and $pgMajor -lt $pgMin) {
        Die ("The existing PostgreSQL is major " + $pgMajor + "; this application needs " + $pgMin + " or later (restore uses DROP DATABASE ... WITH (FORCE), a 13+ feature). Refusing to provision into a cluster whose restore path would fail later.")
    }
    Log ("PostgreSQL major " + $pgMajor + " reachable on " + $cfg.PgHost + ":" + $cfg.PgPort + " - reusing this cluster") 'OK'

    # ---- sdp_app password: EnvAnswers > reuse from existing PG_URL > prompt/generate ----
    $appPw = $null
    if ($cfg.EnvAnswers -and $cfg.EnvAnswers.ContainsKey('SDP_APP_PASSWORD') -and $cfg.EnvAnswers.SDP_APP_PASSWORD) {
        $appPw = [string]$cfg.EnvAnswers.SDP_APP_PASSWORD
        Log 'sdp_app password taken from EnvAnswers (silent)'
    } else {
        $url = Get-EnvValue 'PG_URL'
        if ($url -and $url -ne '__COMPUTED__') {
            try {
                $u = [Uri]$url
                $appPw = [Uri]::UnescapeDataString($u.UserInfo.Split(':')[1])
                Log 'sdp_app password reused from the existing .env PG_URL'
            } catch { }
        }
    }
    if (-not $appPw) {
        if ($cfg.ContainsKey('EnvSilent') -and $cfg.EnvSilent) {
            $appPw = New-RandomPassword
            Log 'sdp_app password GENERATED (silent mode) - it lands in .env PG_URL' 'WARN'
        } else {
            Write-Host '     where: password for the dedicated sdp_app PostgreSQL role (stored in .env PG_URL)' -ForegroundColor DarkGray
            $inp = Read-Secret '  sdp_app database password [Enter = generate one]'
            if ([string]::IsNullOrWhiteSpace($inp)) {
                $appPw = New-RandomPassword
                # Deliberate exception to "no secret on stdout": the operator
                # has no other way to learn a freshly generated password. It
                # can still reach an active PowerShell transcript (Start-
                # Transcript) if one happens to be running - same caveat as
                # the 4MyPeople leak this file's header references - and the
                # value is ALSO stored in .env PG_URL right after this step.
                Write-Host ("     generated: " + $appPw + "   (SHOWN ONCE - stored in .env PG_URL)") -ForegroundColor Yellow
            } else { $appPw = $inp }
        }
    }

    # ---- Reinstall + -ConfirmDataLoss: drop the DB before provisioning ----
    if ($Mode -eq 'reinstall' -and $ConfirmDataLoss) {
        if ($cfg.DbName -notmatch '^[a-z_][a-z0-9_]*$') { Die "Unsafe DbName '$($cfg.DbName)'" }
        Log ("-ConfirmDataLoss: DROP DATABASE IF EXISTS " + $cfg.DbName) 'WARN'
        Invoke-PsqlSuper ("DROP DATABASE IF EXISTS " + $cfg.DbName + " WITH (FORCE)") | Out-Null
        if ($LASTEXITCODE -ne 0) { Die 'DROP DATABASE failed' }
        $script:DbDropped = $true
    }

    # ---- provision role + database (idempotent) ----
    if ($cfg.DbName -notmatch '^[a-z_][a-z0-9_]*$') { Die "Unsafe DbName '$($cfg.DbName)'" }
    # Did the database exist BEFORE provisioning? Decides the summary's
    # 'created' vs 'preserved' from fact, whichever provisioning path runs.
    $dbExistedBefore = ("" + (Invoke-PsqlSuper ("SELECT 1 FROM pg_database WHERE datname = '" + $cfg.DbName + "'"))).Trim() -eq '1'
    $script:DbExistedBefore = $dbExistedBefore
    $prov = if ($env:SDP_FORCE_PSQL_PROVISION -eq '1') { $null } else { Find-ProvisionScript }
    if ($prov) {
        Log ("Provisioning via node " + $prov.Script + " --db=" + $cfg.DbName) 'STEP'
        $env:SDP_APP_PASSWORD = $appPw
        try {
            Push-Location $prov.Cwd
            try { & node $prov.Script ('--db=' + $cfg.DbName) } finally { Pop-Location }
            if ($LASTEXITCODE -ne 0) { Die 'provision-prod.js failed - see output above' }
        } finally { $env:SDP_APP_PASSWORD = '' }
        if (-not $dbExistedBefore) { $script:DbCreated = $true }
    } else {
        # psql fallback - byte-for-byte the provision-prod.js semantics:
        # role create-if-absent (password NOT reset when it exists), db create-if-absent.
        Log 'Provisioning via psql fallback (node_modules\pg not reachable yet)' 'STEP'
        # (DbName already validated above, before the probe - same value on every path)
        $roleExists = Invoke-PsqlSuper "SELECT 1 FROM pg_roles WHERE rolname = 'sdp_app'"
        if ("$roleExists".Trim() -ne '1') {
            Invoke-PsqlSuperStdin ("CREATE ROLE sdp_app LOGIN PASSWORD '" + ($appPw -replace "'", "''") + "';") | Out-Null
            if ($LASTEXITCODE -ne 0) { Die 'CREATE ROLE sdp_app failed' }
            Log 'role sdp_app created'
        } else { Log 'role sdp_app already exists (password unchanged - PG_URL must match it)' 'WARN' }
        if (-not $dbExistedBefore) {
            Invoke-PsqlSuper ("CREATE DATABASE " + $cfg.DbName + " OWNER sdp_app") | Out-Null
            if ($LASTEXITCODE -ne 0) { Die ("CREATE DATABASE " + $cfg.DbName + " failed") }
            $script:DbCreated = $true
            Log ("database " + $cfg.DbName + " created (owner sdp_app)")
        } else { Log ("database " + $cfg.DbName + " already exists") }
    }

    # ---- compute PG_URL for the questionnaire + verify with the app creds ----
    $pgUrl = 'postgres://' + $cfg.DbUser + ':' + [Uri]::EscapeDataString($appPw) + '@' + $cfg.PgHost + ':' + $cfg.PgPort + '/' + $cfg.DbName
    if (-not $script:ComputedEnv) { $script:ComputedEnv = @{} }
    $script:ComputedEnv['pg_url'] = $pgUrl
    $psql = Find-PgBin 'psql.exe'
    if ($psql) {
        $env:PGPASSWORD = $appPw
        try { $one = (& $psql -h $cfg.PgHost -p $cfg.PgPort -U $cfg.DbUser -d $cfg.DbName -t -A -c 'SELECT 1') } finally { $env:PGPASSWORD = '' }
        if ("$one".Trim() -eq '1') { Log ("PostgreSQL ready: " + $cfg.DbUser + "@" + $cfg.PgHost + ":" + $cfg.PgPort + "/" + $cfg.DbName) 'OK' }
        else { Die ("Cannot connect as " + $cfg.DbUser + " to " + $cfg.DbName + " with the chosen password. If the role pre-existed with another password, rerun provisioning with --reset-password or supply the right one in EnvAnswers.SDP_APP_PASSWORD.") }
    } else { Log 'psql.exe not found - skipping the app-credentials connectivity check' 'WARN' }
}

# =====================================================================
# Step 5 - automatic pre-change restore point via Manage-SDP.ps1 -Backup.
# Manage-SDP's LAST stdout line is the zip path (its logs go to the console
# via Write-Host, not the output stream).
#
# Step 5 now runs BEFORE step 4 on reinstall / fresh-over-existing (2026-09-15),
# so the PostgreSQL service may still be stopped at this point: pg_dump needs
# it up. And whenever the plan carries -ConfirmDataLoss (a DROP is coming in
# step 4), the produced zip MUST actually contain the DB dump, or the restore
# point is worthless as a safety net for the very thing it exists to protect
# against - refuse to continue rather than let the DROP proceed unguarded.
# =====================================================================
# Before any DROP: the database step 4 drops ($cfg.DbName on $cfg.PgHost:PgPort)
# must be the database the pre-change dump saves and the red screen's
# 'DROP <db>' phrase named. The dump (tools\pg\dump-db.js) reads PG_URL from the
# environment first (PG_URL, then DATABASE_URL), then from .env; the phrase comes
# from .env PG_URL. Any of those naming another database would leave the dropped
# one without a dump. Messages carry db@host:port only - never a URL or a credential.
function Format-SdpDbTarget($t) {
    if (-not $t) { return 'unparsable URL' }
    return ($t.db + '@' + $t.host + ':' + $t.port)
}
function Assert-DropTargetMatchesEnv {
    $cfgPort = if ("$($cfg.PgPort)".Trim()) { "$($cfg.PgPort)".Trim() } else { '5432' }
    $cfgLabel = [string]$cfg.DbName + '@' + (ConvertTo-SdpPgHost ([string]$cfg.PgHost)) + ':' + $cfgPort
    $envUrl = $null
    try { $envUrl = Get-SdpEnvValueStrict $InstallDir 'PG_URL' }
    catch { Die ('Cannot read .env - cannot prove it names the database this installer would drop (' + $cfgLabel + '); nothing was dropped.') }
    if (-not $envUrl) { Die ('.env has no PG_URL - cannot prove it names the database this installer would drop (' + $cfgLabel + ') - fix .env or config.psd1; nothing was dropped.') }
    $checks = @(, @('.env', $envUrl))
    foreach ($k in @('PG_URL', 'DATABASE_URL')) {
        $v = [Environment]::GetEnvironmentVariable($k, 'Process')
        if ($v) { $checks += , @(('the ' + $k + ' environment variable'), $v); break }   # dump-db.js uses the first one set
    }
    foreach ($c in $checks) {
        if (-not (Test-SdpSameDatabase $c[1] $cfg.DbName $cfg.PgHost $cfg.PgPort)) {
            Die ('The database named in ' + $c[0] + ' (' + (Format-SdpDbTarget (Get-SdpPgUrlTarget $c[1])) + ') is not the one this installer would drop (' + $cfgLabel + ') - fix .env or config.psd1; nothing was dropped.')
        }
    }
    Log ('Drop target proven: .env names the database step 4 drops (' + $cfgLabel + ')') 'OK'
}
# Manage-SDP runs in a child process: its console lines (Log -> Write-Host,
# dump-db.js progress, '[pg-dump] FAILED ...') arrive in the captured output,
# not on this console. Replay them here (console + install log) so a failed or
# skipped dump is visible, and return the LAST line - the zip path contract
# (Manage-SDP.ps1 'backup' ends with Write-Output $zip). -All replays every
# line (a failed child has no zip line; its last line is the error).
function Split-ChildBackupOutput($out, [switch]$All) {
    $lines = @($out | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_ })
    if ($lines.Count -eq 0) { return $null }
    $replay = if ($All) { $lines } else { @($lines | Select-Object -First ($lines.Count - 1)) }
    foreach ($l in $replay) {
        Write-Host ('    ' + $l) -ForegroundColor DarkGray
        try { Add-Content -Path $LogFile -Value ('         [manage] ' + $l) } catch { }
    }
    if ($All) { return $null }
    return $lines[$lines.Count - 1]
}
function Step5-Backup {
    $manage = Join-Path $here 'Manage-SDP.ps1'
    if (-not (Test-Path $manage)) { Die "Manage-SDP.ps1 not found next to this script: $manage" }
    # Proven before the restore point is even taken: nothing is spent on a run
    # that would be refused, and step 4 (the DROP) always comes after step 5.
    if ($ConfirmDataLoss) { Assert-DropTargetMatchesEnv }
    $svc = Get-Service postgresql* -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($svc -and $svc.Status -ne 'Running') {
        Log ('Starting the PostgreSQL service for the pre-change dump (' + $svc.Name + ')') 'STEP'
        $startErr = $null
        try {
            if ($svc.Status -eq 'Stopped') { $svc.Start() }
            $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
        } catch [System.ServiceProcess.TimeoutException] {
            $startErr = 'service did not reach Running within 30s (status: ' + $svc.Status + ')'
        } catch {
            $startErr = $_.Exception.Message
        }
        if ($startErr) {
            if ($ConfirmDataLoss) { Die ('Cannot start the PostgreSQL service ' + $svc.Name + ' - the pre-change dump needs it: ' + $startErr) }
            else { Log ('Could not start the PostgreSQL service ' + $svc.Name + ' - continuing without it, the pre-change dump may be empty: ' + $startErr) 'WARN' }
        }
    }
    # Data-integrity baseline (compared again in step 7 on the success path).
    $script:CountsBefore = Get-SdpDbCounts $InstallDir
    if ($script:CountsBefore.reachable) { Log ('Data baseline: ' + (Format-Counts $script:CountsBefore.counts)) }
    else { Log ('Data baseline unavailable (' + $script:CountsBefore.error + ')') 'WARN' }
    $mArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $manage, '-Backup', '-Tag', ('pre-' + $script:BundleVer))
    if ($Config) { $mArgs += @('-Config', $Config) }
    $out = & powershell @mArgs
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Split-ChildBackupOutput $out -All | Out-Null
        Die 'Pre-change backup failed - refusing to continue (see the manage-backup log)'
    }
    $zip = Split-ChildBackupOutput $out
    if (-not ($zip -and (Test-Path $zip))) { Die "Backup ran but returned no zip path (got: '$zip')" }
    if ($ConfirmDataLoss -and -not (Test-SdpZipHasDump $zip)) {
        Die ('No database dump inside the restore point ' + (Split-Path $zip -Leaf) + ' - refusing to DROP the database. Check PG_URL / the PostgreSQL service, take a backup (menu 5) and retry.')
    }
    $script:RollbackZip = $zip
    Log ("Restore point: " + $zip) 'OK'
}
# Get-SdpCountValue (SdpSituation.ps1) reads $c[$_] on a Hashtable (the real
# shape Get-SdpDbCounts returns) OR a PSCustomObject (a fixture built via
# ConvertFrom-Json / [pscustomobject]@{}) - so this renders either.
function Format-Counts($c) {
    if (-not $c) { return 'n/a' }
    return (($script:SdpCountTables | ForEach-Object { $v = Get-SdpCountValue $c $_; $_ + ' ' + $(if ($null -eq $v) { '-' } else { $v }) }) -join ', ')
}

# =====================================================================
# Step 6 - deploy code (+ node_modules) from payload\app.zip.
# Exclusions HARD-CODED (repo doctrine): data\ blobs\ SDP-Backups\ .env.
# Upgrade/Reinstall: old node_modules renamed .prev (rollback safety), the
# payload tree moved in. Patch: node_modules untouched. version.json written.
# Upgrade: new env.template keys appended to .env COMMENTED (never overwrite).
# =====================================================================
function Step6-Deploy {
    $appZip = Join-Path $PayloadDir 'app.zip'
    $stage = Join-Path $env:TEMP ('sdp-deploy-stage-' + (Get-Random))
    Log "Expanding payload app.zip -> $stage" 'STEP'
    Expand-Archive -LiteralPath $appZip -DestinationPath $stage -Force
    try {
        if (-not (Test-Path (Join-Path $stage 'server.js'))) { Die 'payload app.zip has no server.js at its root - bad bundle' }
        Log 'Deploying code (exclusions: data, blobs, SDP-Backups, node_modules, .env)' 'STEP'
        # /IS /IT /IM: a deploy must copy UNCONDITIONALLY. Robocopy silently skips
        # files whose size+LastWriteTime match: 'Same' needs /IS, 'Tweaked' /IT and
        # 'Modified' (equal write time, different NTFS change time - exactly what a
        # zip-extracted payload produces) needs /IM. Caught live in the E2E test.
        Invoke-Robocopy $stage $InstallDir @('/IS', '/IT', '/IM', '/XD', 'data', 'blobs', 'SDP-Backups', 'node_modules', '/XF', '.env')
        $stNm = Join-Path $stage 'node_modules'
        $inNm = Join-Path $InstallDir 'node_modules'
        if ($Mode -eq 'patch') {
            Log 'Patch mode: node_modules untouched'
        } elseif (Test-Path $stNm) {
            if (Test-Path $inNm) {
                $prev = Join-Path $InstallDir 'node_modules.prev'
                if (Test-Path $prev) { Remove-Item $prev -Recurse -Force }
                Log 'node_modules -> node_modules.prev (restored on rollback, deleted on verify OK)'
                Move-Item $inNm $prev
            }
            Log 'Moving payload node_modules into place'
            Move-Item $stNm $inNm
        } else {
            Log 'Bundle carries no node_modules - existing tree kept' 'WARN'
        }
        $vj = New-Object psobject -Property @{
            version = $script:BundleVer; sha = $script:BundleSha
            installedAt = (Get-Date -Format 's'); mode = $Mode
        }
        Set-Content -Path (Join-Path $InstallDir 'version.json') -Value ($vj | ConvertTo-Json) -Encoding ascii
        Log ("version.json written: " + $script:BundleVer + " (" + $Mode + ")")
        if ($Mode -eq 'upgrade') { Add-NewEnvKeys $script:BundleVer }
    } finally { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
}

# =====================================================================
# Step 7 - orphan-safe restart + verify; automatic rollback on failure.
# NEVER pm2 reload (EADDRINUSE crash-loop). Restart = pm2 stop -> wait -> if
# the port is STILL listening, netstat -> PID -> taskkill /F /PID (surgical,
# mirrors _pm2_recover_prod.cmd - never /IM node.exe) -> pm2 start.
# NoService test mode (pm2 absent): plain background node for the probe.
# =====================================================================
function Stop-AppOrphanSafe {
    if ($script:Pm2) { cmd /c ('"' + $script:Pm2 + '" stop ' + $SvcName + ' 2>nul') | Out-Null }
    $pidFile = Join-Path $InstallDir '.sdp-node.pid'
    if (Test-Path $pidFile) {
        $tpid = (Get-Content $pidFile | Select-Object -First 1)
        if ("$tpid" -match '^\d+$') { cmd /c ("taskkill /F /PID $tpid >nul 2>nul") }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 5
    $pids = Get-PortListenerPids $AppPort
    foreach ($p in $pids) {
        Log ("Port $AppPort still held by pid $p - surgical taskkill (orphan recovery)") 'WARN'
        cmd /c ("taskkill /F /PID $p >nul 2>nul")
    }
    if ($pids.Count -gt 0) { Start-Sleep -Seconds 3 }
}
function Start-App {
    if ($script:Pm2) {
        cmd /c ('"' + $script:Pm2 + '" describe ' + $SvcName + ' >nul 2>nul')
        if ($LASTEXITCODE -eq 0) {
            cmd /c ('"' + $script:Pm2 + '" start ' + $SvcName + ' 2>nul') | Out-Null
        } else {
            Log ("Registering pm2 app " + $SvcName + " (--max-old-space-size=" + $cfg.HeapMB + ")") 'STEP'
            Push-Location $InstallDir
            try { cmd /c ('"' + $script:Pm2 + '" start server.js --name ' + $SvcName + ' --node-args="--max-old-space-size=' + $cfg.HeapMB + '" 2>nul') | Out-Null }
            finally { Pop-Location }
        }
        cmd /c ('"' + $script:Pm2 + '" save 2>nul') | Out-Null
        $deadline = (Get-Date).AddSeconds(30)
        $online = $false
        while ((Get-Date) -lt $deadline) {
            try {
                $jl = (cmd /c ('"' + $script:Pm2 + '" jlist 2>nul') | Out-String | ConvertFrom-Json)
                foreach ($p in $jl) { if ($p.name -eq $SvcName -and $p.pm2_env.status -eq 'online') { $online = $true } }
            } catch { }
            if ($online) { break }
            Start-Sleep -Seconds 2
        }
        if (-not $online) { Die 'pm2 app did not reach online within 30 s' }
        Log 'pm2 status: online'
    } else {
        # TEST-ONLY fallback, documented in the header: plain background node.
        Log 'NoService mode: starting a plain background node server.js for the probe (test boxes only)' 'WARN'
        $proc = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $InstallDir -WindowStyle Hidden -PassThru
        Set-Content -Path (Join-Path $InstallDir '.sdp-node.pid') -Value $proc.Id -Encoding ascii
        $script:NodeProc = $proc
        Start-Sleep -Seconds 3
        if ($proc.HasExited) { Die ('node server.js exited immediately (code ' + $proc.ExitCode + ')') }
    }
}
function Stop-NoServiceProbe {
    if (-not $script:Pm2 -and $script:NodeProc) {
        if (-not $script:NodeProc.HasExited) {
            Log 'NoService mode: stopping the probe node process' 'WARN'
            Stop-Process -Id $script:NodeProc.Id -Force -ErrorAction SilentlyContinue
        }
        Remove-Item (Join-Path $InstallDir '.sdp-node.pid') -Force -ErrorAction SilentlyContinue
        $script:NodeProc = $null
    }
}
function Test-AppProbe {
    $url = 'http://localhost:' + $AppPort + '/api/auth/config'
    for ($i = 1; $i -le 3; $i++) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 10
            if ($r.StatusCode -eq 200) { Log ("HTTP probe OK: $url") 'OK'; return $true }
            Log ("probe attempt $i/3: HTTP " + $r.StatusCode) 'WARN'
        } catch { Log ("probe attempt $i/3 failed: " + $_.Exception.Message) 'WARN' }
        if ($script:NodeProc -and $script:NodeProc.HasExited) { Log 'app process exited - no point retrying the probe' 'WARN'; return $false }
        if ($i -lt 3) { Start-Sleep -Seconds 10 }
    }
    return $false
}
function Invoke-Rollback {
    $stage = Join-Path $env:TEMP ('sdp-rollback-' + (Get-Random))
    try {
        Log ("Restoring code + .env from " + $script:RollbackZip) 'STEP'
        Expand-Archive -LiteralPath $script:RollbackZip -DestinationPath $stage -Force
        # data-safety exclusions kept; .env IS restored (it is inside the zip).
        # /IS /IT /IM: unconditional copy (see the step-6 comment).
        Invoke-Robocopy $stage $InstallDir @('/IS', '/IT', '/IM', '/XD', 'data', 'blobs', 'SDP-Backups', 'node_modules', '/XF', 'raw_cache.json')
        # the DB dump inside the point is NOT auto-applied (additive schemas;
        # DB restore stays an explicit Manage-SDP.ps1 -Restore decision)
        Remove-Item (Join-Path $InstallDir 'sdp_dashboard.sql') -Force -ErrorAction SilentlyContinue
        $prev = Join-Path $InstallDir 'node_modules.prev'
        if (Test-Path $prev) {
            Log 'Restoring node_modules.prev'
            $nm = Join-Path $InstallDir 'node_modules'
            if (Test-Path $nm) { Remove-Item $nm -Recurse -Force }
            Move-Item $prev $nm
        }
        Log 'Rollback file restore complete (DB not auto-rolled-back by design)' 'OK'
    } finally { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
# Compare the step-5 baseline with the counts after the restart. Any DECREASE is a
# red WARNING in the summary (never an automatic rollback: a rollback restores code
# only, the DB decision is the operator's - the message names the restore point).
# Success-path only (Step7-Verify calls it just before 'Verification PASSED') -
# a failed/rolled-back run says nothing about data because the app never came
# back up to be trusted, and $script:DataCheck stays its 'skipped' default.
# Never throws: any exception becomes a 'skipped' line - a cosmetic check must
# never fail (or roll back) a run whose service already verified healthy.
function Get-DataCheck {
    try {
        if ($script:DbDropped) { return 'skipped (database dropped by request)' }
        if ($script:DbSeeded) { return 'skipped (database replaced by demo dataset)' }
        if ($script:SeedFailed) { return 'skipped (demo dataset restore failed - database state uncertain)' }
        if (-not $script:CountsBefore) { return 'skipped (fresh install)' }
        if (-not $script:CountsBefore.reachable) { return 'skipped (db counts unavailable before)' }
        $after = Get-SdpDbCounts $InstallDir
        if (-not $after.reachable) { return ('skipped (db counts unavailable after: ' + $after.error + ')') }
        $drops = @(Compare-SdpCounts $script:CountsBefore.counts $after.counts)
        if ($drops.Count -gt 0) {
            $rp = if ($script:RollbackZip) { Split-Path $script:RollbackZip -Leaf } else { 'none' }
            return ('WARNING - ' + ($drops -join ', ') + ' - restore point: ' + $rp)
        }
        return ('OK (' + (Format-Counts $after.counts) + ')')
    } catch {
        return ('skipped (db counts unavailable after: ' + $_.Exception.Message + ')')
    }
}
function Step7-Verify {
    $ok = $false
    try {
        Stop-AppOrphanSafe
        Start-App
        $ok = Test-AppProbe
    } catch { Log ('start/verify error: ' + $_.Exception.Message) 'ERROR'; $ok = $false }
    if ($ok) {
        $prev = Join-Path $InstallDir 'node_modules.prev'
        if (Test-Path $prev) { Remove-Item $prev -Recurse -Force; Log 'node_modules.prev deleted (verify passed)' }
        Stop-NoServiceProbe
        $script:DataCheck = Get-DataCheck
        if ($script:DataCheck -like 'WARNING*') { Log ('Data check: ' + $script:DataCheck) 'ALERT' } else { Log ('Data check: ' + $script:DataCheck) 'OK' }
        Log 'Verification PASSED' 'OK'
        return
    }
    Stop-NoServiceProbe
    if ($NoRollback) { Die 'Verification FAILED - -NoRollback set, broken state left in place for debugging' }
    if (-not $script:RollbackZip) { Die 'Verification FAILED and there is no step-5 restore point (fresh install) - nothing to roll back to' }
    Log '*** Verification FAILED - automatic rollback to the step-5 restore point ***' 'ERROR'
    Invoke-Rollback
    $ok2 = $false
    try {
        Stop-AppOrphanSafe
        Start-App
        $ok2 = Test-AppProbe
    } catch { Log ('rollback restart error: ' + $_.Exception.Message) 'ERROR'; $ok2 = $false }
    Stop-NoServiceProbe
    $script:ExitCode = 2
    if ($ok2) { Die ('ROLLED BACK to ' + (Split-Path $script:RollbackZip -Leaf) + ' - the previous version is serving again') }
    else { Die ('ROLLED BACK to ' + (Split-Path $script:RollbackZip -Leaf) + ' but the re-probe STILL fails - manual attention required. Log: ' + $LogFile) }
}

# =====================================================================
# Step 8 - OPTIONAL seed data. Turns "install, then create a folder, copy a
# zip into it, reopen the menu, pick Restore, type the file name" into nothing
# at all: the demo restore point rides inside the bundle, so it is already on
# disk (the SFX extracted it) and this step does the file handling itself.
#
# NON-FATAL ON PURPOSE. Steps 1-7 already produced a working install; a seed
# problem must not fail the run or trigger a rollback, or a laptop would be
# left broken over a demo dataset. Every failure path here WARNs and returns.
#
# The seed archive is expected to carry DATA ONLY (sdp_dashboard.sql + data\).
# Manage-SDP's restore robocopies the archive over InstallDir with /E and no
# /MIR, so a data-only archive cannot delete or downgrade the code just
# deployed by step 6 - but an archive containing code WOULD overwrite it, and
# one containing .env would overwrite the .env the questionnaire just wrote.
# Build the archive accordingly; this step does not police its contents.
# =====================================================================
function Step8-SeedData {
    $demoDir = Join-Path $PayloadDir 'demo'
    if (-not (Test-Path $demoDir)) { $script:SeedWarning = 'no payload\demo\ in this bundle'; Log 'No payload\demo\ in this bundle - nothing to seed.' 'WARN'; return }
    $seed = Get-ChildItem $demoDir -Filter '*.zip' -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $seed) { $script:SeedWarning = 'payload\demo\ holds no .zip'; Log 'payload\demo\ holds no .zip - nothing to seed.' 'WARN'; return }

    # Manage-SDP resolves -Name against ITS backup dir only, so the archive has
    # to live there. Creating that directory is exactly the manual step this
    # removes - do it here rather than asking a human to.
    if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
    $dest = Join-Path $BackupDir $seed.Name
    Copy-Item -LiteralPath $seed.FullName -Destination $dest -Force
    Log ("Seed archive staged: " + $dest + " (" + [math]::Round($seed.Length/1MB,1) + " MB)") 'OK'

    $manage = Join-Path $here 'Manage-SDP.ps1'
    if (-not (Test-Path $manage)) { $script:SeedWarning = 'Manage-SDP.ps1 not found'; Log "Manage-SDP.ps1 not found - seed skipped." 'WARN'; return }
    # -Force skips the interactive 'type YES' prompt: the operator already chose
    # this by picking the seeded menu entry, and a second confirmation in an
    # unattended flow just stalls on a closed stdin.
    $mArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $manage, '-Restore', '-Name', $seed.Name, '-Force')
    if ($Config) { $mArgs += @('-Config', $Config) }
    & powershell @mArgs
    $rc = $LASTEXITCODE
    if ($rc -eq 3) {
        # Manage-SDP exit 3 = refused in its pre-flight (e.g. the demo dump was
        # made by a newer pg_dump than this PostgreSQL server): nothing was
        # stopped, copied or dropped. The database is exactly what steps 1-7
        # left, so step 7's data check still stands - do not re-evaluate it.
        $script:SeedRefused = $true
        $script:SeedZipName = $seed.Name
        $script:SeedWarning = 'the demo restore was refused before any change (see the reason above)'
        Log 'Demo dataset NOT loaded - the restore was REFUSED before any change (reason above). The database was NOT replaced; the app is installed and working.' 'WARN'
        return
    }
    if ($rc -ne 0) {
        # The restore failed after its pre-flight: the service was stopped and
        # the database may already have been dropped (its own message names the
        # pre-restore point to go back to) - the summary must not claim either way.
        $script:SeedFailed = $true
        $script:SeedZipName = $seed.Name
        $script:SeedWarning = 'the demo restore failed (exit ' + $rc + ') - database state uncertain'
        $script:DataCheck = Get-DataCheck
        Log 'Seed restore FAILED - the app is installed; read the restore messages above: if the database was already replaced, restore the pre-restore point they name (option 6).' 'WARN'
        return
    }
    $script:DbSeeded = $true
    $script:SeedZipName = $seed.Name
    # Step 7's data check ran BEFORE this restore and compared the pre-install
    # counts with the pre-seed database; re-evaluate so the summary tells the
    # truth about the database the operator now has.
    $script:DataCheck = Get-DataCheck
    Log 'Seed data loaded.' 'OK'
    # The restore replaced the users table, so the account created by the
    # questionnaire minutes ago no longer exists. Saying this here is the
    # difference between "it works" and a locked-out demo.
    Log 'NOTE: the seed replaced the accounts - sign in with the dashboard credentials that come WITH the data, not the admin created during setup.' 'WARN'
}

# Opens the dashboard once everything is up. Runs elevated (Setup.bat self-
# elevates), which is cosmetically odd but harmless on a demo machine.
# -NoBrowser exists because the installer is also driven headlessly by the
# smoke tests, where spawning a browser would hang the run.
function Open-Dashboard {
    if ($NoBrowser) { return }
    $url = 'http://localhost:' + $AppPort + '/'
    try { Start-Process $url | Out-Null; Log ("Opened " + $url) 'OK' }
    catch { Log ("Could not open a browser - go to " + $url) 'WARN' }
}

# =====================================================================
# main
# =====================================================================
try {
    Write-EnvHeader
    # Task 7 summary facts, captured for real here (every mode, incl. env-only)
    # right after the env header - "before this run touched anything" is
    # exactly what Write-EnvHeader has just finished probing.
    $script:InstalledVerAtStart = Get-JsonVersion (Join-Path $InstallDir 'version.json')
    $script:EnvExistedAtStart = Test-Path (Join-Path $InstallDir '.env')
    Log "Install-SDP $Mode start (config=$Config bundle=$BundleRoot)" 'STEP'

    if ($Mode -eq 'env-only') {
        Invoke-Step '4b' '.env questionnaire (ConfigureEnvOnly)' { Invoke-EnvQuestionnaire }
        Complete-Run 'OK'
        Write-SummaryBox 'SDP Dashboard .env configuration complete.'
        exit 0
    }

    # $plan was already computed above (before the logging section), so
    # -PrintPlan can dry-run with zero side effects. Reused here as-is.
    foreach ($n in $plan) {
        switch ($n) {
            '1'  { Invoke-Step '1'  'Preflight'                { Step1-Preflight } }
            '2'  { Invoke-Step '2'  'Runtime deps (Node, Python)' { Step2-RuntimeDeps } }
            '3'  { Invoke-Step '3'  'pm2 + Windows service'    { Step3-Pm2Service } }
            '4'  { Invoke-Step '4'  'PostgreSQL'               { Step4-Postgres } }
            '4b' { Invoke-Step '4b' '.env questionnaire'       { Invoke-EnvQuestionnaire } }
            '5'  { Invoke-Step '5'  'Pre-change backup'        { Step5-Backup } }
            '6'  { Invoke-Step '6'  'Deploy code'              { Step6-Deploy } }
            '7'  { Invoke-Step '7'  'Restart + verify'         { Step7-Verify } }
            '8'  { Invoke-Step '8'  'Seed demo data'           { Step8-SeedData } }
        }
        if ($StopAfterStep -and $n -eq $StopAfterStep) {
            Log "StopAfterStep $StopAfterStep reached - stopping here (staged run)" 'WARN'
            break
        }
    }
    if ($script:SeedWarning) {
        # Installed and verified, but the demo dataset is NOT there: never a
        # plain success (exit 3 - see the header).
        [void]$script:StepResults.Add('WARNING step 8  demo dataset NOT loaded: ' + $script:SeedWarning)
        Complete-Run 'COMPLETED WITH WARNINGS - demo dataset NOT loaded'
        Write-SummaryBox 'SDP Dashboard install complete - WITH WARNINGS: demo dataset NOT loaded.'
        Log ('WARNING: the demo dataset was NOT loaded (' + $script:SeedWarning + ').') 'ALERT'
        if ($Mode -eq 'fresh' -and -not $StopAfterStep) { Open-Dashboard }
        exit 3
    }
    Complete-Run 'OK'
    Write-SummaryBox 'SDP Dashboard install complete.'
    # Only on a fresh install, and only when the whole plan ran: a staged run
    # (-StopAfterStep) has not verified the service, so opening a browser at a
    # port nothing is listening on would just show an error page.
    if ($Mode -eq 'fresh' -and -not $StopAfterStep) { Open-Dashboard }
    exit 0
}
catch {
    $msg = $_.Exception.Message
    Log ("FAILED: " + $msg) 'ERROR'
    if ($script:ExitCode -eq 2) { Complete-Run 'ROLLED BACK' } else { Complete-Run ('FAILED: ' + $msg) }
    Log ("Summary: $SummaryFile") 'ERROR'
    exit $script:ExitCode
}
