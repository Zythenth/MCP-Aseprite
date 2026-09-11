import util from "node:util";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

export function parseLogLevel(levelStr?: string): LogLevel {
  if (!levelStr) return LogLevel.INFO;
  switch (levelStr.toUpperCase().trim()) {
    case "DEBUG":
      return LogLevel.DEBUG;
    case "INFO":
      return LogLevel.INFO;
    case "WARN":
    case "WARNING":
      return LogLevel.WARN;
    case "ERROR":
      return LogLevel.ERROR;
    case "SILENT":
    case "NONE":
      return LogLevel.SILENT;
    default:
      return LogLevel.INFO;
  }
}

export class StderrLogger {
  private level: LogLevel;
  private prefix?: string;

  constructor(level: LogLevel = LogLevel.INFO, prefix?: string) {
    this.level = level;
    this.prefix = prefix;
  }

  public setLevel(level: LogLevel | string): void {
    this.level = typeof level === "string" ? parseLogLevel(level) : level;
  }

  public getLevel(): LogLevel {
    return this.level;
  }

  public child(prefix: string): StderrLogger {
    const combinedPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new StderrLogger(this.level, combinedPrefix);
  }

  private write(levelTag: string, message: any, ...args: any[]): void {
    const timestamp = new Date().toISOString();
    const formatted = util.format(message, ...args);
    const prefixStr = this.prefix ? ` [${this.prefix}]` : "";
    process.stderr.write(`[${timestamp}] [${levelTag}]${prefixStr} ${formatted}\n`);
  }

  public debug(message: any, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      this.write("DEBUG", message, ...args);
    }
  }

  public info(message: any, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      this.write("INFO", message, ...args);
    }
  }

  public warn(message: any, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      this.write("WARN", message, ...args);
    }
  }

  public error(message: any, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      this.write("ERROR", message, ...args);
    }
  }
}

// Global logger instance
const initialLevel = process.env.ASEPRITE_LOG_LEVEL
  ? parseLogLevel(process.env.ASEPRITE_LOG_LEVEL)
  : (process.env.DEBUG && process.env.DEBUG !== "0" && process.env.DEBUG.toLowerCase() !== "false")
    ? LogLevel.DEBUG
    : LogLevel.INFO;

export const logger = new StderrLogger(initialLevel);

// Stdio Guard State
interface OriginalConsoleMethods {
  log: typeof console.log;
  info: typeof console.info;
  warn: typeof console.warn;
  error: typeof console.error;
  debug: typeof console.debug;
  dir: typeof console.dir;
  trace: typeof console.trace;
}

let originalConsole: OriginalConsoleMethods | null = null;

export function installStdoutGuard(): void {
  if (originalConsole !== null) {
    return; // Idempotent
  }

  originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    dir: console.dir,
    trace: console.trace,
  };

  console.log = (...args: any[]) => {
    logger.info(util.format(...args));
  };

  console.info = (...args: any[]) => {
    logger.info(util.format(...args));
  };

  console.warn = (...args: any[]) => {
    logger.warn(util.format(...args));
  };

  console.error = (...args: any[]) => {
    logger.error(util.format(...args));
  };

  console.debug = (...args: any[]) => {
    logger.debug(util.format(...args));
  };

  console.dir = (item: any, options?: any) => {
    logger.debug(util.inspect(item, options));
  };

  console.trace = (...args: any[]) => {
    const err = new Error();
    const stack = err.stack ? err.stack.split("\n").slice(2).join("\n") : "";
    const formatted = util.format(...args);
    logger.debug(`Trace: ${formatted}\n${stack}`);
  };
}

export function uninstallStdoutGuard(): void {
  if (!originalConsole) return;
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.debug = originalConsole.debug;
  console.dir = originalConsole.dir;
  console.trace = originalConsole.trace;
  originalConsole = null;
}

export function isStdoutGuardInstalled(): boolean {
  return originalConsole !== null;
}

// Auto-install guard on module evaluation when running outside test frameworks
const isTestEnv = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
const isGuardDisabled = Boolean(process.env.ASEPRITE_NO_STDOUT_GUARD);

if (!isTestEnv && !isGuardDisabled) {
  installStdoutGuard();
}