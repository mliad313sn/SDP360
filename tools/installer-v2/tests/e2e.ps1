<#
  End-to-end test of Setup.exe on a clean Windows machine (CI: windows-latest, .github/workflows/installer.yml).

    pwsh tools/installer-v2/tests/e2e.ps1 -Setup dist\SDP-Dashboard-Setup-<v>.exe -PgPassword <superuser password>

  Proves, on a real Windows Server: silent NEW install on an existing PostgreSQL, the Windows service
  SDPDashboard running and restarted by the host, /ready answering, the Manager CLI (status, service
  restart, backup, list, restore with the typed phrase), a REPAIR run, a failed health check rolled
  back, and an UNINSTALL that removes the application and the service but keeps the data.
  Any failed check stops the script with exit 1. The PostgreSQL password comes from a parameter the CI
  job fills from the runner's own throwaway cluster — never a real one.
#>
param(
  [Parameter(Mandatory = $true)][string]$Setup,
  [Parameter(Mandatory = $true)][string]$PgPassword,
  [string]$Dir = 'C:\SDP-E2E',
  [string]$BackupDir = 'C:\SDP-E2E-Backups',
  [int]$Port = 3466,
  [string]$LogDir = 'e2e-logs',
  # Blank machine: the runner's own PostgreSQL is uninstalled first, then Setup installs the one it carries.
  [switch]$Virgin,
  # A-03: path to a 1.11 application tree (CI: a second checkout of claude/confident-pascal-03veex). When set,
  # ONLY the upgrade-from-1.11 sections run: a real 1.11 under pm2 upgraded by Setup, then a forced rollback.
  [string]$UpgradeFrom = ''
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogDir = (Resolve-Path $LogDir).Path
$script:fails = 0
function Check($ok, $what) { if ($ok) { Write-Host "  PASS  $what" -ForegroundColor Green } else { Write-Host "  FAIL  $what" -ForegroundColor Red; $script:fails++ } }
function Section($m) { Write-Host "`n### $m" -ForegroundColor Cyan }
function Wait-Ready([int]$sec = 120) {
  $until = (Get-Date).AddSeconds($sec)
  while ((Get-Date) -lt $until) {
    try { $r = Invoke-WebRequest "http://127.0.0.1:$Port/ready" -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { return $true } } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}
function Run-Setup([string[]]$a, [string]$name) {
  $log = Join-Path $LogDir "$name.log"
  $p = Start-Process -FilePath $Setup -ArgumentList (@('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$log`"", "/DIR=`"$Dir`"") + $a) -Wait -PassThru
  return $p.ExitCode
}
function Mgr([string[]]$a) {
  $node = Join-Path $Dir 'runtime\node\node.exe'
  $out = & $node (Join-Path $Dir 'tools\sdp-manager.js') @a --dir $Dir --url "http://localhost:$Port" 2>&1
  $global:LASTMGR = $LASTEXITCODE
  return ($out | Out-String)
}
function Show-Logs([string]$why) {
  Write-Host "`n--- logs ($why) ---" -ForegroundColor Yellow
  foreach ($pat in 'setup-2*.log', 'service-*.log', 'sdp-manager.log') {
    Get-ChildItem (Join-Path $Dir 'logs') -Filter $pat -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1 | ForEach-Object {
      Write-Host "--- $($_.Name) (last 80 lines)" -ForegroundColor Yellow
      Get-Content $_.FullName -Tail 80 | Out-Host
    }
  }
  Copy-Item (Join-Path $Dir 'logs\*') $LogDir -ErrorAction SilentlyContinue
}
function Json($text) { $line = ($text -split "`n" | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1); if ($line) { return $line | ConvertFrom-Json } else { return $null } }

if ($Virgin) {
  Section 'Blank machine: remove the PostgreSQL the runner ships with'
  foreach ($svc in Get-Service postgresql* -ErrorAction SilentlyContinue) { Stop-Service $svc.Name -Force -ErrorAction SilentlyContinue }
  Get-ChildItem 'C:\Program Files\PostgreSQL\*\uninstall-postgresql.exe' -ErrorAction SilentlyContinue | ForEach-Object {
    Start-Process $_.FullName -ArgumentList '--mode', 'unattended' -Wait | Out-Null
  }
  foreach ($svc in Get-Service postgresql* -ErrorAction SilentlyContinue) { & sc.exe delete $svc.Name | Out-Null }
  Remove-Item 'C:\Program Files\PostgreSQL' -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item 'HKLM:\SOFTWARE\PostgreSQL' -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item 'HKLM:\SYSTEM\CurrentControlSet\Services\postgresql-x64-17' -Recurse -Force -ErrorAction SilentlyContinue
  Check (-not (Get-Service postgresql* -ErrorAction SilentlyContinue)) 'no PostgreSQL left on this machine'
  $pgArgs = @('/PGPORT=5432', '/DBNAME=sdp_e2e', '/DBUSER=sdp_e2e_app')
} else {
  Section 'PostgreSQL on this machine'
  $pgsvc = Get-Service postgresql* | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $pgsvc) { throw 'no PostgreSQL service on this runner' }
  Set-Service $pgsvc.Name -StartupType Manual
  Start-Service $pgsvc.Name
  Check ((Get-Service $pgsvc.Name).Status -eq 'Running') "PostgreSQL service $($pgsvc.Name) running"
  $pgArgs = @('/PGHOST=localhost', '/PGPORT=5432', '/DBNAME=sdp_e2e', '/DBUSER=sdp_e2e_app')
}

# ---------------------------------------------------------------------------------------------------------
# A-03 — upgrade a real 1.11 server running under pm2 (only with -UpgradeFrom; the sections below are skipped)
# ---------------------------------------------------------------------------------------------------------
function New-Secret([int]$bytes) { return [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes($bytes)).ToLower() }
function Wait-Up([int]$sec = 120) {
  # a 1.11 server has no /ready: any HTTP answer below 500 on /health means it is up
  $until = (Get-Date).AddSeconds($sec)
  while ((Get-Date) -lt $until) {
    try { $r = Invoke-WebRequest "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -lt 500) { return $true } }
    catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -lt 500) { return $true } }
    Start-Sleep -Seconds 2
  }
  return $false
}
function Pm2-Online {
  $raw = (& pm2 jlist 2>$null | Out-String)
  $line = ($raw -split "`n" | Where-Object { $_.Trim().StartsWith('[') } | Select-Object -Last 1)
  if (-not $line) { return $false }
  try { return [bool](($line | ConvertFrom-Json) | Where-Object { $_.name -eq 'endeavour-dashboard' -and $_.pm2_env.status -eq 'online' }) } catch { return $false }
}
function Setup-LogText { return ((Get-ChildItem (Join-Path $Dir 'logs') -Filter 'setup-2*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1 | Get-Content -Raw) | Out-String) }
function Pm2-Summary([string]$file) {
  # name / status / script only: pm2 jlist also carries the process environment (the throwaway secrets)
  $raw = (& pm2 jlist 2>$null | Out-String)
  $line = ($raw -split "`n" | Where-Object { $_.Trim().StartsWith('[') } | Select-Object -Last 1)
  $rows = if ($line) { try { $line | ConvertFrom-Json } catch { @() } } else { @() }
  $rows | ForEach-Object { [pscustomobject]@{ name = $_.name; status = $_.pm2_env.status; script = $_.pm2_env.pm_exec_path; restarts = $_.pm2_env.restart_time } } | ConvertTo-Json | Out-File $file
}
function Pm2-Forget { & pm2 delete endeavour-dashboard 2>&1 | Out-Null; $global:LASTEXITCODE = 0 }
# helper scripts: credentials travel in the environment of the child only, never on a command line
$E2eJs = Join-Path $env:TEMP 'sdp-e2e-111.js'
@'
const { Client } = require('pg');
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
(async () => {
  const mode = process.argv[2];
  if (mode === 'createdb') {
    const c = new Client({ host: 'localhost', port: 5432, user: 'postgres', password: process.env.E2E_PGSUPER, database: 'postgres' });
    await c.connect();
    const db = process.env.E2E_DB, role = process.env.E2E_ROLE;
    await c.query(`DROP DATABASE IF EXISTS "${db}"`);
    const r = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    await c.query(`${r.rowCount ? 'ALTER' : 'CREATE'} ROLE "${role}" LOGIN PASSWORD ${lit(process.env.E2E_ROLEPASS)}`);
    await c.query(`CREATE DATABASE "${db}" OWNER "${role}" ENCODING 'UTF8' TEMPLATE template0`);
    await c.end(); console.log('createdb OK'); return;
  }
  const c = new Client({ connectionString: process.env.E2E_PGURL });
  await c.connect();
  if (mode === 'seed') {
    const u = await c.query("UPDATE report_config SET value = $1 WHERE key = 'smtp_pass'", [process.env.E2E_SECRET]);
    if (!u.rowCount) await c.query("INSERT INTO report_config (key, value) VALUES ('smtp_pass', $1)", [process.env.E2E_SECRET]);
    console.log('seed OK');
  } else {
    const r = await c.query("SELECT value FROM report_config WHERE key = 'smtp_pass'");
    const v = r.rows.length ? String(r.rows[0].value || '') : '';
    console.log(v.startsWith('enc:') ? 'STATE=encrypted' : v ? 'STATE=plaintext' : 'STATE=empty');   // never the value
  }
  await c.end();
})().catch((e) => { console.error('e2e-111: ' + e.message); process.exit(1); });
'@ | Set-Content -Path $E2eJs -Encoding utf8
function Run-E2eJs([string]$mode, [hashtable]$vars) {
  foreach ($k in $vars.Keys) { Set-Item "env:$k" $vars[$k] }
  $env:NODE_PATH = Join-Path $Dir 'node_modules'
  $out = (& node $E2eJs $mode 2>&1 | Out-String)
  $code = $LASTEXITCODE
  foreach ($k in $vars.Keys) { Remove-Item "env:$k" -ErrorAction SilentlyContinue }
  Remove-Item env:NODE_PATH -ErrorAction SilentlyContinue
  return @{ out = $out; code = $code }
}
<#
  Prepare-111: a fresh 1.11 server in $Dir, on its own database, running under pm2 with the runner's Node.js,
  holding ONE secret encrypted by the 1.11 tree's own tools/pg/encrypt-secrets.js. Returns the PG_URL.
#>
function Prepare-111([string]$db) {
  Pm2-Forget
  if (Test-Path $Dir) { Remove-Item $Dir -Recurse -Force -ErrorAction SilentlyContinue }
  & robocopy (Resolve-Path $UpgradeFrom).Path $Dir /E /XD .git node_modules /NFL /NDL /NJH /NJS /NP | Out-Null
  $global:LASTEXITCODE = 0
  Check ((Get-Content (Join-Path $Dir 'package.json') -Raw | ConvertFrom-Json).version -eq '1.11.0') "1.11 tree copied to $Dir (package.json 1.11.0)"
  Push-Location $Dir
  & npm ci --omit=dev --no-audit --no-fund 2>&1 | Out-File (Join-Path $LogDir "npm-ci-$db.log")
  $npm = $LASTEXITCODE
  Pop-Location
  Check ($npm -eq 0) "npm ci --omit=dev in the 1.11 tree with the runner Node.js $(node -v) (exit $npm)"
  $role = $db + '_app'; $rolePass = New-Secret 18
  $r = Run-E2eJs 'createdb' @{ E2E_PGSUPER = $PgPassword; E2E_DB = $db; E2E_ROLE = $role; E2E_ROLEPASS = $rolePass }
  Check ($r.code -eq 0) "database $db created for the 1.11 server ($($r.out.Trim()))"
  $pgUrl = "postgres://${role}:${rolePass}@localhost:5432/$db"
  $lines = @(
    '# throwaway 1.11 server for the A-03 upgrade test — generated at run time',
    'NODE_ENV=production', "PORT=$Port", 'BIND_HOST=127.0.0.1', "PG_URL=$pgUrl",
    'DASH_USER=admin', "DASH_PASS=$(New-Secret 12)", "DASHBOARD_API_KEY=$(New-Secret 32)", "SDP_CONFIG_KEY=$(New-Secret 16)",
    'ZOHO_CLIENT_ID=e2e-not-a-real-client', 'ZOHO_CLIENT_SECRET=e2e-not-a-real-secret', 'ZOHO_REFRESH_TOKEN=e2e-not-a-real-token',
    'REPORTS_BACKEND=postgres', 'TRACKER_BACKEND=postgres', 'MEETINGS_BACKEND=postgres', 'INSPECTION_BACKEND=postgres', 'ASSETS_BACKEND=postgres',
    'REQUIRE_POSTGRES=1'
  )   # deliberately NO SDP_BACKUP_KEY and NO SDP_SERVICE: Setup must add them
  [IO.File]::WriteAllText((Join-Path $Dir '.env'), (($lines -join "`r`n") + "`r`n"))
  Push-Location $Dir
  & pm2 start server.js --name endeavour-dashboard 2>&1 | Out-File (Join-Path $LogDir "pm2-start-$db.log")
  Pop-Location
  $up = Wait-Up
  Check $up '1.11 server answers under pm2'
  Check (Pm2-Online) 'pm2 lists endeavour-dashboard online (1.11)'
  if (-not $up) { & pm2 logs endeavour-dashboard --lines 80 --nostream 2>&1 | Out-File (Join-Path $LogDir "pm2-logs-$db.log") }
  $r = Run-E2eJs 'seed' @{ E2E_PGURL = $pgUrl; E2E_SECRET = (New-Secret 12) }
  Check ($r.code -eq 0) "a plaintext smtp_pass stored by the 1.11 server's schema ($($r.out.Trim()))"
  Push-Location $Dir
  & node tools/pg/encrypt-secrets.js --apply 2>&1 | Out-File (Join-Path $LogDir "encrypt-secrets-$db.log")
  $enc = $LASTEXITCODE
  Pop-Location
  Check ($enc -eq 0) "1.11 tools/pg/encrypt-secrets.js --apply (exit $enc)"
  $r = Run-E2eJs 'state' @{ E2E_PGURL = $pgUrl }
  Check ($r.out -match 'STATE=encrypted') "smtp_pass now starts with enc: (1.11 layout) ($($r.out.Trim()))"
  return $pgUrl
}

if ($UpgradeFrom) {
  Section 'UPGRADE from 1.11 under pm2 (A-03)'
  if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) { throw 'pm2 is not on PATH (npm i -g pm2)' }
  $built = if ((Split-Path $Setup -Leaf) -match 'SDP-Dashboard-Setup-(.+)\.exe$') { $Matches[1] } else { '' }
  Prepare-111 'sdp_e2e111' | Out-Null
  $env:SDP_SETUP_PGSUPERPASS = $PgPassword
  $rc = Run-Setup @('/MODE=update', '/ALLOWUNSIGNED=1', "/PORT=$Port", "/BACKUPDIR=`"$BackupDir`"") 'setup-upgrade-111'
  $env:SDP_SETUP_PGSUPERPASS = ''
  Check ($rc -eq 0) "update from 1.11: Setup exit code 0 (got $rc)"
  if ($rc -ne 0) { Show-Logs 'upgrade from 1.11 failed' }
  Check (Wait-Ready) "/ready answers on 127.0.0.1:$Port after the upgrade"
  Check (Pm2-Online) 'pm2 still hosts endeavour-dashboard, online (Setup never switches a pm2 server)'
  $svc = Get-Service SDPDashboard -ErrorAction SilentlyContinue
  Check (-not $svc -or $svc.Status -ne 'Running') 'no SDPDashboard Windows service running'
  $after = Get-Content (Join-Path $Dir '.env') -Raw
  Check ($after -match '(?m)^SDP_SERVICE=pm2') '.env records SDP_SERVICE=pm2'
  Check ($after -match '(?m)^SDP_BACKUP_KEY=') '.env gained an SDP_BACKUP_KEY'
  $newest = Get-ChildItem $BackupDir -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
  Check ($newest -and $newest.Name -like '*.sql.gz.enc') "the pre-update backup is encrypted ($($newest.Name))"
  $postLog = Setup-LogText
  Check ($postLog -match 'stopped the running pm2 process endeavour-dashboard before replacing files') 'post-install stopped the 1.11 pm2 process before replacing files'
  Pm2-Summary (Join-Path $LogDir 'pm2-after-upgrade.json')
  Push-Location $Dir
  & (Join-Path $Dir 'runtime\node\node.exe') tools/pg/check-secrets.js --verify 2>&1 | Out-File (Join-Path $LogDir 'check-secrets-verify.log')
  $ver = $LASTEXITCODE
  Pop-Location
  Check ($ver -eq 0) "check-secrets.js --verify on the installed tree: the 1.11 secret opens (exit $ver)"
  $mf = try { (Get-Content (Join-Path $Dir 'manifest.json') -Raw | ConvertFrom-Json).version } catch { '' }
  Check ($built -and $mf -eq $built) "manifest.json version $mf equals the built version $built"

  Section 'UPGRADE from 1.11 — forced health-check failure is rolled back to 1.11 under pm2'
  $pgUrl2 = Prepare-111 'sdp_e2e111b'
  $envFile = Join-Path $Dir '.env'
  $envBefore = [Convert]::ToBase64String([IO.File]::ReadAllBytes($envFile))
  $env:SDP_SETUP_PGSUPERPASS = $PgPassword
  $env:SDP_SETUP_TEST_FAIL_PROBE = '1'
  $rc = Run-Setup @('/MODE=update', '/ALLOWUNSIGNED=1', "/PORT=$Port", "/BACKUPDIR=`"$BackupDir`"") 'setup-upgrade-111-rollback'
  Remove-Item env:SDP_SETUP_TEST_FAIL_PROBE -ErrorAction SilentlyContinue
  $env:SDP_SETUP_PGSUPERPASS = ''
  Check ($rc -eq 7) "Setup reports the forced failure (exit 7, got $rc)"
  Check ((Setup-LogText) -match 'TEST SEAM: SDP_SETUP_TEST_FAIL_PROBE=1') 'the failure came from the probe test seam'
  $v = try { (Get-Content (Join-Path $Dir 'package.json') -Raw | ConvertFrom-Json).version } catch { '' }
  Check ($v -eq '1.11.0') "package.json is 1.11.0 again (got $v)"
  Check (Wait-Up) 'the 1.11 server answers again'
  Check (Pm2-Online) 'pm2 lists endeavour-dashboard online (1.11 back)'
  Check ([Convert]::ToBase64String([IO.File]::ReadAllBytes($envFile)) -eq $envBefore) '.env byte-identical to before Setup'
  $svc = Get-Service SDPDashboard -ErrorAction SilentlyContinue
  Check (-not $svc -or $svc.Status -ne 'Running') 'no SDPDashboard Windows service running'

  Copy-Item (Join-Path $Dir 'logs\*') $LogDir -ErrorAction SilentlyContinue
  Pm2-Summary (Join-Path $LogDir 'pm2-after-rollback.json')
  Pm2-Forget
  Remove-Item $E2eJs -ErrorAction SilentlyContinue
  if ($script:fails) { Show-Logs 'upgrade from 1.11'; Write-Host "`n$($script:fails) check(s) failed" -ForegroundColor Red; exit 1 }
  Write-Host "`nAll upgrade-from-1.11 checks passed" -ForegroundColor Green
  exit 0
}

Section 'NEW install (silent)'
$env:SDP_SETUP_PGSUPERPASS = $PgPassword
$rc = Run-Setup (@('/MODE=new', '/ALLOWUNSIGNED=1', "/PORT=$Port", "/BACKUPDIR=`"$BackupDir`"") + $pgArgs) 'setup-new'
$env:SDP_SETUP_PGSUPERPASS = ''
Check ($rc -eq 0) "Setup exit code 0 (got $rc)"
if ($Virgin) {
  $pg = Get-Service postgresql-x64-17 -ErrorAction SilentlyContinue
  Check ($pg -and $pg.Status -eq 'Running') 'PostgreSQL 17 installed by Setup and running'
  Check (Test-Path 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe') 'PostgreSQL client tools in place (backups)'
  $mark = (& reg.exe query 'HKLM\SOFTWARE\SDP-Dashboard' /v PgInstalledBySetup 2>$null | Out-String)
  Check ($mark -match 'PgInstalledBySetup\s+REG_SZ\s+1') 'registry marker PgInstalledBySetup=1 written by Setup (A-02)'
}
if ($rc -ne 0) { Show-Logs 'setup failed' }
Check (Test-Path (Join-Path $Dir 'server.js')) 'application files installed'
Check (Test-Path (Join-Path $Dir 'runtime\node\node.exe')) 'bundled Node.js runtime'
Check (Test-Path (Join-Path $Dir 'node_modules\express')) 'offline dependencies in place'
Check (-not (Test-Path (Join-Path $Dir '.setup\node_modules'))) 'staging folder consumed'
$envText = Get-Content (Join-Path $Dir '.env') -Raw
Check ($envText -match 'DASHBOARD_API_KEY=\w{32,}') '.env has a generated DASHBOARD_API_KEY'
Check ($envText -match 'SDP_BACKUP_KEY=') '.env has a backup key'
Check ($envText -match 'SDP_SERVICE=windows') '.env records the Windows service'
$svc = Get-Service SDPDashboard -ErrorAction SilentlyContinue
Check ($svc -and $svc.Status -eq 'Running') 'Windows service SDPDashboard running'
Check ((Get-CimInstance Win32_Service -Filter "Name='SDPDashboard'").StartMode -eq 'Auto') 'service starts automatically'
$ready = Wait-Ready
Check $ready "/ready answers on 127.0.0.1:$Port"
if (-not $ready) { Show-Logs 'service not answering'; Write-Host "`n$($script:fails) check(s) failed" -ForegroundColor Red; exit 1 }
$listen = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
Check ($listen -and -not ($listen | Where-Object { $_.LocalAddress -ne '127.0.0.1' })) 'the application listens on 127.0.0.1 only'
Check ([bool](Get-NetFirewallRule -DisplayName "SDP Dashboard $Port - block remote" -ErrorAction SilentlyContinue)) 'firewall rule blocks the port from the network'
Get-Content (Join-Path $Dir 'logs\setup-last.json') | Out-Host

Section 'Manager CLI'
$st = Json (Mgr @('status', '--json'))
Check ($st -and $st.service.kind -eq 'windows' -and $st.service.state -eq 'running') 'status: windows service running'
Check ($st -and $st.http.ok) 'status: http answers'
$o = Mgr @('service', 'restart', '--json'); $j = Json $o
Check ($j -and $j.ok) 'service restart (stop -> wait -> start) and back'
$o = Mgr @('backup', '--json'); $j = Json $o
Check ($j -and $j.ok) "backup taken ($($j.file))"
$list = Json (Mgr @('backups', '--json'))
Check ($list -and $list.backups.Count -ge 1) 'backups listed'
if (-not ($list -and $list.backups.Count -ge 1)) { Show-Logs 'no backup'; exit 1 }
$b = $list.backups[0]
$o = Mgr @('restore', (Join-Path $list.dir $b.name), '--confirm', 'RESTORE 19990101')
Check ($LASTMGR -ne 0 -and $o -match 'type exactly') 'restore refused without the exact phrase'
$o = Mgr @('restore', (Join-Path $list.dir $b.name), '--confirm', $b.confirm)
Check ($LASTMGR -eq 0) 'restore with the typed phrase'
Check (Wait-Ready) 'service answers after the restore'

Section 'REPAIR (silent)'
$rc = Run-Setup @('/MODE=repair', '/ALLOWUNSIGNED=1', "/PORT=$Port") 'setup-repair'
Check ($rc -eq 0) "repair exit code 0 (got $rc)"
Check (Wait-Ready) 'service answers after repair'
Check ((Get-Content (Join-Path $Dir '.env') -Raw) -eq $envText) '.env untouched by repair'

Section 'UPDATE (silent): backup first, then the same version re-applied'
$before = (Json (Mgr @('backups', '--json'))).backups.Count
$rc = Run-Setup @('/MODE=update', '/ALLOWUNSIGNED=1', "/PORT=$Port") 'setup-update'
Check ($rc -eq 0) "update exit code 0 (got $rc)"
Check (Wait-Ready) 'service answers after the update'
$after = (Json (Mgr @('backups', '--json'))).backups.Count
Check ($after -gt $before) "a backup was taken before the update ($before -> $after)"
# A-04: the repaired .env (SDP_BACKUP_KEY) is written before the copy, so the pre-update backup is encrypted
$newest = (Json (Mgr @('backups', '--json'))).backups | Select-Object -First 1
Check ($newest -and $newest.name -like '*.sql.gz.enc') "the pre-update backup is encrypted ($($newest.name))"
Check ((Get-Content (Join-Path $Dir '.env') -Raw) -eq $envText) '.env kept by the update'
Check (Test-Path (Join-Path $Dir 'runtime\node\node.exe')) 'Node.js runtime refreshed in place'
# A-02: Setup never upgrades a PostgreSQL it did not install (the runner's own cluster carries no marker)
$updLog = Join-Path $LogDir 'setup-update.log'
$updText = if (Test-Path $updLog) { Get-Content $updLog -Raw } else { '' }
if ($Virgin) {
  Check ($updText -notmatch 'is managed by another product') 'update: the PostgreSQL Setup installed is not reported as foreign'
} else {
  Check (($updText -match 'not upgraded') -or ($updText -notmatch 'PostgreSQL upgraded to')) 'update: the runner PostgreSQL (no SDP-Dashboard marker) was not upgraded'
}

Section 'Failed health check is rolled back'
# make the application unable to start, then repair: Setup must fail, put the files back and keep the service
$cfg = Join-Path $Dir '.env'
$saved = Get-Content $cfg -Raw
Set-Content $cfg ($saved -replace 'PG_URL=.*', 'PG_URL=postgres://nobody:wrong@127.0.0.1:1/none') -NoNewline
$rc = Run-Setup @('/MODE=repair', '/ALLOWUNSIGNED=1', "/PORT=$Port") 'setup-repair-broken'
Check ($rc -ne 0) "Setup reports the failure (exit $rc)"
Check (Test-Path (Join-Path $Dir 'server.js')) 'application files still in place'
Set-Content $cfg $saved -NoNewline
& net start SDPDashboard 2>&1 | Out-Null
Check (Wait-Ready) 'service answers again once the configuration is fixed'

Section 'UNINSTALL (silent, keep data)'
$un = Get-ChildItem $Dir -Filter 'unins*.exe' | Select-Object -First 1
Check ([bool]$un) 'uninstaller present'
if ($un) { Start-Process $un.FullName -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait }
Start-Sleep -Seconds 3
Check (-not (Get-Service SDPDashboard -ErrorAction SilentlyContinue)) 'service removed'
Check (-not (Test-Path (Join-Path $Dir 'server.js'))) 'application removed'
Check (Test-Path (Join-Path $Dir '.env')) 'settings kept'
Check (-not (Get-NetFirewallRule -DisplayName "SDP Dashboard $Port - block remote" -ErrorAction SilentlyContinue)) 'firewall rules removed'

Copy-Item (Join-Path $Dir 'logs\*') $LogDir -ErrorAction SilentlyContinue
if ($script:fails) { Show-Logs 'end' }
if ($script:fails) { Write-Host "`n$($script:fails) check(s) failed" -ForegroundColor Red; exit 1 }
Write-Host "`nAll end-to-end checks passed" -ForegroundColor Green
exit 0
