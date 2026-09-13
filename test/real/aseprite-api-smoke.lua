-- Runs inside a real Aseprite process in batch mode.
local function check(condition, message)
  if not condition then error("ASEPRITE_REAL_SMOKE_FAILED: " .. message) end
end

local output = app.params["output"]
check(output and #output > 0, "missing --script-param output=<path>")

local sprite = Sprite(8, 8, ColorMode.RGB)
app.sprite = sprite
local base = sprite.layers[1]
base.name = "Base"

local frame2 = sprite:newEmptyFrame(2)
local image = Image(4, 4, ColorMode.RGB)
image:clear(app.pixelColor.rgba(0, 0, 0, 0))
image:putPixel(1, 1, app.pixelColor.rgba(255, 0, 0, 255))
local cel1 = sprite:newCel(base, 1, image, Point(2, 1))
local cel2 = sprite:newCel(base, frame2, cel1.image, Point(3, 2))
app.layer = base
app.frame = sprite.frames[1]
app.range:clear()
app.range.layers = { base }
app.range.frames = { 1, 2 }
check(app.command.LinkCels() ~= false, "LinkCels command was rejected")
app.range:clear()
cel2 = base:cel(frame2)
cel2.opacity = 192
check(cel1.image.id == cel2.image.id, "linked cels did not share an image id")
check(cel2.position.x == cel1.position.x and cel2.opacity == 192, "linked cel position/opacity contract failed")

local group = sprite:newGroup()
group.name = "Characters"
base.parent = group
local nested = sprite:newGroup()
nested.name = "Body"
nested.parent = group
check(base.parent == group and nested.parent == group, "nested group parenting failed")

local slice = sprite:newSlice(Rectangle(1, 1, 6, 6))
slice.name = "button"
slice.center = Rectangle(2, 2, 2, 2)
slice.pivot = Point(3, 4)
check(slice.center.width == 2 and slice.pivot.y == 4, "slice center/pivot failed")

sprite.selection:select(Rectangle(1, 1, 3, 3))
sprite.selection:subtract(Rectangle(2, 2, 1, 1))
check(not sprite.selection.isEmpty and not sprite.selection:contains(2, 2), "selection boolean operation failed")

local tag = sprite:newTag(1, 2)
tag.name = "bounce"
tag.aniDir = AniDir.PING_PONG_REVERSE
check(tag.aniDir == AniDir.PING_PONG_REVERSE, "tag direction failed")

base.blendMode = BlendMode.MULTIPLY
check(base.blendMode == BlendMode.MULTIPLY, "editable blend mode failed")

check(sprite.newTileset and app.pixelColor.tile and app.pixelColor.tileI and app.pixelColor.tileF, "tilemap API is unavailable")
local tileset = sprite:newTileset(Rectangle(0, 0, 2, 2), 2)
tileset.name = "terrain"
local tile = tileset:tile(1)
local tileImage = tile.image:clone()
tileImage:putPixel(0, 0, app.pixelColor.rgba(0, 255, 0, 255))
tile.image = tileImage
check(tile.image:getPixel(0, 0) == app.pixelColor.rgba(0, 255, 0, 255), "tile image write failed")

app.layer = base
app.frame = sprite.frames[1]
app.command.NewLayer{
  name = "Map",
  tilemap = true,
  gridBounds = Rectangle(0, 0, 2, 2),
  ask = false,
  top = true
}
local tilemapLayer = app.layer
local generatedTileset = tilemapLayer.tileset
tilemapLayer.tileset = tileset
if generatedTileset and generatedTileset ~= tileset then sprite:deleteTileset(generatedTileset) end
local tilemapImage = Image(4, 4, ColorMode.TILEMAP)
local encodedTile = app.pixelColor.tile(1, 0x80000000)
tilemapImage:putPixel(0, 0, encodedTile)
sprite:newCel(tilemapLayer, 1, tilemapImage, Point(0, 0))
check(app.pixelColor.tileI(encodedTile) == 1, "tile index decoding failed")
check((app.pixelColor.tileF(encodedTile) & 0x80000000) ~= 0, "tile flags decoding failed")

sprite.selection:deselect()
sprite:saveAs(output)
check(app.fs.isFile(output), "real Aseprite did not write the fixture")
print("ASEPRITE_REAL_SMOKE_OK " .. app.version .. " api=" .. tostring(app.apiVersion))
sprite:close()
