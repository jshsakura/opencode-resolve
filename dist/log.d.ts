export type LogLevel = "debug" | "info" | "warn" | "error";
/**
 * Structural logger contract. Kept narrow so `narrate()` can depend on it
 * without importing the full implementation (avoids a messages↔log cycle).
 */
export interface ResolveLogger {
    /** Absolute path of the log file (informational; surfaced to the user). */
    readonly path: string;
    /** Emit one structured line. Never throws — logging must not kill the plugin. */
    log(level: LogLevel, event: string, detail?: string | Record<string, unknown>): void;
}
/**
 * Build a per-plugin-instance logger bound to `directory`.
 * `.opencode/` is created lazily on the first write. Rotation keeps a single
 * `.1` backup once the file exceeds MAX_BYTES. Every write failure is swallowed
 * — a logging error must never break the resolve loop.
 */
export declare function createResolveLogger(directory: string): ResolveLogger;
