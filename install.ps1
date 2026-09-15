# install.ps1 - Automated Setup for Aseprite MCP Server on Windows
[CmdletBinding()]
param(
    [switch]$SkipTests,
    [switch]$InstallLuaToAseprite
)

$ErrorActionPreference = "Stop"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   Aseprite MCP Server - Automated Installer (Windows)   " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js
Write-Host "[1/5] Checking Node.js environment..." -ForegroundColor Yellow
try {
    $nodeVersion = node -v
    Write-Host "      Found Node.js: $nodeVersion" -ForegroundColor Green
    $major = [int]($nodeVersion -replace '^v([0-9]+)\..*$', '$1')
    if ($major -lt 18) {
        Write-Error "Node.js 18.0.0 or newer is required. Found $nodeVersion."
        exit 1
    }
} catch {
    Write-Error "Node.js is not installed or not in PATH. Please install Node.js >= 18 from https://nodejs.org/."
    exit 1
}

# 2. Check npm
Write-Host "[2/5] Checking npm package manager..." -ForegroundColor Yellow
try {
    $npmVersion = npm -v
    Write-Host "      Found npm: v$npmVersion" -ForegroundColor Green
} catch {
    Write-Error "npm is not installed or not in PATH."
    exit 1
}

# 3. Install Dependencies
Write-Host "[3/5] Installing npm dependencies..." -ForegroundColor Yellow
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$lockFile = Join-Path $scriptDir "package-lock.json"
if (Test-Path -LiteralPath $lockFile) {
    npm ci --ignore-scripts --no-audit --no-fund
} else {
    npm install --ignore-scripts --no-audit --no-fund
}
if ($LASTEXITCODE -ne 0) {
    Write-Error "Dependency installation failed."
    exit $LASTEXITCODE
}
Write-Host "      Dependencies installed successfully." -ForegroundColor Green

# 4. Compile TypeScript project
Write-Host "[4/5] Compiling TypeScript project..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "TypeScript compilation failed."
    exit $LASTEXITCODE
}
Write-Host "      Build completed successfully (dist/ generated)." -ForegroundColor Green

# Verify that the packaged server artifact and Lua bridge use the same protocol.
# dist/ is used intentionally because src/ is not part of the published npm package.
$protocolArtifactPath = Join-Path $scriptDir "dist\bridge\protocol.js"
$protocolSource = Get-Content -LiteralPath $protocolArtifactPath -Raw
$luaSourcePath = Join-Path $scriptDir "lua\aseprite-bridge.lua"
$luaBridgeSource = Get-Content -LiteralPath $luaSourcePath -Raw
$serverProtocolMatch = [regex]::Match($protocolSource, 'BRIDGE_PROTOCOL_VERSION\s*=\s*["''](?<version>[^"'']+)["'']')
$luaProtocolMatch = [regex]::Match($luaBridgeSource, 'BRIDGE_PROTOCOL_VERSION\s*=\s*["''](?<version>[^"'']+)["'']')
if (-not $serverProtocolMatch.Success -or -not $luaProtocolMatch.Success) {
    Write-Error "Could not determine the bridge protocol version from the compiled server and Lua bridge."
    exit 1
}
if ($serverProtocolMatch.Groups['version'].Value -ne $luaProtocolMatch.Groups['version'].Value) {
    Write-Error "Bridge protocol mismatch: server=$($serverProtocolMatch.Groups['version'].Value), lua=$($luaProtocolMatch.Groups['version'].Value)."
    exit 1
}
Write-Host "      Bridge protocol verified: v$($serverProtocolMatch.Groups['version'].Value)." -ForegroundColor Green

# 5. Run Automated Tests
if (-not $SkipTests) {
    Write-Host "[5/5] Running automated verification test suite..." -ForegroundColor Yellow
    npm test
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Test suite reported failures."
        exit $LASTEXITCODE
    }
    Write-Host "      All automated tests passed successfully!" -ForegroundColor Green
} else {
    Write-Host "[5/5] Skipping test suite as requested." -ForegroundColor Gray
}

# Optional: Copy Lua Bridge to Aseprite Scripts Folder
$appData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
$asepriteBaseDir = Join-Path $appData "Aseprite"
$asepriteScriptsDir = Join-Path $appData "Aseprite\scripts"
$luaSource = Join-Path $scriptDir "lua\aseprite-bridge.lua"

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   Aseprite Lua Bridge Integration                     " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

$shouldInstallScript = $InstallLuaToAseprite -or (Test-Path -LiteralPath $asepriteBaseDir)

if (Test-Path -LiteralPath $luaSource) {
    if ($shouldInstallScript) {
        if (-not (Test-Path -LiteralPath $asepriteScriptsDir)) {
            New-Item -ItemType Directory -Path $asepriteScriptsDir -Force | Out-Null
        }
        $targetLua = Join-Path $asepriteScriptsDir "aseprite-bridge.lua"
        Copy-Item -Path $luaSource -Destination $targetLua -Force
        $sourceHash = (Get-FileHash -LiteralPath $luaSource -Algorithm SHA256).Hash
        $targetHash = (Get-FileHash -LiteralPath $targetLua -Algorithm SHA256).Hash
        if ($sourceHash -ne $targetHash) {
            Write-Error "Installed Lua bridge hash does not match the packaged source."
            exit 1
        }
        Write-Host "[OK] Copied lua/aseprite-bridge.lua directly to:" -ForegroundColor Green
        Write-Host "  $targetLua" -ForegroundColor White
        Write-Host "  Protocol v$($serverProtocolMatch.Groups['version'].Value), SHA-256 verified." -ForegroundColor Green
        Write-Host "  In Aseprite, open: File -> Scripts -> aseprite-bridge" -ForegroundColor Yellow
        Write-Host "  On the first file-export security prompt, verify this exact script path," -ForegroundColor Yellow
        Write-Host "  then select 'Give full trust to this script' to avoid per-file prompts." -ForegroundColor Yellow
    } else {
        Write-Host "Notice: Aseprite directory not found at $appData\Aseprite." -ForegroundColor Gray
        Write-Host "To install the bridge manually, in Aseprite go to: File -> Scripts -> Open Scripts Folder" -ForegroundColor Yellow
        Write-Host "and copy: $luaSource into that directory." -ForegroundColor Yellow
        Write-Host "(Or re-run installer with -InstallLuaToAseprite to force create the directory)." -ForegroundColor Gray
    }
}
