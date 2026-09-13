# start.ps1 - Launch Aseprite MCP Server on Windows
[CmdletBinding()]
param(
    [switch]$Mock,
    [int]$Port,
    [string]$BridgeToken,
    [string[]]$AllowedPaths,
    [switch]$ReadOnly,
    [string[]]$Toolsets
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if ($ReadOnly) {
    $env:ASEPRITE_READ_ONLY = "1"
}

if ($PSBoundParameters.ContainsKey('Toolsets')) {
    if (-not $Toolsets -or $Toolsets.Count -eq 0) {
        Write-Error "Toolsets was explicitly provided but contains no values."
        exit 1
    }
    $allowedToolsets = @('core','visual','editing','files','shapes','layers','frames','palette','cels','slices','selection','tiles','animation','pixel-art','review')
    foreach ($toolset in $Toolsets) {
        if ($allowedToolsets -notcontains $toolset) {
            Write-Error "Unknown toolset '$toolset'. Allowed values: $($allowedToolsets -join ', ')."
            exit 1
        }
    }
    $env:ASEPRITE_TOOLSETS = $Toolsets -join ','
}

# Port resolution logic:
# 1) If -Port is explicitly provided, validate and set ASEPRITE_PORT.
# 2) If omitted and ASEPRITE_PORT is already set, validate and use it as effective port.
# 3) If ASEPRITE_PORT is absent but ASEPRITE_WS_PORT exists, validate and use as effective port without setting ASEPRITE_PORT.
# 4) If neither exists, default ASEPRITE_PORT to 32123.
$effectivePort = 32123

if ($PSBoundParameters.ContainsKey('Port')) {
    if ($Port -lt 1024 -or $Port -gt 65535) {
        Write-Error "Invalid Port parameter: must be an integer between 1024 and 65535."
        exit 1
    }
    $env:ASEPRITE_PORT = "$Port"
    $effectivePort = $Port
} elseif (-not [string]::IsNullOrWhiteSpace($env:ASEPRITE_PORT)) {
    $parsedPort = 0
    if (-not [int]::TryParse($env:ASEPRITE_PORT.Trim(), [ref]$parsedPort) -or $parsedPort -lt 1024 -or $parsedPort -gt 65535) {
        Write-Error "Invalid existing ASEPRITE_PORT environment variable: '$($env:ASEPRITE_PORT)' must be an integer between 1024 and 65535."
        exit 1
    }
    $effectivePort = $parsedPort
} elseif (-not [string]::IsNullOrWhiteSpace($env:ASEPRITE_WS_PORT)) {
    $parsedPort = 0
    if (-not [int]::TryParse($env:ASEPRITE_WS_PORT.Trim(), [ref]$parsedPort) -or $parsedPort -lt 1024 -or $parsedPort -gt 65535) {
        Write-Error "Invalid existing ASEPRITE_WS_PORT environment variable: '$($env:ASEPRITE_WS_PORT)' must be an integer between 1024 and 65535."
        exit 1
    }
    $effectivePort = $parsedPort
} else {
    $env:ASEPRITE_PORT = "32123"
    $effectivePort = 32123
}

# BridgeToken resolution logic:
# 1) If -BridgeToken was explicitly passed:
#    - If empty or whitespace, treat as disabled and remove ASEPRITE_BRIDGE_TOKEN for process.
#    - If non-empty, trim and validate 16..128 URL-safe characters, then set ASEPRITE_BRIDGE_TOKEN.
# 2) If omitted, preserve any existing ASEPRITE_BRIDGE_TOKEN.
if ($PSBoundParameters.ContainsKey('BridgeToken')) {
    if ([string]::IsNullOrWhiteSpace($BridgeToken)) {
        Remove-Item Env:\ASEPRITE_BRIDGE_TOKEN -ErrorAction SilentlyContinue
    } else {
        $trimmedToken = $BridgeToken.Trim()
        if ($trimmedToken.Length -lt 16 -or $trimmedToken.Length -gt 128) {
            Write-Error "Invalid BridgeToken parameter: length must be between 16 and 128 characters."
            exit 1
        }
        if ($trimmedToken -notmatch '^[A-Za-z0-9._~-]+$') {
            Write-Error "Invalid BridgeToken parameter: token must contain only URL-safe characters [A-Za-z0-9._~-]."
            exit 1
        }
        $env:ASEPRITE_BRIDGE_TOKEN = $trimmedToken
    }
}

# AllowedPaths resolution logic:
# 1) If -AllowedPaths was explicitly passed:
#    - If empty collection, throw an error (no silent fallback).
#    - If entries exist, ensure all are absolute existing directories and join with PathSeparator.
# 2) If omitted, preserve any existing ASEPRITE_ALLOWED_PATHS.
if ($PSBoundParameters.ContainsKey('AllowedPaths')) {
    if (-not $AllowedPaths -or $AllowedPaths.Count -eq 0) {
        Write-Error "AllowedPaths parameter was explicitly provided but contains no paths."
        exit 1
    }
    $canonicalPaths = @()
    foreach ($p in $AllowedPaths) {
        if ([string]::IsNullOrWhiteSpace($p)) {
            Write-Error "AllowedPath entry cannot be empty."
            exit 1
        }
        if (-not [System.IO.Path]::IsPathRooted($p)) {
            Write-Error "AllowedPath is not absolute: '$p'"
            exit 1
        }
        if (-not (Test-Path -LiteralPath $p -PathType Container)) {
            Write-Error "AllowedPath does not exist or is not a directory: '$p'"
            exit 1
        }
        $resolved = (Resolve-Path -LiteralPath $p).Path
        $canonicalPaths += $resolved
    }
    $env:ASEPRITE_ALLOWED_PATHS = $canonicalPaths -join [System.IO.Path]::PathSeparator
}

# Build verification before starting Node.js
$distIndex = Join-Path $scriptDir "dist\index.js"
if (-not (Test-Path -LiteralPath $distIndex)) {
    Write-Host "dist\index.js not found. Running build..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed with exit code $LASTEXITCODE. Cannot start server."
        exit $LASTEXITCODE
    }
}

if ($Mock) {
    Write-Host "[Start] Starting with in-memory Mock Bridge on port $effectivePort..." -ForegroundColor Cyan
    $env:ASEPRITE_MCP_MOCK = "1"
    node dist/index.js
} else {
    Remove-Item Env:\ASEPRITE_MCP_MOCK -ErrorAction SilentlyContinue
    Write-Host "[Start] Starting Aseprite MCP Server on port $effectivePort..." -ForegroundColor Cyan
    node dist/index.js
}
