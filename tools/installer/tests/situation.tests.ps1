$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
. (Join-Path $here '..\SdpSituation.ps1')

# Best-effort cleanup list: every temp dir created below is appended here and
# removed at the end (try/catch, non-fatal if a handle is still open).
$script:TestTempDirs = @()

# Builds a zip at $path with one entry per key in $entries (FullName -> text
# content; '' = a zero-length entry). Full control over entry paths (incl.
# nested ones like 'db/postgres/001_init.sql'), unlike Compress-Archive.
function New-TestZip([string]$path, [hashtable]$entries) {
    if (Test-Path $path) { Remove-Item $path -Force }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Create)
    try {
        $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($k in $entries.Keys) {
                $entry = $zip.CreateEntry($k)
                $s = $entry.Open()
                try {
                    $bytes = [System.Text.Encoding]::ASCII.GetBytes([string]$entries[$k])
                    if ($bytes.Length -gt 0) { $s.Write($bytes, 0, $bytes.Length) }
                } finally { $s.Dispose() }
            }
        } finally { $zip.Dispose() }
    } finally { $fs.Dispose() }
}

try {

# Fixture: a fake bundle with version.json + payload\app.zip carrying package-lock.json
function New-Bundle([string]$version, [string]$lockText) {
    $b = New-TempDir 'sdp-bundle'; $script:TestTempDirs += $b
    Set-Content -Path (Join-Path $b 'version.json') -Value ('{"version":"' + $version + '","sha":"abc"}') -Encoding ascii
    $payload = Join-Path $b 'payload'; New-Item -ItemType Directory -Path $payload -Force | Out-Null
    $stage = New-TempDir 'sdp-stage'; $script:TestTempDirs += $stage
    Set-Content -Path (Join-Path $stage 'package-lock.json') -Value $lockText -Encoding ascii
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath (Join-Path $payload 'app.zip') -Force
    return $b
}
function New-Install([string]$version, [bool]$withEnv, [bool]$withServer, [string]$lockText) {
    $d = New-TempDir 'sdp-inst'; $script:TestTempDirs += $d
    if ($withServer) { Set-Content (Join-Path $d 'server.js') '// app' -Encoding ascii }
    if ($version)    { Set-Content (Join-Path $d 'version.json') ('{"version":"' + $version + '"}') -Encoding ascii }
    if ($withEnv)    { Set-Content (Join-Path $d '.env') 'PG_URL=postgres://sdp_app:x@127.0.0.1:1/sdp_dashboard_test' -Encoding ascii }
    if ($lockText)   { Set-Content (Join-Path $d 'package-lock.json') $lockText -Encoding ascii }
    return $d
}
$cfgBase = @{ ServiceName = 'sdp-unit'; AppPort = 3499; BackupDir = '..\SDP-Backups-unit'; PgHost = 'localhost'; PgPort = 5432; DbName = 'sdp_dashboard_test' }
function Cfg($dir) { $c = $cfgBase.Clone(); $c.InstallDir = $dir; return $c }

# 1. empty dir -> empty / fresh
$bundle = New-Bundle '2.4.0' 'lockA'
$empty = New-TempDir 'sdp-empty'; $script:TestTempDirs += $empty
$s = Get-SdpSituation (Cfg $empty) $bundle
Assert-Eq $s.verdict.state 'empty' 'empty dir state'
Assert-Eq $s.verdict.recommended 'fresh' 'empty dir recommends fresh'
Assert-Eq $s.bundle.version '2.4.0' 'bundle version read'
Assert-True (-not $s.verdict.downgrade) 'no downgrade on empty'

# 2. installed, same lockfile -> patch
$inst = New-Install '2.3.1' $true $true 'lockA'
$s = Get-SdpSituation (Cfg $inst) $bundle
Assert-Eq $s.verdict.state 'installed' 'installed state'
Assert-Eq $s.bundle.lockfile_same_as_installed $true 'lockfile same'
Assert-Eq $s.verdict.recommended 'patch' 'same lockfile recommends patch'
Assert-Eq $s.install.version '2.3.1' 'installed version read'
Assert-Eq $s.db.reachable $false 'unreachable DB (port 1) is not an error'
Assert-True ($s.db.error -ne $null) 'db.error explains'
Assert-True (($s.verdict.notes -join ' ') -match 'not reachable') 'note mentions DB not reachable'

# 3. installed, different lockfile -> upgrade
$inst2 = New-Install '2.3.1' $true $true 'lockB'
$s = Get-SdpSituation (Cfg $inst2) $bundle
Assert-Eq $s.bundle.lockfile_same_as_installed $false 'lockfile differs'
Assert-Eq $s.verdict.recommended 'upgrade' 'different lockfile recommends upgrade'

# 4. partial: .env without server.js
$part = New-Install '' $true $false ''
$s = Get-SdpSituation (Cfg $part) $bundle
Assert-Eq $s.verdict.state 'partial' 'partial state'
Assert-True ($s.verdict.recommended -eq $null) 'partial recommends nothing'

# 5. downgrade
$new = New-Install '3.0.0' $true $true 'lockA'
$s = Get-SdpSituation (Cfg $new) $bundle
Assert-Eq $s.verdict.downgrade $true 'bundle 2.4.0 < installed 3.0.0 is a downgrade'

# 6. counts reader never throws on a bad URL
$c = Get-SdpDbCounts $inst
Assert-Eq $c.reachable $false 'counts unreachable'
Assert-True ($c.counts -eq $null) 'no counts when unreachable (null, not zero)'

# 7. Find-SdpPsql: injectable roots, safe numeric sort, never throws, even with
# a non-numeric sibling folder (pgAdmin 4) next to the real version folder (17).
$pgRoot = New-TempDir 'sdp-pgroot'; $script:TestTempDirs += $pgRoot
$dir17 = Join-Path $pgRoot '17'
New-Item -ItemType Directory -Path (Join-Path $dir17 'bin') -Force | Out-Null
Set-Content -Path (Join-Path $dir17 'bin\psql.exe') -Value 'fake' -Encoding ascii
Set-Content -Path (Join-Path $dir17 'bin\pg_dump.exe') -Value 'fake' -Encoding ascii
New-Item -ItemType Directory -Path (Join-Path $pgRoot 'pgAdmin 4') -Force | Out-Null
$origPgRoots = $script:SdpPgRoots
$script:SdpPgRoots = @($pgRoot)
$found = $null
try { $found = Find-SdpPsql } catch { $found = 'THREW' }
Assert-Eq $found (Join-Path $dir17 'bin\psql.exe') 'Find-SdpPsql returns the 17 path and does not throw on a non-numeric sibling'

# 7b. Find-SdpPgBin generalised over the exe name: pg_dump.exe resolves the
# same way (same roots, same non-numeric-sibling safety), never throws.
$foundDump = $null
try { $foundDump = Find-SdpPgBin 'pg_dump.exe' } catch { $foundDump = 'THREW' }
$script:SdpPgRoots = $origPgRoots
Assert-Eq $foundDump (Join-Path $dir17 'bin\pg_dump.exe') 'Find-SdpPgBin pg_dump.exe returns the 17 path and does not throw on a non-numeric sibling'

# 7c. Multiple real version folders spanning the old "9.6"-style and new
# single-major-integer styles, PLUS a non-numeric sibling (pgAdmin 4): the
# NUMERIC value must win (16 > 9.6), not a string sort (which would put '9.6'
# ahead of '16' lexically), and the non-numeric folder must never win either.
$pgRoot2 = New-TempDir 'sdp-pgroot2'; $script:TestTempDirs += $pgRoot2
$dir16 = Join-Path $pgRoot2 '16'
$dir96 = Join-Path $pgRoot2 '9.6'
New-Item -ItemType Directory -Path (Join-Path $dir16 'bin') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dir96 'bin') -Force | Out-Null
Set-Content -Path (Join-Path $dir16 'bin\psql.exe') -Value 'fake16' -Encoding ascii
Set-Content -Path (Join-Path $dir96 'bin\psql.exe') -Value 'fake96' -Encoding ascii
New-Item -ItemType Directory -Path (Join-Path $pgRoot2 'pgAdmin 4') -Force | Out-Null
$script:SdpPgRoots = @($pgRoot2)
$found2 = $null
try { $found2 = Find-SdpPsql } catch { $found2 = 'THREW' }
$script:SdpPgRoots = $origPgRoots
Assert-Eq $found2 (Join-Path $dir16 'bin\psql.exe') 'pgAdmin 4 + 16 + 9.6 -> the 16 path wins (numeric value, not string sort; a non-numeric folder never wins)'

# 8. malformed PG_URL never throws; DB reads as unreachable
$badUrlDir = New-TempDir 'sdp-badurl'; $script:TestTempDirs += $badUrlDir
Set-Content -Path (Join-Path $badUrlDir '.env') 'PG_URL=not a url' -Encoding ascii
$c2 = $null
try { $c2 = Get-SdpDbCounts $badUrlDir } catch { $c2 = $null }
Assert-True ($c2 -ne $null) 'Get-SdpDbCounts did not throw on a malformed PG_URL'
Assert-Eq $c2.reachable $false 'malformed PG_URL is unreachable'

# 9. partial the other way: server.js without .env
$part2 = New-Install '' $false $true ''
$s = Get-SdpSituation (Cfg $part2) $bundle
Assert-Eq $s.verdict.state 'partial' 'partial state (server.js without .env)'
Assert-True (($s.verdict.notes -join ' ') -match 'run E') 'note mentions run E'

# 10. installed with no local package-lock.json -> unknown match, upgrade recommended
$instNoLock = New-Install '2.3.1' $true $true ''
$s = Get-SdpSituation (Cfg $instNoLock) $bundle
Assert-Eq $s.bundle.lockfile_same_as_installed $null 'no local lockfile -> null match'
Assert-Eq $s.verdict.recommended 'upgrade' 'no local lockfile recommends upgrade to be safe'
Assert-True (($s.verdict.notes -join ' ') -match 'Upgrade recommended') 'note mentions Upgrade recommended'

# 11. Test-SdpZipHasDump: root sdp_dashboard.sql with the pg_dump completion
# trailer -> true (a COMPLETE dump, not merely a non-empty one).
$zipDir = New-TempDir 'sdp-zip'; $script:TestTempDirs += $zipDir
$dumpTrailer = "`n-- PostgreSQL database dump complete`n"
$zipOk = Join-Path $zipDir 'ok.zip'
New-TestZip $zipOk @{ 'sdp_dashboard.sql' = ('-- dump content --' + $dumpTrailer); 'db/postgres/001_init.sql' = '-- schema --' }
Assert-Eq (Test-SdpZipHasDump $zipOk) $true 'root sdp_dashboard.sql with the completion trailer -> has dump'

# 12. Test-SdpZipHasDump: root sdp_dashboard.sql has REAL content but NO
# trailer -> false (a truncated/killed pg_dump run - the trap dump-db.js's
# own partial-file cleanup exists for, caught here independently of it).
$zipTruncated = Join-Path $zipDir 'truncated.zip'
New-TestZip $zipTruncated @{ 'sdp_dashboard.sql' = '-- dump content, cut off mid-table --'; 'db/postgres/001_init.sql' = '-- schema --' }
Assert-Eq (Test-SdpZipHasDump $zipTruncated) $false 'content without the completion trailer -> truncated, no dump'

# 13. Test-SdpZipHasDump: root sdp_dashboard.sql present but EMPTY -> false
$zipEmpty = Join-Path $zipDir 'empty.zip'
New-TestZip $zipEmpty @{ 'sdp_dashboard.sql' = ''; 'db/postgres/001_init.sql' = '-- schema --' }
Assert-Eq (Test-SdpZipHasDump $zipEmpty) $false 'empty root sdp_dashboard.sql -> no dump'

# 14. Test-SdpZipHasDump: only repo schema files, no dump at all -> false
# (a restore point ALWAYS carries repo files like db\postgres\...\001_init.sql -
# that alone must never be mistaken for a database dump)
$zipNoDump = Join-Path $zipDir 'no-dump.zip'
New-TestZip $zipNoDump @{ 'db/postgres/001_init.sql' = '-- schema --' }
Assert-Eq (Test-SdpZipHasDump $zipNoDump) $false 'repo schema file only (no root dump) -> no dump'

# 15. Test-SdpZipHasDump: corrupt file -> false, never throws
$zipCorrupt = Join-Path $zipDir 'corrupt.zip'
Set-Content -Path $zipCorrupt -Value 'not a zip' -Encoding ascii
$r15 = $null
try { $r15 = Test-SdpZipHasDump $zipCorrupt } catch { $r15 = 'THREW' }
Assert-Eq $r15 $false 'corrupt zip -> false, does not throw'

# 16. Test-SdpZipHasDump: missing path -> false, never throws
$zipMissing = Join-Path $zipDir 'does-not-exist.zip'
$r16 = $null
try { $r16 = Test-SdpZipHasDump $zipMissing } catch { $r16 = 'THREW' }
Assert-Eq $r16 $false 'missing zip path -> false, does not throw'

# 17. Test-SdpZipHasDump: the trailer lands past the streaming reader's first
# 8192-byte chunk (entry > 12 KB) -> the sliding tail window still finds it,
# proving the streaming-skip logic (not just small in-memory fixtures) works.
$bigBody = ('-- padding line --' * 700)   # ~13 KB of filler before the trailer
$zipBig = Join-Path $zipDir 'big.zip'
New-TestZip $zipBig @{ 'sdp_dashboard.sql' = ($bigBody + $dumpTrailer) }
Assert-Eq (Test-SdpZipHasDump $zipBig) $true 'trailer found past the first read chunk on a >12 KB entry'

# 18. Compare-SdpCounts: no change -> empty
$cBefore = @{ sites = 11; weekly_reports = 412; md_meetings = 50; insp_inspections = 20; users = 30; assets = 500 }
$cAfterSame = $cBefore.Clone()
$drops = Compare-SdpCounts $cBefore $cAfterSame
Assert-Eq $drops.Count 0 'Compare-SdpCounts: no change -> empty'

# 19. Compare-SdpCounts: one table dropped -> exactly one string, right numbers
$cAfterDrop = $cBefore.Clone(); $cAfterDrop.weekly_reports = 390
$drops2 = @(Compare-SdpCounts $cBefore $cAfterDrop)
Assert-Eq $drops2.Count 1 'Compare-SdpCounts: one table dropped -> exactly one drop'
Assert-Eq $drops2[0] 'weekly_reports 412 -> 390' 'Compare-SdpCounts: drop string has the right numbers'

# 20. Compare-SdpCounts: a table null on EITHER side is ignored, not reported
# as a drop (a null count means "not measured", not "went to zero").
$cBeforeNullUsers = $cBefore.Clone(); $cBeforeNullUsers.users = $null
$cAfterLowUsers = $cBefore.Clone(); $cAfterLowUsers.users = 5
Assert-Eq (@(Compare-SdpCounts $cBeforeNullUsers $cAfterLowUsers)).Count 0 'Compare-SdpCounts: null before -> that table ignored'
$cAfterNullUsers = $cBefore.Clone(); $cAfterNullUsers.users = $null
Assert-Eq (@(Compare-SdpCounts $cBefore $cAfterNullUsers)).Count 0 'Compare-SdpCounts: null after -> that table ignored'

# 21. Compare-SdpCounts: an increase is ignored
$cAfterUp = $cBefore.Clone(); $cAfterUp.assets = 600
Assert-Eq (@(Compare-SdpCounts $cBefore $cAfterUp)).Count 0 'Compare-SdpCounts: increase -> ignored'

# 22. Compare-SdpCounts: $null before or after -> empty, never throws.
# NOTE: comparing an empty-array RESULT against a sentinel string with -ne
# (e.g. `@() -ne 'THREW'`) itself returns an empty array, which Assert-True's
# `-not $cond` then treats as falsy - a false failure that has nothing to do
# with whether the call threw. Use a separate boolean flag instead.
$threw1 = $false; $r1 = $null
try { $r1 = @(Compare-SdpCounts $null $cBefore) } catch { $threw1 = $true }
Assert-True (-not $threw1) 'Compare-SdpCounts does not throw on $null before'
Assert-Eq (@($r1)).Count 0 'Compare-SdpCounts: $null before -> empty'
$threw2 = $false; $r2 = $null
try { $r2 = @(Compare-SdpCounts $cBefore $null) } catch { $threw2 = $true }
Assert-True (-not $threw2) 'Compare-SdpCounts does not throw on $null after'
Assert-Eq (@($r2)).Count 0 'Compare-SdpCounts: $null after -> empty'

# 23. Compare-SdpCounts: a table key entirely ABSENT (not just null) on either
# side is also ignored, not a false drop.
$cBeforePartial = @{ sites = 11; weekly_reports = 412 }
$cAfterPartial = @{ sites = 11; weekly_reports = 390; md_meetings = 5 }
$drops7 = @(Compare-SdpCounts $cBeforePartial $cAfterPartial)
Assert-Eq $drops7.Count 1 'Compare-SdpCounts: missing-key tables ignored, only the present-both drop reported'
Assert-Eq $drops7[0] 'weekly_reports 412 -> 390' 'Compare-SdpCounts: missing-key case drop string correct'

# 24. Compare-SdpCounts: PSCustomObject input (not just Hashtable) also works,
# including a MIXED hashtable-before / PSCustomObject-after pair.
$cBeforeObj = [pscustomobject]@{ sites = 11; weekly_reports = 412; md_meetings = 50; insp_inspections = 20; users = 30; assets = 500 }
$cAfterObj = [pscustomobject]@{ sites = 11; weekly_reports = 390; md_meetings = 50; insp_inspections = 20; users = 30; assets = 500 }
$drops5 = @(Compare-SdpCounts $cBeforeObj $cAfterObj)
Assert-Eq $drops5.Count 1 'Compare-SdpCounts: PSCustomObject input detects a drop'
Assert-Eq $drops5[0] 'weekly_reports 412 -> 390' 'Compare-SdpCounts: PSCustomObject drop string correct'
$drops6 = @(Compare-SdpCounts $cBefore $cAfterObj)
Assert-Eq $drops6.Count 1 'Compare-SdpCounts: mixed Hashtable-before/PSCustomObject-after works'

# 25. Compare-SdpCounts: STRING counts are compared numerically, not lexically.
# '9' -lt '10' is false as strings ('9' sorts after '1'), so without a cast a
# real drop 10 -> 9 would be missed and a rise 9 -> 10 reported as a drop.
$sDrop = @(Compare-SdpCounts @{ users = '10' } @{ users = '9' })
Assert-Eq $sDrop.Count 1 'Compare-SdpCounts: string 10 -> 9 is a drop'
Assert-Eq $sDrop[0] 'users 10 -> 9' 'Compare-SdpCounts: string drop string correct'
Assert-Eq (@(Compare-SdpCounts @{ users = '9' } @{ users = '10' })).Count 0 'Compare-SdpCounts: string 9 -> 10 is an increase, not a drop'

# 26. Get-SdpEnvTextValue: same rules as tools\pg\dump-db.js loadDotEnv().
$u1 = 'postgres://a:b@h:1/first'; $u2 = 'postgres://a:b@h:1/second'
Assert-Eq (Get-SdpEnvTextValue ("PG_URL=$u1`r`nPG_URL=$u2") 'PG_URL') $u2 'env: duplicate key -> LAST line wins'
Assert-Eq (Get-SdpEnvTextValue ("PG_URL=$u1`nX=1`nPG_URL=") 'PG_URL') $null 'env: empty LAST value -> null (does not fall back to an earlier line)'
Assert-Eq (Get-SdpEnvTextValue ("PG_URL=$u1`nPG_URL=  `"`"  ") 'PG_URL') $null 'env: last value only quotes -> null'
Assert-Eq (Get-SdpEnvTextValue ("pg_url=$u1") 'PG_URL') $null 'env: lower-case key is NOT matched (case-sensitive)'
Assert-Eq (Get-SdpEnvTextValue ("pg_url=$u1`nPG_URL=$u2`nPg_Url=x") 'PG_URL') $u2 'env: other-case duplicates ignored'
Assert-Eq (Get-SdpEnvTextValue (([char]0xFEFF) + "PG_URL=$u1`r`nA=1") 'PG_URL') $u1 'env: UTF-8 BOM on the first line stripped'
Assert-Eq (Get-SdpEnvTextValue ("PG_URL=$u1`n# PG_URL=$u2`n   #PG_URL=nope") 'PG_URL') $u1 'env: comment lines ignored (even after the real line)'
Assert-Eq (Get-SdpEnvTextValue ("PG_URL='$u1'") 'PG_URL') $u1 'env: single quotes stripped'
Assert-Eq (Get-SdpEnvTextValue ("PG_URL=`"$u1`"") 'PG_URL') $u1 'env: double quotes stripped'
Assert-Eq (Get-SdpEnvTextValue ("  PG_URL   =   $u1   ") 'PG_URL') $u1 'env: spaces around key, = and value tolerated'
Assert-Eq (Get-SdpEnvTextValue ("  PG_URL = `"$u1`"  ") 'PG_URL') $u1 'env: spaces around a quoted value'
Assert-Eq (Get-SdpEnvTextValue ("PG_URL_OLD=$u2`nXPG_URL=$u2") 'PG_URL') $null 'env: other keys containing the name do not match'
Assert-Eq (Get-SdpEnvTextValue '' 'PG_URL') $null 'env: empty text -> null'

# 27. Get-SdpEnvValueStrict: absent file -> null; locked file -> throws
#     (Get-SdpEnvValue swallows the same error and returns null).
$envDir = New-TempDir 'sdp-sit-env'; $script:TestTempDirs += $envDir
Assert-Eq (Get-SdpEnvValueStrict $envDir 'PG_URL') $null 'strict: no .env -> null'
Set-Content (Join-Path $envDir '.env') ("PG_URL=$u1") -Encoding ascii
Assert-Eq (Get-SdpEnvValueStrict $envDir 'PG_URL') $u1 'strict: readable .env -> value'
$lock = [System.IO.File]::Open((Join-Path $envDir '.env'), 'Open', 'ReadWrite', 'None')
try {
    $threwStrict = $false
    try { $null = Get-SdpEnvValueStrict $envDir 'PG_URL' } catch { $threwStrict = $true }
    Assert-True $threwStrict 'strict: unreadable .env -> throws'
    Assert-Eq (Get-SdpEnvValue $envDir 'PG_URL') $null 'lenient: unreadable .env -> null'
} finally { $lock.Dispose() }

# 28. zip root-entry helpers: root only, text read in memory, corrupt zip throws.
$zipEnv = Join-Path $zipDir 'envzip.zip'
New-TestZip $zipEnv @{ '.env' = "PG_URL=$u1"; 'sub/.env' = 'PG_URL=nested' }
$rt = Get-SdpZipRootEntryText $zipEnv '.env'
Assert-True $rt.found 'zip text: root .env found'
Assert-Eq (Get-SdpEnvTextValue $rt.text 'PG_URL') $u1 'zip text: root .env content (not the nested one)'
Assert-Eq (Get-SdpZipRootEntryText $zipEnv 'missing.txt').found $false 'zip text: absent entry -> found=false'
Assert-Eq (Test-SdpZipHasRootEntry $zipEnv '.env') $true 'zip entry: root .env present'
Assert-Eq (Test-SdpZipHasRootEntry $zipEnv 'sdp_dashboard.sql') $false 'zip entry: absent'
Assert-Eq (Test-SdpZipHasRootEntry $zipEnv '/.env') $false 'zip entry: exact name only'
$threwZip = $false
try { $null = Test-SdpZipHasRootEntry $zipCorrupt '.env' } catch { $threwZip = $true }
Assert-True $threwZip 'zip entry: corrupt zip throws (caller decides)'

# 29. Test-SdpSameDatabase / Get-SdpPgUrlTarget: the database a DROP targets
# (config db/host/port) vs the one .env PG_URL names (the dump + the phrase).
$same = 'postgres://sdp_app:pw@localhost:5432/sdp_dashboard'
Assert-Eq (Test-SdpSameDatabase $same 'sdp_dashboard' 'localhost' 5432) $true 'same db: identical'
Assert-Eq (Test-SdpSameDatabase 'postgres://sdp_app:pw@localhost:5432/other' 'sdp_dashboard' 'localhost' 5432) $false 'same db: different database'
Assert-Eq (Test-SdpSameDatabase 'postgres://sdp_app:pw@localhost:5432/SDP_Dashboard' 'sdp_dashboard' 'localhost' 5432) $false 'same db: database name is case-sensitive'
Assert-Eq (Test-SdpSameDatabase 'postgres://sdp_app:pw@localhost:5433/sdp_dashboard' 'sdp_dashboard' 'localhost' 5432) $false 'same db: different port'
Assert-Eq (Test-SdpSameDatabase 'postgres://sdp_app:pw@127.0.0.1:5432/sdp_dashboard' 'sdp_dashboard' 'localhost' 5432) $true 'same db: 127.0.0.1 == localhost'
Assert-Eq (Test-SdpSameDatabase 'postgres://sdp_app:pw@[::1]:5432/sdp_dashboard' 'sdp_dashboard' 'LOCALHOST' '5432') $true 'same db: [::1] == LOCALHOST, string port'
Assert-Eq (Test-SdpSameDatabase 'postgres://sdp_app:pw@localhost:5432/sdp_dashboard' 'sdp_dashboard' '127.0.0.1' 5432) $true 'same db: config 127.0.0.1 == url localhost'
Assert-Eq (Test-SdpSameDatabase 'postgres://sdp_app:pw@dbserver:5432/sdp_dashboard' 'sdp_dashboard' 'localhost' 5432) $false 'same db: remote host is not localhost'
Assert-Eq (Test-SdpSameDatabase 'postgres://sdp_app:pw@localhost/sdp_dashboard' 'sdp_dashboard' 'localhost' 5432) $true 'same db: missing url port = 5432'
Assert-Eq (Test-SdpSameDatabase 'postgres://sdp_app:pw@localhost/sdp_dashboard' 'sdp_dashboard' 'localhost' 5433) $false 'same db: missing url port is not 5433'
Assert-Eq (Test-SdpSameDatabase $same 'sdp_dashboard' 'localhost' $null) $true 'same db: missing config port = 5432'
Assert-Eq (Test-SdpSameDatabase 'postgresql://us%40er:p%3Aw%2F%23@localhost:5432/sdp_dashboard' 'sdp_dashboard' 'localhost' 5432) $true 'same db: url-encoded user/password are irrelevant'
Assert-Eq (Test-SdpSameDatabase 'not a url' 'sdp_dashboard' 'localhost' 5432) $false 'same db: garbage url -> not same'
Assert-Eq (Test-SdpSameDatabase '' 'sdp_dashboard' 'localhost' 5432) $false 'same db: empty url -> not same'
Assert-Eq (Test-SdpSameDatabase 'http://localhost:5432/sdp_dashboard' 'sdp_dashboard' 'localhost' 5432) $false 'same db: non-postgres scheme -> not same'
Assert-Eq (Test-SdpSameDatabase 'postgres://sdp_app:pw@localhost:5432/' 'sdp_dashboard' 'localhost' 5432) $false 'same db: no database name -> not same'
Assert-Eq (Test-SdpSameDatabase $same 'sdp_dashboard' 'localhost' 'abc') $false 'same db: garbage config port -> not same (never throws)'
$tg = Get-SdpPgUrlTarget 'postgres://sdp_app:s3cret@127.0.0.1/sdp_x'
Assert-True ($tg.db -eq 'sdp_x' -and $tg.host -eq 'localhost' -and $tg.port -eq 5432) 'url target: db/host/port'
Assert-True (-not (($tg.Values -join ' ') -match 's3cret|sdp_app')) 'url target: carries no credentials'
Assert-Eq (Get-SdpPgUrlTarget 'garbage') $null 'url target: garbage -> null'

Write-Host ("situation.tests: " + $script:AssertCount + " assertions ok")

} finally {
    foreach ($d in $script:TestTempDirs) {
        try { if (Test-Path $d) { Remove-Item -Path $d -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
    }
}

exit 0
