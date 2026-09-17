# Static checks on the app-root _sdp_admin.cmd (no cmd run): encoding, labels,
# and that option 6 (restore) goes through the same Confirm-Destructive.ps1
# red screen as Setup.bat before Manage-SDP -Restore -Force. KEEP PURE ASCII.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$cmdFile = Join-Path $here '..\..\..\_sdp_admin.cmd'
Assert-True (Test-Path $cmdFile) '_sdp_admin.cmd found at the repo root'

$bytes = [IO.File]::ReadAllBytes($cmdFile)
Assert-Eq (@($bytes | Where-Object { $_ -gt 127 }).Count) 0 '_sdp_admin.cmd is pure ASCII'
$text = [Text.Encoding]::ASCII.GetString($bytes)
Assert-Eq ([regex]::Matches($text, "(?<!`r)`n").Count) 0 '_sdp_admin.cmd has CRLF line endings only'
$lines = $text -split "`r`n"

# ---- labels ---------------------------------------------------------------------
$labels = @{}
foreach ($l in $lines) { if ($l -match '^\s*:([A-Za-z_][A-Za-z0-9_]*)\s*$') { $labels[$Matches[1].ToLower()] = $true } }
foreach ($l in $lines) {
    if ($l -match '^\s*(rem\b|::)') { continue }
    foreach ($m in [regex]::Matches($l, '(?i)\bgoto\s+:?([A-Za-z_][A-Za-z0-9_]*)')) {
        $n = $m.Groups[1].Value.ToLower(); if ($n -eq 'eof') { continue }
        Assert-True $labels.ContainsKey($n) ("goto target exists: " + $n)
    }
    foreach ($m in [regex]::Matches($l, '(?i)\bcall\s+:([A-Za-z_][A-Za-z0-9_]*)')) {
        Assert-True $labels.ContainsKey($m.Groups[1].Value.ToLower()) ("call target exists: " + $m.Groups[1].Value)
    }
}

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

# ---- :restore -------------------------------------------------------------------
$rs = Get-LabelBody 'restore'
Assert-True ($rs.Count -gt 0) ':restore label has a body'
$iAsk = IndexOf $rs '^set /p RP='
$iEmpty = IndexOf $rs '^if not defined RP \($'
$iMissing = IndexOf $rs '^if not exist "%INST%\\Confirm-Destructive\.ps1" \($'
$iDetect = IndexOf $rs 'Detect-SDP\.ps1" -BundleRoot "%INST%" -OutFile "%SIT%"'
$iConf = IndexOf $rs 'Confirm-Destructive\.ps1" -Action restore -Situation "%SIT%" -Target "%RP%"'
$iErr = IndexOf $rs '^if errorlevel 1 \($'
$iRest = IndexOf $rs 'Manage-SDP\.ps1" -Restore -Name "%RP%" -Force'
Assert-True ($iAsk -ge 0) 'restore asks for the restore point name'
Assert-True ($iEmpty -gt $iAsk) 'empty name check comes after the prompt'
Assert-True ($rs[$iEmpty + 1] -match '^\s*echo Cancelled\.' -and $rs[$iEmpty + 2] -match '^\s*exit /b') 'empty name cancels without running anything'
Assert-True ($iMissing -gt $iEmpty) 'missing Confirm-Destructive.ps1 check comes next'
Assert-True ($rs[$iMissing + 1] -match '^\s*echo ERROR:' -and $rs[$iMissing + 2] -match '^\s*exit /b 1') 'missing Confirm-Destructive.ps1 -> ERROR + exit 1'
Assert-True ($iDetect -gt $iMissing) 'detection runs after the guards'
Assert-True ($iConf -gt $iDetect) 'red screen runs after detection'
Assert-True ($iErr -eq $iConf + 1) 'errorlevel checked right after the red screen'
Assert-True ($rs[$iErr + 2] -match '^\s*exit /b 1') 'a cancelled red screen leaves before the restore'
Assert-True ($iRest -gt $iErr) 'Manage-SDP -Restore -Force only after the red screen'

# the ONLY -Restore call in the whole file is the guarded one
foreach ($l in $lines) {
    if ($l -match '-Restore\b' -and $l -notmatch '^\s*(rem\b|::)') {
        Assert-True ($l -match 'Manage-SDP\.ps1" -Restore -Name "%RP%" -Force') ('only one guarded restore call: ' + $l)
    }
}
# option 6 still dispatches to :restore
Assert-True ((IndexOf (Get-LabelBody 'menu') '"%CH%"=="6" \( call :restore \)') -ge 0) 'menu option 6 calls :restore'

Write-Host ("admin-static: " + $script:AssertCount + " assertions passed")
exit 0
