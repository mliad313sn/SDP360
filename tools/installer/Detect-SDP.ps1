# =====================================================================
# Detect-SDP.ps1 - "what is on this machine", for Setup.bat.
#   powershell -File Detect-SDP.ps1 [-Config <psd1>] [-BundleRoot <dir>] [-OutFile <json>]
# Writes the full situation as JSON to -OutFile (default %TEMP%\sdp-situation.json)
# and prints ONLY KEY=VALUE lines on stdout (cmd's for /f loop reads them).
# Read-only; never throws; exit 0 always (a detection failure is a STATE=unknown line).
# KEEP PURE ASCII.
# =====================================================================
param(
    [string]$Config,
    [string]$BundleRoot,
    [string]$OutFile
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $BundleRoot) { $BundleRoot = $here }
if (-not $OutFile) { $OutFile = Join-Path $env:TEMP 'sdp-situation.json' }
try {
    $cfg = Import-PowerShellDataFile (Join-Path $here 'config.psd1')
} catch { $cfg = @{} }
if ($Config) {
    $ovPath = if (Test-Path $Config) { $Config } else { Join-Path $here $Config }
    try { $ov = Import-PowerShellDataFile $ovPath; foreach ($k in $ov.Keys) { $cfg[$k] = $ov[$k] } } catch { }
}
foreach ($k in @('InstallDir', 'ServiceName', 'AppPort', 'BackupDir')) { if (-not $cfg.ContainsKey($k)) { $cfg[$k] = @{ InstallDir = 'C:\Apps\SDP-Dashboard'; ServiceName = 'endeavour-dashboard'; AppPort = 3456; BackupDir = '..\SDP-Backups' }[$k] } }
. (Join-Path $here 'SdpSituation.ps1')
try {
    $s = Get-SdpSituation $cfg $BundleRoot
    ($s | ConvertTo-Json -Depth 8) | Set-Content -Path $OutFile -Encoding ascii
    $b = { param($v) if ($v) { '1' } else { '0' } }
    Write-Output ('STATE=' + $s.verdict.state)
    Write-Output ('RECOMMENDED=' + $(if ($s.verdict.recommended) { $s.verdict.recommended } else { 'none' }))
    Write-Output ('DOWNGRADE=' + (& $b $s.verdict.downgrade))
    Write-Output ('DB_REACHABLE=' + (& $b $s.db.reachable))
    Write-Output ('HAS_SERVER=' + (& $b $s.install.has_server_js))
    Write-Output ('INSTALLED_VER=' + $(if ($s.install.version) { $s.install.version } else { 'not installed' }))
    Write-Output ('BUNDLE_VER=' + $(if ($s.bundle.version) { $s.bundle.version } else { 'unknown' }))
} catch {
    # Always leave a readable JSON behind so Show-Situation never reads a stale file.
    $err = ($_.Exception.Message -replace '[\r\n]', ' ')
    $minimal = @{ install = @{ dir = $cfg.InstallDir; has_server_js = $false; has_env = $false }; runtime = @{}; db = @{ reachable = $false; error = $err }
                  backups = @{ dir = $null; count = 0 }; bundle = @{}; disk = @{}; verdict = @{ state = 'unknown'; recommended = $null; downgrade = $false; notes = @('detection failed: ' + $err) } }
    try { ($minimal | ConvertTo-Json -Depth 6) | Set-Content -Path $OutFile -Encoding ascii } catch { }
    Write-Output 'STATE=unknown'; Write-Output 'RECOMMENDED=none'; Write-Output 'DOWNGRADE=0'; Write-Output 'DB_REACHABLE=0'; Write-Output 'HAS_SERVER=0'
    Write-Output 'INSTALLED_VER=unknown'; Write-Output 'BUNDLE_VER=unknown'
    Write-Output ('ERROR=' + $err)
}
exit 0
