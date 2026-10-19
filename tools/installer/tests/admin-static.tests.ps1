# Static checks on the app-root _sdp_admin.cmd (no cmd run): encoding, labels,
# and that option 6 (restore) goes through the same Confirm-Destructive.ps1
# red screen as Setup.bat before Manage-SDP -Restore -Force, failing closed on
# any non-zero exit code. KEEP PURE ASCII.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
. (Join-Path $here '_batch.ps1')
$cmdFile = Join-Path $here '..\..\..\_sdp_admin.cmd'
Assert-True (Test-Path $cmdFile) '_sdp_admin.cmd found at the repo root'

$lines = Read-BatchLines $cmdFile '_sdp_admin.cmd'
Assert-True (($lines -join "`n") -match '(?im)^setlocal enabledelayedexpansion') 'delayed expansion is on'
Assert-BatchLabels $lines
Assert-NoBareBang $lines

# ---- :restore -------------------------------------------------------------------
$rs = Get-LabelBody 'restore'
Assert-True ($rs.Count -gt 0) ':restore label has a body'
$iAsk = IndexOf $rs '^set /p RP='
$iEmpty = IndexOf $rs '^if not defined RP \($'
$iQuote = IndexOf $rs '^if not "!RPCHK!"=="!RP!" \($'
$iMissing = IndexOf $rs '^if defined MISSING \($'
$iDel = IndexOf $rs '^del "%SIT%"'
$iDetect = IndexOf $rs 'Detect-SDP\.ps1" -BundleRoot "%INST%" -OutFile "%SIT%"'
$iDetRc = IndexOf $rs '^if not "!DETRC!"=="0" \($'
$iNoSit = IndexOf $rs '^if not exist "%SIT%" \($'
$iConf = IndexOf $rs 'Confirm-Destructive\.ps1" -Action restore -Situation "%SIT%" -Target "!RP!"'
$iRest = IndexOf $rs 'Manage-SDP\.ps1" -Restore -Name "!RP!" -Force'
Assert-True ($iAsk -ge 0) 'restore asks for the restore point name'
Assert-True ($iEmpty -gt $iAsk) 'empty name check comes after the prompt'
Assert-True ($rs[$iEmpty + 1] -match '^\s*echo Cancelled\.' -and $rs[$iEmpty + 2] -match '^\s*exit /b') 'empty name cancels without running anything'
Assert-True ($iQuote -gt $iEmpty -and $rs[$iQuote + 2] -match '^\s*exit /b 1') 'a name with a double quote is refused'
foreach ($f in @('Confirm-Destructive.ps1', 'Detect-SDP.ps1', 'SdpSituation.ps1', 'Manage-SDP.ps1')) {
    Assert-True ((IndexOf $rs ('^if not exist "%INST%\\' + [regex]::Escape($f) + '" set "MISSING=')) -ge 0) ('restore checks ' + $f + ' exists')
}
Assert-True ($iMissing -gt $iQuote -and $rs[$iMissing + 1] -match '^\s*echo ERROR:' -and $rs[$iMissing + 2] -match '^\s*exit /b 1') 'a missing script -> ERROR + exit 1'
Assert-True ((IndexOf $rs '^set "SIT=%TEMP%\\sdp-admin-situation-%RANDOM%%RANDOM%\.json"$') -gt $iMissing) 'per-session situation file'
Assert-True ($iDel -gt $iMissing -and $iDetect -eq $iDel + 1) 'the situation file is deleted right before detection'
Assert-True ($iDetRc -gt $iDetect -and $iNoSit -gt $iDetRc -and $iConf -gt $iNoSit) 'detection failure and a missing situation file both stop before the red screen'
Assert-True ($rs[$iConf + 1] -match '^set "CONFRC=!errorlevel!"$') 'red screen exit code captured right after the call'
$iCk = IndexOf $rs '^if not "!CONFRC!"=="0" \($'
Assert-True ($iCk -gt $iConf -and $rs[$iCk + 2] -match '^\s*exit /b 1') 'anything but exit code 0 cancels before the restore'
Assert-True ($iRest -gt $iCk) 'Manage-SDP -Restore -Force only after the red screen'
Assert-True (($rs -join "`n") -notmatch '%RP%') 'restore: %RP% never read (operator-typed text)'
foreach ($l in $lines) {
    if ($l -match '^\s*(rem\b|::)') { continue }
    Assert-True ($l -notmatch '(?i)\bif\s+(not\s+)?errorlevel\b' -or $l -notmatch 'Confirm|CONF') ('no "if errorlevel" on a red screen: ' + $l)
}
Assert-True ($rs[$iConf + 1] -notmatch 'errorlevel 1') 'the red screen is never tested with "if errorlevel 1"'

# the ONLY -Restore call in the whole file is the guarded one
foreach ($l in $lines) {
    if ($l -match '-Restore\b' -and $l -notmatch '^\s*(rem\b|::)') {
        Assert-True ($l -match 'Manage-SDP\.ps1" -Restore -Name "!RP!" -Force') ('only one guarded restore call: ' + $l)
    }
}
# the listing uses Manage-SDP -List (same backup folder as the restore)
Assert-True ((IndexOf (Get-LabelBody 'listbak') 'Manage-SDP\.ps1" -List') -ge 0) 'restore points are listed via Manage-SDP -List'
# option 6 still dispatches to :restore
Assert-True ((IndexOf (Get-LabelBody 'menu') '"!CH!"=="6" \( call :restore \)') -ge 0) 'menu option 6 calls :restore'

Write-Host ("admin-static: " + $script:AssertCount + " assertions passed")
exit 0
