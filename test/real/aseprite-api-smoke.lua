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
local editableOk, editableValue = pcall(function() return base.isEditable end)
check(editableOk and editableValue ~= false, "Layer.isEditable contract failed")

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
tag.repeats = 0
check(tag.aniDir == AniDir.PING_PONG_REVERSE, "tag direction failed")
check(tag.repeats == 0, "tag repeats failed")

-- Exercise the real APIs used by the six timeline tools and by atomic batches.
local timeline = Sprite(4, 4, ColorMode.RGB)
app.sprite = timeline
local timelineLayer = timeline.layers[1]
timelineLayer.name = "Timeline"
local timelineFrame2 = timeline:newEmptyFrame(2)
local timelineFrame3 = timeline:newEmptyFrame(3)

local function solidImage(color)
  local result = Image(4, 4, ColorMode.RGB)
  result:clear(color)
  return result
end

local red = app.pixelColor.rgba(255, 0, 0, 255)
local green = app.pixelColor.rgba(0, 255, 0, 255)
local blue = app.pixelColor.rgba(0, 0, 255, 255)
local white = app.pixelColor.rgba(255, 255, 255, 255)
local timelineCel1 = timeline:newCel(timelineLayer, 1, solidImage(red), Point(0, 0))
timeline:newCel(timelineLayer, timelineFrame2, solidImage(green), Point(0, 0))
timeline:newCel(timelineLayer, timelineFrame3, solidImage(blue), Point(0, 0))

local copyLayer = timeline:newLayer()
copyLayer.name = "Copies"
local copiedCel = timeline:newCel(copyLayer, timelineFrame2, timelineCel1.image:clone(), Point(1, 1))
check(copiedCel.image.id ~= timelineCel1.image.id, "copy_cel clone remained linked")
check(copiedCel.image:getPixel(0, 0) == red and copiedCel.position.x == 1,
  "copy_cel image/position contract failed")
copiedCel.frame = timelineFrame3
check(copyLayer:cel(timelineFrame2) == nil and copyLayer:cel(timelineFrame3) ~= nil,
  "move_cel frame reassignment failed")

timeline.frames[1].duration = 0.1
timeline.frames[2].duration = 0.2
timeline.frames[3].duration = 0.3
local anchoredTimelineTag = timeline:newTag(1, 2)
anchoredTimelineTag.name = "anchored"
local originalDurations = { 0.1, 0.2, 0.3 }
local temporaryFrame = timeline:newEmptyFrame(4)
for _, layer in ipairs({ timelineLayer, copyLayer }) do
  local movingCel = layer:cel(timeline.frames[1])
  if movingCel then movingCel.frame = temporaryFrame end
  for frameNumber = 2, 3 do
    local shiftingCel = layer:cel(timeline.frames[frameNumber])
    if shiftingCel then shiftingCel.frame = timeline.frames[frameNumber - 1] end
  end
  local temporaryCel = layer:cel(temporaryFrame)
  if temporaryCel then temporaryCel.frame = timeline.frames[3] end
end
timeline.frames[1].duration = originalDurations[2]
timeline.frames[2].duration = originalDurations[3]
timeline.frames[3].duration = originalDurations[1]
timeline:deleteFrame(temporaryFrame)
check(timelineLayer:cel(1).image:getPixel(0, 0) == green, "move_frame did not shift frame 2 to frame 1")
check(timelineLayer:cel(2).image:getPixel(0, 0) == blue, "move_frame did not shift frame 3 to frame 2")
check(timelineLayer:cel(3).image:getPixel(0, 0) == red, "move_frame did not place source at destination")
check(math.abs(timeline.frames[1].duration - 0.2) < 0.001 and math.abs(timeline.frames[3].duration - 0.1) < 0.001,
  "move_frame duration reorder failed")
check(anchoredTimelineTag.fromFrame.frameNumber == 1 and anchoredTimelineTag.toFrame.frameNumber == 2,
  "move_frame changed numeric tag anchors")

app.transaction("real smoke set frame durations", function()
  timeline.frames[1].duration = 0.12
  timeline.frames[2].duration = 0.24
  timeline.frames[3].duration = 0.36
end)
check(math.abs(timeline.frames[2].duration - 0.24) < 0.001, "set_frame_durations failed")

local timelineTag = timeline:newTag(1, 2)
timelineTag.name = "walk"
timelineTag.aniDir = AniDir.FORWARD
timelineTag.repeats = 1
timeline:deleteTag(timelineTag)
timelineTag = timeline:newTag(1, 3)
timelineTag.name = "walk_updated"
timelineTag.aniDir = AniDir.PING_PONG
timelineTag.repeats = 2
check(timelineTag.name == "walk_updated" and timelineTag.toFrame.frameNumber == 3
  and timelineTag.aniDir == AniDir.PING_PONG and timelineTag.repeats == 2,
  "update_tag recreate contract failed")
timeline:deleteTag(timelineTag)
timeline:deleteTag(anchoredTimelineTag)
check(#timeline.tags == 0, "delete_tag failed")

app.layer = timelineLayer
app.frame = timeline.frames[1]
local atomicCel = timelineLayer:cel(timeline.frames[1])
local beforeAtomicPixel = atomicCel.image:getPixel(0, 0)
local beforeAtomicDuration = timeline.frames[1].duration
local beforeAtomicOpacity = atomicCel.opacity
app.transaction("real smoke atomic batch", function()
  local changedImage = atomicCel.image:clone()
  changedImage:putPixel(0, 0, white)
  atomicCel.image = changedImage
  atomicCel.opacity = 111
  timeline.frames[1].duration = 0.45
end)
check(timelineLayer:cel(1).image:getPixel(0, 0) == white
  and timelineLayer:cel(1).opacity == 111
  and math.abs(timeline.frames[1].duration - 0.45) < 0.001,
  "atomic transaction did not apply every operation")
app.undo()
atomicCel = timelineLayer:cel(timeline.frames[1])
check(atomicCel.image:getPixel(0, 0) == beforeAtomicPixel
  and atomicCel.opacity == beforeAtomicOpacity
  and math.abs(timeline.frames[1].duration - beforeAtomicDuration) < 0.001,
  "single undo did not roll back the complete atomic transaction")
app.redo()
atomicCel = timelineLayer:cel(timeline.frames[1])
check(atomicCel.image:getPixel(0, 0) == white
  and atomicCel.opacity == 111
  and math.abs(timeline.frames[1].duration - 0.45) < 0.001,
  "single redo did not restore the complete atomic transaction")

timeline:close()
app.sprite = sprite

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
local apngOutput = output .. ".apng"
os.remove(apngOutput)
pcall(function() return sprite:saveCopyAs(apngOutput) end)
check(not app.fs.isFile(apngOutput),
  "pinned Aseprite build unexpectedly exported APNG; revisit export_animation support and validation")
sprite:saveAs(output)
check(app.fs.isFile(output), "real Aseprite did not write the fixture")
local referenceOutput = output .. ".png"
local referenceImage = Image(sprite.spec)
referenceImage:clear(app.pixelColor.rgba(0, 0, 0, 0))
referenceImage:drawSprite(sprite, 1, Point(0, 0))
referenceImage:saveAs(referenceOutput)
check(app.fs.isFile(referenceOutput), "real Aseprite did not write the reference PNG")
local loadedReference = Image{ fromFile = referenceOutput }
check(loadedReference and loadedReference.width == sprite.width and loadedReference.height == sprite.height,
  "Image{ fromFile=... } reference loading contract failed")
os.remove(referenceOutput)

local gifOutput = output .. ".gif"
local originalSprite = sprite
local originalFrame = sprite.frames[1]
local originalLayer = base
local preview = Sprite(sprite.width, sprite.height, ColorMode.RGB)
local previewLayer = preview.layers[1]
for sequenceIndex, sourceFrameNumber in ipairs({ 1, 2, 1 }) do
  local targetFrame = sequenceIndex == 1 and preview.frames[1] or preview:newEmptyFrame(sequenceIndex)
  local flattened = Image(ImageSpec{ width = sprite.width, height = sprite.height, colorMode = ColorMode.RGB, transparentColor = 0 })
  flattened:clear(app.pixelColor.rgba(0, 0, 0, 0))
  flattened:drawSprite(sprite, sourceFrameNumber, Point(0, 0))
  local existingCel = previewLayer:cel(targetFrame)
  if existingCel then existingCel.image = flattened
  else preview:newCel(previewLayer, targetFrame, flattened, Point(0, 0)) end
  targetFrame.duration = sprite.frames[sourceFrameNumber].duration
end
local gifPreferences = app.preferences.gif
local originalGifShowAlert = gifPreferences.show_alert
local originalGifLoop = gifPreferences.loop
gifPreferences.show_alert = false
gifPreferences.loop = true
local gifSaved, gifSaveError = pcall(function() preview:saveAs(gifOutput) end)
gifPreferences.show_alert = originalGifShowAlert
gifPreferences.loop = originalGifLoop
check(gifSaved, "real Aseprite GIF save failed: " .. tostring(gifSaveError))
check(app.fs.isFile(gifOutput), "real Aseprite did not write the animation GIF")
preview:close()
app.sprite = originalSprite
app.frame = originalFrame
app.layer = originalLayer
check(app.sprite == originalSprite and app.frame == originalFrame and app.layer == originalLayer,
  "animation preview did not restore the original sprite/frame/layer")
check(gifPreferences.show_alert == originalGifShowAlert and gifPreferences.loop == originalGifLoop,
  "animation preview did not restore GIF preferences")
os.remove(gifOutput)
print("ASEPRITE_REAL_SMOKE_OK " .. tostring(app.version) .. " api=" .. tostring(app.apiVersion))
sprite:close()
