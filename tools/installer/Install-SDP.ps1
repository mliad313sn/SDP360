# =====================================================================
# Install-SDP.ps1 - SDP Dashboard installer engine (steps 1-7).
# Invoked by Setup.bat (bundle menu) or directly:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File Install-SDP.ps1 `
#       [-Fresh | -Upgrade | -Patch | -Reinstall]   (default: -Upgrade)
#       [-ConfigureEnvOnly]                         (questionnaire only)
#       [-Config <psd1>]     merge overrides (config.test.psd1 = :3457 test instance)
#       [-BundleRoot <dir>]  bundle root holding payload\ (default: script dir)
#       [-StopAfterStep <n>] stop after step n (1,2,3,4,4b,5,6,7) - staged runs / tests
#       [-NoRollback]        keep the broken state for on-site debugging
#       [-Force]             override downgrade refusal / fresh-into-nonempty
#       [-ConfirmDataLoss]   Reinstall only: DROP + recreate the database
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
#
# Exit codes: 0 = OK, 1 = failed, 2 = failed AND rolled back.
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
    [switch]$ConfirmDataLoss,
    [string]$Config,
    [string]$BundleRoot,
    [string]$StopAfterStep
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

# --- logging ----------------------------------------------------------
$LogDir = 'C:\ProgramData\SDP-Dashboard\logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$LogFile = Join-Path $LogDir ("install-$stamp.log")
$SummaryFile = Join-Path $LogDir ("install-summary-$stamp.txt")
$InstallsLog = Join-Path $LogDir 'installs.log'
function Log($m, $lvl = 'INFO') {
    $c = switch ($lvl) { 'OK' {'Green'} 'WARN' {'Yellow'} 'ERROR' {'Red'} 'STEP' {'Cyan'} default {'Gray'} }
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
$script:RollbackZip = $null

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
function Write-RunSummary([string]$result) {
    $lines = @()
    $lines += "SDP Dashboard install run $stamp"
    $lines += "Mode: $Mode   Config: $Config   Bundle: $BundleRoot (version $($script:BundleVer))"
    $lines += "Result: $result"
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
    $lines += "Log: $LogFile"
    Set-Content -Path $SummaryFile -Value $lines -Encoding ascii
}
function Complete-Run([string]$result) {
    # installs.log: one line per run, on EVERY exit path.
    $who = "$env:USERDOMAIN\$env:USERNAME"
    Add-Content -Path $InstallsLog -Value ("$stamp | $who | $Mode | $($script:BundleVer) | $result")
    Write-RunSummary $result
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
    $envFile = Join-Path $InstallDir '.env'
    if (-not (Test-Path $envFile)) { return $null }
    $m = Select-String -Path $envFile -Pattern ('^' + $key + '=(.+)$') | Select-Object -First 1
    if ($m) { return $m.Matches[0].Groups[1].Value.Trim() } else { return $null }
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
    $hasApp = Test-Path (Join-Path $InstallDir 'server.js')
    if ($Mode -eq 'fresh') {
        if ($hasApp -and -not $Force) { Die "Fresh mode but $InstallDir already contains server.js. Use -Upgrade / -Reinstall, or -Force to overwrite." }
        if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null; Log "Created $InstallDir" }
    } else {
        if (-not $hasApp) { Die "$Mode mode requires an existing install (no server.js in $InstallDir). Use -Fresh." }
    }

    # bundle payload + downgrade check
    if (-not (Test-Path (Join-Path $PayloadDir 'app.zip'))) { Die "Bundle payload missing: $PayloadDir\app.zip (pass -BundleRoot)" }
    $bv = Get-JsonVersion (Join-Path $BundleRoot 'version.json')
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
function Invoke-PsqlSuper([string]$sql) {
    $psql = Find-PgBin 'psql.exe'
    if (-not $psql) { Die 'psql.exe not found under Program Files\PostgreSQL' }
    $superPw = if ($cfg.EnvAnswers -and $cfg.EnvAnswers.ContainsKey('PG_SUPER_PASSWORD') -and $cfg.EnvAnswers.PG_SUPER_PASSWORD) { $cfg.EnvAnswers.PG_SUPER_PASSWORD } else { $cfg.StandardPgSuperPassword }
    $env:PGPASSWORD = $superPw
    try { return (& $psql -h $cfg.PgHost -p $cfg.PgPort -U postgres -d postgres -v ON_ERROR_STOP=1 -t -A -c $sql) }
    finally { $env:PGPASSWORD = '' }
}
function Step4-Postgres {
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
    if ($Mode -eq 'upgrade') {
        # verify only - the DB and .env already exist; nothing is provisioned.
        $url = Get-EnvValue 'PG_URL'
        if ($url) { Log 'Upgrade mode: PostgreSQL verify only (PG_URL present in .env)' } else { Log 'Upgrade mode: no PG_URL in .env (sqlite-only install?) - skipping DB checks' 'WARN' }
        return
    }

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
    }

    # ---- provision role + database (idempotent) ----
    $prov = if ($env:SDP_FORCE_PSQL_PROVISION -eq '1') { $null } else { Find-ProvisionScript }
    if ($prov) {
        Log ("Provisioning via node " + $prov.Script + " --db=" + $cfg.DbName) 'STEP'
        $env:SDP_APP_PASSWORD = $appPw
        try {
            Push-Location $prov.Cwd
            try { & node $prov.Script ('--db=' + $cfg.DbName) } finally { Pop-Location }
            if ($LASTEXITCODE -ne 0) { Die 'provision-prod.js failed - see output above' }
        } finally { $env:SDP_APP_PASSWORD = '' }
    } else {
        # psql fallback - byte-for-byte the provision-prod.js semantics:
        # role create-if-absent (password NOT reset when it exists), db create-if-absent.
        Log 'Provisioning via psql fallback (node_modules\pg not reachable yet)' 'STEP'
        if ($cfg.DbName -notmatch '^[a-z_][a-z0-9_]*$') { Die "Unsafe DbName '$($cfg.DbName)'" }
        $roleExists = Invoke-PsqlSuper "SELECT 1 FROM pg_roles WHERE rolname = 'sdp_app'"
        if ("$roleExists".Trim() -ne '1') {
            Invoke-PsqlSuper ("CREATE ROLE sdp_app LOGIN PASSWORD '" + ($appPw -replace "'", "''") + "'") | Out-Null
            if ($LASTEXITCODE -ne 0) { Die 'CREATE ROLE sdp_app failed' }
            Log 'role sdp_app created'
        } else { Log 'role sdp_app already exists (password unchanged - PG_URL must match it)' 'WARN' }
        $dbExists = Invoke-PsqlSuper ("SELECT 1 FROM pg_database WHERE datname = '" + $cfg.DbName + "'")
        if ("$dbExists".Trim() -ne '1') {
            Invoke-PsqlSuper ("CREATE DATABASE " + $cfg.DbName + " OWNER sdp_app") | Out-Null
            if ($LASTEXITCODE -ne 0) { Die ("CREATE DATABASE " + $cfg.DbName + " failed") }
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
# Steps 5-7 are implemented in a later plan task.
# =====================================================================
function Step5-Backup     { Die 'Step 5 (backup) not implemented yet - later plan task' }
function Step6-Deploy     { Die 'Step 6 (deploy) not implemented yet - later plan task' }
function Step7-Verify     { Die 'Step 7 (verify) not implemented yet - later plan task' }

# =====================================================================
# main
# =====================================================================
try {
    Log "Install-SDP $Mode start (config=$Config bundle=$BundleRoot)" 'STEP'

    if ($Mode -eq 'env-only') {
        Invoke-Step '4b' '.env questionnaire (ConfigureEnvOnly)' { Invoke-EnvQuestionnaire }
        Complete-Run 'OK'
        Log "Done. Summary: $SummaryFile" 'OK'
        exit 0
    }

    $plan = @()
    switch ($Mode) {
        'fresh'     { $plan = @('1','2','3','4','4b','6','7') }
        'upgrade'   { $plan = @('1','2','3','4','5','6','7') }   # 4 = verify only; new .env keys appended in 6
        'patch'     { $plan = @('1','2','3','5','6','7') }
        'reinstall' { $plan = @('1','2','3','4','4b','5','6','7') }
    }
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
        }
        if ($StopAfterStep -and $n -eq $StopAfterStep) {
            Log "StopAfterStep $StopAfterStep reached - stopping here (staged run)" 'WARN'
            break
        }
    }
    Complete-Run 'OK'
    Log "Install ($Mode) finished OK. Summary: $SummaryFile" 'OK'
    exit 0
}
catch {
    $msg = $_.Exception.Message
    Log ("FAILED: " + $msg) 'ERROR'
    if ($script:ExitCode -eq 2) { Complete-Run 'ROLLED BACK' } else { Complete-Run ('FAILED: ' + $msg) }
    Log ("Summary: $SummaryFile") 'ERROR'
    exit $script:ExitCode
}
