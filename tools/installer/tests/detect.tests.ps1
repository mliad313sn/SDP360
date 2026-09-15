$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$detect = Join-Path $here '..\Detect-SDP.ps1'
$situationScript = Join-Path $here '..\SdpSituation.ps1'

# Best-effort cleanup list: every temp dir / out-file created below is appended
# here and removed at the end (try/catch, non-fatal if a handle is still open).
# Same pattern as situation.tests.ps1.
$script:TestTempDirs = @()
$script:TestOutFiles = @()

try {

$inst = New-TempDir 'sdp-inst'; $script:TestTempDirs += $inst
Set-Content (Join-Path $inst 'server.js') '// app' -Encoding ascii
Set-Content (Join-Path $inst 'version.json') '{"version":"2.3.1"}' -Encoding ascii
Set-Content (Join-Path $inst '.env') 'PG_URL=postgres://sdp_app:x@127.0.0.1:1/x' -Encoding ascii
$bundle = New-TempDir 'sdp-bundle'; $script:TestTempDirs += $bundle
Set-Content (Join-Path $bundle 'version.json') '{"version":"2.4.0"}' -Encoding ascii
$cfgDir = New-TempDir 'sdp-cfg'; $script:TestTempDirs += $cfgDir
$cfgFile = Join-Path $cfgDir 'config.unit.psd1'
Set-Content $cfgFile ("@{ InstallDir = '" + $inst + "'; ServiceName = 'sdp-unit'; AppPort = 3499; BackupDir = '..\SDP-Backups-unit' }") -Encoding ascii
$outFile = Join-Path $env:TEMP ('sdp-situation-test-' + [guid]::NewGuid().ToString('N') + '.json'); $script:TestOutFiles += $outFile

$stdout = & powershell -NoProfile -ExecutionPolicy Bypass -File $detect -Config $cfgFile -BundleRoot $bundle -OutFile $outFile
Assert-Eq $LASTEXITCODE 0 'detect exits 0'
$lines = @($stdout | ForEach-Object { "$_" })
Assert-True (($lines | Where-Object { $_ -notmatch '^[A-Z_]+=' }).Count -eq 0) 'stdout carries ONLY KEY=VALUE lines'
Assert-True ($lines -contains 'STATE=installed') 'STATE line'
Assert-True ($lines -contains 'RECOMMENDED=upgrade') 'RECOMMENDED line'
Assert-True ($lines -contains 'DOWNGRADE=0') 'DOWNGRADE line'
Assert-True ($lines -contains 'DB_REACHABLE=0') 'DB_REACHABLE line'
Assert-True ($lines -contains 'HAS_SERVER=1') 'HAS_SERVER line'
Assert-True ($lines -contains 'INSTALLED_VER=2.3.1') 'INSTALLED_VER line'
Assert-True ($lines -contains 'BUNDLE_VER=2.4.0') 'BUNDLE_VER line'
Assert-True (Test-Path $outFile) 'json written'
$j = Get-Content $outFile -Raw | ConvertFrom-Json
Assert-Eq $j.verdict.state 'installed' 'json verdict'
Assert-Eq $j.install.version '2.3.1' 'json install version'

# Extra: prove the dot-source contract works from a DIFFERENT scope (not just
# this test file's own scope) - a wrapper script dot-sources SdpSituation.ps1
# by absolute path, overrides $script:SdpPgRoots to a definitely-missing dir,
# and calls Find-SdpPsql. Must print nothing/$null and exit 0.
$wrapperDir = New-TempDir 'sdp-detect-wrapper'; $script:TestTempDirs += $wrapperDir
$wrapperScript = Join-Path $wrapperDir 'wrapper.ps1'
$wrapperLines = @(
    ('. "' + $situationScript + '"'),
    '$script:SdpPgRoots = @(''C:\definitely\missing'')',
    '$r = Find-SdpPsql',
    'if ($null -eq $r) { Write-Output ''NULL'' } else { Write-Output $r }'
)
Set-Content -Path $wrapperScript -Value $wrapperLines -Encoding ascii
$wrapperOut = & powershell -NoProfile -ExecutionPolicy Bypass -File $wrapperScript
Assert-Eq $LASTEXITCODE 0 'wrapper script exits 0'
Assert-Eq ("$wrapperOut" -join '') 'NULL' 'Find-SdpPsql with injected missing roots returns null from another scope'

# Catch-path (a): Detect-SDP.ps1 copied ALONE into a temp dir, no SdpSituation.ps1
# next to it -> the dot-source throws -> must be caught (never throws / exit 0
# always contract) and degrade to STATE=unknown with all 7 keys still printed.
$aloneDir = New-TempDir 'sdp-detect-alone'; $script:TestTempDirs += $aloneDir
Copy-Item -Path $detect -Destination (Join-Path $aloneDir 'Detect-SDP.ps1') -Force
$aloneOut = Join-Path $aloneDir 'out.json'; $script:TestOutFiles += $aloneOut
$aloneStdout = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $aloneDir 'Detect-SDP.ps1') -OutFile $aloneOut
Assert-Eq $LASTEXITCODE 0 'detect alone (no SdpSituation.ps1 next to it) exits 0'
$aloneLines = @($aloneStdout | ForEach-Object { "$_" })
Assert-True (($aloneLines | Where-Object { $_ -notmatch '^[A-Z_]+=' }).Count -eq 0) 'alone-run stdout carries ONLY KEY=VALUE lines'
Assert-True ($aloneLines -contains 'STATE=unknown') 'alone-run STATE=unknown'
foreach ($key in @('STATE', 'RECOMMENDED', 'DOWNGRADE', 'DB_REACHABLE', 'HAS_SERVER', 'INSTALLED_VER', 'BUNDLE_VER')) {
    Assert-True (($aloneLines | Where-Object { $_ -match ('^' + $key + '=') }).Count -eq 1) ('alone-run has exactly one ' + $key + ' line')
}
Assert-True (Test-Path $aloneOut) 'alone-run json written'
$aj = Get-Content $aloneOut -Raw | ConvertFrom-Json
Assert-Eq $aj.verdict.state 'unknown' 'alone-run json verdict is unknown'

# Catch-path (b): an unwritable -OutFile must still degrade cleanly - exit 0,
# stdout still carries only STATE=... KEY=VALUE lines (no stack trace line).
$badOutFile = 'Z:\nope\<>\x.json'
$badStdout = & powershell -NoProfile -ExecutionPolicy Bypass -File $detect -Config $cfgFile -BundleRoot $bundle -OutFile $badOutFile
Assert-Eq $LASTEXITCODE 0 'unwritable -OutFile still exits 0'
$badLines = @($badStdout | ForEach-Object { "$_" })
Assert-True (($badLines | Where-Object { $_ -notmatch '^[A-Z_]+=' }).Count -eq 0) 'unwritable -OutFile stdout carries ONLY KEY=VALUE lines'
Assert-True ($badLines -contains 'STATE=unknown') 'unwritable -OutFile falls back to STATE=unknown'

Write-Host ("detect.tests: " + $script:AssertCount + " assertions ok")

} finally {
    foreach ($f in $script:TestOutFiles) {
        try { if (Test-Path $f) { Remove-Item -Path $f -Force -ErrorAction SilentlyContinue } } catch { }
    }
    foreach ($d in $script:TestTempDirs) {
        try { if (Test-Path $d) { Remove-Item -Path $d -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
    }
}

exit 0
