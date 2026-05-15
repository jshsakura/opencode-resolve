import { SessionState, DIAGNOSTICS_TTL_MS, FAILURE_PATTERN_TTL_MS, FAILURE_THRESHOLD, STRATEGY_PIVOT_THRESHOLD, EDIT_HOTSPOT_TTL_MS, EDIT_HOTSPOT_THRESHOLD } from "../state.js";
import { classifyBashCommand, isMissingFileError, formatError, maybeAutoUpdate, detectProjectContext } from "../utils.js";
import { loadResolveConfig, applyResolveConfig, buildContextInjection } from "../config.js";

function capTemperature(current: unknown, cap: number): number {
  return typeof current === "number" && Number.isFinite(current)
    ? Math.min(current, cap)
    : cap
}

export function getHooks(directory: string, options: any, sessionState: SessionState) {
  return {
event: async (input: any) => {
      const evt = input.event

      // LSP diagnostics tracking
      if (evt.type === "lsp.client.diagnostics") {
        const props = evt.properties as { serverID?: string; path?: string }
        if (props.path) {
          const data = evt as any
          const diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics
            : Array.isArray(data.errors) ? data.errors
            : []
          const errors = diagnostics.filter((d: any) => d.severity === 1 || d.severity === "error").length
          const warnings = diagnostics.filter((d: any) => d.severity === 2 || d.severity === "warning").length
          if (errors > 0 || warnings > 0) {
            sessionState.recentDiagnostics.set(props.path, { errors, warnings, timestamp: Date.now() })
          } else {
            sessionState.recentDiagnostics.delete(props.path)
          }
          const now = Date.now()
          for (const [key, value] of sessionState.recentDiagnostics) {
            if (now - value.timestamp > DIAGNOSTICS_TTL_MS) sessionState.recentDiagnostics.delete(key)
          }
        }
      }

      // Tool execution failure tracking via message.part.updated
      // When a tool result part appears with a non-zero exit code, track it
      if (evt.type === "message.part.updated") {
        const props = evt.properties as { part?: any }
        const part = props.part
        if (part?.type === "tool-result" || part?.type === "tool-result") {
          const exitCode = part?.metadata?.exitCode ?? part?.output?.metadata?.exitCode
          const toolName = part?.toolID ?? part?.tool ?? ""
          if (exitCode !== undefined && exitCode !== 0 && typeof toolName === "string") {
            const existing = sessionState.failurePatterns.get(toolName)
            const msg = String(part?.output ?? part?.error ?? "").slice(0, 200)
            if (existing) {
              existing.count++
              existing.lastMessage = msg
              existing.timestamp = Date.now()
            } else {
              sessionState.failurePatterns.set(toolName, { count: 1, lastMessage: msg, timestamp: Date.now() })
            }
            // Prune stale entries
            const now = Date.now()
            for (const [k, v] of sessionState.failurePatterns) {
              if (now - v.timestamp > FAILURE_PATTERN_TTL_MS) sessionState.failurePatterns.delete(k)
            }
            // Generate warnings for recurring failures
            sessionState.totalFailures++
            sessionState.failureWarnings = []
            for (const [, v] of sessionState.failurePatterns) {
              if (v.count >= FAILURE_THRESHOLD) {
                sessionState.failureWarnings.push(`Tool '${toolName}' failed ${v.count} times. Last: ${v.lastMessage}`)
              }
            }
          }
        }
      }

      // Track session errors for recurring issues
      if (evt.type === "session.error") {
        const data = evt as any
        const msg = String(data?.error?.message ?? data?.message ?? "").slice(0, 200)
        if (msg) {
          const existing = sessionState.failurePatterns.get("session")
          if (existing) {
            existing.count++
            existing.lastMessage = msg
            existing.timestamp = Date.now()
          } else {
            sessionState.failurePatterns.set("session", { count: 1, lastMessage: msg, timestamp: Date.now() })
          }
          sessionState.failureWarnings = []
          sessionState.totalFailures++
          for (const [, v] of sessionState.failurePatterns) {
            if (v.count >= FAILURE_THRESHOLD) {
              sessionState.failureWarnings.push(`Session error repeated ${v.count} times: ${v.lastMessage}`)
            }
          }
        }
      }

      // ── Ralph Loop: track edit tool calls for hotspot detection ────────
      if (evt.type === "message.part.updated") {
        const props = evt.properties as { part?: any }
        const part = props.part
        if (part?.type === "tool-invocation" || part?.type === "tool-use") {
          sessionState.totalToolCalls++
          const toolName = part.tool ?? part.toolName ?? ""
          if (toolName === "edit" || toolName === "write") {
            sessionState.totalEdits++
            const filePath = part.args?.filePath ?? part.args?.path ?? ""
            if (filePath) {
              const existing = sessionState.editHotspots.get(filePath)
              if (existing) {
                existing.count++
                existing.lastEditTime = Date.now()
              } else {
                sessionState.editHotspots.set(filePath, { count: 1, lastEditTime: Date.now() })
              }
              // Prune stale entries
              const now = Date.now()
              for (const [k, v] of sessionState.editHotspots) {
                if (now - v.lastEditTime > EDIT_HOTSPOT_TTL_MS) sessionState.editHotspots.delete(k)
              }
              // Generate loop warnings
              sessionState.loopWarnings = []
              for (const [file, data] of sessionState.editHotspots) {
                if (data.count >= EDIT_HOTSPOT_THRESHOLD) {
                  sessionState.loopWarnings.push(
                    `File '${file}' edited ${data.count} times — consider a different approach. Keep iterating.`,
                  )
                }
              }
            }
          }
        }
      }
    },
config: async (config: any) => {
      const resolveConfig = await loadResolveConfig(directory, config, options)
      const projectContext = await detectProjectContext(directory)
      sessionState.storedConfig = resolveConfig
      sessionState.storedProjectContext = projectContext
      applyResolveConfig(config, resolveConfig, projectContext)
      if (resolveConfig.autoUpdate !== false && process.env.OPENCODE_RESOLVE_NO_AUTO_UPDATE !== "1") {
        maybeAutoUpdate().catch(() => {})
      }
    },
"shell.env": async (_input: any, output: any) => {
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
        NO_COLOR: output.env?.NO_COLOR,              // preserve if set
        LANG: output.env?.LANG ?? "en_US.UTF-8",     // consistent locale
      }
    },
"permission.ask": async (input: any, output: any) => {
      if (input.type === "bash") {
        const cmd = typeof input.pattern === "string"
          ? input.pattern
          : Array.isArray(input.pattern)
            ? input.pattern.join(" ")
            : ""
        const action = classifyBashCommand(cmd)
        if (action !== "ask") output.status = action
      }
    },
"chat.params": async (input: any, output: any) => {
      const profile = sessionState.storedConfig?.profile
      if (profile === "glm") {
        output.temperature = capTemperature(output.temperature, 0.4)
        if (output.maxOutputTokens === undefined || output.maxOutputTokens > 16384) {
          output.maxOutputTokens = 16384
        }
        // GLM: tighter topP for deterministic output
        if (output.topP === undefined || output.topP > 0.9) {
          output.topP = 0.85
        }
      } else if (profile === "gpt") {
        output.temperature = capTemperature(output.temperature, 0.7)
        if (output.maxOutputTokens === undefined) {
          output.maxOutputTokens = 32768
        }
      }
      // Read-only agents: lower temperature always
      const readOnlyAgents = new Set(["reviewer", "deep-reviewer", "explorer", "planner", "researcher", "architect"])
      if (readOnlyAgents.has(input.agent)) {
        output.temperature = capTemperature(output.temperature, 0.3)
      }
      // Write agents: slightly higher temperature for creative problem-solving
      const writeAgents = new Set(["coder", "resolver", "glm", "gpt-coder"])
      if (writeAgents.has(input.agent) && output.temperature === undefined) {
        output.temperature = 0.5
      }
    },
"tool.definition": async (input: any, output: any) => {
      const hints: Record<string, string> = {
        edit: "\n[opencode-resolve] Read the file first. Make the smallest correct change. Verify after editing.",
        write: "\n[opencode-resolve] Only write new files when explicitly needed. Prefer editing existing files.",
        bash: "\n[opencode-resolve] Commands run in non-interactive mode. No interactive editors, pagers, or REPLs. Use -c flags for scripting.",
        task: "\n[opencode-resolve] Dispatch subagents with: TASK (atomic goal), OUTCOME (success criteria), MUST DO, MUST NOT DO, CONTEXT.",
        glob: "\n[opencode-resolve] Use specific patterns. Avoid '**/*' unless genuinely needed — prefer scoped searches.",
        grep: "\n[opencode-resolve] Use specific regex patterns. Combine with include filter for targeted search.",
        read: "\n[opencode-resolve] Read only what you need. Use offset/limit for large files. Check file-info tool for quick metadata.",
        webfetch: "\n[opencode-resolve] Only fetch URLs when you genuinely need external information. Prefer local docs and code first.",
        todowrite: "\n[opencode-resolve] Keep todos current. Mark completed immediately. One in_progress at a time.",
      }
      if (hints[input.toolID]) {
        output.description = output.description + hints[input.toolID]
      }
    },
"command.execute.before": async (_input: any, output: any) => {
      // Prepend a discipline reminder to all command executions.
      // The parts array is typed as Part[] — TextPart requires id/sessionID/messageID.
      // We provide placeholder values; OpenCode replaces them if needed.
      output.parts.push({
        id: "",
        sessionID: "",
        messageID: "",
        type: "text",
        text: "[opencode-resolve] Drive to verified resolution. Classify intent, dispatch focused subagents, verify after each, iterate on failure. Report completion only when verified.",
      } as any)
    },
"tool.execute.before": async (input: any, output: any) => {
      // For bash: inject hints for common mistakes
      if (input.tool === "bash" && output.args && typeof output.args === "object") {
        const cmd = output.args.command ?? output.args.cmd
        if (typeof cmd === "string" && cmd.includes("git commit") && !cmd.includes("-m")) {
          output.args = { ...output.args, _resolve_hint: "Use 'git commit -m \"message\"' — interactive commit is blocked." }
        }
      }
      // For write: warn about overwriting existing files
      if (input.tool === "write" && output.args && typeof output.args === "object") {
        const filePath = output.args.filePath ?? output.args.path
        if (typeof filePath === "string") {
          const meta: Record<string, unknown> = { ...(output.args._resolve_meta ?? {}) }
          meta._resolve_write_note = "Verify file contents after writing. Use edit instead of write for existing files when possible."
          output.args = { ...output.args, _resolve_meta: meta }
        }
      }
    },
"chat.headers": async (input: any, output: any) => {
      const providerID = input.provider?.info?.id ?? ""
      // For GLM providers: add retry-after hint to avoid rate limiting
      if (providerID.includes("zai") || providerID.includes("glm") || providerID.includes("bigmodel")) {
        output.headers["X-Custom-Retry-Strategy"] = "exponential"
      }
    },
"tool.execute.after": async (input: any, output: any) => {
      if (input.tool === "edit" || input.tool === "write") {
        const verifyCommands = sessionState.storedProjectContext?.verifyCommands
        const meta: Record<string, unknown> = { ...(output.metadata ?? {}) }
        if (verifyCommands && verifyCommands.length > 0) {
          meta._resolve_verify_hint = verifyCommands[0]
        }
        // Attach LSP diagnostics for the edited file if available
        const args = input.args as { filePath?: string } | undefined
        const editedPath = args?.filePath
        if (editedPath) {
          const diag = sessionState.recentDiagnostics.get(editedPath)
          if (diag && Date.now() - diag.timestamp < DIAGNOSTICS_TTL_MS) {
            meta._resolve_lsp_errors = diag.errors
            meta._resolve_lsp_warnings = diag.warnings
          }
          // Ralph Loop: track edit hotspot
          const existing = sessionState.editHotspots.get(editedPath)
          if (existing) {
            existing.count++
            existing.lastEditTime = Date.now()
          } else {
            sessionState.editHotspots.set(editedPath, { count: 1, lastEditTime: Date.now() })
          }
          // Ralph Loop: inject loop warning into metadata
          const hotspot = sessionState.editHotspots.get(editedPath)
          if (hotspot && hotspot.count >= EDIT_HOTSPOT_THRESHOLD) {
            meta._resolve_loop_warning = `This file has been edited ${hotspot.count} times. Consider a different approach.`
          }
        }
        output.metadata = meta

        // Ralph Loop: update sessionState.loopWarnings after every edit/write
        sessionState.loopWarnings = []
        for (const [file, data] of sessionState.editHotspots) {
          if (data.count >= EDIT_HOTSPOT_THRESHOLD) {
            sessionState.loopWarnings.push(
              `File '${file}' edited ${data.count} times — consider a different approach for this file. Keep iterating.`,
            )
          }
        }
      }

      // For bash: extract key error lines from failing commands
      if (input.tool === "bash") {
        const outputText = typeof output.output === "string" ? output.output
          : (output.output as any)?.output ?? ""
        const exitCode = (output.metadata as any)?.exitCode ?? (output.output as any)?.metadata?.exitCode
        if (exitCode && exitCode !== 0 && typeof outputText === "string") {
          const errorLines = outputText.split("\n")
            .filter((l: string) => /\b(error|Error|ERROR|fail|FAIL|FAILED|cannot|Cannot|TypeError|SyntaxError|ReferenceError)\b/.test(l))
            .slice(0, 5)
          if (errorLines.length > 0) {
            const meta: Record<string, unknown> = { ...(output.metadata ?? {}) }
            meta._resolve_key_errors = errorLines
            output.metadata = meta
          }
        }
      }
    },
"experimental.session.compacting": async (_input: any, output: any) => {
      const ctx = sessionState.storedProjectContext
      const cfg = sessionState.storedConfig
      if (!ctx && !cfg) return

      const contextLines: string[] = []
      // Profile and tier info
      if (cfg?.profile) contextLines.push(`Profile: ${cfg.profile}.`)
      if (cfg?.tier) contextLines.push(`Tier: ${cfg.tier}.`)
      // Project context
      if (ctx?.knowledgeFiles.length) {
        contextLines.push(`Project knowledge files: ${ctx.knowledgeFiles.join(", ")}.`)
      }
      if (ctx?.contextFiles.length) {
        contextLines.push(`Context docs: ${ctx.contextFiles.slice(0, 20).join(", ")}.`)
      }
      if (ctx?.verifyCommands.length) {
        contextLines.push(`Verify commands: ${ctx.verifyCommands.join("; ")}.`)
      }
      if (ctx?.hasTypeScript) {
        contextLines.push("TypeScript project — type safety is mandatory.")
      }
      if (ctx?.packageManager) {
        contextLines.push(`Package manager: ${ctx.packageManager}.`)
      }
      // Active failure warnings
      if (sessionState.failureWarnings.length > 0) {
        contextLines.push(`Active warnings: ${sessionState.failureWarnings.join("; ")}`)
      }
      // Ralph Loop: preserve loop state
      if (sessionState.loopWarnings.length > 0) {
        contextLines.push(`Loop warnings: ${sessionState.loopWarnings.join("; ")}`)
      }
      // Ralph Loop: preserve session stats
      if (sessionState.totalEdits > 0) {
        contextLines.push(`Session stats: ${sessionState.totalEdits} edits, ${sessionState.totalToolCalls} tool calls.`)
      }

      if (contextLines.length > 0) {
        output.context.push("[" + "opencode-resolve" + "] Project context (preserve): " + contextLines.join(" "))
      }
    },
"experimental.chat.messages.transform": async (_input: any, output: any) => {
      const replacements: Array<[string | RegExp, string]> = [
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
      ]
      for (const msg of output.messages) {
        for (const part of msg.parts) {
          if (part.type !== "text") continue
          for (const [pattern, replacement] of replacements) {
            if (typeof pattern === "string" ? part.text === pattern : pattern.test(part.text)) {
              part.text = replacement
              break // first match wins
            }
          }
        }
      }
    },
"experimental.compaction.autocontinue": async (_input: any, output: any) => {
      // Always enable auto-continue — the resolver should keep driving
      output.enabled = true
    },
"experimental.chat.system.transform": async (_input: any, output: any) => {
      const ctx = sessionState.storedProjectContext
      const hasFailures = sessionState.failureWarnings.length > 0
      const hasLoops = sessionState.loopWarnings.length > 0
      if (!ctx && !hasFailures && !hasLoops) return

      const lines: string[] = []

      if (ctx?.knowledgeFiles.length) {
        lines.push(`[opencode-resolve] Project knowledge: ${ctx.knowledgeFiles.join(", ")}. Read when relevant before modifying code.`)
      }
      if (ctx?.contextFiles.length) {
        lines.push(`[opencode-resolve] Context docs: ${ctx.contextFiles.slice(0, 20).join(", ")}. MVI: load only task-relevant docs.`)
      }
      if (ctx?.verifyCommands.length) {
        lines.push(`[opencode-resolve] Verify commands: ${ctx.verifyCommands.join("; ")}. Run after changes.`)
      }
      if (ctx?.hasTypeScript) {
        lines.push("[opencode-resolve] TypeScript project — type safety is mandatory. No `as any` or `@ts-ignore`.")
      }

      // Inject failure pattern warnings — encourage trying different approaches, don't stop
      if (hasFailures) {
        lines.push("[opencode-resolve] ⚠️ Recurring failures detected:")
        for (const w of sessionState.failureWarnings.slice(0, 3)) {
          lines.push(`  - ${w}`)
        }
        lines.push("Keep going — try a different approach for the same goal. The Ralph Loop should drive to completion.")
      }

      // Strategy Pivot: after many total failures, suggest architect intervention
      if (sessionState.totalFailures >= STRATEGY_PIVOT_THRESHOLD) {
        lines.push(`[opencode-resolve] 🔀 STRATEGY PIVOT: ${sessionState.totalFailures} total failures detected.`)
        lines.push("The current approach is not working. Dispatch ARCHITECT to analyze the problem from scratch and propose a fundamentally different strategy.")
        lines.push("Then apply the new strategy. Do NOT keep retrying the same approach.")
      }

      // Ralph Loop: inject strategy hints when same file edited many times
      if (hasLoops) {
        lines.push("[opencode-resolve] 🔄 Ralph Loop: heavy editing detected on same file(s):")
        for (const w of sessionState.loopWarnings.slice(0, 3)) {
          lines.push(`  - ${w}`)
        }
        const strategies = [
          "Re-read the file carefully. You may be missing existing code that conflicts with your edit.",
          "Try a completely different approach — revert your last change and try a different fix.",
          "Use resolve-diagnostics to check current LSP errors before the next edit.",
          "Break the problem into smaller pieces. Edit one function at a time, verify between each.",
          "Check if the error is actually in a DIFFERENT file — the real issue may be upstream.",
          "Read the test file if it exists — the test often reveals the expected behavior.",
          "Check imports — missing or wrong imports are a common cause of cascading errors.",
          "Use resolve-search to find similar patterns elsewhere in the codebase.",
        ]
        const hint = strategies[Math.floor(Date.now() / 30_000) % strategies.length]
        if (hint !== sessionState.lastStrategyHint) {
          lines.push(`Strategy suggestion: ${hint}`)
          sessionState.lastStrategyHint = hint
        }
        lines.push("Keep driving — the Ralph Loop should keep iterating until verified resolution.")
      }

      // Ralph Loop: inject session context when significant work done
      if (sessionState.totalEdits >= 20 && sessionState.failureWarnings.length > 0) {
        lines.push(`[opencode-resolve] 📊 Session stats: ${sessionState.totalEdits} edits, ${sessionState.totalToolCalls} tool calls, ${Math.round((Date.now() - sessionState.sessionStartTime) / 1000)}s elapsed.`)
        lines.push("Significant iteration with failures. Consider a fundamentally different approach — but keep going.")
      }

      if (lines.length > 0) {
        output.system.push(lines.join("\n"))
      }
    },
"experimental.text.complete": async (_input: any, output: any) => {
      const text = output.text ?? ""
      if (!text) return

      // Detect if this turn involved code changes
      const editSignals = ["```", "edit", "wrote", "changed", "created", "updated", "modified", "deleted", "removed", "added", "renamed"]
      const looksLikeEdit = editSignals.some(s => text.toLowerCase().includes(s))

      // Detect if verification was already mentioned
      const verifySignals = ["verified", "pass", "✅", "tsc --noEmit", "eslint", "npm test", "vitest pass", "all tests pass", "no errors", "0 errors", "build succeeded"]
      const alreadyVerified = verifySignals.some(s => text.toLowerCase().includes(s))

      // Detect if the turn ended with a question or handoff (shouldn't nudge)
      const handoffPatterns = [/\?$/, /let me know/i, /would you like/i, /what do you think/i]
      const isHandoff = handoffPatterns.some(p => p.test(text.trim()))

      // Ralph Loop: detect loop-like patterns in the response text
      const loopSignals = ["trying again", "attempting", "retrying", "second attempt", "third attempt", "another approach", "let me try"]
      const looksLikeLoop = loopSignals.some(s => text.toLowerCase().includes(s))

      if (looksLikeEdit && !alreadyVerified && !isHandoff) {
        output.text = text + "\n\n[opencode-resolve] Reminder: verify your changes (resolve-verify) before reporting completion."
      }

      // Ralph Loop: if loop detected in text AND hotspot exists, suggest strategy change
      if (looksLikeLoop && sessionState.loopWarnings.length > 0) {
        output.text = (output.text ?? text) + "\n\n[opencode-resolve] 🔄 Ralph Loop: heavy iteration detected. Use resolve-diagnostics to check current state, then try a different approach. Keep driving to completion."
      }
    }
};
}
