import { DIAGNOSTICS_TTL_MS, FAILURE_PATTERN_TTL_MS, FAILURE_THRESHOLD, STRATEGY_PIVOT_THRESHOLD, EDIT_HOTSPOT_THRESHOLD, DISPATCH_STOP_THRESHOLD, DISPATCH_PIVOT_THRESHOLD } from "../state.js";
import { classifyBashCommand, detectProjectContext } from "../utils.js";
import { loadResolveConfig, applyResolveConfig } from "../config.js";
import { contextMessage, narrate, resolveLocale, t, agentDisplayName, brand, PLUGIN_BRAND } from "../messages.js";
import { VALID_AGENT_NAMES } from "../agents.js";
// Agents this plugin registers. Hooks that modify chat/tool behavior gate on
// isActiveResolve() so native opencode agents (build/plan/default chat) pass
// through unmodified — the plugin only intervenes when a resolve agent drives
// the current turn.
const RESOLVE_AGENTS = new Set(VALID_AGENT_NAMES);
function capTemperature(current, cap) {
    return typeof current === "number" && Number.isFinite(current)
        ? Math.min(current, cap)
        : cap;
}
const DISPATCH_KEYS = {
    coder: "dispatch.coder",
    reviewer: "dispatch.reviewer",
    "deep-reviewer": "dispatch.deepReviewer",
    explorer: "dispatch.explorer",
    planner: "dispatch.planner",
    architect: "dispatch.architect",
    researcher: "dispatch.researcher",
    debugger: "dispatch.debugger",
};
function extractSubagentType(args) {
    if (!args || typeof args !== "object")
        return undefined;
    const candidate = args.subagent_type ?? args.subagentType ?? args.agent ?? args.type ?? args.role;
    return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}
function extractDispatchGoal(args) {
    if (!args || typeof args !== "object")
        return "";
    const candidate = args.description ?? args.title ?? args.task ?? args.prompt;
    if (typeof candidate !== "string")
        return "";
    const trimmed = candidate.trim().split("\n")[0] ?? "";
    return trimmed.length > 80 ? trimmed.slice(0, 77) + "…" : trimmed;
}
// Ralph Loop: does a bash command run one of the project's verify commands
// (typecheck / lint / test)? Used to clear the awaitingVerify flag so the
// loop can tell the resolver the edit was actually checked.
function isVerifyCommand(cmd, verifyCommands) {
    if (typeof cmd !== "string" || cmd.length === 0)
        return false;
    if (!Array.isArray(verifyCommands) || verifyCommands.length === 0)
        return false;
    const normalized = cmd.trim();
    return verifyCommands.some((vc) => typeof vc === "string" && vc.length > 0 && normalized.includes(vc));
}
// Ralph Loop: classify a task (subagent dispatch) result as success/failure.
// A dispatch is failed if the tool errored or carried an error in metadata.
function dispatchFailed(output) {
    if (Boolean(output?.error))
        return true;
    if (typeof output?.metadata === "object" && output.metadata?.error)
        return true;
    return false;
}
export function getHooks(directory, options, sessionState) {
    const narrateToolStart = (input, output) => {
        const tool = input.tool;
        if (tool === "task") {
            const sub = extractSubagentType(output?.args ?? input?.args);
            if (!sub)
                return;
            const goal = extractDispatchGoal(output?.args ?? input?.args);
            const to = agentDisplayName(sub, sessionState.locale);
            const key = DISPATCH_KEYS[sub] ?? "dispatch.fromResolver";
            narrate(sessionState, key, { to, goal });
            return;
        }
        if (tool === "edit" || tool === "write") {
            narrate(sessionState, "narration.editing");
            return;
        }
        if (tool === "grep" || tool === "glob") {
            narrate(sessionState, "narration.searching");
            return;
        }
        if (tool === "read") {
            narrate(sessionState, "narration.reading");
            return;
        }
        if (tool === "bash") {
            narrate(sessionState, "narration.bashing");
            return;
        }
    };
    const narrateToolEnd = (input, output) => {
        if (input.tool !== "task")
            return;
        const sub = extractSubagentType(input?.args);
        if (!sub)
            return;
        const to = agentDisplayName(sub, sessionState.locale);
        const errorPresent = Boolean(output?.error) ||
            (typeof output?.metadata === "object" && output.metadata?.error);
        narrate(sessionState, errorPresent ? "dispatch.failed" : "dispatch.completed", { to });
    };
    // Is the current turn driven by an agent this plugin registered? Native
    // opencode agents (build/plan/default chat) return false → hooks no-op.
    const isActiveResolve = () => RESOLVE_AGENTS.has(sessionState.currentAgent ?? "");
    return {
        event: async (input) => {
            const evt = input.event;
            // LSP diagnostics tracking
            if (evt.type === "lsp.client.diagnostics") {
                const props = evt.properties;
                if (props.path) {
                    const data = evt;
                    const diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics
                        : Array.isArray(data.errors) ? data.errors
                            : [];
                    const errors = diagnostics.filter((d) => d.severity === 1 || d.severity === "error").length;
                    const warnings = diagnostics.filter((d) => d.severity === 2 || d.severity === "warning").length;
                    if (errors > 0 || warnings > 0) {
                        sessionState.recentDiagnostics.set(props.path, { errors, warnings, timestamp: Date.now() });
                    }
                    else {
                        sessionState.recentDiagnostics.delete(props.path);
                    }
                    const now = Date.now();
                    for (const [key, value] of sessionState.recentDiagnostics) {
                        if (now - value.timestamp > DIAGNOSTICS_TTL_MS)
                            sessionState.recentDiagnostics.delete(key);
                    }
                }
            }
            // Tool execution failure tracking via message.part.updated
            // When a tool result part appears with a non-zero exit code, track it
            if (evt.type === "message.part.updated") {
                const props = evt.properties;
                const part = props.part;
                if (part?.type === "tool-result" || part?.type === "tool-result") {
                    const exitCode = part?.metadata?.exitCode ?? part?.output?.metadata?.exitCode;
                    const toolName = part?.toolID ?? part?.tool ?? "";
                    if (exitCode !== undefined && exitCode !== 0 && typeof toolName === "string") {
                        const existing = sessionState.failurePatterns.get(toolName);
                        const msg = String(part?.output ?? part?.error ?? "").slice(0, 200);
                        if (existing) {
                            existing.count++;
                            existing.lastMessage = msg;
                            existing.timestamp = Date.now();
                        }
                        else {
                            sessionState.failurePatterns.set(toolName, { count: 1, lastMessage: msg, timestamp: Date.now() });
                        }
                        // Prune stale entries
                        const now = Date.now();
                        for (const [k, v] of sessionState.failurePatterns) {
                            if (now - v.timestamp > FAILURE_PATTERN_TTL_MS)
                                sessionState.failurePatterns.delete(k);
                        }
                        // Generate warnings for recurring failures
                        sessionState.totalFailures++;
                        sessionState.failureWarnings = [];
                        for (const [k, v] of sessionState.failurePatterns) {
                            if (v.count >= FAILURE_THRESHOLD) {
                                sessionState.failureWarnings.push(`Tool '${k}' failed ${v.count} times. Last: ${v.lastMessage}`);
                            }
                        }
                    }
                }
            }
            // Track session errors for recurring issues
            if (evt.type === "session.error") {
                const data = evt;
                const msg = String(data?.error?.message ?? data?.message ?? "").slice(0, 200);
                if (msg) {
                    const existing = sessionState.failurePatterns.get("session");
                    if (existing) {
                        existing.count++;
                        existing.lastMessage = msg;
                        existing.timestamp = Date.now();
                    }
                    else {
                        sessionState.failurePatterns.set("session", { count: 1, lastMessage: msg, timestamp: Date.now() });
                    }
                    sessionState.failureWarnings = [];
                    sessionState.totalFailures++;
                    for (const [, v] of sessionState.failurePatterns) {
                        if (v.count >= FAILURE_THRESHOLD) {
                            sessionState.failureWarnings.push(`Session error repeated ${v.count} times: ${v.lastMessage}`);
                        }
                    }
                }
            }
        },
        config: async (config) => {
            const resolveConfig = await loadResolveConfig(directory, config, options);
            const projectContext = await detectProjectContext(directory);
            sessionState.storedConfig = resolveConfig;
            sessionState.storedProjectContext = projectContext;
            sessionState.locale = resolveLocale(resolveConfig.language, process.env.LANG);
            applyResolveConfig(config, resolveConfig, projectContext);
            // Auto-update removed — see src/utils.ts header. Users update manually.
        },
        "shell.env": async (_input, output) => {
            output.env = {
                ...output.env,
                CI: "true",
                DEBIAN_FRONTEND: "noninteractive",
                GIT_TERMINAL_PROMPT: "0",
                GIT_EDITOR: "true",
                GIT_PAGER: "cat",
                PAGER: "cat",
                GCM_INTERACTIVE: "never",
                npm_config_yes: "true",
                PIP_NO_INPUT: "1",
                NODE_OPTIONS: process.env.NODE_OPTIONS ?? "", // preserve existing
                NO_COLOR: output.env?.NO_COLOR, // preserve if set
                LANG: output.env?.LANG ?? "en_US.UTF-8", // consistent locale
            };
        },
        "permission.ask": async (input, output) => {
            if (input.type === "bash") {
                const cmd = typeof input.pattern === "string"
                    ? input.pattern
                    : Array.isArray(input.pattern)
                        ? input.pattern.join(" ")
                        : "";
                const action = classifyBashCommand(cmd);
                // Banned/dangerous commands are denied universally (protect everyone).
                if (action === "deny") {
                    output.status = "deny";
                }
                else if (action === "allow" && isActiveResolve()) {
                    // Auto-approve safe commands only when a resolve agent drives the turn;
                    // native agents keep opencode's own permission flow.
                    output.status = "allow";
                }
            }
        },
        "chat.params": async (input, output) => {
            if (typeof input.agent === "string" && input.agent.length > 0) {
                sessionState.currentAgent = input.agent;
            }
            // Only shape params for resolve agents — native opencode agents (build/plan)
            // pass through so the plugin never alters their model behavior.
            if (!isActiveResolve())
                return;
            // Deterministic params keep the resolve loop on-rails (coding benefits from low temperature).
            output.temperature = capTemperature(output.temperature, 0.4);
            if (output.maxOutputTokens === undefined || output.maxOutputTokens > 16384) {
                output.maxOutputTokens = 16384;
            }
            if (output.topP === undefined || output.topP > 0.9) {
                output.topP = 0.85;
            }
            // Read-only agents: lower temperature always
            const readOnlyAgents = new Set(["reviewer", "deep-reviewer", "explorer", "planner", "researcher", "architect"]);
            if (readOnlyAgents.has(input.agent)) {
                output.temperature = capTemperature(output.temperature, 0.3);
            }
        },
        "tool.definition": async (input, output) => {
            // Don't pollute tool descriptions for native agents — resolve agents only.
            if (!isActiveResolve())
                return;
            const prefix = `[${PLUGIN_BRAND}]`;
            const hintKeys = {
                edit: "tool.edit",
                write: "tool.write",
                bash: "tool.bash",
                task: "tool.task",
                glob: "tool.glob",
                grep: "tool.grep",
                read: "tool.read",
                webfetch: "tool.webfetch",
                todowrite: "tool.todowrite",
            };
            const key = hintKeys[input.toolID];
            if (key) {
                // Tool definitions are shipped as tool descriptions on every turn, so
                // keep them English (context-bound) regardless of session locale.
                output.description = output.description + `\n${prefix} ${t(key, "en")}`;
            }
        },
        "command.execute.before": async (_input, output) => {
            // Only prepend the discipline reminder when a resolve agent drives the turn.
            if (!isActiveResolve())
                return;
            // Prepend a discipline reminder to all command executions.
            // The parts array is typed as Part[] — TextPart requires id/sessionID/messageID.
            // We provide placeholder values; OpenCode replaces them if needed.
            output.parts.push({
                id: "",
                sessionID: "",
                messageID: "",
                type: "text",
                text: `[${PLUGIN_BRAND}] ${t("system.driveResolution", "en")}`,
            });
        },
        "tool.execute.before": async (input, output) => {
            // Native agents get unmodified tool execution — resolve agents only.
            if (!isActiveResolve())
                return;
            // For bash: inject hints for common mistakes
            if (input.tool === "bash" && output.args && typeof output.args === "object") {
                const cmd = output.args.command ?? output.args.cmd;
                if (typeof cmd === "string" && cmd.includes("git commit") && !cmd.includes("-m")) {
                    output.args = { ...output.args, _resolve_hint: "Use 'git commit -m \"message\"' — interactive commit is blocked." };
                }
            }
            // For write: warn about overwriting existing files
            if (input.tool === "write" && output.args && typeof output.args === "object") {
                const filePath = output.args.filePath ?? output.args.path;
                if (typeof filePath === "string") {
                    const meta = { ...(output.args._resolve_meta ?? {}) };
                    meta._resolve_write_note = "Verify file contents after writing. Use edit instead of write for existing files when possible.";
                    output.args = { ...output.args, _resolve_meta: meta };
                }
            }
            // Role-play narration → terminal only. Does NOT enter LLM context.
            narrateToolStart(input, output);
        },
        "chat.headers": async (input, output) => {
            const providerID = input.provider?.info?.id ?? "";
            // For GLM providers: add retry-after hint to avoid rate limiting
            if (providerID.includes("zai") || providerID.includes("glm") || providerID.includes("bigmodel")) {
                output.headers["X-Custom-Retry-Strategy"] = "exponential";
            }
        },
        "tool.execute.after": async (input, output) => {
            // Only track/count/instrument tool calls driven by resolve agents.
            if (!isActiveResolve())
                return;
            // Count every completed tool call from the reliable tool.execute.after
            // hook (the message-stream event hook was unreliable + double-counted).
            sessionState.totalToolCalls++;
            if (input.tool === "edit" || input.tool === "write") {
                sessionState.totalEdits++;
                const verifyCommands = sessionState.storedProjectContext?.verifyCommands;
                const meta = { ...(output.metadata ?? {}) };
                if (verifyCommands && verifyCommands.length > 0) {
                    meta._resolve_verify_hint = verifyCommands[0];
                }
                // Attach LSP diagnostics for the edited file if available
                const args = input.args;
                const editedPath = args?.filePath;
                if (editedPath) {
                    const diag = sessionState.recentDiagnostics.get(editedPath);
                    if (diag && Date.now() - diag.timestamp < DIAGNOSTICS_TTL_MS) {
                        meta._resolve_lsp_errors = diag.errors;
                        meta._resolve_lsp_warnings = diag.warnings;
                    }
                    // Ralph Loop: track edit hotspot
                    const existing = sessionState.editHotspots.get(editedPath);
                    if (existing) {
                        existing.count++;
                        existing.lastEditTime = Date.now();
                    }
                    else {
                        sessionState.editHotspots.set(editedPath, { count: 1, lastEditTime: Date.now() });
                    }
                    // Ralph Loop: inject loop warning into metadata
                    const hotspot = sessionState.editHotspots.get(editedPath);
                    if (hotspot && hotspot.count >= EDIT_HOTSPOT_THRESHOLD) {
                        meta._resolve_loop_warning = `This file has been edited ${hotspot.count} times. Consider a different approach.`;
                    }
                }
                output.metadata = meta;
                // Ralph Loop: an edit just happened — mark that verification is now
                // required before the resolver may report completion. Cleared when a
                // verify command (typecheck/lint/test) runs via bash.
                sessionState.awaitingVerify = true;
                sessionState.awaitingVerifyFile = editedPath;
                // Ralph Loop: update sessionState.loopWarnings after every edit/write
                sessionState.loopWarnings = [];
                for (const [file, data] of sessionState.editHotspots) {
                    if (data.count >= EDIT_HOTSPOT_THRESHOLD) {
                        sessionState.loopWarnings.push(`File '${file}' edited ${data.count} times — consider a different approach for this file. Keep iterating.`);
                    }
                }
            }
            // Role-play narration → terminal only. Does NOT enter LLM context.
            narrateToolEnd(input, output);
            // Ralph Loop: dispatch lifecycle — track resolver→coder results so the
            // loop closes. A failed dispatch must trigger diagnosis before retry;
            // repeated failures escalate (diagnose → STOP → architect pivot).
            if (input.tool === "task") {
                const sub = extractSubagentType(input?.args);
                const failed = dispatchFailed(output);
                sessionState.lastDispatchAgent = sub;
                sessionState.lastDispatchSucceeded = !failed;
                sessionState.lastDispatchAt = Date.now();
                if (failed) {
                    sessionState.consecutiveDispatchFailures++;
                }
                else {
                    sessionState.consecutiveDispatchFailures = 0;
                }
                // Attach a directive the resolver sees in tool metadata.
                const dmeta = { ...(output.metadata ?? {}) };
                const c = sessionState.consecutiveDispatchFailures;
                if (failed) {
                    if (c >= DISPATCH_PIVOT_THRESHOLD) {
                        dmeta._resolve_loop_directive = `Ralph Loop: ${c} consecutive dispatch failures. Dispatch ARCHITECT to rethink the approach.`;
                    }
                    else if (c >= DISPATCH_STOP_THRESHOLD) {
                        dmeta._resolve_loop_directive = `Ralph Loop: ${c} consecutive dispatch failures. STOP — revert the last change and report to the user exactly what is blocked.`;
                    }
                    else {
                        dmeta._resolve_loop_directive = `Ralph Loop: ${sub ?? "subagent"} dispatch failed (${c}x). Diagnose the ROOT CAUSE before re-dispatching. Do NOT retry the same way.`;
                    }
                }
                output.metadata = dmeta;
            }
            // For bash: extract key error lines from failing commands
            if (input.tool === "bash") {
                // Ralph Loop: running a verify command clears the awaitingVerify flag —
                // the resolver has now checked the edit it made.
                const cmd = input.args?.command ?? input.args?.cmd;
                if (isVerifyCommand(cmd, sessionState.storedProjectContext?.verifyCommands)) {
                    sessionState.awaitingVerify = false;
                    sessionState.awaitingVerifyFile = undefined;
                }
                const outputText = typeof output.output === "string" ? output.output
                    : output.output?.output ?? "";
                const exitCode = output.metadata?.exitCode ?? output.output?.metadata?.exitCode;
                if (exitCode && exitCode !== 0 && typeof outputText === "string") {
                    const errorLines = outputText.split("\n")
                        .filter((l) => /\b(error|Error|ERROR|fail|FAIL|FAILED|cannot|Cannot|TypeError|SyntaxError|ReferenceError)\b/.test(l))
                        .slice(0, 5);
                    if (errorLines.length > 0) {
                        const meta = { ...(output.metadata ?? {}) };
                        meta._resolve_key_errors = errorLines;
                        output.metadata = meta;
                    }
                }
            }
        },
        "experimental.session.compacting": async (_input, output) => {
            // Only preserve resolve-loop context; native compaction is untouched.
            if (!isActiveResolve())
                return;
            narrate(sessionState, "narration.compacting");
            const ctx = sessionState.storedProjectContext;
            const cfg = sessionState.storedConfig;
            if (!ctx && !cfg)
                return;
            const contextLines = [];
            // Tier info
            if (cfg?.tier)
                contextLines.push(`Tier: ${cfg.tier}.`);
            // Project context
            if (ctx?.knowledgeFiles.length) {
                contextLines.push(`Project knowledge files: ${ctx.knowledgeFiles.join(", ")}.`);
            }
            if (ctx?.contextFiles.length) {
                contextLines.push(`Context docs: ${ctx.contextFiles.slice(0, 20).join(", ")}.`);
            }
            if (ctx?.verifyCommands.length) {
                contextLines.push(`Verify commands: ${ctx.verifyCommands.join("; ")}.`);
            }
            if (ctx?.hasTypeScript) {
                contextLines.push("TypeScript project — type safety is mandatory.");
            }
            if (ctx?.packageManager) {
                contextLines.push(`Package manager: ${ctx.packageManager}.`);
            }
            // Active failure warnings
            if (sessionState.failureWarnings.length > 0) {
                contextLines.push(`Active warnings: ${sessionState.failureWarnings.join("; ")}`);
            }
            // Ralph Loop: preserve loop state
            if (sessionState.loopWarnings.length > 0) {
                contextLines.push(`Loop warnings: ${sessionState.loopWarnings.join("; ")}`);
            }
            // Ralph Loop: preserve session stats
            if (sessionState.totalEdits > 0) {
                contextLines.push(`Session stats: ${sessionState.totalEdits} edits, ${sessionState.totalToolCalls} tool calls.`);
            }
            if (contextLines.length > 0) {
                output.context.push(`[${PLUGIN_BRAND}] ` + t("compaction.contextHeader", "en", { body: contextLines.join(" ") }));
            }
        },
        "experimental.chat.messages.transform": async (_input, output) => {
            // Rewrite passive language only within resolve turns — native chat is verbatim.
            if (!isActiveResolve())
                return;
            const replacements = [
                // Exact: default OpenCode "continue" prompt
                ["Summarize the task tool output above and continue with your task.",
                    "Analyze the subtask result above. If it succeeded, continue. If it failed, diagnose and retry. Report completion only when verified."],
                // Regex: any "Summarize ... and continue" variant
                [/Summarize the .+ output above and continue/i,
                    "Analyze the result above. If it succeeded, continue to the next step. If it failed, diagnose root cause and retry with a fix."],
                // Regex: generic "continue with your task" ending
                [/continue with your task\.$/i,
                    "continue driving toward verified completion."],
                // Regex: "I've completed..." without verification
                [/I('ve| have) (completed|finished|done) (the )?.*\.$/i,
                    "Verify your changes pass typecheck/lint/test before reporting completion."],
                // Regex: passive "Let me know if..."
                [/let me know if (you|you'd like) .*/i,
                    "Proceed with the next step. If blocked, diagnose and report specifically what failed."],
                // Regex: "Would you like me to..."
                [/would you like me to .*/i,
                    "Proceed with the most effective next step autonomously."],
                // Ralph Loop: detect "I'll try again" — encourage different approach, don't stop
                [/I('ll| will) (try again|retry|attempt again|redo)/i,
                    "Diagnose the ROOT CAUSE of the failure, then apply a DIFFERENT fix. The Ralph Loop keeps going."],
                // Regex: "I'm not sure" — uncertainty without action
                [/I('m| am) (not sure|unsure|uncertain) .*/i,
                    "Resolve uncertainty by reading the code, checking diagnostics, or using resolve-search. Keep driving."],
                // Regex: "This might work" — low confidence
                [/this (might|should|could|may) work/i,
                    "CONFIRM it works by running verification. Do not assume."],
                // Regex: "It seems to be working" — unverified claim
                [/it (seems|appears|looks) to (be )?(working|fine|correct)/i,
                    "VERIFY with typecheck/lint/test. 'Seems to work' is not evidence."],
            ];
            for (const msg of output.messages) {
                for (const part of msg.parts) {
                    if (part.type !== "text")
                        continue;
                    for (const [pattern, replacement] of replacements) {
                        if (typeof pattern === "string" ? part.text === pattern : pattern.test(part.text)) {
                            part.text = replacement;
                            break; // first match wins
                        }
                    }
                }
            }
        },
        "experimental.compaction.autocontinue": async (_input, output) => {
            // Only force auto-continue for resolve agents — native agents keep their own cadence.
            if (!isActiveResolve())
                return;
            // Always enable auto-continue — the resolver should keep driving
            output.enabled = true;
        },
        "experimental.chat.system.transform": async (_input, output) => {
            // Inject system context/warnings only into resolve-agent turns — native
            // agents (build/plan/default chat) get their own system prompt untouched.
            if (!isActiveResolve())
                return;
            const ctx = sessionState.storedProjectContext;
            const hasFailures = sessionState.failureWarnings.length > 0;
            const hasLoops = sessionState.loopWarnings.length > 0;
            const hasDispatchFailures = sessionState.consecutiveDispatchFailures > 0;
            const needsVerify = sessionState.awaitingVerify;
            if (!ctx && !hasFailures && !hasLoops && !hasDispatchFailures && !needsVerify)
                return;
            const lines = [];
            const agent = sessionState.currentAgent;
            // All entries below land in LLM context — keep them English.
            if (ctx?.knowledgeFiles.length) {
                lines.push(contextMessage(agent, "system.projectKnowledge", { files: ctx.knowledgeFiles.join(", ") }));
            }
            if (ctx?.contextFiles.length) {
                lines.push(contextMessage(agent, "system.contextDocs", { files: ctx.contextFiles.slice(0, 20).join(", ") }));
            }
            if (ctx?.verifyCommands.length) {
                lines.push(contextMessage(agent, "system.verifyCommands", { commands: ctx.verifyCommands.join("; ") }));
            }
            if (ctx?.hasTypeScript) {
                lines.push(contextMessage(agent, "system.typescriptMandatory"));
            }
            // Inject failure pattern warnings — encourage trying different approaches, don't stop
            if (hasFailures) {
                lines.push(contextMessage(agent, "system.failuresHeader"));
                for (const w of sessionState.failureWarnings.slice(0, 3)) {
                    lines.push(`  - ${w}`);
                }
                lines.push(t("system.failuresFooter", "en"));
            }
            // Strategy Pivot: after many total failures, suggest architect intervention
            if (sessionState.totalFailures >= STRATEGY_PIVOT_THRESHOLD) {
                lines.push(contextMessage(agent, "system.strategyPivotHeader", { count: sessionState.totalFailures }));
                lines.push(t("system.strategyPivotBody", "en"));
                lines.push(t("system.strategyPivotTail", "en"));
            }
            // Ralph Loop: inject strategy hints when same file edited many times
            if (hasLoops) {
                lines.push(contextMessage(agent, "system.ralphHeader"));
                for (const w of sessionState.loopWarnings.slice(0, 3)) {
                    lines.push(`  - ${w}`);
                }
                const strategyKeys = [
                    "strategy.rereadFile",
                    "strategy.tryDifferent",
                    "strategy.useDiagnostics",
                    "strategy.smallerPieces",
                    "strategy.differentFile",
                    "strategy.readTest",
                    "strategy.checkImports",
                    "strategy.searchSimilar",
                ];
                const pickedKey = strategyKeys[Math.floor(Date.now() / 30_000) % strategyKeys.length];
                const hint = t(pickedKey, "en");
                if (hint !== sessionState.lastStrategyHint) {
                    lines.push(`${t("strategy.suggestionLabel", "en")}: ${hint}`);
                    sessionState.lastStrategyHint = hint;
                }
                lines.push(t("system.ralphKeepGoing", "en"));
            }
            // Ralph Loop: inject session context when significant work done
            if (sessionState.totalEdits >= 20 && sessionState.failureWarnings.length > 0) {
                const elapsed = Math.round((Date.now() - sessionState.sessionStartTime) / 1000);
                lines.push(contextMessage(agent, "system.sessionStats", {
                    edits: sessionState.totalEdits,
                    calls: sessionState.totalToolCalls,
                    elapsed,
                }));
                lines.push(t("system.iterationWarning", "en"));
            }
            // Ralph Loop: enforced loop closure — dispatch lifecycle escalation.
            // 1-2 failures: diagnose + retry. 3: STOP. 6+: architect pivot.
            const dc = sessionState.consecutiveDispatchFailures;
            if (dc > 0) {
                if (dc >= DISPATCH_PIVOT_THRESHOLD) {
                    lines.push(contextMessage(agent, "system.dispatchPivot"));
                }
                else if (dc >= DISPATCH_STOP_THRESHOLD) {
                    lines.push(contextMessage(agent, "system.dispatchStop", { count: dc }));
                }
                else {
                    lines.push(contextMessage(agent, "system.dispatchEscalate", {
                        count: dc,
                        agent: sessionState.lastDispatchAgent ?? "subagent",
                    }));
                }
            }
            // Ralph Loop: a pending edit MUST be verified before reporting done.
            if (sessionState.awaitingVerify) {
                lines.push(contextMessage(agent, "system.awaitingVerify", {
                    file: sessionState.awaitingVerifyFile ?? "",
                }));
            }
            if (lines.length > 0) {
                output.system.push(`${brand(undefined)}\n${lines.join("\n")}`);
            }
        },
        "experimental.text.complete": async (_input, output) => {
            // Append verify reminders only to resolve-agent completions — native output is verbatim.
            if (!isActiveResolve())
                return;
            const text = output.text ?? "";
            if (!text)
                return;
            // Detect if this turn involved code changes
            const editSignals = ["```", "edit", "wrote", "changed", "created", "updated", "modified", "deleted", "removed", "added", "renamed"];
            const looksLikeEdit = editSignals.some(s => text.toLowerCase().includes(s));
            // Detect if verification was already mentioned
            const verifySignals = ["verified", "pass", "✅", "tsc --noEmit", "eslint", "npm test", "vitest pass", "all tests pass", "no errors", "0 errors", "build succeeded"];
            const alreadyVerified = verifySignals.some(s => text.toLowerCase().includes(s));
            // Detect if the turn ended with a question or handoff (shouldn't nudge)
            const handoffPatterns = [/\?$/, /let me know/i, /would you like/i, /what do you think/i];
            const isHandoff = handoffPatterns.some(p => p.test(text.trim()));
            // Ralph Loop: detect loop-like patterns in the response text
            const loopSignals = ["trying again", "attempting", "retrying", "second attempt", "third attempt", "another approach", "let me try"];
            const looksLikeLoop = loopSignals.some(s => text.toLowerCase().includes(s));
            if (looksLikeEdit && !alreadyVerified && !isHandoff) {
                output.text = text + "\n\n" + contextMessage(sessionState.currentAgent, "reminder.verify");
            }
            // Ralph Loop: if loop detected in text AND hotspot exists, suggest strategy change
            if (looksLikeLoop && sessionState.loopWarnings.length > 0) {
                output.text = (output.text ?? text) + "\n\n" + contextMessage(sessionState.currentAgent, "reminder.ralphLoopText");
            }
        }
    };
}
