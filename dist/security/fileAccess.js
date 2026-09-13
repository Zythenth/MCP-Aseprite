// src/security/fileAccess.ts
import fs from "node:fs";
import path from "node:path";
export const ALLOWED_OPEN_EXTENSIONS = [".ase", ".aseprite", ".png"];
export const ALLOWED_SAVE_EXTENSIONS = [".ase", ".aseprite", ".png"];
export const ALLOWED_EXPORT_EXTENSIONS = [".png"];
export const ALLOWED_PROJECT_EXTENSIONS = [".aseprite"];
export const ALLOWED_REFERENCE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
/**
 * Resolves and canonicalizes configured allowed root directories.
 * Parses paths separated by path.delimiter (; on Windows, : on POSIX).
 * If undefined or empty, defaults to process.cwd().
 * Rejects invalid, relative, or non-directory paths explicitly.
 */
export function resolveAllowedRoots(rawEnv) {
    if (rawEnv === undefined || rawEnv.trim() === "") {
        const cwd = process.cwd();
        try {
            const realCwd = fs.realpathSync(cwd);
            return [realCwd];
        }
        catch (err) {
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
    const roots = [];
    for (const entry of rawEntries) {
        if (!path.isAbsolute(entry)) {
            throw new Error(`Configured allowed path is not absolute: '${entry}'`);
        }
        let stat;
        try {
            stat = fs.statSync(entry);
        }
        catch {
            throw new Error(`Configured allowed path does not exist: '${entry}'`);
        }
        if (!stat.isDirectory()) {
            throw new Error(`Configured allowed path is not a directory: '${entry}'`);
        }
        try {
            const realEntry = fs.realpathSync(entry);
            roots.push(realEntry);
        }
        catch (err) {
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
export function getAllowedRoots(customEnv) {
    return resolveAllowedRoots(customEnv !== undefined ? customEnv : process.env.ASEPRITE_ALLOWED_PATHS);
}
/**
 * Robust containment check: ensures targetPath resides within at least one root directory.
 * Case-insensitive on Windows (win32), case-sensitive elsewhere.
 * Prevents sibling-prefix bypasses (e.g. C:\\foo matching C:\\foobar).
 */
export function isPathWithinRoots(targetPath, roots = getAllowedRoots()) {
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
 * Resolves a project path that may be relative or absolute.
 * If relative, resolves against the configured project root.
 * Verifies that the resolved path does not traverse outside the authorized roots.
 */
export function resolveProjectRoot(rawEnv = process.env.ASEPRITE_PROJECT_ROOT, roots = getAllowedRoots()) {
    if (roots.length === 0)
        throw new Error("No allowed roots configured.");
    const configured = rawEnv?.trim();
    const candidate = configured && configured.length > 0 ? configured : roots[0];
    if (!path.isAbsolute(candidate)) {
        throw new Error(`Configured project root is not absolute: '${candidate}'`);
    }
    let canonical;
    try {
        canonical = fs.realpathSync(candidate);
    }
    catch (error) {
        throw new Error(`Configured project root does not exist: '${candidate}' (${error.message})`);
    }
    if (!fs.statSync(canonical).isDirectory()) {
        throw new Error(`Configured project root is not a directory: '${candidate}'`);
    }
    if (!isPathWithinRoots(canonical, roots)) {
        throw new Error("Configured project root is outside allowed roots.");
    }
    return canonical;
}
function canonicalizeCandidate(candidate, roots) {
    try {
        const canonical = fs.realpathSync(candidate);
        if (!isPathWithinRoots(canonical, roots)) {
            throw new Error("Access denied: path resolves outside allowed roots.");
        }
        return canonical;
    }
    catch (error) {
        if (error instanceof Error && error.message === "Access denied: path resolves outside allowed roots.") {
            throw error;
        }
        if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") {
            throw new Error(`Failed to resolve path '${candidate}': ${error?.message ?? String(error)}`);
        }
    }
    let ancestor = candidate;
    const missingParts = [];
    while (!fs.existsSync(ancestor)) {
        const parent = path.dirname(ancestor);
        if (parent === ancestor)
            throw new Error(`Unable to resolve an existing ancestor for '${candidate}'.`);
        missingParts.unshift(path.basename(ancestor));
        ancestor = parent;
    }
    let canonicalAncestor;
    try {
        canonicalAncestor = fs.realpathSync(ancestor);
    }
    catch (error) {
        throw new Error(`Failed to canonicalize ancestor '${ancestor}': ${error.message}`);
    }
    if (!isPathWithinRoots(canonicalAncestor, roots)) {
        throw new Error("Access denied: path resolves outside allowed roots.");
    }
    const canonicalCandidate = path.join(canonicalAncestor, ...missingParts);
    if (!isPathWithinRoots(canonicalCandidate, roots)) {
        throw new Error("Access denied: path resolves outside allowed roots.");
    }
    return canonicalCandidate;
}
export function resolveProjectPath(filePath, roots = getAllowedRoots(), projectRoot = resolveProjectRoot(undefined, roots)) {
    if (!filePath || typeof filePath !== "string" || filePath.trim() === "") {
        throw new Error("File path is required.");
    }
    if (roots.length === 0) {
        throw new Error("No allowed roots configured.");
    }
    const canonicalProjectRoot = resolveProjectRoot(projectRoot, roots);
    const absoluteCandidate = path.isAbsolute(filePath)
        ? path.normalize(path.resolve(filePath))
        : path.normalize(path.resolve(canonicalProjectRoot, filePath));
    try {
        return canonicalizeCandidate(absoluteCandidate, roots);
    }
    catch (error) {
        if (String(error?.message).startsWith("Access denied:")) {
            throw new Error(`Access denied: path '${filePath}' resolves outside allowed roots.`);
        }
        throw error;
    }
}
export function validateDirectoryPath(directoryPath, roots = getAllowedRoots(), allowRelative = true, projectRoot) {
    const effectivePath = allowRelative
        ? resolveProjectPath(directoryPath, roots, projectRoot ?? resolveProjectRoot(undefined, roots))
        : directoryPath;
    if (!path.isAbsolute(effectivePath))
        throw new Error(`Directory path must be absolute: '${directoryPath}'`);
    let canonical;
    try {
        canonical = fs.realpathSync(effectivePath);
    }
    catch {
        throw new Error(`Directory does not exist: '${directoryPath}'`);
    }
    if (!fs.statSync(canonical).isDirectory())
        throw new Error(`Path is not a directory: '${directoryPath}'`);
    if (!isPathWithinRoots(canonical, roots))
        throw new Error("Access denied: directory is outside allowed roots.");
    return canonical;
}
/**
 * Validates a file path for opening/reading.
 * Requires an absolute path, allowlisted extension, existing regular file,
 * canonicalizes via realpath (internal symlinks within roots are resolved; escapes outside roots rejected),
 * and ensures the canonical path is within allowed roots.
 */
export function validateOpenPath(filePath, roots = getAllowedRoots(), allowRelative = false, projectRoot, allowedExtensions = ALLOWED_OPEN_EXTENSIONS) {
    if (!filePath || typeof filePath !== "string") {
        throw new Error("File path is required.");
    }
    const effectivePath = allowRelative
        ? resolveProjectPath(filePath, roots, projectRoot ?? resolveProjectRoot(undefined, roots))
        : filePath;
    if (!path.isAbsolute(effectivePath)) {
        throw new Error(`File path must be an absolute path: '${filePath}'`);
    }
    const ext = path.extname(effectivePath).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
        throw new Error(`Invalid file extension '${ext}'. Allowed extensions for opening: ${allowedExtensions.join(", ")}`);
    }
    let stat;
    try {
        stat = fs.statSync(effectivePath);
    }
    catch {
        throw new Error(`File does not exist: '${filePath}'`);
    }
    if (!stat.isFile()) {
        throw new Error(`Path is not a regular file: '${filePath}'`);
    }
    let canonicalPath;
    try {
        canonicalPath = fs.realpathSync(effectivePath);
    }
    catch (err) {
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
export function validateSaveAsPath(filePath, overwrite = false, allowedExtensions = ALLOWED_SAVE_EXTENSIONS, roots = getAllowedRoots(), allowRelative = false, projectRoot) {
    if (!filePath || typeof filePath !== "string") {
        throw new Error("Target file path is required.");
    }
    const effectivePath = allowRelative
        ? resolveProjectPath(filePath, roots, projectRoot ?? resolveProjectRoot(undefined, roots))
        : filePath;
    if (!path.isAbsolute(effectivePath)) {
        throw new Error(`Target file path must be an absolute path: '${filePath}'`);
    }
    const ext = path.extname(effectivePath).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
        throw new Error(`Invalid file extension '${ext}'. Allowed extensions: ${allowedExtensions.join(", ")}`);
    }
    const parentDir = path.dirname(effectivePath);
    let parentStat;
    try {
        parentStat = fs.statSync(parentDir);
    }
    catch {
        throw new Error(`Parent directory does not exist: '${parentDir}'`);
    }
    if (!parentStat.isDirectory()) {
        throw new Error(`Parent path is not a directory: '${parentDir}'`);
    }
    let canonicalParent;
    try {
        canonicalParent = fs.realpathSync(parentDir);
    }
    catch (err) {
        throw new Error(`Failed to resolve canonical parent directory: ${err.message}`);
    }
    if (!isPathWithinRoots(canonicalParent, roots)) {
        throw new Error("Access denied: parent directory is outside allowed roots.");
    }
    const fileName = path.basename(effectivePath);
    const targetCandidate = path.join(canonicalParent, fileName);
    let destLstat = null;
    try {
        destLstat = fs.lstatSync(targetCandidate);
    }
    catch {
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
        let canonicalDest;
        try {
            canonicalDest = fs.realpathSync(targetCandidate);
        }
        catch (err) {
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
export function validateExportPngPath(outputPath, overwrite = false, roots = getAllowedRoots(), allowRelative = false, projectRoot) {
    return validateSaveAsPath(outputPath, overwrite, ALLOWED_EXPORT_EXTENSIONS, roots, allowRelative, projectRoot);
}
export function validateReferencePath(filePath, roots = getAllowedRoots(), allowRelative = true, projectRoot) {
    return validateOpenPath(filePath, roots, allowRelative, projectRoot, ALLOWED_REFERENCE_EXTENSIONS);
}
//# sourceMappingURL=fileAccess.js.map