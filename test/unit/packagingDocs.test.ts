// test/unit/packagingDocs.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = fs.existsSync(path.resolve(__dirname, "../../src"))
  ? path.resolve(__dirname, "../../")
  : process.cwd();

describe("Packaging, Documentation & Script Alignment Static Contract", () => {
  it("package.json description does not claim Official and files array includes LICENSE and examples", () => {
    const pkgPath = path.resolve(rootDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

    expect(pkg.description).not.toMatch(/official/i);
    expect(pkg.description).toContain("Model Context Protocol (MCP) server");
    expect(pkg.files).toContain("LICENSE");
    expect(pkg.files).toContain("examples");
  });

  it("LICENSE contains standard MIT license text, Permission clause, and copyright 2026 Zythenth", () => {
    const licensePath = path.resolve(rootDir, "LICENSE");
    expect(fs.existsSync(licensePath)).toBe(true);

    const licenseContent = fs.readFileSync(licensePath, "utf-8");
    expect(licenseContent).toContain("MIT License");
    expect(licenseContent).toContain("Permission is hereby granted");
    expect(licenseContent).toContain("Copyright (c) 2026 Zythenth");
  });

  it("start.ps1 and examples/gemini-mcp-config.json use canonical ASEPRITE_PORT and do not contain legacy ASEPRITE_MCP_PORT", () => {
    const startScriptPath = path.resolve(rootDir, "start.ps1");
    const startContent = fs.readFileSync(startScriptPath, "utf-8");

    expect(startContent).not.toContain("ASEPRITE_MCP_PORT");
    expect(startContent).toContain("ASEPRITE_PORT");
    expect(startContent).toContain("BridgeToken");
    expect(startContent).toContain("AllowedPaths");
    expect(startContent).toContain("ProjectRoot");

    const examplePath = path.resolve(rootDir, "examples/gemini-mcp-config.json");
    const exampleRaw = fs.readFileSync(examplePath, "utf-8");

    expect(exampleRaw).not.toContain("ASEPRITE_MCP_PORT");
    expect(exampleRaw).toContain("ASEPRITE_PORT");
    expect(exampleRaw).toContain("ASEPRITE_ALLOWED_PATHS");
    expect(exampleRaw).toContain("ASEPRITE_PROJECT_ROOT");

    // Must be valid JSON
    const parsed = JSON.parse(exampleRaw);
    expect(parsed.mcpServers?.aseprite?.env?.ASEPRITE_PORT).toBe("32123");
    expect(parsed.mcpServers?.aseprite?.env?.ASEPRITE_ALLOWED_PATHS).toBeDefined();
    expect(parsed.mcpServers?.aseprite?.env?.ASEPRITE_PROJECT_ROOT).toBeDefined();
  });

  it("README.md documents security policies, tokens, non-official nature, and forbids editing PORT in Lua", () => {
    const readmePath = path.resolve(rootDir, "README.md");
    const readmeContent = fs.readFileSync(readmePath, "utf-8");

    expect(readmeContent).toContain("ASEPRITE_ALLOWED_PATHS");
    expect(readmeContent).toContain("ASEPRITE_PROJECT_ROOT");
    expect(readmeContent).toContain("ASEPRITE_BRIDGE_TOKEN");
    expect(readmeContent).toContain("overwrite");
    expect(readmeContent).toMatch(/não oficial|Não Oficial/i);

    // Explicitly states not to edit PORT in lua script
    expect(readmeContent).toMatch(/[Nn]ão edite.*lua.*alterar.*porta/i);
    expect(readmeContent).not.toContain("o valor de PORT no início de lua/aseprite-bridge.lua também precisa ser alterado");
  });

  it("start.ps1 implements robust parameter handling with PSBoundParameters, port preservation, and safe secret handling", () => {
    const startScriptPath = path.resolve(rootDir, "start.ps1");
    const startContent = fs.readFileSync(startScriptPath, "utf-8");

    // PSBoundParameters checks
    expect(startContent).toContain("$PSBoundParameters.ContainsKey('Port')");
    expect(startContent).toContain("$PSBoundParameters.ContainsKey('BridgeToken')");
    expect(startContent).toContain("$PSBoundParameters.ContainsKey('AllowedPaths')");
    expect(startContent).toContain("$PSBoundParameters.ContainsKey('ProjectRoot')");

    // Port preservation and fallback logic
    expect(startContent).toContain("$env:ASEPRITE_PORT");
    expect(startContent).toContain("$env:ASEPRITE_WS_PORT");
    expect(startContent).toMatch(/\$effectivePort\s*=\s*\$Port/);
    expect(startContent).toMatch(/\$effectivePort\s*=\s*\$parsedPort/);
    expect(startContent).toMatch(/\$effectivePort\s*=\s*32123/);

    // Messages use effectivePort and do not leak token
    expect(startContent).toContain("Starting Aseprite MCP Server on port $effectivePort");
    expect(startContent).toContain("Starting with in-memory Mock Bridge on port $effectivePort");
    expect(startContent).not.toMatch(/Write-Host.*\$BridgeToken/i);
    expect(startContent).not.toMatch(/Write-Host.*ASEPRITE_BRIDGE_TOKEN/i);

    // Whitespace token removes variable for process; valid token validates regex
    expect(startContent).toContain("Remove-Item Env:\\ASEPRITE_BRIDGE_TOKEN -ErrorAction SilentlyContinue");
    expect(startContent).toContain("^[A-Za-z0-9._~-]+$");

    // AllowedPaths rejects empty explicit array
    expect(startContent).toMatch(/AllowedPaths\.Count\s+-eq\s+0/);

    // Mock environment variable handling: sets in if ($Mock) and cleans in else branch
    expect(startContent).toMatch(/if\s*\(\$Mock\)\s*\{[\s\S]*?\$env:ASEPRITE_MCP_MOCK\s*=\s*["']1["']/);
    expect(startContent).toMatch(/else\s*\{[\s\S]*?Remove-Item\s+Env:\\ASEPRITE_MCP_MOCK\s+-ErrorAction\s+SilentlyContinue/);

    expect(startContent).toContain("[switch]$ReadOnly");
    expect(startContent).toContain("[string[]]$Toolsets");
    expect(startContent).toContain("ASEPRITE_READ_ONLY");
    expect(startContent).toContain("ASEPRITE_TOOLSETS");
  });

  it("README.md does not encourage passing tokens in start.ps1 CLI arguments, uses valid placeholder, and documents save_sprite", () => {
    const readmePath = path.resolve(rootDir, "README.md");
    const readmeContent = fs.readFileSync(readmePath, "utf-8");

    // Must not contain -BridgeToken in start.ps1 examples
    expect(readmeContent).not.toContain("-BridgeToken \"seu-token");
    expect(readmeContent).not.toMatch(/start\.ps1[^\n]*-BridgeToken/);

    // Hardened JSON uses valid syntactic placeholder
    expect(readmeContent).toContain('"ASEPRITE_BRIDGE_TOKEN": "SubstituaPeloSeuTokenAleatorio12345"');
    expect(readmeContent).not.toContain("<seu-token-gerado-com-32-bytes>");

    // Documents save_sprite taking no user path and internal validation
    expect(readmeContent).toMatch(/save_sprite.*não recebe caminho do usuário/i);
    expect(readmeContent).toContain("aseprite_status");
    expect(readmeContent).toContain("expectedFilePath");

    // Documents terminal history risk
    expect(readmeContent).toMatch(/histórico do (?:shell|terminal)/i);
  });

  it("install.ps1 uses npm ci and utilizes InstallLuaToAseprite in execution logic", () => {
    const installScriptPath = path.resolve(rootDir, "install.ps1");
    const installContent = fs.readFileSync(installScriptPath, "utf-8");

    expect(installContent).toContain("npm ci");
    // Ensure InstallLuaToAseprite is used in conditional logic beyond parameter declaration
    expect(installContent).toMatch(/\$shouldInstallScript\s*=\s*\$InstallLuaToAseprite\s+-or/);
    expect(installContent).toContain("BRIDGE_PROTOCOL_VERSION");
    expect(installContent).toContain("dist\\bridge\\protocol.js");
    expect(installContent).not.toContain("src\\bridge\\protocol.ts");
    expect(installContent).toContain("Get-FileHash");
    expect(installContent).toContain("SHA-256 verified");
  });

  it("README documents the complete configurable surface and in-memory review-state limitation", () => {
    const readmeContent = fs.readFileSync(path.resolve(rootDir, "README.md"), "utf-8");
    expect(readmeContent).toContain("92 ferramentas");
    expect(readmeContent).toContain("ASEPRITE_READ_ONLY");
    expect(readmeContent).toContain("ASEPRITE_TOOLSETS");
    expect(readmeContent).toContain("export_sprite_sheet");
    expect(readmeContent).toContain("load_reference_image");
    expect(readmeContent).toContain("find_reference_images");
    expect(readmeContent).toContain("save_project");
    expect(readmeContent).toContain("get_onion_skin");
    expect(readmeContent).toContain("lint_pixel_art");
    expect(readmeContent).toMatch(/mantidos apenas em memória/i);
  });

  it("CI runs the full Node suite and a pinned real-Aseprite smoke matrix", () => {
    const workflow = fs.readFileSync(path.resolve(rootDir, ".github/workflows/ci.yml"), "utf-8");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("v1.3.18.5");
    expect(workflow).toContain("test/real/aseprite-api-smoke.lua");
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("macos-latest");
    expect(workflow).toContain("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
    expect(workflow).toContain("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
    expect(workflow).toContain("vswhere.exe");
    expect(workflow).not.toContain("Visual Studio\\2022\\Enterprise");
  });

  it("lua/aseprite-bridge.lua sanitizes WebSocket error event without tostring(err) to prevent token leakage", () => {
    const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
    const luaContent = fs.readFileSync(luaPath, "utf-8");

    expect(luaContent).not.toMatch(/WebSocketMessageType\.ERROR[\s\S]*?tostring\s*\(\s*err\s*\)/);
    expect(luaContent).toContain('Connection error (check server logs)');
    expect(luaContent).not.toMatch(/dlg:modify\{[^}]*BRIDGE_TOKEN/);
  });

  it("src/mcp/tools/status.ts reports effective config.port and does not import DEFAULT_WS_PORT in fallback", () => {
    const statusPath = path.resolve(rootDir, "src/mcp/tools/status.ts");
    const statusContent = fs.readFileSync(statusPath, "utf-8");

    expect(statusContent).not.toContain("DEFAULT_WS_PORT");
    expect(statusContent).toContain("port: config.port");
  });
});
