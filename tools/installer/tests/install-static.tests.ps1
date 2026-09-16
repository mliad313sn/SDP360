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

# (a2) non-ASCII passwords: Invoke-PsqlSuperStdin sets both the pipeline
# encoding (OutputEncoding) and what psql is told to expect on the wire
# (PGCLIENTENCODING); both super-user psql wrappers pass -w (never prompt).
$plainFn = Get-FunctionText $ast 'Invoke-PsqlSuper'
Assert-True ($plainFn -ne $null) 'Invoke-PsqlSuper is defined'
Assert-True ($plainFn -like '* -w *') 'Invoke-PsqlSuper passes -w'
Assert-True ($stdinFn -like '* -w *') 'Invoke-PsqlSuperStdin passes -w'
Assert-True ($stdinFn -like '*PGCLIENTENCODING*') 'Invoke-PsqlSuperStdin sets PGCLIENTENCODING'
Assert-True ($stdinFn -like '*OutputEncoding*') 'Invoke-PsqlSuperStdin sets OutputEncoding'
Assert-True ($stdinFn -like '*UTF8Encoding*') 'Invoke-PsqlSuperStdin uses a UTF8Encoding for OutputEncoding'

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

Write-Host ("install-static.tests: " + $script:AssertCount + " assertions ok")
exit 0
