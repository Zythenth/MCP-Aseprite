-- ==============================================================================
-- Functional Security & Correctness Test Suite for bridgeJson (test/lua/json_codec_test.lua)
-- Executable by Lua 5.4.6 / standard Lua 5.3+
-- Usage: lua test/lua/json_codec_test.lua [path/to/aseprite-bridge.lua]
-- ==============================================================================

local bridgePath = arg and arg[1] or "lua/aseprite-bridge.lua"

-- Helper assertion utilities
local function assert_true(cond, msg)
  if not cond then
    error("Assertion failed: " .. (msg or "condition was false"), 2)
  end
end

local function assert_eq(actual, expected, msg)
  if actual ~= expected then
    error(string.format("%s: expected %s, got %s", msg or "Assertion failed", tostring(expected), tostring(actual)), 2)
  end
end

local function assert_fails(fn, msg)
  local ok, err = pcall(fn)
  if ok then
    error("Expected failure for: " .. (msg or "unspecified case") .. ", but it succeeded", 2)
  end
end

-- 1. Activate test seam and load codec chunk
_G.__ASEPRITE_MCP_JSON_TEST_MODE = true
local bridgeJson, JSON_NULL = dofile(bridgePath)
_G.__ASEPRITE_MCP_JSON_TEST_MODE = nil

assert_true(type(bridgeJson) == "table", "bridgeJson must be a table")
assert_true(type(JSON_NULL) == "table", "JSON_NULL must be a sentinel table")
assert_true(bridgeJson.null == JSON_NULL, "bridgeJson.null must equal JSON_NULL")
assert_true(type(bridgeJson.decode) == "function", "bridgeJson.decode must be a function")
assert_true(type(bridgeJson.encode) == "function", "bridgeJson.encode must be a function")

-- 2. Decode/Encode Roundtrip of complex MCP request
do
  local req = {
    id = 101,
    command = "set_pixels",
    params = {
      layerIndex = 0,
      frameNumber = 1,
      active = true,
      disabled = false,
      bounds = JSON_NULL,
      escapedText = "Line 1\nLine 2\r\n\tTabbed \"Quotes\" and \\backslashes\\ /slashes/",
      scalarInt = 42,
      scalarFloat = 123.456,
      scalarExp = -1.25e-3,
      zero = 0,
      negZero = -0,
      emptyObj = {},
      emptyArr = {},
      pixelList = {
        { x = 0, y = 0, color = "#FF0000FF" },
        { x = 1, y = 1, color = "#00FF00FF" }
      }
    }
  }

  local encoded = bridgeJson.encode(req)
  assert_true(type(encoded) == "string", "encode must return a string")

  local decoded = bridgeJson.decode(encoded)
  assert_eq(decoded.id, 101, "req.id")
  assert_eq(decoded.command, "set_pixels", "req.command")
  assert_eq(decoded.params.layerIndex, 0, "layerIndex")
  assert_eq(decoded.params.frameNumber, 1, "frameNumber")
  assert_eq(decoded.params.active, true, "active")
  assert_eq(decoded.params.disabled, false, "disabled")
  assert_true(decoded.params.bounds == JSON_NULL, "bounds must be JSON_NULL sentinel")
  assert_eq(decoded.params.escapedText, "Line 1\nLine 2\r\n\tTabbed \"Quotes\" and \\backslashes\\ /slashes/", "escapedText")
  assert_eq(decoded.params.scalarInt, 42, "scalarInt")
  assert_true(math.abs(decoded.params.scalarFloat - 123.456) < 1e-6, "scalarFloat")
  assert_true(math.abs(decoded.params.scalarExp - (-0.00125)) < 1e-7, "scalarExp")
  assert_eq(#decoded.params.pixelList, 2, "pixelList count")
  assert_eq(decoded.params.pixelList[1].x, 0, "pixel 1 x")
  assert_eq(decoded.params.pixelList[2].color, "#00FF00FF", "pixel 2 color")
end

-- 3. String Escapes and Valid Surrogate Pair (Emoji)
do
  -- Test standard escape sequence decoding
  local escInput = '"\\\"\\\\\\/\\b\\f\\n\\r\\t"'
  local escResult = bridgeJson.decode(escInput)
  assert_eq(escResult, '"\\/\b\f\n\r\t', "Standard escape characters")

  -- Test Unicode codepoint \uXXXX
  local uInput = '"\\u0041\\u0042\\u0043"' -- "ABC"
  assert_eq(bridgeJson.decode(uInput), "ABC", "Basic unicode escape")

  -- Test Valid Surrogate Pair: U+1F600 (GRINNING FACE) -> \uD83D\uDE00
  local emojiInput = '"Hello \\uD83D\\uDE00 World"'
  local emojiDecoded = bridgeJson.decode(emojiInput)
  local expectedUtf8 = "Hello " .. string.char(0xF0, 0x9F, 0x98, 0x80) .. " World"
  assert_eq(emojiDecoded, expectedUtf8, "Valid surrogate pair emoji decoding")

  -- Re-encode and verify roundtrip
  local reEncoded = bridgeJson.encode(emojiDecoded)
  local reDecoded = bridgeJson.decode(reEncoded)
  assert_eq(reDecoded, expectedUtf8, "Emoji encode/decode roundtrip")
end

-- 4. Strict Rejection of Invalid Syntax and Ill-formed Input
do
  -- Isolated surrogates
  assert_fails(function() bridgeJson.decode('"\\uD83D"') end, "Isolated high surrogate")
  assert_fails(function() bridgeJson.decode('"\\uD83D\\u0041"') end, "High surrogate followed by non-surrogate")
  assert_fails(function() bridgeJson.decode('"\\uDE00"') end, "Isolated low surrogate")

  -- Invalid escapes
  assert_fails(function() bridgeJson.decode('"\\x41"') end, "Hex escape \\x not permitted in JSON")
  assert_fails(function() bridgeJson.decode('"\\a"') end, "Bell escape \\a not permitted in JSON")
  assert_fails(function() bridgeJson.decode('"\\\'"') end, "Single quote escape \\' not permitted in JSON")
  assert_fails(function() bridgeJson.decode('"\\u12"') end, "Incomplete unicode escape")

  -- Raw unescaped control characters in strings
  assert_fails(function() bridgeJson.decode("\"\n\"") end, "Raw newline in string")
  assert_fails(function() bridgeJson.decode("\"\r\"") end, "Raw carriage return in string")
  assert_fails(function() bridgeJson.decode("\"\t\"") end, "Raw tab in string")
  assert_fails(function() bridgeJson.decode('"' .. string.char(1) .. '"') end, "Raw ASCII 0x01 control char in string")
  assert_fails(function() bridgeJson.decode('"' .. string.char(31) .. '"') end, "Raw ASCII 0x1F control char in string")

  -- Trailing commas
  assert_fails(function() bridgeJson.decode('[1, 2,]') end, "Trailing comma in array")
  assert_fails(function() bridgeJson.decode('{"a": 1,}') end, "Trailing comma in object")

  -- Trailing garbage
  assert_fails(function() bridgeJson.decode('123 abc') end, "Trailing alpha characters")
  assert_fails(function() bridgeJson.decode('{"a": 1} [2]') end, "Trailing extra JSON value")
  assert_fails(function() bridgeJson.decode('true false') end, "Trailing boolean")

  -- Ill-formed / non-standard numbers
  assert_fails(function() bridgeJson.decode('01') end, "Leading zero integer: 01")
  assert_fails(function() bridgeJson.decode('-01') end, "Negative leading zero integer: -01")
  assert_fails(function() bridgeJson.decode('+1') end, "Leading plus sign: +1")
  assert_fails(function() bridgeJson.decode('.5') end, "Missing leading zero: .5")
  assert_fails(function() bridgeJson.decode('1.') end, "Trailing decimal point: 1.")
  assert_fails(function() bridgeJson.decode('1e') end, "Exponent without digits: 1e")
  assert_fails(function() bridgeJson.decode('1e+') end, "Exponent sign without digits: 1e+")
  assert_fails(function() bridgeJson.decode('1e999') end, "Overflow beyond finite float: 1e999")
  assert_fails(function() bridgeJson.decode('-1e999') end, "Negative overflow beyond finite float: -1e999")
  assert_fails(function() bridgeJson.decode('NaN') end, "Bare NaN")
  assert_fails(function() bridgeJson.decode('Infinity') end, "Bare Infinity")
  assert_fails(function() bridgeJson.decode('0x10') end, "Hexadecimal number: 0x10")
end

-- 5. Depth Limit Enforcement (exact boundary: 64 passes, 65 fails)
do
  -- Decode positive: exactly 64 nested empty arrays must pass
  local arr64Str = string.rep("[", 64) .. string.rep("]", 64)
  local decodedArr64 = bridgeJson.decode(arr64Str)
  assert_true(type(decodedArr64) == "table", "Decode 64 nested empty arrays must succeed")

  -- Decode negative: exactly 65 nested empty arrays must fail
  local arr65Str = string.rep("[", 65) .. string.rep("]", 65)
  assert_fails(function() bridgeJson.decode(arr65Str) end, "Decode depth limit 65 arrays must fail")

  -- Decode positive: exactly 64 nested objects must pass
  local obj64Str = ""
  for i = 1, 63 do obj64Str = obj64Str .. '{"k":' end
  obj64Str = obj64Str .. "{}" .. string.rep("}", 63)
  local decodedObj64 = bridgeJson.decode(obj64Str)
  assert_true(type(decodedObj64) == "table", "Decode 64 nested objects must succeed")

  -- Decode negative: exactly 65 nested objects must fail
  local obj65Str = ""
  for i = 1, 64 do obj65Str = obj65Str .. '{"k":' end
  obj65Str = obj65Str .. "{}" .. string.rep("}", 64)
  assert_fails(function() bridgeJson.decode(obj65Str) end, "Decode depth limit 65 objects must fail")

  -- Encode positive: exactly 64 nested tables must pass
  local tbl64 = {}
  local curr64 = tbl64
  for i = 1, 63 do
    curr64.child = {}
    curr64 = curr64.child
  end
  local encodedTbl64 = bridgeJson.encode(tbl64)
  assert_true(type(encodedTbl64) == "string", "Encode 64 nested tables must succeed")

  -- Encode negative: exactly 65 nested tables must fail
  local tbl65 = {}
  local curr65 = tbl65
  for i = 1, 64 do
    curr65.child = {}
    curr65 = curr65.child
  end
  assert_fails(function() bridgeJson.encode(tbl65) end, "Encode depth limit 65 tables must fail")
end

-- 6. Deterministic Encoding and Serialization Constraints
do
  -- Deterministic key sorting
  local obj = { z = 26, a = 1, m = 13, b = 2 }
  local encodedObj = bridgeJson.encode(obj)
  assert_eq(encodedObj, '{"a":1,"b":2,"m":13,"z":26}', "Keys must be sorted alphabetically")

  -- Literal null encoding
  assert_eq(bridgeJson.encode(nil), "null", "nil encodes to null")
  assert_eq(bridgeJson.encode(JSON_NULL), "null", "JSON_NULL encodes to null")
  assert_eq(bridgeJson.encode({ val = JSON_NULL }), '{"val":null}', "Object null field")
  assert_eq(bridgeJson.encode({ 1, JSON_NULL, 3 }), '[1,null,3]', "Array null element")

  -- Empty table / array encoding
  assert_eq(bridgeJson.encode({}), "{}", "Empty table encodes to {}")

  -- Rejection of NaN and Infinity in encode
  assert_fails(function() bridgeJson.encode(0/0) end, "Encode NaN")
  assert_fails(function() bridgeJson.encode(math.huge) end, "Encode +Infinity")
  assert_fails(function() bridgeJson.encode(-math.huge) end, "Encode -Infinity")

  -- Rejection of non-string object keys
  local badKeys = { [1] = "numeric", foo = "string" }
  assert_fails(function() bridgeJson.encode(badKeys) end, "Non-string object key")

  -- Rejection of circular references
  local circular = {}
  circular.self = circular
  assert_fails(function() bridgeJson.encode(circular) end, "Circular reference")

  local circularIndirect = { a = {} }
  circularIndirect.a.parent = circularIndirect
  assert_fails(function() bridgeJson.encode(circularIndirect) end, "Indirect circular reference")
end

-- 7. Malicious Payloads Isolation and Execution Invariants
do
  _G.__TEST_ATTACK_CANARY = false

  local maliciousInputs = {
    '{"command": (os.execute("calc"))}',
    '{"id": (function() _G.__TEST_ATTACK_CANARY = true; return 1 end)()}',
    '{"command": "ping", "params": (io.popen("whoami"):read("*a"))}',
    '{"a": 1}; _G.__TEST_ATTACK_CANARY = true; --',
    '[1, 2, (_G.__TEST_ATTACK_CANARY = true)]',
    '{"cmd": load("_G.__TEST_ATTACK_CANARY = true")()}',
    '{"a": loadstring("_G.__TEST_ATTACK_CANARY = true")()}',
    '{"a": require("os")}',
    '{"a": dofile("test.lua")}',
    '{"a": package.loadlib("foo", "bar")}',
  }

  for _, payload in ipairs(maliciousInputs) do
    local ok, _ = pcall(bridgeJson.decode, payload)
    -- The malicious input must fail to parse and NEVER trigger execution
    assert_true(_G.__TEST_ATTACK_CANARY == false, "Canary was modified during payload: " .. payload)
  end

  -- Verify that valid JSON containing dangerous keywords as string values
  -- is safely decoded as inert string data
  local codeAsStrings = '{"cmd": "os.execute(\\"rm -rf /\\")", "func": "load(\\"return 1\\")"}'
  local safeDecoded = bridgeJson.decode(codeAsStrings)
  assert_eq(safeDecoded.cmd, 'os.execute("rm -rf /")', "Dangerous code as string data")
  assert_eq(safeDecoded.func, 'load("return 1")', "Dangerous load as string data")
  assert_true(_G.__TEST_ATTACK_CANARY == false, "Canary remained untouched")
end

-- 8. Completion Signal
print("lua_json_codec_ok")
os.exit(0)
