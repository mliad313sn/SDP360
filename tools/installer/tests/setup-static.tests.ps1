# Static checks on Setup.bat (no cmd run, no elevation): encoding, labels,
# the situation gating order, and that every destructive call sits behind a
# Confirm-Destructive.ps1 red screen. KEEP PURE ASCII.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$bat = Join-Path $here '..\Setup.bat'

$bytes = [IO.File]::ReadAllBytes($bat)
Assert-Eq (@($bytes | Where-Object { $_ -gt 127 }).Count) 0 'Setup.bat is pure ASCII'
$text = [Text.Encoding]::ASCII.GetString($bytes)
Assert-Eq ([regex]::Matches($text, "(?<!`r)`n").Count) 0 'Setup.bat has CRLF line endings only'
Assert-True ($text -match '(?im)^setlocal EnableExtensions EnableDelayedExpansion') 'delayed expansion is on'

$lines = $text -split "`r`n"
# ---- labels ---------------------------------------------------------------------
$labels = @{}
foreach ($l in $lines) { if ($l -match '^\s*:([A-Za-z_][A-Za-z0-9_]*)\s*$') { $labels[$Matches[1].ToLower()] = $true } }
foreach ($l in $lines) {
    if ($l -match '^\s*rem\b') { continue }
    foreach ($m in [regex]::Matches($l, '(?i)\bgoto\s+:?([A-Za-z_][A-Za-z0-9_]*)')) {
        $n = $m.Groups[1].Value.ToLower(); if ($n -eq 'eof') { continue }
        Assert-True $labels.ContainsKey($n) ("goto target exists: " + $n)
    }
    foreach ($m in [regex]::Matches($l, '(?i)\bcall\s+:([A-Za-z_][A-Za-z0-9_]*)')) {
        Assert-True $labels.ContainsKey($m.Groups[1].Value.ToLower()) ("call target exists: " + $m.Groups[1].Value)
    }
}

# ---- no literal ! in echo (delayed expansion would eat it) ---------------------------
foreach ($l in $lines) {
    if ($l -match '^\s*echo\b' -and $l -match '!') {
        Assert-True ($l -match '![A-Za-z_]+!') ('echo with a bare exclamation mark: ' + $l)
    }
}

# ---- body of a label (up to the next label) ----------------------------------------
function Get-LabelBody([string]$name) {
    $out = @(); $in = $false
    foreach ($l in $lines) {
        if ($l -match '^\s*:([A-Za-z_][A-Za-z0-9_]*)\s*$') {
            if ($in) { break }
            if ($Matches[1] -ieq $name) { $in = $true; continue }
        }
        if ($in) { $out += $l }
    }
    return $out
}
function IndexOf($arr, [string]$pattern) { for ($i = 0; $i -lt $arr.Count; $i++) { if ($arr[$i] -match $pattern) { return $i } }; return -1 }

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
    Assert-True ((IndexOf $menu ('"%CH%"=="' + $k + '" goto refuse_unknown')) -ge 0) ('unknown refuses ' + $k)
    Assert-True ((IndexOf $menu ('"%CH%"=="' + $k + '" goto refuse_downgrade')) -ge 0) ('downgrade refuses ' + $k)
}
Assert-True ((IndexOf $menu '"%CH%"=="D" goto refuse_unknown') -ge 0) 'unknown refuses D'
Assert-True ((IndexOf $menu '"%CH%"=="D" goto refuse_downgrade') -ge 0) 'downgrade refuses D'
foreach ($k in @('1', '2', '3')) { Assert-True ((IndexOf $menu ('"%CH%"=="' + $k + '" goto refuse_empty')) -ge 0) ('empty refuses ' + $k) }
foreach ($k in @('1', '2')) { Assert-True ((IndexOf $menu ('"%CH%"=="' + $k + '" goto refuse_partial')) -ge 0) ('partial refuses ' + $k) }
# every menu key Show-Situation renders is still dispatched
foreach ($k in @('1', '2', '3', '4', 'D', '5', '6', '7', '8', '9', 'E', 'C', '0')) {
    Assert-True ((IndexOf $menu ('"%CH%"=="' + $k + '" goto [a-z]+\s*$')) -ge 0) ('menu key dispatched: ' + $k)
}

# ---- destructive calls are behind a red screen ---------------------------------------
$re = Get-LabelBody 'reinstall'
$iConfRe = IndexOf $re 'Confirm-Destructive\.ps1" -Action reinstall'
$iRun = IndexOf $re '%INSTALL%" -Reinstall'
Assert-True ($iConfRe -ge 0 -and $iRun -gt $iConfRe) 'reinstall: REINSTALL red screen before Install-SDP -Reinstall'
$iDrop = IndexOf $re 'Confirm-Destructive\.ps1" -Action dropdb'
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

foreach ($lbl in @('fresh', 'demo')) {
    $b = Get-LabelBody $lbl
    $iNot = IndexOf $b 'if not "%STATE%"=="empty"'
    $iConf = IndexOf $b 'Confirm-Destructive\.ps1" -Action fresh-over-existing'
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
Assert-True ((IndexOf $dm 'HASDEMO%"=="0"') -lt (IndexOf $dm 'Confirm-Destructive')) 'demo: no-payload check first'

$rp = Get-LabelBody 'restorept'
$iConfRp = IndexOf $rp 'Confirm-Destructive\.ps1" -Action restore -Situation "%SITJSON%" -Target "%RP%"'
$iRest = IndexOf $rp '-Restore -Name "%RP%" -Force'
Assert-True ($iConfRp -ge 0 -and $iRest -gt $iConfRp) 'restore: red screen before Manage-SDP -Restore -Force'
foreach ($l in $lines) {
    if ($l -match '-Restore\b' -and $l -notmatch '^\s*rem\b') { Assert-True ($l -match '-Restore -Name "%RP%" -Force') ('only one guarded restore call: ' + $l) }
}

# ---- re-detection after an action -----------------------------------------------------
$dn = Get-LabelBody 'done'
$iNd = IndexOf $dn 'set "NEED_DETECT=1"'
Assert-True ($iNd -ge 0 -and $iNd -lt (IndexOf $dn 'goto menu')) ':done sets NEED_DETECT=1 before goto menu'

Write-Host ("setup-static: " + $script:AssertCount + " assertions passed")
exit 0
