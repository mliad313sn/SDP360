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
