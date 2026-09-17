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

# (f) Task 7 - data-integrity check + summary block.

# Get-DataCheck: the dropped-by-request skip (never a false alarm on an
# intended drop) keys on what HAPPENED ($script:DbDropped), not on the plan,
# and it NEVER triggers a rollback itself (a rollback restores code only; the
# DB decision is the operator's).
$dataCheckFn = Get-FunctionText $ast 'Get-DataCheck'
Assert-True ($dataCheckFn -ne $null) 'Get-DataCheck is defined'
Assert-True ($dataCheckFn -like '*''skipped (database dropped by request)''*') 'Get-DataCheck returns the dropped-by-request skip message'
Assert-True ($dataCheckFn -match '\$script:DbDropped\b') 'Get-DataCheck gates the dropped-by-request skip on $script:DbDropped'
Assert-True (-not ($dataCheckFn -match 'ConfirmDataLoss')) 'Get-DataCheck does not re-derive the drop from reinstall + ConfirmDataLoss'
Assert-True (-not ($dataCheckFn -like '*Invoke-Rollback*')) 'Get-DataCheck never calls Invoke-Rollback'
Assert-True (-not ($dataCheckFn -match '\bDie\b')) 'Get-DataCheck never calls Die'

# Step4-Postgres records the facts the summary reports: DbDropped right after
# the DROP succeeded, DbCreated when the database was actually created.
Assert-True ($step4Fn -match '(?s)DROP DATABASE failed.*\$script:DbDropped = \$true') 'Step4-Postgres sets DbDropped only after the DROP succeeded'
Assert-True ($step4Fn -match '(?s)CREATE DATABASE.*failed.*\$script:DbCreated = \$true') 'Step4-Postgres sets DbCreated after CREATE DATABASE succeeded (psql path)'
Assert-True ($step4Fn -match 'if \(-not \$dbExistedBefore\) \{ \$script:DbCreated = \$true \}') 'Step4-Postgres sets DbCreated on the node path only when the db did not exist before'
Assert-True ($step4Fn -match '\$script:Step4Reached = \$true') 'Step4-Postgres records that it was reached'
Assert-True ($step4Fn -match '\$script:DbExistedBefore = \$dbExistedBefore') 'Step4-Postgres records the pre-provisioning existence probe'
Assert-True (([regex]::Matches($step4Fn, 'FROM pg_database')).Count -eq 1) 'Step4-Postgres probes pg_database once (psql fallback reuses the probe)'
Assert-True ($step4Fn -match '(?s)psql fallback.*if \(-not \$dbExistedBefore\) \{\s*Invoke-PsqlSuper \("CREATE DATABASE') 'psql fallback creates the database from the shared probe'

# A data-check drop is logged at ALERT (red), never ERROR: a successful run
# must carry no [ERROR] lines. Log maps ALERT to Red.
$logFn = Get-FunctionText $ast 'Log'
Assert-True ($logFn -match "'ALERT'\s*\{'Red'\}") 'Log prints ALERT in red'

# Step7-Verify: Get-DataCheck is called exactly once, on the success branch,
# strictly before 'Verification PASSED' is logged and before the rollback
# path (Invoke-Rollback) begins - never on the failure/rollback path, where
# $script:DataCheck stays its script-level 'skipped' default.
$step7Fn = Get-FunctionText $ast 'Step7-Verify'
Assert-True ($step7Fn -ne $null) 'Step7-Verify is defined'
$getDataCheckCount = ([regex]::Matches($step7Fn, 'Get-DataCheck')).Count
Assert-Eq $getDataCheckCount 1 'Step7-Verify calls Get-DataCheck exactly once'
$idxDataCheck = $step7Fn.IndexOf('Get-DataCheck')
$idxPassed = $step7Fn.IndexOf('Verification PASSED')
$idxRollback = $step7Fn.IndexOf('Invoke-Rollback')
Assert-True ($idxDataCheck -ge 0 -and $idxPassed -ge 0 -and $idxRollback -ge 0) 'Step7-Verify has a Get-DataCheck call, a PASSED log line, and a rollback path to compare'
Assert-True ($idxDataCheck -lt $idxPassed) 'Get-DataCheck runs before Verification PASSED is logged'
Assert-True ($idxDataCheck -lt $idxRollback) 'Get-DataCheck is called on the success branch, before the rollback path begins (never on the rollback path)'
Assert-True ($step7Fn -like '*Log (''Data check: '' + $script:DataCheck) ''ALERT''*') 'Step7-Verify logs a data-check WARNING at ALERT'

# Spec 4.4: the console box and summary.txt both derive from ONE ordered list
# (Get-SummaryLines), so they can never drift.
$linesFn = Get-FunctionText $ast 'Get-SummaryLines'
$outcomeFn = Get-FunctionText $ast 'Get-DatabaseOutcome'
$boxFn = Get-FunctionText $ast 'Write-SummaryBox'
$summaryFn = Get-FunctionText $ast 'Write-RunSummary'
Assert-True ($linesFn -ne $null) 'Get-SummaryLines is defined'
Assert-True ($outcomeFn -ne $null) 'Get-DatabaseOutcome is defined'
Assert-True ($boxFn -ne $null) 'Write-SummaryBox is defined'
Assert-True ($summaryFn -ne $null) 'Write-RunSummary is defined'
Assert-True ($linesFn -like '*Get-DatabaseOutcome*') 'Get-SummaryLines takes the Database value from Get-DatabaseOutcome'
Assert-True ($boxFn -like '*Get-SummaryLines*') 'the console box derives its lines from Get-SummaryLines'
Assert-True ($summaryFn -like '*Get-SummaryLines*') 'summary.txt derives its lines from Get-SummaryLines'
Assert-True ($boxFn -match 'foreach \(\$s in \(Get-SummaryLines\)\)') 'the console box prints exactly the Get-SummaryLines list'
Assert-True ($boxFn -match "WARNING\*'\) \{ \`$lvl = 'ALERT' \}") 'the console box shows a data-check WARNING at ALERT, not ERROR'
foreach ($label in @('Mode', 'Version', 'Restore point', 'Database', '.env', 'Data check', 'Log')) {
    # A hand-built line would carry the label as a literal followed by a colon
    # or column padding ('Version  : ' / 'Database:'); the only label literal
    # allowed is a bare comparison target like 'Data check'.
    $handBuilt = "'" + [regex]::Escape($label) + '(\s*:|\s{2,})'
    Assert-True (-not ($summaryFn -match $handBuilt)) ('Write-RunSummary does not hand-build a separate ' + $label + ' line')
    Assert-True (-not ($boxFn -match $handBuilt)) ('Write-SummaryBox does not hand-build a separate ' + $label + ' line')
}
# The main success path and the env-only branch both show the box. Anchored on
# the full three-line main banner, not on any stray '# main' text.
$bannerMatch = [regex]::Match($raw, '(?m)^# =+\r?\n# main\r?\n# =+\r?$')
Assert-True $bannerMatch.Success 'Install-SDP.ps1 has the main-section banner'
$mainText = $raw.Substring($bannerMatch.Index)
$envOnlyIdx = $mainText.IndexOf("if (`$Mode -eq 'env-only')")
$envOnlyExit = $mainText.IndexOf('exit 0', $envOnlyIdx)
Assert-True ($envOnlyIdx -ge 0 -and $envOnlyExit -gt $envOnlyIdx) 'main has an env-only branch ending in exit 0'
$envOnlyBlock = $mainText.Substring($envOnlyIdx, $envOnlyExit - $envOnlyIdx)
Assert-True ($envOnlyBlock -like '*Write-SummaryBox*') 'the env-only branch shows the summary box'
Assert-True (-not ($envOnlyBlock -like '*Done. Summary:*')) 'the env-only branch no longer logs the one-line Done message'
$afterEnvOnly = $mainText.Substring($envOnlyExit)
Assert-True ($afterEnvOnly -like '*Complete-Run ''OK''*Write-SummaryBox*') 'the full-run success path shows the summary box after Complete-Run'

# Behavioural: load Get-SummaryLines + Get-DatabaseOutcome and check the eight
# labels in spec order and the values (temp values only, nothing written).
$expected = @('Mode', 'Version', 'Restore point', 'Database', '.env', 'Data check', 'Log', 'Summary')
. ([scriptblock]::Create($outcomeFn))
. ([scriptblock]::Create($linesFn))
function Reset-SummaryState {
    $script:InstalledVerAtStart = '1.0.0'; $script:BundleVer = '1.1.0'; $script:RollbackZip = 'C:\x\rp.zip'
    $script:CountsBefore = @{ reachable = $true }; $script:DataCheck = 'OK (users=1)'; $script:EnvExistedAtStart = $true
    $script:Step4Reached = $true; $script:DbDropped = $false; $script:DbCreated = $false; $script:DbExistedBefore = $true
    $script:ConfirmDataLoss = $false; $script:Mode = 'upgrade'; $script:DbSeeded = $false; $script:SeedFailed = $false; $script:SeedZipName = $null
}
$LogFile = 'C:\x\install.log'; $SummaryFile = 'C:\x\summary.txt'
function Get-Line([string]$label) { return (@(Get-SummaryLines) | Where-Object { $_.Label -eq $label } | Select-Object -First 1).Value }

Reset-SummaryState
$got = @(Get-SummaryLines)
Assert-Eq (($got | ForEach-Object { $_.Label }) -join '|') ($expected -join '|') 'Get-SummaryLines emits the eight labels in spec order (upgrade)'
Assert-Eq $got[0].Value 'UPGRADE (code updated; database + data preserved)' 'upgrade: Mode line'
Assert-Eq $got[1].Value '1.0.0 -> 1.1.0' 'upgrade: Version line'
Assert-Eq $got[2].Value 'C:\x\rp.zip' 'upgrade: Restore point is the zip'
Assert-Eq $got[3].Value 'preserved' 'upgrade: Database preserved'
Assert-Eq $got[4].Value 'preserved (merged)' 'upgrade: .env preserved (merged)'
Assert-Eq $got[5].Value 'OK (users=1)' 'upgrade: Data check carries the check result'
Assert-Eq $got[6].Value 'C:\x\install.log' 'Log line carries the log path'
Assert-Eq $got[7].Value 'C:\x\summary.txt' 'Summary line carries the summary path'

Reset-SummaryState; $Mode = 'patch'
Assert-Eq (Get-Line 'Mode') 'PATCH (code updated; database + data preserved)' 'patch: Mode line'

Reset-SummaryState; $Mode = 'env-only'
$got = @(Get-SummaryLines)
Assert-Eq (($got | ForEach-Object { $_.Label }) -join '|') ($expected -join '|') 'Get-SummaryLines emits the eight labels in spec order (env-only)'
Assert-Eq $got[2].Value 'not applicable (configure .env only)' 'env-only: Restore point not applicable'
Assert-Eq $got[3].Value 'untouched (configure .env only)' 'env-only: Database untouched'
Assert-Eq $got[5].Value 'not applicable' 'env-only: Data check not applicable'

# Database outcome = what happened.
Reset-SummaryState; $Mode = 'reinstall'; $ConfirmDataLoss = $true; $script:DbDropped = $true; $script:DbCreated = $true
Assert-Eq (Get-Line 'Database') 'DROPPED and recreated' 'reinstall + drop + create happened: DROPPED and recreated'
Reset-SummaryState; $Mode = 'reinstall'; $ConfirmDataLoss = $true; $script:DbDropped = $true; $script:DbCreated = $false
Assert-Eq (Get-Line 'Database') 'DROPPED - NOT recreated (restore from the restore point)' 'reinstall + drop happened, create did not: DROPPED - NOT recreated'
Reset-SummaryState; $Mode = 'reinstall'; $ConfirmDataLoss = $true; $script:DbDropped = $false; $script:Step4Reached = $false
Assert-Eq (Get-Line 'Database') 'preserved (drop not performed)' 'reinstall + ConfirmDataLoss, drop never ran: preserved (drop not performed)'
Reset-SummaryState; $Mode = 'reinstall'; $ConfirmDataLoss = $false
Assert-Eq (Get-Line 'Database') 'preserved' 'reinstall without ConfirmDataLoss: preserved'
Reset-SummaryState; $Mode = 'fresh'; $script:DbCreated = $true; $script:RollbackZip = $null; $script:CountsBefore = $null
Assert-Eq (Get-Line 'Database') 'created' 'fresh + database created: created'
Assert-Eq (Get-Line 'Restore point') 'none (fresh install)' 'fresh without restore point: none (fresh install)'
Reset-SummaryState; $Mode = 'fresh'; $script:Step4Reached = $false
Assert-Eq (Get-Line 'Database') 'not created (run stopped before step 4)' 'fresh, step 4 never reached: not created'
Reset-SummaryState; $Mode = 'fresh'; $script:Step4Reached = $true; $script:DbCreated = $false
Assert-Eq (Get-Line 'Database') 'preserved' 'fresh onto an existing database: preserved'
Reset-SummaryState; $Mode = 'fresh'; $script:Step4Reached = $true; $script:DbCreated = $false; $script:DbExistedBefore = $false
Assert-Eq (Get-Line 'Database') 'not created (step 4 failed)' 'fresh, step 4 reached, db absent and not created: not created (step 4 failed)'
Reset-SummaryState; $Mode = 'fresh'; $script:Step4Reached = $true; $script:DbCreated = $false; $script:DbExistedBefore = $null
Assert-Eq (Get-Line 'Database') 'preserved' 'fresh, step 4 died before the existence probe: preserved (no fact to contradict)'

# Version fallback and .env created.
Reset-SummaryState; $script:InstalledVerAtStart = $null; $script:BundleVer = '2.0.0'
Assert-Eq (Get-Line 'Version') 'none -> 2.0.0' 'no installed version: none -> bundle'
Reset-SummaryState; $script:EnvExistedAtStart = $false
Assert-Eq (Get-Line '.env') 'created' '.env absent at start: created'

# Never throws: an error inside becomes ONE fallback line.
function Get-DatabaseOutcome { throw 'boom from summary test' }
Reset-SummaryState
$fb = $null; $fbThrew = $false
try { $fb = @(Get-SummaryLines) } catch { $fbThrew = $true }
Assert-True (-not $fbThrew) 'Get-SummaryLines does not throw when something inside fails'
Assert-Eq $fb.Count 1 'Get-SummaryLines fallback is a single line'
Assert-Eq $fb[0].Label 'Summary' 'Get-SummaryLines fallback label'
Assert-Eq $fb[0].Value 'unavailable: boom from summary test' 'Get-SummaryLines fallback value names the error'
. ([scriptblock]::Create($outcomeFn))

# Get-DataCheck behaviour. Real SdpSituation.ps1 (Compare-SdpCounts,
# Get-SdpCountValue, $SdpCountTables) + the real Format-Counts; only
# Get-SdpDbCounts (the live database read) is stubbed.
Assert-True ($dataCheckFn -match '(?s)\btry\s*\{.*\}\s*catch\s*\{') 'Get-DataCheck wraps its body in try/catch'
Assert-True ($dataCheckFn -like '*catch*skipped (db counts unavailable after: *') 'Get-DataCheck catch returns the unavailable-after skip line'
. (Join-Path $here '..\SdpSituation.ps1')
. ([scriptblock]::Create((Get-FunctionText $ast 'Format-Counts')))
. ([scriptblock]::Create($dataCheckFn))
$InstallDir = 'C:\x\install'
$baseCounts = @{ sites = 11; weekly_reports = 412; md_meetings = 50; insp_inspections = 20; users = 30; assets = 500 }
$script:StubAfter = $null
function Get-SdpDbCounts($dir) { if ($script:StubAfter -is [string]) { throw $script:StubAfter }; return $script:StubAfter }
function Reset-DataCheckState {
    $script:DbDropped = $false; $script:DbSeeded = $false; $script:SeedFailed = $false; $script:RollbackZip = 'C:\x\rp-1.zip'
    $script:CountsBefore = @{ reachable = $true; counts = $baseCounts.Clone(); error = $null }
    $script:StubAfter = @{ reachable = $true; counts = $baseCounts.Clone(); error = $null }
}

Reset-DataCheckState
$script:StubAfter.counts.weekly_reports = 390
Assert-Eq (Get-DataCheck) 'WARNING - weekly_reports 412 -> 390 - restore point: rp-1.zip' 'Get-DataCheck: a drop is a WARNING naming the table, numbers and restore point'

Reset-DataCheckState
$script:StubAfter.counts.weekly_reports = 390; $script:StubAfter.counts.users = 29; $script:RollbackZip = $null
Assert-Eq (Get-DataCheck) 'WARNING - weekly_reports 412 -> 390, users 30 -> 29 - restore point: none' 'Get-DataCheck: several drops, no restore point'

Reset-DataCheckState
$script:StubAfter.counts.assets = 501
Assert-Eq (Get-DataCheck) 'OK (sites 11, weekly_reports 412, md_meetings 50, insp_inspections 20, users 30, assets 501)' 'Get-DataCheck: no drop is OK with the after counts'

Reset-DataCheckState; $script:CountsBefore = $null
Assert-Eq (Get-DataCheck) 'skipped (fresh install)' 'Get-DataCheck: no baseline -> skipped (fresh install)'

Reset-DataCheckState; $script:CountsBefore = @{ reachable = $false; counts = $null; error = 'no PG_URL' }
Assert-Eq (Get-DataCheck) 'skipped (db counts unavailable before)' 'Get-DataCheck: unreachable baseline -> skipped (unavailable before)'

Reset-DataCheckState; $script:StubAfter = @{ reachable = $false; counts = $null; error = 'x' }
Assert-Eq (Get-DataCheck) 'skipped (db counts unavailable after: x)' 'Get-DataCheck: unreachable after -> skipped (unavailable after: x)'

Reset-DataCheckState; $script:DbDropped = $true; $script:StubAfter.counts.weekly_reports = 0
Assert-Eq (Get-DataCheck) 'skipped (database dropped by request)' 'Get-DataCheck: DbDropped -> skipped, never a false alarm'

Reset-DataCheckState; $script:StubAfter = 'boom from test'
$dc = $null
try { $dc = Get-DataCheck } catch { $dc = 'THREW' }
Assert-Eq $dc 'skipped (db counts unavailable after: boom from test)' 'Get-DataCheck turns an exception into a skipped line'

# (g) Demo over an existing install: step 8 replaces the database, and the
# summary must say so (the red screen for it is demo-over-existing).
Reset-DataCheckState; $script:DbSeeded = $true
Assert-Eq (Get-DataCheck) 'skipped (database replaced by demo dataset)' 'Get-DataCheck: DbSeeded -> skipped (replaced by demo dataset)'
Reset-DataCheckState; $script:SeedFailed = $true
Assert-Eq (Get-DataCheck) 'skipped (demo dataset restore failed - database state uncertain)' 'Get-DataCheck: SeedFailed -> skipped (uncertain)'
Reset-DataCheckState; $script:DbDropped = $true; $script:DbSeeded = $true
Assert-Eq (Get-DataCheck) 'skipped (database dropped by request)' 'Get-DataCheck: DbDropped still wins'

Reset-SummaryState; $Mode = 'fresh'; $script:DbSeeded = $true; $script:SeedZipName = 'demo-2026.zip'; $script:DbCreated = $false; $script:DbExistedBefore = $true
Assert-Eq (Get-Line 'Database') 'replaced by demo dataset (demo-2026.zip)' 'demo over existing: Database replaced by demo dataset (not preserved)'
Reset-SummaryState; $Mode = 'fresh'; $script:DbSeeded = $true; $script:SeedZipName = 'demo-2026.zip'; $script:DbCreated = $true
Assert-Eq (Get-Line 'Database') 'replaced by demo dataset (demo-2026.zip)' 'demo on an empty box: replaced beats created'
Reset-SummaryState; $Mode = 'fresh'; $script:SeedFailed = $true; $script:SeedZipName = 'demo-2026.zip'
Assert-Eq (Get-Line 'Database') 'uncertain - demo dataset restore failed (demo-2026.zip), see the log' 'demo seed failed: Database uncertain, never preserved'
Reset-SummaryState; $Mode = 'reinstall'; $ConfirmDataLoss = $true; $script:DbDropped = $true; $script:DbCreated = $false; $script:DbSeeded = $true
Assert-Eq (Get-Line 'Database') 'DROPPED - NOT recreated (restore from the restore point)' 'DbDropped-not-recreated still wins over DbSeeded'
$ConfirmDataLoss = $false

$step8Fn = Get-FunctionText $ast 'Step8-SeedData'
Assert-True ($step8Fn -ne $null) 'Step8-SeedData is defined'
Assert-True ($step8Fn -match '(?s)if \(\$LASTEXITCODE -ne 0\) \{.*?\$script:SeedFailed = \$true.*?return\s*\}.*\$script:DbSeeded = \$true') 'Step8: DbSeeded set only after a successful restore; SeedFailed on the failure branch'
Assert-True ($step8Fn -match '(?s)\$script:DbSeeded = \$true.*\$script:SeedZipName = \$seed\.Name.*\$script:DataCheck = Get-DataCheck') 'Step8: remembers the zip and re-evaluates the data check after the seed'
$planText = [regex]::Match($raw, "(?s)'fresh'\s*\{.*?if \(\`$SeedData\) \{ \`$plan \+= '8' \}").Value
Assert-True ($planText -ne '') 'step 8 is the LAST step of the fresh plan (it runs after step 7''s data check)'
Assert-True ($raw -match '\$script:DbSeeded\s+= \$false') 'DbSeeded defaults to $false with the other Db facts'

# (h) Same database proof before any DROP (Step5 -> Assert-DropTargetMatchesEnv).
Assert-True ($step5Fn -match '(?s)if \(\$ConfirmDataLoss\) \{ Assert-DropTargetMatchesEnv \}.*& powershell @mArgs') 'Step5: the drop target is proven before the restore point is taken'
. ([scriptblock]::Create((Get-FunctionText $ast 'Format-SdpDbTarget')))
. ([scriptblock]::Create((Get-FunctionText $ast 'Assert-DropTargetMatchesEnv')))
function Die($m) { throw ('DIE: ' + $m) }
$script:LogLines = @()
function Log($m, $lvl = 'INFO') { $script:LogLines += ($lvl + ' ' + $m) }
$cfg = @{ DbName = 'sdp_dashboard'; PgHost = 'localhost'; PgPort = 5432 }
$dropDir = New-TempDir 'sdp-droptgt'
$savedPgUrl = $env:PG_URL; $savedDbUrl = $env:DATABASE_URL
function Test-Drop($envText, [string]$procPg = $null, [string]$procDb = $null) {   # $envText untyped: $null = no .env at all
    $InstallDir = $dropDir
    $envFile = Join-Path $dropDir '.env'
    if ($null -eq $envText) { Remove-Item $envFile -Force -ErrorAction SilentlyContinue } else { [IO.File]::WriteAllText($envFile, $envText) }
    $env:PG_URL = $procPg; $env:DATABASE_URL = $procDb
    try { Assert-DropTargetMatchesEnv; return 'OK' } catch { return [string]$_.Exception.Message }
    finally { $env:PG_URL = $savedPgUrl; $env:DATABASE_URL = $savedDbUrl }
}
try {
    Assert-Eq (Test-Drop "PG_URL=postgres://sdp_app:Secr3t@127.0.0.1:5432/sdp_dashboard`r`n") 'OK' 'drop target: .env names the same db (127.0.0.1 == localhost)'
    $m = Test-Drop "PG_URL=postgres://sdp_app:Secr3t@localhost:5432/other_db`r`n"
    Assert-True ($m -like 'DIE: The database named in .env (other_db@localhost:5432) is not the one this installer would drop (sdp_dashboard@localhost:5432) - fix .env or config.psd1; nothing was dropped.') ('drop target: different db refused with db@host:port only: ' + $m)
    Assert-True ($m -notmatch 'Secr3t|sdp_app:') 'drop target: no credential in the message'
    $m = Test-Drop "PG_URL=postgres://sdp_app:Secr3t@localhost:5433/sdp_dashboard`r`n"
    Assert-True ($m -like '*(sdp_dashboard@localhost:5433) is not the one*') 'drop target: different port refused'
    $m = Test-Drop "PG_URL=postgres://sdp_app:Secr3t@dbhost/sdp_dashboard`r`n"
    Assert-True ($m -like '*(sdp_dashboard@dbhost:5432) is not the one*') 'drop target: different host refused (missing port shown as 5432)'
    $m = Test-Drop "REPORTS_BACKEND=postgres`r`n"
    Assert-True ($m -like 'DIE: .env has no PG_URL*nothing was dropped.') 'drop target: no PG_URL -> refused'
    $m = Test-Drop $null
    Assert-True ($m -like 'DIE: .env has no PG_URL*') 'drop target: no .env -> refused'
    $m = Test-Drop "PG_URL=garbage`r`n"
    Assert-True ($m -like '*(unparsable URL) is not the one*') 'drop target: garbage PG_URL refused'
    $m = Test-Drop "PG_URL=postgres://sdp_app:Secr3t@localhost:5432/sdp_dashboard`r`n" 'postgres://u:EnvS3cret@localhost:5432/elsewhere'
    Assert-True ($m -like 'DIE: The database named in the PG_URL environment variable (elsewhere@localhost:5432)*') 'drop target: a PG_URL environment variable (read first by dump-db.js) must match too'
    Assert-True ($m -notmatch 'EnvS3cret') 'drop target: env credential never printed'
    $m = Test-Drop "PG_URL=postgres://sdp_app:Secr3t@localhost:5432/sdp_dashboard`r`n" $null 'postgres://u:p@localhost:5432/elsewhere'
    Assert-True ($m -like '*DATABASE_URL environment variable (elsewhere@localhost:5432)*') 'drop target: DATABASE_URL environment variable checked when PG_URL is not set'
    Assert-Eq (Test-Drop "PG_URL=postgres://sdp_app:Secr3t@localhost:5432/sdp_dashboard`r`n" 'postgres://u:p@127.0.0.1/sdp_dashboard') 'OK' 'drop target: matching env override accepted'
    $cfg = @{ DbName = 'sdp_dashboard_test'; PgHost = 'localhost'; PgPort = 5432 }
    Assert-True ((Test-Drop "PG_URL=postgres://sdp_app:Secr3t@localhost:5432/sdp_dashboard`r`n") -like '*would drop (sdp_dashboard_test@localhost:5432)*') 'drop target: config db differs from .env -> refused'
    Assert-Eq $env:PG_URL $savedPgUrl 'drop target tests restore PG_URL'
} finally {
    $env:PG_URL = $savedPgUrl; $env:DATABASE_URL = $savedDbUrl
    Remove-Item $dropDir -Recurse -Force -ErrorAction SilentlyContinue
}
# (i) Step5 replays the child Manage-SDP console lines (so '[pg-dump] FAILED'
# is visible) and keeps the last-line zip-path contract.
Assert-True ($step5Fn -match '\$zip = Split-ChildBackupOutput \$out') 'Step5: zip path taken through Split-ChildBackupOutput'
Assert-True ($step5Fn -match '(?s)if \(\$code -ne 0\) \{\s*Split-ChildBackupOutput \$out -All') 'Step5: a failed child has ALL its lines replayed before Die'
. ([scriptblock]::Create((Get-FunctionText $ast 'Split-ChildBackupOutput')))
$replayDir = New-TempDir 'sdp-replay'
try {
    $LogFile = Join-Path $replayDir 'install.log'
    $res = @(& { Split-ChildBackupOutput @('10:00:00 [STEP] Full restore point', '[pg-dump] FAILED connection refused', 'C:\bak\sdp-restore_pre-x_1.zip') } 6>&1)
    $info = @($res | Where-Object { $_ -is [System.Management.Automation.InformationRecord] } | ForEach-Object { [string]$_.MessageData })
    $ret = @($res | Where-Object { $_ -isnot [System.Management.Automation.InformationRecord] })
    Assert-Eq $ret.Count 1 'replay: exactly one value returned'
    Assert-Eq $ret[0] 'C:\bak\sdp-restore_pre-x_1.zip' 'replay: the LAST line (zip path) is returned'
    Assert-Eq $info.Count 2 'replay: all lines but the last are shown'
    Assert-True (($info -join "`n") -match '\[pg-dump\] FAILED') 'replay: the dump failure reaches the console'
    Assert-True (-not (($info -join "`n") -match 'sdp-restore_pre-x_1')) 'replay: the zip path line is not echoed'
    Assert-True ((Get-Content $LogFile -Raw) -match '\[manage\] \[pg-dump\] FAILED') 'replay: the dump failure reaches the install log'
    $res2 = @(& { Split-ChildBackupOutput @('a', 'ERROR last') -All } 6>&1)
    Assert-Eq (@($res2 | Where-Object { $_ -is [System.Management.Automation.InformationRecord] })).Count 2 'replay -All: every line shown'
    Assert-Eq (@($res2 | Where-Object { $_ -isnot [System.Management.Automation.InformationRecord] -and $null -ne $_ })).Count 0 'replay -All: nothing returned'
    Assert-Eq (Split-ChildBackupOutput 'C:\only.zip' 6>$null) 'C:\only.zip' 'replay: a single-line output is the zip path'
    Assert-True ($null -eq (Split-ChildBackupOutput $null)) 'replay: no output -> $null'
} finally { Remove-Item $replayDir -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host ("install-static.tests: " + $script:AssertCount + " assertions ok")
exit 0
