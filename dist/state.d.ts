import { ProjectContext, ResolveConfig } from "./types.js";
import type { Locale } from "./messages.js";
import type { ResolveLogger } from "./log.js";
export declare const DIAGNOSTICS_TTL_MS = 30000;
export declare const FAILURE_PATTERN_TTL_MS = 120000;
export declare const FAILURE_THRESHOLD = 10;
export declare const STRATEGY_PIVOT_THRESHOLD = 20;
export declare const EDIT_HOTSPOT_THRESHOLD = 10;
export declare const EDIT_HOTSPOT_TTL_MS = 600000;
export declare const DISPATCH_STOP_THRESHOLD = 3;
export declare const DISPATCH_PIVOT_THRESHOLD = 6;
export interface SessionState {
    storedConfig?: ResolveConfig;
    storedProjectContext?: ProjectContext;
    recentDiagnostics: Map<string, {
        errors: number;
        warnings: number;
        timestamp: number;
        errorMessages?: {
            line: number;
            message: string;
        }[];
    }>;
    failurePatterns: Map<string, {
        count: number;
        lastMessage: string;
        timestamp: number;
    }>;
    failureWarnings: string[];
    totalFailures: number;
    editHotspots: Map<string, {
        count: number;
        lastEditTime: number;
    }>;
    totalEdits: number;
    totalToolCalls: number;
    totalOutputBytes: number;
    sessionStartTime: number;
    loopWarnings: string[];
    lastStrategyHint: string;
    consecutiveDispatchFailures: number;
    lastDispatchAgent?: string;
    lastDispatchSucceeded?: boolean;
    lastDispatchAt?: number;
    currentAgent?: string;
    locale: Locale;
    logger?: ResolveLogger;
}
export declare function createSessionState(): SessionState;
