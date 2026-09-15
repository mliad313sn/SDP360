$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
. (Join-Path $here '..\SdpSituation.ps1')

# Best-effort cleanup list: every temp dir created below is appended here and
# removed at the end (try/catch, non-fatal if a handle is still open).
$script:TestTempDirs = @()

try {

# Fixture: a fake bundle with version.json + payload\app.zip carrying package-lock.json
function New-Bundle([string]$version, [string]$lockText) {
    $b = New-TempDir 'sdp-bundle'; $script:TestTempDirs += $b
    Set-Content -Path (Join-Path $b 'version.json') -Value ('{"version":"' + $version + '","sha":"abc"}') -Encoding ascii
    $payload = Join-Path $b 'payload'; New-Item -ItemType Directory -Path $payload -Force | Out-Null
    $stage = New-TempDir 'sdp-stage'; $script:TestTempDirs += $stage
    Set-Content -Path (Join-Path $stage 'package-lock.json') -Value $lockText -Encoding ascii
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath (Join-Path $payload 'app.zip') -Force
    return $b
}
function New-Install([string]$version, [bool]$withEnv, [bool]$withServer, [string]$lockText) {
    $d = New-TempDir 'sdp-inst'; $script:TestTempDirs += $d
    if ($withServer) { Set-Content (Join-Path $d 'server.js') '// app' -Encoding ascii }
    if ($version)    { Set-Content (Join-Path $d 'version.json') ('{"version":"' + $version + '"}') -Encoding ascii }
    if ($withEnv)    { Set-Content (Join-Path $d '.env') 'PG_URL=postgres://sdp_app:x@127.0.0.1:1/sdp_dashboard_test' -Encoding ascii }
    if ($lockText)   { Set-Content (Join-Path $d 'package-lock.json') $lockText -Encoding ascii }
    return $d
}
$cfgBase = @{ ServiceName = 'sdp-unit'; AppPort = 3499; BackupDir = '..\SDP-Backups-unit'; PgHost = 'localhost'; PgPort = 5432; DbName = 'sdp_dashboard_test' }
function Cfg($dir) { $c = $cfgBase.Clone(); $c.InstallDir = $dir; return $c }

# 1. empty dir -> empty / fresh
$bundle = New-Bundle '2.4.0' 'lockA'
$empty = New-TempDir 'sdp-empty'; $script:TestTempDirs += $empty
$s = Get-SdpSituation (Cfg $empty) $bundle
Assert-Eq $s.verdict.state 'empty' 'empty dir state'
Assert-Eq $s.verdict.recommended 'fresh' 'empty dir recommends fresh'
Assert-Eq $s.bundle.version '2.4.0' 'bundle version read'
Assert-True (-not $s.verdict.downgrade) 'no downgrade on empty'

# 2. installed, same lockfile -> patch
$inst = New-Install '2.3.1' $true $true 'lockA'
$s = Get-SdpSituation (Cfg $inst) $bundle
Assert-Eq $s.verdict.state 'installed' 'installed state'
Assert-Eq $s.bundle.lockfile_same_as_installed $true 'lockfile same'
Assert-Eq $s.verdict.recommended 'patch' 'same lockfile recommends patch'
Assert-Eq $s.install.version '2.3.1' 'installed version read'
Assert-Eq $s.db.reachable $false 'unreachable DB (port 1) is not an error'
Assert-True ($s.db.error -ne $null) 'db.error explains'
Assert-True (($s.verdict.notes -join ' ') -match 'not reachable') 'note mentions DB not reachable'

# 3. installed, different lockfile -> upgrade
$inst2 = New-Install '2.3.1' $true $true 'lockB'
$s = Get-SdpSituation (Cfg $inst2) $bundle
Assert-Eq $s.bundle.lockfile_same_as_installed $false 'lockfile differs'
Assert-Eq $s.verdict.recommended 'upgrade' 'different lockfile recommends upgrade'

# 4. partial: .env without server.js
$part = New-Install '' $true $false ''
$s = Get-SdpSituation (Cfg $part) $bundle
Assert-Eq $s.verdict.state 'partial' 'partial state'
Assert-True ($s.verdict.recommended -eq $null) 'partial recommends nothing'

# 5. downgrade
$new = New-Install '3.0.0' $true $true 'lockA'
$s = Get-SdpSituation (Cfg $new) $bundle
Assert-Eq $s.verdict.downgrade $true 'bundle 2.4.0 < installed 3.0.0 is a downgrade'

# 6. counts reader never throws on a bad URL
$c = Get-SdpDbCounts $inst
Assert-Eq $c.reachable $false 'counts unreachable'
Assert-True ($c.counts -eq $null) 'no counts when unreachable (null, not zero)'

# 7. Find-SdpPsql: injectable roots, safe numeric sort, never throws, even with
# a non-numeric sibling folder (pgAdmin 4) next to the real version folder (17).
$pgRoot = New-TempDir 'sdp-pgroot'; $script:TestTempDirs += $pgRoot
$dir17 = Join-Path $pgRoot '17'
New-Item -ItemType Directory -Path (Join-Path $dir17 'bin') -Force | Out-Null
Set-Content -Path (Join-Path $dir17 'bin\psql.exe') -Value 'fake' -Encoding ascii
New-Item -ItemType Directory -Path (Join-Path $pgRoot 'pgAdmin 4') -Force | Out-Null
$origPgRoots = $script:SdpPgRoots
$script:SdpPgRoots = @($pgRoot)
$found = $null
try { $found = Find-SdpPsql } catch { $found = 'THREW' }
$script:SdpPgRoots = $origPgRoots
Assert-Eq $found (Join-Path $dir17 'bin\psql.exe') 'Find-SdpPsql returns the 17 path and does not throw on a non-numeric sibling'

# 8. malformed PG_URL never throws; DB reads as unreachable
$badUrlDir = New-TempDir 'sdp-badurl'; $script:TestTempDirs += $badUrlDir
Set-Content -Path (Join-Path $badUrlDir '.env') 'PG_URL=not a url' -Encoding ascii
$c2 = $null
try { $c2 = Get-SdpDbCounts $badUrlDir } catch { $c2 = $null }
Assert-True ($c2 -ne $null) 'Get-SdpDbCounts did not throw on a malformed PG_URL'
Assert-Eq $c2.reachable $false 'malformed PG_URL is unreachable'

# 9. partial the other way: server.js without .env
$part2 = New-Install '' $false $true ''
$s = Get-SdpSituation (Cfg $part2) $bundle
Assert-Eq $s.verdict.state 'partial' 'partial state (server.js without .env)'
Assert-True (($s.verdict.notes -join ' ') -match 'run E') 'note mentions run E'

# 10. installed with no local package-lock.json -> unknown match, upgrade recommended
$instNoLock = New-Install '2.3.1' $true $true ''
$s = Get-SdpSituation (Cfg $instNoLock) $bundle
Assert-Eq $s.bundle.lockfile_same_as_installed $null 'no local lockfile -> null match'
Assert-Eq $s.verdict.recommended 'upgrade' 'no local lockfile recommends upgrade to be safe'
Assert-True (($s.verdict.notes -join ' ') -match 'Upgrade recommended') 'note mentions Upgrade recommended'

Write-Host ("situation.tests: " + $script:AssertCount + " assertions ok")

} finally {
    foreach ($d in $script:TestTempDirs) {
        try { if (Test-Path $d) { Remove-Item -Path $d -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
    }
}

exit 0
