import type { ResolveLogger } from "./log.js";
export type Locale = "en" | "ko";
export declare const PLUGIN_BRAND = "opencode-resolve";
/** Resolve a Locale from explicit config (`"ko"|"en"|"auto"`) or env. */
export declare function resolveLocale(configured: string | undefined, envLang: string | undefined): Locale;
/** Bracketed brand for the currently-active agent. */
export declare function brand(agent: string | undefined): string;
/** Friendly display name per agent (used in role-play narration). */
export declare function agentDisplayName(agent: string | undefined, locale: Locale): string;
export type MessageKey = "reminder.ralphLoopText" | "system.driveResolution" | "system.projectKnowledge" | "system.contextDocs" | "system.verifyCommands" | "system.typescriptMandatory" | "system.failuresHeader" | "system.failuresFooter" | "system.strategyPivotHeader" | "system.strategyPivotBody" | "system.strategyPivotTail" | "system.ralphHeader" | "system.ralphKeepGoing" | "system.sessionStats" | "system.iterationWarning" | "system.dispatchEscalate" | "system.dispatchStop" | "system.dispatchPivot" | "compaction.contextHeader" | "tool.edit" | "tool.write" | "tool.bash" | "tool.task" | "tool.glob" | "tool.grep" | "tool.read" | "tool.webfetch" | "tool.todowrite" | "dispatch.toSubagent" | "dispatch.fromResolver" | "dispatch.coder" | "dispatch.reviewer" | "dispatch.deepReviewer" | "dispatch.explorer" | "dispatch.planner" | "dispatch.architect" | "dispatch.researcher" | "dispatch.debugger" | "dispatch.completed" | "dispatch.failed" | "narration.editing" | "narration.searching" | "narration.reading" | "narration.thinking" | "narration.bashing" | "narration.compacting" | "narration.writing" | "narration.testing" | "narration.typechecking" | "narration.linting" | "narration.git" | "narration.checkpoint" | "narration.fetch" | "narration.todo" | "narration.diagnostics" | "narration.context" | "narration.verifyPass" | "narration.verifyFail" | "narration.idle" | "strategy.smallerPieces" | "strategy.differentFile" | "strategy.readTest" | "strategy.checkImports" | "strategy.searchSimilar" | "strategy.rereadFile" | "strategy.tryDifferent" | "strategy.useDiagnostics" | "strategy.reviewDiff" | "strategy.suggestionLabel";
type Params = Record<string, string | number>;
/** Render a message in the requested locale. Picks a random variant if multiple are defined. */
export declare function t(key: MessageKey, locale: Locale, params?: Params): string;
/** Compose `[agent] message` for session-time nudges. */
export declare function brandedMessage(agent: string | undefined, locale: Locale, key: MessageKey, params?: Params): string;
/** Compose `[opencode-resolve] message` for plugin-level notices. */
export declare function pluginMessage(locale: Locale, key: MessageKey, params?: Params): string;
/**
 * Render a context-bound message — always English, regardless of session locale.
 * Use for everything that lands in LLM context (system reminders, tool definitions,
 * end-of-turn reminders that become part of conversation history).
 */
export declare function contextMessage(agent: string | undefined, key: MessageKey, params?: Params): string;
/**
 * Role-play narration, now routed to the structured file logger.
 *
 * History: this used to write to stdout, which conflicted with the TUI's
 * screen-redraw cycle (lines appeared doubled). Toast, the TUI-plugin module
 * (impossible under the V1 plugin format), and `experimental.text.complete`
 * (token cost) were all rejected, so it became a no-op — which left the plugin
 * with zero live visibility. It now writes the rendered message to the
 * per-session file logger (`state.logger`), which has none of those downsides:
 * no stdout corruption, no tokens, and `tail -f .opencode/resolve.log` gives
 * live output. The stderr mirror stays opt-in via OPENCODE_RESOLVE_DEBUG=1.
 *
 * Quiet by default when no logger is wired (back-compat with call sites that
 * predate the logger field).
 */
export declare function narrate(state: {
    locale: Locale;
    currentAgent?: string;
    logger?: Pick<ResolveLogger, "log">;
}, key: MessageKey, params?: Params): void;
/** All registered message keys, derived from the English table. */
export declare const ALL_MESSAGE_KEYS: ReadonlyArray<MessageKey>;
export {};
