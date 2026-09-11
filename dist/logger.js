import util from "node:util";
export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
    LogLevel[LogLevel["SILENT"] = 4] = "SILENT";
})(LogLevel || (LogLevel = {}));
export function parseLogLevel(levelStr) {
    if (!levelStr)
        return LogLevel.INFO;
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
    level;
    prefix;
    constructor(level = LogLevel.INFO, prefix) {
        this.level = level;
        this.prefix = prefix;
    }
    setLevel(level) {
        this.level = typeof level === "string" ? parseLogLevel(level) : level;
    }
    getLevel() {
        return this.level;
    }
    child(prefix) {
        const combinedPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
        return new StderrLogger(this.level, combinedPrefix);
    }
    write(levelTag, message, ...args) {
        const timestamp = new Date().toISOString();
        const formatted = util.format(message, ...args);
        const prefixStr = this.prefix ? ` [${this.prefix}]` : "";
        process.stderr.write(`[${timestamp}] [${levelTag}]${prefixStr} ${formatted}\n`);
    }
    debug(message, ...args) {
        if (this.level <= LogLevel.DEBUG) {
            this.write("DEBUG", message, ...args);
        }
    }
    info(message, ...args) {
        if (this.level <= LogLevel.INFO) {
            this.write("INFO", message, ...args);
        }
    }
    warn(message, ...args) {
        if (this.level <= LogLevel.WARN) {
            this.write("WARN", message, ...args);
        }
    }
    error(message, ...args) {
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
let originalConsole = null;
export function installStdoutGuard() {
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
    console.log = (...args) => {
        logger.info(util.format(...args));
    };
    console.info = (...args) => {
        logger.info(util.format(...args));
    };
    console.warn = (...args) => {
        logger.warn(util.format(...args));
    };
    console.error = (...args) => {
        logger.error(util.format(...args));
    };
    console.debug = (...args) => {
        logger.debug(util.format(...args));
    };
    console.dir = (item, options) => {
        logger.debug(util.inspect(item, options));
    };
    console.trace = (...args) => {
        const err = new Error();
        const stack = err.stack ? err.stack.split("\n").slice(2).join("\n") : "";
        const formatted = util.format(...args);
        logger.debug(`Trace: ${formatted}\n${stack}`);
    };
}
export function uninstallStdoutGuard() {
    if (!originalConsole)
        return;
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
    console.dir = originalConsole.dir;
    console.trace = originalConsole.trace;
    originalConsole = null;
}
export function isStdoutGuardInstalled() {
    return originalConsole !== null;
}
// Auto-install guard on module evaluation when running outside test frameworks
const isTestEnv = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
const isGuardDisabled = Boolean(process.env.ASEPRITE_NO_STDOUT_GUARD);
if (!isTestEnv && !isGuardDisabled) {
    installStdoutGuard();
}
//# sourceMappingURL=logger.js.map