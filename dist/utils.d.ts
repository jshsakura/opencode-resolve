import { ProjectContext, ResolveConfig } from "./types.js";
export declare const PLUGIN_VERSION: string;
export declare const UPDATE_CHECK_INTERVAL_MS: number;
export declare const UPDATE_CHECK_FILE: string;
export declare const PLUGIN_CACHE_DIR: string;
export declare function runCommand(command: string, cwd: string, timeoutMs: number): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
}>;
export declare function truncateOutput(text: string, maxLen: number): string;
/** Sanitize a string for safe use as a shell argument. Strips dangerous metacharacters. */
export declare function sanitizeShellArg(input: string): string;
export declare function isMissingFileError(error: unknown): boolean;
export declare function formatError(error: unknown): string;
export declare function classifyBashCommand(pattern: string): "allow" | "deny" | "ask";
export declare function existsFile(path: string): Promise<boolean>;
export declare function existsPath(path: string): Promise<boolean>;
export declare function existsDirectory(path: string): Promise<boolean>;
export declare function detectProjectContext(directory: string): Promise<ProjectContext>;
export declare function collectContextFiles(rootDirectory: string, relativeDirectory: string, maxFiles?: number): Promise<string[]>;
export declare function readPluginVersion(): string;
export declare function readUpdateCheckCache(): {
    checkedAt: number;
    latest: string;
} | undefined;
export declare function isNewerVersion(candidate: string, baseline: string): boolean;
export declare function maybeAutoUpdate(): Promise<void>;
export declare function readFirstJson(paths: string[]): Promise<ResolveConfig | undefined>;
export declare const BANNED_COMMANDS: ReadonlyArray<RegExp>;
export declare const DANGEROUS_BASH_PATTERNS: ReadonlyArray<RegExp>;
export declare const ALWAYS_SAFE_COMMANDS: ReadonlyArray<string>;
export declare const SAFE_BASH_PREFIXES: ReadonlyArray<readonly [string, ReadonlyArray<string>]>;
