# Static checks on Install-SDP.ps1 that do not require running the real
# installer (admin rights, a live PostgreSQL, a bundle) - parses the file with
# the PowerShell AST and inspects specific function bodies / lines as text.
# KEEP PURE ASCII.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$installPath = Join-Path $here '..\Install-SDP.ps1'

$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installPath, [ref]$tokens, [ref]$errors)
Assert-Eq (@($errors).Count) 0 'Install-SDP.ps1 parses with zero syntax errors'

function Get-FunctionText($astRoot, [string]$name) {
    $fn = $astRoot.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true) |
          Select-Object -First 1
    if (-not $fn) { return $null }
    return $fn.Extent.Text
}

$raw = Get-Content $installPath -Raw

# (a) Invoke-PsqlSuperStdin is defined, and the CREATE ROLE statement (which
# carries a password) is passed ONLY to it - never to the -c fallback
# (Invoke-PsqlSuper), which would put the password on the command line.
$stdinFn = Get-FunctionText $ast 'Invoke-PsqlSuperStdin'
Assert-True ($stdinFn -ne $null) 'Invoke-PsqlSuperStdin is defined'
Assert-True ($stdinFn -like '*-f -*') 'Invoke-PsqlSuperStdin feeds SQL via psql -f - (stdin), not -c'

$createRoleLines = @(($raw -split "`r?`n") | Where-Object { $_ -like '*CREATE ROLE sdp_app LOGIN PASSWORD*' })
Assert-Eq $createRoleLines.Count 1 'exactly one CREATE ROLE sdp_app statement in the file'
Assert-True ($createRoleLines[0] -like '*Invoke-PsqlSuperStdin (*') 'the CREATE ROLE statement goes through Invoke-PsqlSuperStdin'
Assert-True (-not ($createRoleLines[0] -like '*Invoke-PsqlSuper (*')) 'the CREATE ROLE statement does not go through the -c fallback (Invoke-PsqlSuper)'

# (a2) non-ASCII passwords: Invoke-PsqlSuperStdin sets AND RESTORES the
# pipeline encoding via $global:OutputEncoding - a bare $OutputEncoding
# assignment inside a function only creates a NEW LOCAL variable that shadows
# the global one for the rest of that scope, and PowerShell 5.1 reads the
# REAL global preference variable when it pipes text to a native process, so
# the local shadow has ZERO effect on what psql actually receives (proven
# live: without $global:, an e-acute arrived at a child process as the single
# byte 0x3F, a literal '?' - see the behavioural test below). It also saves
# and RESTORES (never blanks to '') the previous PGCLIENTENCODING. Both
# super-user psql wrappers pass -w (never prompt).
$plainFn = Get-FunctionText $ast 'Invoke-PsqlSuper'
Assert-True ($plainFn -ne $null) 'Invoke-PsqlSuper is defined'
Assert-True ($plainFn -like '* -w *') 'Invoke-PsqlSuper passes -w'
Assert-True ($stdinFn -like '* -w *') 'Invoke-PsqlSuperStdin passes -w'
Assert-True ($stdinFn -like '*UTF8Encoding*') 'Invoke-PsqlSuperStdin uses a UTF8Encoding for OutputEncoding'
$globalOutEncCount = ([regex]::Matches($stdinFn, '\$global:OutputEncoding')).Count
Assert-True ($globalOutEncCount -ge 2) ('Invoke-PsqlSuperStdin references $global:OutputEncoding at least twice - set AND restore (found ' + $globalOutEncCount + ')')
Assert-True ($stdinFn -match '\$global:OutputEncoding\s*=\s*New-Object\s+System\.Text\.UTF8Encoding') 'Invoke-PsqlSuperStdin SETS $global:OutputEncoding to a UTF8Encoding'
Assert-True ($stdinFn -match '\$global:OutputEncoding\s*=\s*\$prevOutputEncoding') 'Invoke-PsqlSuperStdin RESTORES $global:OutputEncoding from the saved value'
Assert-True (-not ($stdinFn -match '(?<!\$global:)\$OutputEncoding\s*=')) 'Invoke-PsqlSuperStdin never assigns a bare (local-shadowing) $OutputEncoding'
Assert-True ($stdinFn -match '\$prevPgClientEncoding\s*=\s*\$env:PGCLIENTENCODING') 'Invoke-PsqlSuperStdin saves the previous PGCLIENTENCODING'
Assert-True ($stdinFn -match '\$env:PGCLIENTENCODING\s*=\s*''UTF8''') 'Invoke-PsqlSuperStdin pins PGCLIENTENCODING to the exact literal UTF8'
Assert-True ($stdinFn -match '\$env:PGCLIENTENCODING\s*=\s*\$prevPgClientEncoding') 'Invoke-PsqlSuperStdin RESTORES PGCLIENTENCODING from the saved value (not blanked)'

# (b) Step5-Backup starts a stopped PostgreSQL service (ServiceController
# Start + WaitForStatus, not a fixed sleep) and refuses to continue past a
# -ConfirmDataLoss run whose restore point has no dump.
$step5Fn = Get-FunctionText $ast 'Step5-Backup'
Assert-True ($step5Fn -ne $null) 'Step5-Backup is defined'
Assert-True ($step5Fn -like '*Test-SdpZipHasDump*') 'Step5-Backup calls Test-SdpZipHasDump'
Assert-True ($step5Fn -like '*WaitForStatus*') 'Step5-Backup waits on the service via WaitForStatus'
Assert-True ($step5Fn -like '*ConfirmDataLoss*') 'Step5-Backup branches on -ConfirmDataLoss'
Assert-True ($step5Fn -like '*Get-SdpDbCounts*') 'Step5-Backup records the data-integrity baseline via Get-SdpDbCounts'

# (b2) Step 4's own Start-Service call is untouched by the Step5 rework.
$step4Fn = Get-FunctionText $ast 'Step4-Postgres'
Assert-True ($step4Fn -ne $null) 'Step4-Postgres is defined'
Assert-True ($step4Fn -like '*Start-Service*') 'Step4-Postgres still calls Start-Service directly (left alone)'

# (c) Write-EnvHeader never interpolates the super-password VALUE into a
# string - the config keys are only ever read inside the (set)/(not set)
# ternary, never concatenated raw into a log line.
$envHdrFn = Get-FunctionText $ast 'Write-EnvHeader'
Assert-True ($envHdrFn -ne $null) 'Write-EnvHeader is defined'
$hdrLines = @(($envHdrFn -split "`r?`n"))
$pwLines = @($hdrLines | Where-Object { $_ -like '*StandardPgSuperPassword*' -or $_ -like '*PG_SUPER_PASSWORD*' })
Assert-True ($pwLines.Count -ge 1) 'Write-EnvHeader references the super-password config keys (for the set/not-set line)'
foreach ($l in $pwLines) {
    Assert-True (($l -like '*(set)*') -and ($l -like '*(not set)*')) ('every line referencing the super password is the (set)/(not set) line: ' + $l.Trim())
    Assert-True (-not ($l -like '*+ $cfg.StandardPgSuperPassword +*')) ('StandardPgSuperPassword value is not concatenated raw into the header: ' + $l.Trim())
    Assert-True (-not ($l -like '*+ $cfg.EnvAnswers.PG_SUPER_PASSWORD +*')) ('PG_SUPER_PASSWORD value is not concatenated raw into the header: ' + $l.Trim())
}
Assert-True ($envHdrFn -like '*Add-Content*') 'Write-EnvHeader writes the header to the log file'
$cimCalls = @($hdrLines | Where-Object { $_ -like '*Get-CimInstance*' }).Count
Assert-Eq $cimCalls 1 'Write-EnvHeader calls Get-CimInstance exactly once'
# Every probe (OS, free space, node, psql, ports) degrades instead of throwing -
# each is its own try block in the function body (at least 5: os/free/node/psql/ports).
$tryCount = @($hdrLines | Where-Object { $_ -match '\btry\b' }).Count
Assert-True ($tryCount -ge 5) ('Write-EnvHeader wraps each probe in its own try block (found ' + $tryCount + ')')

# (d) SdpSituation.ps1 is dot-sourced (shared Get-SdpDbCounts / Get-SdpEnvValue
# / Test-SdpZipHasDump - one implementation, not a duplicate).
Assert-True ($raw -like "*. (Join-Path `$here 'SdpSituation.ps1')*") 'SdpSituation.ps1 is dot-sourced'

# (e) BEHAVIOURAL proof that the $global:OutputEncoding fix actually changes
# what a native process receives - not just that the source text says the
# right words. Mirrors Invoke-PsqlSuperStdin's encoding dance exactly, pipes
# an e-acute ([char]0xE9 - written as a code point, never a literal, to keep
# this file pure ASCII) into node, and reads back the raw bytes node saw on
# its stdin. UTF-8 encodes U+00E9 as the two bytes C3 A9; a mis-encoded
# pipeline (the bare-$OutputEncoding bug this whole fix exists for) would
# have delivered the single byte 3F ('?') instead. Also proves the restore
# in `finally` actually puts the PREVIOUS value back, not just SOME value.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host 'install-static.tests: SKIPPED behavioural OutputEncoding test - node not on PATH'
} else {
    function Test-GlobalOutputEncodingRoundtrip {
        # Same shape as the real fix in Invoke-PsqlSuperStdin.
        $prevOutputEncoding = $global:OutputEncoding
        $global:OutputEncoding = New-Object System.Text.UTF8Encoding $false
        try {
            $eAcute = [string][char]0xE9
            return ($eAcute | & node -e "process.stdin.on('data',d=>process.stdout.write(d.toString('hex')))")
        } finally { $global:OutputEncoding = $prevOutputEncoding }
    }
    $before = $global:OutputEncoding
    $hex = $null
    try { $hex = Test-GlobalOutputEncodingRoundtrip } catch { $hex = 'THREW: ' + $_.Exception.Message }
    $hexStr = ("$hex" -join '')
    # Discovered while writing this test (Windows PowerShell 5.1, verified with
    # both the fix ON and OFF): piping to a native command prepends a fixed
    # 3-byte UTF-8 BOM (efbbbf) to the FIRST write ONLY WHEN the console's code
    # page is 65001 (UTF-8) - which is what this box runs, so the harness sees
    # it here every time - no matter what $OutputEncoding is set to, even
    # plain ASCIIEncoding, which has no BOM concept at all. That prefix is a
    # constant artifact of PowerShell 5.1's native-command pipe plumbing on a
    # 65001 console, orthogonal to this fix; strip it before checking the
    # actual character bytes, which is the thing under test.
    if ($hexStr.StartsWith('efbbbf')) { $hexStr = $hexStr.Substring(6) }
    Assert-True ($hexStr.StartsWith('c3a9')) ('node received the e-acute as UTF-8 bytes c3a9, BOM stripped (got: ' + $hexStr + ')')
    Assert-Eq $global:OutputEncoding $before '$global:OutputEncoding is restored to its previous value after the function returns'

    # Negative control: the ORIGINAL bug, reproduced on purpose. A bare
    # (non-global) $OutputEncoding assignment inside a function creates a
    # local shadow only and must NOT reach the child process - proving why
    # $global: was necessary, not just plausible.
    function Test-BareOutputEncodingDoesNotApply {
        $OutputEncoding = New-Object System.Text.UTF8Encoding $false
        $eAcute = [string][char]0xE9
        return ($eAcute | & node -e "process.stdin.on('data',d=>process.stdout.write(d.toString('hex')))")
    }
    $hexBare = $null
    try { $hexBare = Test-BareOutputEncodingDoesNotApply } catch { $hexBare = 'THREW: ' + $_.Exception.Message }
    $hexBareStr = ("$hexBare" -join '')
    if ($hexBareStr.StartsWith('efbbbf')) { $hexBareStr = $hexBareStr.Substring(6) }
    Assert-True (-not $hexBareStr.StartsWith('c3a9')) ('control: a bare (non-global) $OutputEncoding assignment does NOT reach the child process (got: ' + $hexBareStr + ') - confirms $global: was necessary')
}

Write-Host ("install-static.tests: " + $script:AssertCount + " assertions ok")
exit 0
