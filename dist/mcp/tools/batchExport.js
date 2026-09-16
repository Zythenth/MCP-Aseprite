import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getAllowedRoots, isPathWithinRoots, resolveProjectRoot, validateDirectoryPath, validateExportPngPath } from "../../security/fileAccess.js";
import { bridgeToolError } from "./common.js";
const MAX_BATCH_FILES = 256;
async function findSpriteFiles(directory) {
    const result = [];
    async function visit(current) {
        for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
            const candidate = path.join(current, entry.name);
            if (entry.isDirectory())
                await visit(candidate);
            else if (entry.isFile() && [".ase", ".aseprite"].includes(path.extname(entry.name).toLowerCase())) {
                result.push(candidate);
                if (result.length > MAX_BATCH_FILES)
                    throw new Error(`Batch export is limited to ${MAX_BATCH_FILES} source sprites.`);
            }
        }
    }
    await visit(directory);
    return result.sort((left, right) => left.localeCompare(right));
}
function safeRelativeStem(inputDirectory, sourcePath) {
    const relative = path.relative(inputDirectory, sourcePath);
    const noExtension = relative.slice(0, -path.extname(relative).length);
    if (!noExtension || noExtension.startsWith("..") || path.isAbsolute(noExtension))
        throw new Error(`Invalid batch source path: ${sourcePath}`);
    return noExtension;
}
export function registerBatchExportTools(server, dispatcher) {
    server.tool("batch_export_sprites", "Exports every .ase/.aseprite under an approved directory as PNG frames or spritesheets at one or more integer scales. Existing files are never overwritten unless explicitly requested, and the original saved document is restored.", {
        inputDirectory: z.string().min(1),
        outputDirectory: z.string().min(1),
        format: z.enum(["png", "spritesheet"]).default("png"),
        scales: z.array(z.number().int().min(1).max(8)).min(1).max(8).default([1]),
        columns: z.number().int().min(1).max(128).optional(),
        spacing: z.number().int().min(0).max(64).default(0),
        overwrite: z.boolean().default(false),
        restoreOriginal: z.literal(true).default(true).describe("Required safeguard: restore the originally active saved document after the batch"),
    }, async (args) => {
        try {
            const roots = getAllowedRoots();
            const projectRoot = resolveProjectRoot(undefined, roots);
            const inputDirectory = validateDirectoryPath(args.inputDirectory, roots, true, projectRoot);
            const outputDirectory = validateDirectoryPath(args.outputDirectory, roots, true, projectRoot);
            const originalStatus = await dispatcher.send("aseprite_status", {}, 10_000);
            const originalPath = originalStatus.filename?.trim();
            if (originalStatus.hasActiveSprite && !originalPath) {
                throw new Error("Batch export refuses to replace an unsaved active document. Save it first, then retry.");
            }
            const sources = await findSpriteFiles(inputDirectory);
            if (!sources.length)
                throw new Error("No .ase or .aseprite files found in inputDirectory.");
            const planned = [];
            for (const sourcePath of sources) {
                const relativeStem = safeRelativeStem(inputDirectory, sourcePath);
                for (const scale of [...new Set(args.scales)].sort((a, b) => a - b)) {
                    const suffix = scale === 1 ? "" : `@${scale}x`;
                    const fileName = `${relativeStem}${suffix}${args.format === "spritesheet" ? "_spritesheet" : ""}.png`;
                    const outputPath = path.resolve(outputDirectory, fileName);
                    if (!isPathWithinRoots(outputPath, roots))
                        throw new Error(`Batch output escapes configured roots: ${outputPath}`);
                    planned.push({ sourcePath, scale, outputPath });
                }
            }
            if (!args.overwrite) {
                const conflicts = planned.filter((item) => fs.existsSync(item.outputPath));
                if (conflicts.length)
                    throw new Error(`Refusing to overwrite ${conflicts.length} existing batch output(s), starting with ${conflicts[0].outputPath}.`);
            }
            const completed = [];
            try {
                for (const sourcePath of sources) {
                    await dispatcher.send("open_sprite", { filePath: sourcePath }, 20_000);
                    const info = await dispatcher.send("get_sprite_info", {}, 10_000);
                    const frameNumbers = info.frames?.map((frame) => frame.frameNumber) ?? [1];
                    for (const item of planned.filter((candidate) => candidate.sourcePath === sourcePath)) {
                        await fs.promises.mkdir(path.dirname(item.outputPath), { recursive: true });
                        const validatedPath = validateExportPngPath(item.outputPath, args.overwrite, roots, true, projectRoot);
                        if (args.format === "png") {
                            await dispatcher.send("export_png", { outputPath: validatedPath, frameNumber: frameNumbers[0], scale: item.scale, overwrite: args.overwrite }, 20_000);
                        }
                        else {
                            const inspection = await dispatcher.send("inspect_animation", {}, 10_000);
                            await dispatcher.send("export_sprite_sheet", {
                                outputPath: validatedPath,
                                frameNumbers: inspection.frames.map((frame) => frame.frameNumber),
                                layout: "grid",
                                columns: Math.min(args.columns ?? inspection.frames.length, inspection.frames.length),
                                spacing: args.spacing,
                                scale: item.scale,
                                overwrite: args.overwrite,
                            }, 30_000);
                        }
                        completed.push({ sourcePath, outputPath: validatedPath, scale: item.scale, frames: frameNumbers.length });
                    }
                }
            }
            finally {
                if (originalPath)
                    await dispatcher.send("open_sprite", { filePath: originalPath }, 20_000);
            }
            return { content: [{ type: "text", text: JSON.stringify({ success: true, inputDirectory, outputDirectory, format: args.format, filesProcessed: sources.length, outputs: completed, originalDocumentRestored: Boolean(originalPath) }, null, 2) }] };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
}
//# sourceMappingURL=batchExport.js.map