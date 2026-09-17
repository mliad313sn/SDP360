# Behavioural checks: runs the REAL Setup.bat (and _sdp_admin.cmd option 6)
# inside a temp sandbox where every PowerShell script it drives is a stub that
# records its command line. Proves the red screens fail CLOSED: only a confirm
# exit code of exactly 0 lets a destructive call through - a missing confirm
# script, exit 1 and a negative exit code all cancel. Stdin comes from a file
# (Start-Process -RedirectStandardInput), never a pipe. Nothing outside the
# sandbox is touched: InstallDir, ProgramData and TEMP all point inside it.
# KEEP PURE ASCII.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$srcSetup = Join-Path $here '..\Setup.bat'
$srcAdmin = Join-Path $here '..\..\..\_sdp_admin.cmd'
$script:TestTempDirs = @()
$realTemp = $env:TEMP
$savedEnv = @{}
foreach ($k in @('ProgramData', 'TEMP', 'TMP', 'SDP_SETUP_NOELEVATE', 'SDP_PROD_DIR', 'SDPT_STATE', 'SDPT_DBR', 'SDPT_HASSERVER', 'SDPT_CONFIRM_RC', 'SDPT_DETECT_NOFILE', 'SDPT_MARKS')) {
    $savedEnv[$k] = [Environment]::GetEnvironmentVariable($k, 'Process')
}

# ---- stubs --------------------------------------------------------------------------
# Every stub appends "<name>|<its command line after the script path>" to
# $env:SDPT_MARKS so the test can see exactly what ran, with which flags.
$markFn = @'
function Mark([string]$name, [string]$extra = '') {
    $cl = [Environment]::CommandLine
    $i = $cl.IndexOf('.ps1')
    $tail = if ($i -ge 0) { $cl.Substring($i + 4).Trim().TrimStart('"').Trim() } else { $cl }
    Add-Content -LiteralPath $env:SDPT_MARKS -Value ($name + '|' + $extra + ' ' + $tail) -Encoding ascii
}
'@
$stubDetect = "param([string]`$Config, [string]`$BundleRoot, [string]`$OutFile)`r`n" + $markFn + @'
Mark 'detect'
$st = $env:SDPT_STATE
$sit = @{ install = @{ dir = 'X'; has_server_js = ($env:SDPT_HASSERVER -eq '1') }; verdict = @{ state = $st }; db = @{ reachable = ($env:SDPT_DBR -eq '1') }; backups = @{ dir = 'X' } }
if ($env:SDPT_DETECT_NOFILE -ne '1') { ($sit | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $OutFile -Encoding ascii }
'STATE=' + $st
'RECOMMENDED=none'
'DOWNGRADE=0'
'DB_REACHABLE=' + $env:SDPT_DBR
'HAS_SERVER=' + $env:SDPT_HASSERVER
'INSTALLED_VER=1.0.0'
'BUNDLE_VER=1.0.0'
exit 0
'@
$stubShow = "param([string]`$Situation, [string]`$HasDemo)`r`n" + $markFn + @'
Mark 'show' ('exists=' + (Test-Path -LiteralPath $Situation))
Write-Host 'STUB-MENU'
exit 0
'@
$stubConfirm = $markFn + @'
Mark 'confirm'
exit ([int]$env:SDPT_CONFIRM_RC)
'@
$stubInstall = $markFn + @'
Mark 'install'
exit 0
'@
$stubManage = $markFn + @'
Mark 'manage'
exit 0
'@

function New-Sandbox([switch]$NoConfirm, [switch]$Demo) {
    $root = Join-Path $realTemp ('sdp-flow-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $script:TestTempDirs += $root
    $bundle = Join-Path $root 'bundle'; New-Item -ItemType Directory -Path $bundle -Force | Out-Null
    foreach ($d in @('app', 'pd', 'tmp')) { New-Item -ItemType Directory -Path (Join-Path $root $d) -Force | Out-Null }
    $enc = [Text.Encoding]::ASCII
    [IO.File]::WriteAllBytes((Join-Path $bundle 'Setup.bat'), [IO.File]::ReadAllBytes($srcSetup))
    [IO.File]::WriteAllText((Join-Path $bundle 'Detect-SDP.ps1'), $stubDetect, $enc)
    [IO.File]::WriteAllText((Join-Path $bundle 'Show-Situation.ps1'), $stubShow, $enc)
    [IO.File]::WriteAllText((Join-Path $bundle 'SdpSituation.ps1'), '# stub', $enc)
    if (-not $NoConfirm) { [IO.File]::WriteAllText((Join-Path $bundle 'Confirm-Destructive.ps1'), $stubConfirm, $enc) }
    [IO.File]::WriteAllText((Join-Path $bundle 'Install-SDP.ps1'), $stubInstall, $enc)
    [IO.File]::WriteAllText((Join-Path $bundle 'Manage-SDP.ps1'), $stubManage, $enc)
    if ($Demo) {
        New-Item -ItemType Directory -Path (Join-Path $bundle 'payload\demo') -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $bundle 'payload\demo\demo-data.zip'), 'stub', $enc)
    }
    $app = Join-Path $root 'app'
    [IO.File]::WriteAllText((Join-Path $bundle 'config.psd1'), ("@{ InstallDir = '" + $app + "'; ServiceName = 'sdp-flow-test'; AppPort = 59999; BackupDir = '..\bak' }"), $enc)
    return $root
}

# Runs a batch file in the sandbox with $inputLines as stdin (file redirect).
function Invoke-Sandbox([string]$root, [string]$batch, [string[]]$inputLines, [hashtable]$vars) {
    $env:ProgramData = Join-Path $root 'pd'
    $env:TEMP = Join-Path $root 'tmp'; $env:TMP = $env:TEMP
    $env:SDP_SETUP_NOELEVATE = '1'
    $env:SDPT_MARKS = Join-Path $root 'marks.txt'
    if (Test-Path $env:SDPT_MARKS) { Remove-Item $env:SDPT_MARKS -Force }
    foreach ($k in @('SDPT_STATE', 'SDPT_DBR', 'SDPT_HASSERVER', 'SDPT_CONFIRM_RC', 'SDPT_DETECT_NOFILE', 'SDP_PROD_DIR')) { [Environment]::SetEnvironmentVariable($k, $null, 'Process') }
    $env:SDPT_STATE = 'installed'; $env:SDPT_DBR = '0'; $env:SDPT_HASSERVER = '1'; $env:SDPT_CONFIRM_RC = '1'
    foreach ($k in $vars.Keys) { [Environment]::SetEnvironmentVariable($k, [string]$vars[$k], 'Process') }
    $in = Join-Path $root ('in-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.txt')
    [IO.File]::WriteAllText($in, (($inputLines -join "`r`n") + "`r`n"), [Text.Encoding]::ASCII)
    $out = Join-Path $root 'out.txt'; $err = Join-Path $root 'err.txt'
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', ('"' + $batch + '"')) -WorkingDirectory $root -NoNewWindow -Wait -PassThru `
        -RedirectStandardInput $in -RedirectStandardOutput $out -RedirectStandardError $err
    $marks = if (Test-Path $env:SDPT_MARKS) { @(Get-Content $env:SDPT_MARKS) } else { @() }
    return @{ Code = $p.ExitCode; Out = ((Get-Content $out -Raw) + (Get-Content $err -Raw)); Marks = $marks; Tmp = $env:TEMP; Log = (Join-Path $root 'pd\SDP-Dashboard\logs\setup-session.log') }
}
function Marks($r, [string]$name) { return , @($r.Marks | Where-Object { $_ -like ($name + '|*') }) }
function MarksWith($r, [string]$name, [string]$pattern) { return , @($r.Marks | Where-Object { $_ -like ($name + '|*') -and $_ -match $pattern }) }

try {
    $sb = New-Sandbox
    $setup = Join-Path $sb 'bundle\Setup.bat'
    $rp = 'sdp-restore_manual_20260713-120000.zip'

    # 3 - reinstall, confirm exit 1 -> nothing installed
    $r = Invoke-Sandbox $sb $setup @('3', '0') @{ SDPT_CONFIRM_RC = 1 }
    Assert-Eq $r.Code 0 'reinstall/rc1: Setup exits 0 via option 0'
    Assert-Eq (Marks $r 'confirm').Count 1 'reinstall/rc1: red screen shown'
    Assert-Eq (Marks $r 'install').Count 0 'reinstall/rc1: Install-SDP NOT run'
    Assert-True ($r.Out -match 'Cancelled - nothing changed') 'reinstall/rc1: cancel message'
    Assert-True ((Marks $r 'show')[0] -match 'exists=True') 'the menu renders from a fresh situation file'
    Assert-Eq (@(Get-ChildItem $r.Tmp -Filter 'sdp-situation-*.json' -ErrorAction SilentlyContinue).Count) 0 'situation file removed on exit'

    # 3 - reinstall, confirm exit 0, DB unreachable -> -Reinstall, no data loss flag
    $r = Invoke-Sandbox $sb $setup @('3', '0') @{ SDPT_CONFIRM_RC = 0; SDPT_DBR = 0 }
    $inst = Marks $r 'install'
    Assert-Eq $inst.Count 1 'reinstall/rc0: Install-SDP run once'
    Assert-True ($inst[0] -match '-Reinstall' -and $inst[0] -notmatch 'ConfirmDataLoss') 'reinstall/rc0: -Reinstall without -ConfirmDataLoss'
    Assert-Eq (Marks $r 'detect').Count 2 'reinstall/rc0: detection re-runs after the action'

    # 3 - reinstall + drop, both confirmed -> -ConfirmDataLoss
    $r = Invoke-Sandbox $sb $setup @('3', 'y', '0') @{ SDPT_CONFIRM_RC = 0; SDPT_DBR = 1 }
    Assert-Eq (Marks $r 'confirm').Count 2 'reinstall+drop: two red screens'
    Assert-True ((Marks $r 'install')[0] -match '-Reinstall -ConfirmDataLoss') 'reinstall+drop: -ConfirmDataLoss passed'
    Assert-True ((Marks $r 'confirm')[1] -match '-Action dropdb') 'reinstall+drop: second red screen is dropdb'

    # negative exit code (-1) -> not confirmed
    $r = Invoke-Sandbox $sb $setup @('3', '4', '6', $rp, '0') @{ SDPT_CONFIRM_RC = -1 }
    Assert-Eq (Marks $r 'confirm').Count 3 'rc-1: three red screens shown'
    Assert-Eq (Marks $r 'install').Count 0 'rc-1: nothing installed (3 and 4)'
    Assert-Eq (MarksWith $r 'manage' '-Restore').Count 0 'rc-1: nothing restored (6)'

    # any other non-zero code -> not confirmed
    $r = Invoke-Sandbox $sb $setup @('4', '0') @{ SDPT_CONFIRM_RC = 2 }
    Assert-Eq (Marks $r 'install').Count 0 'rc2: fresh-over-existing not run'

    # 6 - restore confirmed / cancelled
    $r = Invoke-Sandbox $sb $setup @('6', $rp, '0') @{ SDPT_CONFIRM_RC = 0 }
    $mg = (MarksWith $r 'manage' '-Restore')
    Assert-Eq $mg.Count 1 'restore/rc0: Manage-SDP -Restore run once'
    Assert-True ($mg[0] -match ('-Restore -Name "?' + [regex]::Escape($rp) + '"? -Force')) 'restore/rc0: -Restore -Name <rp> -Force'
    Assert-True ((Marks $r 'confirm')[0] -match ('-Action restore .*-Target "?' + [regex]::Escape($rp))) 'restore/rc0: red screen got the target'
    $r = Invoke-Sandbox $sb $setup @('6', $rp, '0') @{ SDPT_CONFIRM_RC = 1 }
    Assert-Eq (MarksWith $r 'manage' '-Restore').Count 0 'restore/rc1: nothing restored'
    Assert-Eq (MarksWith $r 'manage' '-List').Count 1 'restore/rc1: the list was still shown'

    # restore point names with quotes: a double quote is refused before any red screen,
    # a single quote goes through intact and cannot break the session log
    $r = Invoke-Sandbox $sb $setup @('6', 'bad"name -Force.zip', '0') @{ SDPT_CONFIRM_RC = 0 }
    Assert-Eq $r.Code 0 'quote in name: Setup does not crash'
    Assert-Eq (Marks $r 'confirm').Count 0 'quote in name: refused before the red screen'
    Assert-Eq (MarksWith $r 'manage' '-Restore').Count 0 'quote in name: nothing restored'
    Assert-True ($r.Out -match 'never contains a double quote') 'quote in name: refusal message'
    $apos = "it's');Remove-Item x;('_20260101-000000.zip"
    $r = Invoke-Sandbox $sb $setup @('6', $apos, '0') @{ SDPT_CONFIRM_RC = 0 }
    Assert-Eq $r.Code 0 'apostrophe in name: Setup does not crash'
    $mg = (MarksWith $r 'manage' '-Restore')
    Assert-True ($mg.Count -eq 1 -and $mg[0].Contains($apos)) 'apostrophe in name: passed through verbatim'
    Assert-True ((Get-Content $r.Log -Raw).Contains('Restore ' + $apos)) 'apostrophe in name: logged verbatim (no injection)'

    # a typed double quote at the menu prompt does not abort the batch
    $r = Invoke-Sandbox $sb $setup @('"', '0') @{}
    Assert-Eq $r.Code 0 'quote at the menu: Setup still reaches option 0'
    Assert-True ($r.Out -match 'Invalid choice') 'quote at the menu: invalid choice message'

    # empty state + 4 -> fresh install, no red screen
    $r = Invoke-Sandbox $sb $setup @('4', '0') @{ SDPT_STATE = 'empty'; SDPT_HASSERVER = 0; SDPT_CONFIRM_RC = 1 }
    Assert-Eq (Marks $r 'confirm').Count 0 'empty/4: no red screen'
    $inst = Marks $r 'install'
    Assert-True ($inst.Count -eq 1 -and $inst[0] -match '-Fresh' -and $inst[0] -notmatch 'ForceOverwrite') 'empty/4: -Fresh without -ForceOverwrite'

    # closed stdin -> exit 1 via :end_fail, situation file cleaned
    $r = Invoke-Sandbox $sb $setup @() @{}
    Assert-Eq $r.Code 1 'closed stdin: exit 1'
    Assert-Eq (@(Get-ChildItem $r.Tmp -Filter 'sdp-situation-*.json' -ErrorAction SilentlyContinue).Count) 0 'closed stdin: situation file removed'

    # detection that writes no file -> the menu is rendered without stale data
    $r = Invoke-Sandbox $sb $setup @('0') @{ SDPT_DETECT_NOFILE = 1 }
    Assert-True ((Marks $r 'show')[0] -match 'exists=False') 'no situation file: nothing stale is shown'

    # confirm script MISSING -> every destructive action refuses, the rest still works
    $sb2 = New-Sandbox -NoConfirm
    $setup2 = Join-Path $sb2 'bundle\Setup.bat'
    $r = Invoke-Sandbox $sb2 $setup2 @('3', '4', '6', $rp, '7', '0') @{ SDPT_CONFIRM_RC = 0 }
    Assert-Eq $r.Code 0 'missing confirm: Setup still runs'
    Assert-True ($r.Out -match 'Confirm-Destructive\.ps1 not found') 'missing confirm: start-up warning'
    Assert-Eq (Marks $r 'install').Count 0 'missing confirm: nothing installed (3, 4)'
    Assert-Eq (MarksWith $r 'manage' '-Restore').Count 0 'missing confirm: nothing restored (6)'
    Assert-Eq (MarksWith $r 'manage' '-List').Count 2 'missing confirm: listing still works (6 + 7)'
    Assert-True (([regex]::Matches($r.Out, 'destructive actions are disabled')).Count -eq 3) 'missing confirm: each destructive action explains why'

    # a missing detection script stops Setup before the menu
    Remove-Item (Join-Path $sb2 'bundle\Detect-SDP.ps1') -Force
    $r = Invoke-Sandbox $sb2 $setup2 @('0') @{}
    Assert-Eq $r.Code 1 'missing Detect-SDP.ps1: exit 1'
    Assert-True ($r.Out -match 'Detect-SDP\.ps1 not found') 'missing Detect-SDP.ps1: error message'
    Assert-Eq $r.Marks.Count 0 'missing Detect-SDP.ps1: nothing run'

    # ---- D (demo) over an existing install: its OWN red screen -------------------------
    $sd = New-Sandbox -Demo
    $setupD = Join-Path $sd 'bundle\Setup.bat'
    $r = Invoke-Sandbox $sd $setupD @('D', '0') @{ SDPT_CONFIRM_RC = 0 }
    $cf = Marks $r 'confirm'
    Assert-Eq $cf.Count 1 'demo/rc0: one red screen'
    Assert-True ($cf[0] -match '-Action demo-over-existing') 'demo/rc0: the red screen is demo-over-existing'
    $inst = Marks $r 'install'
    Assert-True ($inst.Count -eq 1 -and $inst[0] -match '-Fresh -SeedData -ForceOverwrite') 'demo/rc0: -Fresh -SeedData -ForceOverwrite'
    foreach ($rc in @(1, -1)) {
        $r = Invoke-Sandbox $sd $setupD @('D', '0') @{ SDPT_CONFIRM_RC = $rc }
        Assert-True ((Marks $r 'confirm')[0] -match '-Action demo-over-existing') ('demo/rc' + $rc + ': demo red screen shown')
        Assert-Eq (Marks $r 'install').Count 0 ('demo/rc' + $rc + ': nothing installed')
    }
    $r = Invoke-Sandbox $sd $setupD @('D', '0') @{ SDPT_STATE = 'empty'; SDPT_HASSERVER = 0; SDPT_CONFIRM_RC = 1 }
    Assert-Eq (Marks $r 'confirm').Count 0 'demo/empty: no red screen'
    $inst = Marks $r 'install'
    Assert-True ($inst.Count -eq 1 -and $inst[0] -match '-Fresh -SeedData' -and $inst[0] -notmatch 'ForceOverwrite') 'demo/empty: -Fresh -SeedData without -ForceOverwrite'

    # ---- maintenance runs the BUNDLE's Manage-SDP, never an installed (older) copy --------
    $sm = New-Sandbox
    $setupM = Join-Path $sm 'bundle\Setup.bat'
    $instDir = Join-Path $sm 'app\tools\installer'
    New-Item -ItemType Directory -Path $instDir -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $instDir 'Manage-SDP.ps1'), ($markFn + "`r`nMark 'imanage'`r`nexit 0`r`n"), [Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $instDir 'Detect-SDP.ps1'), ($markFn + "`r`nMark 'idetect'`r`nexit 0`r`n"), [Text.Encoding]::ASCII)
    $r = Invoke-Sandbox $sm $setupM @('5', '7', 'C', '0') @{}
    Assert-Eq (Marks $r 'imanage').Count 0 'no installed config: the installed Manage-SDP is never run'
    Assert-Eq (Marks $r 'manage').Count 3 'no installed config: the bundle Manage-SDP runs (5, 7, C)'
    Assert-Eq (MarksWith $r 'manage' '-Config').Count 0 'no installed config: no -Config passed'
    $instCfg = Join-Path $instDir 'config.psd1'
    [IO.File]::WriteAllText($instCfg, "@{ BackupDir = '..\bak2' }", [Text.Encoding]::ASCII)
    $r = Invoke-Sandbox $sm $setupM @('5', '6', $rp, '7', 'C', '0') @{ SDPT_CONFIRM_RC = 0 }
    Assert-Eq (Marks $r 'imanage').Count 0 'installed config: the installed Manage-SDP is still never run'
    Assert-Eq (Marks $r 'idetect').Count 0 'installed config: the installed Detect-SDP is never run'
    $mg = Marks $r 'manage'
    Assert-Eq $mg.Count 5 'installed config: bundle Manage-SDP runs 5 times (backup, list, restore, list, checkdb)'
    $cfgRx = '-Config "?' + [regex]::Escape($instCfg) + '"?\s*$'
    foreach ($m in $mg) { Assert-True ($m -match $cfgRx) ('installed config passed as -Config: ' + $m) }
    Assert-True ((MarksWith $r 'manage' '-Restore -Name "?[^"]+"? -Force -Config').Count -eq 1) 'installed config: the restore call carries -Config after -Force'
    Assert-True ((Marks $r 'detect')[0] -match $cfgRx) 'installed config: detection gets it too'
    Assert-Eq (MarksWith $r 'install' '-Config').Count 0 'installed config: never passed to Install-SDP'
    $r = Invoke-Sandbox $sm $setupM @('1', '0') @{}
    Assert-True ((Marks $r 'install').Count -eq 1 -and (MarksWith $r 'install' '-Config').Count -eq 0) 'installed config: patch runs the bundle Install-SDP without -Config'

    # ---- _sdp_admin.cmd option 6 ---------------------------------------------------
    $sa = New-Sandbox
    $inst = Join-Path $sa 'app\tools\installer'
    New-Item -ItemType Directory -Path $inst -Force | Out-Null
    foreach ($f in @('Detect-SDP.ps1', 'SdpSituation.ps1', 'Confirm-Destructive.ps1', 'Manage-SDP.ps1')) { Copy-Item (Join-Path $sa ('bundle\' + $f)) $inst }
    $admin = Join-Path $sa 'app\_sdp_admin.cmd'
    [IO.File]::WriteAllBytes($admin, [IO.File]::ReadAllBytes($srcAdmin))
    $av = @{ SDP_PROD_DIR = (Join-Path $sa 'app') }

    $r = Invoke-Sandbox $sa $admin @('6', $rp, '0') ($av + @{ SDPT_CONFIRM_RC = 0 })
    $mg = (MarksWith $r 'manage' '-Restore')
    Assert-True ($mg.Count -eq 1 -and $mg[0] -match '-Force') 'admin/rc0: restore runs'
    Assert-Eq (@(Get-ChildItem $r.Tmp -Filter 'sdp-admin-situation-*.json' -ErrorAction SilentlyContinue).Count) 0 'admin: situation file removed'
    foreach ($rc in @(1, -1)) {
        $r = Invoke-Sandbox $sa $admin @('6', $rp, '0') ($av + @{ SDPT_CONFIRM_RC = $rc })
        Assert-Eq (Marks $r 'confirm').Count 1 ('admin/rc' + $rc + ': red screen shown')
        Assert-Eq (MarksWith $r 'manage' '-Restore').Count 0 ('admin/rc' + $rc + ': nothing restored')
    }
    $r = Invoke-Sandbox $sa $admin @('6', $rp, '0') ($av + @{ SDPT_CONFIRM_RC = 0; SDPT_DETECT_NOFILE = 1 })
    Assert-Eq (Marks $r 'confirm').Count 0 'admin/no situation file: no red screen'
    Assert-Eq (MarksWith $r 'manage' '-Restore').Count 0 'admin/no situation file: nothing restored'
    Assert-True ($r.Out -match 'detection wrote no situation file') 'admin/no situation file: error message'
    $r = Invoke-Sandbox $sa $admin @('6', 'x"y.zip', '0') ($av + @{ SDPT_CONFIRM_RC = 0 })
    Assert-Eq (Marks $r 'confirm').Count 0 'admin/quote in name: refused before the red screen'
    Remove-Item (Join-Path $inst 'Confirm-Destructive.ps1') -Force
    $r = Invoke-Sandbox $sa $admin @('6', $rp, '0') ($av + @{ SDPT_CONFIRM_RC = 0 })
    Assert-Eq (MarksWith $r 'manage' '-Restore').Count 0 'admin/missing confirm: nothing restored'
    Assert-True ($r.Out -match 'Confirm-Destructive\.ps1 missing') 'admin/missing confirm: error message'

    Write-Host ("setup-flow: " + $script:AssertCount + " assertions passed")
} finally {
    foreach ($k in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($k, $savedEnv[$k], 'Process') }
    foreach ($d in $script:TestTempDirs) {
        try { if (Test-Path $d) { Remove-Item -Path $d -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
    }
}
exit 0
