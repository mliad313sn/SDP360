$ErrorActionPreference = 'Stop'
$cfg = 'C:\Users\Admin\AppData\Roaming\Claude\claude_desktop_config.json'

if (-not (Test-Path $cfg)) {
  $dir = Split-Path $cfg -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  '{ "mcpServers": {} }' | Set-Content -Path $cfg -Encoding UTF8
}

$backup = "$cfg.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item $cfg $backup
Write-Host "Backup: $backup"

$json = Get-Content $cfg -Raw | ConvertFrom-Json
if (-not $json.mcpServers) {
  $json | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([PSCustomObject]@{}) -Force
}

$entry = [PSCustomObject]@{
  command = 'npx'
  args    = @('-y', 'mcp-remote', 'https://mcp.higgsfield.ai/mcp')
  env     = [PSCustomObject]@{}
}

if ($json.mcpServers.PSObject.Properties['higgsfield']) {
  $json.mcpServers.higgsfield = $entry
} else {
  $json.mcpServers | Add-Member -NotePropertyName higgsfield -NotePropertyValue $entry
}

($json | ConvertTo-Json -Depth 20) | Set-Content -Path $cfg -Encoding UTF8
Write-Host "higgsfield added to $cfg"
Write-Host "Quit Claude Desktop fully (tray icon -> Quit) and relaunch."
