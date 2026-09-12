import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = fs.existsSync(path.resolve(__dirname, "../../src"))
  ? path.resolve(__dirname, "../../")
  : process.cwd();

describe("Lua Bridge JSON Codec Security Validations (Static Analysis)", () => {
  const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
  const luaContent = fs.readFileSync(luaPath, "utf-8");

  describe("Absence of Dynamic Code Execution and Evaluation Primitives", () => {
    it("ensures load(...) function calls are strictly absent from lua/aseprite-bridge.lua", () => {
      expect(luaContent).not.toMatch(/\bload\s*\(/);
    });

    it("ensures loadstring primitives are strictly absent", () => {
      expect(luaContent).not.toContain("loadstring");
    });

    it("ensures dofile(...) calls are strictly absent", () => {
      expect(luaContent).not.toMatch(/\bdofile\s*\(/);
    });

    it("ensures require(...) calls are strictly absent", () => {
      expect(luaContent).not.toMatch(/\brequire\s*\(/);
    });

    it("ensures os.execute and io.popen system execution primitives are strictly absent", () => {
      expect(luaContent).not.toContain("os.execute");
      expect(luaContent).not.toContain("io.popen");
      expect(luaContent).not.toContain("package.loadlib");
    });

    it("ensures no string concatenation is fed to any dynamic execution function", () => {
      expect(luaContent).not.toMatch(/load\s*\(\s*["'].*?\.\./);
      expect(luaContent).not.toMatch(/loadstring\s*\(\s*["'].*?\.\./);
    });
  });

  describe("Protocol Isolation from Global json", () => {
    it("ensures the bridge does not overwrite or reassign the global json table", () => {
      expect(luaContent).not.toMatch(/\bjson\s*=\s*\{/);
      expect(luaContent).not.toMatch(/if\s+not\s+json\s+then/);
    });

    it("ensures incoming WebSocket text messages are parsed strictly using bridgeJson.decode", () => {
      expect(luaContent).toMatch(/local\s+ok,\s*req\s*=\s*pcall\(\s*bridgeJson\.decode\s*,\s*data\s*\)/);
      expect(luaContent).not.toMatch(/pcall\(\s*json\.decode\s*,\s*data\s*\)/);
    });

    it("ensures outgoing command responses are serialized strictly using bridgeJson.encode", () => {
      expect(luaContent).toMatch(/state\.ws:sendText\(\s*bridgeJson\.encode\(\s*response\s*\)\s*\)/);
      expect(luaContent).not.toMatch(/state\.ws:sendText\(\s*json\.encode\(\s*response\s*\)\s*\)/);
    });

    it("ensures revision_changed event payload uses bridgeJson.encode", () => {
      expect(luaContent).toMatch(/bridgeJson\.encode\(\s*\{[\s\S]*?event\s*=\s*"revision_changed"/);
      expect(luaContent).not.toMatch(/json\.encode\(\s*\{[\s\S]*?event\s*=\s*"revision_changed"/);
    });

    it("ensures sprite_switched event payload uses bridgeJson.encode", () => {
      expect(luaContent).toMatch(/bridgeJson\.encode\(\s*\{[\s\S]*?event\s*=\s*"sprite_switched"/);
      expect(luaContent).not.toMatch(/json\.encode\(\s*\{[\s\S]*?event\s*=\s*"sprite_switched"/);
    });

    it("ensures get_changes_since returns bounds as JSON_NULL sentinel instead of json.null", () => {
      expect(luaContent).toMatch(/bounds\s*=\s*JSON_NULL/);
      expect(luaContent).not.toMatch(/bounds\s*=\s*json\.null/);
    });
  });

  describe("bridgeJson Architecture and Security Guardrails", () => {
    it("defines local JSON_NULL sentinel and exports it as bridgeJson.null", () => {
      expect(luaContent).toMatch(/local\s+JSON_NULL\s*=\s*\{\}/);
      expect(luaContent).toMatch(/local\s+bridgeJson\s*=\s*\{[\s\S]*?null\s*=\s*JSON_NULL[\s\S]*?\}/);
    });

    it("enforces maximum nesting depth check (depth > 64) in bridgeJson.decode", () => {
      expect(luaContent).toMatch(/if\s+depth\s*>\s*64\s+then[\s\S]*?JSON\s+maximum\s+depth\s+exceeded/);
    });

    it("enforces maximum nesting depth check (depth > 64) in bridgeJson.encode", () => {
      expect(luaContent).toMatch(/if\s+depth\s*>\s*64\s+then[\s\S]*?JSON\s+encode\s+maximum\s+depth\s+exceeded/);
    });

    it("detects and rejects circular table references in bridgeJson.encode", () => {
      expect(luaContent).toMatch(/if\s+seen\[val\]\s+then[\s\S]*?Circular\s+reference\s+detected/);
    });

    it("rejects non-finite numbers (NaN, Infinity, -Infinity) in bridgeJson.encode", () => {
      expect(luaContent).toMatch(/val\s*~=\s*val[\s\S]*?math\.huge[\s\S]*?Cannot\s+encode\s+NaN\s+or\s+Infinity/);
    });

    it("rejects non-string object keys in bridgeJson.encode", () => {
      expect(luaContent).toMatch(/type\(k\)\s*~=\s*"string"[\s\S]*?JSON\s+object\s+keys\s+must\s+be\s+strings/);
    });

    it("sorts object keys alphabetically for deterministic JSON serialization", () => {
      expect(luaContent).toMatch(/table\.sort\(\s*keys\s*\)/);
    });

    it("rejects trailing garbage after top-level JSON value in bridgeJson.decode", () => {
      expect(luaContent).toMatch(/Trailing\s+garbage\s+after\s+JSON\s+value/);
    });

    it("rejects raw unescaped ASCII control characters (< 32) in string literals", () => {
      expect(luaContent).toMatch(/b\s*<\s*32[\s\S]*?Unescaped\s+control\s+character\s+in\s+string/);
    });

    it("rejects non-finite numbers (NaN, Infinity, -Infinity) in bridgeJson.decode for overflows like 1e999", () => {
      expect(luaContent).toMatch(/num\s*==\s*math\.huge/);
      expect(luaContent).toMatch(/num\s*==\s*-math\.huge/);
    });

    it("contains narrow, production-inert test seam for test runner", () => {
      expect(luaContent).toMatch(/if\s+rawget\(_G,\s*["']__ASEPRITE_MCP_JSON_TEST_MODE["']\)\s+then\s+return\s+bridgeJson,\s*JSON_NULL\s+end/);
    });

    it("strictly validates numbers against RFC 8259 grammar via isValidJsonNumber", () => {
      expect(luaContent).toMatch(/local\s+function\s+isValidJsonNumber\s*\(/);
      expect(luaContent).toMatch(/Invalid\s+JSON\s+number/);
    });

    it("correctly converts Unicode code points and validates surrogate pairs", () => {
      expect(luaContent).toMatch(/local\s+function\s+codepointToUtf8\s*\(/);
      expect(luaContent).toMatch(/0xD800/);
      expect(luaContent).toMatch(/0xDBFF/);
      expect(luaContent).toMatch(/0xDC00/);
      expect(luaContent).toMatch(/0xDFFF/);
      expect(luaContent).toMatch(/Isolated\s+high\s+surrogate/);
      expect(luaContent).toMatch(/Isolated\s+low\s+surrogate/);
    });
  });

  describe("Functional Lua Test Suite Verification", () => {
    it("ensures test/lua/json_codec_test.lua exists and exercises the test seam", () => {
      const testLuaPath = path.resolve(rootDir, "test/lua/json_codec_test.lua");
      expect(fs.existsSync(testLuaPath)).toBe(true);

      const testLuaContent = fs.readFileSync(testLuaPath, "utf-8");
      expect(testLuaContent).toContain("__ASEPRITE_MCP_JSON_TEST_MODE = true");
      expect(testLuaContent).toContain("dofile(bridgePath)");
      expect(testLuaContent).toContain('print("lua_json_codec_ok")');
    });
  });

  describe("Corpus of Malicious Injection Payloads (Static Flow Verification)", () => {
    const maliciousPayloads = [
      '{"command": (os.execute("calc"))}',
      '{"id": (function() os.execute("id") end)()}',
      '{"command": "ping", "params": (io.popen("whoami"):read("*a"))}',
      '{"a": 1}; os.remove("test.txt"); --',
      '[1, 2, (os.exit(1))]',
      '{"cmd": load("return 42")()}',
      '{"a": loadstring("return 42")()}',
      '{"a": dofile("/etc/passwd")}',
      '{"a": require("socket")}',
      '{"a": package.loadlib("foo", "bar")}',
      '{"cmd": _G["os"]["execute"]("calc")}',
      '{"__proto__": null, "code": (function() return 1337 end)()}',
      '{"x": string.rep("A", 1000000)}',
    ];

    it("verifies none of the malicious patterns can be evaluated because dynamic sinks are removed", () => {
      for (const payload of maliciousPayloads) {
        // In the legacy bridge, payload would be interpolated into:
        // `load("return " .. s)`
        // Here we statically assert that no `load` sink exists in the bridge code.
        expect(luaContent).not.toContain("load(");
        expect(luaContent).not.toContain("loadstring(");
        expect(luaContent).not.toContain("dofile(");

        // Verify that WebSocket reception passes directly and exclusively into pure-data bridgeJson.decode
        const wsHandlerIndex = luaContent.indexOf("msgType == WebSocketMessageType.TEXT");
        expect(wsHandlerIndex).toBeGreaterThan(-1);

        const afterWs = luaContent.substring(wsHandlerIndex, wsHandlerIndex + 250);
        expect(afterWs).toContain("pcall(bridgeJson.decode, data)");
        expect(afterWs).not.toContain("load");
      }
    });
  });
});
