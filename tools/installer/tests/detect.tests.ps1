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
foreach ($key in @('STATE', 'RECOMMENDED', 'DOWNGRADE', 'DB_REACHABLE', 'HAS_SERVER', 'INSTALLED_VER', 'BUNDLE_VER', 'ERROR')) {
    Assert-True (($aloneLines | Where-Object { $_ -match ('^' + $key + '=') }).Count -eq 1) ('alone-run has exactly one ' + $key + ' line')
}
$aloneErrLine = @($aloneLines | Where-Object { $_ -match '^ERROR=' })[0]
Assert-True (-not [string]::IsNullOrEmpty(($aloneErrLine -replace '^ERROR=', ''))) 'alone-run ERROR= value is non-empty'
Assert-True (Test-Path $aloneOut) 'alone-run json written'
$aj = Get-Content $aloneOut -Raw | ConvertFrom-Json
Assert-Eq $aj.verdict.state 'unknown' 'alone-run json verdict is unknown'

# No -OutFile: no shared default file - STATE=unknown + ERROR, nothing written
# to the old shared %TEMP%\sdp-situation.json, never a prompt (stdin closed).
$sharedDefault = Join-Path $env:TEMP 'sdp-situation.json'
$sharedBefore = if (Test-Path $sharedDefault) { (Get-Item $sharedDefault).LastWriteTimeUtc } else { $null }
$noOutStdout = cmd /c ('powershell -NoProfile -ExecutionPolicy Bypass -File "' + $detect + '" -Config "' + $cfgFile + '" -BundleRoot "' + $bundle + '" < NUL')
Assert-Eq $LASTEXITCODE 0 'no -OutFile: exit 0'
$noOutLines = @($noOutStdout | ForEach-Object { "$_" })
Assert-True (($noOutLines | Where-Object { $_ -notmatch '^[A-Z_]+=' }).Count -eq 0) 'no -OutFile: only KEY=VALUE lines'
Assert-True ($noOutLines -contains 'STATE=unknown') 'no -OutFile: STATE=unknown'
Assert-True (@($noOutLines | Where-Object { $_ -match '^ERROR=.*-OutFile' }).Count -eq 1) 'no -OutFile: ERROR names -OutFile'
$sharedAfter = if (Test-Path $sharedDefault) { (Get-Item $sharedDefault).LastWriteTimeUtc } else { $null }
Assert-Eq $sharedAfter $sharedBefore 'no -OutFile: the old shared %TEMP%\sdp-situation.json is not written'

# Catch-path (b): an unwritable -OutFile must still degrade cleanly - exit 0,
# stdout still carries only STATE=... KEY=VALUE lines (no stack trace line).
$badOutFile = 'Z:\nope\<>\x.json'
$badStdout = & powershell -NoProfile -ExecutionPolicy Bypass -File $detect -Config $cfgFile -BundleRoot $bundle -OutFile $badOutFile
Assert-Eq $LASTEXITCODE 0 'unwritable -OutFile still exits 0'
$badLines = @($badStdout | ForEach-Object { "$_" })
Assert-True (($badLines | Where-Object { $_ -notmatch '^[A-Z_]+=' }).Count -eq 0) 'unwritable -OutFile stdout carries ONLY KEY=VALUE lines'
Assert-True ($badLines -contains 'STATE=unknown') 'unwritable -OutFile falls back to STATE=unknown'
$badErrLines = @($badLines | Where-Object { $_ -match '^ERROR=' })
Assert-True ($badErrLines.Count -eq 1) 'unwritable -OutFile has exactly one ERROR= line'
Assert-True (-not [string]::IsNullOrEmpty(($badErrLines[0] -replace '^ERROR=', ''))) 'unwritable -OutFile ERROR= value is non-empty'

# Newline-in-value: version.json carries a properly-escaped JSON `\n` inside
# the "version" string (the file literally contains the two characters
# backslash-n - ConvertFrom-Json decodes that escape into a real newline
# character in the parsed string). Without Write-Kv collapsing embedded
# newlines, INSTALLED_VER would split across two stdout lines and corrupt
# cmd's `for /f` KEY=VALUE parse.
$nlDir = New-TempDir 'sdp-detect-nl'; $script:TestTempDirs += $nlDir
Set-Content (Join-Path $nlDir 'server.js') '// app' -Encoding ascii
Set-Content -Path (Join-Path $nlDir 'version.json') -Value '{"version":"2.3\n1"}' -Encoding ascii
Set-Content (Join-Path $nlDir '.env') 'PG_URL=postgres://sdp_app:x@127.0.0.1:1/x' -Encoding ascii
$nlCfgDir = New-TempDir 'sdp-detect-nl-cfg'; $script:TestTempDirs += $nlCfgDir
$nlCfgFile = Join-Path $nlCfgDir 'config.nl.psd1'
Set-Content $nlCfgFile ("@{ InstallDir = '" + $nlDir + "'; ServiceName = 'sdp-nl-unit'; AppPort = 3498; BackupDir = '..\SDP-Backups-nl' }") -Encoding ascii
$nlOutFile = Join-Path $env:TEMP ('sdp-situation-nl-' + [guid]::NewGuid().ToString('N') + '.json'); $script:TestOutFiles += $nlOutFile
$nlStdout = & powershell -NoProfile -ExecutionPolicy Bypass -File $detect -Config $nlCfgFile -BundleRoot $bundle -OutFile $nlOutFile
Assert-Eq $LASTEXITCODE 0 'newline-in-version detect exits 0'
$nlLines = @($nlStdout | ForEach-Object { "$_" })
Assert-True (($nlLines | Where-Object { $_ -notmatch '^[A-Z_]+=' }).Count -eq 0) 'newline-in-version stdout carries ONLY KEY=VALUE lines'
Assert-True ((@($nlLines | Where-Object { $_ -match '^INSTALLED_VER=' })).Count -eq 1) 'newline-in-version has EXACTLY one INSTALLED_VER= line'

# Relative -Config fallback: Detect-SDP.ps1, SdpSituation.ps1 and a BASE
# config.psd1 (written by this test, NOT the real prod config.psd1) copied
# together into a fresh dir, then run with a RELATIVE -Config name pointing
# at a SEPARATE override file. Test-Path on the bare relative name fails from
# this test's own cwd, forcing the `Join-Path $here $Config` branch in
# Detect-SDP.ps1 - proving -Config resolves against the SCRIPT's own folder,
# not the caller's cwd. The base config's values deliberately differ from the
# override's so the assertion below proves the override actually wins.
$relDir = New-TempDir 'sdp-detect-relcfg'; $script:TestTempDirs += $relDir
Copy-Item -Path $detect -Destination (Join-Path $relDir 'Detect-SDP.ps1') -Force
Copy-Item -Path $situationScript -Destination (Join-Path $relDir 'SdpSituation.ps1') -Force
$relBaseInstallDir = New-TempDir 'sdp-detect-relcfg-base'; $script:TestTempDirs += $relBaseInstallDir
Set-Content (Join-Path $relDir 'config.psd1') ("@{ InstallDir = '" + $relBaseInstallDir + "'; ServiceName = 'sdp-base'; AppPort = 3497; BackupDir = '..\b' }") -Encoding ascii
$relInstallDir = New-TempDir 'sdp-detect-relcfg-install'; $script:TestTempDirs += $relInstallDir
$relCfgFile = Join-Path $relDir 'unit.psd1'
Set-Content $relCfgFile ("@{ InstallDir = '" + $relInstallDir + "'; ServiceName = 'sdp-unit'; AppPort = 3499; BackupDir = '..\SDP-Backups-unit' }") -Encoding ascii
$relOutFile = Join-Path $relDir 'out.json'; $script:TestOutFiles += $relOutFile
$relCopiedDetect = Join-Path $relDir 'Detect-SDP.ps1'
$relStdout = & powershell -NoProfile -ExecutionPolicy Bypass -File $relCopiedDetect -Config 'unit.psd1' -OutFile $relOutFile
Assert-Eq $LASTEXITCODE 0 'relative -Config fallback exits 0'
Assert-True (Test-Path $relOutFile) 'relative -Config fallback json written'
$relJson = Get-Content $relOutFile -Raw | ConvertFrom-Json
Assert-Eq $relJson.install.dir $relInstallDir 'relative -Config fallback resolved unit.psd1 next to the copied script (install.dir matches)'

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
