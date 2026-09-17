# Static checks on Setup.bat (no cmd run, no elevation): encoding, labels,
# the situation gating order, and that every destructive call sits behind a
# Confirm-Destructive.ps1 red screen. KEEP PURE ASCII.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
. (Join-Path $here '_batch.ps1')
$bat = Join-Path $here '..\Setup.bat'

$lines = Read-BatchLines $bat 'Setup.bat'
Assert-True (($lines -join "`n") -match '(?im)^setlocal EnableExtensions EnableDelayedExpansion') 'delayed expansion is on'
Assert-BatchLabels $lines
Assert-NoBareBang $lines

# ---- detection + render at :menu -----------------------------------------------------
$menu = Get-LabelBody 'menu'
$iDet = IndexOf $menu 'Detect-SDP\.ps1'
$iShow = IndexOf $menu 'Show-Situation\.ps1'
Assert-True ($iDet -ge 0) 'menu runs Detect-SDP.ps1'
Assert-True ($iShow -gt $iDet) 'menu renders Show-Situation.ps1 after detection'
Assert-True ((IndexOf $menu 'NEED_DETECT%"=="1"') -ge 0 -and (IndexOf $menu 'NEED_DETECT%"=="1"') -lt $iDet) 'detection is gated on NEED_DETECT'
foreach ($k in @('STATE', 'RECOMMENDED', 'DOWNGRADE', 'DB_REACHABLE', 'HAS_SERVER', 'INSTALLED_VER', 'BUNDLE_VER')) {
    Assert-True ((IndexOf $menu ('"%%A"=="' + $k + '"')) -gt $iDet) ('menu reads ' + $k)
}

# ---- gating order: refusals before the first install dispatch -------------------------
$iPatch = IndexOf $menu 'goto patch\s*$'
Assert-True ($iPatch -gt 0) 'dispatch to :patch exists'
$gates = @('if "%KNOWNSTATE%"=="0" (', 'if "%DOWNGRADE%"=="1" (', 'if "%STATE%"=="empty" (', 'if "%STATE%"=="partial" (', 'if "%HAS_SERVER%"=="0" goto refuse_partial')
$prev = $iShow
foreach ($g in $gates) {
    $i = IndexOf $menu ([regex]::Escape($g))
    Assert-True ($i -gt $prev -and $i -lt $iPatch) ('gate in order before goto patch: ' + $g)
    $prev = $i
}
foreach ($k in @('1', '2', '3', '4')) {
    Assert-True ((IndexOf $menu ('"!CH!"=="' + $k + '" goto refuse_unknown')) -ge 0) ('unknown refuses ' + $k)
    Assert-True ((IndexOf $menu ('"!CH!"=="' + $k + '" goto refuse_downgrade')) -ge 0) ('downgrade refuses ' + $k)
}
Assert-True ((IndexOf $menu '"!CH!"=="D" goto refuse_unknown') -ge 0) 'unknown refuses D'
Assert-True ((IndexOf $menu '"!CH!"=="D" goto refuse_downgrade') -ge 0) 'downgrade refuses D'
foreach ($k in @('1', '2', '3')) { Assert-True ((IndexOf $menu ('"!CH!"=="' + $k + '" goto refuse_empty')) -ge 0) ('empty refuses ' + $k) }
foreach ($k in @('1', '2')) { Assert-True ((IndexOf $menu ('"!CH!"=="' + $k + '" goto refuse_partial')) -ge 0) ('partial refuses ' + $k) }
# every menu key Show-Situation renders is still dispatched
foreach ($k in @('1', '2', '3', '4', 'D', '5', '6', '7', '8', '9', 'E', 'C', '0')) {
    Assert-True ((IndexOf $menu ('"!CH!"=="' + $k + '" goto [a-z]+\s*$')) -ge 0) ('menu key dispatched: ' + $k)
}

# ---- the red-screen gate fails closed ------------------------------------------------
$cf = Get-LabelBody 'confirm'
Assert-True ($cf.Count -gt 0) ':confirm subroutine exists'
Assert-True ((IndexOf $cf '^set "CONFIRMED=0"') -eq 0) ':confirm starts from CONFIRMED=0'
$iMiss = IndexOf $cf '^if not exist "%HERE%\\Confirm-Destructive\.ps1" \($'
$iCall = IndexOf $cf 'Confirm-Destructive\.ps1" -Action %~1'
$iOk = IndexOf $cf '^if "!errorlevel!"=="0" set "CONFIRMED=1"$'
Assert-True ($iMiss -gt 0 -and $iMiss -lt $iCall) ':confirm refuses when the script is missing, before calling it'
Assert-True ((($cf[$iMiss..($iCall - 1)]) -join "`n") -match 'goto :eof') ':confirm leaves without confirming when the script is missing'
Assert-True ($iOk -gt $iCall) ':confirm sets CONFIRMED=1 only on exit code exactly 0, after the call'
Assert-Eq (@($lines | Where-Object { $_ -match 'set "CONFIRMED=1"' }).Count) 1 'CONFIRMED=1 is set in exactly one place'
foreach ($l in $lines) {
    if ($l -match '^\s*(rem\b|::)') { continue }
    Assert-True ($l -notmatch '(?i)\bif\s+(not\s+)?errorlevel\b') ('no "if errorlevel" anywhere (misses negative exit codes): ' + $l)
}
$confCallLines = @($lines | Where-Object { $_ -match 'Confirm-Destructive\.ps1" -Action' -and $_ -notmatch '^\s*rem\b' })
Assert-Eq $confCallLines.Count 2 'Confirm-Destructive.ps1 is only invoked inside :confirm (2 branches)'
foreach ($l in $confCallLines) { Assert-True ($cf -contains $l) ('Confirm-Destructive call lives in :confirm: ' + $l) }
Assert-True ((IndexOf $lines '^if not exist "%HERE%\\Confirm-Destructive\.ps1" \($') -ge 0) 'start-up warns when Confirm-Destructive.ps1 is missing'
Assert-True ((IndexOf $lines '^for %%F in \(Detect-SDP\.ps1 SdpSituation\.ps1 Show-Situation\.ps1\) do \($') -ge 0) 'start-up checks Detect / SdpSituation / Show-Situation'

# Each guarded call: "call :confirm <action>" then the CONFIRMED check on the next line.
function Assert-Guard($body, [string]$action, [string]$runPattern, [string]$what) {
    $iC = IndexOf $body ('^\s*call :confirm ' + [regex]::Escape($action) + '\s*$')
    $iR = IndexOf $body $runPattern
    Assert-True ($iC -ge 0) ($what + ': calls :confirm ' + $action)
    Assert-True ($body[$iC + 1] -match '^\s*if not "!CONFIRMED!"=="1" \($') ($what + ': CONFIRMED checked right after :confirm')
    Assert-True ($body[$iC + 2] -match 'Cancelled' -and $body[$iC + 3] -match '^\s*goto menu\s*$') ($what + ': not confirmed -> cancel + back to menu')
    Assert-True ($iR -gt $iC) ($what + ': destructive call only after the red screen')
    return $iC
}

$re = Get-LabelBody 'reinstall'
$iRun = IndexOf $re '%INSTALL%" -Reinstall'
$iConfRe = Assert-Guard $re 'reinstall' '%INSTALL%" -Reinstall' 'reinstall'
$iDrop = Assert-Guard $re 'dropdb' 'DROPFLAG=-ConfirmDataLoss' 'dropdb'
$iCdl = IndexOf $re 'DROPFLAG=-ConfirmDataLoss'
Assert-True ($iDrop -gt $iConfRe -and $iCdl -gt $iDrop -and $iCdl -lt $iRun) 'reinstall: -ConfirmDataLoss only set after the dropdb red screen'
Assert-True ((IndexOf $re 'DB_REACHABLE%"=="1"') -lt $iDrop) 'reinstall: drop only offered when the DB is reachable'
Assert-True ($re[$iRun] -match '!DROPFLAG!') 'reinstall: flag read with delayed expansion'
Assert-True (($re -join "`n") -notmatch '%DB%') 'reinstall: %DB% never read (set inside a block)'
foreach ($l in $lines) {
    if ($l -match '-ConfirmDataLoss' -and $l -notmatch '^\s*rem\b') {
        Assert-True ($l -match 'set "DROPFLAG=-ConfirmDataLoss"') ('-ConfirmDataLoss only appears as the guarded DROPFLAG: ' + $l)
    }
}

foreach ($pair in @(@('fresh', 'fresh-over-existing'), @('demo', 'demo-over-existing'))) {
    $lbl = $pair[0]
    $b = Get-LabelBody $lbl
    $iNot = IndexOf $b 'if not "%STATE%"=="empty"'
    $iConf = Assert-Guard $b $pair[1] 'FOFLAG=-ForceOverwrite' $lbl
    $iFo = IndexOf $b 'FOFLAG=-ForceOverwrite'
    $iInst = IndexOf $b '^%PS% "%INSTALL%" -Fresh'
    Assert-True ($iNot -ge 0 -and $iConf -gt $iNot -and $iFo -gt $iConf -and $iInst -gt $iFo) ($lbl + ': fresh-over-existing red screen (non-empty branch) before -ForceOverwrite and the install')
    Assert-True ($b[$iInst] -match '!FOFLAG!') ($lbl + ': flag read with delayed expansion')
    Assert-True (($b -join "`n") -notmatch '%FOFLAG%') ($lbl + ': %FOFLAG% never read')
}
foreach ($l in $lines) {
    if ($l -match '-ForceOverwrite' -and $l -notmatch '^\s*rem\b') {
        Assert-True ($l -match 'set "FOFLAG=-ForceOverwrite"') ('-ForceOverwrite only appears as the guarded FOFLAG: ' + $l)
    }
}
$dm = Get-LabelBody 'demo'
Assert-True ((IndexOf $dm 'HASDEMO%"=="0"') -lt (IndexOf $dm 'call :confirm')) 'demo: no-payload check first'
# the demo drops + replaces the database: never the "database is kept" screen of option 4
Assert-Eq (IndexOf $dm 'call :confirm fresh-over-existing') -1 'demo: never uses the fresh-over-existing red screen'
Assert-True ($dm[(IndexOf $dm '^%PS% "%INSTALL%" -Fresh')] -match '-Fresh -SeedData !FOFLAG!') 'demo: -Fresh -SeedData with the guarded flag'

# ---- scripts: always the bundle's; the installed config only as -Config -----------------
$rm = Get-LabelBody 'resolvemanage'
Assert-Eq (@($rm | Where-Object { $_ -match '^set "MANAGE=' }).Count) 1 ':resolvemanage sets MANAGE exactly once'
Assert-True ($rm -contains 'set "MANAGE=%HERE%\Manage-SDP.ps1"') ':resolvemanage always points at the bundle copy'
foreach ($l in $lines) {
    if ($l -match '^\s*rem\b') { continue }
    Assert-True ($l -notmatch '(?i)%APPDIR%\\tools\\installer\\[A-Za-z-]+\.ps1') ('no installed installer script is ever run: ' + $l)
}
$iCfg = IndexOf $lines '^if exist "%APPDIR%\\tools\\installer\\config\.psd1" set "INSTCFG=-Config "%APPDIR%\\tools\\installer\\config\.psd1""$'
Assert-True ($iCfg -ge 0 -and (IndexOf $lines '^set "INSTCFG="$') -eq ($iCfg - 1)) 'INSTCFG = -Config <installed config.psd1> only when that file exists'
$mgCalls = @($lines | Where-Object { $_ -match '^\s*%PS% "%MANAGE%"' })
Assert-Eq $mgCalls.Count 5 'five Manage-SDP calls (backup, list x2, restore, checkdb)'
foreach ($l in $mgCalls) { Assert-True ($l -match '%INSTCFG%\s*$') ('Manage-SDP call carries the installed config: ' + $l) }
Assert-True ($menu[$iDet] -match '%INSTCFG%') 'detection carries the installed config'
foreach ($l in @($lines | Where-Object { $_ -match '"%INSTALL%"' })) { Assert-True ($l -notmatch 'INSTCFG|-Config\b') ('Install-SDP never gets the installed config: ' + $l) }

$rp = Get-LabelBody 'restorept'
$iQuote = IndexOf $rp '^if not "!RPCHK!"=="!RP!" \($'
$iTgt = IndexOf $rp '^set "CONF_TARGET=!RP!"$'
$iConfRp = Assert-Guard $rp 'restore' '-Restore -Name "!RP!" -Force' 'restore'
Assert-True ($iQuote -ge 0 -and $iQuote -lt $iTgt -and $iTgt -eq $iConfRp - 1) 'restore: quote check, then the target, then the red screen'
Assert-True (($rp -join "`n") -notmatch '%RP%') 'restore: %RP% never read (operator-typed text)'
foreach ($l in $lines) {
    if ($l -match '-Restore\b' -and $l -notmatch '^\s*rem\b') { Assert-True ($l -match '-Restore -Name "!RP!" -Force') ('only one guarded restore call: ' + $l) }
}
# every destructive Install/Manage call in the file sits in one of the guarded labels above
$guarded = @($re) + @(Get-LabelBody 'fresh') + @($dm) + @($rp)
foreach ($l in $lines) {
    if ($l -match '^\s*rem\b') { continue }
    if ($l -match '"%INSTALL%" -(Reinstall|Fresh)\b|"%MANAGE%" -Restore\b') {
        Assert-True ($guarded -contains $l) ('destructive call is inside a guarded label: ' + $l)
    }
}

# ---- session log never embeds text in the PowerShell command line -------------------
$sl = (Get-LabelBody 'slog') -join "`n"
Assert-True ($sl -match '\$env:SLOG_MSG') ':slog reads the text from the environment'
Assert-True ($sl -notmatch "'%~1'") ':slog never embeds %~1 inside a quoted PowerShell string'

# ---- per-session situation file ----------------------------------------------------
$iSit = IndexOf $lines '^set "SITJSON=%TEMP%\\sdp-situation-%RANDOM%%RANDOM%\.json"$'
Assert-True ($iSit -ge 0) 'situation file name is per session'
$iDel = IndexOf $menu '^\s*del "%SITJSON%"'
Assert-True ($iDel -ge 0 -and $iDel -lt $iDet) 'the situation file is deleted before every detection'
foreach ($lbl in @('end', 'end_fail')) { Assert-True ((IndexOf (Get-LabelBody $lbl) '^del "%SITJSON%"') -ge 0) (':' + $lbl + ' deletes the situation file') }
$exitsAfter = @()
for ($i = $iSit + 1; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '(?i)^\s*(if .*\s)?exit /b') { $exitsAfter += $i } }
$endBody = @(Get-LabelBody 'end') + @(Get-LabelBody 'end_fail')
Assert-Eq $exitsAfter.Count 2 'only :end and :end_fail exit once the session has started'
foreach ($i in $exitsAfter) { Assert-True ($endBody -contains $lines[$i]) ('exit lives in :end / :end_fail: ' + $lines[$i]) }

# ---- re-detection after an action -----------------------------------------------------
$dn = Get-LabelBody 'done'
$iNd = IndexOf $dn 'set "NEED_DETECT=1"'
Assert-True ($iNd -ge 0 -and $iNd -lt (IndexOf $dn 'goto menu')) ':done sets NEED_DETECT=1 before goto menu'

Write-Host ("setup-static: " + $script:AssertCount + " assertions passed")
exit 0
