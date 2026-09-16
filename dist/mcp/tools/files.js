// src/mcp/tools/files.ts
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { validateOpenPath, validateSaveAsPath, validateExportPngPath, getAllowedRoots, resolveProjectRoot, validateDirectoryPath, validateReferencePath, isPathWithinRoots, ALLOWED_SAVE_EXTENSIONS, ALLOWED_PROJECT_EXTENSIONS, ALLOWED_REFERENCE_EXTENSIONS, } from "../../security/fileAccess.js";
import { decodePngBase64Sync, decodePngBufferSync } from "../../image/png.js";
import { analyzeImagePalette } from "../../image/pixelArt.js";
import { resolveAnimationPlayback, } from "../animationSelection.js";
import { bridgeToolResult } from "./common.js";
const MAX_REFERENCE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_REFERENCE_DIMENSION = 4096;
const MAX_REFERENCE_PIXELS = 16_777_216;
const MAX_REFERENCE_SCAN_ENTRIES = 10_000;
const MAX_ANIMATION_EXPORT_FRAMES = 256;
function normalizeTagName(tagName, tag) {
    if (tagName && tag && tagName !== tag) {
        throw new Error("tag and tagName must match when both are provided.");
    }
    return tagName ?? tag;
}
function validateReferenceDimensions(width, height) {
    if (width < 1 || height < 1
        || width > MAX_REFERENCE_DIMENSION || height > MAX_REFERENCE_DIMENSION
        || width * height > MAX_REFERENCE_PIXELS) {
        throw new Error(`Reference image dimensions ${width}x${height} exceed the ${MAX_REFERENCE_DIMENSION}px / ${MAX_REFERENCE_PIXELS.toLocaleString()} pixel limit.`);
    }
    return { width, height };
}
function validatePngHeader(buffer) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature) || buffer.toString("ascii", 12, 16) !== "IHDR") {
        throw new Error("Reference PNG has an invalid signature or IHDR header.");
    }
    return validateReferenceDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
}
function validateJpegHeader(buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        throw new Error("Reference JPEG has an invalid start-of-image marker.");
    }
    const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset < buffer.length) {
        while (offset < buffer.length && buffer[offset] !== 0xff)
            offset++;
        while (offset < buffer.length && buffer[offset] === 0xff)
            offset++;
        if (offset >= buffer.length)
            break;
        const marker = buffer[offset++];
        if (marker === 0xd9 || marker === 0xda)
            break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7))
            continue;
        if (offset + 2 > buffer.length)
            break;
        const segmentLength = buffer.readUInt16BE(offset);
        if (segmentLength < 2 || offset + segmentLength > buffer.length) {
            throw new Error("Reference JPEG contains an invalid marker length.");
        }
        if (startOfFrameMarkers.has(marker)) {
            if (segmentLength < 7)
                throw new Error("Reference JPEG has a truncated frame header.");
            return validateReferenceDimensions(buffer.readUInt16BE(offset + 3), buffer.readUInt16BE(offset + 5));
        }
        offset += segmentLength;
    }
    throw new Error("Reference JPEG does not contain a supported frame header.");
}
function readUInt24LE(buffer, offset) {
    return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}
function validateWebpHeader(buffer) {
    if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
        throw new Error("Reference WebP has an invalid RIFF/WEBP header.");
    }
    let offset = 12;
    while (offset + 8 <= buffer.length) {
        const chunkType = buffer.toString("ascii", offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        const dataOffset = offset + 8;
        if (dataOffset + chunkSize > buffer.length)
            throw new Error("Reference WebP contains a truncated chunk.");
        if (chunkType === "VP8X") {
            if (chunkSize < 10)
                throw new Error("Reference WebP has a truncated VP8X header.");
            return validateReferenceDimensions(readUInt24LE(buffer, dataOffset + 4) + 1, readUInt24LE(buffer, dataOffset + 7) + 1);
        }
        if (chunkType === "VP8L") {
            if (chunkSize < 5 || buffer[dataOffset] !== 0x2f)
                throw new Error("Reference WebP has an invalid VP8L header.");
            const b1 = buffer[dataOffset + 1];
            const b2 = buffer[dataOffset + 2];
            const b3 = buffer[dataOffset + 3];
            const b4 = buffer[dataOffset + 4];
            const width = 1 + (((b2 & 0x3f) << 8) | b1);
            const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
            return validateReferenceDimensions(width, height);
        }
        if (chunkType === "VP8 ") {
            if (chunkSize < 10
                || buffer[dataOffset + 3] !== 0x9d
                || buffer[dataOffset + 4] !== 0x01
                || buffer[dataOffset + 5] !== 0x2a) {
                throw new Error("Reference WebP has an invalid VP8 frame header.");
            }
            return validateReferenceDimensions(buffer.readUInt16LE(dataOffset + 6) & 0x3fff, buffer.readUInt16LE(dataOffset + 8) & 0x3fff);
        }
        offset = dataOffset + chunkSize + (chunkSize % 2);
    }
    throw new Error("Reference WebP does not contain a supported image chunk.");
}
function validateReferenceHeader(buffer, extension) {
    if (extension === ".png")
        return validatePngHeader(buffer);
    if (extension === ".jpg" || extension === ".jpeg")
        return validateJpegHeader(buffer);
    if (extension === ".webp")
        return validateWebpHeader(buffer);
    throw new Error(`Unsupported reference image extension '${extension}'.`);
}
function requireBaseName(fileName) {
    const trimmed = fileName.trim();
    if (!trimmed || /[\\/]/.test(trimmed) || path.basename(trimmed) !== trimmed || trimmed === "." || trimmed === "..") {
        throw new Error("fileName must be a plain file name without directory components.");
    }
    if (/[<>:"|?*\u0000-\u001F]/.test(trimmed) || /[. ]$/.test(trimmed)) {
        throw new Error("fileName contains characters that are unsafe or invalid on supported platforms.");
    }
    return trimmed;
}
function resolveReferenceInput(params) {
    const roots = getAllowedRoots();
    const projectRoot = resolveProjectRoot(undefined, roots);
    if (params.filePath) {
        if (params.directory || params.fileName) {
            throw new Error("filePath is mutually exclusive with directory/fileName.");
        }
        return validateReferencePath(params.filePath, roots, true, projectRoot);
    }
    if (!params.fileName)
        throw new Error("Provide filePath or fileName.");
    const fileName = requireBaseName(params.fileName);
    const directory = params.directory
        ? validateDirectoryPath(params.directory, roots, true, projectRoot)
        : projectRoot;
    return validateReferencePath(path.join(directory, fileName), roots, false, projectRoot);
}
function alphaSummary(image) {
    let transparentPixels = 0;
    let translucentPixels = 0;
    for (let offset = 3; offset < image.data.length; offset += 4) {
        const alpha = image.data[offset];
        if (alpha === 0)
            transparentPixels++;
        else if (alpha < 255)
            translucentPixels++;
    }
    return { hasTransparency: transparentPixels + translucentPixels > 0, transparentPixels, translucentPixels };
}
function slug(value) {
    const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}
function requireFileStem(value) {
    const stem = requireBaseName(value);
    if (path.extname(stem) !== "")
        throw new Error("baseName must not include a file extension.");
    return stem;
}
export function registerFileTools(server, dispatcher, stateTracker, workflowState, approvalState) {
    // 1. new_sprite
    server.tool("new_sprite", "Creates a new blank sprite document in Aseprite with specified dimensions and color mode.", {
        width: z.number().int().positive().max(4096).default(32).describe("Canvas width in pixels"),
        height: z.number().int().positive().max(4096).default(32).describe("Canvas height in pixels"),
        colorMode: z.enum(["rgb", "grayscale", "indexed"]).optional().default("rgb").describe("Color mode"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("new_sprite", params, 10000);
            if (typeof res.revision === "number") {
                stateTracker.setRevision(res.revision);
            }
            return bridgeToolResult({ ...res, message: `Created new ${res.width}x${res.height} ${res.colorMode ?? "rgb"} sprite` }, stateTracker, params.returnPreview);
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    // 2. open_sprite
    server.tool("open_sprite", "Opens an existing sprite file (.ase, .aseprite, .png) from disk. Accepts relative (project-root based) or absolute path.", {
        filePath: z.string().describe("File path to open in Aseprite (relative to project root or absolute)"),
    }, async (params) => {
        try {
            const canonicalPath = validateOpenPath(params.filePath, undefined, true);
            const res = await dispatcher.send("open_sprite", { filePath: canonicalPath }, 15000);
            if (typeof res.revision === "number") {
                stateTracker.setRevision(res.revision);
            }
            return {
                content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    // 3. save_sprite
    server.tool("save_sprite", "Explicitly saves the active sprite to disk. (Saves only when explicitly requested).", {}, async () => {
        try {
            const status = await dispatcher.send("aseprite_status", {}, 5000);
            if (!status || !status.filename || typeof status.filename !== "string" || status.filename.trim() === "") {
                throw new Error("Cannot save sprite: active sprite has no filename (use save_sprite_as first).");
            }
            const canonicalPath = validateOpenPath(status.filename);
            const res = await dispatcher.send("save_sprite", { expectedFilePath: canonicalPath }, 15000);
            return {
                content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    // 4. save_sprite_as
    server.tool("save_sprite_as", "Saves the active sprite to a specific target file path on disk. Accepts relative (project-root based) or absolute path.", {
        filePath: z.string().describe("Target file path (.aseprite, .ase, or .png; relative or absolute)"),
        overwrite: z.boolean().optional().default(false).describe("Whether to overwrite existing target file"),
    }, async (params) => {
        try {
            const canonicalPath = validateSaveAsPath(params.filePath, params.overwrite ?? false, ALLOWED_SAVE_EXTENSIONS, undefined, true);
            const res = await dispatcher.send("save_sprite_as", { filePath: canonicalPath, overwrite: params.overwrite ?? false }, 15000);
            return {
                content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    server.tool("save_project", "Safely saves the active document as an .aseprite project using an exact supplied file name or a deterministic descriptive name.", {
        filePath: z.string().optional().describe("Complete .aseprite target path, absolute or relative to ASEPRITE_PROJECT_ROOT"),
        directory: z.string().optional().describe("Target directory, absolute or relative to ASEPRITE_PROJECT_ROOT"),
        fileName: z.string().optional().describe("Exact .aseprite file name; never rewritten"),
        filename: z.string().optional().describe("Alias for fileName; do not provide both"),
        assetName: z.string().max(120).optional().describe("Asset name used only when fileName is omitted"),
        animationName: z.string().max(120).optional().describe("Animation/action name used only when fileName is omitted"),
        overwrite: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            if (params.fileName && params.filename && params.fileName !== params.filename) {
                throw new Error("filename and fileName must match when both are provided.");
            }
            const exactFileName = params.fileName ?? params.filename;
            if (params.filePath && (params.directory || exactFileName)) {
                throw new Error("filePath is mutually exclusive with directory/fileName.");
            }
            if (exactFileName && params.assetName)
                throw new Error("assetName is only used when fileName is omitted.");
            if (exactFileName && params.animationName)
                throw new Error("animationName is only used when fileName is omitted.");
            const roots = getAllowedRoots();
            const projectRoot = resolveProjectRoot(undefined, roots);
            let targetPath;
            let generatedFileName = false;
            if (params.filePath) {
                targetPath = params.filePath;
            }
            else {
                const directory = validateDirectoryPath(params.directory ?? projectRoot, roots, true, projectRoot);
                let fileName = exactFileName;
                if (fileName) {
                    fileName = requireBaseName(fileName);
                    if (path.extname(fileName).toLowerCase() !== ".aseprite") {
                        throw new Error("fileName must end exactly in .aseprite.");
                    }
                }
                else {
                    const [status, tagResult] = await Promise.all([
                        dispatcher.send("aseprite_status", {}, 5_000),
                        dispatcher.send("list_tags", {}, 5_000),
                    ]);
                    const currentStem = status?.filename
                        ? path.basename(String(status.filename), path.extname(String(status.filename)))
                        : "";
                    const firstTag = Array.isArray(tagResult?.tags) && tagResult.tags.length > 0
                        ? String(tagResult.tags[0]?.name ?? "")
                        : "";
                    const asset = slug(params.assetName ?? currentStem) || "sprite";
                    const animation = slug(params.animationName ?? firstTag) || "animation";
                    fileName = `${asset}_${animation}.aseprite`;
                    generatedFileName = true;
                }
                targetPath = path.join(directory, fileName);
            }
            const canonicalPath = validateSaveAsPath(targetPath, params.overwrite ?? false, ALLOWED_PROJECT_EXTENSIONS, roots, true, projectRoot);
            const result = await dispatcher.send("save_sprite_as", {
                filePath: canonicalPath,
                overwrite: params.overwrite ?? false,
            }, 15_000);
            return { content: [{ type: "text", text: JSON.stringify({
                            ...result,
                            filePath: canonicalPath,
                            fileName: path.basename(canonicalPath),
                            generatedFileName,
                        }, null, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: error.message }, null, 2) }], isError: true };
        }
    });
    // 5. export_png
    server.tool("export_png", "Exports the active sprite or frame to a PNG image file on disk. Accepts relative or absolute path.", {
        outputPath: z.string().describe("Target .png file path (relative or absolute)"),
        frameNumber: z.number().int().positive().optional().describe("Specific frame number to export"),
        scale: z.number().int().min(1).max(32).optional().default(1).describe("Nearest-neighbor export scale factor"),
        overwrite: z.boolean().optional().default(false).describe("Whether to overwrite existing target file"),
    }, async (params) => {
        try {
            const canonicalPath = validateExportPngPath(params.outputPath, params.overwrite ?? false, undefined, true);
            const res = await dispatcher.send("export_png", {
                ...params,
                outputPath: canonicalPath,
                overwrite: params.overwrite ?? false,
            }, 15000);
            return {
                content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    // 6. resize_canvas
    server.tool("resize_canvas", "Resizes the active sprite canvas dimensions without interpolation or blurring.", {
        width: z.number().int().positive().max(4096).describe("New canvas width"),
        height: z.number().int().positive().max(4096).describe("New canvas height"),
        anchor: z.enum(["top_left", "center", "top_right", "bottom_left", "bottom_right"]).optional().default("top_left").describe("Anchor point for resizing"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("resize_canvas", params, 10000);
            if (typeof res.revision === "number") {
                stateTracker.setRevision(res.revision);
            }
            return bridgeToolResult(res, stateTracker, params.returnPreview);
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    // 7. export_sprite_sheet
    server.tool("export_sprite_sheet", "Exports a tag or explicit frame range as a horizontal, vertical, or grid PNG sheet, optionally compositing only selected non-group layers.", {
        outputPath: z.string().describe("Target .png file path (relative or absolute)"),
        fromFrame: z.number().int().positive().optional(),
        toFrame: z.number().int().positive().optional(),
        tagName: z.string().optional().describe("Animation tag to export; mutually exclusive with fromFrame/toFrame"),
        tag: z.string().optional().describe("Alias for tagName; do not provide both"),
        layerNames: z.array(z.string()).min(1).max(64).optional().describe("Optional non-group layers to composite"),
        layout: z.enum(["horizontal", "vertical", "grid"]).optional().default("horizontal"),
        columns: z.number().int().min(1).max(64).optional().describe("Grid columns; required only to override automatic grid layout"),
        spacing: z.number().int().min(0).max(64).optional().default(0).describe("Transparent pixels between frames"),
        scale: z.number().int().min(1).max(32).optional().default(1),
        overwrite: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const tagName = normalizeTagName(params.tagName, params.tag);
            if (tagName && (params.fromFrame !== undefined || params.toFrame !== undefined)) {
                throw new Error("tagName is mutually exclusive with fromFrame/toFrame.");
            }
            if ((params.fromFrame === undefined) !== (params.toFrame === undefined)) {
                throw new Error("fromFrame and toFrame must be provided together.");
            }
            if (params.fromFrame !== undefined && params.toFrame !== undefined && params.fromFrame > params.toFrame) {
                throw new Error("fromFrame must be less than or equal to toFrame.");
            }
            const canonicalPath = validateExportPngPath(params.outputPath, params.overwrite ?? false, undefined, true);
            const result = await dispatcher.send("export_sprite_sheet", {
                ...params,
                tag: undefined,
                tagName,
                outputPath: canonicalPath,
                overwrite: params.overwrite ?? false,
            }, 30_000);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: error.message }, null, 2) }], isError: true };
        }
    });
    server.tool("find_reference_images", "Finds static reference images only inside an authorized directory or the configured project root. It never scans outside allowed roots.", {
        directory: z.string().optional().describe("Authorized directory, absolute or relative to ASEPRITE_PROJECT_ROOT"),
        fileName: z.string().optional().describe("Optional exact file name to match"),
        recursive: z.boolean().optional().default(true),
        maxDepth: z.number().int().min(0).max(16).optional().default(8),
        maxResults: z.number().int().min(1).max(200).optional().default(100),
    }, async (params) => {
        try {
            const roots = getAllowedRoots();
            const projectRoot = resolveProjectRoot(undefined, roots);
            const searchDirectory = validateDirectoryPath(params.directory ?? projectRoot, roots, true, projectRoot);
            const exactName = params.fileName ? requireBaseName(params.fileName) : undefined;
            const recursive = params.recursive ?? true;
            const maxDepth = params.maxDepth ?? 8;
            const maxResults = params.maxResults ?? 100;
            const images = [];
            const skipped = [];
            let scannedEntries = 0;
            let truncated = false;
            const matchesName = (candidate) => {
                if (!exactName)
                    return true;
                return process.platform === "win32"
                    ? candidate.toLowerCase() === exactName.toLowerCase()
                    : candidate === exactName;
            };
            const scan = (directory, depth) => {
                if (truncated)
                    return;
                let canonicalDirectory;
                let entries;
                try {
                    canonicalDirectory = validateDirectoryPath(directory, roots, false, projectRoot);
                    if (!isPathWithinRoots(canonicalDirectory, [searchDirectory])) {
                        skipped.push({ path: directory, error: "directory resolves outside the requested search tree" });
                        return;
                    }
                    entries = fs.readdirSync(canonicalDirectory, { withFileTypes: true })
                        .sort((left, right) => left.name.localeCompare(right.name));
                }
                catch (error) {
                    skipped.push({ path: directory, error: error.message });
                    return;
                }
                for (const entry of entries) {
                    scannedEntries++;
                    if (scannedEntries > MAX_REFERENCE_SCAN_ENTRIES || images.length >= maxResults) {
                        truncated = true;
                        return;
                    }
                    const candidate = path.join(canonicalDirectory, entry.name);
                    if (entry.isSymbolicLink()) {
                        skipped.push({ path: candidate, error: "symbolic links are not traversed" });
                        continue;
                    }
                    if (entry.isDirectory()) {
                        if (recursive && depth < maxDepth)
                            scan(candidate, depth + 1);
                        continue;
                    }
                    if (!entry.isFile() || !matchesName(entry.name))
                        continue;
                    const extension = path.extname(entry.name).toLowerCase();
                    if (!ALLOWED_REFERENCE_EXTENSIONS.includes(extension))
                        continue;
                    try {
                        const canonical = validateReferencePath(candidate, roots, false, projectRoot);
                        if (!isPathWithinRoots(canonical, [searchDirectory])) {
                            throw new Error("Reference resolves outside the requested search tree.");
                        }
                        const fileStat = fs.statSync(canonical);
                        images.push({
                            fileName: entry.name,
                            absolutePath: canonical,
                            projectRelativePath: isPathWithinRoots(canonical, [projectRoot])
                                ? path.relative(projectRoot, canonical).replace(/\\/g, "/")
                                : null,
                            relativeToSearchDirectory: path.relative(searchDirectory, canonical).replace(/\\/g, "/"),
                            format: extension.slice(1),
                            sizeBytes: fileStat.size,
                        });
                    }
                    catch (error) {
                        skipped.push({ path: candidate, error: error.message });
                    }
                }
            };
            scan(searchDirectory, 0);
            return { content: [{ type: "text", text: JSON.stringify({
                            projectRoot,
                            searchDirectory,
                            exactFileName: exactName ?? null,
                            count: images.length,
                            scannedEntries: Math.min(scannedEntries, MAX_REFERENCE_SCAN_ENTRIES),
                            truncated,
                            images,
                            skipped: skipped.slice(0, 50),
                            skippedTruncated: skipped.length > 50,
                        }, null, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: error.message }, null, 2) }], isError: true };
        }
    });
    server.tool("load_reference_image", "Loads and analyzes a local reference image without switching or modifying the active Aseprite sprite.", {
        filePath: z.string().optional().describe("Absolute path or path relative to ASEPRITE_PROJECT_ROOT"),
        directory: z.string().optional().describe("Directory used with fileName"),
        fileName: z.string().optional().describe("Plain file name used with directory or the project root"),
        nearDuplicateThreshold: z.number().min(0.1).max(20).optional().default(3),
    }, async (params) => {
        try {
            const canonicalPath = resolveReferenceInput(params);
            const sourceStat = await fs.promises.stat(canonicalPath);
            if (sourceStat.size > MAX_REFERENCE_FILE_BYTES) {
                throw new Error(`Reference image exceeds the ${MAX_REFERENCE_FILE_BYTES} byte limit.`);
            }
            const source = await fs.promises.readFile(canonicalPath);
            const extension = path.extname(canonicalPath).toLowerCase();
            const sourceDimensions = validateReferenceHeader(source, extension);
            let image;
            let pngBase64;
            if (extension === ".png") {
                image = decodePngBufferSync(source);
                pngBase64 = source.toString("base64");
            }
            else {
                if (!stateTracker.getCapabilities().referenceImageDecode) {
                    throw new Error("The connected Aseprite bridge cannot decode JPEG/WebP references. Reinstall the bundled Lua bridge or use PNG.");
                }
                const result = await dispatcher.send("load_reference_image", { filePath: canonicalPath }, 15_000);
                if (!result || typeof result.pngBase64 !== "string" || result.pngBase64.length === 0) {
                    throw new Error("Aseprite bridge did not return a PNG rendering for the reference image.");
                }
                pngBase64 = result.pngBase64;
                const renderedPng = Buffer.from(result.pngBase64, "base64");
                validatePngHeader(renderedPng);
                image = decodePngBase64Sync(result.pngBase64);
            }
            const roots = getAllowedRoots();
            const projectRoot = resolveProjectRoot(undefined, roots);
            const transparency = alphaSummary(image);
            const palette = analyzeImagePalette(image, params.nearDuplicateThreshold ?? 3);
            const referenceId = createHash("sha256").update(source).digest("hex");
            const hash = referenceId;
            const observedPalette = Array.isArray(palette.colors)
                ? palette.colors.map((c) => c.hex)
                : [];
            const sessionId = typeof stateTracker?.getSessionId === "function" ? stateTracker.getSessionId() : null;
            const isConnected = typeof stateTracker?.isConnected === "function" ? stateTracker.isConnected() : false;
            const hasActiveSession = isConnected && Boolean(sessionId && sessionId !== "default");
            if (hasActiveSession && sessionId && workflowState) {
                workflowState.registerLoadedReference({
                    referenceId,
                    hash,
                    filePath: canonicalPath,
                    fileName: path.basename(canonicalPath),
                    projectRelativePath: isPathWithinRoots(canonicalPath, [projectRoot])
                        ? path.relative(projectRoot, canonicalPath).replace(/\\/g, "/")
                        : null,
                    sourceFormat: extension.slice(1),
                    dimensions: { width: image.width, height: image.height },
                    sourceDimensions,
                    transparency,
                    observedPalette,
                    palette,
                    sessionId,
                    recordedAt: new Date().toISOString(),
                });
            }
            return { content: [
                    { type: "image", data: pngBase64, mimeType: "image/png" },
                    { type: "text", text: JSON.stringify({
                            referenceId,
                            hash,
                            fileName: path.basename(canonicalPath),
                            filePath: canonicalPath,
                            projectRelativePath: isPathWithinRoots(canonicalPath, [projectRoot])
                                ? path.relative(projectRoot, canonicalPath).replace(/\\/g, "/")
                                : null,
                            sourceFormat: extension.slice(1),
                            width: image.width,
                            height: image.height,
                            sourceDimensions,
                            transparency,
                            ...transparency,
                            observedPalette,
                            palette,
                            recordedInWorkflow: hasActiveSession && Boolean(workflowState),
                        }, null, 2) },
                ] };
        }
        catch (error) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: error.message }, null, 2) }], isError: true };
        }
    });
    server.tool("export_animation", "Exports a selected animation as a GIF, sprite sheet, PNG sequence, or single PNG. APNG is reported as unsupported unless a future bridge implements it.", {
        format: z.enum(["gif", "sprite_sheet", "png_sequence", "png", "apng"]),
        outputPath: z.string().optional().describe("Target file for GIF, sprite_sheet, PNG, or APNG; relative to project root or absolute"),
        outputDirectory: z.string().optional().describe("Existing target directory for png_sequence"),
        baseName: z.string().min(1).max(120).optional().describe("PNG-sequence file stem without extension"),
        tagName: z.string().min(1).max(128).optional(),
        tag: z.string().min(1).max(128).optional().describe("Alias for tagName; do not provide both"),
        fromFrame: z.number().int().positive().optional(),
        toFrame: z.number().int().positive().optional(),
        direction: z.enum(["forward", "reverse", "pingpong", "pingpong_reverse"]).optional(),
        scale: z.number().int().min(1).max(8).optional().default(1),
        loop: z.boolean().optional().describe("GIF loop override; defaults to the selected tag repeat setting"),
        layout: z.enum(["horizontal", "vertical", "grid"]).optional().default("horizontal"),
        columns: z.number().int().min(1).max(64).optional(),
        spacing: z.number().int().min(0).max(64).optional().default(0),
        overwrite: z.boolean().optional().default(false),
        final: z.boolean().optional().default(false).describe("Whether this export represents final delivery gated by animation workflow completion"),
        strictWorkflowValidation: z.boolean().optional().default(false).describe("Whether strict workflow validation is enforced"),
        humanApprovalId: z.string().uuid().optional().describe("Approved receipt returned by request_human_approval; required for final exports"),
    }, async (params) => {
        try {
            const tagName = normalizeTagName(params.tagName, params.tag);
            if (params.format === "apng") {
                throw new Error("APNG export is not supported by the current Aseprite bridge. Use GIF or PNG sequence.");
            }
            const isFinal = Boolean(params.final);
            const isStrict = Boolean(params.strictWorkflowValidation);
            const activeWorkflow = workflowState?.getWorkflow() ?? null;
            const gateRequired = isFinal && (isStrict || Boolean(activeWorkflow?.strictCompletionRequired));
            let completionEvidence;
            if (gateRequired) {
                if (!workflowState || !activeWorkflow) {
                    const currentRevision = workflowState ? workflowState.getRevision() : stateTracker.getRevision();
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: false,
                                    code: "WORKFLOW_COMPLETION_REQUIRED",
                                    error: "Final export requires an active animation workflow and completion verification.",
                                    currentRevision,
                                    failedGates: [{ name: "workflowExists", message: "No active animation workflow." }],
                                    failedGateNames: ["workflowExists"],
                                    unresolvedCounts: { critical: 0, high: 0, medium: 0, low: 0 },
                                }, null, 2),
                            },
                        ],
                        isError: true,
                    };
                }
                const validation = workflowState.validateCompletion();
                if (!validation.isComplete) {
                    const failedGates = Object.entries(validation.gates)
                        .filter(([_, g]) => !g.passed)
                        .map(([name, g]) => ({ name, message: g.message }));
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: false,
                                    code: "WORKFLOW_COMPLETION_REQUIRED",
                                    error: "Final export blocked: animation workflow completion criteria not met.",
                                    currentRevision: validation.currentRevision,
                                    failedGates,
                                    failedGateNames: failedGates.map((g) => g.name),
                                    unresolvedCounts: validation.unresolvedFindings,
                                }, null, 2),
                            },
                        ],
                        isError: true,
                    };
                }
                const evidence = workflowState.getCompletionEvidence();
                if (!evidence) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: false,
                                    code: "WORKFLOW_COMPLETION_REQUIRED",
                                    error: "Final export blocked: current completion evidence is unavailable.",
                                    currentRevision: validation.currentRevision,
                                    failedGates: [{ name: "completionEvidence", message: "Current completion evidence is unavailable." }],
                                    failedGateNames: ["completionEvidence"],
                                    unresolvedCounts: validation.unresolvedFindings,
                                }, null, 2),
                            },
                        ],
                        isError: true,
                    };
                }
                completionEvidence = evidence;
            }
            if (isFinal && !approvalState) {
                throw new Error("Final export approval gate is unavailable; restart the MCP server with the bundled tools.");
            }
            const humanApproval = isFinal
                ? approvalState.validate(params.humanApprovalId, stateTracker.getSessionId(), stateTracker.getRevision())
                : undefined;
            const capabilities = stateTracker.getCapabilities();
            if (!capabilities.animationInspection) {
                throw new Error("The connected Aseprite bridge cannot inspect animations. Reinstall the bundled Lua bridge.");
            }
            const inspection = await dispatcher.send("inspect_animation", {}, 10_000);
            if (typeof inspection.revision === "number")
                stateTracker.setRevision(inspection.revision);
            const playback = resolveAnimationPlayback(inspection, { ...params, tagName });
            if (playback.frameNumbers.length > MAX_ANIMATION_EXPORT_FRAMES) {
                throw new Error(`Animation export is limited to ${MAX_ANIMATION_EXPORT_FRAMES} playback frames.`);
            }
            const roots = getAllowedRoots();
            const projectRoot = resolveProjectRoot(undefined, roots);
            const overwrite = params.overwrite ?? false;
            const scale = params.scale ?? 1;
            if (params.format === "png_sequence") {
                if (params.outputPath)
                    throw new Error("png_sequence uses outputDirectory/baseName, not outputPath.");
                const outputDirectory = validateDirectoryPath(params.outputDirectory ?? projectRoot, roots, true, projectRoot);
                const baseName = params.baseName
                    ? requireFileStem(params.baseName)
                    : slug(playback.tagName ?? "animation") || "animation";
                const digits = Math.max(4, String(playback.frameNumbers.length).length);
                const targets = playback.frameNumbers.map((sourceFrame, index) => {
                    const fileName = `${baseName}_${String(index + 1).padStart(digits, "0")}.png`;
                    const outputPath = validateExportPngPath(path.join(outputDirectory, fileName), overwrite, roots);
                    return { sequenceIndex: index + 1, sourceFrame, fileName, outputPath };
                });
                const completed = [];
                try {
                    for (const target of targets) {
                        await dispatcher.send("export_png", {
                            outputPath: target.outputPath,
                            frameNumber: target.sourceFrame,
                            scale,
                            overwrite,
                        }, 15_000);
                        completed.push(target);
                    }
                }
                catch (error) {
                    if (!overwrite) {
                        await Promise.all(completed.map(async (target) => {
                            try {
                                await fs.promises.unlink(target.outputPath);
                            }
                            catch { /* best-effort rollback */ }
                        }));
                    }
                    throw error;
                }
                return { content: [{ type: "text", text: JSON.stringify({
                                success: true,
                                format: params.format,
                                outputDirectory,
                                baseName,
                                files: targets,
                                playback,
                                scale,
                                overwrite,
                                ...(completionEvidence ? { completionEvidence } : {}),
                                ...(humanApproval ? { humanApproval } : {}),
                            }, null, 2) }] };
            }
            if (params.outputDirectory || params.baseName) {
                throw new Error(`${params.format} uses outputPath, not outputDirectory/baseName.`);
            }
            if (!params.outputPath)
                throw new Error(`outputPath is required for ${params.format}.`);
            if (params.format === "gif") {
                if (!capabilities.animationGif) {
                    throw new Error("The connected Aseprite bridge cannot export GIF animations. Reinstall the bundled Lua bridge.");
                }
                if (playback.frameNumbers.length > 64)
                    throw new Error("GIF export is limited to 64 playback frames.");
                const outputPath = validateSaveAsPath(params.outputPath, overwrite, [".gif"], roots, true, projectRoot);
                const result = await dispatcher.send("render_animation_gif", {
                    outputPath,
                    overwrite,
                    frameNumbers: playback.frameNumbers,
                    tagName: playback.tagName ?? undefined,
                    scale,
                    loop: params.loop ?? playback.loopsContinuously,
                }, 60_000);
                return { content: [{ type: "text", text: JSON.stringify({
                                ...result,
                                format: params.format,
                                playback,
                                ...(completionEvidence ? { completionEvidence } : {}),
                                ...(humanApproval ? { humanApproval } : {}),
                            }, null, 2) }] };
            }
            const outputPath = validateExportPngPath(params.outputPath, overwrite, roots, true, projectRoot);
            if (params.format === "png") {
                const sourceFrame = playback.frameNumbers[0];
                const result = await dispatcher.send("export_png", {
                    outputPath,
                    frameNumber: sourceFrame,
                    scale,
                    overwrite,
                }, 15_000);
                return { content: [{ type: "text", text: JSON.stringify({
                                ...result,
                                format: params.format,
                                playback,
                                sourceFrame,
                                ...(completionEvidence ? { completionEvidence } : {}),
                                ...(humanApproval ? { humanApproval } : {}),
                            }, null, 2) }] };
            }
            const result = await dispatcher.send("export_sprite_sheet", {
                outputPath,
                frameNumbers: playback.frameNumbers,
                layout: params.layout ?? "horizontal",
                columns: params.columns,
                spacing: params.spacing ?? 0,
                scale,
                overwrite,
            }, 30_000);
            return { content: [{ type: "text", text: JSON.stringify({
                            ...result,
                            format: params.format,
                            playback,
                            ...(completionEvidence ? { completionEvidence } : {}),
                            ...(humanApproval ? { humanApproval } : {}),
                        }, null, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: error.message }, null, 2) }], isError: true };
        }
    });
}
//# sourceMappingURL=files.js.map