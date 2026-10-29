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
  [string]$LogDir = 'e2e-logs'
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
function Json($text) { $line = ($text -split "`n" | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1); if ($line) { return $line | ConvertFrom-Json } else { return $null } }

Section 'PostgreSQL on this machine'
$pgsvc = Get-Service postgresql* | Sort-Object Name -Descending | Select-Object -First 1
if (-not $pgsvc) { throw 'no PostgreSQL service on this runner' }
Set-Service $pgsvc.Name -StartupType Manual
Start-Service $pgsvc.Name
Check ((Get-Service $pgsvc.Name).Status -eq 'Running') "PostgreSQL service $($pgsvc.Name) running"

Section 'NEW install (silent)'
$env:SDP_SETUP_PGSUPERPASS = $PgPassword
$rc = Run-Setup @('/MODE=new', '/ALLOWUNSIGNED=1', "/PORT=$Port", "/BACKUPDIR=`"$BackupDir`"", '/PGHOST=localhost', '/PGPORT=5432', '/DBNAME=sdp_e2e', '/DBUSER=sdp_e2e_app') 'setup-new'
$env:SDP_SETUP_PGSUPERPASS = ''
Check ($rc -eq 0) "Setup exit code 0 (got $rc)"
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
Check (Wait-Ready) "/ready answers on 127.0.0.1:$Port"
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
if ($script:fails) { Write-Host "`n$($script:fails) check(s) failed" -ForegroundColor Red; exit 1 }
Write-Host "`nAll end-to-end checks passed" -ForegroundColor Green
