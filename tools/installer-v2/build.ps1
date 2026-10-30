<#
  Build SDP-Dashboard-Setup-<version>.exe (installer v2.1). Runs on Windows (CI: windows-latest).

    pwsh tools/installer-v2/build.ps1 -Version 2.0.0 [-OutDir dist] [-NodeVersion 22.11.0] [-PgExe <path>]
                                      [-SignTool "<path to sign wrapper>"] [-PackageZip <existing package>]

  Steps (each one fails the build loudly):
    1  the update package (tools/deploy/make-update-package.js) — signed when SIGNING_MANIFEST_KEY is set
    2  payload\runtime\node   Node.js for Windows x64, checked against nodejs.org SHASUMS256 before use
    2b payload\prereq        PostgreSQL 17 (EnterpriseDB), IIS URL Rewrite + ARR (Microsoft) — Authenticode verified
    3  payload\node_modules   production dependencies installed on Windows (offline install on the server)
    4  payload\service        tools/service  (SdpDashboardService.exe, .NET Framework 4.8 — nothing to install)
    5  payload\manager        tools/manager  (SdpDashboardManager.exe, WPF, .NET Framework 4.8)
    6  payload\bootstrap      the manager CLI that applies the package during Setup
    7  ISCC                   tools/installer-v2/SDP-Dashboard.iss
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$OutDir = 'dist',
  [string]$NodeVersion = '22.11.0',
  [string]$PgExe = '',
  [string]$PgVersion = '17.6-1',
  [switch]$NoPrereqs,
  [string]$SignTool = '',
  [string]$Commit = '',
  [string]$PackageZip = ''
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root
$out = Join-Path $root $OutDir
$payload = Join-Path $out 'payload'
function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Must($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

if (-not $Commit) { $Commit = (git rev-parse --short HEAD).Trim() }
# Inno's file version must be numeric: 2.0.0-alpha.14 -> 2.0.0.14
$m = [regex]::Match($Version, '^(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z]+\.?(\d+))?')
if (-not $m.Success) { throw "version '$Version' is not SemVer" }
$fileVersion = "$($m.Groups[1].Value).$($m.Groups[2].Value).$($m.Groups[3].Value).$(if ($m.Groups[4].Success) { $m.Groups[4].Value } else { '0' })"

Remove-Item -Recurse -Force $payload -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $payload | Out-Null

Step '1 update package'
if ($PackageZip) {
  # the release job already built (and signed) the package: reuse it, never rebuild a second, different one
  $zip = (Resolve-Path $PackageZip).Path
  Write-Host "reusing $zip"
} else {
  node tools/deploy/make-update-package.js --out $OutDir --version $Version --commit $Commit; Must 'make-update-package'
  $zip = Join-Path $out "sdp-dashboard-$Version.zip"
}
$signed = if ((Get-Content (Join-Path $out 'manifest.json') -Raw | ConvertFrom-Json).signature) { '1' } else { '0' }
Write-Host "manifest signed: $signed"

Step "2 Node.js $NodeVersion (win-x64), verified"
$cache = Join-Path $out 'cache'; New-Item -ItemType Directory -Force -Path $cache | Out-Null
$nodeZipName = "node-v$NodeVersion-win-x64.zip"
$nodeZip = Join-Path $cache $nodeZipName
$sums = Join-Path $cache "SHASUMS256-$NodeVersion.txt"
if (-not (Test-Path $sums)) { Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -OutFile $sums -UseBasicParsing }
if (-not (Test-Path $nodeZip)) { Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/$nodeZipName" -OutFile $nodeZip -UseBasicParsing }
$want = ((Get-Content $sums) | Where-Object { $_ -match ("  " + [regex]::Escape($nodeZipName) + "$") }) -replace '\s+.*$', ''
$have = (Get-FileHash $nodeZip -Algorithm SHA256).Hash.ToLower()
if (-not $want -or $have -ne $want.ToLower()) { throw "Node.js archive checksum mismatch ($have vs $want)" }
Write-Host "sha256 OK $have"
$tmpNode = Join-Path $cache "node-$NodeVersion"
Remove-Item -Recurse -Force $tmpNode -ErrorAction SilentlyContinue
Expand-Archive $nodeZip -DestinationPath $tmpNode
New-Item -ItemType Directory -Force -Path (Join-Path $payload 'runtime') | Out-Null
Move-Item (Join-Path $tmpNode "node-v$NodeVersion-win-x64") (Join-Path $payload 'runtime\node')

Step "2b prerequisites: PostgreSQL $PgVersion, IIS URL Rewrite, ARR (signatures verified)"
# Everything a blank server needs is carried by Setup: nothing is downloaded on the server.
# Integrity = the vendors' Authenticode signatures (EnterpriseDB, Microsoft), checked here AND again on the server.
function Get-Signed($url, $file, $signer) {
  # a truncated / intercepted download fails the signature check: retry a fresh download (3 tries), never accept it unsigned
  $dst = Join-Path $cache $file
  for ($try = 1; $try -le 3; $try++) {
    if (-not (Test-Path $dst)) { Write-Host "downloading $url (try $try)"; try { Invoke-WebRequest $url -OutFile $dst -UseBasicParsing } catch { Write-Host "download failed: $($_.Exception.Message)" } }
    $sig = if (Test-Path $dst) { Get-AuthenticodeSignature $dst } else { $null }
    if ($sig -and $sig.Status -eq 'Valid' -and $sig.SignerCertificate.Subject -match $signer) {
      Write-Host ("{0} signed by {1}, sha256 {2}" -f $file, ($sig.SignerCertificate.Subject -replace ',.*$', ''), (Get-FileHash $dst -Algorithm SHA256).Hash.ToLower())
      return $dst
    }
    $why = if ($sig) { "$($sig.Status) / $($sig.SignerCertificate.Subject)" } else { 'not downloaded' }
    Remove-Item $dst -Force -ErrorAction SilentlyContinue
    if ($try -lt 3) { Write-Host "$file : signature $why - retrying in $(10 * $try) s"; Start-Sleep -Seconds (10 * $try) }
    else { throw "$file : signature $why - refused after 3 downloads" }
  }
}
$prereq = Join-Path $payload 'prereq'
New-Item -ItemType Directory -Force -Path $prereq | Out-Null
if (-not $NoPrereqs) {
  if (-not $PgExe) { $PgExe = Get-Signed "https://get.enterprisedb.com/postgresql/postgresql-$PgVersion-windows-x64.exe" "postgresql-$PgVersion-windows-x64.exe" 'EnterpriseDB' }
  Copy-Item (Get-Signed 'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi' 'rewrite_amd64.msi' 'Microsoft') (Join-Path $prereq 'rewrite_amd64.msi')
  Copy-Item (Get-Signed 'https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi' 'requestRouter_amd64.msi' 'Microsoft') (Join-Path $prereq 'requestRouter_amd64.msi')
}

Step '3 production dependencies (Windows)'
$deps = Join-Path $cache 'deps'
Remove-Item -Recurse -Force $deps -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $deps | Out-Null
Copy-Item package.json, package-lock.json $deps
Push-Location $deps
& (Join-Path $payload 'runtime\node\npm.cmd') ci --omit=dev --no-audit --no-fund; Must 'npm ci --omit=dev'
Pop-Location
Move-Item (Join-Path $deps 'node_modules') (Join-Path $payload 'node_modules')

Step '4 Windows service host'
dotnet build tools/service/SdpDashboardService/SdpDashboardService.csproj -c Release -o (Join-Path $payload 'service') -p:Version=$fileVersion; Must 'service build'

Step '5 Manager'
dotnet build tools/manager/SdpDashboardManager/SdpDashboardManager.csproj -c Release -o (Join-Path $payload 'manager') -p:Version=$fileVersion; Must 'manager build'
Get-ChildItem (Join-Path $payload 'service'), (Join-Path $payload 'manager') -Include *.pdb -Recurse | Remove-Item -Force

Step '6 bootstrap'
$boot = Join-Path $payload 'bootstrap'
foreach ($f in 'tools/sdp-manager.js', 'tools/manifest-public.pem', 'tools/installer-v2/post-install.js', 'tools/installer-v2/iis-setup.ps1',
               'services/updatePackage.js', 'services/backup.js', 'services/serviceControl.js', 'services/dbRestore.js',
               'tools/pg/dump-db.js', 'tools/pg/pg-bin.js') {
  $dst = Join-Path $boot $f
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  Copy-Item (Join-Path $root $f) $dst
}

Step '7 Setup.exe'
$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 (ISCC.exe) not found' }
$isccArgs = @("/DAppVersion=$Version", "/DFileVersion=$fileVersion", "/DPackageZip=$zip", "/DPayloadDir=$payload", "/DPackageSigned=$signed")
if ($PgExe) { $isccArgs += @("/DPgExe=$((Resolve-Path $PgExe).Path)", "/DPgVersion=$PgVersion") }
# SDP-Dashboard.iss appends ` $f` itself (SignTool={#SignTool} $f): pass the wrapper path only.
if ($SignTool) { $isccArgs += @("/Ssigntool=`"$SignTool`"", '/DSignTool=signtool') }
& $iscc @isccArgs (Join-Path $root 'tools\installer-v2\SDP-Dashboard.iss'); Must 'ISCC'
$setup = Join-Path $out "SDP-Dashboard-Setup-$Version.exe"
Write-Host ("`nBuilt {0} ({1:N1} MB), package signed: {2}" -f $setup, ((Get-Item $setup).Length / 1MB), $signed) -ForegroundColor Green
