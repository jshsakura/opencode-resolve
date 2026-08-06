import { ProjectContext, ResolveConfig } from "./types.js";
import type { Locale } from "./messages.js";
import type { ResolveLogger } from "./log.js";

export const DIAGNOSTICS_TTL_MS = 30_000;
export const FAILURE_PATTERN_TTL_MS = 120_000;
export const FAILURE_THRESHOLD = 10;
export const STRATEGY_PIVOT_THRESHOLD = 20;
export const EDIT_HOTSPOT_THRESHOLD = 10;
export const EDIT_HOTSPOT_TTL_MS = 600_000;

// Ralph Loop: dispatch lifecycle thresholds. The resolver→coder loop must
// close: dispatch → verify → (fail: diagnose+redispatch | pass: done).
// After DISPATCH_STOP_THRESHOLD consecutive failed dispatches, force a STOP &
// report. After DISPATCH_PIVOT_THRESHOLD, force an architect rethink.
export const DISPATCH_STOP_THRESHOLD = 3;
export const DISPATCH_PIVOT_THRESHOLD = 6;

export interface SessionState {
  storedConfig?: ResolveConfig;
  storedProjectContext?: ProjectContext;

  recentDiagnostics: Map<string, { errors: number; warnings: number; timestamp: number; errorMessages?: { line: number; message: string }[] }>;
  failurePatterns: Map<string, { count: number; lastMessage: string; timestamp: number }>;
  failureWarnings: string[];
  totalFailures: number;

  editHotspots: Map<string, { count: number; lastEditTime: number }>;
  totalEdits: number;
  totalToolCalls: number;
  totalOutputBytes: number;
  sessionStartTime: number;
  loopWarnings: string[];
  lastStrategyHint: string;

  // Ralph Loop: dispatch lifecycle tracking (resolver→coder verify loop).
  // consecutiveDispatchFailures counts failed task dispatches in a row; a
  // successful dispatch resets it.
  consecutiveDispatchFailures: number;
  lastDispatchAgent?: string;
  lastDispatchSucceeded?: boolean;
  lastDispatchAt?: number;

  currentAgent?: string;
  locale: Locale;

  // Structured file logger. Injected by the plugin entry (src/index.ts) once
  // the working directory is known; hooks and narrate() read it from here.
  logger?: ResolveLogger;
}

export function createSessionState(): SessionState {
  return {
    recentDiagnostics: new Map(),
    failurePatterns: new Map(),
    failureWarnings: [],
    totalFailures: 0,
    editHotspots: new Map(),
    totalEdits: 0,
    totalToolCalls: 0,
    totalOutputBytes: 0,
    sessionStartTime: Date.now(),
    loopWarnings: [],
    lastStrategyHint: "",
    consecutiveDispatchFailures: 0,
    locale: "en"
  };
}
