# =====================================================================
# download-cache.ps1 - one-time (idempotent) fetch of every third-party
# piece the installer bundle needs, into tools\installer-build\cache\
# (gitignored). Re-run any time: existing items are SKIPPED unless -Force.
#
# Items:
#   node-v24*-x64.msi              nodejs.org/dist (latest v24, pinned fallback)
#   postgresql-17*-windows-x64.exe EDB installer (candidate versions tried)
#   python-3.12*-embed-amd64.zip   python.org embeddable runtime
#   get-pip.py                     bootstrap.pypa.io
#   wheels\*.whl                   pip download matplotlib python-pptx pillow
#   pm2-global\                    COPIED from this box's %APPDATA%\npm
#                                  (node_modules\pm2 + pm2* shims). npm pack
#                                  tarballs have NO transitive deps and
#                                  npm i --offline ENOTCACHEDs on a blank
#                                  server, so a pre-installed tree is the
#                                  only reliable offline vehicle. If pm2 is
#                                  not installed here, a README placeholder
#                                  is written instead - seed the tree from a
#                                  box that has pm2 (npm i -g pm2, re-run).
#   7zr.exe + 7zSD.sfx             SFX build pieces (REQUIRED for the exe).
#                                  7zSD.sfx lives inside the "7z extra" .7z
#                                  archive; 7zr.exe is downloaded first and
#                                  used to extract it (bootstrap order).
#
# KEEP THIS FILE PURE ASCII (Windows PowerShell 5.1 ANSI parse pitfall).
# =====================================================================
param(
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

$here  = Split-Path -Parent $MyInvocation.MyCommand.Path
$cache = Join-Path $here 'cache'
if (-not (Test-Path $cache)) { New-Item -ItemType Directory -Path $cache -Force | Out-Null }

$results = New-Object System.Collections.ArrayList
function Report($item, $state, $detail) {
    $c = switch ($state) { 'DOWNLOADED' {'Green'} 'COPIED' {'Green'} 'SKIPPED' {'Gray'} 'EXTRACTED' {'Green'} default {'Yellow'} }
    Write-Host ("  [{0}] {1} - {2}" -f $state, $item, $detail) -ForegroundColor $c
    [void]$results.Add([pscustomobject]@{ Item = $item; State = $state; Detail = $detail })
}
function Get-File($url, $dest, $item) {
    if ((Test-Path $dest) -and -not $Force) { Report $item 'SKIPPED' (Split-Path $dest -Leaf); return $true }
    $part = $dest + '.part'
    try {
        Write-Host ("  downloading {0} ..." -f $url) -ForegroundColor Cyan
        Invoke-WebRequest -Uri $url -OutFile $part -UseBasicParsing
        Move-Item $part $dest -Force
        Report $item 'DOWNLOADED' ((Split-Path $dest -Leaf) + ' (' + [math]::Round((Get-Item $dest).Length/1MB, 1) + ' MB)')
        return $true
    } catch {
        Remove-Item $part -Force -ErrorAction SilentlyContinue
        Report $item 'UNAVAILABLE' ($url + ' : ' + $_.Exception.Message)
        return $false
    }
}

Write-Host '=== SDP installer cache fetch ===' -ForegroundColor Cyan
Write-Host ("cache dir: " + $cache)

# --- 1) Node.js v24 x64 MSI -------------------------------------------------
$nodeMsi = Get-ChildItem $cache -Filter 'node-v24*-x64.msi' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($nodeMsi -and -not $Force) {
    Report 'Node.js 24 MSI' 'SKIPPED' $nodeMsi.Name
} else {
    $nv = $null
    try {
        $idx = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
        $nv = ($idx | Where-Object { $_.version -like 'v24.*' } | Select-Object -First 1).version
    } catch { Write-Host '  (index.json unreachable - using pinned fallback)' -ForegroundColor Yellow }
    if (-not $nv) { $nv = 'v24.11.0' }   # pinned fallback, known-good v24 LTS
    [void](Get-File ("https://nodejs.org/dist/$nv/node-$nv-x64.msi") (Join-Path $cache "node-$nv-x64.msi") 'Node.js 24 MSI')
}

# --- 2) PostgreSQL 17 EDB installer ------------------------------------------
$pgExe = Get-ChildItem $cache -Filter 'postgresql-17*-windows-x64.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgExe -and -not $Force) {
    Report 'PostgreSQL 17 installer' 'SKIPPED' $pgExe.Name
} else {
    $got = $false
    foreach ($v in @('17.7', '17.6', '17.5', '17.4', '17.2')) {
        $fn = "postgresql-$v-1-windows-x64.exe"
        if (Get-File ("https://get.enterprisedb.com/postgresql/$fn") (Join-Path $cache $fn) "PostgreSQL $v installer") { $got = $true; break }
    }
    if (-not $got) { Write-Host '  PostgreSQL: no candidate version downloadable (network block?)' -ForegroundColor Yellow }
}

# --- 3) Python 3.12 embeddable + get-pip.py ----------------------------------
$pyZip = Get-ChildItem $cache -Filter 'python-3.12*embed-amd64.zip' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pyZip -and -not $Force) {
    Report 'Python 3.12 embeddable' 'SKIPPED' $pyZip.Name
} else {
    $pyv = '3.12.10'
    [void](Get-File ("https://www.python.org/ftp/python/$pyv/python-$pyv-embed-amd64.zip") (Join-Path $cache "python-$pyv-embed-amd64.zip") 'Python 3.12 embeddable')
}
[void](Get-File 'https://bootstrap.pypa.io/get-pip.py' (Join-Path $cache 'get-pip.py') 'get-pip.py')

# --- 4) wheels: matplotlib python-pptx pillow ---------------------------------
$wheels = Join-Path $cache 'wheels'
if ((Test-Path $wheels) -and (Get-ChildItem $wheels -Filter 'matplotlib*.whl' -ErrorAction SilentlyContinue) -and -not $Force) {
    Report 'PPTX wheels' 'SKIPPED' ((Get-ChildItem $wheels -Filter '*.whl').Count.ToString() + ' wheel(s) present')
} else {
    $py = Get-Command python -ErrorAction SilentlyContinue
    if ($py) {
        New-Item -ItemType Directory -Path $wheels -Force | Out-Null
        Write-Host '  pip download matplotlib python-pptx pillow ...' -ForegroundColor Cyan
        & python -m pip download matplotlib python-pptx pillow -d $wheels --quiet
        if ($LASTEXITCODE -eq 0) { Report 'PPTX wheels' 'DOWNLOADED' ((Get-ChildItem $wheels -Filter '*.whl').Count.ToString() + ' wheel(s)') }
        else { Report 'PPTX wheels' 'UNAVAILABLE' 'pip download failed (see output above)' }
    } else {
        Report 'PPTX wheels' 'UNAVAILABLE' 'no python on this box to run pip download'
    }
}

# --- 5) pm2 offline global tree (COPY from this box, never npm install) -------
$pm2Dest = Join-Path $cache 'pm2-global'
$pm2Marker = Join-Path $pm2Dest 'node_modules\pm2\package.json'
if ((Test-Path $pm2Marker) -and -not $Force) {
    Report 'pm2 global tree' 'SKIPPED' 'pm2-global\ already seeded'
} else {
    $npmDir = Join-Path $env:APPDATA 'npm'
    $pm2Src = Join-Path $npmDir 'node_modules\pm2'
    if (Test-Path $pm2Src) {
        New-Item -ItemType Directory -Path (Join-Path $pm2Dest 'node_modules') -Force | Out-Null
        & robocopy $pm2Src (Join-Path $pm2Dest 'node_modules\pm2') /E /NFL /NDL /NJH /NJS | Out-Null
        if ($LASTEXITCODE -ge 8) { Report 'pm2 global tree' 'UNAVAILABLE' 'robocopy of the pm2 tree failed'; }
        else {
            Get-ChildItem $npmDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'pm2*' } |
                ForEach-Object { Copy-Item $_.FullName $pm2Dest -Force }
            # optional: pm2-windows-service if this box has it (plan task 8 fallback
            # is a schtasks ONSTART resurrect, so this is nice-to-have only)
            $svcSrc = Join-Path $npmDir 'node_modules\pm2-windows-service'
            if (Test-Path $svcSrc) {
                & robocopy $svcSrc (Join-Path $pm2Dest 'node_modules\pm2-windows-service') /E /NFL /NDL /NJH /NJS | Out-Null
            }
            Report 'pm2 global tree' 'COPIED' ('from ' + $pm2Src)
        }
    } else {
        New-Item -ItemType Directory -Path $pm2Dest -Force | Out-Null
        $readme = @(
            'pm2-global placeholder - NOT YET SEEDED',
            '',
            'This box has no global pm2 install at %APPDATA%\npm\node_modules\pm2,',
            'so the offline pm2 tree could not be captured. To seed it, on a box',
            'WITH pm2 installed globally (npm i -g pm2) re-run:',
            '',
            '    powershell -File tools\installer-build\download-cache.ps1',
            '',
            'Expected layout consumed by Install-SDP.ps1 step 3:',
            '    cache\pm2-global\node_modules\pm2\...   (full tree incl. its node_modules)',
            '    cache\pm2-global\pm2.cmd / pm2.ps1 / pm2  (the npm shims)',
            '',
            'Without this tree the installer degrades to NoService mode on servers',
            'that lack pm2 (WARN + plain-node probe; documented in Install-SDP.ps1).'
        )
        Set-Content -Path (Join-Path $pm2Dest 'README.txt') -Value $readme -Encoding ascii
        Report 'pm2 global tree' 'UNAVAILABLE' 'pm2 not installed on this box - placeholder README written'
    }
}

# --- 6) 7-Zip SFX pieces: 7zr.exe then 7zSD.sfx (from the "extra" package) ----
$sevenZr = Join-Path $cache '7zr.exe'
[void](Get-File 'https://www.7-zip.org/a/7zr.exe' $sevenZr '7zr.exe')
$sfx = Join-Path $cache '7zSD.sfx'
if ((Test-Path $sfx) -and -not $Force) {
    Report '7zSD.sfx' 'SKIPPED' '7zSD.sfx'
} elseif (-not (Test-Path $sevenZr)) {
    Report '7zSD.sfx' 'UNAVAILABLE' '7zr.exe missing - cannot extract the extra package'
} else {
    $gotExtra = $null
    foreach ($rel in @('7z2501-extra.7z', '7z2409-extra.7z', '7z2408-extra.7z', '7z2301-extra.7z')) {
        $dest = Join-Path $cache $rel
        if ((Test-Path $dest) -or (Get-File ("https://www.7-zip.org/a/$rel") $dest ("7z extra ($rel)"))) { $gotExtra = $dest; break }
    }
    if ($gotExtra) {
        & $sevenZr e $gotExtra ('-o' + $cache) '7zSD.sfx' '-y' | Out-Null
        if (Test-Path $sfx) { Report '7zSD.sfx' 'EXTRACTED' ('from ' + (Split-Path $gotExtra -Leaf)) }
        else { Report '7zSD.sfx' 'UNAVAILABLE' '7zr extraction produced no 7zSD.sfx' }
    } else {
        Report '7zSD.sfx' 'UNAVAILABLE' 'no 7z extra package downloadable'
    }
}

# --- summary ------------------------------------------------------------------
Write-Host ''
Write-Host '=== cache summary ===' -ForegroundColor Cyan
$results | ForEach-Object { Write-Host ("  {0,-12} {1,-24} {2}" -f $_.State, $_.Item, $_.Detail) }
$missing = @($results | Where-Object { $_.State -eq 'UNAVAILABLE' })
$sfxOk = (Test-Path $sevenZr) -and (Test-Path $sfx)
Write-Host ''
if (-not $sfxOk) {
    Write-Host 'REQUIRED SFX pieces (7zr.exe + 7zSD.sfx) are MISSING - build-installer.ps1 cannot produce the .exe.' -ForegroundColor Red
} else {
    Write-Host 'SFX pieces present - exe build possible.' -ForegroundColor Green
}
if ($missing.Count -gt 0) {
    Write-Host ("{0} item(s) unavailable - the build will WARN and continue for optional payload items." -f $missing.Count) -ForegroundColor Yellow
}
exit 0
