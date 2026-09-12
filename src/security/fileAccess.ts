// src/security/fileAccess.ts
import fs from "node:fs";
import path from "node:path";

export const ALLOWED_OPEN_EXTENSIONS = [".ase", ".aseprite", ".png"] as const;
export const ALLOWED_SAVE_EXTENSIONS = [".ase", ".aseprite", ".png"] as const;
export const ALLOWED_EXPORT_EXTENSIONS = [".png"] as const;

/**
 * Resolves and canonicalizes configured allowed root directories.
 * Parses paths separated by path.delimiter (; on Windows, : on POSIX).
 * If undefined or empty, defaults to process.cwd().
 * Rejects invalid, relative, or non-directory paths explicitly.
 */
export function resolveAllowedRoots(rawEnv?: string): string[] {
  if (rawEnv === undefined || rawEnv.trim() === "") {
    const cwd = process.cwd();
    try {
      const realCwd = fs.realpathSync(cwd);
      return [realCwd];
    } catch (err: any) {
      throw new Error(`Failed to resolve default allowed root (process.cwd): ${err.message}`);
    }
  }

  const rawEntries = rawEnv
    .split(path.delimiter)
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  if (rawEntries.length === 0) {
    throw new Error("No valid allowed roots configured in ASEPRITE_ALLOWED_PATHS.");
  }

  const roots: string[] = [];
  for (const entry of rawEntries) {
    if (!path.isAbsolute(entry)) {
      throw new Error(`Configured allowed path is not absolute: '${entry}'`);
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(entry);
    } catch {
      throw new Error(`Configured allowed path does not exist: '${entry}'`);
    }

    if (!stat.isDirectory()) {
      throw new Error(`Configured allowed path is not a directory: '${entry}'`);
    }

    try {
      const realEntry = fs.realpathSync(entry);
      roots.push(realEntry);
    } catch (err: any) {
      throw new Error(`Failed to canonicalize allowed path '${entry}': ${err.message}`);
    }
  }

  if (roots.length === 0) {
    throw new Error("No valid allowed roots configured in ASEPRITE_ALLOWED_PATHS.");
  }

  return roots;
}

/**
 * Retrieves the currently active allowed root directories.
 */
export function getAllowedRoots(customEnv?: string): string[] {
  return resolveAllowedRoots(customEnv !== undefined ? customEnv : process.env.ASEPRITE_ALLOWED_PATHS);
}

/**
 * Robust containment check: ensures targetPath resides within at least one root directory.
 * Case-insensitive on Windows (win32), case-sensitive elsewhere.
 * Prevents sibling-prefix bypasses (e.g. C:\\foo matching C:\\foobar).
 */
export function isPathWithinRoots(targetPath: string, roots: string[] = getAllowedRoots()): boolean {
  const isWindows = process.platform === "win32";
  const normTarget = path.normalize(path.resolve(targetPath));
  const targetCmp = isWindows ? normTarget.toLowerCase() : normTarget;

  for (const root of roots) {
    const normRoot = path.normalize(path.resolve(root));
    const rootCmp = isWindows ? normRoot.toLowerCase() : normRoot;

    if (targetCmp === rootCmp) {
      return true;
    }

    const rootWithSep = rootCmp.endsWith(path.sep) ? rootCmp : rootCmp + path.sep;
    if (targetCmp.startsWith(rootWithSep)) {
      return true;
    }
  }

  return false;
}

/**
 * Validates a file path for opening/reading.
 * Requires an absolute path, allowlisted extension, existing regular file,
 * canonicalizes via realpath (internal symlinks within roots are resolved; escapes outside roots rejected),
 * and ensures the canonical path is within allowed roots.
 */
export function validateOpenPath(
  filePath: string,
  roots: string[] = getAllowedRoots()
): string {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("File path is required.");
  }

  if (!path.isAbsolute(filePath)) {
    throw new Error(`File path must be an absolute path: '${filePath}'`);
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_OPEN_EXTENSIONS.includes(ext as any)) {
    throw new Error(
      `Invalid file extension '${ext}'. Allowed extensions for opening: ${ALLOWED_OPEN_EXTENSIONS.join(", ")}`
    );
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error(`File does not exist: '${filePath}'`);
  }

  if (!stat.isFile()) {
    throw new Error(`Path is not a regular file: '${filePath}'`);
  }

  let canonicalPath: string;
  try {
    canonicalPath = fs.realpathSync(filePath);
  } catch (err: any) {
    throw new Error(`Failed to resolve canonical path for '${filePath}': ${err.message}`);
  }

  const canonicalStat = fs.statSync(canonicalPath);
  if (!canonicalStat.isFile()) {
    throw new Error(`Resolved path is not a regular file: '${canonicalPath}'`);
  }

  if (!isPathWithinRoots(canonicalPath, roots)) {
    throw new Error("Access denied: file path is outside allowed roots.");
  }

  return canonicalPath;
}

/**
 * Validates a file path for saving/writing.
 * Requires absolute path, valid extension, existing directory for parent,
 * checks no-clobber when overwrite is false, rejects symlinks and directory targets,
 * and canonicalizes destination within allowed roots.
 */
export function validateSaveAsPath(
  filePath: string,
  overwrite: boolean = false,
  allowedExtensions: readonly string[] = ALLOWED_SAVE_EXTENSIONS,
  roots: string[] = getAllowedRoots()
): string {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Target file path is required.");
  }

  if (!path.isAbsolute(filePath)) {
    throw new Error(`Target file path must be an absolute path: '${filePath}'`);
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    throw new Error(
      `Invalid file extension '${ext}'. Allowed extensions: ${allowedExtensions.join(", ")}`
    );
  }

  const parentDir = path.dirname(filePath);
  let parentStat: fs.Stats;
  try {
    parentStat = fs.statSync(parentDir);
  } catch {
    throw new Error(`Parent directory does not exist: '${parentDir}'`);
  }

  if (!parentStat.isDirectory()) {
    throw new Error(`Parent path is not a directory: '${parentDir}'`);
  }

  let canonicalParent: string;
  try {
    canonicalParent = fs.realpathSync(parentDir);
  } catch (err: any) {
    throw new Error(`Failed to resolve canonical parent directory: ${err.message}`);
  }

  if (!isPathWithinRoots(canonicalParent, roots)) {
    throw new Error("Access denied: parent directory is outside allowed roots.");
  }

  const fileName = path.basename(filePath);
  const targetCandidate = path.join(canonicalParent, fileName);

  let destLstat: fs.Stats | null = null;
  try {
    destLstat = fs.lstatSync(targetCandidate);
  } catch {
    // Target does not exist yet
  }

  if (destLstat) {
    if (!destLstat.isFile()) {
      if (destLstat.isDirectory()) {
        throw new Error(`Target path is a directory, cannot overwrite: '${filePath}'`);
      }
      if (destLstat.isSymbolicLink()) {
        throw new Error(`Target path is a symbolic link, which is not permitted for writing: '${filePath}'`);
      }
      throw new Error(`Target path is not a regular file: '${filePath}'`);
    }

    let canonicalDest: string;
    try {
      canonicalDest = fs.realpathSync(targetCandidate);
    } catch (err: any) {
      throw new Error(`Failed to resolve canonical target path: ${err.message}`);
    }

    if (!isPathWithinRoots(canonicalDest, roots)) {
      throw new Error("Access denied: target path resolves outside allowed roots.");
    }

    if (!overwrite) {
      throw new Error(`File already exists and overwrite is false: '${filePath}'`);
    }

    return canonicalDest;
  }

  if (!isPathWithinRoots(targetCandidate, roots)) {
    throw new Error("Access denied: target path is outside allowed roots.");
  }

  return targetCandidate;
}

/**
 * Validates an output path for PNG export.
 */
export function validateExportPngPath(
  outputPath: string,
  overwrite: boolean = false,
  roots: string[] = getAllowedRoots()
): string {
  return validateSaveAsPath(outputPath, overwrite, ALLOWED_EXPORT_EXTENSIONS, roots);
}
