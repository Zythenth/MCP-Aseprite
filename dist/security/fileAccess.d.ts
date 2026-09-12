export declare const ALLOWED_OPEN_EXTENSIONS: readonly [".ase", ".aseprite", ".png"];
export declare const ALLOWED_SAVE_EXTENSIONS: readonly [".ase", ".aseprite", ".png"];
export declare const ALLOWED_EXPORT_EXTENSIONS: readonly [".png"];
/**
 * Resolves and canonicalizes configured allowed root directories.
 * Parses paths separated by path.delimiter (; on Windows, : on POSIX).
 * If undefined or empty, defaults to process.cwd().
 * Rejects invalid, relative, or non-directory paths explicitly.
 */
export declare function resolveAllowedRoots(rawEnv?: string): string[];
/**
 * Retrieves the currently active allowed root directories.
 */
export declare function getAllowedRoots(customEnv?: string): string[];
/**
 * Robust containment check: ensures targetPath resides within at least one root directory.
 * Case-insensitive on Windows (win32), case-sensitive elsewhere.
 * Prevents sibling-prefix bypasses (e.g. C:\\foo matching C:\\foobar).
 */
export declare function isPathWithinRoots(targetPath: string, roots?: string[]): boolean;
/**
 * Validates a file path for opening/reading.
 * Requires an absolute path, allowlisted extension, existing regular file,
 * canonicalizes via realpath (internal symlinks within roots are resolved; escapes outside roots rejected),
 * and ensures the canonical path is within allowed roots.
 */
export declare function validateOpenPath(filePath: string, roots?: string[]): string;
/**
 * Validates a file path for saving/writing.
 * Requires absolute path, valid extension, existing directory for parent,
 * checks no-clobber when overwrite is false, rejects symlinks and directory targets,
 * and canonicalizes destination within allowed roots.
 */
export declare function validateSaveAsPath(filePath: string, overwrite?: boolean, allowedExtensions?: readonly string[], roots?: string[]): string;
/**
 * Validates an output path for PNG export.
 */
export declare function validateExportPngPath(outputPath: string, overwrite?: boolean, roots?: string[]): string;
//# sourceMappingURL=fileAccess.d.ts.map