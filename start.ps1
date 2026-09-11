# start.ps1 - Launch Aseprite MCP Server on Windows
[CmdletBinding()]
param(
    [switch]$Mock,
    [int]$Port = 32123
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$distIndex = Join-Path $scriptDir "dist\index.js"
if (-not (Test-Path $distIndex)) {
    Write-Host "dist\index.js not found. Running build..." -ForegroundColor Yellow
    npm run build
}

if ($Mock) {
    Write-Host "[Start] Starting with in-memory Mock Bridge on port $Port..." -ForegroundColor Cyan
    # Launch with ASEPRITE_MCP_MOCK=1
    $env:ASEPRITE_MCP_PORT = "$Port"
    $env:ASEPRITE_MCP_MOCK = "1"
    node dist/index.js
} else {
    $env:ASEPRITE_MCP_PORT = "$Port"
    node dist/index.js
}
