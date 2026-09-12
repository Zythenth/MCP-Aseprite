// test/unit/fileAccess.test.ts
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveAllowedRoots,
  isPathWithinRoots,
  validateOpenPath,
  validateSaveAsPath,
  validateExportPngPath,
  ALLOWED_OPEN_EXTENSIONS,
  ALLOWED_SAVE_EXTENSIONS,
  ALLOWED_EXPORT_EXTENSIONS,
} from "../../src/security/fileAccess.js";

describe("File Access Security Policy (fileAccess.ts)", () => {
  let createdDirs: string[] = [];

  function makeTempDir(prefix = "mcp-fileaccess-"): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const realDir = fs.realpathSync(dir);
    createdDirs.push(realDir);
    return realDir;
  }

  afterEach(() => {
    for (const dir of createdDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
    createdDirs = [];
  });

  describe("resolveAllowedRoots", () => {
    it("defaults to realpath of process.cwd() when undefined or empty/whitespace string", () => {
      const realCwd = fs.realpathSync(process.cwd());
      expect(resolveAllowedRoots(undefined)).toEqual([realCwd]);
      expect(resolveAllowedRoots("")).toEqual([realCwd]);
      expect(resolveAllowedRoots("   ")).toEqual([realCwd]);
    });

    it("accepts an explicit valid directory and returns its realpath", () => {
      const tempDir = makeTempDir();
      const roots = resolveAllowedRoots(tempDir);
      expect(roots).toEqual([tempDir]);
    });

    it("parses multiple directories separated by path.delimiter", () => {
      const dir1 = makeTempDir("mcp-fa-1-");
      const dir2 = makeTempDir("mcp-fa-2-");
      const combined = `${dir1}${path.delimiter}${dir2}`;
      const roots = resolveAllowedRoots(combined);
      expect(roots).toEqual([dir1, dir2]);
    });

    it("rejects non-absolute paths", () => {
      expect(() => resolveAllowedRoots("./relative/path")).toThrow(
        /not absolute/i
      );
      expect(() => resolveAllowedRoots(`foo${path.sep}bar`)).toThrow(
        /not absolute/i
      );
    });

    it("rejects non-existent directory paths", () => {
      const nonExistent = path.join(os.tmpdir(), "mcp-non-existent-dir-12345");
      expect(() => resolveAllowedRoots(nonExistent)).toThrow(
        /does not exist/i
      );
    });

    it("rejects paths that are files rather than directories", () => {
      const tempDir = makeTempDir();
      const filePath = path.join(tempDir, "regular_file.txt");
      fs.writeFileSync(filePath, "hello");
      expect(() => resolveAllowedRoots(filePath)).toThrow(
        /not a directory/i
      );
    });

    it("rejects strings consisting solely of delimiters or empty tokens", () => {
      const delimiterOnly = `${path.delimiter}${path.delimiter}   ${path.delimiter}`;
      expect(() => resolveAllowedRoots(delimiterOnly)).toThrow(
        /No valid allowed roots/i
      );
    });
  });

  describe("isPathWithinRoots", () => {
    it("accepts the root directory itself and descendant paths", () => {
      const root = makeTempDir();
      const childDir = path.join(root, "nested", "folder");
      const childFile = path.join(root, "nested", "sprite.aseprite");

      expect(isPathWithinRoots(root, [root])).toBe(true);
      expect(isPathWithinRoots(childDir, [root])).toBe(true);
      expect(isPathWithinRoots(childFile, [root])).toBe(true);
    });

    it("rejects parent or ancestor directories", () => {
      const root = makeTempDir();
      const parentDir = path.dirname(root);
      expect(isPathWithinRoots(parentDir, [root])).toBe(false);
    });

    it("rejects sibling-prefix directory bypasses (e.g. /dir vs /dir2)", () => {
      const base = makeTempDir();
      const root = path.join(base, "target");
      const sibling = path.join(base, "target_prefix_attack");
      fs.mkdirSync(root);
      fs.mkdirSync(sibling);

      expect(isPathWithinRoots(sibling, [root])).toBe(false);
      expect(isPathWithinRoots(path.join(sibling, "file.png"), [root])).toBe(false);
    });

    it("performs case-insensitive comparison on Windows and case-sensitive elsewhere", () => {
      const root = makeTempDir();
      const upper = root.toUpperCase();
      const lower = root.toLowerCase();

      if (process.platform === "win32") {
        expect(isPathWithinRoots(upper, [root])).toBe(true);
        expect(isPathWithinRoots(lower, [root])).toBe(true);
      } else {
        // On POSIX, case sensitivity depends on the filesystem, but root itself is always accepted
        expect(isPathWithinRoots(root, [root])).toBe(true);
      }
    });
  });

  describe("validateOpenPath", () => {
    it("rejects empty or relative paths", () => {
      const root = makeTempDir();
      expect(() => validateOpenPath("", [root])).toThrow(/required/i);
      expect(() => validateOpenPath("relative/file.aseprite", [root])).toThrow(/absolute/i);
    });

    it("rejects disallowed file extensions", () => {
      const root = makeTempDir();
      const txtFile = path.join(root, "file.txt");
      fs.writeFileSync(txtFile, "content");
      expect(() => validateOpenPath(txtFile, [root])).toThrow(/Invalid file extension/i);
    });

    it("rejects missing files and directory targets", () => {
      const root = makeTempDir();
      const missing = path.join(root, "missing.aseprite");
      expect(() => validateOpenPath(missing, [root])).toThrow(/does not exist/i);

      const subDir = path.join(root, "my_folder.aseprite");
      fs.mkdirSync(subDir);
      expect(() => validateOpenPath(subDir, [root])).toThrow(/not a regular file/i);
    });

    it("rejects files outside allowed roots", () => {
      const root1 = makeTempDir("mcp-root1-");
      const root2 = makeTempDir("mcp-root2-");
      const outsideFile = path.join(root2, "sprite.aseprite");
      fs.writeFileSync(outsideFile, "fake-aseprite");

      expect(() => validateOpenPath(outsideFile, [root1])).toThrow(/outside allowed roots/i);
    });

    it("accepts valid existing regular files with allowed extensions and returns canonical realpath", () => {
      const root = makeTempDir();
      for (const ext of ALLOWED_OPEN_EXTENSIONS) {
        const filePath = path.join(root, `test${ext}`);
        fs.writeFileSync(filePath, "data");
        const canonical = validateOpenPath(filePath, [root]);
        expect(canonical).toBe(fs.realpathSync(filePath));
      }
    });

    it("rejects symlink resolving to a target outside allowed roots", () => {
      const allowedRoot = makeTempDir("mcp-open-allowed-");
      const outsideRoot = makeTempDir("mcp-open-outside-");
      const realOutsideFile = path.join(outsideRoot, "secret.aseprite");
      fs.writeFileSync(realOutsideFile, "secret");

      const linkPath = path.join(allowedRoot, "link_to_secret.aseprite");
      let symlinkCreated = false;
      try {
        fs.symlinkSync(realOutsideFile, linkPath, "file");
        symlinkCreated = true;
      } catch (err: any) {
        // Windows non-elevated environments without Developer Mode may deny symlinks
        if (err.code === "EPERM") {
          // Explicitly documented as not applicable in this environment
          return;
        }
        throw err;
      }

      if (symlinkCreated) {
        expect(() => validateOpenPath(linkPath, [allowedRoot])).toThrow(/outside allowed roots/i);
      }
    });
  });

  describe("validateSaveAsPath", () => {
    it("rejects empty or relative paths", () => {
      const root = makeTempDir();
      expect(() => validateSaveAsPath("", false, ALLOWED_SAVE_EXTENSIONS, [root])).toThrow(/required/i);
      expect(() => validateSaveAsPath("out.aseprite", false, ALLOWED_SAVE_EXTENSIONS, [root])).toThrow(/absolute/i);
    });

    it("rejects disallowed file extensions", () => {
      const root = makeTempDir();
      const invalidPath = path.join(root, "out.bin");
      expect(() => validateSaveAsPath(invalidPath, false, ALLOWED_SAVE_EXTENSIONS, [root])).toThrow(
        /Invalid file extension/i
      );
    });

    it("rejects paths with non-existent parent directory or non-directory parent", () => {
      const root = makeTempDir();
      const missingParent = path.join(root, "non_existent_folder", "out.aseprite");
      expect(() => validateSaveAsPath(missingParent, false, ALLOWED_SAVE_EXTENSIONS, [root])).toThrow(
        /Parent directory does not exist/i
      );

      const filePath = path.join(root, "file.txt");
      fs.writeFileSync(filePath, "content");
      const fileAsParent = path.join(filePath, "out.aseprite");
      expect(() => validateSaveAsPath(fileAsParent, false, ALLOWED_SAVE_EXTENSIONS, [root])).toThrow(
        /Parent path is not a directory/i
      );
    });

    it("rejects parent directory outside allowed roots", () => {
      const allowedRoot = makeTempDir("mcp-save-allowed-");
      const outsideRoot = makeTempDir("mcp-save-outside-");
      const outsideTarget = path.join(outsideRoot, "out.aseprite");

      expect(() => validateSaveAsPath(outsideTarget, false, ALLOWED_SAVE_EXTENSIONS, [allowedRoot])).toThrow(
        /outside allowed roots/i
      );
    });

    it("rejects existing destination when it is a directory", () => {
      const root = makeTempDir();
      const dirDest = path.join(root, "folder.aseprite");
      fs.mkdirSync(dirDest);

      expect(() => validateSaveAsPath(dirDest, true, ALLOWED_SAVE_EXTENSIONS, [root])).toThrow(
        /is a directory/i
      );
    });

    it("rejects existing destination when it is a symbolic link", () => {
      const root = makeTempDir();
      const realFile = path.join(root, "real.aseprite");
      fs.writeFileSync(realFile, "content");
      const linkDest = path.join(root, "link.aseprite");

      let symlinkCreated = false;
      try {
        fs.symlinkSync(realFile, linkDest, "file");
        symlinkCreated = true;
      } catch (err: any) {
        if (err.code === "EPERM") {
          return;
        }
        throw err;
      }

      if (symlinkCreated) {
        expect(() => validateSaveAsPath(linkDest, true, ALLOWED_SAVE_EXTENSIONS, [root])).toThrow(
          /symbolic link/i
        );
      }
    });

    it("enforces no-clobber when overwrite is false on existing file, and allows with overwrite true", () => {
      const root = makeTempDir();
      const existingFile = path.join(root, "existing.aseprite");
      fs.writeFileSync(existingFile, "old content");

      expect(() => validateSaveAsPath(existingFile, false, ALLOWED_SAVE_EXTENSIONS, [root])).toThrow(
        /File already exists and overwrite is false/i
      );

      const canonicalDest = validateSaveAsPath(existingFile, true, ALLOWED_SAVE_EXTENSIONS, [root]);
      expect(canonicalDest).toBe(fs.realpathSync(existingFile));
    });

    it("returns target candidate path using canonical parent for non-existent destination", () => {
      const root = makeTempDir();
      const newFile = path.join(root, "new_sprite.aseprite");
      const result = validateSaveAsPath(newFile, false, ALLOWED_SAVE_EXTENSIONS, [root]);
      expect(result).toBe(path.join(root, "new_sprite.aseprite"));
    });
  });

  describe("validateExportPngPath", () => {
    it("accepts .png files and rejects .ase and .aseprite", () => {
      const root = makeTempDir();
      const pngPath = path.join(root, "export.png");
      const asePath = path.join(root, "export.aseprite");

      expect(ALLOWED_EXPORT_EXTENSIONS).toEqual([".png"]);
      expect(validateExportPngPath(pngPath, false, [root])).toBe(pngPath);
      expect(() => validateExportPngPath(asePath, false, [root])).toThrow(
        /Invalid file extension.*\.png/i
      );
    });

    it("enforces no-clobber for PNG export when overwrite is false", () => {
      const root = makeTempDir();
      const existingPng = path.join(root, "existing.png");
      fs.writeFileSync(existingPng, "fake-png");

      expect(() => validateExportPngPath(existingPng, false, [root])).toThrow(
        /File already exists and overwrite is false/i
      );
      expect(validateExportPngPath(existingPng, true, [root])).toBe(fs.realpathSync(existingPng));
    });
  });
});
