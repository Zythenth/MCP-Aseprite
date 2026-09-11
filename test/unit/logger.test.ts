import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StderrLogger, LogLevel, parseLogLevel } from "../../src/logger.js";

describe("StderrLogger Unit Tests", () => {
  let stderrChunks: string[] = [];
  const originalStderrWrite = process.stderr.write;

  beforeEach(() => {
    stderrChunks = [];
    process.stderr.write = ((chunk: any) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as any;
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
  });

  it("should parse string log levels accurately", () => {
    expect(parseLogLevel("debug")).toBe(LogLevel.DEBUG);
    expect(parseLogLevel("INFO")).toBe(LogLevel.INFO);
    expect(parseLogLevel("WARN")).toBe(LogLevel.WARN);
    expect(parseLogLevel("error")).toBe(LogLevel.ERROR);
    expect(parseLogLevel("silent")).toBe(LogLevel.SILENT);
    expect(parseLogLevel(undefined)).toBe(LogLevel.INFO);
    expect(parseLogLevel("unknown")).toBe(LogLevel.INFO);
  });

  it("should format messages with timestamp and level tag to stderr", () => {
    const logger = new StderrLogger(LogLevel.DEBUG);
    logger.info("Test info message %d", 42);

    expect(stderrChunks.length).toBe(1);
    const line = stderrChunks[0];
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] Test info message 42\n$/);
  });

  it("should respect log level thresholds", () => {
    const logger = new StderrLogger(LogLevel.WARN);
    logger.debug("Debug msg");
    logger.info("Info msg");
    expect(stderrChunks.length).toBe(0);

    logger.warn("Warn msg");
    expect(stderrChunks.length).toBe(1);
    expect(stderrChunks[0]).toContain("[WARN] Warn msg");

    logger.error("Error msg");
    expect(stderrChunks.length).toBe(2);
    expect(stderrChunks[1]).toContain("[ERROR] Error msg");
  });

  it("should support child loggers with namespace prefix", () => {
    const rootLogger = new StderrLogger(LogLevel.INFO, "root");
    const childLogger = rootLogger.child("bridge");

    childLogger.info("Bridge connected");
    expect(stderrChunks.length).toBe(1);
    expect(stderrChunks[0]).toContain("[INFO] [root:bridge] Bridge connected");
  });
});