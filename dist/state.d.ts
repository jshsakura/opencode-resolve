import { ProjectContext, ResolveConfig } from "./types.js";
import type { Locale } from "./messages.js";
export declare const DIAGNOSTICS_TTL_MS = 30000;
export declare const FAILURE_PATTERN_TTL_MS = 120000;
export declare const FAILURE_THRESHOLD = 10;
export declare const STRATEGY_PIVOT_THRESHOLD = 20;
export declare const EDIT_HOTSPOT_THRESHOLD = 10;
export declare const EDIT_HOTSPOT_TTL_MS = 600000;
export interface SessionState {
    storedConfig?: ResolveConfig;
    storedProjectContext?: ProjectContext;
    recentDiagnostics: Map<string, {
        errors: number;
        warnings: number;
        timestamp: number;
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
    sessionStartTime: number;
    loopWarnings: string[];
    lastStrategyHint: string;
    currentAgent?: string;
    locale: Locale;
}
export declare function createSessionState(): SessionState;
