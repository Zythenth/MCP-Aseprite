-- ==============================================================================
-- Aseprite MCP Bridge Script (lua/aseprite-bridge.lua)
-- Compatible with Aseprite v1.2.30+ and v1.3+
-- Full-duplex JSON-RPC command bridge over WebSocket on 127.0.0.1:32123
-- ==============================================================================

local DEFAULT_PORT = 32123
local BRIDGE_PROTOCOL_VERSION = "1.0.0"

local function parseEnvPort()
  local function getTrimmed(varName)
    local val = os.getenv(varName)
    if not val then return nil end
    local trimmed = val:match("^%s*(.-)%s*$")
    if #trimmed == 0 then return nil end
    return trimmed
  end

  local raw = getTrimmed("ASEPRITE_PORT") or getTrimmed("ASEPRITE_WS_PORT")
  if raw then
    local p = tonumber(raw)
    if p and math.floor(p) == p and p >= 1024 and p <= 65535 then
      return p, false
    else
      return DEFAULT_PORT, true
    end
  end
  return DEFAULT_PORT, false
end

local PORT, PORT_FALLBACK = parseEnvPort()

local function parseEnvToken()
  local raw = os.getenv("ASEPRITE_BRIDGE_TOKEN")
  if not raw then return nil end
  local trimmed = raw:match("^%s*(.-)%s*$")
  if not trimmed or #trimmed < 16 or #trimmed > 128 then
    return nil
  end
  if trimmed:match("[^A-Za-z0-9%._%~%-]") then
    return nil
  end
  return trimmed
end

local BRIDGE_TOKEN = parseEnvToken()
local AUTH_ENABLED = (BRIDGE_TOKEN ~= nil and #BRIDGE_TOKEN > 0)
local WS_BASE_URL = "ws://127.0.0.1:" .. PORT
local WS_URL = WS_BASE_URL

local MAX_PIXELS_BATCH = 100000
local MAX_TILESET_PIXELS = 16777216
local MAX_CHANGE_JOURNAL_ENTRIES = 128
local JSON_NULL = {}

-- ------------------------------------------------------------------------------
-- Dedicated, Sandboxed, Pure-Data JSON Codec (bridgeJson)
-- Safe recursive cursor parser without eval/load/require/dofile primitives.
-- Strict RFC 8259 conformance: depth limits (<= 64), unescaped control character
-- rejection, surrogate pair handling, and deterministic key sorting.
-- ------------------------------------------------------------------------------
local bridgeJson = {
  null = JSON_NULL
}

local function codepointToUtf8(cp)
  if cp < 0 or cp > 0x10FFFF or (cp >= 0xD800 and cp <= 0xDFFF) then
    error("Invalid Unicode code point: " .. tostring(cp))
  end
  if cp <= 0x7F then
    return string.char(cp)
  elseif cp <= 0x7FF then
    local b1 = 0xC0 + math.floor(cp / 64)
    local b2 = 0x80 + (cp % 64)
    return string.char(b1, b2)
  elseif cp <= 0xFFFF then
    local b1 = 0xE0 + math.floor(cp / 4096)
    local b2 = 0x80 + (math.floor(cp / 64) % 64)
    local b3 = 0x80 + (cp % 64)
    return string.char(b1, b2, b3)
  else
    local b1 = 0xF0 + math.floor(cp / 262144)
    local b2 = 0x80 + (math.floor(cp / 4096) % 64)
    local b3 = 0x80 + (math.floor(cp / 64) % 64)
    local b4 = 0x80 + (cp % 64)
    return string.char(b1, b2, b3, b4)
  end
end

local function isValidJsonNumber(s)
  local rest = s
  if rest:sub(1, 1) == "-" then
    rest = rest:sub(2)
  end
  if #rest == 0 then return false end

  if rest:sub(1, 1) == "0" then
    rest = rest:sub(2)
  else
    local digits = rest:match("^%d+")
    if not digits or digits:sub(1, 1) == "0" then
      return false
    end
    rest = rest:sub(#digits + 1)
  end

  if rest:sub(1, 1) == "." then
    rest = rest:sub(2)
    local fracDigits = rest:match("^%d+")
    if not fracDigits then return false end
    rest = rest:sub(#fracDigits + 1)
  end

  local expChar = rest:sub(1, 1)
  if expChar == "e" or expChar == "E" then
    rest = rest:sub(2)
    if rest:sub(1, 1) == "+" or rest:sub(1, 1) == "-" then
      rest = rest:sub(2)
    end
    local expDigits = rest:match("^%d+")
    if not expDigits then return false end
    rest = rest:sub(#expDigits + 1)
  end

  return #rest == 0
end

function bridgeJson.decode(text)
  if type(text) ~= "string" then
    error("JSON decode expected string, got " .. type(text))
  end

  local pos = 1
  local len = #text

  local function skipWhitespace()
    while pos <= len do
      local b = text:byte(pos)
      if b == 32 or b == 9 or b == 10 or b == 13 then
        pos = pos + 1
      else
        break
      end
    end
  end

  local parseValue

  local function parseString()
    pos = pos + 1 -- skip opening quote
    local startChunk = pos
    local parts = {}

    while pos <= len do
      local b = text:byte(pos)
      if b < 32 then
        error("Unescaped control character in string at position " .. pos)
      elseif b == 34 then -- '"'
        if pos > startChunk then
          table.insert(parts, text:sub(startChunk, pos - 1))
        end
        pos = pos + 1
        return table.concat(parts)
      elseif b == 92 then -- '\'
        if pos > startChunk then
          table.insert(parts, text:sub(startChunk, pos - 1))
        end
        pos = pos + 1
        if pos > len then
          error("Unterminated escape sequence at position " .. pos)
        end
        local esc = text:sub(pos, pos)
        if esc == '"' or esc == '\\' or esc == '/' then
          table.insert(parts, esc)
          pos = pos + 1
        elseif esc == 'b' then
          table.insert(parts, "\b")
          pos = pos + 1
        elseif esc == 'f' then
          table.insert(parts, "\f")
          pos = pos + 1
        elseif esc == 'n' then
          table.insert(parts, "\n")
          pos = pos + 1
        elseif esc == 'r' then
          table.insert(parts, "\r")
          pos = pos + 1
        elseif esc == 't' then
          table.insert(parts, "\t")
          pos = pos + 1
        elseif esc == 'u' then
          if pos + 4 > len then
            error("Incomplete unicode escape at position " .. pos)
          end
          local hex = text:sub(pos + 1, pos + 4)
          if not hex:match("^[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]$") then
            error("Invalid unicode escape: \\u" .. hex .. " at position " .. pos)
          end
          local cp = tonumber(hex, 16)
          if cp >= 0xD800 and cp <= 0xDBFF then
            -- High surrogate, must be followed by \uXXXX low surrogate
            if pos + 10 <= len and text:sub(pos + 5, pos + 6) == "\\u" then
              local hex2 = text:sub(pos + 7, pos + 10)
              if hex2:match("^[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]$") then
                local cp2 = tonumber(hex2, 16)
                if cp2 >= 0xDC00 and cp2 <= 0xDFFF then
                  local fullCp = 0x10000 + (cp - 0xD800) * 1024 + (cp2 - 0xDC00)
                  table.insert(parts, codepointToUtf8(fullCp))
                  pos = pos + 11
                else
                  error("Invalid low surrogate \\u" .. hex2 .. " at position " .. (pos + 5))
                end
              else
                error("Invalid low surrogate escape at position " .. (pos + 5))
              end
            else
              error("Isolated high surrogate \\u" .. hex .. " at position " .. pos)
            end
          elseif cp >= 0xDC00 and cp <= 0xDFFF then
            error("Isolated low surrogate \\u" .. hex .. " at position " .. pos)
          else
            table.insert(parts, codepointToUtf8(cp))
            pos = pos + 5
          end
        else
          error("Invalid escape sequence: \\" .. esc .. " at position " .. pos)
        end
        startChunk = pos
      else
        pos = pos + 1
      end
    end

    error("Unterminated string starting at position " .. (startChunk - 1))
  end

  local function parseArray(depth)
    pos = pos + 1 -- skip '['
    skipWhitespace()
    local arr = {}
    if pos <= len and text:byte(pos) == 93 then -- ']'
      pos = pos + 1
      return arr
    end

    while true do
      if pos > len then
        error("Unterminated array at position " .. pos)
      end
      local val = parseValue(depth + 1)
      table.insert(arr, val)
      skipWhitespace()
      if pos > len then
        error("Unterminated array at position " .. pos)
      end
      local b = text:byte(pos)
      if b == 93 then -- ']'
        pos = pos + 1
        return arr
      elseif b == 44 then -- ','
        pos = pos + 1
        skipWhitespace()
        if pos <= len and text:byte(pos) == 93 then
          error("Trailing comma in array at position " .. pos)
        end
      else
        error("Expected ',' or ']' in array at position " .. pos)
      end
    end
  end

  local function parseObject(depth)
    pos = pos + 1 -- skip '{'
    skipWhitespace()
    local obj = {}
    if pos <= len and text:byte(pos) == 125 then -- '}'
      pos = pos + 1
      return obj
    end

    while true do
      if pos > len then
        error("Unterminated object at position " .. pos)
      end
      if text:byte(pos) ~= 34 then -- '"'
        error("Expected string key in object at position " .. pos)
      end
      local key = parseString()
      skipWhitespace()
      if pos > len or text:byte(pos) ~= 58 then -- ':'
        error("Expected ':' after object key at position " .. pos)
      end
      pos = pos + 1
      skipWhitespace()
      local val = parseValue(depth + 1)
      obj[key] = val
      skipWhitespace()
      if pos > len then
        error("Unterminated object at position " .. pos)
      end
      local b = text:byte(pos)
      if b == 125 then -- '}'
        pos = pos + 1
        return obj
      elseif b == 44 then -- ','
        pos = pos + 1
        skipWhitespace()
        if pos <= len and text:byte(pos) == 125 then
          error("Trailing comma in object at position " .. pos)
        end
      else
        error("Expected ',' or '}' in object at position " .. pos)
      end
    end
  end

  parseValue = function(depth)
    if depth > 64 then
      error("JSON maximum depth exceeded (>64)")
    end

    skipWhitespace()
    if pos > len then
      error("Unexpected end of JSON input")
    end

    local b = text:byte(pos)
    if b == 34 then -- '"'
      return parseString()
    elseif b == 123 then -- '{'
      return parseObject(depth)
    elseif b == 91 then -- '['
      return parseArray(depth)
    elseif b == 116 then -- 't' (true)
      if text:sub(pos, pos + 3) == "true" then
        local nextByte = text:byte(pos + 4)
        if not nextByte or nextByte == 32 or nextByte == 9 or nextByte == 10 or nextByte == 13 or nextByte == 44 or nextByte == 93 or nextByte == 125 then
          pos = pos + 4
          return true
        end
      end
      error("Unexpected token at position " .. pos)
    elseif b == 102 then -- 'f' (false)
      if text:sub(pos, pos + 4) == "false" then
        local nextByte = text:byte(pos + 5)
        if not nextByte or nextByte == 32 or nextByte == 9 or nextByte == 10 or nextByte == 13 or nextByte == 44 or nextByte == 93 or nextByte == 125 then
          pos = pos + 5
          return false
        end
      end
      error("Unexpected token at position " .. pos)
    elseif b == 110 then -- 'n' (null)
      if text:sub(pos, pos + 3) == "null" then
        local nextByte = text:byte(pos + 4)
        if not nextByte or nextByte == 32 or nextByte == 9 or nextByte == 10 or nextByte == 13 or nextByte == 44 or nextByte == 93 or nextByte == 125 then
          pos = pos + 4
          return JSON_NULL
        end
      end
      error("Unexpected token at position " .. pos)
    elseif b == 45 or (b >= 48 and b <= 57) then -- '-' or '0'-'9'
      local rawToken = text:match("^[^%s,%]}]+", pos)
      if not rawToken or not isValidJsonNumber(rawToken) then
        error("Invalid JSON number at position " .. pos .. ": " .. tostring(rawToken))
      end
      local num = tonumber(rawToken)
      if num == nil or num ~= num or num == math.huge or num == -math.huge then
        error("Cannot represent number at position " .. pos .. ": " .. rawToken)
      end
      pos = pos + #rawToken
      return num
    else
      error("Unexpected character at position " .. pos .. ": '" .. string.char(b) .. "'")
    end
  end

  skipWhitespace()
  if pos > len then
    error("Empty JSON input")
  end

  local result = parseValue(1)
  skipWhitespace()
  if pos <= len then
    error("Trailing garbage after JSON value at position " .. pos)
  end

  return result
end

local function escapeString(s)
  return '"' .. s:gsub('["\\%z%c]', function(c)
    local b = string.byte(c)
    if b == 34 then return '\\"'
    elseif b == 92 then return '\\\\'
    elseif b == 8 then return '\\b'
    elseif b == 12 then return '\\f'
    elseif b == 10 then return '\\n'
    elseif b == 13 then return '\\r'
    elseif b == 9 then return '\\t'
    else
      return string.format("\\u%04x", b)
    end
  end) .. '"'
end

local function isSequentialArray(tbl)
  local count = 0
  for _ in pairs(tbl) do
    count = count + 1
  end
  if count == 0 then
    return false, 0
  end
  for i = 1, count do
    if tbl[i] == nil then
      return false, 0
    end
  end
  return true, count
end

local function encodeValue(val, depth, seen)
  if depth > 64 then
    error("JSON encode maximum depth exceeded (>64)")
  end

  if val == nil or val == JSON_NULL then
    return "null"
  end

  local t = type(val)
  if t == "boolean" then
    return val and "true" or "false"
  elseif t == "number" then
    if val ~= val or val == math.huge or val == -math.huge then
      error("Cannot encode NaN or Infinity in JSON")
    end
    return tostring(val)
  elseif t == "string" then
    return escapeString(val)
  elseif t == "table" then
    if seen[val] then
      error("Circular reference detected in table")
    end
    seen[val] = true

    local isArr, count = isSequentialArray(val)
    local result
    if isArr then
      local parts = {}
      for i = 1, count do
        table.insert(parts, encodeValue(val[i], depth + 1, seen))
      end
      result = "[" .. table.concat(parts, ",") .. "]"
    else
      local keys = {}
      for k in pairs(val) do
        if type(k) ~= "string" then
          error("JSON object keys must be strings, got " .. type(k))
        end
        table.insert(keys, k)
      end
      table.sort(keys)
      local parts = {}
      for _, k in ipairs(keys) do
        table.insert(parts, escapeString(k) .. ":" .. encodeValue(val[k], depth + 1, seen))
      end
      result = "{" .. table.concat(parts, ",") .. "}"
    end

    seen[val] = nil
    return result
  else
    error("Cannot encode unsupported type in JSON: " .. t)
  end
end

function bridgeJson.encode(val)
  local seen = {}
  return encodeValue(val, 1, seen)
end

if rawget(_G, "__ASEPRITE_MCP_JSON_TEST_MODE") then return bridgeJson, JSON_NULL end

-- Global bridge state (anchored to survive lua_gc)
if _G.__ASEPRITE_MCP_BRIDGE then
  local oldState = _G.__ASEPRITE_MCP_BRIDGE
  if oldState.sitechangeListenerId then
    pcall(function() app.events:off(oldState.sitechangeListenerId) end)
    oldState.sitechangeListenerId = nil
  end
  if oldState.spriteListeners then
    for _, l in pairs(oldState.spriteListeners) do
      pcall(function() l.spr.events:off(l.code) end)
    end
    oldState.spriteListeners = {}
  end
  if oldState.ws then
    pcall(function() oldState.ws:close() end)
    oldState.ws = nil
  end
  if oldState.dialog then
    pcall(function() oldState.dialog:close() end)
    oldState.dialog = nil
  end
  _G.__ASEPRITE_MCP_BRIDGE = nil
end

_G.__ASEPRITE_MCP_BRIDGE = {}
local state = _G.__ASEPRITE_MCP_BRIDGE

state.revision = 1
state.isExecutingMcp = false
state.hookedSprites = {}
state.spriteListeners = {}
state.sitechangeListenerId = nil
state.changeJournal = {}
state.sessionId = tostring(os.time()) .. "-" .. tostring(math.random(10000000, 99999999)) .. "-" .. tostring({}):gsub("table: ", "")
state.authenticated = false
state.lastSpriteId = nil
state.lastFrameNumber = nil
state.lastLayerId = nil

-- ------------------------------------------------------------------------------
-- Helper: Color & Hex Conversions (Mode-Aware Native and Protocol RGBA)
-- ------------------------------------------------------------------------------
local function parseHexRgba(hex)
  if type(hex) == "table" and hex.r and hex.g and hex.b then
    return { r = hex.r, g = hex.g, b = hex.b, a = hex.a or 255 }
  end
  if type(hex) ~= "string" then return { r = 0, g = 0, b = 0, a = 0 } end
  hex = hex:gsub("^#", "")
  local r = tonumber(hex:sub(1, 2), 16) or 0
  local g = tonumber(hex:sub(3, 4), 16) or 0
  local b = tonumber(hex:sub(5, 6), 16) or 0
  local a = 255
  if #hex >= 8 then
    a = tonumber(hex:sub(7, 8), 16) or 255
  end
  return { r = r, g = g, b = b, a = a }
end

local function parseHexColor(hex)
  local rgba = parseHexRgba(hex)
  return app.pixelColor.rgba(rgba.r, rgba.g, rgba.b, rgba.a)
end

local function rgbaToHex(rgba)
  return string.format("#%02X%02X%02X%02X", rgba.r, rgba.g, rgba.b, rgba.a)
end

local function getTransparentPixel(spr)
  if not spr then return 0 end
  if spr.colorMode == ColorMode.INDEXED then
    return spr.transparentColor or 0
  elseif spr.colorMode == ColorMode.GRAYSCALE then
    return app.pixelColor.graya(0, 0)
  else
    return app.pixelColor.rgba(0, 0, 0, 0)
  end
end

local function decodePixelToRgba(spr, nativePixel)
  if not spr then
    return { r = 0, g = 0, b = 0, a = 0 }
  end
  if spr.colorMode == ColorMode.RGB then
    return {
      r = app.pixelColor.rgbaR(nativePixel),
      g = app.pixelColor.rgbaG(nativePixel),
      b = app.pixelColor.rgbaB(nativePixel),
      a = app.pixelColor.rgbaA(nativePixel)
    }
  elseif spr.colorMode == ColorMode.GRAYSCALE then
    local v = app.pixelColor.grayaV(nativePixel)
    local a = app.pixelColor.grayaA(nativePixel)
    return { r = v, g = v, b = v, a = a }
  elseif spr.colorMode == ColorMode.INDEXED then
    local isTransparent = (spr.transparentColor ~= nil and nativePixel == spr.transparentColor)
    local pal = spr.palettes and spr.palettes[1]
    if pal and nativePixel >= 0 and nativePixel < #pal then
      local c = pal:getColor(nativePixel)
      if c then
        local a = isTransparent and 0 or c.alpha
        return {
          r = isTransparent and 0 or c.red,
          g = isTransparent and 0 or c.green,
          b = isTransparent and 0 or c.blue,
          a = a
        }
      end
    end
    return { r = 0, g = 0, b = 0, a = 0 }
  else
    return {
      r = app.pixelColor.rgbaR(nativePixel),
      g = app.pixelColor.rgbaG(nativePixel),
      b = app.pixelColor.rgbaB(nativePixel),
      a = app.pixelColor.rgbaA(nativePixel)
    }
  end
end

local function encodeColorToPixel(spr, colorInput)
  local rgba = parseHexRgba(colorInput)
  if not spr then
    return app.pixelColor.rgba(rgba.r, rgba.g, rgba.b, rgba.a)
  end
  if spr.colorMode == ColorMode.RGB then
    return app.pixelColor.rgba(rgba.r, rgba.g, rgba.b, rgba.a)
  elseif spr.colorMode == ColorMode.GRAYSCALE then
    local c = Color{ r = rgba.r, g = rgba.g, b = rgba.b, a = rgba.a }
    return c.grayPixel
  elseif spr.colorMode == ColorMode.INDEXED then
    if rgba.a == 0 then
      return spr.transparentColor or 0
    else
      local c = Color{ r = rgba.r, g = rgba.g, b = rgba.b, a = rgba.a }
      return c.index
    end
  else
    return app.pixelColor.rgba(rgba.r, rgba.g, rgba.b, rgba.a)
  end
end

local function colorToHex(spr, nativePixel)
  local rgba = decodePixelToRgba(spr, nativePixel)
  return rgbaToHex(rgba)
end

local function getColorModeString(mode)
  if mode == ColorMode.RGB then return "rgb"
  elseif mode == ColorMode.GRAYSCALE then return "grayscale"
  elseif mode == ColorMode.INDEXED then return "indexed"
  else return tostring(mode) end
end

-- ------------------------------------------------------------------------------
-- Helper: Base64 Encoding
-- ------------------------------------------------------------------------------
local b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local function base64Encode(data)
  return ((data:gsub('.', function(x)
    local r, b = '', x:byte()
    for i = 8, 1, -1 do r = r .. (b % 2^i - b % 2^(i-1) > 0 and '1' or '0') end
    return r
  end) .. '0000'):gsub('%d%d%d?%d?%d?', function(x)
    if #x < 6 then return '' end
    local c = 0
    for i = 1, 6 do c = c + (x:sub(i, i) == '1' and 2^(6-i) or 0) end
    return b64chars:sub(c + 1, c + 1)
  end) .. ({ '', '==', '=' })[#data % 3 + 1])
end

-- ------------------------------------------------------------------------------
-- Helper: Render Composite Frame to Base64 PNG
-- ------------------------------------------------------------------------------
local function exportFramePngBase64(sprite, frameNumber, targetLayer)
  frameNumber = frameNumber or (app.frame and app.frame.frameNumber) or 1
  local compImg = Image(sprite.spec)
  local transPixel = getTransparentPixel(sprite)
  compImg:clear(transPixel)

  if targetLayer then
    local cel = targetLayer:cel(frameNumber)
    if cel and cel.image then
      local opacity = math.floor(((cel.opacity or 255) * (targetLayer.opacity or 255) + 127) / 255)
      local blendMode = targetLayer.blendMode or BlendMode.NORMAL
      compImg:drawImage(cel.image, cel.position, opacity, blendMode)
    end
  else
    compImg:drawSprite(sprite, frameNumber, Point(0, 0))
  end

  local tempFileName = string.format("ase_mcp_%d_%d.png", os.time(), math.random(1000, 9999))
  local tempPath = app.fs.joinPath(app.fs.tempPath, tempFileName)

  if sprite.colorMode == ColorMode.INDEXED then
    local pal = (sprite.palettes and sprite.palettes[1])
    if pal then
      compImg:saveAs{ filename = tempPath, palette = pal }
    else
      compImg:saveAs(tempPath)
    end
  else
    compImg:saveAs(tempPath)
  end

  local f = io.open(tempPath, "rb")
  if not f then return "" end
  local bytes = f:read("*all")
  f:close()
  os.remove(tempPath)

  return base64Encode(bytes)
end

local function exportImagePngBase64(image, sprite)
  local tempFileName = string.format("ase_mcp_image_%d_%d.png", os.time(), math.random(1000, 9999))
  local tempPath = app.fs.joinPath(app.fs.tempPath, tempFileName)
  if sprite and sprite.colorMode == ColorMode.INDEXED and sprite.palettes and sprite.palettes[1] then
    image:saveAs{ filename = tempPath, palette = sprite.palettes[1] }
  else
    image:saveAs(tempPath)
  end
  local file = io.open(tempPath, "rb")
  if not file then return "" end
  local bytes = file:read("*all")
  file:close()
  os.remove(tempPath)
  return base64Encode(bytes)
end

-- ------------------------------------------------------------------------------
-- Helper: Ensure Canvas-Sized Cel
-- ------------------------------------------------------------------------------
local function ensureCanvasSizedCel(spr, layer, frame)
  local cel = layer:cel(frame)
  if not cel then
    cel = spr:newCel(layer, frame)
  end

  if cel.position.x == 0 and cel.position.y == 0
     and cel.image.width == spr.width and cel.image.height == spr.height then
    return cel, cel.image:clone()
  end

  local fullImg = Image(spr.spec)
  local transPixel = getTransparentPixel(spr)
  fullImg:clear(transPixel)
  if cel.image then
    fullImg:drawImage(cel.image, cel.position)
  end
  cel.position = Point(0, 0)
  return cel, fullImg
end

-- ------------------------------------------------------------------------------
-- Helper: Metadata Change Journal (Limit 128)
-- ------------------------------------------------------------------------------
local function resetChangeJournal()
  state.changeJournal = {}
end

local function recordChange(rev, scope, count, bounds, fullRefreshRequired, reason)
  local entry = {
    revision = rev,
    scope = scope,
    pixelsChanged = count or 0,
    bounds = bounds or JSON_NULL,
    fullRefreshRequired = fullRefreshRequired or false,
    reason = reason
  }
  table.insert(state.changeJournal, entry)
  if #state.changeJournal > MAX_CHANGE_JOURNAL_ENTRIES then
    table.remove(state.changeJournal, 1)
  end
end

local function recordPixelChange(rev, count, bounds)
  recordChange(rev, "pixels", count, bounds, false, "mcp_mutation")
end

local function rectToTable(rect)
  if not rect then return { x = 0, y = 0, width = 0, height = 0 } end
  return { x = rect.x, y = rect.y, width = rect.width, height = rect.height }
end

local function finishMutation(params, result, scope, bounds, frameNumber, fullRefreshRequired)
  local spr = app.sprite
  state.revision = state.revision + 1
  result = result or {}
  result.success = true
  result.revision = state.revision
  result.bounds = bounds or (spr and rectToTable(spr.bounds)) or { x = 0, y = 0, width = 0, height = 0 }
  recordChange(
    state.revision,
    scope or "structure",
    0,
    result.bounds,
    fullRefreshRequired == true,
    "mcp_mutation"
  )
  if params and params.returnPreview and spr then
    result.pngBase64 = exportFramePngBase64(spr, frameNumber)
  end
  return result
end

-- ------------------------------------------------------------------------------
-- Helper: Safe MCP Mutation Wrapper
-- ------------------------------------------------------------------------------
local function executeMcpMutation(fn)
  state.isExecutingMcp = true
  local ok, resOrErr = pcall(fn)
  state.isExecutingMcp = false
  if not ok then error(resOrErr) end
  return resOrErr
end

-- ------------------------------------------------------------------------------
-- Helpers: Target Layer and Frame Resolution & Color Difference
-- ------------------------------------------------------------------------------
local function findLayersByNameRecursive(container, name, matched)
  if not container or not container.layers then return end
  for _, l in ipairs(container.layers) do
    if l.name == name then
      table.insert(matched, l)
    end
    if l.isGroup then
      findLayersByNameRecursive(l, name, matched)
    end
  end
end

local function collectLayersRecursive(container, collected)
  if not container or not container.layers then return end
  for _, layer in ipairs(container.layers) do
    table.insert(collected, layer)
    if layer.isGroup then collectLayersRecursive(layer, collected) end
  end
end

local function resolveAnyLayer(spr, params, nameKey, indexKey)
  nameKey = nameKey or "layerName"
  indexKey = indexKey or "layerIndex"
  local name = params[nameKey]
  local index = params[indexKey]
  local byName = nil
  local byIndex = nil

  if name ~= nil then
    local matched = {}
    findLayersByNameRecursive(spr, name, matched)
    if #matched == 0 then error("Layer '" .. tostring(name) .. "' not found.") end
    if #matched > 1 then error("Ambiguous layer name '" .. tostring(name) .. "'.") end
    byName = matched[1]
  end

  if index ~= nil then
    if type(index) ~= "number" or math.floor(index) ~= index or index < 0 then
      error("Invalid " .. indexKey .. ": " .. tostring(index))
    end
    local flattened = {}
    collectLayersRecursive(spr, flattened)
    byIndex = flattened[index + 1]
    if not byIndex then error("Invalid " .. indexKey .. ": " .. tostring(index)) end
  end

  if byName and byIndex and byName ~= byIndex then
    error("Conflicting layer selectors.")
  end
  return byName or byIndex or app.layer or spr.layers[1]
end

local function resolveTargetLayer(spr, params, forWriting)
  if not spr then error("No active sprite open in Aseprite.") end
  local targetLayer = resolveAnyLayer(spr, params)

  if not targetLayer then
    error("No target layer available.")
  end

  if targetLayer.isGroup then
    error("Cannot paint on or read from a group layer.")
  end

  if forWriting then
    if targetLayer.isEditable == false or targetLayer.isLocked == true then
      error("Cannot paint on locked or non-editable layer.")
    end
  end

  return targetLayer
end

local function resolveTargetFrame(spr, rawFrame)
  if not spr then error("No active sprite open in Aseprite.") end
  if rawFrame ~= nil then
    if type(rawFrame) ~= "number" or math.floor(rawFrame) ~= rawFrame or rawFrame < 1 or rawFrame > #spr.frames then
      error("Invalid frame: " .. tostring(rawFrame))
    end
    return spr.frames[rawFrame]
  end
  if app.frame then return app.frame end
  if #spr.frames >= 1 then return spr.frames[1] end
  error("Sprite has no frames.")
end

local function colorDiff(c1, c2)
  local rgba1 = type(c1) == "table" and c1 or parseHexRgba(c1)
  local rgba2 = type(c2) == "table" and c2 or parseHexRgba(c2)
  return math.abs(rgba1.r - rgba2.r) + math.abs(rgba1.g - rgba2.g) + math.abs(rgba1.b - rgba2.b) + math.abs(rgba1.a - rgba2.a)
end

-- ------------------------------------------------------------------------------
-- Command Handlers
-- ------------------------------------------------------------------------------
local handlers = {}

handlers.aseprite_status = function(params)
  local spr = app.sprite
  return {
    connected = true,
    hasActiveSprite = spr ~= nil,
    filename = spr and spr.filename or "",
    width = spr and spr.width or 0,
    height = spr and spr.height or 0,
    colorMode = spr and getColorModeString(spr.colorMode) or "",
    layersCount = spr and #spr.layers or 0,
    framesCount = spr and #spr.frames or 0,
    activeLayer = (spr and app.layer) and app.layer.name or "",
    activeFrame = (spr and app.frame) and app.frame.frameNumber or 1,
    revision = state.revision
  }
end

handlers.get_sprite_info = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite open in Aseprite.") end

  local layers = {}
  for i, l in ipairs(spr.layers) do
    table.insert(layers, {
      index = i,
      name = l.name,
      isVisible = l.isVisible,
      isEditable = l.isEditable,
      opacity = l.opacity or 255,
      blendMode = tostring(l.blendMode),
      isGroup = l.isGroup,
      isBackground = l.isBackground
    })
  end

  local frames = {}
  for i, f in ipairs(spr.frames) do
    table.insert(frames, {
      frameNumber = f.frameNumber,
      duration = math.floor((f.duration or 0.1) * 1000)
    })
  end

  return {
    width = spr.width,
    height = spr.height,
    colorMode = getColorModeString(spr.colorMode),
    layers = layers,
    frames = frames,
    activeLayer = app.layer and app.layer.name or "",
    activeFrame = app.frame and app.frame.frameNumber or 1,
    revision = state.revision
  }
end

handlers.get_canvas = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite open in Aseprite.") end
  local targetFrame = resolveTargetFrame(spr, params.frameIndex or params.frameNumber)
  local frameNum = targetFrame.frameNumber

  local targetLayer = nil
  if params.layerName ~= nil then
    local matched = {}
    findLayersByNameRecursive(spr, params.layerName, matched)
    if #matched == 0 then
      error("Layer '" .. tostring(params.layerName) .. "' not found.")
    elseif #matched > 1 then
      error("Ambiguous layerName '" .. tostring(params.layerName) .. "': found multiple matching layers.")
    end
    targetLayer = matched[1]
    if targetLayer.isGroup then
      error("Cannot render group layer.")
    end
  end

  local b64 = exportFramePngBase64(spr, frameNum, targetLayer)
  return {
    width = spr.width,
    height = spr.height,
    frameNumber = frameNum,
    pngBase64 = b64,
    revision = state.revision
  }
end

handlers.get_pixel_grid = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite open in Aseprite.") end
  local targetLayer = resolveTargetLayer(spr, params, false)
  local targetFrame = resolveTargetFrame(spr, params.frameIndex or params.frameNumber)
  local cel = targetLayer:cel(targetFrame)
  local format = params.format or "hex"
  local isIndexed = (spr.colorMode == ColorMode.INDEXED)

  local rx = 0
  local ry = 0
  local rw = spr.width
  local rh = spr.height

  if params.region ~= nil then
    local reg = params.region
    local x = reg.x
    local y = reg.y
    local width = reg.width
    local height = reg.height

    if type(x) ~= "number" or math.floor(x) ~= x or x < 0 or
       type(y) ~= "number" or math.floor(y) ~= y or y < 0 then
      error("Region coordinates (x, y) must be non-negative integers.")
    end
    if type(width) ~= "number" or math.floor(width) ~= width or width <= 0 or
       type(height) ~= "number" or math.floor(height) ~= height or height <= 0 then
      error("Region dimensions (width, height) must be positive integers.")
    end
    if x >= spr.width or y >= spr.height then
      error("Region origin outside canvas bounds.")
    end

    rx = x
    ry = y
    rw = math.min(width, spr.width - x)
    rh = math.min(height, spr.height - y)
  end

  local grid = {}
  local paletteMap = {}
  local paletteList = {}

  local transPixel = getTransparentPixel(spr)

  for y = ry, ry + rh - 1 do
    local row = {}
    for x = rx, rx + rw - 1 do
      local colorInt = transPixel
      if cel and x >= cel.position.x and y >= cel.position.y
             and x < cel.position.x + cel.image.width
             and y < cel.position.y + cel.image.height then
        colorInt = cel.image:getPixel(x - cel.position.x, y - cel.position.y)
      end

      if format == "hex" then
        table.insert(row, colorToHex(spr, colorInt))
      elseif format == "rgba" then
        table.insert(row, decodePixelToRgba(spr, colorInt))
      elseif format == "indexed" then
        table.insert(row, colorInt)
      elseif format == "compact" then
        local hex = colorToHex(spr, colorInt)
        if not paletteMap[hex] then
          table.insert(paletteList, hex)
          paletteMap[hex] = #paletteList - 1
        end
        table.insert(row, paletteMap[hex])
      end
    end
    table.insert(grid, row)
  end

  local result = {
    width = rw,
    height = rh,
    format = format,
    grid = grid,
    indexedSource = isIndexed,
    revision = state.revision
  }
  if params.region ~= nil then
    result.origin = { x = rx, y = ry }
    result.region = { x = rx, y = ry, width = rw, height = rh }
  end
  if format == "compact" then result.palette = paletteList end
  return result
end

handlers.inspect_sprite = function(params)
  local canvasRes = handlers.get_canvas(params)
  params.format = params.format or "compact"
  local gridRes = handlers.get_pixel_grid(params)
  return {
    width = canvasRes.width,
    height = canvasRes.height,
    pngBase64 = canvasRes.pngBase64,
    activeLayer = app.layer and app.layer.name or "",
    activeFrame = app.frame and app.frame.frameNumber or 1,
    pixelGrid = gridRes,
    revision = state.revision
  }
end

handlers.set_pixels = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite open in Aseprite.") end
  local targetLayer = resolveTargetLayer(spr, params, true)
  local targetFrame = resolveTargetFrame(spr, params.frameNumber)

  local pixels = params.pixels
  if not pixels or #pixels == 0 then error("No pixels provided.") end
  if #pixels > MAX_PIXELS_BATCH then
    error("Batch size exceeds MAX_PIXELS_BATCH (" .. tostring(MAX_PIXELS_BATCH) .. ")")
  end

  local minX, minY = spr.width, spr.height
  local maxX, maxY = 0, 0
  local modifiedCount = 0

  state.isExecutingMcp = true
  local ok, err = pcall(function()
    app.transaction("MCP: set_pixels", function()
      local cel, img = ensureCanvasSizedCel(spr, targetLayer, targetFrame)

      for _, p in ipairs(pixels) do
        if p.x >= 0 and p.x < spr.width and p.y >= 0 and p.y < spr.height then
          local targetNative = encodeColorToPixel(spr, p.color)
          local prevNative = img:getPixel(p.x, p.y)
          if prevNative ~= targetNative then
            img:drawPixel(p.x, p.y, targetNative)
            modifiedCount = modifiedCount + 1
            if p.x < minX then minX = p.x end
            if p.y < minY then minY = p.y end
            if p.x > maxX then maxX = p.x end
            if p.y > maxY then maxY = p.y end
          end
        end
      end

      if modifiedCount > 0 then
        cel.image = img
        app.refresh()
      end
    end)
  end)
  state.isExecutingMcp = false

  if not ok then error(err) end

  local bounds
  if modifiedCount > 0 then
    state.revision = state.revision + 1
    bounds = {
      x = minX,
      y = minY,
      width = (maxX - minX + 1),
      height = (maxY - minY + 1)
    }
    recordPixelChange(state.revision, modifiedCount, bounds)
  else
    bounds = { x = 0, y = 0, width = 0, height = 0 }
  end

  local res = {
    pixelsModified = modifiedCount,
    pixelsChanged = modifiedCount,
    bounds = bounds,
    revision = state.revision
  }
  if params.returnPreview then
    res.pngBase64 = exportFramePngBase64(spr, targetFrame.frameNumber)
  end
  return res
end

handlers.set_pixel = function(params)
  params.pixels = { { x = params.x, y = params.y, color = params.color } }
  return handlers.set_pixels(params)
end

handlers.erase_pixels = function(params)
  if params.points and #params.points > MAX_PIXELS_BATCH then
    error("Batch size exceeds MAX_PIXELS_BATCH (" .. tostring(MAX_PIXELS_BATCH) .. ")")
  end
  local pixels = {}
  for _, pt in ipairs(params.points or {}) do
    table.insert(pixels, { x = pt.x, y = pt.y, color = "#00000000" })
  end
  params.pixels = pixels
  return handlers.set_pixels(params)
end

handlers.undo = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  state.isExecutingMcp = true
  app.undo()
  app.refresh()
  state.isExecutingMcp = false
  return finishMutation(params, { message = "Undo executed successfully" }, "undo", rectToTable(spr.bounds), nil, true)
end

handlers.redo = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  state.isExecutingMcp = true
  app.redo()
  app.refresh()
  state.isExecutingMcp = false
  return finishMutation(params, { message = "Redo executed successfully" }, "redo", rectToTable(spr.bounds), nil, true)
end

-- Shape tools
handlers.draw_line = function(params)
  local x1, y1, x2, y2 = params.x1, params.y1, params.x2, params.y2
  local color = params.color
  local thickness = params.thickness or 1
  local pixels = {}
  local dx = math.abs(x2 - x1)
  local dy = math.abs(y2 - y1)
  local sx = x1 < x2 and 1 or -1
  local sy = y1 < y2 and 1 or -1
  local err = dx - dy
  local x, y = x1, y1

  while true do
    for tx = 0, thickness - 1 do
      for ty = 0, thickness - 1 do
        table.insert(pixels, { x = x + tx, y = y + ty, color = color })
      end
    end
    if x == x2 and y == y2 then break end
    local e2 = 2 * err
    if e2 > -dy then err = err - dy; x = x + sx end
    if e2 < dx then err = err + dx; y = y + sy end
  end

  params.pixels = pixels
  return handlers.set_pixels(params)
end

handlers.draw_rectangle = function(params)
  local x, y, w, h = params.x, params.y, params.width, params.height
  local color = params.color
  local filled = params.filled or false
  local pixels = {}

  for cy = y, y + h - 1 do
    for cx = x, x + w - 1 do
      if filled or cy == y or cy == y + h - 1 or cx == x or cx == x + w - 1 then
        table.insert(pixels, { x = cx, y = cy, color = color })
      end
    end
  end

  params.pixels = pixels
  return handlers.set_pixels(params)
end

handlers.draw_ellipse = function(params)
  local x, y, w, h = params.x, params.y, params.width, params.height
  local color = params.color
  local filled = params.filled or false
  local rx = w / 2
  local ry = h / 2
  local cx = x + rx
  local cy = y + ry
  local pixels = {}

  for py = y, y + h - 1 do
    for px = x, x + w - 1 do
      local dx = (px + 0.5 - cx) / rx
      local dy = (py + 0.5 - cy) / ry
      local dist = dx * dx + dy * dy
      if filled then
        if dist <= 1.0 then table.insert(pixels, { x = px, y = py, color = color }) end
      else
        if dist <= 1.0 and dist >= 0.6 then table.insert(pixels, { x = px, y = py, color = color }) end
      end
    end
  end

  params.pixels = pixels
  return handlers.set_pixels(params)
end

handlers.flood_fill = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local x, y = params.x, params.y
  if type(x) ~= "number" or type(y) ~= "number" or x < 0 or x >= spr.width or y < 0 or y >= spr.height then
    error("Seed coordinate (" .. tostring(x) .. ", " .. tostring(y) .. ") out of bounds")
  end

  local targetLayer = resolveTargetLayer(spr, params, true)
  local targetFrame = resolveTargetFrame(spr, params.frameNumber)
  local cel = targetLayer:cel(targetFrame)

  local tolerance = params.tolerance or 0
  local maxDiff = tolerance * 4
  local transPixel = getTransparentPixel(spr)

  local function getPixelNative(cx, cy)
    if cel and cx >= cel.position.x and cy >= cel.position.y
       and cx < cel.position.x + cel.image.width and cy < cel.position.y + cel.image.height then
      return cel.image:getPixel(cx - cel.position.x, cy - cel.position.y)
    end
    return transPixel
  end

  local seedNative = getPixelNative(x, y)
  local targetNative = encodeColorToPixel(spr, params.color)
  if seedNative == targetNative and tolerance == 0 then
    return {
      pixelsModified = 0,
      pixelsChanged = 0,
      bounds = { x = 0, y = 0, width = 0, height = 0 },
      revision = state.revision
    }
  end

  local seedRgba = decodePixelToRgba(spr, seedNative)
  local contiguous = params.contiguous
  if contiguous == nil then contiguous = true end
  local pixels = {}

  if not contiguous then
    for cy = 0, spr.height - 1 do
      for cx = 0, spr.width - 1 do
        local cNative = getPixelNative(cx, cy)
        local diff = 0
        if cNative ~= seedNative then
          local cRgba = decodePixelToRgba(spr, cNative)
          diff = colorDiff(cRgba, seedRgba)
        end
        if diff <= maxDiff then
          table.insert(pixels, { x = cx, y = cy, color = params.color })
          if #pixels > MAX_PIXELS_BATCH then
            error("Flood fill candidate count exceeds MAX_PIXELS_BATCH (" .. tostring(MAX_PIXELS_BATCH) .. ")")
          end
        end
      end
    end
  else
    local visited = {}
    local queue = { { x, y } }
    local head = 1
    visited[y * spr.width + x] = true

    while head <= #queue do
      local pt = queue[head]
      head = head + 1
      local px, py = pt[1], pt[2]

      table.insert(pixels, { x = px, y = py, color = params.color })
      if #pixels > MAX_PIXELS_BATCH then
        error("Flood fill candidate count exceeds MAX_PIXELS_BATCH (" .. tostring(MAX_PIXELS_BATCH) .. ")")
      end

      local nbs = { { px + 1, py }, { px - 1, py }, { px, py + 1 }, { px, py - 1 } }
      for _, nb in ipairs(nbs) do
        local nx, ny = nb[1], nb[2]
        if nx >= 0 and nx < spr.width and ny >= 0 and ny < spr.height then
          local key = ny * spr.width + nx
          if not visited[key] then
            visited[key] = true
            local cNative = getPixelNative(nx, ny)
            local diff = 0
            if cNative ~= seedNative then
              local cRgba = decodePixelToRgba(spr, cNative)
              diff = colorDiff(cRgba, seedRgba)
            end
            if diff <= maxDiff then
              table.insert(queue, { nx, ny })
            end
          end
        end
      end
    end
  end

  params.pixels = pixels
  return handlers.set_pixels(params)
end

handlers.replace_color = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local targetLayer = resolveTargetLayer(spr, params, true)
  local targetFrame = resolveTargetFrame(spr, params.frameNumber)
  local cel = targetLayer:cel(targetFrame)

  local fromRgba = parseHexRgba(params.fromColor)
  local tolerance = params.tolerance or 0
  local maxDiff = tolerance * 4
  local transPixel = getTransparentPixel(spr)

  local function getPixelNative(cx, cy)
    if cel and cx >= cel.position.x and cy >= cel.position.y
       and cx < cel.position.x + cel.image.width and cy < cel.position.y + cel.image.height then
      return cel.image:getPixel(cx - cel.position.x, cy - cel.position.y)
    end
    return transPixel
  end

  local pixels = {}
  for cy = 0, spr.height - 1 do
    for cx = 0, spr.width - 1 do
      local cNative = getPixelNative(cx, cy)
      local cRgba = decodePixelToRgba(spr, cNative)
      if colorDiff(cRgba, fromRgba) <= maxDiff then
        table.insert(pixels, { x = cx, y = cy, color = params.toColor })
        if #pixels > MAX_PIXELS_BATCH then
          error("Replace color candidate count exceeds MAX_PIXELS_BATCH (" .. tostring(MAX_PIXELS_BATCH) .. ")")
        end
      end
    end
  end

  if #pixels == 0 then
    return {
      pixelsModified = 0,
      pixelsChanged = 0,
      bounds = { x = 0, y = 0, width = 0, height = 0 },
      revision = state.revision
    }
  end

  params.pixels = pixels
  return handlers.set_pixels(params)
end

handlers.get_changes_since = function(params)
  local since = params.sinceRevision
  local requestedSessionId = params.sessionId
  local function refreshRequired(reason)
    return {
      changed = true,
      sinceRevision = since,
      currentRevision = state.revision,
      sessionId = state.sessionId,
      resyncRequired = true,
      gap = true,
      fullRefreshRequired = true,
      reason = reason
    }
  end

  if requestedSessionId ~= nil and requestedSessionId ~= state.sessionId then
    return refreshRequired("session_changed")
  end
  if type(since) ~= "number" or since < 0 or math.floor(since) ~= since then
    return refreshRequired("invalid_revision")
  end

  if since == state.revision then
    return {
      changed = false,
      sinceRevision = since,
      currentRevision = state.revision,
      sessionId = state.sessionId,
      resyncRequired = false,
      gap = false,
      pixelsChanged = 0,
      bounds = JSON_NULL,
      changes = {}
    }
  end

  if since > state.revision or (state.revision - since) > MAX_CHANGE_JOURNAL_ENTRIES then
    return refreshRequired("revision_out_of_range")
  end

  local journalMap = {}
  for _, entry in ipairs(state.changeJournal) do
    journalMap[entry.revision] = entry
  end

  local totalPixels = 0
  local minX, minY = 1e9, 1e9
  local maxX, maxY = -1e9, -1e9
  local changes = {}
  local fullRefreshRequired = false

  for r = since + 1, state.revision do
    local entry = journalMap[r]
    if not entry then
      return refreshRequired("journal_gap")
    end
    table.insert(changes, entry)
    totalPixels = totalPixels + entry.pixelsChanged
    if entry.fullRefreshRequired then fullRefreshRequired = true end
    if entry.bounds ~= JSON_NULL and entry.bounds.width and entry.bounds.width > 0 and entry.bounds.height and entry.bounds.height > 0 then
      if entry.bounds.x < minX then minX = entry.bounds.x end
      if entry.bounds.y < minY then minY = entry.bounds.y end
      local right = entry.bounds.x + entry.bounds.width - 1
      local bottom = entry.bounds.y + entry.bounds.height - 1
      if right > maxX then maxX = right end
      if bottom > maxY then maxY = bottom end
    end
  end

  local aggregateBounds = JSON_NULL
  if maxX >= minX and maxY >= minY then
    aggregateBounds = {
      x = minX,
      y = minY,
      width = maxX - minX + 1,
      height = maxY - minY + 1
    }
  end

  return {
    changed = true,
    sinceRevision = since,
    currentRevision = state.revision,
    sessionId = state.sessionId,
    resyncRequired = false,
    gap = false,
    fullRefreshRequired = fullRefreshRequired,
    pixelsChanged = totalPixels,
    bounds = aggregateBounds,
    changes = changes
  }
end

-- Palette tools
handlers.get_palette = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local pal = spr.palettes[1]
  local colors = {}
  if pal then
    for i = 0, #pal - 1 do
      local c = pal:getColor(i)
      table.insert(colors, {
        index = i,
        hex = string.format("#%02X%02X%02X%02X", c.red, c.green, c.blue, c.alpha),
        rgba = { r = c.red, g = c.green, b = c.blue, a = c.alpha }
      })
    end
  end
  return { count = #colors, colors = colors, revision = state.revision }
end

handlers.set_palette_color = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local pal = spr.palettes[1]
  if not pal then error("No palette in sprite.") end
  local hex = params.color:gsub("^#", "")
  local r = tonumber(hex:sub(1, 2), 16) or 0
  local g = tonumber(hex:sub(3, 4), 16) or 0
  local b = tonumber(hex:sub(5, 6), 16) or 0
  local a = #hex >= 8 and (tonumber(hex:sub(7, 8), 16) or 255) or 255
  executeMcpMutation(function()
    pal:setColor(params.index, Color{ r = r, g = g, b = b, a = a })
    app.refresh()
  end)
  return finishMutation(params, { index = params.index, color = params.color }, "palette", rectToTable(spr.bounds), nil, true)
end

handlers.find_palette_color = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local pal = spr.palettes[1]
  if not pal then error("No palette.") end
  local rgba = parseHexRgba(params.color)
  local tr, tg, tb, ta = rgba.r, rgba.g, rgba.b, rgba.a

  local findNearest = true
  if params.findNearest == false then
    findNearest = false
  end

  local bestIdx = 0
  local minDiff = 1e9
  for i = 0, #pal - 1 do
    local c = pal:getColor(i)
    local diff = math.sqrt((c.red - tr)^2 + (c.green - tg)^2 + (c.blue - tb)^2 + (c.alpha - ta)^2)
    if diff < minDiff then
      minDiff = diff
      bestIdx = i
    end
    if diff == 0 then
      break
    end
  end

  local isExact = (minDiff == 0)
  if not isExact and not findNearest then
    return {
      success = true,
      found = false,
      exact = false
    }
  end

  local bestC = pal:getColor(bestIdx)
  return {
    success = true,
    found = true,
    index = bestIdx,
    hex = string.format("#%02X%02X%02X%02X", bestC.red, bestC.green, bestC.blue, bestC.alpha),
    exact = isExact,
    distance = isExact and 0 or minDiff
  }
end

-- Layer tools
handlers.list_layers = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local layers = {}
  local allLayers = {}
  collectLayersRecursive(spr, allLayers)
  for i, l in ipairs(allLayers) do
    table.insert(layers, {
      index = i,
      flatIndex = i - 1,
      name = l.name,
      isVisible = l.isVisible,
      isEditable = l.isEditable,
      opacity = l.opacity or 255,
      isGroup = l.isGroup,
      isBackground = l.isBackground,
      parent = l.parent and l.parent.isGroup and l.parent.name or JSON_NULL,
      stackIndex = l.stackIndex
    })
  end
  return { layers = layers }
end

handlers.create_layer = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end

  local targetGroup = nil
  if params.parentGroup ~= nil then
    local matched = {}
    findLayersByNameRecursive(spr, params.parentGroup, matched)
    if #matched == 0 then
      error("Parent group '" .. tostring(params.parentGroup) .. "' not found.")
    elseif #matched > 1 then
      error("Ambiguous parentGroup '" .. tostring(params.parentGroup) .. "': found multiple matching layers.")
    elseif not matched[1].isGroup then
      error("Layer '" .. tostring(params.parentGroup) .. "' is not a group.")
    end
    targetGroup = matched[1]
  end

  local layer = executeMcpMutation(function()
    local l = spr:newLayer()
    if params.name then l.name = params.name end
    if targetGroup then l.parent = targetGroup end
    app.refresh()
    return l
  end)

  return finishMutation(params, { name = layer.name, parentGroup = targetGroup and targetGroup.name or JSON_NULL }, "layers", rectToTable(spr.bounds), nil, true)
end

handlers.rename_layer = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local layer = resolveAnyLayer(spr, { layerName = params.oldName })
  executeMcpMutation(function() layer.name = params.newName; app.refresh() end)
  return finishMutation(params, { oldName = params.oldName, newName = params.newName }, "layers", rectToTable(spr.bounds), nil, true)
end

handlers.delete_layer = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local layer = resolveAnyLayer(spr, { layerName = params.name })
  executeMcpMutation(function() spr:deleteLayer(layer); app.refresh() end)
  return finishMutation(params, { deleted = params.name }, "layers", rectToTable(spr.bounds), nil, true)
end

handlers.select_layer = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local layer = resolveAnyLayer(spr, { layerName = params.name })
  app.layer = layer
  return { success = true, activeLayer = layer.name }
end

handlers.set_layer_visibility = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local layer = resolveAnyLayer(spr, { layerName = params.name })
  executeMcpMutation(function() layer.isVisible = params.visible; app.refresh() end)
  return finishMutation(params, { name = layer.name, visible = layer.isVisible }, "layers", rectToTable(spr.bounds), nil, true)
end

handlers.set_layer_opacity = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local layer = resolveAnyLayer(spr, { layerName = params.name })
  executeMcpMutation(function() layer.opacity = params.opacity; app.refresh() end)
  return finishMutation(params, { name = layer.name, opacity = layer.opacity }, "layers", rectToTable(spr.bounds), nil, true)
end

handlers.create_group = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local parentGroup = nil
  if params.parentGroup then
    parentGroup = resolveAnyLayer(spr, { layerName = params.parentGroup })
    if not parentGroup.isGroup then error("parentGroup must name a group layer.") end
  end
  local grp = executeMcpMutation(function()
    local created = spr:newGroup()
    if params.name then created.name = params.name end
    if parentGroup then created.parent = parentGroup end
    app.refresh()
    return created
  end)
  return finishMutation(params, { group = grp.name, parentGroup = parentGroup and parentGroup.name or JSON_NULL }, "layers", rectToTable(spr.bounds), nil, true)
end

handlers.move_layer = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  if not params.name or type(params.name) ~= "string" then
    error("Layer name is required.")
  end
  if params.targetIndex == nil or type(params.targetIndex) ~= "number" then
    error("targetIndex is required.")
  end

  local matchingLayers = {}
  local function findLayers(container)
    if not container or not container.layers then return end
    for _, l in ipairs(container.layers) do
      if l.name == params.name then
        table.insert(matchingLayers, l)
      end
      if l.isGroup then
        findLayers(l)
      end
    end
  end
  findLayers(spr)

  if #matchingLayers == 0 then
    error("Layer not found: " .. tostring(params.name))
  elseif #matchingLayers > 1 then
    error("Ambiguous layer name: multiple layers found with name '" .. tostring(params.name) .. "'")
  end

  local targetLayer = matchingLayers[1]
  local parent = targetLayer.parent or spr
  local siblings = (targetLayer.parent and targetLayer.parent.layers) or spr.layers
  local count = #siblings

  local fromIndex = (targetLayer.stackIndex or 1) - 1
  for i, l in ipairs(siblings) do
    if l == targetLayer then
      fromIndex = i - 1
      break
    end
  end

  local clampedTarget = math.max(0, math.min(count - 1, math.floor(params.targetIndex)))

  executeMcpMutation(function()
    targetLayer.stackIndex = clampedTarget + 1
    app.refresh()
  end)

  return finishMutation(params, {
    name = targetLayer.name,
    fromIndex = fromIndex,
    targetIndex = clampedTarget
  }, "layers", rectToTable(spr.bounds), nil, true)
end

-- Explicit cel tools
local function celBounds(cel)
  return {
    x = cel.position.x,
    y = cel.position.y,
    width = cel.image.width,
    height = cel.image.height
  }
end

local function linkedCelsForCel(spr, cel)
  local linked = {}
  local imageId = cel.image and cel.image.id or nil
  for _, other in ipairs(spr.cels or {}) do
    local otherId = other.image and other.image.id or nil
    if other ~= cel and ((imageId and otherId == imageId) or other.image == cel.image) then
      table.insert(linked, { layer = other.layer.name, frameNumber = other.frame.frameNumber })
    end
  end
  table.sort(linked, function(a, b)
    if a.layer == b.layer then return a.frameNumber < b.frameNumber end
    return a.layer < b.layer
  end)
  return linked
end

local function linkedFramesForCel(spr, layer, cel)
  local frames = {}
  for _, linked in ipairs(linkedCelsForCel(spr, cel)) do
    if linked.layer == layer.name then table.insert(frames, linked.frameNumber) end
  end
  table.sort(frames)
  return frames
end

handlers.get_cel = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local layer = resolveTargetLayer(spr, params, false)
  local frame = resolveTargetFrame(spr, params.frameNumber)
  local cel = layer:cel(frame)
  if not cel then
    return { success = true, hasCel = false, layer = layer.name, frameNumber = frame.frameNumber, revision = state.revision }
  end
  local linkedCels = linkedCelsForCel(spr, cel)
  local linkedFrames = linkedFramesForCel(spr, layer, cel)
  return {
    success = true,
    hasCel = true,
    layer = layer.name,
    frameNumber = frame.frameNumber,
    cel = {
      bounds = celBounds(cel),
      position = { x = cel.position.x, y = cel.position.y },
      opacity = cel.opacity or 255,
      zIndex = cel.zIndex or 0,
      isLinked = #linkedCels > 0,
      linkedFrames = linkedFrames,
      linkedCels = linkedCels
    },
    revision = state.revision
  }
end

handlers.create_cel = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local layer = resolveTargetLayer(spr, params, true)
  local frame = resolveTargetFrame(spr, params.frameNumber)
  if layer:cel(frame) then error("Cel already exists at target layer and frame.") end
  local width = params.width or spr.width
  local height = params.height or spr.height
  if type(width) ~= "number" or width < 1 or width > 4096 or math.floor(width) ~= width then error("Invalid cel width.") end
  if type(height) ~= "number" or height < 1 or height > 4096 or math.floor(height) ~= height then error("Invalid cel height.") end
  local x = params.x or 0
  local y = params.y or 0
  local cel = executeMcpMutation(function()
    local created = nil
    app.transaction("MCP create cel", function()
      local image = Image(width, height, spr.colorMode)
      image:clear(encodeColorToPixel(spr, params.color or "#00000000"))
      created = spr:newCel(layer, frame, image, Point(x, y))
    end)
    app.refresh()
    return created
  end)
  return finishMutation(params, {
    layer = layer.name,
    frameNumber = frame.frameNumber,
    position = { x = x, y = y }
  }, "cel", celBounds(cel), frame.frameNumber, false)
end

handlers.delete_cel = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  if params.confirm ~= true then error("delete_cel requires confirm: true") end
  local layer = resolveTargetLayer(spr, params, true)
  local frame = resolveTargetFrame(spr, params.frameNumber)
  local cel = layer:cel(frame)
  if not cel then error("Cel not found at target layer and frame.") end
  local bounds = celBounds(cel)
  executeMcpMutation(function()
    app.transaction("MCP delete cel", function() spr:deleteCel(cel) end)
    app.refresh()
  end)
  return finishMutation(params, { layer = layer.name, frameNumber = frame.frameNumber }, "cel", bounds, frame.frameNumber, false)
end

handlers.set_cel_position = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local layer = resolveTargetLayer(spr, params, true)
  local frame = resolveTargetFrame(spr, params.frameNumber)
  local cel = layer:cel(frame)
  if not cel then error("Cel not found at target layer and frame.") end
  local hasAbsolute = params.x ~= nil or params.y ~= nil
  local hasRelative = params.dx ~= nil or params.dy ~= nil
  if hasAbsolute == hasRelative then error("Provide either x/y or dx/dy, but not both.") end
  local oldBounds = celBounds(cel)
  local newX = hasAbsolute and (params.x or cel.position.x) or (cel.position.x + (params.dx or 0))
  local newY = hasAbsolute and (params.y or cel.position.y) or (cel.position.y + (params.dy or 0))
  if newX == cel.position.x and newY == cel.position.y then
    return { success = true, changed = false, position = { x = newX, y = newY }, bounds = oldBounds, revision = state.revision }
  end
  executeMcpMutation(function()
    app.transaction("MCP move cel", function() cel.position = Point(newX, newY) end)
    app.refresh()
  end)
  local newBounds = celBounds(cel)
  local oldRect = Rectangle(oldBounds.x, oldBounds.y, oldBounds.width, oldBounds.height)
  local newRect = Rectangle(newBounds.x, newBounds.y, newBounds.width, newBounds.height)
  return finishMutation(params, {
    changed = true,
    layer = layer.name,
    frameNumber = frame.frameNumber,
    position = { x = newX, y = newY }
  }, "cel", rectToTable(oldRect:union(newRect)), frame.frameNumber, false)
end

handlers.set_cel_opacity = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local layer = resolveTargetLayer(spr, params, true)
  local frame = resolveTargetFrame(spr, params.frameNumber)
  local cel = layer:cel(frame)
  if not cel then error("Cel not found at target layer and frame.") end
  if type(params.opacity) ~= "number" or math.floor(params.opacity) ~= params.opacity or params.opacity < 0 or params.opacity > 255 then
    error("opacity must be an integer from 0 through 255.")
  end
  if cel.opacity == params.opacity then
    return { success = true, changed = false, opacity = cel.opacity, bounds = celBounds(cel), revision = state.revision }
  end
  executeMcpMutation(function()
    app.transaction("MCP set cel opacity", function() cel.opacity = params.opacity end)
    app.refresh()
  end)
  return finishMutation(params, { changed = true, layer = layer.name, frameNumber = frame.frameNumber, opacity = cel.opacity }, "cel", celBounds(cel), frame.frameNumber, false)
end

handlers.link_cel = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local sourceLayer = resolveAnyLayer(spr, params, "sourceLayerName", "sourceLayerIndex")
  local targetLayer = resolveAnyLayer(spr, params, "targetLayerName", "targetLayerIndex")
  if not sourceLayer or sourceLayer.isGroup or not targetLayer or targetLayer.isGroup then error("Source and target must be image layers.") end
  local sourceFrame = resolveTargetFrame(spr, params.sourceFrame)
  local targetFrame = resolveTargetFrame(spr, params.targetFrame)
  if sourceLayer == targetLayer and sourceFrame == targetFrame then
    error("Source and target cel must be different.")
  end
  if sourceLayer ~= targetLayer then
    error("Linked cels must belong to the same image layer.")
  end
  local sourceCel = sourceLayer:cel(sourceFrame)
  if not sourceCel then error("Source cel not found.") end
  local existing = targetLayer:cel(targetFrame)
  if existing and params.replaceExisting ~= true then error("Target cel already exists; set replaceExisting: true to replace it.") end
  local linked = executeMcpMutation(function()
    local created = nil
    app.transaction("MCP link cel", function()
      if existing then spr:deleteCel(existing) end
      created = spr:newCel(targetLayer, targetFrame, sourceCel.image, sourceCel.position)
      app.layer = sourceLayer
      app.frame = sourceFrame
      app.range:clear()
      app.range.layers = { sourceLayer }
      app.range.frames = { sourceFrame.frameNumber, targetFrame.frameNumber }
      local commandResult = app.command.LinkCels()
      app.range:clear()
      if commandResult == false then error("Aseprite refused to link the selected cels.") end
      created = targetLayer:cel(targetFrame)
      if not created or created.image.id ~= sourceCel.image.id then
        error("Aseprite did not create a linked cel.")
      end
      created.opacity = sourceCel.opacity
    end)
    app.refresh()
    return created
  end)
  return finishMutation(params, {
    sourceLayer = sourceLayer.name,
    sourceFrame = sourceFrame.frameNumber,
    targetLayer = targetLayer.name,
    targetFrame = targetFrame.frameNumber,
    linked = true
  }, "cel", celBounds(linked), targetFrame.frameNumber, false)
end

handlers.unlink_cel = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local layer = resolveTargetLayer(spr, params, true)
  local frame = resolveTargetFrame(spr, params.frameNumber)
  local cel = layer:cel(frame)
  if not cel then error("Cel not found at target layer and frame.") end
  if #linkedCelsForCel(spr, cel) == 0 then
    return { success = true, changed = false, linked = false, bounds = celBounds(cel), revision = state.revision }
  end
  executeMcpMutation(function()
    app.transaction("MCP unlink cel", function() cel.image = cel.image:clone() end)
    app.refresh()
  end)
  return finishMutation(params, { changed = true, layer = layer.name, frameNumber = frame.frameNumber, linked = false }, "cel", celBounds(cel), frame.frameNumber, false)
end

-- Recursive layer/group and composition tools
handlers.list_layer_tree = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local flatIndex = 0
  local function visit(container)
    local nodes = {}
    for _, layer in ipairs(container.layers or {}) do
      local node = {
        index = flatIndex,
        uuid = tostring(layer.uuid or ""),
        name = layer.name,
        stackIndex = layer.stackIndex,
        isVisible = layer.isVisible,
        isEditable = layer.isEditable,
        isLocked = layer.isLocked,
        opacity = layer.opacity or 255,
        isGroup = layer.isGroup,
        isImage = layer.isImage,
        isTilemap = layer.isTilemap,
        isBackground = layer.isBackground
      }
      flatIndex = flatIndex + 1
      if layer.isGroup then node.children = visit(layer) end
      table.insert(nodes, node)
    end
    return nodes
  end
  return { success = true, layers = visit(spr), revision = state.revision }
end

handlers.move_layer_to_group = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local layer = resolveAnyLayer(spr, { layerName = params.name }, "layerName", "layerIndex")
  local parent = spr
  if params.parentGroup then
    parent = resolveAnyLayer(spr, { layerName = params.parentGroup }, "layerName", "layerIndex")
    if not parent.isGroup then error("Target parent is not a group.") end
    local cursor = parent
    while cursor and cursor ~= spr do
      if cursor == layer then error("Cannot move a group into itself or one of its descendants.") end
      cursor = cursor.parent
    end
  end
  local previousParent = layer.parent
  if previousParent == parent and (params.targetIndex == nil or layer.stackIndex == params.targetIndex) then
    return { success = true, changed = false, name = layer.name, parentGroup = params.parentGroup or JSON_NULL, bounds = rectToTable(spr.bounds), revision = state.revision }
  end
  executeMcpMutation(function()
    app.transaction("MCP move layer to group", function()
      layer.parent = parent
      if params.targetIndex ~= nil then
        local maxIndex = #(parent.layers or spr.layers)
        layer.stackIndex = math.max(1, math.min(maxIndex, params.targetIndex))
      end
    end)
    app.refresh()
  end)
  return finishMutation(params, { changed = true, name = layer.name, parentGroup = params.parentGroup or JSON_NULL, stackIndex = layer.stackIndex }, "layers", rectToTable(spr.bounds), nil, true)
end

handlers.ungroup_layer = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local group = resolveAnyLayer(spr, { layerName = params.name }, "layerName", "layerIndex")
  if not group.isGroup then error("Layer is not a group: " .. tostring(params.name)) end
  local parent = group.parent or spr
  local groupIndex = group.stackIndex
  local children = {}
  for _, child in ipairs(group.layers or {}) do table.insert(children, child) end
  executeMcpMutation(function()
    app.transaction("MCP ungroup layer", function()
      for i, child in ipairs(children) do
        child.parent = parent
        child.stackIndex = math.min(#parent.layers, groupIndex + i - 1)
      end
      spr:deleteLayer(group)
    end)
    app.refresh()
  end)
  local names = {}
  for _, child in ipairs(children) do table.insert(names, child.name) end
  return finishMutation(params, { group = params.name, children = names }, "layers", rectToTable(spr.bounds), nil, true)
end

local BLEND_MODES = {
  normal = BlendMode.NORMAL, src = BlendMode.SRC, multiply = BlendMode.MULTIPLY,
  screen = BlendMode.SCREEN, overlay = BlendMode.OVERLAY, darken = BlendMode.DARKEN,
  lighten = BlendMode.LIGHTEN, color_dodge = BlendMode.COLOR_DODGE, color_burn = BlendMode.COLOR_BURN,
  hard_light = BlendMode.HARD_LIGHT, soft_light = BlendMode.SOFT_LIGHT, difference = BlendMode.DIFFERENCE,
  exclusion = BlendMode.EXCLUSION, hsl_hue = BlendMode.HSL_HUE,
  hsl_saturation = BlendMode.HSL_SATURATION, hsl_color = BlendMode.HSL_COLOR,
  hsl_luminosity = BlendMode.HSL_LUMINOSITY, addition = BlendMode.ADDITION,
  subtract = BlendMode.SUBTRACT, divide = BlendMode.DIVIDE
}

handlers.set_layer_blend_mode = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local layer = resolveTargetLayer(spr, params, true)
  local mode = BLEND_MODES[params.blendMode]
  if not mode then error("Unsupported blend mode: " .. tostring(params.blendMode)) end
  if layer.blendMode == mode then
    return { success = true, changed = false, name = layer.name, blendMode = params.blendMode, bounds = rectToTable(spr.bounds), revision = state.revision }
  end
  executeMcpMutation(function()
    app.transaction("MCP set layer blend mode", function() layer.blendMode = mode end)
    app.refresh()
  end)
  return finishMutation(params, { changed = true, name = layer.name, blendMode = params.blendMode }, "layers", rectToTable(spr.bounds), nil, false)
end

handlers.merge_down_layer = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  if params.confirm ~= true then error("merge_down_layer requires confirm: true") end
  local layer = resolveTargetLayer(spr, params, true)
  if layer.stackIndex <= 1 then error("Cannot merge the bottom layer down.") end
  local oldActive = app.layer
  local mergedName = layer.name
  executeMcpMutation(function()
    app.transaction("MCP merge down", function()
      app.layer = layer
      app.command.MergeDownLayer()
    end)
    app.refresh()
  end)
  local resultLayer = app.layer
  if oldActive and oldActive ~= layer and oldActive.sprite then pcall(function() app.layer = oldActive end) end
  return finishMutation(params, { mergedLayer = mergedName, resultLayer = resultLayer and resultLayer.name or "" }, "layers", rectToTable(spr.bounds), nil, true)
end

handlers.flatten_layers = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  if params.confirm ~= true then error("flatten_layers requires confirm: true") end
  if #spr.layers <= 1 then
    return { success = true, changed = false, layerCount = #spr.layers, bounds = rectToTable(spr.bounds), revision = state.revision }
  end
  executeMcpMutation(function()
    app.transaction("MCP flatten layers", function() spr:flatten() end)
    app.refresh()
  end)
  return finishMutation(params, { changed = true, layerCount = #spr.layers, layer = spr.layers[1] and spr.layers[1].name or "" }, "layers", rectToTable(spr.bounds), nil, true)
end

-- Slice tools
local function findSliceByName(spr, name)
  local found = nil
  for _, slice in ipairs(spr.slices or {}) do
    if slice.name == name then
      if found then error("Ambiguous slice name: " .. tostring(name)) end
      found = slice
    end
  end
  if not found then error("Slice not found: " .. tostring(name)) end
  return found
end

local function validateSliceGeometry(bounds, center, pivot)
  if not bounds or bounds.width < 1 or bounds.height < 1 then error("Slice bounds must be non-empty.") end
  if center and center ~= JSON_NULL then
    if center.width < 1 or center.height < 1 or center.x < 0 or center.y < 0 or
       center.x + center.width > bounds.width or center.y + center.height > bounds.height then
      error("Slice center must be a non-empty rectangle inside the slice in local coordinates.")
    end
  end
  if pivot and pivot ~= JSON_NULL then
    if pivot.x < 0 or pivot.y < 0 or pivot.x >= bounds.width or pivot.y >= bounds.height then
      error("Slice pivot must be inside the slice in local coordinates.")
    end
  end
end

local function sliceToTable(slice)
  return {
    name = slice.name,
    bounds = rectToTable(slice.bounds),
    center = slice.center and rectToTable(slice.center) or JSON_NULL,
    pivot = slice.pivot and { x = slice.pivot.x, y = slice.pivot.y } or JSON_NULL,
    color = slice.color and rgbaToHex({ r = slice.color.red, g = slice.color.green, b = slice.color.blue, a = slice.color.alpha }) or JSON_NULL,
    data = slice.data or ""
  }
end

handlers.list_slices = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local slices = {}
  for _, slice in ipairs(spr.slices or {}) do table.insert(slices, sliceToTable(slice)) end
  return { success = true, slices = slices, revision = state.revision }
end

handlers.get_slice = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  return { success = true, slice = sliceToTable(findSliceByName(spr, params.name)), revision = state.revision }
end

handlers.create_slice = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  for _, slice in ipairs(spr.slices or {}) do if slice.name == params.name then error("Slice already exists: " .. params.name) end end
  validateSliceGeometry(params.bounds, params.center, params.pivot)
  local slice = executeMcpMutation(function()
    local created = nil
    app.transaction("MCP create slice", function()
      created = spr:newSlice(Rectangle(params.bounds.x, params.bounds.y, params.bounds.width, params.bounds.height))
      created.name = params.name
      if params.center then created.center = Rectangle(params.center.x, params.center.y, params.center.width, params.center.height) end
      if params.pivot then created.pivot = Point(params.pivot.x, params.pivot.y) end
      if params.color then local c = parseHexRgba(params.color); created.color = Color{ r = c.r, g = c.g, b = c.b, a = c.a } end
      if params.data then created.data = params.data end
    end)
    app.refresh()
    return created
  end)
  return finishMutation(params, { slice = sliceToTable(slice) }, "slices", rectToTable(slice.bounds), nil, false)
end

handlers.update_slice = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local slice = findSliceByName(spr, params.name)
  if params.newName and params.newName ~= params.name then
    for _, other in ipairs(spr.slices or {}) do if other.name == params.newName then error("Slice already exists: " .. params.newName) end end
  end
  local nextBounds = params.bounds or rectToTable(slice.bounds)
  local nextCenter = params.center == nil and (slice.center and rectToTable(slice.center) or nil) or params.center
  local nextPivot = params.pivot == nil and (slice.pivot and { x = slice.pivot.x, y = slice.pivot.y } or nil) or params.pivot
  validateSliceGeometry(nextBounds, nextCenter, nextPivot)
  local oldBounds = slice.bounds
  executeMcpMutation(function()
    app.transaction("MCP update slice", function()
      if params.bounds then slice.bounds = Rectangle(params.bounds.x, params.bounds.y, params.bounds.width, params.bounds.height) end
      if params.center ~= nil then
        slice.center = params.center == JSON_NULL and nil or Rectangle(params.center.x, params.center.y, params.center.width, params.center.height)
      end
      if params.pivot ~= nil then slice.pivot = params.pivot == JSON_NULL and nil or Point(params.pivot.x, params.pivot.y) end
      if params.newName then slice.name = params.newName end
      if params.color then local c = parseHexRgba(params.color); slice.color = Color{ r = c.r, g = c.g, b = c.b, a = c.a } end
      if params.data ~= nil then slice.data = params.data end
    end)
    app.refresh()
  end)
  return finishMutation(params, { slice = sliceToTable(slice) }, "slices", rectToTable(oldBounds:union(slice.bounds)), nil, false)
end

handlers.delete_slice = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  if params.confirm ~= true then error("delete_slice requires confirm: true") end
  local slice = findSliceByName(spr, params.name)
  local bounds = rectToTable(slice.bounds)
  executeMcpMutation(function()
    app.transaction("MCP delete slice", function() spr:deleteSlice(slice) end)
    app.refresh()
  end)
  return finishMutation(params, { deleted = params.name }, "slices", bounds, nil, false)
end

-- Persistent selection tools
local function selectionResult(spr)
  local selection = spr.selection
  return {
    isEmpty = selection.isEmpty,
    bounds = selection.isEmpty and JSON_NULL or rectToTable(selection.bounds),
    origin = { x = selection.origin.x, y = selection.origin.y }
  }
end

handlers.get_selection = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local result = selectionResult(spr)
  result.success = true
  result.revision = state.revision
  return result
end

handlers.set_selection = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local rect = Rectangle(params.x, params.y, params.width, params.height):intersect(spr.bounds)
  if rect.isEmpty then error("Selection rectangle does not intersect the sprite canvas.") end
  local operation = params.operation or "replace"
  executeMcpMutation(function()
    app.transaction("MCP set selection", function()
      if operation == "replace" then spr.selection:select(rect)
      elseif operation == "add" then spr.selection:add(rect)
      elseif operation == "subtract" then spr.selection:subtract(rect)
      elseif operation == "intersect" then spr.selection:intersect(rect)
      else error("Unsupported selection operation: " .. tostring(operation)) end
    end)
    app.refresh()
  end)
  local result = selectionResult(spr)
  return finishMutation(params, result, "selection", rectToTable(rect), nil, false)
end

handlers.clear_selection = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  if spr.selection.isEmpty then
    local result = selectionResult(spr); result.success = true; result.revision = state.revision; result.changed = false; return result
  end
  local oldBounds = rectToTable(spr.selection.bounds)
  executeMcpMutation(function()
    app.transaction("MCP clear selection", function() spr.selection:deselect() end)
    app.refresh()
  end)
  local result = selectionResult(spr); result.changed = true
  return finishMutation(params, result, "selection", oldBounds, nil, false)
end

handlers.invert_selection = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  executeMcpMutation(function()
    app.transaction("MCP invert selection", function()
      local inverted = Selection(spr.bounds)
      inverted:subtract(spr.selection)
      spr.selection = inverted
    end)
    app.refresh()
  end)
  local result = selectionResult(spr); result.changed = true
  return finishMutation(params, result, "selection", rectToTable(spr.bounds), nil, false)
end

-- Tileset and tilemap tools (Aseprite 1.3+)
local function requireTilemapApi()
  if not ColorMode.TILEMAP or not app.pixelColor.tile or not app.pixelColor.tileI or not app.pixelColor.tileF then
    error("Tilemap tools require Aseprite 1.3 or newer.")
  end
end

local function resolveTileset(spr, zeroBasedIndex)
  requireTilemapApi()
  if type(zeroBasedIndex) ~= "number" or math.floor(zeroBasedIndex) ~= zeroBasedIndex or zeroBasedIndex < 0 then
    error("Invalid tilesetIndex: " .. tostring(zeroBasedIndex))
  end
  local tileset = spr.tilesets[zeroBasedIndex + 1]
  if not tileset then error("Tileset not found at index " .. tostring(zeroBasedIndex)) end
  return tileset
end

local function tilesetToTable(tileset, index)
  local grid = tileset.grid
  return {
    index = index,
    name = tileset.name,
    baseIndex = tileset.baseIndex,
    tileCount = #tileset,
    grid = {
      x = grid.origin.x,
      y = grid.origin.y,
      tileWidth = grid.tileSize.width,
      tileHeight = grid.tileSize.height
    },
    data = tileset.data or ""
  }
end

handlers.list_tilesets = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  requireTilemapApi()
  local result = {}
  for index, tileset in ipairs(spr.tilesets or {}) do table.insert(result, tilesetToTable(tileset, index - 1)) end
  return { success = true, tilesets = result, revision = state.revision }
end

handlers.create_tileset = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  requireTilemapApi()
  local width = params.tileWidth
  local height = params.tileHeight
  local count = params.tileCount or 1
  if type(width) ~= "number" or width < 1 or width > 1024 or math.floor(width) ~= width then error("Invalid tileWidth.") end
  if type(height) ~= "number" or height < 1 or height > 1024 or math.floor(height) ~= height then error("Invalid tileHeight.") end
  if type(count) ~= "number" or count < 1 or count > 4096 or math.floor(count) ~= count then error("Invalid tileCount.") end
  if width * height * count > MAX_TILESET_PIXELS then
    error("Tileset exceeds the 16,777,216 pixel safety limit.")
  end
  local tileset = executeMcpMutation(function()
    local created = nil
    app.transaction("MCP create tileset", function()
      created = spr:newTileset(Rectangle(0, 0, width, height), count)
      created.name = params.name
      created.baseIndex = params.baseIndex or 1
    end)
    app.refresh()
    return created
  end)
  return finishMutation(params, { tileset = tilesetToTable(tileset, #spr.tilesets - 1) }, "tilesets", rectToTable(spr.bounds), nil, true)
end

handlers.delete_tileset = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  if params.confirm ~= true then error("delete_tileset requires confirm: true") end
  local tileset = resolveTileset(spr, params.tilesetIndex)
  local allLayers = {}
  collectLayersRecursive(spr, allLayers)
  for _, layer in ipairs(allLayers) do
    if layer.isTilemap and layer.tileset == tileset then error("Cannot delete a tileset while a tilemap layer references it.") end
  end
  executeMcpMutation(function()
    app.transaction("MCP delete tileset", function() spr:deleteTileset(tileset) end)
    app.refresh()
  end)
  return finishMutation(params, { deletedTilesetIndex = params.tilesetIndex }, "tilesets", rectToTable(spr.bounds), nil, true)
end

handlers.get_tile = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local tileset = resolveTileset(spr, params.tilesetIndex)
  local tile = tileset:tile(params.tileIndex)
  if not tile then error("Tile not found at index " .. tostring(params.tileIndex)) end
  return {
    success = true,
    tilesetIndex = params.tilesetIndex,
    tileIndex = tile.index,
    width = tile.image.width,
    height = tile.image.height,
    color = tile.color and string.format("#%02X%02X%02X%02X", tile.color.red, tile.color.green, tile.color.blue, tile.color.alpha) or JSON_NULL,
    data = tile.data or "",
    pngBase64 = exportImagePngBase64(tile.image, spr),
    revision = state.revision
  }
end

handlers.set_tile_pixels = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local tileset = resolveTileset(spr, params.tilesetIndex)
  if params.tileIndex == 0 then error("Tile 0 is reserved as the empty tile.") end
  local tile = tileset:tile(params.tileIndex)
  if not tile then error("Tile not found at index " .. tostring(params.tileIndex)) end
  if type(params.pixels) ~= "table" or #params.pixels < 1 or #params.pixels > MAX_PIXELS_BATCH then error("Invalid tile pixel batch.") end
  local image = tile.image:clone()
  local minX, minY = image.width, image.height
  local maxX, maxY = -1, -1
  local changed = 0
  for _, pixel in ipairs(params.pixels) do
    if pixel.x < 0 or pixel.y < 0 or pixel.x >= image.width or pixel.y >= image.height then error("Tile pixel outside tile bounds.") end
    local native = encodeColorToPixel(spr, pixel.color)
    if image:getPixel(pixel.x, pixel.y) ~= native then
      image:putPixel(pixel.x, pixel.y, native)
      changed = changed + 1
      minX = math.min(minX, pixel.x); minY = math.min(minY, pixel.y)
      maxX = math.max(maxX, pixel.x); maxY = math.max(maxY, pixel.y)
    end
  end
  if changed == 0 then return { success = true, changed = false, pixelsChanged = 0, bounds = { x = 0, y = 0, width = 0, height = 0 }, revision = state.revision } end
  executeMcpMutation(function()
    app.transaction("MCP set tile pixels", function() tile.image = image end)
    app.refresh()
  end)
  local result = finishMutation({}, {
    changed = true, pixelsChanged = changed, tilesetIndex = params.tilesetIndex, tileIndex = params.tileIndex
  }, "tilesets", { x = minX, y = minY, width = maxX - minX + 1, height = maxY - minY + 1 }, nil, true)
  if params.returnPreview then result.pngBase64 = exportImagePngBase64(image, spr) end
  return result
end

handlers.create_tilemap_layer = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local tileset = resolveTileset(spr, params.tilesetIndex)
  local frame = resolveTargetFrame(spr, params.frameNumber)
  local parentGroup = nil
  if params.parentGroup then
    parentGroup = resolveAnyLayer(spr, { layerName = params.parentGroup })
    if not parentGroup.isGroup then error("parentGroup is not a group.") end
  end
  local oldLayer = app.layer
  local oldFrame = app.frame
  local layer = executeMcpMutation(function()
    local created = nil
    local ok, mutationError = pcall(function()
      app.transaction("MCP create tilemap layer", function()
        app.frame = frame
        app.command.NewLayer{
          name = params.name,
          tilemap = true,
          gridBounds = Rectangle(0, 0, tileset.grid.tileSize.width, tileset.grid.tileSize.height),
          ask = false,
          top = true
        }
        created = app.layer
        local generatedTileset = created.tileset
        created.tileset = tileset
        if generatedTileset and generatedTileset ~= tileset then pcall(function() spr:deleteTileset(generatedTileset) end) end
        if parentGroup then created.parent = parentGroup end
        if not created:cel(frame) then
          local gridWidth = math.ceil(spr.width / tileset.grid.tileSize.width)
          local gridHeight = math.ceil(spr.height / tileset.grid.tileSize.height)
          spr:newCel(created, frame, Image(gridWidth, gridHeight, ColorMode.TILEMAP), Point(0, 0))
        end
      end)
    end)
    if oldLayer then pcall(function() app.layer = oldLayer end) end
    if oldFrame then pcall(function() app.frame = oldFrame end) end
    if not ok then error(mutationError) end
    app.refresh()
    return created
  end)
  return finishMutation(params, { name = layer.name, tilesetIndex = params.tilesetIndex, frameNumber = frame.frameNumber }, "tilemaps", rectToTable(spr.bounds), frame.frameNumber, true)
end

handlers.get_tilemap = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  requireTilemapApi()
  local layer = resolveAnyLayer(spr, params)
  if not layer.isTilemap then error("Target layer is not a tilemap.") end
  local frame = resolveTargetFrame(spr, params.frameNumber)
  local cel = layer:cel(frame)
  if not cel then return { success = true, hasCel = false, layer = layer.name, frameNumber = frame.frameNumber, revision = state.revision } end
  local rows = {}
  for y = 0, cel.image.height - 1 do
    local row = {}
    for x = 0, cel.image.width - 1 do
      local value = cel.image:getPixel(x, y)
      local flags = app.pixelColor.tileF(value)
      table.insert(row, {
        tileIndex = app.pixelColor.tileI(value),
        xFlip = (flags & 0x80000000) ~= 0,
        yFlip = (flags & 0x40000000) ~= 0,
        diagonalFlip = (flags & 0x20000000) ~= 0
      })
    end
    table.insert(rows, row)
  end
  return {
    success = true, hasCel = true, layer = layer.name, frameNumber = frame.frameNumber,
    width = cel.image.width, height = cel.image.height,
    tileWidth = layer.tileset.grid.tileSize.width, tileHeight = layer.tileset.grid.tileSize.height,
    origin = { x = cel.position.x, y = cel.position.y }, tiles = rows, revision = state.revision
  }
end

handlers.set_tiles = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  requireTilemapApi()
  local layer = resolveAnyLayer(spr, params)
  if not layer.isTilemap then error("Target layer is not a tilemap.") end
  local frame = resolveTargetFrame(spr, params.frameNumber)
  if type(params.tiles) ~= "table" or #params.tiles < 1 or #params.tiles > MAX_PIXELS_BATCH then error("Invalid tile batch.") end
  local cel = layer:cel(frame)
  local gridWidth = math.ceil(spr.width / layer.tileset.grid.tileSize.width)
  local gridHeight = math.ceil(spr.height / layer.tileset.grid.tileSize.height)
  local image = cel and cel.image:clone() or Image(gridWidth, gridHeight, ColorMode.TILEMAP)
  if not cel then image:clear(app.pixelColor.tile(0, 0)) end
  local celPosition = cel and cel.position or Point(0, 0)
  local minX, minY = image.width, image.height
  local maxX, maxY = -1, -1
  local changed = 0
  for _, item in ipairs(params.tiles) do
    if item.x < 0 or item.y < 0 or item.x >= image.width or item.y >= image.height then error("Tile cell outside tilemap bounds.") end
    if item.tileIndex < 0 or item.tileIndex >= #layer.tileset then error("tileIndex outside tileset bounds.") end
    local flags = (item.xFlip and 0x80000000 or 0) | (item.yFlip and 0x40000000 or 0) | (item.diagonalFlip and 0x20000000 or 0)
    local value = app.pixelColor.tile(item.tileIndex, flags)
    if image:getPixel(item.x, item.y) ~= value then
      image:putPixel(item.x, item.y, value)
      changed = changed + 1
      minX = math.min(minX, item.x); minY = math.min(minY, item.y)
      maxX = math.max(maxX, item.x); maxY = math.max(maxY, item.y)
    end
  end
  if changed == 0 then return { success = true, changed = false, tilesChanged = 0, bounds = { x = 0, y = 0, width = 0, height = 0 }, revision = state.revision } end
  executeMcpMutation(function()
    app.transaction("MCP set tiles", function()
      if cel then
        cel.image = image
      else
        cel = spr:newCel(layer, frame, image, celPosition)
      end
    end)
    app.refresh()
  end)
  local tileWidth = layer.tileset.grid.tileSize.width
  local tileHeight = layer.tileset.grid.tileSize.height
  local bounds = {
    x = celPosition.x + minX * tileWidth, y = celPosition.y + minY * tileHeight,
    width = (maxX - minX + 1) * tileWidth, height = (maxY - minY + 1) * tileHeight
  }
  return finishMutation(params, { changed = true, tilesChanged = changed, layer = layer.name, frameNumber = frame.frameNumber }, "tilemaps", bounds, frame.frameNumber, false)
end

-- Frame tools
handlers.list_frames = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local frames = {}
  for i, f in ipairs(spr.frames) do
    table.insert(frames, {
      frameNumber = f.frameNumber,
      durationMs = math.floor((f.duration or 0.1) * 1000)
    })
  end
  return { frames = frames }
end

handlers.select_frame = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local f = spr.frames[params.frameNumber]
  if not f then error("Frame not found.") end
  app.frame = f
  return { success = true, activeFrame = f.frameNumber }
end

handlers.create_frame = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end

  if params.durationMs ~= nil then
    error("create_frame accepts 'duration' (in milliseconds), not 'durationMs'")
  end

  if params.afterFrame ~= nil then
    local af = params.afterFrame
    if type(af) ~= "number" or math.floor(af) ~= af or af < 1 or af > #spr.frames then
      error("Invalid afterFrame: " .. tostring(af))
    end
  end

  local pos = params.afterFrame and (params.afterFrame + 1) or (#spr.frames + 1)
  local durMs = params.duration or 100

  local f = executeMcpMutation(function()
    local newF = spr:newEmptyFrame(pos)
    newF.duration = durMs / 1000
    app.refresh()
    return newF
  end)

  return finishMutation(params, {
    frameNumber = f.frameNumber,
    createdFrameNumber = f.frameNumber,
    totalFrames = #spr.frames,
    durationMs = math.floor(f.duration * 1000)
  }, "frames", rectToTable(spr.bounds), f.frameNumber, true)
end

handlers.duplicate_frame = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local frameNumber = params.frameNumber
  if not frameNumber or type(frameNumber) ~= "number" or frameNumber < 1 or frameNumber > #spr.frames then
    error("Invalid frameNumber: " .. tostring(frameNumber))
  end

  local newFrame = executeMcpMutation(function()
    local f = spr:newFrame(frameNumber)
    app.frame = f
    app.refresh()
    return f
  end)

  return finishMutation(params, {
    copiedFrom = frameNumber,
    newFrameNumber = newFrame.frameNumber,
    totalFrames = #spr.frames
  }, "frames", rectToTable(spr.bounds), newFrame.frameNumber, true)
end

handlers.delete_frame = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local f = spr.frames[params.frameNumber]
  if not f then error("Frame not found.") end
  executeMcpMutation(function() spr:deleteFrame(f); app.refresh() end)
  return finishMutation(params, { deletedFrame = params.frameNumber }, "frames", rectToTable(spr.bounds), nil, true)
end

handlers.set_frame_duration = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local f = spr.frames[params.frameNumber]
  if not f then error("Frame not found.") end
  executeMcpMutation(function() f.duration = params.durationMs / 1000 end)
  return finishMutation(params, { frameNumber = f.frameNumber, durationMs = params.durationMs }, "frames", rectToTable(spr.bounds), f.frameNumber, false)
end

handlers.create_tag = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end

  local fromFrame = params.fromFrame
  local toFrame = params.toFrame
  if not fromFrame or type(fromFrame) ~= "number" or math.floor(fromFrame) ~= fromFrame or fromFrame < 1 or fromFrame > #spr.frames then
    error("Invalid fromFrame: " .. tostring(fromFrame))
  end
  if not toFrame or type(toFrame) ~= "number" or math.floor(toFrame) ~= toFrame or toFrame < 1 or toFrame > #spr.frames then
    error("Invalid toFrame: " .. tostring(toFrame))
  end
  if fromFrame > toFrame then
    error("fromFrame must be <= toFrame")
  end

  local tag = executeMcpMutation(function()
    local t = spr:newTag(fromFrame, toFrame)
    if params.name then t.name = params.name end
    local directions = {
      forward = AniDir.FORWARD,
      reverse = AniDir.REVERSE,
      pingpong = AniDir.PING_PONG,
      pingpong_reverse = AniDir.PING_PONG_REVERSE
    }
    local direction = params.direction or "forward"
    if not directions[direction] then error("Invalid tag direction: " .. tostring(direction)) end
    t.aniDir = directions[direction]
    if params.color then
      local rgba = parseHexRgba(params.color)
      t.color = Color{ r = rgba.r, g = rgba.g, b = rgba.b, a = rgba.a }
    end
    return t
  end)

  return finishMutation(params, { tag = tag.name }, "tags", rectToTable(spr.bounds), nil, false)
end

handlers.list_tags = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local tags = {}
  for _, t in ipairs(spr.tags) do
    local direction = "forward"
    if t.aniDir == AniDir.REVERSE then direction = "reverse"
    elseif t.aniDir == AniDir.PING_PONG then direction = "pingpong"
    elseif t.aniDir == AniDir.PING_PONG_REVERSE then direction = "pingpong_reverse" end
    local item = {
      name = t.name,
      from = t.fromFrame.frameNumber,
      to = t.toFrame.frameNumber,
      color = t.color and string.format("#%02X%02X%02X%02X", t.color.red, t.color.green, t.color.blue, t.color.alpha) or nil,
      direction = direction
    }
    table.insert(tags, item)
  end
  return { tags = tags }
end

-- File / Canvas tools
handlers.new_sprite = function(params)
  local w = params.width or 32
  local h = params.height or 32
  local mode = ColorMode.RGB
  if params.colorMode == "grayscale" then mode = ColorMode.GRAYSCALE
  elseif params.colorMode == "indexed" then mode = ColorMode.INDEXED end
  local spr = Sprite(w, h, mode)
  app.sprite = spr
  app.refresh()
  state.revision = 1
  resetChangeJournal()
  recordChange(state.revision, "sprite", 0, rectToTable(spr.bounds), true, "new_sprite")
  local result = { success = true, width = w, height = h, colorMode = params.colorMode or "rgb", revision = state.revision }
  if params.returnPreview then result.pngBase64 = exportFramePngBase64(spr, 1) end
  return result
end

handlers.open_sprite = function(params)
  local spr = app.open(params.filePath)
  if not spr then error("Failed to open sprite: " .. tostring(params.filePath)) end
  app.sprite = spr
  state.revision = 1
  resetChangeJournal()
  recordChange(state.revision, "sprite", 0, rectToTable(spr.bounds), true, "open_sprite")
  return { success = true, filename = spr.filename, revision = state.revision }
end

handlers.save_sprite = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  if not params or not params.expectedFilePath or type(params.expectedFilePath) ~= "string" or #params.expectedFilePath == 0 then
    error("expectedFilePath is required.")
  end
  local expected = params.expectedFilePath:gsub("\\", "/")
  local actual = (spr.filename or ""):gsub("\\", "/")
  if expected ~= actual then
    error("Sprite filename mismatch: expected '" .. tostring(params.expectedFilePath) .. "', but active sprite is '" .. tostring(spr.filename) .. "'.")
  end
  app.command.SaveFile()
  return { success = true, filename = spr.filename, message = "Saved sprite" }
end

handlers.save_sprite_as = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  if not params.filePath or type(params.filePath) ~= "string" or #params.filePath == 0 then
    error("filePath is required.")
  end
  if params.overwrite ~= true then
    local f = io.open(params.filePath, "r")
    if f then
      f:close()
      error("File already exists and overwrite is false: " .. tostring(params.filePath))
    end
  end
  spr:saveAs(params.filePath)
  return { success = true, filename = params.filePath, message = "Saved sprite as " .. params.filePath }
end

handlers.export_png = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end

  if not params.outputPath or type(params.outputPath) ~= "string" or #params.outputPath == 0 then
    error("outputPath is required.")
  end

  if params.overwrite ~= true then
    local f = io.open(params.outputPath, "r")
    if f then
      f:close()
      error("File already exists and overwrite is false: " .. tostring(params.outputPath))
    end
  end

  local targetFrame = resolveTargetFrame(spr, params.frameNumber)
  local frameNum = targetFrame.frameNumber

  local scale = params.scale or 1
  if type(scale) ~= "number" or math.floor(scale) ~= scale or scale < 1 or scale > 32 then
    error("Invalid scale: " .. tostring(scale) .. ". Must be an integer between 1 and 32.")
  end

  local compImg = Image(spr.spec)
  compImg:drawSprite(spr, frameNum)

  if scale > 1 then
    compImg:resize{ width = spr.width * scale, height = spr.height * scale }
  end

  if spr.colorMode == ColorMode.INDEXED then
    local pal = (spr.palettes and spr.palettes[1])
    if pal then
      compImg:saveAs{ filename = params.outputPath, palette = pal }
    else
      compImg:saveAs(params.outputPath)
    end
  else
    compImg:saveAs(params.outputPath)
  end

  return {
    success = true,
    outputPath = params.outputPath,
    frameNumber = frameNum,
    scale = scale,
    width = compImg.width,
    height = compImg.height
  }
end

handlers.export_sprite_sheet = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  if not params.outputPath or type(params.outputPath) ~= "string" or #params.outputPath == 0 then
    error("outputPath is required.")
  end
  if params.overwrite ~= true then
    local existing = io.open(params.outputPath, "r")
    if existing then existing:close(); error("File already exists and overwrite is false: " .. tostring(params.outputPath)) end
  end

  local scale = params.scale or 1
  local spacing = params.spacing or 0
  if type(scale) ~= "number" or math.floor(scale) ~= scale or scale < 1 or scale > 32 then
    error("scale must be an integer between 1 and 32.")
  end
  if type(spacing) ~= "number" or math.floor(spacing) ~= spacing or spacing < 0 or spacing > 64 then
    error("spacing must be an integer between 0 and 64.")
  end

  local frameNumbers = {}
  local selectedTag = nil
  if params.tagName then
    if params.fromFrame or params.toFrame then error("tagName is mutually exclusive with fromFrame/toFrame.") end
    for _, tag in ipairs(spr.tags) do if tag.name == params.tagName then selectedTag = tag; break end end
    if not selectedTag then error("Tag not found: " .. tostring(params.tagName)) end
    local fromFrame = selectedTag.fromFrame.frameNumber
    local toFrame = selectedTag.toFrame.frameNumber
    if selectedTag.aniDir == AniDir.REVERSE or selectedTag.aniDir == AniDir.PING_PONG_REVERSE then
      for frame = toFrame, fromFrame, -1 do table.insert(frameNumbers, frame) end
      if selectedTag.aniDir == AniDir.PING_PONG_REVERSE then
        for frame = fromFrame + 1, toFrame - 1 do table.insert(frameNumbers, frame) end
      end
    else
      for frame = fromFrame, toFrame do table.insert(frameNumbers, frame) end
      if selectedTag.aniDir == AniDir.PING_PONG then
        for frame = toFrame - 1, fromFrame + 1, -1 do table.insert(frameNumbers, frame) end
      end
    end
  else
    if (params.fromFrame == nil) ~= (params.toFrame == nil) then error("fromFrame and toFrame must be provided together.") end
    local fromFrame = params.fromFrame or ((app.frame and app.frame.frameNumber) or 1)
    local toFrame = params.toFrame or fromFrame
    if fromFrame < 1 or toFrame > #spr.frames or fromFrame > toFrame then
      error("Invalid frame range.")
    end
    for frame = fromFrame, toFrame do table.insert(frameNumbers, frame) end
  end
  if #frameNumbers < 1 or #frameNumbers > 256 then error("Export range must contain between 1 and 256 frames.") end

  local selectedLayers = nil
  if params.layerNames then
    if type(params.layerNames) ~= "table" or #params.layerNames < 1 or #params.layerNames > 64 then
      error("layerNames must contain between 1 and 64 layer names.")
    end
    selectedLayers = {}
    local selectedSet = {}
    for _, name in ipairs(params.layerNames) do
      local layer = resolveAnyLayer(spr, { layerName = name })
      if layer.isGroup then error("Group layers cannot be exported directly: " .. tostring(name)) end
      selectedSet[layer] = true
    end
    local allLayers = {}
    collectLayersRecursive(spr, allLayers)
    for _, layer in ipairs(allLayers) do if selectedSet[layer] then table.insert(selectedLayers, layer) end end
  end

  local layout = params.layout or "horizontal"
  local columns
  if layout == "horizontal" then columns = #frameNumbers
  elseif layout == "vertical" then columns = 1
  elseif layout == "grid" then
    columns = params.columns or math.ceil(math.sqrt(#frameNumbers))
    if type(columns) ~= "number" or math.floor(columns) ~= columns or columns < 1 or columns > 64 then
      error("columns must be an integer between 1 and 64.")
    end
  else error("Invalid layout: " .. tostring(layout)) end
  columns = math.min(columns, #frameNumbers)
  local rows = math.ceil(#frameNumbers / columns)
  local frameWidth = spr.width * scale
  local frameHeight = spr.height * scale
  local outputWidth = columns * frameWidth + (columns - 1) * spacing
  local outputHeight = rows * frameHeight + (rows - 1) * spacing
  if outputWidth * outputHeight > 67108864 then error("Sprite sheet exceeds the 67,108,864 pixel safety limit.") end

  local sheet = Image(ImageSpec{
    width = outputWidth,
    height = outputHeight,
    colorMode = spr.colorMode,
    transparentColor = spr.transparentColor
  })
  sheet:clear(getTransparentPixel(spr))
  for index, frameNumber in ipairs(frameNumbers) do
    local frameImage = Image(spr.spec)
    frameImage:clear(getTransparentPixel(spr))
    if selectedLayers then
      for _, layer in ipairs(selectedLayers) do
        if layer.isVisible then
          local cel = layer:cel(frameNumber)
          if cel and cel.image then
            local opacity = math.floor(((cel.opacity or 255) * (layer.opacity or 255) + 127) / 255)
            frameImage:drawImage(cel.image, cel.position, opacity, layer.blendMode or BlendMode.NORMAL)
          end
        end
      end
    else
      frameImage:drawSprite(spr, frameNumber, Point(0, 0))
    end
    if scale > 1 then frameImage:resize{ width = frameWidth, height = frameHeight } end
    local x = ((index - 1) % columns) * (frameWidth + spacing)
    local y = math.floor((index - 1) / columns) * (frameHeight + spacing)
    sheet:drawImage(frameImage, Point(x, y))
  end

  if spr.colorMode == ColorMode.INDEXED and spr.palettes and spr.palettes[1] then
    sheet:saveAs{ filename = params.outputPath, palette = spr.palettes[1] }
  else
    sheet:saveAs(params.outputPath)
  end
  return {
    success = true,
    outputPath = params.outputPath,
    frameNumbers = frameNumbers,
    tagName = selectedTag and selectedTag.name or nil,
    layerNames = params.layerNames,
    layout = layout,
    columns = columns,
    rows = rows,
    scale = scale,
    spacing = spacing,
    width = outputWidth,
    height = outputHeight
  }
end

handlers.resize_canvas = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end

  local newW = params.width
  local newH = params.height
  if type(newW) ~= "number" or math.floor(newW) ~= newW or newW < 1 or newW > 4096 then
    error("Invalid width: " .. tostring(newW) .. ". Must be an integer between 1 and 4096.")
  end
  if type(newH) ~= "number" or math.floor(newH) ~= newH or newH < 1 or newH > 4096 then
    error("Invalid height: " .. tostring(newH) .. ". Must be an integer between 1 and 4096.")
  end

  local validAnchors = {
    top_left = true,
    center = true,
    top_right = true,
    bottom_left = true,
    bottom_right = true
  }
  local anchor = params.anchor or "top_left"
  if not validAnchors[anchor] then
    error("Invalid anchor: " .. tostring(anchor))
  end

  local oldW = spr.width
  local oldH = spr.height

  local x, y = 0, 0
  if anchor == "top_left" then
    x = 0
    y = 0
  elseif anchor == "center" then
    x = math.floor((oldW - newW) / 2)
    y = math.floor((oldH - newH) / 2)
  elseif anchor == "top_right" then
    x = oldW - newW
    y = 0
  elseif anchor == "bottom_left" then
    x = 0
    y = oldH - newH
  elseif anchor == "bottom_right" then
    x = oldW - newW
    y = oldH - newH
  end

  executeMcpMutation(function()
    app.command.CanvasSize{
      ui = false,
      bounds = Rectangle{ x = x, y = y, width = newW, height = newH }
    }
    app.refresh()
  end)

  local ox = -x
  if ox == 0 then ox = 0 end
  local oy = -y
  if oy == 0 then oy = 0 end

  return finishMutation(params, {
    previousWidth = oldW,
    previousHeight = oldH,
    width = newW,
    height = newH,
    oldDimensions = { width = oldW, height = oldH },
    newDimensions = { width = newW, height = newH },
    anchor = anchor,
    contentOffset = { x = ox, y = oy }
  }, "canvas", { x = 0, y = 0, width = newW, height = newH }, nil, true)
end

-- ------------------------------------------------------------------------------
-- UI Status Indicator & WebSocket Client Initializer
-- ------------------------------------------------------------------------------
local function initWebSocket(dlg)
  dlg:modify{ id = "status_lbl", text = "Connecting to 127.0.0.1:" .. PORT .. "..." }

  state.ws = WebSocket{
    url = WS_URL,
    deflate = false,
    minreconnectwait = 1,
    maxreconnectwait = 5,
    onreceive = function(msgType, data, err)
      if msgType == WebSocketMessageType.OPEN then
        local authStatus = AUTH_ENABLED and "enabled" or "disabled"
        state.authenticated = false
        dlg:modify{ id = "status_lbl", text = "Authenticating (" .. PORT .. ")..." }
        local hello = {
          event = "hello",
          data = {
            bridgeProtocolVersion = BRIDGE_PROTOCOL_VERSION,
            asepriteVersion = tostring(app.version or "unknown"),
            apiVersion = tonumber(app.apiVersion) or 0,
            sessionId = state.sessionId,
            revision = state.revision,
            token = BRIDGE_TOKEN,
            capabilities = {
              changeJournal = true,
              frameEvents = true,
              layerEvents = true,
              safeJson = true
            }
          }
        }
        local sent = pcall(function() state.ws:sendText(bridgeJson.encode(hello)) end)
        if not sent then
          dlg:modify{ id = "status_lbl", text = "Handshake failed (check server logs)" }
        end

      elseif msgType == WebSocketMessageType.CLOSE then
        state.authenticated = false
        dlg:modify{ id = "status_lbl", text = "Disconnected (Reconnecting...)" }

      elseif msgType == WebSocketMessageType.ERROR then
        state.authenticated = false
        dlg:modify{ id = "status_lbl", text = "Connection error (check server logs)" }

      elseif msgType == WebSocketMessageType.TEXT then
        local ok, req = pcall(bridgeJson.decode, data)
        if not ok or type(req) ~= "table" then
          return
        end

        if req.event == "hello_ack" and req.data then
          local serverVersion = tostring(req.data.bridgeProtocolVersion or "")
          local serverMajor = serverVersion:match("^(%d+)%.")
          local clientMajor = BRIDGE_PROTOCOL_VERSION:match("^(%d+)%.")
          if serverMajor == clientMajor and req.data.sessionId == state.sessionId then
            state.authenticated = true
            local authStatus = AUTH_ENABLED and "enabled" or "disabled"
            local syncStatus = req.data.resyncRequired and "resync required" or "in sync"
            dlg:modify{ id = "status_lbl", text = "Connected (" .. PORT .. ") [" .. syncStatus .. "]" }
            app.tip("Connected to MCP Server (127.0.0.1:" .. PORT .. ") [Auth: " .. authStatus .. "]", 3)
          else
            dlg:modify{ id = "status_lbl", text = "Incompatible bridge protocol" }
            pcall(function() state.ws:close() end)
          end
        elseif not state.authenticated then
          pcall(function() state.ws:close() end)
        elseif req.id and req.command and handlers[req.command] then
          local success, resultOrErr = pcall(handlers[req.command], req.params or {})
          local response = { id = req.id, success = success }
          if success then
            response.result = resultOrErr
          else
            response.error = {
              code = "EXECUTION_ERROR",
              message = tostring(resultOrErr)
            }
          end
          pcall(function() state.ws:sendText(bridgeJson.encode(response)) end)
        elseif req.id then
          local response = {
            id = req.id,
            success = false,
            error = {
              code = "UNKNOWN_COMMAND",
              message = "Unknown command: " .. tostring(req.command)
            }
          }
          pcall(function() state.ws:sendText(bridgeJson.encode(response)) end)
        end
      end
    end
  }

  state.ws:connect()
end

local function initBridge()
  local dlg = Dialog{
    title = "Aseprite MCP Bridge",
    onclose = function()
      if state.sitechangeListenerId then
        pcall(function() app.events:off(state.sitechangeListenerId) end)
        state.sitechangeListenerId = nil
      end
      if state.spriteListeners then
        for _, l in pairs(state.spriteListeners) do
          pcall(function() l.spr.events:off(l.code) end)
        end
        state.spriteListeners = {}
      end
      if state.ws then
        pcall(function() state.ws:close() end)
        state.ws = nil
      end
      if _G.__ASEPRITE_MCP_BRIDGE == state then
        _G.__ASEPRITE_MCP_BRIDGE = nil
      end
      app.tip("Aseprite MCP Bridge stopped", 2)
    end
  }

  local authStatus = AUTH_ENABLED and "enabled" or "disabled"
  local portNote = PORT_FALLBACK and " (fallback default)" or ""
  dlg:label{ id = "status_lbl", label = "Status:", text = "Connecting..." }
  dlg:label{ id = "port_lbl", label = "Target:", text = WS_BASE_URL .. portNote .. " [Auth: " .. authStatus .. "]" }
  dlg:button{ id = "reconnect_btn", text = "Reconnect", onclick = function()
    if state.ws then pcall(function() state.ws:close() end) end
    initWebSocket(dlg)
  end }
  dlg:button{ id = "close_btn", text = "Close", onclick = function() dlg:close() end }

  dlg:show{ wait = false }
  state.dialog = dlg
  initWebSocket(dlg)
end

-- ------------------------------------------------------------------------------
-- Sprite Event Monitoring for Revision Invalidation
-- ------------------------------------------------------------------------------
local function hookSpriteEvents(spr)
  if not spr or not spr.id or state.hookedSprites[spr.id] then return end
  state.hookedSprites[spr.id] = true

  local listenerCode = spr.events:on('change', function(ev)
    if not state.isExecutingMcp then
      state.revision = state.revision + 1
      recordChange(
        state.revision,
        "external",
        0,
        JSON_NULL,
        true,
        ev and ev.fromUndo and "external_undo" or "external_edit"
      )
      if state.ws and state.authenticated then
        pcall(function()
          state.ws:sendText(bridgeJson.encode({
            event = "revision_changed",
            data = {
              revision = state.revision,
              sessionId = state.sessionId,
              fromUndo = ev and ev.fromUndo or false
            }
          }))
        end)
      end
    end
  end)

  state.spriteListeners[spr.id] = { spr = spr, code = listenerCode }
end

state.sitechangeListenerId = app.events:on('sitechange', function()
  if app.sprite then
    hookSpriteEvents(app.sprite)
    local spriteId = tostring(app.sprite.id or app.sprite.filename or app.sprite)
    local frameNumber = app.frame and app.frame.frameNumber or 1
    local layerId = app.layer and tostring(app.layer.id or app.layer.name or app.layer) or ""

    if state.ws and state.authenticated then
      if state.lastSpriteId ~= spriteId then
        pcall(function()
          state.ws:sendText(bridgeJson.encode({
            event = "sprite_switched",
            data = {
              revision = state.revision,
              sessionId = state.sessionId,
              activeSprite = {
                filename = app.sprite.filename,
                width = app.sprite.width,
                height = app.sprite.height,
                colorMode = tostring(app.sprite.colorMode),
                layerCount = #app.sprite.layers,
                frameCount = #app.sprite.frames,
                activeLayer = app.layer and app.layer.name or "",
                activeFrame = frameNumber
              }
            }
          }))
        end)
      else
        if state.lastFrameNumber ~= frameNumber then
          pcall(function()
            state.ws:sendText(bridgeJson.encode({
              event = "frame_changed",
              data = {
                revision = state.revision,
                sessionId = state.sessionId,
                activeFrame = frameNumber
              }
            }))
          end)
        end
        if state.lastLayerId ~= layerId then
          pcall(function()
            state.ws:sendText(bridgeJson.encode({
              event = "layer_changed",
              data = {
                revision = state.revision,
                sessionId = state.sessionId,
                activeLayer = app.layer and app.layer.name or ""
              }
            }))
          end)
        end
      end
    end

    state.lastSpriteId = spriteId
    state.lastFrameNumber = frameNumber
    state.lastLayerId = layerId
  end
end)

if app.sprite then
  hookSpriteEvents(app.sprite)
  state.lastSpriteId = tostring(app.sprite.id or app.sprite.filename or app.sprite)
  state.lastFrameNumber = app.frame and app.frame.frameNumber or 1
  state.lastLayerId = app.layer and tostring(app.layer.id or app.layer.name or app.layer) or ""
end

-- Launch bridge
initBridge()
