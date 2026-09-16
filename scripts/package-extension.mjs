import { deflateRawSync } from "node:zlib";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "dist", "aseprite-mcp-bridge.aseprite-extension");
const files = [
  { archivePath: "package.json", sourcePath: path.join(root, "extension", "package.json") },
  { archivePath: "aseprite-mcp-bridge.lua", sourcePath: path.join(root, "lua", "aseprite-bridge.lua") },
];

function archivePathForRuntime(sourcePath) {
  return path.posix.join("server", path.relative(root, sourcePath).split(path.sep).join("/"));
}

async function collectDaemonRuntime(sourcePath, collected = new Map()) {
  const resolved = path.resolve(sourcePath);
  if (collected.has(resolved)) return collected;
  const archivePath = archivePathForRuntime(resolved);
  collected.set(resolved, { archivePath, sourcePath: resolved });
  const source = await readFile(resolved, "utf8");
  const imports = source.matchAll(/\bfrom\s*["']([^"']+)["']/g);
  for (const match of imports) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) continue;
    const dependency = path.resolve(path.dirname(resolved), specifier);
    await collectDaemonRuntime(dependency, collected);
  }
  return collected;
}

async function collectDirectory(sourceDirectory, archiveDirectory, collected) {
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const archivePath = path.posix.join(archiveDirectory, entry.name);
    if (entry.isDirectory()) {
      await collectDirectory(sourcePath, archivePath, collected);
    } else if (entry.isFile()) {
      collected.push({ archivePath, sourcePath });
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint16(value) {
  const output = Buffer.alloc(2);
  output.writeUInt16LE(value, 0);
  return output;
}

function uint32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value >>> 0, 0);
  return output;
}

async function main() {
  const runtime = await collectDaemonRuntime(path.join(root, "dist", "bridge", "daemon.js"));
  const runtimeFiles = [...runtime.values()];
  await collectDirectory(
    path.join(root, "node_modules", "ws"),
    "server/node_modules/ws",
    runtimeFiles
  );
  const generatedRuntimeManifest = {
    archivePath: "server/package.json",
    data: Buffer.from(JSON.stringify({ private: true, type: "module" }), "utf8"),
  };
  const archiveInputs = [...files, ...runtimeFiles, generatedRuntimeManifest];
  const archiveEntries = await Promise.all(archiveInputs.map(async ({ archivePath, sourcePath, data: suppliedData }) => {
    const data = suppliedData ?? await readFile(sourcePath);
    const compressed = deflateRawSync(data);
    return { name: Buffer.from(archivePath, "utf8"), data, compressed, checksum: crc32(data) };
  }));

  const localRecords = [];
  const centralRecords = [];
  let offset = 0;
  for (const entry of archiveEntries) {
    const local = Buffer.concat([
      uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(8), uint16(0), uint16(0),
      uint32(entry.checksum), uint32(entry.compressed.length), uint32(entry.data.length),
      uint16(entry.name.length), uint16(0), entry.name, entry.compressed,
    ]);
    localRecords.push(local);
    centralRecords.push(Buffer.concat([
      uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(8), uint16(0), uint16(0),
      uint32(entry.checksum), uint32(entry.compressed.length), uint32(entry.data.length),
      uint16(entry.name.length), uint16(0), uint16(0), uint16(0), uint16(0), uint32(0), uint32(offset), entry.name,
    ]));
    offset += local.length;
  }
  const centralDirectory = Buffer.concat(centralRecords);
  const endRecord = Buffer.concat([
    uint32(0x06054b50), uint16(0), uint16(0), uint16(archiveEntries.length), uint16(archiveEntries.length),
    uint32(centralDirectory.length), uint32(offset), uint16(0),
  ]);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.concat([...localRecords, centralDirectory, endRecord]));
  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
