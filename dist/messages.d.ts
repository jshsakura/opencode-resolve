export type Locale = "en" | "ko";
export declare const PLUGIN_BRAND = "opencode-resolve";
/** Resolve a Locale from explicit config (`"ko"|"en"|"auto"`) or env. */
export declare function resolveLocale(configured: string | undefined, envLang: string | undefined): Locale;
/** Bracketed brand for the currently-active agent. */
export declare function brand(agent: string | undefined): string;
/** Friendly display name per agent (used in role-play narration). */
export declare function agentDisplayName(agent: string | undefined, locale: Locale): string;
export type MessageKey = "reminder.verify" | "reminder.ralphLoopText" | "system.driveResolution" | "system.projectKnowledge" | "system.contextDocs" | "system.verifyCommands" | "system.typescriptMandatory" | "system.failuresHeader" | "system.failuresFooter" | "system.strategyPivotHeader" | "system.strategyPivotBody" | "system.strategyPivotTail" | "system.ralphHeader" | "system.ralphKeepGoing" | "system.sessionStats" | "system.iterationWarning" | "system.dispatchEscalate" | "system.dispatchStop" | "system.dispatchPivot" | "system.awaitingVerify" | "compaction.contextHeader" | "tool.edit" | "tool.write" | "tool.bash" | "tool.task" | "tool.glob" | "tool.grep" | "tool.read" | "tool.webfetch" | "tool.todowrite" | "dispatch.toSubagent" | "dispatch.fromResolver" | "dispatch.coder" | "dispatch.reviewer" | "dispatch.deepReviewer" | "dispatch.explorer" | "dispatch.planner" | "dispatch.architect" | "dispatch.researcher" | "dispatch.debugger" | "dispatch.completed" | "dispatch.failed" | "narration.editing" | "narration.searching" | "narration.reading" | "narration.thinking" | "narration.bashing" | "narration.compacting" | "narration.writing" | "narration.testing" | "narration.typechecking" | "narration.linting" | "narration.git" | "narration.checkpoint" | "narration.fetch" | "narration.todo" | "narration.diagnostics" | "narration.context" | "narration.verifyPass" | "narration.verifyFail" | "narration.idle" | "strategy.smallerPieces" | "strategy.differentFile" | "strategy.readTest" | "strategy.checkImports" | "strategy.searchSimilar" | "strategy.rereadFile" | "strategy.tryDifferent" | "strategy.useDiagnostics" | "strategy.reviewDiff" | "strategy.suggestionLabel";
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
 * Live terminal narration has been disabled.
 *
 * Writing to stdout conflicted with the TUI's screen-redraw cycle (lines
 * appeared doubled). Toast was the only clean alternative but was rejected
 * for UX reasons, and a TUI-plugin module is impossible under the V1
 * plugin format (server XOR tui, not both). Adding playful text via
 * `experimental.text.complete` would consume LLM tokens, which the user
 * explicitly rejected.
 *
 * Kept as a no-op so existing hook call sites in `src/hooks/index.ts`
 * don't need changes. Can be re-enabled if a zero-token, non-overlay
 * display channel becomes available.
 */
export declare function narrate(_state: {
    locale: Locale;
    currentAgent?: string;
}, _key: MessageKey, _params?: Params): void;
/** All registered message keys, derived from the English table. */
export declare const ALL_MESSAGE_KEYS: ReadonlyArray<MessageKey>;
export {};
