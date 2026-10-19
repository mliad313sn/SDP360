# =====================================================================
# Detect-SDP.ps1 - "what is on this machine", for Setup.bat.
#   powershell -File Detect-SDP.ps1 -OutFile <json> [-Config <psd1>] [-BundleRoot <dir>]
# Writes the full situation as JSON to -OutFile and prints ONLY KEY=VALUE lines
# on stdout (cmd's for /f loop reads them). -OutFile is REQUIRED: there is no
# shared default file (two menus - Setup.bat, _sdp_admin.cmd - or two operators
# must never read each other's situation); every caller passes its own
# per-session name. Without it: STATE=unknown + ERROR=..., no file written.
# (Checked by hand, not [Parameter(Mandatory)]: a mandatory parameter would
# PROMPT on a console and hang a piped run instead of failing cleanly.)
# Read-only; never throws; exit 0 always (a detection failure is a STATE=unknown line).
# KEEP PURE ASCII (this rule is about the SOURCE FILE - the emitted JSON is
# UTF8, see the note by the JSON write below).
# =====================================================================
param(
    [string]$Config,
    [string]$BundleRoot,
    [string]$OutFile
)
$ErrorActionPreference = 'Stop'

# Every KEY=VALUE line on stdout goes through this - cmd's `for /f` reads one
# line per token, so a value carrying an embedded newline (a stray value in
# version.json, a multi-line exception message, ...) would otherwise split
# into extra lines that don't match KEY=VALUE and corrupt the parse.
function Write-Kv([string]$k, $v) {
    $t = if ($null -eq $v) { '' } else { [string]$v }
    Write-Output ($k + '=' + ($t -replace '[\r\n]+', ' '))
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $BundleRoot) { $BundleRoot = $here }
if (-not $OutFile) {
    Write-Kv 'STATE' 'unknown'; Write-Kv 'RECOMMENDED' 'none'; Write-Kv 'DOWNGRADE' '0'; Write-Kv 'DB_REACHABLE' '0'; Write-Kv 'HAS_SERVER' '0'
    Write-Kv 'INSTALLED_VER' 'unknown'; Write-Kv 'BUNDLE_VER' 'unknown'
    Write-Kv 'ERROR' '-OutFile <json> is required (no shared default situation file)'
    exit 0
}

# Single source of truth for the 4 config defaults - used both to fill gaps
# in the merged config (happy path) and as the catch-path fallback.
$defaults = @{ InstallDir = 'C:\Apps\SDP-Dashboard'; ServiceName = 'endeavour-dashboard'; AppPort = 3456; BackupDir = '..\SDP-Backups' }

try {
    $cfg = Import-PowerShellDataFile (Join-Path $here 'config.psd1')
} catch { $cfg = @{} }
try {
    if ($Config) {
        $ovPath = if (Test-Path $Config) { $Config } else { Join-Path $here $Config }
        try { $ov = Import-PowerShellDataFile $ovPath; foreach ($k in $ov.Keys) { $cfg[$k] = $ov[$k] } } catch { }
    }
    foreach ($k in @('InstallDir', 'ServiceName', 'AppPort', 'BackupDir')) { if (-not $cfg.ContainsKey($k)) { $cfg[$k] = $defaults[$k] } }
    . (Join-Path $here 'SdpSituation.ps1')
    $s = Get-SdpSituation $cfg $BundleRoot
    # Fail-closed by design: if this write throws (bad path, no permission,
    # full disk), we fall into the catch below and report STATE=unknown +
    # ERROR=... instead of a JSON file that half-matches what stdout said -
    # Show-Situation cannot render a menu without the file, so it must not
    # see a stale or partial one. UTF8, not ascii - see the note above.
    ($s | ConvertTo-Json -Depth 8) | Set-Content -Path $OutFile -Encoding UTF8
    $b = { param($v) if ($v) { '1' } else { '0' } }
    Write-Kv 'STATE' $s.verdict.state
    Write-Kv 'RECOMMENDED' $(if ($s.verdict.recommended) { $s.verdict.recommended } else { 'none' })
    Write-Kv 'DOWNGRADE' (& $b $s.verdict.downgrade)
    Write-Kv 'DB_REACHABLE' (& $b $s.db.reachable)
    Write-Kv 'HAS_SERVER' (& $b $s.install.has_server_js)
    Write-Kv 'INSTALLED_VER' $(if ($s.install.version) { $s.install.version } else { 'not installed' })
    Write-Kv 'BUNDLE_VER' $(if ($s.bundle.version) { $s.bundle.version } else { 'unknown' })
} catch {
    # Always leave a readable JSON behind so Show-Situation never reads a stale file.
    $err = ($_.Exception.Message -replace '[\r\n]+', ' ')
    $installDir = $defaults.InstallDir
    if ($cfg -and $cfg.ContainsKey('InstallDir') -and $cfg.InstallDir) { $installDir = $cfg.InstallDir }
    $minimal = @{ install = @{ dir = $installDir; has_server_js = $false; has_env = $false }; runtime = @{}; db = @{ reachable = $false; error = $err }
                  backups = @{ dir = $null; count = 0 }; bundle = @{}; disk = @{}; verdict = @{ state = 'unknown'; recommended = $null; downgrade = $false; notes = @('detection failed: ' + $err) } }
    # UTF8, not ascii - same reasoning as the main write above; and read this
    # file back with Get-Content -Raw (5.1's Get-Content is BOM-tolerant),
    # never -Encoding ascii, or accented text here round-trips as '?'.
    try { ($minimal | ConvertTo-Json -Depth 6) | Set-Content -Path $OutFile -Encoding UTF8 } catch { }
    Write-Kv 'STATE' 'unknown'; Write-Kv 'RECOMMENDED' 'none'; Write-Kv 'DOWNGRADE' '0'; Write-Kv 'DB_REACHABLE' '0'; Write-Kv 'HAS_SERVER' '0'
    Write-Kv 'INSTALLED_VER' 'unknown'; Write-Kv 'BUNDLE_VER' 'unknown'
    Write-Kv 'ERROR' $err
}
exit 0
