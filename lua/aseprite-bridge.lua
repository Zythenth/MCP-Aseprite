-- ==============================================================================
-- Aseprite MCP Bridge Script (lua/aseprite-bridge.lua)
-- Compatible with Aseprite v1.2.30+ and v1.3+
-- Full-duplex JSON-RPC command bridge over WebSocket on 127.0.0.1:32123
-- ==============================================================================

local PORT = 32123
local WS_URL = "ws://127.0.0.1:" .. PORT

-- ------------------------------------------------------------------------------
-- Fallback JSON Encoder/Decoder if global json is not available
-- ------------------------------------------------------------------------------
if not json then
  json = {}
  function json.encode(val)
    local t = type(val)
    if t == "nil" then return "null"
    elseif t == "boolean" then return tostring(val)
    elseif t == "number" then return tostring(val)
    elseif t == "string" then
      return string.format("%q", val):gsub("\n", "\\n"):gsub("\r", "\\r")
    elseif t == "table" then
      local isArray = #val > 0
      local parts = {}
      if isArray then
        for _, v in ipairs(val) do
          table.insert(parts, json.encode(v))
        end
        return "[" .. table.concat(parts, ",") .. "]"
      else
        for k, v in pairs(val) do
          table.insert(parts, string.format("%q", tostring(k)) .. ":" .. json.encode(v))
        end
        return "{" .. table.concat(parts, ",") .. "}"
      end
    end
    return "null"
  end

  function json.decode(str)
    -- Minimal json parser using Lua patterns & load
    local s = str:gsub('"(.-)"', function(m) return string.format("%q", m) end)
                 :gsub('%[', '{')
                 :gsub('%]', '}')
                 :gsub(':(%s*)', '=%1')
                 :gsub('null', 'nil')
    local fn = load("return " .. s)
    if fn then return fn() end
    error("JSON decode failed")
  end
end

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

-- ------------------------------------------------------------------------------
-- Helper: Color & Hex Conversions (Little-Endian 0xAABBGGRR)
-- ------------------------------------------------------------------------------
local function parseHexColor(hex)
  if type(hex) ~= "string" then return 0 end
  hex = hex:gsub("^#", "")
  local r = tonumber(hex:sub(1, 2), 16) or 0
  local g = tonumber(hex:sub(3, 4), 16) or 0
  local b = tonumber(hex:sub(5, 6), 16) or 0
  local a = 255
  if #hex >= 8 then
    a = tonumber(hex:sub(7, 8), 16) or 255
  end
  return app.pixelColor.rgba(r, g, b, a)
end

local function colorToHex(colorInt)
  local r = app.pixelColor.rgbaR(colorInt)
  local g = app.pixelColor.rgbaG(colorInt)
  local b = app.pixelColor.rgbaB(colorInt)
  local a = app.pixelColor.rgbaA(colorInt)
  return string.format("#%02X%02X%02X%02X", r, g, b, a)
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
local function exportFramePngBase64(sprite, frameNumber)
  frameNumber = frameNumber or (app.frame and app.frame.frameNumber) or 1
  local compImg = Image(sprite.spec)
  compImg:drawSprite(sprite, frameNumber, Point(0, 0))

  local tempFileName = string.format("ase_mcp_%d_%d.png", os.time(), math.random(1000, 9999))
  local tempPath = app.fs.joinPath(app.fs.tempPath, tempFileName)
  compImg:saveAs(tempPath)

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
  fullImg:clear()
  if cel.image then
    fullImg:drawImage(cel.image, cel.position)
  end
  cel.position = Point(0, 0)
  return cel, fullImg
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
  local frameNum = params.frameIndex or (app.frame and app.frame.frameNumber) or 1
  local b64 = exportFramePngBase64(spr, frameNum)
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
  local frameNum = params.frameIndex or (app.frame and app.frame.frameNumber) or 1
  local targetLayer = app.layer
  if params.layerName then
    for _, l in ipairs(spr.layers) do
      if l.name == params.layerName then targetLayer = l; break end
    end
  end
  if not targetLayer then error("Target layer not found.") end

  local cel = targetLayer:cel(frameNum)
  local format = params.format or "hex"
  local grid = {}
  local paletteMap = {}
  local paletteList = {}

  for y = 0, spr.height - 1 do
    local row = {}
    for x = 0, spr.width - 1 do
      local colorInt = 0
      if cel and x >= cel.position.x and y >= cel.position.y
             and x < cel.position.x + cel.image.width
             and y < cel.position.y + cel.image.height then
        colorInt = cel.image:getPixel(x - cel.position.x, y - cel.position.y)
      end

      if format == "hex" then
        table.insert(row, colorToHex(colorInt))
      elseif format == "rgba" then
        table.insert(row, {
          r = app.pixelColor.rgbaR(colorInt),
          g = app.pixelColor.rgbaG(colorInt),
          b = app.pixelColor.rgbaB(colorInt),
          a = app.pixelColor.rgbaA(colorInt)
        })
      elseif format == "compact" then
        local hex = colorToHex(colorInt)
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
    width = spr.width,
    height = spr.height,
    format = format,
    grid = grid,
    revision = state.revision
  }
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
  local layer = app.layer
  if not layer or layer.isGroup then error("Cannot paint on invalid layer or group.") end
  local frame = app.frame or spr.frames[1]

  local pixels = params.pixels
  if not pixels or #pixels == 0 then error("No pixels provided.") end

  local minX, minY = spr.width, spr.height
  local maxX, maxY = 0, 0
  local modifiedCount = 0

  state.isExecutingMcp = true
  local ok, err = pcall(function()
    app.transaction("MCP: set_pixels", function()
      local cel, img = ensureCanvasSizedCel(spr, layer, frame)

      for _, p in ipairs(pixels) do
        if p.x >= 0 and p.x < spr.width and p.y >= 0 and p.y < spr.height then
          local c = parseHexColor(p.color)
          img:drawPixel(p.x, p.y, c)
          modifiedCount = modifiedCount + 1
          if p.x < minX then minX = p.x end
          if p.y < minY then minY = p.y end
          if p.x > maxX then maxX = p.x end
          if p.y > maxY then maxY = p.y end
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
  else
    bounds = { x = 0, y = 0, width = 0, height = 0 }
  end

  local res = {
    pixelsModified = modifiedCount,
    bounds = bounds,
    revision = state.revision
  }
  if params.returnPreview then
    res.pngBase64 = exportFramePngBase64(spr, frame.frameNumber)
  end
  return res
end

handlers.set_pixel = function(params)
  params.pixels = { { x = params.x, y = params.y, color = params.color } }
  return handlers.set_pixels(params)
end

handlers.erase_pixels = function(params)
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
  local layer = app.layer or spr.layers[1]
  local frame = app.frame or spr.frames[1]
  local cel = layer:cel(frame)
  if not cel then error("No cel found at active frame/layer.") end

  local targetColor = 0
  if x >= cel.position.x and y >= cel.position.y
     and x < cel.position.x + cel.image.width and y < cel.position.y + cel.image.height then
    targetColor = cel.image:getPixel(x - cel.position.x, y - cel.position.y)
  end

  local targetHex = colorToHex(targetColor)
  if targetHex == params.color then
    return { pixelsModified = 0, revision = state.revision }
  end

  local visited = {}
  local queue = { { x, y } }
  visited[y * spr.width + x] = true
  local pixels = {}

  while #queue > 0 do
    local pt = table.remove(queue, 1)
    local px, py = pt[1], pt[2]
    table.insert(pixels, { x = px, y = py, color = params.color })

    local nbs = { { px + 1, py }, { px - 1, py }, { px, py + 1 }, { px, py - 1 } }
    for _, nb in ipairs(nbs) do
      local nx, ny = nb[1], nb[2]
      if nx >= 0 and nx < spr.width and ny >= 0 and ny < spr.height then
        local key = ny * spr.width + nx
        if not visited[key] then
          visited[key] = true
          local cInt = 0
          if nx >= cel.position.x and ny >= cel.position.y
             and nx < cel.position.x + cel.image.width and ny < cel.position.y + cel.image.height then
            cInt = cel.image:getPixel(nx - cel.position.x, ny - cel.position.y)
          end
          if cInt == targetColor then
            table.insert(queue, { nx, ny })
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
  local fromColor = parseHexColor(params.fromColor)
  local layer = app.layer or spr.layers[1]
  local frame = app.frame or spr.frames[1]
  local cel = layer:cel(frame)
  if not cel then return { pixelsModified = 0, revision = state.revision } end

  local pixels = {}
  for cy = 0, spr.height - 1 do
    for cx = 0, spr.width - 1 do
      local cInt = 0
      if cx >= cel.position.x and cy >= cel.position.y
         and cx < cel.position.x + cel.image.width and cy < cel.position.y + cel.image.height then
        cInt = cel.image:getPixel(cx - cel.position.x, cy - cel.position.y)
      end
      if cInt == fromColor then
        table.insert(pixels, { x = cx, y = cy, color = params.toColor })
      end
    end
  end

  params.pixels = pixels
  return handlers.set_pixels(params)
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
  local hex = params.color:gsub("^#", "")
  local tr = tonumber(hex:sub(1, 2), 16) or 0
  local tg = tonumber(hex:sub(3, 4), 16) or 0
  local tb = tonumber(hex:sub(5, 6), 16) or 0
  local ta = #hex >= 8 and (tonumber(hex:sub(7, 8), 16) or 255) or 255

  local bestIdx = 0
  local minDiff = 1e9
  for i = 0, #pal - 1 do
    local c = pal:getColor(i)
    local diff = (c.red - tr)^2 + (c.green - tg)^2 + (c.blue - tb)^2 + (c.alpha - ta)^2
    if diff < minDiff then
      minDiff = diff
      bestIdx = i
    end
  end

  local bestC = pal:getColor(bestIdx)
  return {
    index = bestIdx,
    hex = string.format("#%02X%02X%02X%02X", bestC.red, bestC.green, bestC.blue, bestC.alpha),
    exact = minDiff == 0
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
  local layer = spr:newLayer()
  if params.name then layer.name = params.name end
  app.refresh()
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
  local f = spr:newEmptyFrame()
  if params.duration then f.duration = params.duration / 1000 end
  app.refresh()
  state.revision = state.revision + 1
  return { success = true, frameNumber = f.frameNumber, revision = state.revision }
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
  local tag = spr:newTag(params.fromFrame, params.toFrame)
  if params.name then tag.name = params.name end
  state.revision = state.revision + 1
  return { success = true, tag = tag.name, revision = state.revision }
end

handlers.list_tags = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  local tags = {}
  for _, t in ipairs(spr.tags) do
    table.insert(tags, { name = t.name, from = t.fromFrame.frameNumber, to = t.toFrame.frameNumber })
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
  return { success = true, width = w, height = h, colorMode = params.colorMode or "rgb", revision = state.revision }
end

handlers.open_sprite = function(params)
  local spr = app.open(params.filePath)
  if not spr then error("Failed to open sprite: " .. tostring(params.filePath)) end
  app.sprite = spr
  state.revision = 1
  return { success = true, filename = spr.filename, revision = state.revision }
end

handlers.save_sprite = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  app.command.SaveFile()
  return { success = true, filename = spr.filename, message = "Saved sprite" }
end

handlers.save_sprite_as = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  spr:saveAs(params.filePath)
  return { success = true, filename = params.filePath, message = "Saved sprite as " .. params.filePath }
end

handlers.export_png = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  spr:saveCopyAs(params.outputPath)
  return { success = true, outputPath = params.outputPath }
end

handlers.resize_canvas = function(params)
  local spr = app.sprite
  if not spr then error("No active sprite.") end
  spr:resize(params.width, params.height)
  app.refresh()
  state.revision = state.revision + 1
  return { success = true, width = spr.width, height = spr.height, revision = state.revision }
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
        dlg:modify{ id = "status_lbl", text = "Connected (" .. PORT .. ")" }
        app.tip("Connected to MCP Server (127.0.0.1:" .. PORT .. ")", 3)

      elseif msgType == WebSocketMessageType.CLOSE then
        dlg:modify{ id = "status_lbl", text = "Disconnected (Reconnecting...)" }

      elseif msgType == WebSocketMessageType.ERROR then
        dlg:modify{ id = "status_lbl", text = "Error: " .. tostring(err) }

      elseif msgType == WebSocketMessageType.TEXT then
        local ok, req = pcall(json.decode, data)
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
          pcall(function() state.ws:sendText(json.encode(response)) end)
        elseif req.id then
          local response = {
            id = req.id,
            success = false,
            error = {
              code = "UNKNOWN_COMMAND",
              message = "Unknown command: " .. tostring(req.command)
            }
          }
          pcall(function() state.ws:sendText(json.encode(response)) end)
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

  dlg:label{ id = "status_lbl", label = "Status:", text = "Connecting..." }
  dlg:label{ id = "port_lbl", label = "Target:", text = WS_URL }
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
          state.ws:sendText(json.encode({
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
        state.ws:sendText(json.encode({
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
