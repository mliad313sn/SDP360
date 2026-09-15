# Installer safety parity (console) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the SDP installer's console menu the operator safety of the 4MyPeople installer: detect the situation before the menu, recommend a mode, show one red confirmation screen with the real data at stake and an exact phrase before anything destructive, take the backup BEFORE any DROP, check data counts before/after, and never put a secret on a command line.

**Architecture:** Four new PowerShell scripts under `tools/installer/` (`SdpSituation.ps1` shared functions → `Detect-SDP.ps1` CLI → `Show-Situation.ps1` renderer; `Confirm-Destructive.ps1` red screen), targeted edits to `Install-SDP.ps1` (plan order, `-ForceOverwrite`, `-PrintPlan`, env header, data check, summary), `Manage-SDP.ps1` (pre-restore backup) and `Setup.bat` (gated, coloured menu). Spec: `docs/superpowers/specs/2026-09-15-installer-safety-parity-design.md`.

**Tech Stack:** Windows PowerShell 5.1 (Desktop), cmd batch, psql, `System.IO.Compression.ZipFile`. Tests = plain PowerShell harness scripts (`if … throw`), no Pester. E2E on the TEST instance (`config.test.psd1`: `C:\Apps\SDP-Dashboard-TEST`, port 3457, DB `sdp_dashboard_test`).

---

## Ground rules for every task

- **Pure ASCII in every `.ps1` and `.bat`** (Windows PowerShell 5.1 ANSI parse pitfall, cmd.exe ANSI). The spec's `──` / `·` glyphs are rendered as `-` and `|`. Write files with `-Encoding ascii` or the Write tool; no accents in comments.
- `build-installer.ps1` copies every **top-level** file of `tools/installer/` into the bundle root (`Get-ChildItem -File`, line 133). New `.ps1` files are picked up automatically; `tools/installer/tests/` is a sub-folder and is therefore **not** bundled — keep tests there.
- Never run the real installer against `config.psd1` on this box (prod paths). Tests use temp dirs or `config.test.psd1`.
- Secrets never appear on a command line, in a log, or in a test fixture (use `postgres://sdp_app:x@127.0.0.1:1/x` for unreachable fixtures).
- Commit after each task; `docs/` and `tools/installer/tests/` commits may use `--no-verify` (no deploy impact), the rest go through the normal hook.
- Run the harness with `powershell -NoProfile -ExecutionPolicy Bypass -File tools\installer\tests\run-all.ps1` (created in Task 1).

## File map

| File | Responsibility |
|---|---|
| `tools/installer/SdpSituation.ps1` | dot-sourced functions: `Get-SdpEnvValue`, `Find-SdpPsql`, `Get-SdpDbCounts`, `Get-SdpLockfileMatch`, `Get-SdpSituation` |
| `tools/installer/Detect-SDP.ps1` | CLI: JSON → `-OutFile`, `KEY=VALUE` → stdout |
| `tools/installer/Show-Situation.ps1` | renders the coloured situation block + grouped menu from the JSON |
| `tools/installer/Confirm-Destructive.ps1` | the red screen + exact phrase; exit 0 only on match |
| `tools/installer/Install-SDP.ps1` | `-ForceOverwrite`, `-PrintPlan`, plan reorder, Step5 PG start + dump check, `CREATE ROLE` via stdin, env header, data check, summary |
| `tools/installer/Manage-SDP.ps1` | `-Restore` takes a `pre-restore` backup first, abort rules |
| `tools/installer/Setup.bat` | Detect once per session, Show-Situation menu, gating, confirm flows |
| `tools/installer/tests/run-all.ps1` + `*.tests.ps1` | harness |
| `docs/INSTALLER.md`, `CLAUDE.md` | operator guide + memory |

---

### Task 1: Test harness + `SdpSituation.ps1` (shared functions)

**Files:**
- Create: `tools/installer/tests/run-all.ps1`
- Create: `tools/installer/tests/situation.tests.ps1`
- Create: `tools/installer/SdpSituation.ps1`

- [ ] **Step 1: Write the harness runner**

`tools/installer/tests/run-all.ps1`:
```powershell
# Runs every *.tests.ps1 in this folder in a child PowerShell; exit 1 if any fails.
# No Pester: each test file uses Assert-True / Assert-Eq below (dot-sourced via _assert.ps1).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$fail = 0
foreach ($t in (Get-ChildItem $here -Filter '*.tests.ps1' | Sort-Object Name)) {
    Write-Host ("== " + $t.Name) -ForegroundColor Cyan
    & powershell -NoProfile -ExecutionPolicy Bypass -File $t.FullName
    if ($LASTEXITCODE -ne 0) { $fail++; Write-Host ("   FAILED " + $t.Name) -ForegroundColor Red }
    else { Write-Host ("   ok") -ForegroundColor Green }
}
if ($fail -gt 0) { Write-Host "$fail test file(s) failed" -ForegroundColor Red; exit 1 }
Write-Host 'all installer tests passed' -ForegroundColor Green
exit 0
```

`tools/installer/tests/_assert.ps1`:
```powershell
$script:AssertCount = 0
function Assert-True($cond, [string]$msg) { $script:AssertCount++; if (-not $cond) { throw ("ASSERT FAILED: " + $msg) } }
function Assert-Eq($actual, $expected, [string]$msg) {
    $script:AssertCount++
    if ("$actual" -ne "$expected") { throw ("ASSERT FAILED: " + $msg + " (expected '" + $expected + "', got '" + $actual + "')") }
}
function New-TempDir([string]$prefix) {
    $d = Join-Path $env:TEMP ($prefix + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $d -Force | Out-Null
    return $d
}
```

- [ ] **Step 2: Write the failing situation tests**

`tools/installer/tests/situation.tests.ps1`:
```powershell
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
. (Join-Path $here '..\SdpSituation.ps1')

# Fixture: a fake bundle with version.json + payload\app.zip carrying package-lock.json
function New-Bundle([string]$version, [string]$lockText) {
    $b = New-TempDir 'sdp-bundle'
    Set-Content -Path (Join-Path $b 'version.json') -Value ('{"version":"' + $version + '","sha":"abc"}') -Encoding ascii
    $payload = Join-Path $b 'payload'; New-Item -ItemType Directory -Path $payload -Force | Out-Null
    $stage = New-TempDir 'sdp-stage'
    Set-Content -Path (Join-Path $stage 'package-lock.json') -Value $lockText -Encoding ascii
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath (Join-Path $payload 'app.zip') -Force
    return $b
}
function New-Install([string]$version, [bool]$withEnv, [bool]$withServer, [string]$lockText) {
    $d = New-TempDir 'sdp-inst'
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
$empty = New-TempDir 'sdp-empty'
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

Write-Host ("situation.tests: " + $script:AssertCount + " assertions ok")
exit 0
```

- [ ] **Step 3: Run it to verify it fails**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\installer\tests\situation.tests.ps1`
Expected: error `The term 'Get-SdpSituation' is not recognized` (SdpSituation.ps1 missing → dot-source fails first with "cannot find path"). Exit code non-zero.

- [ ] **Step 4: Write `SdpSituation.ps1`**

```powershell
# =====================================================================
# SdpSituation.ps1 - shared, read-only "what is on this machine" reader.
# Dot-sourced by Detect-SDP.ps1 (menu) and Install-SDP.ps1 (data check),
# so there is exactly ONE count query and ONE verdict rule set.
# Never throws: every probe is try/catch -> $null. KEEP PURE ASCII.
# =====================================================================
$script:SdpCountTables = @('sites', 'weekly_reports', 'md_meetings', 'insp_inspections', 'users', 'assets')

function Get-SdpEnvValue([string]$installDir, [string]$key) {
    $envFile = Join-Path $installDir '.env'
    if (-not (Test-Path $envFile)) { return $null }
    $m = Select-String -Path $envFile -Pattern ('^' + $key + '=(.+)$') | Select-Object -First 1
    if ($m) { return $m.Matches[0].Groups[1].Value.Trim() } else { return $null }
}

function Find-SdpPsql {
    foreach ($root in @('C:\Program Files\PostgreSQL', 'C:\Program Files (x86)\PostgreSQL')) {
        if (Test-Path $root) {
            foreach ($v in (Get-ChildItem $root -Directory | Sort-Object { [double]$_.Name } -Descending)) {
                $p = Join-Path $v.FullName 'bin\psql.exe'
                if (Test-Path $p) { return $p }
            }
        }
    }
    return $null
}

# Exact counts of the core tables + DB size, as the APP role from PG_URL.
# One psql session fed on stdin; a missing table yields null for that table
# (undefined_table is caught inside the DO block), never a failed query.
function Get-SdpDbCounts([string]$installDir) {
    $r = @{ reachable = $false; counts = $null; size_mb = $null; error = $null; db = $null }
    $url = Get-SdpEnvValue $installDir 'PG_URL'
    if (-not $url -or $url -eq '__COMPUTED__') { $r.error = 'no PG_URL in .env'; return $r }
    try {
        $u = [Uri]$url
        $db = $u.AbsolutePath.TrimStart('/'); $r.db = $db
        $user = $u.UserInfo.Split(':')[0]
        $pw = [Uri]::UnescapeDataString($u.UserInfo.Split(':')[1])
        $pgHost = $u.Host; $pgPort = if ($u.Port -gt 0) { $u.Port } else { 5432 }   # [Uri] gives -1 when the URL has no port
    } catch { $r.error = 'PG_URL is not a valid URL'; return $r }
    $psql = Find-SdpPsql
    if (-not $psql) { $r.error = 'psql.exe not found'; return $r }
    $tables = ($script:SdpCountTables | ForEach-Object { "'" + $_ + "'" }) -join ','
    $sql = @"
SET statement_timeout = 10000;
CREATE TEMP TABLE _sdp_counts(t text, n bigint);
DO `$`$ DECLARE r text; c bigint; BEGIN
  FOREACH r IN ARRAY ARRAY[$tables] LOOP
    BEGIN EXECUTE format('SELECT count(*) FROM %I', r) INTO c; EXCEPTION WHEN undefined_table THEN c := NULL; END;
    INSERT INTO _sdp_counts VALUES (r, c);
  END LOOP; END `$`$;
SELECT t || '=' || COALESCE(n::text, 'null') FROM _sdp_counts ORDER BY t;
SELECT 'size_mb=' || round(pg_database_size(current_database()) / 1048576.0, 1);
"@
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $env:PGPASSWORD = $pw; $env:PGCONNECT_TIMEOUT = '10'
    try {
        $out = ($sql | & $psql -h $pgHost -p $pgPort -U $user -d $db -w -t -A -v ON_ERROR_STOP=1 -f - 2>&1)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $old; $env:PGPASSWORD = ''; $env:PGCONNECT_TIMEOUT = '' }
    $lines = @($out | ForEach-Object { "$_" } | Where-Object { $_ -match '^[a-z_]+=' })
    if ($code -ne 0 -or $lines.Count -eq 0) {
        $r.error = ((($out | ForEach-Object { "$_" }) -join ' ').Trim()); if (-not $r.error) { $r.error = 'psql exit ' + $code }
        return $r
    }
    $counts = @{}
    foreach ($l in $lines) {
        $k, $v = $l.Split('=', 2)
        if ($k -eq 'size_mb') { $r.size_mb = [double]$v }
        elseif ($v -eq 'null') { $counts[$k] = $null } else { $counts[$k] = [long]$v }
    }
    $r.counts = $counts; $r.reachable = $true
    return $r
}

function Get-SdpFileSha256([string]$path) {
    if (-not (Test-Path $path)) { return $null }
    return (Get-FileHash -Path $path -Algorithm SHA256).Hash
}

# SHA-256 of the installed package-lock.json vs the one INSIDE payload\app.zip.
# $true / $false / $null (either side missing).
function Get-SdpLockfileMatch([string]$installDir, [string]$bundleRoot) {
    $local = Get-SdpFileSha256 (Join-Path $installDir 'package-lock.json')
    if (-not $local) { return $null }
    $zipPath = Join-Path $bundleRoot 'payload\app.zip'
    if (-not (Test-Path $zipPath)) { return $null }
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
        try {
            $entry = $zip.Entries | Where-Object { $_.FullName -match '(^|/)package-lock\.json$' } | Select-Object -First 1
            if (-not $entry) { return $null }
            $sha = [System.Security.Cryptography.SHA256]::Create()
            $s = $entry.Open()
            try { $hash = ($sha.ComputeHash($s) | ForEach-Object { $_.ToString('X2') }) -join '' } finally { $s.Dispose() }
            return ($hash -eq $local)
        } finally { $zip.Dispose() }
    } catch { return $null }
}

function Get-SdpJsonVersion([string]$path) {
    if (-not (Test-Path $path)) { return $null }
    try { return ((Get-Content $path -Raw | ConvertFrom-Json).version) } catch { return $null }
}

function Get-SdpPm2State([string]$svcName) {
    $pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
    if (-not $pm2) { return 'absent' }
    try {
        $jl = (cmd /c 'pm2 jlist 2>nul' | Out-String | ConvertFrom-Json)
        foreach ($p in $jl) { if ($p.name -eq $svcName) { return $p.pm2_env.status } }
    } catch { }
    return 'absent'
}

function Get-SdpPortOwner([int]$port, [string]$svcName, [string]$installDir) {
    $pids = @()
    try {
        $lines = netstat -ano -p tcp | Select-String (':' + $port + '\s+.*LISTENING\s+(\d+)')
        foreach ($l in $lines) { $pids += [int]$l.Matches[0].Groups[1].Value }
    } catch { }
    if ($pids.Count -eq 0) { return 'free' }
    try {
        $jl = (cmd /c 'pm2 jlist 2>nul' | Out-String | ConvertFrom-Json)
        foreach ($p in $jl) { if ($p.name -eq $svcName -and $pids -contains [int]$p.pid) { return 'ours' } }
    } catch { }
    $pidFile = Join-Path $installDir '.sdp-node.pid'
    if (Test-Path $pidFile) { try { if ($pids -contains [int](Get-Content $pidFile | Select-Object -First 1)) { return 'ours' } } catch { } }
    return 'foreign'
}

# The one situation object. $cfg = merged config hashtable (InstallDir, ServiceName,
# AppPort, BackupDir ...). $bundleRoot = folder holding version.json + payload\.
function Get-SdpSituation($cfg, [string]$bundleRoot) {
    $dir = [string]$cfg.InstallDir
    $backupDir = try { [System.IO.Path]::GetFullPath((Join-Path $dir $cfg.BackupDir)) } catch { $null }
    $install = @{
        dir = $dir; exists = (Test-Path $dir)
        has_server_js = (Test-Path (Join-Path $dir 'server.js'))
        version = (Get-SdpJsonVersion (Join-Path $dir 'version.json'))
        has_env = (Test-Path (Join-Path $dir '.env'))
        has_node_modules = (Test-Path (Join-Path $dir 'node_modules'))
        has_data_dir = (Test-Path (Join-Path $dir 'data'))
    }
    $nodeVer = $null; try { $nodeVer = (& node -v 2>$null) } catch { }
    $runtime = @{
        pm2_process = (Get-SdpPm2State $cfg.ServiceName)
        port_owner = (Get-SdpPortOwner ([int]$cfg.AppPort) $cfg.ServiceName $dir)
        node_version = $nodeVer
    }
    $db = @{ reachable = $false; exists = $false; size_mb = $null; counts = $null; error = 'no install' }
    if ($install.has_env) { $db = Get-SdpDbCounts $dir; $db.exists = $db.reachable }
    $backups = @{ dir = $backupDir; last_full = $null; last_db = $null; count = 0 }
    if ($backupDir -and (Test-Path $backupDir)) {
        $full = Get-ChildItem $backupDir -Filter 'sdp-restore_*.zip' -File | Sort-Object LastWriteTime -Descending
        $dbo  = Get-ChildItem $backupDir -Filter 'sdp-db_*.sql' -File | Sort-Object LastWriteTime -Descending
        $backups.count = @($full).Count + @($dbo).Count
        if ($full) { $f = $full[0]; $backups.last_full = @{ name = $f.Name; age_hours = [math]::Round(((Get-Date) - $f.LastWriteTime).TotalHours, 1); size_mb = [math]::Round($f.Length / 1MB, 1) } }
        if ($dbo)  { $f = $dbo[0];  $backups.last_db   = @{ name = $f.Name; age_hours = [math]::Round(((Get-Date) - $f.LastWriteTime).TotalHours, 1); size_mb = [math]::Round($f.Length / 1MB, 1) } }
    }
    $bv = $null; $sha = $null
    $bvPath = Join-Path $bundleRoot 'version.json'
    if (Test-Path $bvPath) { try { $o = Get-Content $bvPath -Raw | ConvertFrom-Json; $bv = $o.version; $sha = $o.sha } catch { } }
    $bundle = @{ version = $bv; sha = $sha; lockfile_same_as_installed = (Get-SdpLockfileMatch $dir $bundleRoot) }
    $free = $null
    try { $drive = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($dir)); $free = [math]::Round((New-Object System.IO.DriveInfo($drive)).AvailableFreeSpace / 1GB, 1) } catch { }
    $disk = @{ free_gb = $free }

    # ---- verdict ----
    $notes = @()
    $state = 'empty'
    if ($install.has_server_js -and $install.has_env) { $state = 'installed' }
    elseif ($install.has_server_js -or $install.has_env) { $state = 'partial' }
    $recommended = $null
    switch ($state) {
        'empty'     { $recommended = 'fresh' }
        'installed' { $recommended = if ($bundle.lockfile_same_as_installed -eq $true) { 'patch' } else { 'upgrade' } }
        'partial'   {
            # server.js without .env: Reinstall works (Step1 only needs server.js) or E first.
            # .env without server.js: Install-SDP refuses every non-fresh mode without server.js,
            # so the ONLY way is the guarded Fresh (4) - step 6 keeps the .env (hard-coded exclusion).
            if ($install.has_server_js) { $notes += 'server.js found but no .env - run E (Configure .env) first, or 3 (Reinstall)' }
            else { $notes += '.env found but no server.js - use 4 (Fresh install): your .env is kept' }
        }
    }
    if ($state -eq 'installed' -and -not $db.reachable) { $notes += ('database not reachable - counts unavailable, data check will be skipped (' + $db.error + ')') }
    if ($state -eq 'installed' -and $bundle.lockfile_same_as_installed -eq $null) { $notes += 'node_modules change unknown (lockfile missing on one side) - Upgrade recommended to be safe' }
    $downgrade = $false
    if ($bv -and $install.version) {
        $pv = $null; $pi = $null
        if ([version]::TryParse(($bv -replace '^v', ''), [ref]$pv) -and [version]::TryParse(($install.version -replace '^v', ''), [ref]$pi)) {
            if ($pv -lt $pi) { $downgrade = $true; $notes += ('bundle ' + $bv + ' is OLDER than the installed ' + $install.version + ' - use a newer bundle') }
        } else { $notes += 'version strings are not numeric - downgrade check skipped' }
    }
    if ($backups.last_full -and $backups.last_full.age_hours -gt 168) { $notes += ('last full restore point is ' + [math]::Round($backups.last_full.age_hours / 24) + ' days old') }
    if ($runtime.port_owner -eq 'foreign') { $notes += ('port ' + $cfg.AppPort + ' is held by a foreign process') }
    $verdict = @{ state = $state; recommended = $recommended; downgrade = $downgrade; notes = $notes }
    return @{ install = $install; runtime = $runtime; db = $db; backups = $backups; bundle = $bundle; disk = $disk; verdict = $verdict }
}
```

- [ ] **Step 5: Run the tests**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\installer\tests\situation.tests.ps1`
Expected: `situation.tests: <N> assertions ok` (N = the number of Assert calls; do not chase an exact figure), exit 0. (Case 6 takes up to 10 s: the port-1 connection is refused immediately on Windows, so usually < 1 s.)

- [ ] **Step 6: Commit**

```bash
git add tools/installer/SdpSituation.ps1 tools/installer/tests/run-all.ps1 tools/installer/tests/_assert.ps1 tools/installer/tests/situation.tests.ps1
git commit -m "feat(installer): shared situation reader (counts, lockfile match, verdict) + PowerShell test harness"
```

---

### Task 2: `Detect-SDP.ps1` CLI (JSON to file, KEY=VALUE to stdout)

**Files:**
- Create: `tools/installer/Detect-SDP.ps1`
- Create: `tools/installer/tests/detect.tests.ps1`

- [ ] **Step 1: Write the failing test**

`tools/installer/tests/detect.tests.ps1`:
```powershell
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$detect = Join-Path $here '..\Detect-SDP.ps1'

$inst = New-TempDir 'sdp-inst'
Set-Content (Join-Path $inst 'server.js') '// app' -Encoding ascii
Set-Content (Join-Path $inst 'version.json') '{"version":"2.3.1"}' -Encoding ascii
Set-Content (Join-Path $inst '.env') 'PG_URL=postgres://sdp_app:x@127.0.0.1:1/x' -Encoding ascii
$bundle = New-TempDir 'sdp-bundle'
Set-Content (Join-Path $bundle 'version.json') '{"version":"2.4.0"}' -Encoding ascii
$cfgFile = Join-Path (New-TempDir 'sdp-cfg') 'config.unit.psd1'
Set-Content $cfgFile ("@{ InstallDir = '" + $inst + "'; ServiceName = 'sdp-unit'; AppPort = 3499; BackupDir = '..\SDP-Backups-unit' }") -Encoding ascii
$outFile = Join-Path $env:TEMP ('sdp-situation-test-' + [guid]::NewGuid().ToString('N') + '.json')

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
Write-Host ("detect.tests: " + $script:AssertCount + " assertions ok")
exit 0
```

- [ ] **Step 2: Run to verify it fails**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\installer\tests\detect.tests.ps1`
Expected: FAIL — "The argument ... Detect-SDP.ps1 does not exist" / exit code assertion fails.

- [ ] **Step 3: Write `Detect-SDP.ps1`**

```powershell
# =====================================================================
# Detect-SDP.ps1 - "what is on this machine", for Setup.bat.
#   powershell -File Detect-SDP.ps1 [-Config <psd1>] [-BundleRoot <dir>] [-OutFile <json>]
# Writes the full situation as JSON to -OutFile (default %TEMP%\sdp-situation.json)
# and prints ONLY KEY=VALUE lines on stdout (cmd's for /f loop reads them).
# Read-only; never throws; exit 0 always (a detection failure is a STATE=unknown line).
# KEEP PURE ASCII.
# =====================================================================
param(
    [string]$Config,
    [string]$BundleRoot,
    [string]$OutFile
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $BundleRoot) { $BundleRoot = $here }
if (-not $OutFile) { $OutFile = Join-Path $env:TEMP 'sdp-situation.json' }
try {
    $cfg = Import-PowerShellDataFile (Join-Path $here 'config.psd1')
} catch { $cfg = @{} }
if ($Config) {
    $ovPath = if (Test-Path $Config) { $Config } else { Join-Path $here $Config }
    try { $ov = Import-PowerShellDataFile $ovPath; foreach ($k in $ov.Keys) { $cfg[$k] = $ov[$k] } } catch { }
}
foreach ($k in @('InstallDir', 'ServiceName', 'AppPort', 'BackupDir')) { if (-not $cfg.ContainsKey($k)) { $cfg[$k] = @{ InstallDir = 'C:\Apps\SDP-Dashboard'; ServiceName = 'endeavour-dashboard'; AppPort = 3456; BackupDir = '..\SDP-Backups' }[$k] } }
. (Join-Path $here 'SdpSituation.ps1')
try {
    $s = Get-SdpSituation $cfg $BundleRoot
    ($s | ConvertTo-Json -Depth 8) | Set-Content -Path $OutFile -Encoding ascii
    $b = { param($v) if ($v) { '1' } else { '0' } }
    Write-Output ('STATE=' + $s.verdict.state)
    Write-Output ('RECOMMENDED=' + $(if ($s.verdict.recommended) { $s.verdict.recommended } else { 'none' }))
    Write-Output ('DOWNGRADE=' + (& $b $s.verdict.downgrade))
    Write-Output ('DB_REACHABLE=' + (& $b $s.db.reachable))
    Write-Output ('HAS_SERVER=' + (& $b $s.install.has_server_js))
    Write-Output ('INSTALLED_VER=' + $(if ($s.install.version) { $s.install.version } else { 'not installed' }))
    Write-Output ('BUNDLE_VER=' + $(if ($s.bundle.version) { $s.bundle.version } else { 'unknown' }))
} catch {
    # Always leave a readable JSON behind so Show-Situation never reads a stale file.
    $err = ($_.Exception.Message -replace '[\r\n]', ' ')
    $minimal = @{ install = @{ dir = $cfg.InstallDir; has_server_js = $false; has_env = $false }; runtime = @{}; db = @{ reachable = $false; error = $err }
                  backups = @{ dir = $null; count = 0 }; bundle = @{}; disk = @{}; verdict = @{ state = 'unknown'; recommended = $null; downgrade = $false; notes = @('detection failed: ' + $err) } }
    try { ($minimal | ConvertTo-Json -Depth 6) | Set-Content -Path $OutFile -Encoding ascii } catch { }
    Write-Output 'STATE=unknown'; Write-Output 'RECOMMENDED=none'; Write-Output 'DOWNGRADE=0'; Write-Output 'DB_REACHABLE=0'; Write-Output 'HAS_SERVER=0'
    Write-Output 'INSTALLED_VER=unknown'; Write-Output 'BUNDLE_VER=unknown'
    Write-Output ('ERROR=' + $err)
}
exit 0
```

- [ ] **Step 4: Run the test** → `detect.tests: <N> assertions ok`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add tools/installer/Detect-SDP.ps1 tools/installer/tests/detect.tests.ps1
git commit -m "feat(installer): Detect-SDP.ps1 - situation JSON to file, KEY=VALUE for Setup.bat"
```

---

### Task 3: `Confirm-Destructive.ps1` (the red screen)

**Files:**
- Create: `tools/installer/Confirm-Destructive.ps1`
- Create: `tools/installer/tests/confirm.tests.ps1`

- [ ] **Step 1: Write the failing tests**

`tools/installer/tests/confirm.tests.ps1`:
```powershell
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$confirm = Join-Path $here '..\Confirm-Destructive.ps1'

# situation fixture (reachable DB with counts) + a backup dir with two restore points
$bak = New-TempDir 'sdp-bak'
$stage = New-TempDir 'sdp-stg'; Set-Content (Join-Path $stage 'server.js') '//' -Encoding ascii; Set-Content (Join-Path $stage 'sdp_dashboard.sql') '--' -Encoding ascii
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath (Join-Path $bak 'sdp-restore_pre-v2.4.0_20260912-020011.zip') -Force
Set-Content (Join-Path $bak 'sdp-db_20260913-020000.sql') '--' -Encoding ascii
$sit = @{
    install = @{ dir = 'C:\Apps\X'; version = '2.3.1'; has_env = $true }
    db = @{ reachable = $true; db = 'sdp_dashboard_test'; size_mb = 12.5; counts = @{ sites = 11; weekly_reports = 412; md_meetings = 96; insp_inspections = 41; users = 23; assets = 2400 } }
    backups = @{ dir = $bak; last_full = @{ name = 'sdp-restore_pre-v2.4.0_20260912-020011.zip'; age_hours = 70; size_mb = 1 } }
    bundle = @{ version = '2.4.0' }
    verdict = @{ state = 'installed' }
}
$sitFile = Join-Path (New-TempDir 'sdp-sit') 'sit.json'
($sit | ConvertTo-Json -Depth 6) | Set-Content $sitFile -Encoding ascii
$sitUnreach = $sit.Clone(); $sitUnreach.db = @{ reachable = $false; error = 'refused' }
$sitFile2 = Join-Path (New-TempDir 'sdp-sit') 'sit2.json'
($sitUnreach | ConvertTo-Json -Depth 6) | Set-Content $sitFile2 -Encoding ascii

# $stdin: a string to pipe, or the sentinel 'CLOSED' to run with stdin redirected from NUL
# (an untyped parameter - a [string] one would coerce $null to '' and never take the NUL branch).
function Run($stdin, [string[]]$extra) {
    $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $confirm) + $extra
    if ($stdin -eq 'CLOSED') { cmd /c ('powershell ' + (($psArgs | ForEach-Object { '"' + $_ + '"' }) -join ' ') + ' < NUL') | Out-Null }
    else { $stdin | & powershell @psArgs | Out-Null }
    return $LASTEXITCODE
}
Assert-Eq (Run 'WRONG' @('-Action', 'reinstall', '-Situation', $sitFile)) 1 'wrong phrase -> 1'
Assert-Eq (Run 'REINSTALL' @('-Action', 'reinstall', '-Situation', $sitFile)) 0 'REINSTALL -> 0'
Assert-Eq (Run 'reinstall' @('-Action', 'reinstall', '-Situation', $sitFile)) 1 'case-sensitive'
Assert-Eq (Run 'CLOSED' @('-Action', 'reinstall', '-Situation', $sitFile)) 1 'closed stdin -> 1'
Assert-Eq (Run 'RESTORE 20260912' @('-Action', 'restore', '-Situation', $sitFile, '-Target', 'sdp-restore_pre-v2.4.0_20260912-020011')) 0 'a name without .zip is accepted (suffix appended like Manage-SDP)'
Assert-Eq (Run '' @('-Action', 'reinstall', '-Situation', $sitFile)) 1 'empty line -> 1'
Assert-Eq (Run 'DROP sdp_dashboard_test' @('-Action', 'dropdb', '-Situation', $sitFile)) 0 'DROP <db> -> 0'
Assert-Eq (Run 'DROP sdp_dashboard' @('-Action', 'dropdb', '-Situation', $sitFile)) 1 'DROP wrong db -> 1'
Assert-Eq (Run 'DROP sdp_dashboard_test' @('-Action', 'dropdb', '-Situation', $sitFile2)) 1 'dropdb refused when DB unreachable, even with the right phrase'
Assert-Eq (Run ('OVERWRITE ' + $env:COMPUTERNAME) @('-Action', 'fresh-over-existing', '-Situation', $sitFile)) 0 'OVERWRITE <computer> -> 0'
Assert-Eq (Run 'RESTORE 20260912' @('-Action', 'restore', '-Situation', $sitFile, '-Target', 'sdp-restore_pre-v2.4.0_20260912-020011.zip')) 0 'RESTORE <date from trailing group> -> 0'
Assert-Eq (Run 'RESTORE 20260912' @('-Action', 'restore', '-Situation', $sitFile, '-Target', 'sdp-db_20260913-020000.sql')) 1 'a .sql dump is rejected before the phrase'
Assert-Eq (Run 'RESTORE 20260912' @('-Action', 'restore', '-Situation', $sitFile, '-Target', 'missing.zip')) 1 'missing target -> 1'
Write-Host ("confirm.tests: " + $script:AssertCount + " assertions ok")
exit 0
```

- [ ] **Step 2: Run to verify it fails** — script missing → every Run returns 1 → the `REINSTALL -> 0` assertion fails.

- [ ] **Step 3: Write `Confirm-Destructive.ps1`**

```powershell
# =====================================================================
# Confirm-Destructive.ps1 - the ONE red screen before anything destructive.
#   -Action reinstall | dropdb | fresh-over-existing | restore
#   -Situation <json written by Detect-SDP.ps1>   -Target <restore point file name> (restore)
# Prints what will happen, what is at stake (real counts), what protects you,
# then requires an EXACT case-sensitive phrase. Exit 0 only on a match.
# Closed/empty stdin -> exit 1 (never auto-confirmed). A piped phrase is accepted
# like a typed one (tests + piped Setup.bat runs). KEEP PURE ASCII.
# =====================================================================
param(
    [Parameter(Mandatory = $true)][ValidateSet('reinstall', 'dropdb', 'fresh-over-existing', 'restore')][string]$Action,
    [Parameter(Mandatory = $true)][string]$Situation,
    [string]$Target
)
$ErrorActionPreference = 'Stop'
function Red([string]$t)  { Write-Host $t -ForegroundColor White -BackgroundColor DarkRed }
function Line([string]$t) { Write-Host $t -ForegroundColor Gray }
function Warn([string]$t) { Write-Host $t -ForegroundColor Yellow }
function Refuse([string]$why) { Write-Host ''; Write-Host ('  REFUSED: ' + $why) -ForegroundColor Red; exit 1 }

if (-not (Test-Path $Situation)) { Refuse "situation file not found: $Situation" }
$s = Get-Content $Situation -Raw | ConvertFrom-Json
$dbName = if ($s.db -and $s.db.db) { $s.db.db } else { 'sdp_dashboard' }

# ---- per-action facts -------------------------------------------------------
$phrase = ''; $what = ''; $protect = ''
switch ($Action) {
    'reinstall' {
        $what = 'Re-deploy code + node_modules from this bundle over ' + $s.install.dir + '. Database, data\ and blobs\ are KEPT.'
        $protect = 'A full restore point of the CURRENT state (code + .env + data + DB dump) is taken FIRST, before anything is touched.'
        $phrase = 'REINSTALL'
    }
    'dropdb' {
        if (-not $s.db.reachable) { Refuse 'database not reachable - counts unavailable. Take a backup (option 5) and check the DB (option C) before dropping anything.' }
        $what = 'DROP DATABASE ' + $dbName + ' and recreate it EMPTY. Every report, PV, inspection, user and asset record in it is destroyed.'
        $protect = 'The restore point taken first MUST contain the DB dump - the installer refuses the DROP otherwise.'
        $phrase = 'DROP ' + $dbName
    }
    'fresh-over-existing' {
        $what = 'Fresh install over an EXISTING installation in ' + $s.install.dir + ': code and node_modules are replaced. Your database, data\, blobs\ and .env are NOT deleted.'
        $protect = 'A full restore point of the CURRENT state is taken first; automatic rollback applies if the app does not come back.'
        $phrase = 'OVERWRITE ' + $env:COMPUTERNAME
    }
    'restore' {
        if (-not $Target) { Refuse 'restore needs -Target <restore point file name>' }
        if ($Target -match '\.sql$') { Refuse ($Target + ' is a DB-only dump; only sdp-restore_*.zip restore points can be restored from the menu.') }
        if ($Target -notmatch '\.zip$') { $Target = $Target + '.zip' }   # same tolerance as Manage-SDP -Restore -Name
        $zip = Join-Path $s.backups.dir $Target
        if (-not (Test-Path $zip)) { Refuse ('restore point not found: ' + $zip) }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [System.IO.Compression.ZipFile]::OpenRead($zip)
        try { $names = @($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() }
        $hasCode = ($names -contains 'server.js'); $hasEnv = ($names -contains '.env')
        $hasData = (($names | Where-Object { $_ -like 'data/*' -or $_ -like 'data\*' }).Count -gt 0)
        $hasDump = (($names | Where-Object { $_ -match '\.sql$' }).Count -gt 0)
        $contents = @(); if ($hasCode) { $contents += 'code' }; if ($hasEnv) { $contents += '.env' }; if ($hasData) { $contents += 'data' }; if ($hasDump) { $contents += 'DB dump' }
        $when = (Get-Item $zip).LastWriteTime.ToString('yyyy-MM-dd HH:mm')
        $what = 'Overwrite the CURRENT ' + (($contents) -join ' + ') + ' with restore point ' + $Target + ' (created ' + $when + ').' + $(if ($hasDump) { ' The database is DROPPED and reloaded from the dump.' } else { ' No database change (no dump inside).' })
        $protect = 'A pre-restore restore point of the CURRENT state is taken first; if it cannot be taken, the restore is aborted.'
        $phrase = if ($Target -match '_(\d{8})-\d{6}\.zip$') { 'RESTORE ' + $Matches[1] } else { 'RESTORE ' + ($Target -replace '\.zip$', '') }
    }
}

# ---- the screen ---------------------------------------------------------------
Write-Host ''
Red '                                                                              '
Red ('   !!  DESTRUCTIVE ACTION - ' + $Action.ToUpper().PadRight(51) + ' ')
Red '                                                                              '
Write-Host ''
Write-Host '  What will happen' -ForegroundColor White
Line ('    ' + $what)
Write-Host ''
Write-Host '  What is at stake right now' -ForegroundColor White
if ($s.db.reachable -and $s.db.counts) {
    $c = $s.db.counts
    Line ('    Database ' + $dbName + '  ' + $s.db.size_mb + ' MB  |  sites ' + $c.sites + '  reports ' + $c.weekly_reports + '  PV ' + $c.md_meetings + '  inspections ' + $c.insp_inspections + '  users ' + $c.users + '  assets ' + $c.assets)
} else { Warn '    Database counts unavailable (not reachable)' }
Line ('    Installed version ' + $(if ($s.install.version) { $s.install.version } else { 'unknown' }) + '  |  .env present: ' + $s.install.has_env)
if ($s.backups.last_full) { Line ('    Last full restore point: ' + $s.backups.last_full.name + ' (' + [math]::Round($s.backups.last_full.age_hours / 24, 1) + ' days ago)') }
else { Warn '    No full restore point exists yet' }
Write-Host ''
Write-Host '  What protects you' -ForegroundColor White
Line ('    ' + $protect)
Write-Host ''
Write-Host ('  Type exactly  ' + $phrase + '  to continue, anything else to cancel:') -ForegroundColor Yellow
Write-Host '  > ' -NoNewline
$typed = $null
try { $typed = [Console]::In.ReadLine() } catch { $typed = $null }
if ($typed -eq $null) { Write-Host ''; Write-Host '  Cancelled - no input (nothing changed).' -ForegroundColor Yellow; exit 1 }
if ($typed.Trim() -cne $phrase) { Write-Host '  Cancelled - phrase did not match (nothing changed).' -ForegroundColor Yellow; exit 1 }
Write-Host ('  Confirmed: ' + $phrase) -ForegroundColor Green
exit 0
```

- [ ] **Step 4: Run the test** → `confirm.tests: <N> assertions ok`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add tools/installer/Confirm-Destructive.ps1 tools/installer/tests/confirm.tests.ps1
git commit -m "feat(installer): Confirm-Destructive.ps1 - red screen with real counts + exact phrase"
```

---

### Task 4: `Show-Situation.ps1` (situation block + grouped coloured menu)

**Files:**
- Create: `tools/installer/Show-Situation.ps1`
- Create: `tools/installer/tests/show.tests.ps1`

- [ ] **Step 1: Write the failing test**

```powershell
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$show = Join-Path $here '..\Show-Situation.ps1'
function Sit($state, $rec, $down, $reach) {
    $o = @{ install = @{ dir = 'C:\Apps\X'; version = '2.3.1'; has_env = $true; has_server_js = ($state -ne 'empty') }
        runtime = @{ pm2_process = 'online'; port_owner = 'ours' }
        db = @{ reachable = $reach; db = 'sdp_dashboard'; size_mb = 1.8; counts = @{ sites = 11; weekly_reports = 412; md_meetings = 96; insp_inspections = 41; users = 23; assets = 5 } }
        backups = @{ last_full = @{ name = 'sdp-restore_x_20260912-020011.zip'; age_hours = 72; size_mb = 640 }; count = 14 }
        bundle = @{ version = '2.4.0'; lockfile_same_as_installed = $false }
        disk = @{ free_gb = 48 }
        verdict = @{ state = $state; recommended = $rec; downgrade = $down; notes = @('a note') } }
    $f = Join-Path (New-TempDir 'sdp-sit') 'sit.json'; ($o | ConvertTo-Json -Depth 6) | Set-Content $f -Encoding ascii; return $f
}
$out = (& powershell -NoProfile -ExecutionPolicy Bypass -File $show -Situation (Sit 'installed' 'upgrade' $false $true) -HasDemo 0 | Out-String)
Assert-True ($out -match 'v2\.3\.1 is installed and this package contains v2\.4\.0') 'state sentence'
Assert-True ($out -match 'RECOMMENDED') 'RECOMMENDED group'
Assert-True ($out -match '2\.\s+Upgrade.*<< recommended') 'upgrade first + tag'
Assert-True ($out -match '4\.\s+Fresh install.*confirmation required') 'fresh guarded wording'
Assert-True ($out -match 'sites 11') 'counts line'
Assert-True ($out -notmatch 'D\.\s+Demo') 'no demo entry when HasDemo=0'
$out2 = (& powershell -NoProfile -ExecutionPolicy Bypass -File $show -Situation (Sit 'empty' 'fresh' $false $false) -HasDemo 1 | Out-String)
Assert-True ($out2 -match 'Nothing is installed') 'empty sentence'
Assert-True ($out2 -match '4\.\s+Fresh install.*<< recommended') 'fresh recommended on empty'
Assert-True ($out2 -match 'D\.\s+Demo') 'demo entry shown'
Assert-True ($out2 -match '1\.\s+Patch.*not applicable') 'patch n/a on empty'
$out3 = (& powershell -NoProfile -ExecutionPolicy Bypass -File $show -Situation (Sit 'installed' 'patch' $true $true) -HasDemo 0 | Out-String)
Assert-True ($out3 -match 'OLDER|downgrade|newer bundle') 'downgrade note visible'
Write-Host ("show.tests: " + $script:AssertCount + " assertions ok")
exit 0
```

- [ ] **Step 2: Run to verify it fails** — script missing.

- [ ] **Step 3: Write `Show-Situation.ps1`**

```powershell
# =====================================================================
# Show-Situation.ps1 - renders the coloured situation block + the grouped menu
# for Setup.bat (cmd cannot colour). Reads the JSON from Detect-SDP.ps1.
#   -Situation <json> -HasDemo 0|1
# Menu numbers are unchanged; Setup.bat keeps the prompt + dispatch.
# KEEP PURE ASCII (no box glyphs).
# =====================================================================
param([Parameter(Mandatory = $true)][string]$Situation, [int]$HasDemo = 0)
$ErrorActionPreference = 'Stop'
$s = Get-Content $Situation -Raw | ConvertFrom-Json
$v = $s.verdict
function W([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }
$iv = if ($s.install.version) { 'v' + ($s.install.version -replace '^v', '') } else { 'unknown version' }
$bv = if ($s.bundle.version) { 'v' + ($s.bundle.version -replace '^v', '') } else { 'unknown version' }

W ''
W ' -- Situation ---------------------------------------------------------------' 'Cyan'
if ($v.state -eq 'empty') {
    W ('  Install    : ' + $s.install.dir + '   (nothing installed)') 'Gray'
} else {
    $rt = 'pm2 ' + $s.runtime.pm2_process + ', port ' + $s.runtime.port_owner
    $col = if ($v.state -eq 'partial') { 'Red' } else { 'Green' }
    W ('  Install    : ' + $s.install.dir + '   ' + $iv + '   (' + $rt + ')') $col
    if ($s.db.reachable -and $s.db.counts) {
        $c = $s.db.counts
        W ('  Database   : ' + $s.db.db + '  ' + $s.db.size_mb + ' MB   sites ' + $c.sites + ' | reports ' + $c.weekly_reports + ' | PV ' + $c.md_meetings + ' | inspections ' + $c.insp_inspections + ' | users ' + $c.users) 'Green'
    } else { W '  Database   : not reachable - counts unavailable' 'Yellow' }
    if ($s.backups.last_full) {
        $b = $s.backups.last_full
        $col = if ($b.age_hours -gt 168) { 'Yellow' } else { 'Green' }
        W ('  Backups    : last full ' + [math]::Round($b.age_hours / 24, 1) + ' d ago (' + $b.name + ', ' + $b.size_mb + ' MB) | ' + $s.backups.count + ' kept') $col
    } else { W '  Backups    : none yet' 'Yellow' }
}
$lockTxt = if ($v.state -ne 'installed') { '' } elseif ($s.bundle.lockfile_same_as_installed -eq $true) { '   node_modules unchanged -> Patch recommended' } else { '   node_modules changed -> Upgrade recommended' }
W ('  Bundle     : ' + $bv + $lockTxt) $(if ($v.downgrade) { 'Red' } else { 'Gray' })
foreach ($n in @($v.notes)) { if ($n) { W ('  ! ' + $n) $(if ($v.downgrade -or $v.state -eq 'partial') { 'Red' } else { 'Yellow' }) } }
W ' ---------------------------------------------------------------------------' 'Cyan'
W ''
switch ($v.state) {
    'empty'     { W ('  Nothing is installed in ' + $s.install.dir + '. This package contains ' + $bv + '.') 'White' }
    'installed' { W ('  SDP Dashboard ' + $iv + ' is installed and this package contains ' + $bv + '.') 'White' }
    'partial'   { W ('  ' + $s.install.dir + ' holds an INCOMPLETE installation. This package contains ' + $bv + '.') 'White' }
    default     { W ('  Could not read the installation state. This package contains ' + $bv + '.') 'Red' }
}
W ''
# ---- entries -------------------------------------------------------------------
$rec = $v.recommended
$installed = ($v.state -eq 'installed')
$entries = @(
    @{ n = '1'; name = 'Patch';         desc = 'Code only. No node_modules or database change at all.';                  kind = $(if ($installed) { 'ok' } else { 'na' }); why = 'nothing installed' },
    @{ n = '2'; name = 'Upgrade';       desc = 'Code + node_modules. Database, data and .env preserved.';                 kind = $(if ($installed) { 'ok' } else { 'na' }); why = 'nothing installed' },
    @{ n = '3'; name = 'Reinstall';     desc = 'Re-deploy over the top; DB kept unless you ask to drop it.';             kind = $(if ($v.state -eq 'empty' -or -not $s.install.has_server_js) { 'na' } else { 'red' }); why = $(if ($v.state -eq 'empty') { 'nothing installed' } else { 'no server.js - use 4' }) },
    @{ n = '4'; name = 'Fresh install'; desc = $(if ($v.state -eq 'empty') { 'First-time install on this machine.' } else { 'Overwrites the existing installation''s code - confirmation required.' }); kind = $(if ($v.state -eq 'empty') { 'ok' } else { 'red' }); why = '' }
)
if ($HasDemo -eq 1) { $entries += @{ n = 'D'; name = 'Demo laptop'; desc = 'Fresh install + load the bundled dataset.'; kind = $(if ($v.state -eq 'empty') { 'ok' } else { 'red' }); why = '' } }
if ($v.downgrade) { foreach ($e in $entries) { if ('1', '2', '3', '4', 'D' -contains $e.n) { $e.kind = 'na'; $e.why = 'bundle older than installed - use a newer bundle' } } }
$recMap = @{ patch = '1'; upgrade = '2'; fresh = '4' }
$recN = if ($rec -and $recMap.ContainsKey($rec)) { $recMap[$rec] } else { $null }
function Entry($e, [bool]$isRec) {
    $label = ('    ' + $e.n + '.  ' + $e.name.PadRight(20) + ' ' + $e.desc)
    if ($e.kind -eq 'na') { W ($label + '  (not applicable here - ' + $e.why + ')') 'DarkGray'; return }
    if ($isRec) { W ($label + '   << recommended') 'Green'; return }
    if ($e.kind -eq 'red') { W ($label) 'Red'; return }
    W $label 'Gray'
}
W '  RECOMMENDED' 'White'
$recEntry = $entries | Where-Object { $_.n -eq $recN } | Select-Object -First 1
if ($recEntry) { Entry $recEntry $true } else { W '    (no recommendation - see the notes above)' 'DarkGray' }
W '  OTHER' 'White'
foreach ($e in $entries) { if ($e.n -ne $recN) { Entry $e $false } }
W '  DATA' 'White'
W '    5.  Backup now           Full restore point (code + .env + data + DB dump).' 'Gray'
W ('    6.  Restore a previous version      Overwrites the current state - confirmation required.' + $(if (-not $s.db.reachable) { '  (database unreachable)' } else { '' })) 'Red'
W '    7.  List restore points' 'Gray'
W '  MAINTENANCE' 'White'
W '    8.  Verify health        pm2 status + HTTP probe.' 'Gray'
W '    9.  Diagnostics / logs   Versions, DBs, .env flags, last log lines.' 'Gray'
W '    E.  Configure .env       Guided questionnaire (fills placeholders).' 'Gray'
W '    C.  Check DB connection  PostgreSQL pre-flight.' 'Gray'
W ''
W '    0.  Exit' 'Gray'
W ' ---------------------------------------------------------------------------' 'Cyan'
exit 0
```

- [ ] **Step 4: Run the test** → `show.tests: <N> assertions ok`, exit 0. Then run the whole harness: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\installer\tests\run-all.ps1` → `all installer tests passed`.

- [ ] **Step 5: Commit**

```bash
git add tools/installer/Show-Situation.ps1 tools/installer/tests/show.tests.ps1
git commit -m "feat(installer): Show-Situation.ps1 - coloured situation block + recommended-first menu"
```

---

### Task 5: Install-SDP — `-ForceOverwrite`, `-PrintPlan`, plan reorder

**Files:**
- Modify: `tools/installer/Install-SDP.ps1` (param block :49-63; Step1 :441-446; main :1094-1100)
- Create: `tools/installer/tests/plan.tests.ps1`

- [ ] **Step 1: Write the failing test**

```powershell
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$install = Join-Path $here '..\Install-SDP.ps1'
$empty = New-TempDir 'sdp-plan-empty'
$inst = New-TempDir 'sdp-plan-inst'; Set-Content (Join-Path $inst 'server.js') '//' -Encoding ascii
function CfgFor($dir) { $f = Join-Path (New-TempDir 'sdp-cfg') 'c.psd1'; Set-Content $f ("@{ InstallDir = '" + $dir + "'; ServiceName = 'sdp-unit'; AppPort = 3499; BackupDir = '..\SDP-Backups-unit' }") -Encoding ascii; return $f }
function Plan([string[]]$sw, $dir) {
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $install @sw -PrintPlan -Config (CfgFor $dir) -BundleRoot $env:TEMP
    return ($out | Where-Object { "$_" -like 'PLAN=*' } | Select-Object -Last 1)
}
Assert-Eq (Plan @('-Fresh') $empty)                       'PLAN=1,2,3,4,4b,6,7'    'plain fresh has no step 5'
Assert-Eq (Plan @('-Fresh', '-ForceOverwrite') $inst)     'PLAN=1,2,3,5,4,4b,6,7'  'fresh over existing backs up BEFORE step 4'
Assert-Eq (Plan @('-Reinstall') $inst)                    'PLAN=1,2,3,5,4,4b,6,7'  'reinstall backs up BEFORE step 4'
Assert-Eq (Plan @('-Reinstall', '-ConfirmDataLoss') $inst) 'PLAN=1,2,3,5,4,4b,6,7' 'reinstall+drop: backup precedes the DROP'
Assert-Eq (Plan @('-Patch') $inst)                        'PLAN=1,2,3,5,6,7'       'patch unchanged'
Assert-Eq (Plan @('-Upgrade') $inst)                      'PLAN=1,2,3,4,5,6,7'     'upgrade unchanged'
Write-Host ("plan.tests: " + $script:AssertCount + " assertions ok")
exit 0
```

- [ ] **Step 2: Run to verify it fails** — `-PrintPlan` is not a parameter → PowerShell error, Plan returns null.

- [ ] **Step 3: Implement**

In the `param(` block add two switches after `[switch]$ConfirmDataLoss,`:
```powershell
    [switch]$ForceOverwrite,   # menu-guarded Fresh over an existing install: lifts ONLY the non-empty-dir refusal (downgrade still refused)
    [switch]$PrintPlan,        # print PLAN=<steps> and exit 0 - dry run for the harness, no admin needed
```
Update the header comment lines 14-15 accordingly (add `[-ForceOverwrite]` and `[-PrintPlan]`).

In `Step1-Preflight` replace
```powershell
        if ($hasApp -and -not $Force) { Die "Fresh mode but $InstallDir already contains server.js. Use -Upgrade / -Reinstall, or -Force to overwrite." }
```
with
```powershell
        if ($hasApp -and -not $Force -and -not $ForceOverwrite) { Die "Fresh mode but $InstallDir already contains server.js. Use -Upgrade / -Reinstall, or the menu's guarded Fresh (-ForceOverwrite)." }
        if ($hasApp) { Log 'Fresh over an EXISTING installation: a full restore point is taken (step 5) before the database step' 'WARN' }
```

In `main`, replace the plan `switch` (lines 1094-1100) with:
```powershell
    # Plans. Step 5 (full restore point) ALWAYS precedes step 4 wherever step 4 can
    # DROP the database (reinstall -ConfirmDataLoss) or where the install overwrites an
    # existing one (fresh -ForceOverwrite/-Force with server.js present) - 2026-09-15.
    $hasAppAtStart = Test-Path (Join-Path $InstallDir 'server.js')
    $plan = @()
    switch ($Mode) {
        'fresh'     {
            if ($hasAppAtStart -and ($Force -or $ForceOverwrite)) { $plan = @('1','2','3','5','4','4b','6','7') }
            else { $plan = @('1','2','3','4','4b','6','7') }
            if ($SeedData) { $plan += '8' }
        }
        'upgrade'   { $plan = @('1','2','3','4','5','6','7') }   # 4 = verify only; new .env keys appended in 6
        'patch'     { $plan = @('1','2','3','5','6','7') }
        'reinstall' { $plan = @('1','2','3','5','4','4b','6','7') }
    }
    if ($PrintPlan) { Write-Output ('PLAN=' + ($plan -join ',')); exit 0 }
```
Note: `-PrintPlan` must exit before `Step1` (admin check). The `Log "Install-SDP $Mode start"` line above it writes to `C:\ProgramData\SDP-Dashboard\logs` — acceptable on the dev box (the folder already exists there); if it does not, `Log` creates it (line 94).

- [ ] **Step 4: Run the test** → `plan.tests: <N> assertions ok`, exit 0. Also a parse check: `powershell -NoProfile -Command "[scriptblock]::Create((Get-Content tools\installer\Install-SDP.ps1 -Raw)) | Out-Null; 'parse ok'"`.

- [ ] **Step 5: Commit**

```bash
git add tools/installer/Install-SDP.ps1 tools/installer/tests/plan.tests.ps1
git commit -m "fix(installer): backup BEFORE the DB step on reinstall + guarded fresh (-ForceOverwrite); -PrintPlan dry run"
```

---

### Task 6: Install-SDP — Step5 starts PG + dump check, `CREATE ROLE` via stdin, environment header

**Files:**
- Modify: `tools/installer/Install-SDP.ps1` (`Invoke-PsqlSuper` :639-645; Step4 psql fallback :798; `Step5-Backup` :828-839; main start :1085)

- [ ] **Step 1: Add `Invoke-PsqlSuperStdin`** right after `Invoke-PsqlSuper`:
```powershell
# Same as Invoke-PsqlSuper but the SQL travels on STDIN, never on the command line:
# a statement carrying a password (CREATE ROLE ... PASSWORD) must not be visible in
# process listings or a PowerShell transcript (the 4MyPeople transcript of 2026-09-15
# leaked its superuser password exactly that way).
function Invoke-PsqlSuperStdin([string]$sql) {
    $psql = Find-PgBin 'psql.exe'
    if (-not $psql) { Die 'psql.exe not found under Program Files\PostgreSQL' }
    $env:PGPASSWORD = Get-SuperPassword
    try { return ($sql | & $psql -h $cfg.PgHost -p $cfg.PgPort -U postgres -d postgres -v ON_ERROR_STOP=1 -t -A -f -) }
    finally { $env:PGPASSWORD = '' }
}
```
- [ ] **Step 2: Use it for the role creation** (line 798):
```powershell
            Invoke-PsqlSuperStdin ("CREATE ROLE sdp_app LOGIN PASSWORD '" + ($appPw -replace "'", "''") + "';") | Out-Null
```
- [ ] **Step 3: Step5 — start PG if stopped, verify the dump when a DROP will follow.** Replace `Step5-Backup` with:
```powershell
function Step5-Backup {
    $manage = Join-Path $here 'Manage-SDP.ps1'
    if (-not (Test-Path $manage)) { Die "Manage-SDP.ps1 not found next to this script: $manage" }
    # Step 5 now runs BEFORE step 4 on reinstall / fresh-over-existing, so the
    # PostgreSQL service may still be stopped: pg_dump needs it up.
    $svc = Get-Service postgresql* -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($svc -and $svc.Status -ne 'Running') { Log ('Starting the PostgreSQL service for the pre-change dump (' + $svc.Name + ')') 'STEP'; Start-Service $svc.Name; Start-Sleep -Seconds 3 }
    # Data-integrity baseline (compared again in step 7 on the success path).
    $script:CountsBefore = Get-SdpDbCounts $InstallDir
    if ($script:CountsBefore.reachable) { Log ('Data baseline: ' + (Format-Counts $script:CountsBefore.counts)) }
    else { Log ('Data baseline unavailable (' + $script:CountsBefore.error + ')') 'WARN' }
    $mArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $manage, '-Backup', '-Tag', ('pre-' + $script:BundleVer))
    if ($Config) { $mArgs += @('-Config', $Config) }
    $out = & powershell @mArgs
    if ($LASTEXITCODE -ne 0) { Die 'Pre-change backup failed - refusing to continue (see the manage-backup log)' }
    $zip = ($out | Select-Object -Last 1)
    if (-not ($zip -and (Test-Path $zip))) { Die "Backup ran but returned no zip path (got: '$zip')" }
    if ($ConfirmDataLoss -and -not (Test-ZipHasDump $zip)) {
        Die ('No database dump inside the restore point ' + (Split-Path $zip -Leaf) + ' - refusing to DROP the database. Check PG_URL / the PostgreSQL service, take a backup (menu 5) and retry.')
    }
    $script:RollbackZip = $zip
    Log ("Restore point: " + $zip) 'OK'
}
function Test-ZipHasDump([string]$zipPath) {
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
        try { return ((@($z.Entries | Where-Object { $_.FullName -match '\.sql$' })).Count -gt 0) } finally { $z.Dispose() }
    } catch { return $false }
}
function Format-Counts($c) {
    if (-not $c) { return 'n/a' }
    return (($script:SdpCountTables | ForEach-Object { $_ + ' ' + $(if ($c[$_] -eq $null) { '-' } else { $c[$_] }) }) -join ', ')
}
```
and dot-source the shared reader near the top of the file, right after `$PayloadInst = ...` (line 80):
```powershell
. (Join-Path $here 'SdpSituation.ps1')   # Get-SdpDbCounts + $script:SdpCountTables (shared with Detect-SDP.ps1)
$script:CountsBefore = $null
$script:DataCheck = 'skipped'
```
- [ ] **Step 4: Environment header.** Add a function after `Complete-Run` and call it as the first line of `main` (before `Log "Install-SDP $Mode start ..."`):
```powershell
# Environment header at the top of every log (mirrors the 4MyPeople installer).
# Secrets are reported as (set)/(not set) ONLY.
function Write-EnvHeader {
    $os = try { (Get-CimInstance Win32_OperatingSystem).Caption + ' build ' + (Get-CimInstance Win32_OperatingSystem).BuildNumber } catch { 'unknown' }
    $free = try { [math]::Round((New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($InstallDir)))).AvailableFreeSpace / 1GB, 1) } catch { '?' }
    $nodeV = try { (& node -v 2>$null) } catch { 'not on PATH' }
    $psqlV = if (Find-PgBin 'psql.exe') { 'found' } else { 'not found' }
    $ports = @(); foreach ($p in @($AppPort, [int]$cfg.PgPort)) { $ports += ('' + $p + '=' + $(if ((Get-PortListenerPids $p).Count -gt 0) { 'IN USE' } else { 'free' })) }
    $lines = @(
        '----- ENVIRONMENT -----',
        ('Timestamp        : ' + (Get-Date -Format 'o')),
        ('Run as user      : ' + $env:USERDOMAIN + '\' + $env:USERNAME),
        ('Computer         : ' + $env:COMPUTERNAME),
        ('OS               : ' + $os),
        ('PowerShell       : ' + $PSVersionTable.PSVersion + ' (' + $PSVersionTable.PSEdition + ')'),
        ('Free space       : ' + $free + ' GB on the install drive'),
        ('Mode / Config    : ' + $Mode + ' / ' + $(if ($Config) { $Config } else { 'config.psd1' })),
        ('Config (resolved): InstallDir=' + $InstallDir + '; AppPort=' + $AppPort + '; Service=' + $SvcName + '; PgHost=' + $cfg.PgHost + '; PgPort=' + $cfg.PgPort + '; DbName=' + $cfg.DbName),
        ('PG super password: ' + $(if ($cfg.StandardPgSuperPassword -or ($cfg.EnvAnswers -and $cfg.EnvAnswers.PG_SUPER_PASSWORD)) { '(set)' } else { '(not set)' })),
        ('node             : ' + $nodeV),
        ('psql             : ' + $psqlV),
        ('Ports            : ' + ($ports -join '  ')),
        '-----------------------')
    foreach ($l in $lines) { Add-Content -Path $LogFile -Value $l }
    Write-Host ($lines -join "`n") -ForegroundColor DarkGray
}
```
(`Get-PortListenerPids` already exists at line 166.)

- [ ] **Step 5: Verify** — parse check + harness:
```
powershell -NoProfile -Command "[scriptblock]::Create((Get-Content tools\installer\Install-SDP.ps1 -Raw)) | Out-Null; 'parse ok'"
powershell -NoProfile -ExecutionPolicy Bypass -File tools\installer\tests\run-all.ps1
```
Expected: `parse ok`, `all installer tests passed`. Grep proof that no `PASSWORD '` reaches a `-c` argument: `grep -n "PASSWORD" tools/installer/Install-SDP.ps1` shows only the `Invoke-PsqlSuperStdin` call and the EDB `--superpassword` line.

- [ ] **Step 6: Commit**

```bash
git add tools/installer/Install-SDP.ps1
git commit -m "feat(installer): step 5 starts PG + refuses a DROP without a dump; CREATE ROLE via stdin; environment header"
```

---

### Task 7: Install-SDP — data-integrity check + summary block

**Files:**
- Modify: `tools/installer/Install-SDP.ps1` (`Step7-Verify` success branch :995-1001; `Write-RunSummary` :128-149; main end :1118-1119)

- [ ] **Step 1: Data check on the success path.** In `Step7-Verify`, inside `if ($ok) {` before `Log 'Verification PASSED' 'OK'`:
```powershell
        $script:DataCheck = Get-DataCheck
        if ($script:DataCheck -like 'WARNING*') { Log ('Data check: ' + $script:DataCheck) 'ERROR' } else { Log ('Data check: ' + $script:DataCheck) 'OK' }
```
and add the function before `Step7-Verify`:
```powershell
# Compare the step-5 baseline with the counts after the restart. Any DECREASE is a
# red WARNING in the summary (never an automatic rollback: a rollback restores code
# only, the DB decision is the operator's - the message names the restore point).
function Get-DataCheck {
    if ($Mode -eq 'reinstall' -and $ConfirmDataLoss) { return 'skipped (database dropped by request)' }
    if (-not $script:CountsBefore) { return 'skipped (fresh install)' }
    if (-not $script:CountsBefore.reachable) { return 'skipped (db counts unavailable before)' }
    $after = Get-SdpDbCounts $InstallDir
    if (-not $after.reachable) { return 'skipped (db counts unavailable after: ' + $after.error + ')' }
    $drops = @()
    foreach ($t in $script:SdpCountTables) {
        $b = $script:CountsBefore.counts[$t]; $a = $after.counts[$t]
        if ($b -ne $null -and $a -ne $null -and $a -lt $b) { $drops += ($t + ' ' + $b + ' -> ' + $a) }
    }
    if ($drops.Count -gt 0) { return ('WARNING - ' + ($drops -join ', ') + ' - restore point: ' + (Split-Path $script:RollbackZip -Leaf)) }
    return ('OK (' + (Format-Counts $after.counts) + ')')
}
```
- [ ] **Step 2: Summary lines.** In `Write-RunSummary`, after `$lines += "Result: $result"` insert:
```powershell
    $iv = Get-JsonVersion (Join-Path $InstallDir 'version.json')
    $lines += ('Version: ' + $(if ($script:InstalledVerAtStart) { $script:InstalledVerAtStart } else { 'none' }) + ' -> ' + $script:BundleVer)
    $lines += ('Restore point: ' + $(if ($script:RollbackZip) { Split-Path $script:RollbackZip -Leaf } else { 'none (fresh install)' }))
    $lines += ('Database: ' + $(if ($Mode -eq 'reinstall' -and $ConfirmDataLoss) { 'DROPPED and recreated' } elseif ($Mode -eq 'fresh' -and -not $script:CountsBefore) { 'created' } else { 'preserved' }))
    $lines += ('.env: ' + $(if ($script:EnvExistedAtStart) { 'preserved (merged)' } else { 'created' }))
    $lines += ('Data check: ' + $script:DataCheck)
    $lines += ('Summary: ' + $SummaryFile)
```
and record the two "at start" facts in `main` right after `Write-EnvHeader`:
```powershell
    $script:InstalledVerAtStart = Get-JsonVersion (Join-Path $InstallDir 'version.json')
    $script:EnvExistedAtStart = Test-Path (Join-Path $InstallDir '.env')
```
- [ ] **Step 3: Console green box** at the end of `main` (replace the single `Log "Install ($Mode) finished OK..."` line):
```powershell
    Log '==================================================' 'OK'
    Log (' SDP Dashboard install complete.') 'OK'
    Log ('   Mode          : ' + $Mode.ToUpper() + $(if ($Mode -eq 'patch' -or $Mode -eq 'upgrade') { ' (code updated; database + data preserved)' } else { '' })) 'OK'
    Log ('   Version       : ' + $(if ($script:InstalledVerAtStart) { $script:InstalledVerAtStart } else { 'none' }) + ' -> ' + $script:BundleVer) 'OK'
    Log ('   Restore point : ' + $(if ($script:RollbackZip) { $script:RollbackZip } else { 'none (fresh install)' })) 'OK'
    Log ('   Data check    : ' + $script:DataCheck) $(if ($script:DataCheck -like 'WARNING*') { 'ERROR' } else { 'OK' })
    Log ('   Log           : ' + $LogFile) 'OK'
    Log ('   Summary       : ' + $SummaryFile) 'OK'
    Log '==================================================' 'OK'
```
- [ ] **Step 4: Verify** parse + harness (as Task 6). Then a **real Patch on the TEST instance** if it exists on this box (`C:\Apps\SDP-Dashboard-TEST`): `powershell -File tools\installer\Install-SDP.ps1 -Patch -Config config.test.psd1 -BundleRoot <a built bundle dir>` — see Task 10 for the E2E; skip here if no bundle is built yet.
- [ ] **Step 5: Commit**

```bash
git add tools/installer/Install-SDP.ps1
git commit -m "feat(installer): before/after data-integrity check + structured summary block"
```

---

### Task 8: Manage-SDP — pre-restore safety backup

**Files:**
- Modify: `tools/installer/Manage-SDP.ps1` (`'restore'` branch :154-195)
- Create: `tools/installer/tests/manage-restore.tests.ps1`

- [ ] **Step 1: Write the failing test** (dry, sqlite-shaped: no `PG_URL` so the DB branch never runs; proves the pre-restore backup is taken and the restore still works; uses a temp config with no pm2 → `Invoke-Pm2` WARNs and continues):
```powershell
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '_assert.ps1')
$manage = Join-Path $here '..\Manage-SDP.ps1'
$inst = New-TempDir 'sdp-mg-inst'
Set-Content (Join-Path $inst 'server.js') '// current' -Encoding ascii
Set-Content (Join-Path $inst '.env') 'REPORTS_BACKEND=sqlite' -Encoding ascii
New-Item -ItemType Directory -Path (Join-Path $inst 'tools\pg') -Force | Out-Null
Set-Content (Join-Path $inst 'tools\pg\dump-db.js') 'process.exit(1)' -Encoding ascii   # dump "fails" like a sqlite-only box
$bak = Join-Path (Split-Path $inst -Parent) ((Split-Path $inst -Leaf) + '-bak')
$cfg = Join-Path (New-TempDir 'sdp-cfg') 'c.psd1'
Set-Content $cfg ("@{ InstallDir = '" + $inst + "'; ServiceName = 'sdp-unit-none'; AppPort = 3499; BackupDir = '" + $bak + "'; PgHost='localhost'; PgPort=5432; DbName='x' }") -Encoding ascii
# a restore point holding an OLDER server.js
$stage = New-TempDir 'sdp-mg-stg'; Set-Content (Join-Path $stage 'server.js') '// older' -Encoding ascii
New-Item -ItemType Directory -Path $bak -Force | Out-Null
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath (Join-Path $bak 'sdp-restore_manual_20260901-120000.zip') -Force
& powershell -NoProfile -ExecutionPolicy Bypass -File $manage -Restore -Name 'sdp-restore_manual_20260901-120000.zip' -Force -Config $cfg | Out-Null
Assert-Eq $LASTEXITCODE 0 'restore exits 0'
Assert-Eq (Get-Content (Join-Path $inst 'server.js') -Raw).Trim() '// older' 'code restored'
$pre = Get-ChildItem $bak -Filter 'sdp-restore_pre-restore_*.zip'
Assert-Eq @($pre).Count 1 'exactly one pre-restore restore point was taken'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead($pre[0].FullName)
try { $names = @($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() }
Assert-True ($names -contains 'server.js') 'pre-restore point holds the CURRENT code'
Write-Host ("manage-restore.tests: " + $script:AssertCount + " assertions ok")
exit 0
```
- [ ] **Step 2: Run to verify it fails** — `exactly one pre-restore restore point` fails (0 found).
- [ ] **Step 3: Implement.** In the `'restore'` branch, replace the block from `Log "Restoring $Name" 'STEP'` up to (not including) `Invoke-Pm2 @('stop', $SvcName)` with:
```powershell
    # ---- safety backup of the CURRENT state, before anything is stopped or overwritten ----
    # Re-invoke this script (one action per invocation - the dailyjob pattern) and read the
    # zip path from its last stdout line, exactly as Install-SDP step 5 does.
    $preOut = & powershell -NoProfile -ExecutionPolicy Bypass -File $MyInvocation.MyCommand.Path -Backup -Tag pre-restore @(if ($Config) { @('-Config', $Config) })
    if ($LASTEXITCODE -ne 0) { Die 'Pre-restore backup FAILED - restore aborted, nothing changed.' }
    $preZip = ($preOut | Select-Object -Last 1)
    if (-not ($preZip -and (Test-Path $preZip))) { Die 'Pre-restore backup returned no zip - restore aborted, nothing changed.' }
    Log ('Pre-restore restore point: ' + (Split-Path $preZip -Leaf)) 'OK'
    # If the target carries a dump AND this install uses PostgreSQL, the DB will be DROPPED:
    # the safety point must then carry a dump too, or we would overwrite a database we cannot get back.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    function Test-ZipHasSql([string]$p) { $z = [System.IO.Compression.ZipFile]::OpenRead($p); try { return ((@($z.Entries | Where-Object { $_.FullName -match '\.sql$' })).Count -gt 0) } finally { $z.Dispose() } }
    if ((Test-ZipHasSql $zip) -and (Get-EnvValue 'PG_URL') -and -not (Test-ZipHasSql $preZip)) {
        Die 'No database dump in the pre-restore point - refusing to overwrite the database. Check PG_URL / the PostgreSQL service (menu C), then retry.'
    }
    Log "Restoring $Name" 'STEP'
```
- [ ] **Step 4: Run the test + harness** → `manage-restore.tests: <N> assertions ok`, `all installer tests passed`.
- [ ] **Step 5: Commit**

```bash
git add tools/installer/Manage-SDP.ps1 tools/installer/tests/manage-restore.tests.ps1
git commit -m "feat(installer): restore takes a pre-restore restore point first and refuses to drop a DB it cannot get back"
```

---

### Task 9: Setup.bat — Detect once per session, Show-Situation menu, gating, confirm flows

**Files:**
- Modify: `tools/installer/Setup.bat` (:54-119 menu; :155-178 reinstall; :179-206 fresh/demo; :219-231 restore; :282-287 done)

- [ ] **Step 1: Session state + Detect at `:menu`.** After line 60 (`if not defined PORT ...`) add:
```bat
set "SITJSON=%TEMP%\sdp-situation.json"
set "NEED_DETECT=1"
set "HASDEMO=0"
if exist "%HERE%\payload\demo\*.zip" set "HASDEMO=1"
```
Replace the whole `:menu` block **starting at the existing `:menu` label** (line 66) through the last `echo ===...` line before `set "CH="` with (the block below carries its own `:menu` label — do not keep the old one):
```bat
:menu
if "%NEED_DETECT%"=="1" (
  set "STATE=unknown"
  set "RECOMMENDED=none"
  set "DOWNGRADE=0"
  set "DB_REACHABLE=0"
  set "HAS_SERVER=0"
  set "IVER=unknown"
  set "BVER=unknown"
  for /f "usebackq tokens=1,* delims==" %%A in (`%PS% "%HERE%\Detect-SDP.ps1" -BundleRoot "%HERE%" -OutFile "%SITJSON%"`) do (
    if "%%A"=="STATE" set "STATE=%%B"
    if "%%A"=="RECOMMENDED" set "RECOMMENDED=%%B"
    if "%%A"=="DOWNGRADE" set "DOWNGRADE=%%B"
    if "%%A"=="DB_REACHABLE" set "DB_REACHABLE=%%B"
    if "%%A"=="HAS_SERVER" set "HAS_SERVER=%%B"
    if "%%A"=="INSTALLED_VER" set "IVER=%%B"
    if "%%A"=="BUNDLE_VER" set "BVER=%%B"
  )
  set "NEED_DETECT=0"
)
echo.
echo ==================================================================
echo    SDP Dashboard - Setup ^& Maintenance      Target : %APPDIR%
echo ==================================================================
%PS% "%HERE%\Show-Situation.ps1" -Situation "%SITJSON%" -HasDemo %HASDEMO%
```
(the old `for /f` that computed IVER/BVER and all the `echo` menu lines are removed — the renderer prints them.)

- [ ] **Step 2: Gating in the dispatch.** Replace lines `if "%CH%"=="1" goto patch` … `if /i "%CH%"=="D" goto demo` with:
```bat
if "%DOWNGRADE%"=="1" (
  if "%CH%"=="1" goto refuse_downgrade
  if "%CH%"=="2" goto refuse_downgrade
  if "%CH%"=="3" goto refuse_downgrade
  if "%CH%"=="4" goto refuse_downgrade
  if /i "%CH%"=="D" goto refuse_downgrade
)
if "%STATE%"=="unknown" (
  if "%CH%"=="1" goto refuse_unknown
  if "%CH%"=="2" goto refuse_unknown
  if "%CH%"=="3" goto refuse_unknown
  if "%CH%"=="4" goto refuse_unknown
  if /i "%CH%"=="D" goto refuse_unknown
)
if "%STATE%"=="empty" (
  if "%CH%"=="1" goto refuse_empty
  if "%CH%"=="2" goto refuse_empty
  if "%CH%"=="3" goto refuse_empty
)
if "%STATE%"=="partial" (
  if "%CH%"=="1" goto refuse_partial
  if "%CH%"=="2" goto refuse_partial
  if "%CH%"=="3" if "%HAS_SERVER%"=="0" goto refuse_partial
)
if "%CH%"=="1" goto patch
if "%CH%"=="2" goto upgrade
if "%CH%"=="3" goto reinstall
if "%CH%"=="4" goto fresh
if /i "%CH%"=="D" goto demo
```
and add three labels after `:slog`'s `goto :eof`:
```bat
:refuse_downgrade
echo.
echo   Refused: this bundle (%BVER%) is OLDER than the installed version (%IVER%). Use a newer bundle.
goto menu
:refuse_empty
echo.
echo   Not applicable: nothing is installed in %APPDIR% yet. Use 4 (Fresh install).
goto menu
:refuse_unknown
echo.
echo   Refused: the installation state could not be read (see the note above). Run 9 (Diagnostics), fix the cause, then retry.
goto menu
:refuse_partial
echo.
echo   Not applicable: the installation in %APPDIR% is incomplete - see the note above. With server.js present use E then 3; without server.js use 4 (Fresh, your .env is kept).
goto menu
```
- [ ] **Step 3: Reinstall = two red screens.** Replace the `:reinstall` block (from `:reinstall` to its `goto done`) with:
```bat
:reinstall
%PS% "%HERE%\Confirm-Destructive.ps1" -Action reinstall -Situation "%SITJSON%"
if errorlevel 1 (
  echo   Cancelled - nothing changed.
  goto menu
)
set "DROPFLAG="
if "%DB_REACHABLE%"=="1" (
  set "DB="
  set /p DB=  Also DROP + recreate the PostgreSQL database? [y/N] - Enter = keep:
  if /i "!DB!"=="y" (
    %PS% "%HERE%\Confirm-Destructive.ps1" -Action dropdb -Situation "%SITJSON%"
    if errorlevel 1 (
      echo   Cancelled - nothing changed.
      goto menu
    )
    set "DROPFLAG=-ConfirmDataLoss"
  )
)
call :slog "Reinstall - start (drop: !DROPFLAG!)"
echo.
echo   ^>^> REINSTALL - redeploying from the bundle...
%PS% "%INSTALL%" -Reinstall !DROPFLAG! -BundleRoot "%HERE%"
call :slog "Reinstall - finished (exit %errorlevel%)"
goto done
```
- [ ] **Step 4: Guarded Fresh / Demo.** Replace the `:fresh` and `:demo` blocks:
```bat
:fresh
set "FOFLAG="
if not "%STATE%"=="empty" (
  %PS% "%HERE%\Confirm-Destructive.ps1" -Action fresh-over-existing -Situation "%SITJSON%"
  if errorlevel 1 (
    echo   Cancelled - nothing changed.
    goto menu
  )
  set "FOFLAG=-ForceOverwrite"
)
call :slog "Fresh install - start (!FOFLAG!)"
echo.
echo   ^>^> FRESH INSTALL - prerequisites, PostgreSQL, .env questionnaire, app.
%PS% "%INSTALL%" -Fresh !FOFLAG! -BundleRoot "%HERE%"
call :slog "Fresh install - finished (exit %errorlevel%)"
goto done

:demo
if "%HASDEMO%"=="0" (
  echo   This bundle carries no demo dataset - option D is not available.
  goto menu
)
set "FOFLAG="
if not "%STATE%"=="empty" (
  %PS% "%HERE%\Confirm-Destructive.ps1" -Action fresh-over-existing -Situation "%SITJSON%"
  if errorlevel 1 (
    echo   Cancelled - nothing changed.
    goto menu
  )
  set "FOFLAG=-ForceOverwrite"
)
call :slog "Demo laptop - start (!FOFLAG!)"
echo.
echo   ^>^> DEMO LAPTOP - fresh install, then the bundled dataset is loaded.
%PS% "%INSTALL%" -Fresh -SeedData !FOFLAG! -BundleRoot "%HERE%"
call :slog "Demo laptop - finished (exit %errorlevel%)"
goto done
```
(keep whatever `:demo` previously echoed about the dataset if it carried extra lines — only the guard + flag are new.)
- [ ] **Step 5: Restore = red screen, then `-Force`.** In `:restorept`, replace the lines from `call :slog "Restore %RP%"` to the `%PS% "%MANAGE%" -Restore -Name "%RP%"` call with:
```bat
%PS% "%HERE%\Confirm-Destructive.ps1" -Action restore -Situation "%SITJSON%" -Target "%RP%"
if errorlevel 1 (
  echo   Cancelled - nothing changed.
  goto menu
)
call :slog "Restore %RP%"
%PS% "%MANAGE%" -Restore -Name "%RP%" -Force
```
- [ ] **Step 6: Refresh the situation after every action.** In `:done` add `set "NEED_DETECT=1"` before `goto menu`.
- [ ] **Step 7: Smoke the batch without elevation** (from a cmd prompt, on this dev box, against a temp bundle dir so nothing real runs):
```
mkdir %TEMP%\sdp-setup-smoke && copy tools\installer\*.* %TEMP%\sdp-setup-smoke\ >nul
echo {"version":"9.9.9"} > %TEMP%\sdp-setup-smoke\version.json
set SDP_SETUP_NOELEVATE=1
echo 0 | %TEMP%\sdp-setup-smoke\Setup.bat
```
Expected: the coloured situation block + grouped menu renders for the real `C:\Apps\SDP-Dashboard` target (STATE reflects the dev box), the piped `0` exits. Then `(echo 1& echo 0) | ...Setup.bat` when STATE is `empty` on the box → prints "Not applicable: nothing is installed" and returns to the menu (never runs Install-SDP). **Do not** pick 3/4/6 in this smoke on the prod path.
- [ ] **Step 8: Commit**

```bash
git add tools/installer/Setup.bat
git commit -m "feat(installer): situation-aware menu - detect once, recommended-first coloured menu, gated modes, red confirm screens"
```

---

### Task 10: Docs, CLAUDE.md, E2E on the TEST instance

**Files:**
- Modify: `docs/INSTALLER.md`, `CLAUDE.md`

- [ ] **Step 1: `docs/INSTALLER.md`** — replace the "Sur le serveur cible" table + "Garanties" with the new flow: the situation block, RECOMMENDED / OTHER / DATA groups, the four phrases (`REINSTALL`, `DROP <db>`, `OVERWRITE <serveur>`, `RESTORE <date>`), "sauvegarde AVANT toute suppression, DROP refusé sans dump", "contrôle d'intégrité avant/après dans le résumé", "restauration = restore point pre-restore d'abord", and the secrets rule (jamais en ligne de commande). Add a "Tests" paragraph: `tools\installer\tests\run-all.ps1`.
- [ ] **Step 2: `CLAUDE.md`** — add a "⚡ Current state (as of 2026-09-15 — Installer safety parity)" paragraph (5-8 lines) below the lot-1 audit block, and one Known Pitfalls row: **"Secrets never on a command line the installer builds (transcripts + process listings capture them — the 4MyPeople transcript of 2026-09-15 leaked its PG superuser password); SQL with a password goes through `Invoke-PsqlSuperStdin`; the only exception is the EDB `--superpassword` argument (fresh only)."** Also update the "Bundle layout" line in `tools/installer-build/build-installer.ps1`'s header comment (line 19) to list the 4 new scripts.
- [ ] **Step 3: E2E on the TEST instance (user-assisted if a built bundle is needed).** Build a dev bundle once: `powershell -File tools\installer-build\build-installer.ps1 -DevBuild` (resumable; needs the cache). Extract the SFX (or use the staged bundle dir the build prints) and, with `SDP_SETUP_NOELEVATE` unset (elevation needed), run `Setup.bat` **with `-Config config.test.psd1` semantics**: the menu scripts read `config.psd1` next to them — for the TEST instance copy `config.test.psd1` over the bundle's `config.psd1` merge target by running the engine directly instead:
  1. `Install-SDP.ps1 -Fresh -Config config.test.psd1 -NoBrowser -BundleRoot <bundle>` on an empty `C:\Apps\SDP-Dashboard-TEST` → summary shows `Database: created`, `Data check: skipped (fresh install)`.
  2. `-Patch -Config config.test.psd1` → `Data check: OK (...)`, `Restore point: sdp-restore_pre-<ver>_*.zip`.
  3. `-Reinstall -ConfirmDataLoss -Config config.test.psd1` → log shows step 5 **before** step 4, `No database dump inside...` NOT raised, `Database: DROPPED and recreated`, `Data check: skipped (database dropped by request)`.
  4. `Manage-SDP.ps1 -Restore -Name <the pre-reinstall zip> -Force -Config config.test.psd1` → a `sdp-restore_pre-restore_*.zip` appears first, then the data is back.
  5. `Confirm-Destructive.ps1 -Action dropdb -Situation <json from Detect-SDP -Config config.test.psd1>` typed by hand → the counts line shows the TEST DB numbers.
  Record the five outcomes in the commit message.
- [ ] **Step 4: Full harness + repo suite unaffected**: `tools\installer\tests\run-all.ps1` green; `node --test --test-force-exit tests/backup-schedule.test.js` still green (it references Manage-SDP's schedule surface, untouched).
- [ ] **Step 5: Commit**

```bash
git add docs/INSTALLER.md CLAUDE.md tools/installer-build/build-installer.ps1
git commit -m "docs(installer): safety-parity operator guide + memory; E2E on the TEST instance recorded"
```

---

## Done criteria

- Harness green (`run-all.ps1`): situation, detect, confirm, show, plan, manage-restore.
- On the TEST instance: fresh → patch → reinstall+drop → restore all leave the summary with the new lines, and the reinstall log shows step 5 before step 4.
- `grep -n "PASSWORD '" tools/installer/*.ps1` shows only the stdin call.
- A menu run on a box with an install shows the coloured block, the recommended entry first, and typing `4` opens the red screen instead of failing later.
