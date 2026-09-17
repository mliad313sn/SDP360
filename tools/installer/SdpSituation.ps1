# =====================================================================
# SdpSituation.ps1 - shared, read-only "what is on this machine" reader.
# Dot-sourced by Detect-SDP.ps1 (menu) and Install-SDP.ps1 (data check),
# so there is exactly ONE count query and ONE verdict rule set.
# Never throws: every probe is try/catch -> $null. KEEP PURE ASCII.
# =====================================================================
$script:SdpCountTables = @('sites', 'weekly_reports', 'md_meetings', 'insp_inspections', 'users', 'assets')
$script:SdpPgRoots = @('C:\Program Files\PostgreSQL', 'C:\Program Files (x86)\PostgreSQL')

# ONE .env parsing rule for every PowerShell reader (a .env file on disk, or a
# .env entry read out of a restore-point zip), aligned with tools\pg\dump-db.js
# loadDotEnv():
#   - a leading UTF-8 BOM (U+FEFF) is ignored;
#   - '#' comment lines are ignored;
#   - the KEY is matched CASE-SENSITIVELY (pg_url is not PG_URL), with optional
#     spaces around it and around '=';
#   - the LAST matching line wins (dump-db overwrites its map line by line),
#     even when that last value is empty;
#   - the value is trimmed, then ONE surrounding single/double quote is
#     stripped at each end (dump-db.js: replace(/^["']|["']$/g, '')).
# Returns $null when the key is absent or its (last) value is empty. Never throws.
function Get-SdpEnvTextValue([string]$text, [string]$key) {
    if (-not $text) { return $null }
    if ($text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
    $rx = '^\s*' + [regex]::Escape($key) + '\s*=(.*)$'
    $found = $false; $last = $null
    foreach ($line in ($text -split "`r?`n")) {
        if ($line.TrimStart().StartsWith('#')) { continue }
        if ($line -cmatch $rx) { $found = $true; $last = $Matches[1] }
    }
    if (-not $found) { return $null }
    $v = $last.Trim() -replace '^["'']|["'']$', ''
    if ($v) { return $v }
    return $null
}

# Strict variant of Get-SdpEnvValue for callers that must FAIL CLOSED: $null
# only when the .env file does not exist; THROWS when it exists but cannot be
# read (locked, access denied, ...). Get-SdpEnvValue below swallows that case.
function Get-SdpEnvValueStrict([string]$installDir, [string]$key) {
    $envFile = Join-Path $installDir '.env'
    if (-not (Test-Path -LiteralPath $envFile)) { return $null }
    return (Get-SdpEnvTextValue ([System.IO.File]::ReadAllText($envFile)) $key)
}
function Get-SdpEnvValue([string]$installDir, [string]$key) {
    try {
        $envFile = Join-Path $installDir '.env'
        if (-not (Test-Path -LiteralPath $envFile)) { return $null }
        return (Get-SdpEnvTextValue ([System.IO.File]::ReadAllText($envFile)) $key)
    } catch { return $null }
}

# Which database a postgres URL points at, WITHOUT its credentials:
# @{ db; host; port } or $null (not an absolute URL, no database name, bad port).
# The host is lower-cased and the loopback spellings (localhost, 127.0.0.1, ::1)
# are folded to 'localhost'; a missing port is 5432 (libpq default - .NET gives
# -1 for the unknown postgres scheme). The database name is case-sensitive, as
# in a libpq connection. Never throws; never returns the user or the password.
function Get-SdpPgUrlTarget([string]$url) {
    try {
        if (-not $url) { return $null }
        $u = $null
        if (-not [System.Uri]::TryCreate($url, [System.UriKind]::Absolute, [ref]$u)) { return $null }
        if ($u.Scheme -notin @('postgres', 'postgresql')) { return $null }
        $db = [System.Uri]::UnescapeDataString($u.AbsolutePath.TrimStart('/'))
        if (-not $db) { return $null }
        $port = if ($u.Port -gt 0) { $u.Port } else { 5432 }
        return @{ db = $db; host = (ConvertTo-SdpPgHost $u.Host); port = [int]$port }
    } catch { return $null }
}
function ConvertTo-SdpPgHost([string]$h) {
    $x = ([string]$h).Trim().ToLowerInvariant().Trim('[', ']')
    if (-not $x -or $x -eq 'localhost') { return 'localhost' }
    # IP literals: .NET expands [::1] to 0000:...:0001, so compare parsed
    # addresses (127.0.0.1 / ::1 -> localhost, anything else -> canonical form).
    $ip = $null
    if ([System.Net.IPAddress]::TryParse($x, [ref]$ip)) {
        if ($ip.Equals([System.Net.IPAddress]::Loopback) -or $ip.Equals([System.Net.IPAddress]::IPv6Loopback)) { return 'localhost' }
        return $ip.ToString()
    }
    return $x
}
# $true only when $url names exactly the database $db on $pgHost:$pgPort (the
# one the installer's own psql calls target). Pure, never throws; an unparsable
# URL is never "the same".
function Test-SdpSameDatabase([string]$url, [string]$db, [string]$pgHost, $pgPort) {
    try {
        $t = Get-SdpPgUrlTarget $url
        if (-not $t) { return $false }
        $p = 5432
        if ("$pgPort".Trim()) { $p = [int]"$pgPort" }
        return (($t.db -ceq [string]$db) -and ($t.host -eq (ConvertTo-SdpPgHost $pgHost)) -and ($t.port -eq $p))
    } catch { return $false }
}

# Never throws: roots are injectable via $script:SdpPgRoots (tests override it),
# the version-folder sort uses a safe numeric key (non-numeric names sort last,
# never crash), and the whole body is wrapped so any surprise still yields $null.
# Generalised over the exe name (psql.exe, pg_dump.exe, ...) so Install-SDP's
# Find-PgBin can be a one-line wrapper instead of a second copy of this logic.
function Find-SdpPgBin([string]$exe) {
    try {
        foreach ($root in $script:SdpPgRoots) {
            if (Test-Path $root) {
                foreach ($v in (Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | Sort-Object { $val = 0.0; if ([double]::TryParse($_.Name, [ref]$val)) { $val } else { -1 } } -Descending)) {
                    $p = Join-Path $v.FullName ('bin\' + $exe)
                    if (Test-Path $p) { return $p }
                }
            }
        }
        return $null
    } catch { return $null }
}
function Find-SdpPsql { return (Find-SdpPgBin 'psql.exe') }

# Exact counts of the core tables + DB size, as the APP role from PG_URL.
# One psql session fed on stdin; a missing table yields null for that table
# (undefined_table / insufficient_privilege are caught inside the DO block),
# never a failed query. LC_MESSAGES=C keeps any psql error text pure ASCII.
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
    BEGIN EXECUTE format('SELECT count(*) FROM %I', r) INTO c; EXCEPTION WHEN undefined_table OR insufficient_privilege THEN c := NULL; END;
    INSERT INTO _sdp_counts VALUES (r, c);
  END LOOP; END `$`$;
SELECT t || '=' || COALESCE(n::text, 'null') FROM _sdp_counts ORDER BY t;
SELECT 'size_mb=' || round(pg_database_size(current_database()) / 1048576.0, 1);
"@
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    # The caller's own values (a PGCONNECT_TIMEOUT the operator set, a
    # PGPASSWORD another step is using) are put back exactly as they were -
    # restored when they existed, removed when they did not.
    $envKeys = @('PGPASSWORD', 'PGCONNECT_TIMEOUT', 'LC_MESSAGES')
    $envSaved = @{}
    foreach ($k in $envKeys) { $envSaved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process') }
    $env:PGPASSWORD = $pw; $env:PGCONNECT_TIMEOUT = '10'; $env:LC_MESSAGES = 'C'
    try {
        $out = ($sql | & $psql -h $pgHost -p $pgPort -U $user -d $db -w -q -t -A -v ON_ERROR_STOP=1 -f - 2>&1)
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $old
        # SetEnvironmentVariable with $null removes the variable.
        foreach ($k in $envKeys) { [Environment]::SetEnvironmentVariable($k, $envSaved[$k], 'Process') }
    }
    $lines = @($out | ForEach-Object { "$_" } | Where-Object { $_ -match '^[a-z_]+=' })
    if ($code -ne 0 -or $lines.Count -eq 0) {
        $r.error = ((($out | ForEach-Object { "$_" }) -join ' ').Trim() -replace '\s+', ' '); if (-not $r.error) { $r.error = 'psql exit ' + $code }
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

# One table's count read out of either shape Get-SdpDbCounts' callers hand in:
# a Hashtable (what Get-SdpDbCounts itself returns) or a PSCustomObject (a
# fixture built via ConvertFrom-Json, or by hand with [pscustomobject]@{}).
# $null (never throws) when $counts itself is $null, or the table key/property
# is absent, or reading it errors for any other reason.
function Get-SdpCountValue($counts, [string]$table) {
    if ($null -eq $counts) { return $null }
    try {
        if ($counts -is [System.Collections.IDictionary]) {
            if ($counts.Contains($table)) { return $counts[$table] } else { return $null }
        }
        $prop = $counts.PSObject.Properties[$table]
        if ($prop) { return $prop.Value } else { return $null }
    } catch { return $null }
}

# Pure before/after comparison over $script:SdpCountTables (Install-SDP's data-
# integrity check, Task 7): an array of 'table before -> after' strings, one
# per table whose count DECREASED between the two counts. Empty when nothing
# dropped. Never throws - tolerates $null for either argument, a table key
# missing or null on either side (ignored, not a drop), and accepts either a
# Hashtable or a PSCustomObject (or a mix of the two) for $before/$after. An
# INCREASE is ignored; only a real decrease is reported.
function Compare-SdpCounts($before, $after) {
    $drops = @()
    if ($null -eq $before -or $null -eq $after) { return $drops }
    foreach ($t in $script:SdpCountTables) {
        try {
            $b = Get-SdpCountValue $before $t
            $a = Get-SdpCountValue $after $t
            if ($null -eq $b -or $null -eq $a) { continue }
            # Cast BOTH sides: a string fixture '10' vs '9' would otherwise
            # compare lexically ('10' -lt '9' is true) and invert the verdict.
            $bn = [long]$b; $an = [long]$a
            if ($an -lt $bn) { $drops += ($t + ' ' + $bn + ' -> ' + $an) }
        } catch { }
    }
    return $drops
}

# Opens $zipPath, finds the ROOT entry named exactly $entryName (or $null) and
# returns whatever $action returns when invoked with that entry. The archive is
# always disposed. THROWS when the zip cannot be opened - callers decide
# whether that is fatal (Manage-SDP -Restore) or a plain "no" (Test-SdpZipHasDump).
function Invoke-SdpZipRootEntry([string]$zipPath, [string]$entryName, [scriptblock]$action) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $entry = $null
        foreach ($x in $z.Entries) { if ($x.FullName -eq $entryName) { $entry = $x; break } }
        return (& $action $entry)
    } finally { $z.Dispose() }
}
# @{ found = bool; text = string-or-null } for a ROOT entry, read in memory
# (never extracted to disk). Throws if the zip cannot be read.
function Get-SdpZipRootEntryText([string]$zipPath, [string]$entryName) {
    return (Invoke-SdpZipRootEntry $zipPath $entryName {
        param($e)
        if (-not $e) { return @{ found = $false; text = $null } }
        $sr = New-Object System.IO.StreamReader($e.Open())
        try { $t = $sr.ReadToEnd() } finally { $sr.Dispose() }
        return @{ found = $true; text = $t }
    })
}
# $true when the zip has a ROOT entry $entryName. Throws if the zip cannot be read.
function Test-SdpZipHasRootEntry([string]$zipPath, [string]$entryName) {
    return [bool](Invoke-SdpZipRootEntry $zipPath $entryName { param($e) return [bool]$e })
}
# Pure: the MAJOR version of the pg_dump that wrote a plain-SQL dump, from its
# header text (the first lines of the file), or $null when it cannot be told.
# The "-- Dumped by pg_dump version N.M" line decides (the pg_dump version is
# what fixes the SQL emitted - pg_dump 17 writes SET transaction_timeout, which
# an older server rejects); "-- Dumped from database version N.M" is only the
# fallback when that line is absent. 9.6 -> 9 (same scale as the server side).
function ConvertFrom-SdpDumpHeader([string]$text) {
    if (-not $text) { return $null }
    $m = [regex]::Match($text, '(?m)^--\s*Dumped by pg_dump version\s+(\d+)(\.\d+)*')
    if (-not $m.Success) { $m = [regex]::Match($text, '(?m)^--\s*Dumped from database version\s+(\d+)(\.\d+)*') }
    if (-not $m.Success) { return $null }
    $v = 0
    if (-not [int]::TryParse($m.Groups[1].Value, [ref]$v) -or $v -le 0) { return $null }
    return $v
}
# Pure: server_version_num (e.g. '160004', '90624') -> major (16, 9), or $null.
function ConvertFrom-SdpServerVersionNum([string]$text) {
    if (-not $text) { return $null }
    $t = $text.Trim()
    if ($t -notmatch '^\d{5,7}$') { return $null }
    return [int][Math]::Floor([int]$t / 10000)
}
# Major pg_dump version of the ROOT sdp_dashboard.sql of a restore point (read
# in memory, first 40 lines only), or $null when the entry is missing or its
# header cannot be parsed. Throws if the zip cannot be read.
function Get-SdpZipDumpVersion([string]$zipPath) {
    return (Invoke-SdpZipRootEntry $zipPath 'sdp_dashboard.sql' {
        param($e)
        if (-not $e) { return $null }
        $sr = New-Object System.IO.StreamReader($e.Open())
        try {
            $head = New-Object System.Text.StringBuilder
            for ($i = 0; $i -lt 40; $i++) {
                $l = $sr.ReadLine()
                if ($null -eq $l) { break }
                [void]$head.AppendLine($l)
            }
        } finally { $sr.Dispose() }
        return (ConvertFrom-SdpDumpHeader $head.ToString())
    })
}
# Never throws: used by Install-SDP (Step5, refuse a DROP without a dump) and
# Manage-SDP (-Restore, same rule before overwriting a live install). A restore
# point is a copy of the whole install dir, so it always carries repo files
# like db\postgres\...\001_init.sql - only a ROOT sdp_dashboard.sql PROVES the
# dump itself made it in (Task 3 review, 2026-09-16). Non-empty is not enough
# either: pg_dump writes plain SQL top-to-bottom, so a killed/failed run (the
# process died, the disk filled, the box lost power mid-dump) can leave a
# truncated-but-non-empty file - only the presence of pg_dump's OWN trailer
# comment, `-- PostgreSQL database dump complete`, at the very end proves the
# dump reached completion (dump-db.js additionally deletes its own partial
# output on failure, but a restore point can predate that fix, or come from
# a different pg_dump).
function Test-SdpZipHasDump([string]$zipPath) {
    $trailer = '-- PostgreSQL database dump complete'
    $tailSize = 4096
    try {
        if (-not (Test-Path -LiteralPath $zipPath)) { return $false }
        return [bool](Invoke-SdpZipRootEntry $zipPath 'sdp_dashboard.sql' {
            param($e)
            if (-not $e -or $e.Length -le 0) { return $false }
            $s = $e.Open()
            try {
                # Streaming last-N-bytes: a ZIP deflate stream is forward-only
                # (no Seek), and dumps run tens of MB, so read in chunks and
                # keep only a sliding window of the last $tailSize bytes seen -
                # never buffer the whole entry just to check its tail.
                $chunk = New-Object byte[] 8192
                $tail = New-Object byte[] $tailSize
                $tailLen = 0
                while ($true) {
                    $read = $s.Read($chunk, 0, $chunk.Length)
                    if ($read -le 0) { break }
                    if ($read -ge $tailSize) {
                        [Array]::Copy($chunk, $read - $tailSize, $tail, 0, $tailSize)
                        $tailLen = $tailSize
                    } else {
                        $keep = $tailSize - $read
                        $moveLen = if ($tailLen -gt 0) { [Math]::Min($keep, $tailLen) } else { 0 }
                        if ($moveLen -gt 0) { [Array]::Copy($tail, $tailLen - $moveLen, $tail, 0, $moveLen) }
                        [Array]::Copy($chunk, 0, $tail, $moveLen, $read)
                        $tailLen = $moveLen + $read
                    }
                }
                $text = [System.Text.Encoding]::ASCII.GetString($tail, 0, $tailLen)
                return ($text.Contains($trailer))
            } finally { $s.Dispose() }
        })
    } catch { return $false }
}
function Get-SdpFileSha256([string]$path) {
    if (-not (Test-Path $path)) { return $null }
    return (Get-FileHash -Path $path -Algorithm SHA256).Hash
}

# SHA-256 of the installed package-lock.json vs the one INSIDE payload\app.zip.
# Prefers the ROOT entry (package-lock.json at the zip root); falls back to a
# nested match for bundles that stage it under a sub-folder.
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
            $entry = $zip.Entries | Where-Object { $_.FullName -eq 'package-lock.json' } | Select-Object -First 1
            if (-not $entry) { $entry = $zip.Entries | Where-Object { $_.FullName -match '(^|/)package-lock\.json$' } | Select-Object -First 1 }
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

# $jlist (parsed `pm2 jlist`) is optional: pass it in when the caller already
# fetched it (Get-SdpSituation does, once); omit it (or pass $null) and this
# function fetches its own, so the signature keeps working standalone.
function Get-SdpPm2State([string]$svcName, $jlist = $null) {
    $pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
    if (-not $pm2) { return 'absent' }
    try {
        if ($null -eq $jlist) { $jlist = (cmd /c 'pm2 jlist 2>nul' | Out-String | ConvertFrom-Json) }
        foreach ($p in $jlist) { if ($p.name -eq $svcName) { return $p.pm2_env.status } }
    } catch { }
    return 'absent'
}

# Same $jlist convention as Get-SdpPm2State (see above).
function Get-SdpPortOwner([int]$port, [string]$svcName, [string]$installDir, $jlist = $null) {
    $pids = @()
    try {
        $lines = netstat -ano -p tcp | Select-String (':' + $port + '\s+.*LISTENING\s+(\d+)')
        foreach ($l in $lines) { $pids += [int]$l.Matches[0].Groups[1].Value }
    } catch { }
    if ($pids.Count -eq 0) { return 'free' }
    try {
        if ($null -eq $jlist) { $jlist = (cmd /c 'pm2 jlist 2>nul' | Out-String | ConvertFrom-Json) }
        foreach ($p in $jlist) { if ($p.name -eq $svcName -and $pids -contains [int]$p.pid) { return 'ours' } }
    } catch { }
    $pidFile = Join-Path $installDir '.sdp-node.pid'
    if (Test-Path $pidFile) { try { if ($pids -contains [int](Get-Content $pidFile | Select-Object -First 1)) { return 'ours' } } catch { } }
    return 'foreign'
}

# The one situation object. $cfg = merged config hashtable (InstallDir, ServiceName,
# AppPort, BackupDir ...). $bundleRoot = folder holding version.json + payload\.
# Each probe group is its own try/catch: a failing probe degrades to its null/
# default shape instead of aborting the whole situation read, and the verdict
# is computed from whatever survived.
function Get-SdpSituation($cfg, [string]$bundleRoot) {
    $dir = [string]$cfg.InstallDir
    $backupDir = try { [System.IO.Path]::GetFullPath((Join-Path $dir $cfg.BackupDir)) } catch { $null }

    $install = $null
    try {
        $install = @{
            dir = $dir; exists = (Test-Path $dir)
            has_server_js = (Test-Path (Join-Path $dir 'server.js'))
            version = (Get-SdpJsonVersion (Join-Path $dir 'version.json'))
            has_env = (Test-Path (Join-Path $dir '.env'))
            has_node_modules = (Test-Path (Join-Path $dir 'node_modules'))
            has_data_dir = (Test-Path (Join-Path $dir 'data'))
        }
    } catch { }
    if (-not $install) { $install = @{ dir = $dir; exists = $false; has_server_js = $false; version = $null; has_env = $false; has_node_modules = $false; has_data_dir = $false } }

    $runtime = $null
    try {
        $nodeVer = $null; try { $nodeVer = (& node -v 2>$null) } catch { }
        $pm2List = $null
        try { $pm2List = (cmd /c 'pm2 jlist 2>nul' | Out-String | ConvertFrom-Json) } catch { }
        $runtime = @{
            pm2_process = (Get-SdpPm2State $cfg.ServiceName $pm2List)
            port_owner = (Get-SdpPortOwner ([int]$cfg.AppPort) $cfg.ServiceName $dir $pm2List)
            node_version = $nodeVer
        }
    } catch { }
    if (-not $runtime) { $runtime = @{ pm2_process = 'absent'; port_owner = 'free'; node_version = $null } }

    $db = @{ reachable = $false; exists = $false; size_mb = $null; counts = $null; error = 'no install' }
    try {
        if ($install.has_env) { $db = Get-SdpDbCounts $dir; $db.exists = $db.reachable }
    } catch { $db = @{ reachable = $false; exists = $false; size_mb = $null; counts = $null; error = 'probe failed' } }

    $backups = @{ dir = $backupDir; last_full = $null; last_db = $null; count = 0 }
    try {
        if ($backupDir -and (Test-Path $backupDir)) {
            $full = Get-ChildItem $backupDir -Filter 'sdp-restore_*.zip' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
            $dbo  = Get-ChildItem $backupDir -Filter 'sdp-db_*.sql' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
            $backups.count = @($full).Count + @($dbo).Count
            if ($full) { $f = $full[0]; $backups.last_full = @{ name = $f.Name; age_hours = [math]::Round(((Get-Date) - $f.LastWriteTime).TotalHours, 1); size_mb = [math]::Round($f.Length / 1MB, 1) } }
            if ($dbo)  { $f = $dbo[0];  $backups.last_db   = @{ name = $f.Name; age_hours = [math]::Round(((Get-Date) - $f.LastWriteTime).TotalHours, 1); size_mb = [math]::Round($f.Length / 1MB, 1) } }
        }
    } catch { }

    $bundle = $null
    try {
        $bv = $null; $sha = $null
        $bvPath = Join-Path $bundleRoot 'version.json'
        if (Test-Path $bvPath) { try { $o = Get-Content $bvPath -Raw | ConvertFrom-Json; $bv = $o.version; $sha = $o.sha } catch { } }
        $bundle = @{ version = $bv; sha = $sha; lockfile_same_as_installed = (Get-SdpLockfileMatch $dir $bundleRoot) }
    } catch { }
    if (-not $bundle) { $bundle = @{ version = $null; sha = $null; lockfile_same_as_installed = $null } }

    $disk = @{ free_gb = $null }
    try {
        $drive = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($dir)); $free = [math]::Round((New-Object System.IO.DriveInfo($drive)).AvailableFreeSpace / 1GB, 1)
        $disk = @{ free_gb = $free }
    } catch { }

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
    if ($bundle.version -and $install.version) {
        $pv = $null; $pi = $null
        if ([version]::TryParse(($bundle.version -replace '^v', ''), [ref]$pv) -and [version]::TryParse(($install.version -replace '^v', ''), [ref]$pi)) {
            if ($pv -lt $pi) { $downgrade = $true; $notes += ('bundle ' + $bundle.version + ' is OLDER than the installed ' + $install.version + ' - use a newer bundle') }
        } else { $notes += 'version strings are not numeric - downgrade check skipped' }
    }
    if ($backups.last_full -and $backups.last_full.age_hours -gt 168) { $notes += ('last full restore point is ' + [math]::Round($backups.last_full.age_hours / 24) + ' days old') }
    if ($runtime.port_owner -eq 'foreign') { $notes += ('port ' + $cfg.AppPort + ' is held by a foreign process') }
    $verdict = @{ state = $state; recommended = $recommended; downgrade = $downgrade; notes = $notes }
    return @{ install = $install; runtime = $runtime; db = $db; backups = $backups; bundle = $bundle; disk = $disk; verdict = $verdict }
}
