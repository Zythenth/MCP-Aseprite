import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  installStdoutGuard,
  uninstallStdoutGuard,
  isStdoutGuardInstalled,
  logger,
  LogLevel,
} from "../../src/logger.js";

describe("Stdout Guard Unit Tests", () => {
  let stdoutChunks: string[] = [];
  let stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  let originalLogLevel: LogLevel;

  beforeEach(() => {
    originalLogLevel = logger.getLevel();
    logger.setLevel(LogLevel.DEBUG);
    stdoutChunks = [];
    stderrChunks = [];
    process.stdout.write = ((chunk: any) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as any;
    process.stderr.write = ((chunk: any) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as any;
  });

  afterEach(() => {
    logger.setLevel(originalLogLevel);
    uninstallStdoutGuard();
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  it("should redirect console.log, info, warn, error, debug, dir, trace to stderr without touching stdout", () => {
    installStdoutGuard();
    expect(isStdoutGuardInstalled()).toBe(true);

    console.log("Console log payload");
    console.info("Console info payload");
    console.warn("Console warn payload");
    console.error("Console error payload");
    console.debug("Console debug payload");
    console.dir({ key: "value" });
    console.trace("Trace mark");

    expect(stdoutChunks.length).toBe(0); // ZERO stdout pollution
    expect(stderrChunks.length).toBeGreaterThanOrEqual(7);

    const fullStderr = stderrChunks.join("");
    expect(fullStderr).toContain("Console log payload");
    expect(fullStderr).toContain("Console info payload");
    expect(fullStderr).toContain("Console warn payload");
    expect(fullStderr).toContain("Console error payload");
    expect(fullStderr).toContain("key: 'value'");
    expect(fullStderr).toContain("Trace mark");
  });

  it("should be idempotent and restore original console methods upon uninstall", () => {
    const originalLog = console.log;
    installStdoutGuard();
    installStdoutGuard(); // duplicate call must not nest or throw

    expect(console.log).not.toBe(originalLog);
    uninstallStdoutGuard();

    expect(isStdoutGuardInstalled()).toBe(false);
    expect(console.log).toBe(originalLog);
  });
});