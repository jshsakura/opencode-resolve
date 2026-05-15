export const DIAGNOSTICS_TTL_MS = 30_000;
export const FAILURE_PATTERN_TTL_MS = 120_000;
export const FAILURE_THRESHOLD = 10;
export const STRATEGY_PIVOT_THRESHOLD = 20;
export const EDIT_HOTSPOT_THRESHOLD = 10;
export const EDIT_HOTSPOT_TTL_MS = 600_000;
export function createSessionState() {
    return {
        recentDiagnostics: new Map(),
        failurePatterns: new Map(),
        failureWarnings: [],
        totalFailures: 0,
        editHotspots: new Map(),
        totalEdits: 0,
        totalToolCalls: 0,
        sessionStartTime: Date.now(),
        loopWarnings: [],
        lastStrategyHint: "",
        locale: "en"
    };
}
