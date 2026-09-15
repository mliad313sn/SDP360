$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$detect = Join-Path $here '..\Detect-SDP.ps1'

$inst = New-TempDir 'sdp-inst'
Set-Content (Join-Path $inst 'server.js') '// app' -Encoding ascii
Set-Content (Join-Path $inst 'version.json') '{"version":"2.3.1"}' -Encoding ascii
Set-Content (Join-Path $inst '.env') 'PG_URL=postgres://sdp_app:x@127.0.0.1:1/x' -Encoding ascii
$bundle = New-TempDir 'sdp-bundle'
Set-Content (Join-Path $bundle 'version.json') '{"version":"2.4.0"}' -Encoding ascii
$cfgFile = Join-Path (New-TempDir 'sdp-cfg') 'config.unit.psd1'
Set-Content $cfgFile ("@{ InstallDir = '" + $inst + "'; ServiceName = 'sdp-unit'; AppPort = 3499; BackupDir = '..\SDP-Backups-unit' }") -Encoding ascii
$outFile = Join-Path $env:TEMP ('sdp-situation-test-' + [guid]::NewGuid().ToString('N') + '.json')

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
$situationScript = Join-Path $here '..\SdpSituation.ps1'
$wrapperDir = New-TempDir 'sdp-detect-wrapper'
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

Write-Host ("detect.tests: " + $script:AssertCount + " assertions ok")
exit 0
