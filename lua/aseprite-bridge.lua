-- ==============================================================================
-- Aseprite MCP Bridge Script (lua/aseprite-bridge.lua)
-- Compatible with Aseprite v1.2.30+ and v1.3+
-- Full-duplex JSON-RPC command bridge over WebSocket on 127.0.0.1:32123
-- ==============================================================================

local DEFAULT_PORT = 32123

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
if AUTH_ENABLED then
  WS_URL = WS_BASE_URL .. "/?token=" .. BRIDGE_TOKEN
end

local MAX_PIXELS_BATCH = 100000
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

local function recordPixelChange(rev, count, bounds)
  table.insert(state.changeJournal, {
    revision = rev,
    pixelsChanged = count,
    bounds = bounds
  })
  if #state.changeJournal > MAX_CHANGE_JOURNAL_ENTRIES then
    table.remove(state.changeJournal, 1)
  end
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

local function resolveTargetLayer(spr, params, forWriting)
  if not spr then error("No active sprite open in Aseprite.") end
  local byIndex = nil
  if params.layerIndex ~= nil then
    local idx = params.layerIndex
    if type(idx) ~= "number" or math.floor(idx) ~= idx or idx < 0 or idx >= #spr.layers then
      error("Invalid layerIndex: " .. tostring(idx))
    end
    byIndex = spr.layers[idx + 1]
  end

  local byName = nil
  if params.layerName ~= nil then
    local matched = {}
    findLayersByNameRecursive(spr, params.layerName, matched)
    if #matched == 0 then
      error("Layer '" .. tostring(params.layerName) .. "' not found.")
    elseif #matched > 1 then
      error("Ambiguous layerName '" .. tostring(params.layerName) .. "': found multiple matching layers.")
    end
    byName = matched[1]
  end

  local targetLayer = nil
  if byIndex ~= nil and byName ~= nil then
    if byIndex ~= byName then
      error("Conflicting layer selectors: layerIndex and layerName refer to different layers.")
    end
    targetLayer = byIndex
  elseif byIndex ~= nil then
    targetLayer = byIndex
  elseif byName ~= nil then
    targetLayer = byName
  else
    targetLayer = app.layer or (spr.layers and spr.layers[1])
  end

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
  state.revision = state.revision + 1
  return { success = true, revision = state.revision }
end

handlers.redo = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  state.isExecutingMcp = true
  app.redo()
  app.refresh()
  state.isExecutingMcp = false
  state.revision = state.revision + 1
  return { success = true, revision = state.revision }
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
  if type(since) ~= "number" or since < 0 or math.floor(since) ~= since then
    return {
      changed = true,
      sinceRevision = since,
      currentRevision = state.revision,
      fullRefreshRequired = true
    }
  end

  if since == state.revision then
    return {
      changed = false,
      sinceRevision = since,
      currentRevision = state.revision,
      pixelsChanged = 0,
      bounds = JSON_NULL
    }
  end

  if since > state.revision or (state.revision - since) > MAX_CHANGE_JOURNAL_ENTRIES then
    return {
      changed = true,
      sinceRevision = since,
      currentRevision = state.revision,
      fullRefreshRequired = true
    }
  end

  local journalMap = {}
  for _, entry in ipairs(state.changeJournal) do
    journalMap[entry.revision] = entry
  end

  local totalPixels = 0
  local minX, minY = 1e9, 1e9
  local maxX, maxY = -1e9, -1e9

  for r = since + 1, state.revision do
    local entry = journalMap[r]
    if not entry then
      return {
        changed = true,
        sinceRevision = since,
        currentRevision = state.revision,
        fullRefreshRequired = true
      }
    end
    totalPixels = totalPixels + entry.pixelsChanged
    if entry.bounds.x < minX then minX = entry.bounds.x end
    if entry.bounds.y < minY then minY = entry.bounds.y end
    local right = entry.bounds.x + entry.bounds.width - 1
    local bottom = entry.bounds.y + entry.bounds.height - 1
    if right > maxX then maxX = right end
    if bottom > maxY then maxY = bottom end
  end

  return {
    changed = true,
    sinceRevision = since,
    currentRevision = state.revision,
    pixelsChanged = totalPixels,
    bounds = {
      x = minX,
      y = minY,
      width = maxX - minX + 1,
      height = maxY - minY + 1
    }
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
  pal:setColor(params.index, Color{ r = r, g = g, b = b, a = a })
  app.refresh()
  state.revision = state.revision + 1
  return { success = true, index = params.index, color = params.color, revision = state.revision }
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
  for i, l in ipairs(spr.layers) do
    table.insert(layers, {
      index = i,
      name = l.name,
      isVisible = l.isVisible,
      isEditable = l.isEditable,
      opacity = l.opacity or 255,
      isGroup = l.isGroup,
      isBackground = l.isBackground
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

  state.revision = state.revision + 1
  return { success = true, name = layer.name, revision = state.revision }
end

handlers.rename_layer = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  for _, l in ipairs(spr.layers) do
    if l.name == params.oldName then
      l.name = params.newName
      app.refresh()
      state.revision = state.revision + 1
      return { success = true, oldName = params.oldName, newName = params.newName, revision = state.revision }
    end
  end
  error("Layer not found: " .. tostring(params.oldName))
end

handlers.delete_layer = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  for _, l in ipairs(spr.layers) do
    if l.name == params.name then
      spr:deleteLayer(l)
      app.refresh()
      state.revision = state.revision + 1
      return { success = true, deleted = params.name, revision = state.revision }
    end
  end
  error("Layer not found: " .. tostring(params.name))
end

handlers.select_layer = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  for _, l in ipairs(spr.layers) do
    if l.name == params.name then
      app.layer = l
      return { success = true, activeLayer = l.name }
    end
  end
  error("Layer not found: " .. tostring(params.name))
end

handlers.set_layer_visibility = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  for _, l in ipairs(spr.layers) do
    if l.name == params.name then
      l.isVisible = params.visible
      app.refresh()
      state.revision = state.revision + 1
      return { success = true, name = l.name, visible = l.isVisible, revision = state.revision }
    end
  end
  error("Layer not found: " .. tostring(params.name))
end

handlers.set_layer_opacity = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  for _, l in ipairs(spr.layers) do
    if l.name == params.name then
      l.opacity = params.opacity
      app.refresh()
      state.revision = state.revision + 1
      return { success = true, name = l.name, opacity = l.opacity, revision = state.revision }
    end
  end
  error("Layer not found: " .. tostring(params.name))
end

handlers.create_group = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local grp = spr:newGroup()
  if params.name then grp.name = params.name end
  app.refresh()
  state.revision = state.revision + 1
  return { success = true, group = grp.name, revision = state.revision }
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

  state.revision = state.revision + 1

  return {
    success = true,
    name = targetLayer.name,
    fromIndex = fromIndex,
    targetIndex = clampedTarget,
    revision = state.revision
  }
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

  state.revision = state.revision + 1
  return {
    success = true,
    frameNumber = f.frameNumber,
    createdFrameNumber = f.frameNumber,
    totalFrames = #spr.frames,
    durationMs = math.floor(f.duration * 1000),
    revision = state.revision
  }
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

  state.revision = state.revision + 1

  return {
    success = true,
    copiedFrom = frameNumber,
    newFrameNumber = newFrame.frameNumber,
    totalFrames = #spr.frames,
    revision = state.revision
  }
end

handlers.delete_frame = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local f = spr.frames[params.frameNumber]
  if not f then error("Frame not found.") end
  spr:deleteFrame(f)
  app.refresh()
  state.revision = state.revision + 1
  return { success = true, deletedFrame = params.frameNumber, revision = state.revision }
end

handlers.set_frame_duration = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local f = spr.frames[params.frameNumber]
  if not f then error("Frame not found.") end
  f.duration = params.durationMs / 1000
  state.revision = state.revision + 1
  return { success = true, frameNumber = f.frameNumber, durationMs = params.durationMs, revision = state.revision }
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
    if params.color then
      local rgba = parseHexRgba(params.color)
      t.color = Color{ r = rgba.r, g = rgba.g, b = rgba.b, a = rgba.a }
    end
    return t
  end)

  state.revision = state.revision + 1
  return { success = true, tag = tag.name, revision = state.revision }
end

handlers.list_tags = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local tags = {}
  for _, t in ipairs(spr.tags) do
    local item = {
      name = t.name,
      from = t.fromFrame.frameNumber,
      to = t.toFrame.frameNumber,
      color = t.color and string.format("#%02X%02X%02X%02X", t.color.red, t.color.green, t.color.blue, t.color.alpha) or nil
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
  return { success = true, width = w, height = h, colorMode = params.colorMode or "rgb", revision = state.revision }
end

handlers.open_sprite = function(params)
  local spr = app.open(params.filePath)
  if not spr then error("Failed to open sprite: " .. tostring(params.filePath)) end
  app.sprite = spr
  state.revision = 1
  resetChangeJournal()
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
    state.revision = state.revision + 1
  end)

  local ox = -x
  if ox == 0 then ox = 0 end
  local oy = -y
  if oy == 0 then oy = 0 end

  return {
    success = true,
    previousWidth = oldW,
    previousHeight = oldH,
    width = newW,
    height = newH,
    oldDimensions = { width = oldW, height = oldH },
    newDimensions = { width = newW, height = newH },
    anchor = anchor,
    contentOffset = { x = ox, y = oy },
    revision = state.revision
  }
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
        dlg:modify{ id = "status_lbl", text = "Connected (" .. PORT .. ") [Auth: " .. authStatus .. "]" }
        app.tip("Connected to MCP Server (127.0.0.1:" .. PORT .. ") [Auth: " .. authStatus .. "]", 3)

      elseif msgType == WebSocketMessageType.CLOSE then
        dlg:modify{ id = "status_lbl", text = "Disconnected (Reconnecting...)" }

      elseif msgType == WebSocketMessageType.ERROR then
        dlg:modify{ id = "status_lbl", text = "Connection error (check server logs)" }

      elseif msgType == WebSocketMessageType.TEXT then
        local ok, req = pcall(bridgeJson.decode, data)
        if not ok or type(req) ~= "table" then
          return
        end

        if req.id and req.command and handlers[req.command] then
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
      if state.ws then
        pcall(function()
          state.ws:sendText(bridgeJson.encode({
            event = "revision_changed",
            data = {
              revision = state.revision,
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
    if state.ws then
      pcall(function()
        state.ws:sendText(bridgeJson.encode({
          event = "sprite_switched",
          data = {
            activeSprite = {
              filename = app.sprite.filename,
              width = app.sprite.width,
              height = app.sprite.height
            }
          }
        }))
      end)
    end
  end
end)

if app.sprite then hookSpriteEvents(app.sprite) end

-- Launch bridge
initBridge()
