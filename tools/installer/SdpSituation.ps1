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
