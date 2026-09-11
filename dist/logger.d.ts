export declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    SILENT = 4
}
export declare function parseLogLevel(levelStr?: string): LogLevel;
export declare class StderrLogger {
    private level;
    private prefix?;
    constructor(level?: LogLevel, prefix?: string);
    setLevel(level: LogLevel | string): void;
    getLevel(): LogLevel;
    child(prefix: string): StderrLogger;
    private write;
    debug(message: any, ...args: any[]): void;
    info(message: any, ...args: any[]): void;
    warn(message: any, ...args: any[]): void;
    error(message: any, ...args: any[]): void;
}
export declare const logger: StderrLogger;
export declare function installStdoutGuard(): void;
export declare function uninstallStdoutGuard(): void;
export declare function isStdoutGuardInstalled(): boolean;
//# sourceMappingURL=logger.d.ts.map