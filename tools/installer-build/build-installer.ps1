# =====================================================================
# build-installer.ps1 - assemble the monolithic SDP-Setup-<version>.exe
# (7-Zip SFX) from a clean git checkout + this box's node_modules + the
# third-party installers cached by download-cache.ps1.
#
#   powershell -File tools\installer-build\build-installer.ps1            (release: HEAD must be clean + tagged)
#   powershell -File tools\installer-build\build-installer.ps1 -DevBuild  (version dev-<sha>; dirty tree = WARN)
#   ... -KeepWork          keep the staging dir after a successful build
#   ... -Clean             discard the resumable work dir and rebuild
#
# RESUMABLE: the work dir is %TEMP%\sdp-build-<version>; an interrupted run
# resumes (staging / app.zip / bundle.7z stages are skipped when complete).
# The work dir is kept on failure and removed after a successful exe build.
# Copy-Item is used instead of robocopy: robocopy hangs in silent retry
# storms when run without an interactive console (observed 2026-07-13).
#
# Output: SDP-Setup-<version>.exe in the repo root (gitignored).
# Bundle layout (= SFX archive root; the SFX extracts + runs Setup.bat):
#   Setup.bat  Install-SDP.ps1  Manage-SDP.ps1  config.psd1
#   config.test.psd1  env.template  version.json
#   payload\app.zip                    (git archive HEAD + node_modules)
#   payload\installers\node-*.msi      (optional - WARN when missing)
#   payload\installers\postgresql-*.exe(optional - WARN when missing)
#   payload\installers\python-*embed*.zip + get-pip.py + wheels\   (optional)
#   payload\installers\pm2-global\     (optional)
#
# Missing OPTIONAL payload items -> WARN and continue (the installer
# verifies/reuses what is already on the target). Missing SFX pieces
# (cache\7zr.exe + cache\7zSD.sfx) -> the .7z bundle is still produced,
# the exe step is reported as blocked.
#
# KEEP THIS FILE PURE ASCII (Windows PowerShell 5.1 ANSI parse pitfall).
# =====================================================================
param(
    [switch]$DevBuild,
    [switch]$KeepWork,
    [switch]$Clean
)
$ErrorActionPreference = 'Stop'

$here  = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo  = Split-Path (Split-Path $here -Parent) -Parent
$cache = Join-Path $here 'cache'

function Step($m) { Write-Host ("[STEP] " + $m) -ForegroundColor Cyan }
function Ok($m)   { Write-Host ("[OK]   " + $m) -ForegroundColor Green }
function Warn($m) { Write-Host ("[WARN] " + $m) -ForegroundColor Yellow }
function Die($m)  { Write-Host ("[ERROR] " + $m) -ForegroundColor Red; exit 1 }

# --- version from git ---------------------------------------------------------
Push-Location $repo
try {
    $dirty = git status --porcelain
    $sha   = (git rev-parse --short HEAD).Trim()
    if ($DevBuild) {
        if ($dirty) { Warn 'Working tree is DIRTY - the bundle is built from HEAD, local edits are NOT included.' }
        $ver = 'dev-' + $sha
    } else {
        if ($dirty) { Die 'Working tree not clean. Commit/stash first (or use -DevBuild).' }
        $tag = ''
        try { $tag = (git describe --exact-match --tags HEAD 2>$null) } catch { }
        if (-not $tag) { Die 'HEAD is not at a tag. Tag the release (git tag vX.Y.Z) or use -DevBuild.' }
        $ver = "$tag".Trim()
    }
    Ok ("version: $ver (sha $sha)")

    # --- staging (RESUMABLE: fixed per-version work dir; finished stages are
    # skipped on re-run, so an interrupted build continues where it stopped.
    # Pass -Clean to force a from-scratch rebuild.) --------------------------------
    $work   = Join-Path $env:TEMP ('sdp-build-' + $ver)
    if ($Clean -and (Test-Path $work)) { Remove-Item $work -Recurse -Force }
    $stage  = Join-Path $work 'app'
    $bundle = Join-Path $work 'bundle'
    New-Item -ItemType Directory -Path $stage, $bundle -Force | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    if (Test-Path (Join-Path $work '.staged')) {
        Ok 'staging already complete - skipped (resume)'
    } else {
        Step 'git archive HEAD -> staging'
        $srcZip = Join-Path $work 'src.zip'
        git archive --format=zip -o $srcZip HEAD
        if ($LASTEXITCODE -ne 0) { Die 'git archive failed' }
        Expand-Archive -LiteralPath $srcZip -DestinationPath $stage -Force
        Remove-Item $srcZip -Force

        Step 'copy dev node_modules (exclude .cache) into staging'
        $nm = Join-Path $repo 'node_modules'
        if (-not (Test-Path $nm)) { Die "no node_modules in $repo - run the app install first" }
        # Copy-Item, NOT robocopy: robocopy hangs in retry storms when run
        # without an interactive console (observed 2026-07-13); Copy-Item is
        # plain .NET I/O and fails loudly instead.
        $nmDst = Join-Path $stage 'node_modules'
        if (Test-Path $nmDst) { Remove-Item $nmDst -Recurse -Force }
        Copy-Item $nm $nmDst -Recurse -Force
        Remove-Item (Join-Path $nmDst '.cache') -Recurse -Force -ErrorAction SilentlyContinue
        # npm leaves unreadable shim-temp artifacts in node_modules\.bin
        # (.name-XXXXXXXX reparse leftovers). They break ZipFile (and made
        # robocopy retry-storm forever). Sweep staging and drop them.
        $junk = 0
        Get-ChildItem $nmDst -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
            $p = $_.FullName   # capture: inside catch, $_ is the ErrorRecord
            try { $s = [IO.File]::OpenRead($p); $s.Close() }
            catch {
                # broken-symlink reparse points: Remove-Item and cmd del both
                # fail on them; [IO.File]::Delete removes them (verified).
                [IO.File]::Delete($p)
                $junk++
            }
        }
        if ($junk -gt 0) { Warn ("dropped $junk unreadable node_modules artifact(s) from staging (npm shim leftovers)") }
        Set-Content -Path (Join-Path $work '.staged') -Value $ver -Encoding ascii
    }

    $payload = Join-Path $bundle 'payload'
    $payloadInst = Join-Path $payload 'installers'
    New-Item -ItemType Directory -Path $payloadInst -Force | Out-Null
    $appZip = Join-Path $payload 'app.zip'
    if (Test-Path $appZip) {
        Ok 'app.zip already built - skipped (resume)'
    } else {
        Step 'zip staging -> payload\app.zip'
        $tmpZip = $appZip + '.tmp'
        if (Test-Path $tmpZip) { Remove-Item $tmpZip -Force }
        [IO.Compression.ZipFile]::CreateFromDirectory($stage, $tmpZip, [IO.Compression.CompressionLevel]::Fastest, $false)
        Move-Item $tmpZip $appZip -Force
    }
    Ok ("app.zip: " + [math]::Round((Get-Item $appZip).Length/1MB, 1) + " MB")

    # --- bundle root: runtime scripts + version.json ------------------------------
    Step 'assemble bundle root (tools\installer\* + version.json)'
    Get-ChildItem (Join-Path $repo 'tools\installer') -File | ForEach-Object { Copy-Item $_.FullName $bundle -Force }
    $vj = @{ version = $ver; sha = $sha; date = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') } | ConvertTo-Json
    Set-Content -Path (Join-Path $bundle 'version.json') -Value $vj -Encoding ascii

    # --- third-party installers from cache (all OPTIONAL - warn when absent) -----
    $optional = @(
        @{ Name = 'Node.js MSI';          Filter = 'node-*.msi';                   Dir = $false },
        @{ Name = 'PostgreSQL installer'; Filter = 'postgresql-*-windows-x64.exe'; Dir = $false },
        @{ Name = 'Python embeddable';    Filter = 'python-*embed*.zip';           Dir = $false },
        @{ Name = 'get-pip.py';           Filter = 'get-pip.py';                   Dir = $false },
        @{ Name = 'wheels';               Filter = 'wheels';                       Dir = $true  },
        @{ Name = 'pm2 global tree';      Filter = 'pm2-global';                   Dir = $true  }
    )
    foreach ($o in $optional) {
        if ($o.Dir) {
            $src = Join-Path $cache $o.Filter
            $marker = if ($o.Filter -eq 'pm2-global') { Join-Path $src 'node_modules\pm2\package.json' } else { $src }
            if ((Test-Path $src) -and (Test-Path $marker)) {
                $dstDir = Join-Path $payloadInst $o.Filter
                if (Test-Path $dstDir) { Remove-Item $dstDir -Recurse -Force }
                # robocopy (with retries) not Copy-Item: real-time AV scanning
                # transiently locks the many small pm2/wheels files as they arrive,
                # which makes Copy-Item -Recurse abort. /R:3 /W:1 rides that out.
                & robocopy $src $dstDir /E /R:3 /W:1 /NFL /NDL /NJH /NJS | Out-Null
                if ($LASTEXITCODE -ge 8) { throw ("robocopy failed (" + $LASTEXITCODE + ") for " + $o.Name) }
                Ok ("payload: " + $o.Name)
            } else {
                Warn ("payload MISSING (optional): " + $o.Name + " - target servers must already have it")
            }
        } else {
            $f = Get-ChildItem $cache -Filter $o.Filter -File -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($f) { Copy-Item $f.FullName $payloadInst -Force; Ok ("payload: " + $f.Name) }
            else { Warn ("payload MISSING (optional): " + $o.Name + " - target servers must already have it") }
        }
    }

    # --- 7z the bundle -------------------------------------------------------------
    $sevenZr = Join-Path $cache '7zr.exe'
    $sfxMod  = Join-Path $cache '7zSD.sfx'
    $archive = Join-Path $work ("SDP-Dashboard-" + $ver + ".7z")
    if (-not (Test-Path $sevenZr)) {
        # No 7zr at all: ship the bundle as a plain zip so it is still usable.
        $zipOut = Join-Path $repo ("SDP-Dashboard-" + $ver + ".zip")
        [IO.Compression.ZipFile]::CreateFromDirectory($bundle, $zipOut, [IO.Compression.CompressionLevel]::Fastest, $false)
        Warn ("cache\7zr.exe missing - exe step BLOCKED. Fallback zip written: " + $zipOut)
        Warn 'Run tools\installer-build\download-cache.ps1 to fetch the SFX pieces, then rebuild.'
        exit 0
    }
    if (Test-Path $archive) {
        Ok 'bundle.7z already built - skipped (resume)'
    } else {
        Step '7zr a bundle.7z'
        Push-Location $bundle
        try {
            $tmp7z = $archive + '.tmp.7z'
            if (Test-Path $tmp7z) { Remove-Item $tmp7z -Force }
            & $sevenZr a -mx=1 -bd $tmp7z * | Out-Null
            if ($LASTEXITCODE -ne 0) { Die "7zr a failed ($LASTEXITCODE)" }
            Move-Item $tmp7z $archive -Force
        } finally { Pop-Location }
    }
    Ok ("bundle.7z: " + [math]::Round((Get-Item $archive).Length/1MB, 1) + " MB")

    if (-not (Test-Path $sfxMod)) {
        $sevenOut = Join-Path $repo ("SDP-Dashboard-" + $ver + ".7z")
        Copy-Item $archive $sevenOut -Force
        Warn ("cache\7zSD.sfx missing - exe step BLOCKED. Bundle archive written: " + $sevenOut)
        Warn 'Run tools\installer-build\download-cache.ps1 to fetch the SFX pieces, then rebuild.'
        exit 0
    }

    # --- SFX exe: 7zSD.sfx + config + .7z (binary concat) ---------------------------
    Step 'concat 7zSD.sfx + sfx config + bundle.7z -> exe'
    $sfxCfg = Join-Path $work 'sfx-config.txt'
    $cfgLines = @(
        ';!@Install@!UTF-8!',
        ('Title="SDP Dashboard Setup ' + $ver + '"'),
        'RunProgram="Setup.bat"',
        ';!@InstallEnd@!'
    )
    Set-Content -Path $sfxCfg -Value $cfgLines -Encoding ascii
    $exe = Join-Path $repo ("SDP-Setup-" + $ver + ".exe")
    $out = [IO.File]::Create($exe)
    try {
        foreach ($f in @($sfxMod, $sfxCfg, $archive)) {
            $in = [IO.File]::OpenRead($f)
            try { $in.CopyTo($out) } finally { $in.Close() }
        }
    } finally { $out.Close() }
    Ok ("BUILT: " + $exe + " (" + [math]::Round((Get-Item $exe).Length/1MB, 1) + " MB)")
    # success: drop the resumable work dir (kept on failure so a re-run resumes)
    if (-not $KeepWork -and (Test-Path $work)) {
        Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Host ''
    Write-Host 'Distribute the exe to the server, run it (UAC prompt), pick a menu option.' -ForegroundColor Gray

} finally {
    Pop-Location
}
exit 0
