# Shared helpers for the static checks on cmd batch files (Setup.bat,
# _sdp_admin.cmd). Dot-source AFTER _assert.ps1. Get-LabelBody reads the
# caller's $lines (dynamic scope). KEEP PURE ASCII.

# Reads a batch file, asserts pure ASCII + CRLF only, returns its lines.
function Read-BatchLines([string]$path, [string]$name) {
    $bytes = [IO.File]::ReadAllBytes($path)
    Assert-Eq (@($bytes | Where-Object { $_ -gt 127 }).Count) 0 ($name + ' is pure ASCII')
    $text = [Text.Encoding]::ASCII.GetString($bytes)
    Assert-Eq ([regex]::Matches($text, "(?<!`r)`n").Count) 0 ($name + ' has CRLF line endings only')
    return , ($text -split "`r`n")
}

# Every goto / call :label target exists (comments skipped).
function Assert-BatchLabels($lines) {
    $labels = @{}
    foreach ($l in $lines) { if ($l -match '^\s*:([A-Za-z_][A-Za-z0-9_]*)\s*$') { $labels[$Matches[1].ToLower()] = $true } }
    foreach ($l in $lines) {
        if ($l -match '^\s*(rem\b|::)') { continue }
        foreach ($m in [regex]::Matches($l, '(?i)\bgoto\s+:?([A-Za-z_][A-Za-z0-9_]*)')) {
            $n = $m.Groups[1].Value.ToLower(); if ($n -eq 'eof') { continue }
            Assert-True $labels.ContainsKey($n) ("goto target exists: " + $n)
        }
        foreach ($m in [regex]::Matches($l, '(?i)\bcall\s+:([A-Za-z_][A-Za-z0-9_]*)')) {
            Assert-True $labels.ContainsKey($m.Groups[1].Value.ToLower()) ("call target exists: " + $m.Groups[1].Value)
        }
    }
}

# Delayed expansion is on: an echo may only carry !VAR! references, never a
# bare exclamation mark (it would be eaten).
function Assert-NoBareBang($lines) {
    foreach ($l in $lines) {
        if ($l -match '^\s*echo\b') {
            $rest = $l -replace '![A-Za-z_][A-Za-z_0-9]*!', ''
            Assert-True ($rest -notmatch '!') ('echo with a bare exclamation mark: ' + $l)
        }
    }
}

# Body of a label (up to the next label).
function Get-LabelBody([string]$name) {
    $out = @(); $in = $false
    foreach ($l in $lines) {
        if ($l -match '^\s*:([A-Za-z_][A-Za-z0-9_]*)\s*$') {
            if ($in) { break }
            if ($Matches[1] -ieq $name) { $in = $true; continue }
        }
        if ($in) { $out += $l }
    }
    return $out
}
function IndexOf($arr, [string]$pattern) { for ($i = 0; $i -lt $arr.Count; $i++) { if ($arr[$i] -match $pattern) { return $i } }; return -1 }
