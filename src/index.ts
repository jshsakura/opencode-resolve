import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { access, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Config, Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

const PLUGIN_VERSION = readPluginVersion()
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const UPDATE_CHECK_FILE = join(homedir(), ".cache", "opencode-resolve", "update-check.json")
const PLUGIN_CACHE_DIR = join(homedir(), ".cache", "opencode", "packages", "opencode-resolve@latest")

function readPluginVersion(): string {
  try {
    const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"))
    return typeof pkg?.version === "string" ? pkg.version : "unknown"
  } catch {
    return "unknown"
  }
}

console.log(`[opencode-resolve] v${PLUGIN_VERSION} loaded`)

type PermissionValue = "ask" | "allow" | "deny"

type ResolveAgentName =
  | "coder"
  | "reviewer"
  | "resolver"
  | "glm"
  | "architect"
  | "gpt-coder"
  | "debugger"
  | "researcher"
  | "explorer"
  | "deep-reviewer"
  | "planner"

type ModelAlias =
  | ResolveAgentName
  | "glm"
  | "gpt"
  | "quick"
  | "deep"
  | "fast"
  | "strong"
  | "mini"
  | "codex"
  | "bronze"
  | "silver"
  | "gold"

type AgentMode = "subagent" | "primary" | "all"

type ResolveAgentConfig = {
  enabled?: boolean
  model?: string
  mode?: AgentMode
  description?: string
  prompt?: string
  color?: string
  maxSteps?: number
  tools?: Record<string, boolean>
  permission?: {
    edit?: PermissionValue
    bash?: PermissionValue | Record<string, PermissionValue>
    webfetch?: PermissionValue
    doom_loop?: PermissionValue
    external_directory?: PermissionValue
  }
}

type ProfileName = "glm" | "gpt"
type TierName = "bronze" | "silver" | "gold"

type ResolveConfig = {
  profile?: ProfileName
  tier?: TierName
  enabled?: ResolveAgentName[]
  models?: Partial<Record<ModelAlias, string>>
  agents?: Partial<Record<ResolveAgentName, ResolveAgentConfig>>
  preserveNative?: boolean
  context7?: boolean
  commands?: boolean
  autoApprove?: boolean
  maxParallelSubagents?: number
  autoUpdate?: boolean
}

type ResolvePluginOptions = ResolveConfig & {
  config?: string
}

type UnknownRecord = Record<string, unknown>

const DEFAULT_MODELS: Partial<Record<ModelAlias, string>> = {}

const DEFAULT_ENABLED: ResolveAgentName[] = ["coder", "resolver", "explorer", "reviewer", "deep-reviewer", "planner"]

const VALID_AGENT_NAMES = [
  "coder",
  "reviewer",
  "resolver",
  "glm",
  "architect",
  "gpt-coder",
  "debugger",
  "researcher",
  "explorer",
  "deep-reviewer",
  "planner",
] as const
const VALID_AGENT_NAME_SET = new Set<string>(VALID_AGENT_NAMES)
const VALID_MODEL_ALIASES = [
  ...VALID_AGENT_NAMES,
  "glm",
  "gpt",
  "quick",
  "deep",
  "fast",
  "strong",
  "mini",
  "codex",
  "bronze",
  "silver",
  "gold",
] as const
const VALID_MODEL_ALIAS_SET = new Set<string>(VALID_MODEL_ALIASES)
const VALID_MODES = new Set<string>(["subagent", "primary", "all"])
const VALID_PERMISSION_VALUES = new Set<string>(["ask", "allow", "deny"])
const VALID_TOP_LEVEL_KEYS = new Set<string>([
  "profile",
  "tier",
  "enabled",
  "models",
  "agents",
  "preserveNative",
  "context7",
  "commands",
  "autoApprove",
  "maxParallelSubagents",
  "autoUpdate",
  "config",
])

const VALID_PROFILES = new Set<string>(["glm", "gpt"])
const VALID_TIERS = new Set<string>(["bronze", "silver", "gold"])

const TIER_ENABLED: Record<TierName, ResolveAgentName[]> = {
  bronze: ["coder", "resolver"],
  silver: ["coder", "resolver", "explorer", "reviewer", "planner"],
  gold: ["coder", "resolver", "explorer", "reviewer", "deep-reviewer", "planner", "debugger", "researcher"],
}

const DEFAULT_MAX_PARALLEL_SUBAGENTS = 2
const GLM_MAX_PARALLEL_SUBAGENTS = 1

const GPT_ENABLED: ResolveAgentName[] = ["coder", "resolver", "explorer", "reviewer", "deep-reviewer", "planner"]

const GPT_AGENT_OVERRIDES: Partial<Record<ResolveAgentName, { maxSteps?: number; description?: string }>> = {
  coder: { maxSteps: 25 },
  resolver: { maxSteps: 40 },
  explorer: { maxSteps: 8 },
  reviewer: { maxSteps: 10 },
  "deep-reviewer": { maxSteps: 15 },
  planner: { maxSteps: 12 },
}

const VALID_AGENT_KEYS = new Set<string>([
  "enabled",
  "model",
  "mode",
  "description",
  "prompt",
  "color",
  "maxSteps",
  "tools",
  "permission",
])

// ---------------------------------------------------------------------------
// GLM profile — coding-plan token/rate optimized
// ---------------------------------------------------------------------------

const GLM_ENABLED: ResolveAgentName[] = ["coder", "resolver", "explorer", "reviewer", "planner"]

const GLM_AGENT_OVERRIDES: Partial<Record<ResolveAgentName, { maxSteps?: number; description?: string }>> = {
  coder: { maxSteps: 15 },
  resolver: { maxSteps: 25 },
  explorer: { maxSteps: 5 },
  reviewer: { maxSteps: 6 },
  planner: { maxSteps: 8 },
}

// ── Resolver prompts ──────────────────────────────────────────────────────

function buildGLMResolverPrompt(maxParallelSubagents: number | undefined): string {
  const limit = typeof maxParallelSubagents === "number" && Number.isFinite(maxParallelSubagents)
    ? Math.max(1, Math.trunc(maxParallelSubagents))
    : 2

  return [
    "You are Resolver (GLM profile), the token-efficient orchestrator for OpenCode Resolve.",
    "ZAI Coding Plan — quota is finite. Minimize unnecessary reads and dispatches.",
    "",
    `Dispatch up to ${limit} coder(s) concurrently. Wait for in-flight coders before dispatching more.`,
    "Dispatch coder with: TASK (atomic goal), OUTCOME (success criteria), MUST DO, MUST NOT DO, CONTEXT (files/patterns).",
    "After EVERY coder return: verify it works + follows codebase patterns. If not → re-dispatch with fix.",
    "Trivial fixes → apply yourself. No subagent needed.",
    "3 consecutive failures → STOP, REVERT, REPORT, ASK user.",
    "",
    "If piloci MCP available: piloci_recall before inspecting code, piloci_memory after learning something non-obvious.",
    "",
    "Verify: type check or lint MUST pass on changed files. NO EVIDENCE = NOT COMPLETE.",
    "After non-trivial work: ask user to capture lesson → HARNESS.md (infra) or AGENTS.md (agent behavior).",
    "",
    "NEVER: as any / @ts-ignore / leave code broken / delete failing tests / commit without request.",
    "",
    "Specialists: explorer (scope unknown), reviewer (verification gap), planner (user asks for plan). No deep-reviewer.",
  ].join("\n")
}

const GLM_CODER_PROMPT = [
  "You are Coder (GLM profile), a concise implementation subagent for OpenCode Resolve.",
  "",
  "Read ONLY files you will edit. Make the SMALLEST correct change.",
  "Verify immediately: type check or lint on changed files. Check LSP diagnostics when available. Report exit code + errors.",
  "Return: changed files + verification result. No prose.",
  "",
  "NO EVIDENCE = INCOMPLETE WORK.",
  "",
  "NEVER: as any / @ts-ignore / empty catch / delete failing tests / leave code broken.",
].join("\n")

function buildGPTResolverPrompt(): string {
  return [
    "You are Resolver (GPT profile), the orchestrator for OpenCode Resolve.",
    "Leverage GPT's reasoning — parallel dispatch, detailed checkpoint plans for deep tasks.",
    "",
    "Parallel coder dispatch for independent work. Deep-reviewer available for risky changes.",
    "Dispatch coder with: TASK (atomic goal), OUTCOME (success criteria), MUST DO, MUST NOT DO, CONTEXT (files/patterns).",
    "After EVERY coder return: verify it works + follows codebase patterns. If not → re-dispatch with fix.",
    "Trivial fixes → apply yourself. No subagent needed.",
    "3 consecutive failures → STOP, REVERT, REPORT, ASK user.",
    "",
    "If piloci MCP available: piloci_recall before inspecting code, piloci_memory after learning something non-obvious.",
    "",
    "Verify: type check or lint MUST pass on changed files. NO EVIDENCE = NOT COMPLETE.",
    "After non-trivial work: ask user to capture lesson → HARNESS.md (infra) or AGENTS.md (agent behavior).",
    "",
    "NEVER: as any / @ts-ignore / leave code broken / delete failing tests / commit without request.",
    "",
    "Specialists: explorer (scope unknown), reviewer (verification gap), deep-reviewer (risky/security/architectural), planner (user asks for plan).",
  ].join("\n")
}

const GPT_CODER_PROMPT = [
  "You are Coder (GPT profile), an implementation subagent for OpenCode Resolve.",
  "",
  "Read ONLY files you need. Make the SMALLEST correct change.",
  "Verify: type check or lint on changed files. Check LSP diagnostics when available. Report exit code + errors.",
  "Return: changed files + verification result. Keep it concise.",
  "",
  "NO EVIDENCE = INCOMPLETE WORK.",
  "",
  "NEVER: as any / @ts-ignore / empty catch / delete failing tests / leave code broken.",
].join("\n")

function buildResolverPrompt(maxParallelSubagents: number | undefined): string {
  const explicitLimit =
    typeof maxParallelSubagents === "number" && Number.isFinite(maxParallelSubagents)
      ? Math.max(1, Math.trunc(maxParallelSubagents))
      : undefined

  const parallelRule = explicitLimit === undefined
    ? "Fan out for independent work. Back off on rate-limit errors."
    : explicitLimit === 1
      ? "Dispatch ONE coder at a time. Wait for it to finish."
      : `Dispatch up to ${explicitLimit} coders concurrently.`

  return [
    "You are Resolver, the context-efficient orchestrator for OpenCode Resolve.",
    "Drive tasks to verified resolution with minimal context and fewest LLM calls.",
    "You and Coder form the verified resolve loop.",
    "",
    `Parallel: ${parallelRule}`,
    "Dispatch coder with: TASK (atomic goal), OUTCOME (success criteria), MUST DO, MUST NOT DO, CONTEXT (files/patterns).",
    "After EVERY coder return: verify it works + follows codebase patterns. If not → re-dispatch with fix.",
    "Trivial fixes → apply yourself. No subagent needed.",
    "3 consecutive failures → STOP, REVERT, REPORT, ASK user.",
    "",
    "If piloci MCP available: piloci_recall before inspecting code, piloci_memory after learning something non-obvious.",
    "",
    "Verify: type check or lint MUST pass on changed files. Check LSP diagnostics when available. NO EVIDENCE = NOT COMPLETE.",
    "After non-trivial work: ask user to capture lesson → HARNESS.md (infra) or AGENTS.md (agent behavior).",
    "",
    "NEVER: as any / @ts-ignore / leave code broken / delete failing tests / commit without request.",
    "",
    "Specialists: explorer (scope unknown), reviewer (verification gap), deep-reviewer (risky/security/architectural), planner (user asks for plan).",
  ].join("\n")
}

const DEFAULT_AGENT_CONFIG: Record<ResolveAgentName, Required<Pick<ResolveAgentConfig, "mode" | "description" | "prompt" | "color">> & ResolveAgentConfig> = {
  coder: {
    mode: "subagent",
    color: "#7CFC00",
    maxSteps: 20,
    description: "Use for focused implementation, file edits, test runs, and fixing issues until the task is resolved.",
    prompt: [
      "You are Coder, a focused implementation subagent for OpenCode Resolve.",
      "Together with Resolver you form a verified resolve loop.",
      "",
      "Read ONLY files you need. Make the SMALLEST correct change.",
      "Verify: type check or lint on changed files. Report exit code + errors.",
      "After editing: check LSP diagnostics (if available) for the file. If errors remain, fix before reporting.",
      "Return: changed files + verification result. No unnecessary prose.",
      "Dispatch explorer ONLY to locate 3+ unknown files. Otherwise use local read/grep/glob.",
      "",
      "NO EVIDENCE = INCOMPLETE WORK.",
      "",
      "NEVER: as any / @ts-ignore / empty catch / delete failing tests / leave code broken / commit without request.",
    ].join("\n"),
    permission: {
      edit: "allow",
      bash: "ask",
      webfetch: "allow",
    },
  },
  reviewer: {
    mode: "subagent",
    color: "#8A7CFF",
    maxSteps: 8,
    description: "Internal read-only verification-gap auditor. Enabled as subagent by default but not part of the core resolver→coder path. Resolver dispatches only when it judges a verification gap exists on non-trivial changes.",
    prompt: [
      "You are Reviewer, a strictly read-only internal review subagent for OpenCode Resolve.",
      "You are NOT part of the core path (resolver→coder). You are injected as an internal subagent so the resolver can dispatch you when it judges a verification gap exists on non-trivial changes.",
      "You MUST NOT modify the project by any means: no file edits, no writes, no shell commands that change state, no git commits, no package installs.",
      "Use read-only tools (read, grep, glob, list, web fetch for documentation) to inspect the work against the user's requirements and the repository's existing patterns.",
      "Prioritize concrete bugs, behavioral regressions, security risks, missing tests, and maintainability issues.",
      "Return findings ordered by severity with file and line references when available. If there are no findings, say so and mention residual risks or verification gaps.",
      "If a fix is needed, describe it precisely and recommend dispatching the coder or resolver agent. Never apply fixes yourself.",
    ].join("\n"),
    permission: {
      edit: "deny",
      bash: "deny",
      webfetch: "allow",
    },
  },
  resolver: {
    mode: "all",
    color: "#FF7AC6",
    maxSteps: 30,
    description: "Primary orchestrator in the fixed-role verified loop (resolver→coder). Decomposes work into verified checkpoints, dispatches coder, verifies each, and carries forward progress. Internal subagents (explorer, reviewer, deep-reviewer) are available by default but dispatched only when justified.",
    prompt: buildResolverPrompt(undefined),
    permission: {
      edit: "allow",
      bash: "ask",
      webfetch: "allow",
    },
  },
  architect: {
    mode: "subagent",
    color: "#00BFFF",
    maxSteps: 10,
    description: "Use for complex design, decomposition, and implementation instructions before coding.",
    prompt: [
      "You are Architect, a design and task decomposition subagent for OpenCode Resolve.",
      "Clarify constraints, map affected areas, and propose the simplest viable implementation path.",
      "Prefer native OpenCode plan/build behavior; provide actionable guidance to the parent agent instead of heavy orchestration.",
    ].join("\n"),
    permission: {
      edit: "deny",
      bash: "deny",
      webfetch: "allow",
    },
  },
  "gpt-coder": {
    mode: "subagent",
    color: "#FFB347",
    maxSteps: 20,
    description: "Use for difficult implementation work that needs stronger reasoning than the default coder.",
    prompt: [
      "You are GPT Coder, a high-reasoning implementation subagent for difficult tasks.",
      "Use the same small-change discipline as Coder, but take extra care with design, edge cases, and verification.",
      "Inspect before editing, implement directly, verify when practical, and report exactly what changed.",
    ].join("\n"),
    permission: {
      edit: "allow",
      bash: "ask",
      webfetch: "allow",
    },
  },
  debugger: {
    mode: "subagent",
    color: "#FF5F57",
    maxSteps: 14,
    description: "Use for reproducing failures, reading logs, isolating root causes, and proposing the smallest fix.",
    prompt: [
      "You are Debugger, a root-cause analysis subagent for OpenCode Resolve.",
      "Reproduce when feasible, inspect logs and stack traces, isolate the most likely cause, and recommend or apply the smallest safe fix when asked.",
      "Separate confirmed facts from hypotheses.",
    ].join("\n"),
    permission: {
      edit: "allow",
      bash: "ask",
      webfetch: "allow",
    },
  },
  researcher: {
    mode: "subagent",
    color: "#33C7A3",
    maxSteps: 8,
    description: "Use for codebase exploration and documentation-backed research before implementation.",
    prompt: [
      "You are Researcher, a codebase and documentation research subagent for OpenCode Resolve.",
      "Search the repository first, then use documentation tools such as Context7 or web fetch only when needed.",
      "Return concise findings with paths, APIs, and constraints that matter for implementation.",
    ].join("\n"),
    permission: {
      edit: "deny",
      bash: "deny",
      webfetch: "allow",
    },
  },
  explorer: {
    mode: "subagent",
    color: "#33CCFF",
    maxSteps: 6,
    description: "Internal pre-change fast scout for codebase/file/pattern/doc discovery. Enabled as subagent by default but not part of the core path. Read-only; quick model.",
    prompt: [
      "You are Explorer, a fast codebase scout subagent for OpenCode Resolve.",
      "Your job is to quickly discover files, patterns, APIs, and relevant code locations before implementation begins.",
      "You MUST NOT modify the project by any means: no file edits, no writes, no shell commands that change state.",
      "Use read-only tools (read, grep, glob, list) and documentation tools (web fetch, Context7) to find what matters.",
      "Return concise findings with file paths, relevant code snippets, APIs, and constraints.",
      "Be fast and targeted — the resolver needs your discoveries to plan efficiently.",
    ].join("\n"),
    permission: {
      edit: "deny",
      bash: "deny",
      webfetch: "allow",
    },
  },
  "deep-reviewer": {
    mode: "subagent",
    color: "#6A0DAD",
    maxSteps: 12,
    description: "Internal post-change strong read-only review for risky/security/architecture/high-impact changes. Enabled as subagent by default but not part of the core path. Read-only; deep model.",
    prompt: [
      "You are Deep Reviewer, a thorough read-only review subagent for risky, security-sensitive, or high-impact changes.",
      "You MUST NOT modify the project by any means: no file edits, no writes, no shell commands that change state, no git commits.",
      "Use read-only tools to deeply inspect the work against requirements, security best practices, architectural soundness, and behavioral correctness.",
      "Focus on security vulnerabilities, data integrity risks, breaking API changes, performance regressions, and architectural drift.",
      "Return findings ordered by severity with file and line references. For each finding, explain the risk and recommend a concrete fix.",
      "If a fix is needed, describe it precisely and recommend dispatching the coder or resolver agent. Never apply fixes yourself.",
    ].join("\n"),
    permission: {
      edit: "deny",
      bash: "deny",
      webfetch: "allow",
    },
  },
  planner: {
    mode: "subagent",
    color: "#F4A300",
    maxSteps: 10,
    description: "Internal advanced planner dispatched by the resolver when the user explicitly asks for a plan, decomposition, or implementation strategy. Read-only. Returns a concrete plan; never edits code.",
    prompt: [
      "You are Planner, the advanced planning subagent for OpenCode Resolve.",
      "You are dispatched by the resolver only when the user explicitly asks for a plan, decomposition, or implementation strategy — not for routine sub-task planning the resolver handles inline.",
      "You MUST NOT modify the project: no file edits, no writes, no shell commands that change state.",
      "Inspect the relevant code with read-only tools (read, grep, glob, list) before proposing.",
      "Return: clear phasing, file-level boundaries per phase, verification checkpoints, risks, and explicit trade-offs. Be concrete — name files, name decisions, name the cost of each option.",
      "Be token-efficient: produce the smallest plan that fully covers the user's intent. No filler, no boilerplate, no restating the request.",
    ].join("\n"),
    permission: {
      edit: "deny",
      bash: "deny",
      webfetch: "allow",
    },
  },
  glm: {
    mode: "all",
    color: "#00FF9F",
    maxSteps: 30,
    description: "GLM-optimized orchestrator for ZAI coding-plan. Select this agent when running GLM-only to get maximum performance within session and rate limits. Serial coder dispatch, token-efficient prompts, coding-plan constraints handled automatically.",
    prompt: buildGLMResolverPrompt(undefined),
    permission: {
      edit: "allow",
      bash: "ask",
      webfetch: "allow",
    },
  },
}

// ── Project context detection ─────────────────────────────────────────────

type ProjectContext = {
  /** Absolute paths to project knowledge files that exist */
  knowledgeFiles: string[]
  /** Package manager detected (npm, yarn, pnpm, bun) */
  packageManager: string | undefined
  /** Verification commands available (e.g. "npx tsc --noEmit", "npm run lint") */
  verifyCommands: string[]
  /** Whether this is a TypeScript project */
  hasTypeScript: boolean
  /** Whether HARNESS.md exists */
  hasHarness: boolean
  /** Whether AGENTS.md exists */
  hasAgents: boolean
}

async function detectProjectContext(directory: string): Promise<ProjectContext> {
  const ctx: ProjectContext = {
    knowledgeFiles: [],
    packageManager: undefined,
    verifyCommands: [],
    hasTypeScript: false,
    hasHarness: false,
    hasAgents: false,
  }

  // Detect knowledge files
  const knowledgeCandidates = [
    "HARNESS.md",
    "AGENTS.md",
    "CLAUDE.md",
    "CONVENTIONS.md",
  ]
  for (const candidate of knowledgeCandidates) {
    const fullPath = join(directory, candidate)
    if (await existsFile(fullPath)) {
      ctx.knowledgeFiles.push(candidate)
      if (candidate === "HARNESS.md") ctx.hasHarness = true
      if (candidate === "AGENTS.md") ctx.hasAgents = true
    }
  }

  // Detect package manager
  if (await existsFile(join(directory, "pnpm-lock.yaml"))) ctx.packageManager = "pnpm"
  else if (await existsFile(join(directory, "bun.lockb")) || await existsFile(join(directory, "bun.lock"))) ctx.packageManager = "bun"
  else if (await existsFile(join(directory, "yarn.lock"))) ctx.packageManager = "yarn"
  else if (await existsFile(join(directory, "package-lock.json"))) ctx.packageManager = "npm"

  // Detect TypeScript
  ctx.hasTypeScript = await existsFile(join(directory, "tsconfig.json"))

  // Detect verification commands from package.json scripts
  try {
    const pkgRaw = await readFile(join(directory, "package.json"), "utf8")
    const pkg = JSON.parse(pkgRaw)
    const scripts = typeof pkg?.scripts === "object" && pkg.scripts !== null ? pkg.scripts as Record<string, string> : {}

    if (typeof scripts["typecheck"] === "string" || typeof scripts["type-check"] === "string") {
      const cmd = scripts["typecheck"] ?? scripts["type-check"]
      ctx.verifyCommands.push(`npm run ${scripts["typecheck"] ? "typecheck" : "type-check"}`)
    } else if (ctx.hasTypeScript) {
      ctx.verifyCommands.push("npx tsc --noEmit")
    }

    if (typeof scripts["lint"] === "string") {
      ctx.verifyCommands.push("npm run lint")
    }

    if (typeof scripts["test"] === "string") {
      ctx.verifyCommands.push("npm test")
    }
  } catch {
    // no package.json or unreadable — skip
  }

  return ctx
}

async function existsFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile()
  } catch {
    return false
  }
}

export const OpencodeResolve: Plugin = async ({ directory }, options) => {
  // Store resolve config for use across hooks
  let storedConfig: ResolveConfig | undefined
  let storedProjectContext: ProjectContext | undefined
  // Track recent LSP diagnostics for post-edit verification
  const recentDiagnostics = new Map<string, { errors: number; warnings: number; timestamp: number }>()
  const DIAGNOSTICS_TTL_MS = 30_000 // Keep diagnostics for 30 seconds

  return {
    // ── Event: capture LSP diagnostics for post-edit verification ────────
    event: async (input) => {
      const evt = input.event
      if (evt.type === "lsp.client.diagnostics") {
        const props = evt.properties as { serverID?: string; path?: string }
        if (props.path) {
          // Count diagnostics from the event data
          // OpenCode sends full diagnostics in the event payload
          const data = evt as any
          const diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics
            : Array.isArray(data.errors) ? data.errors
            : []
          const errors = diagnostics.filter((d: any) => d.severity === 1 || d.severity === "error").length
          const warnings = diagnostics.filter((d: any) => d.severity === 2 || d.severity === "warning").length
          if (errors > 0 || warnings > 0) {
            recentDiagnostics.set(props.path, { errors, warnings, timestamp: Date.now() })
          } else {
            // Clean diagnostics cleared — remove stale entry
            recentDiagnostics.delete(props.path)
          }
          // Prune stale entries
          const now = Date.now()
          for (const [key, value] of recentDiagnostics) {
            if (now - value.timestamp > DIAGNOSTICS_TTL_MS) recentDiagnostics.delete(key)
          }
        }
      }
    },

    config: async (config) => {
      const resolveConfig = await loadResolveConfig(directory, config, options)
      const projectContext = await detectProjectContext(directory)
      storedConfig = resolveConfig
      storedProjectContext = projectContext
      applyResolveConfig(config, resolveConfig, projectContext)
      if (resolveConfig.autoUpdate !== false && process.env.OPENCODE_RESOLVE_NO_AUTO_UPDATE !== "1") {
        maybeAutoUpdate().catch(() => {})
      }
    },

    // ── Shell environment: force non-interactive mode ─────────────────────
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
      }
    },

    // ── Permission: classify bash commands + block banned interactive tools ─
    "permission.ask": async (input, output) => {
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

    // ── Chat params: per-profile temperature and token limits ─────────────
    "chat.params": async (input, output) => {
      const profile = storedConfig?.profile
      if (profile === "glm") {
        // GLM: lower temperature for deterministic code, tighter token budget
        output.temperature = Math.min(output.temperature, 0.4)
        if (output.maxOutputTokens === undefined || output.maxOutputTokens > 16384) {
          output.maxOutputTokens = 16384
        }
      } else if (profile === "gpt") {
        // GPT: allow higher temperature for creative reasoning
        output.temperature = Math.min(output.temperature, 0.7)
        if (output.maxOutputTokens === undefined) {
          output.maxOutputTokens = 32768
        }
      }
      // Read-only agents: lower temperature always
      const readOnlyAgents = new Set(["reviewer", "deep-reviewer", "explorer", "planner", "researcher", "architect"])
      if (readOnlyAgents.has(input.agent)) {
        output.temperature = Math.min(output.temperature, 0.3)
      }
    },

    // ── Tool definition: enrich tool descriptions with discipline hints ──
    "tool.definition": async (input, output) => {
      // tool.definition runs once per tool per session, not per agent.
      // We add usage discipline hints that guide the LLM toward correct behavior.
      const hints: Record<string, string> = {
        edit: "\n[opencode-resolve] Read the file first. Make the smallest correct change. Verify after editing.",
        write: "\n[opencode-resolve] Only write new files when explicitly needed. Prefer editing existing files.",
        bash: "\n[opencode-resolve] Commands run in non-interactive mode. No interactive editors, pagers, or REPLs. Use -c flags for scripting.",
        task: "\n[opencode-resolve] Dispatch subagents with: TASK (atomic goal), OUTCOME (success criteria), MUST DO, MUST NOT DO, CONTEXT.",
      }
      if (hints[input.toolID]) {
        output.description = output.description + hints[input.toolID]
      }
    },

    // ── Command execute before: inject discipline reminder ────────────────
    "command.execute.before": async (_input, output) => {
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

    // ── Tool execute before: pre-process tool args ────────────────────────
    "tool.execute.before": async (input, output) => {
      // For bash: inject hints for common mistakes
      if (input.tool === "bash" && output.args && typeof output.args === "object") {
        const cmd = output.args.command ?? output.args.cmd
        if (typeof cmd === "string" && cmd.includes("git commit") && !cmd.includes("-m")) {
          output.args = { ...output.args, _resolve_hint: "Use 'git commit -m \"message\"' — interactive commit is blocked." }
        }
      }
    },

    // ── Chat headers: provider-specific optimizations ─────────────────────
    "chat.headers": async (input, output) => {
      const providerID = input.provider?.info?.id ?? ""
      // For GLM providers: add retry-after hint to avoid rate limiting
      if (providerID.includes("zai") || providerID.includes("glm") || providerID.includes("bigmodel")) {
        output.headers["X-Custom-Retry-Strategy"] = "exponential"
      }
    },

    // ── Tool execute after: inject verification hints + LSP diagnostics after edits ─
    "tool.execute.after": async (input, output) => {
      if (input.tool === "edit" || input.tool === "write") {
        const verifyCommands = storedProjectContext?.verifyCommands
        const meta: Record<string, unknown> = { ...(output.metadata ?? {}) }
        if (verifyCommands && verifyCommands.length > 0) {
          meta._resolve_verify_hint = verifyCommands[0]
        }
        // Attach LSP diagnostics for the edited file if available
        const args = input.args as { filePath?: string } | undefined
        const editedPath = args?.filePath
        if (editedPath) {
          const diag = recentDiagnostics.get(editedPath)
          if (diag && Date.now() - diag.timestamp < DIAGNOSTICS_TTL_MS) {
            meta._resolve_lsp_errors = diag.errors
            meta._resolve_lsp_warnings = diag.warnings
          }
        }
        output.metadata = meta
      }
    },

    // ── Session compacting: preserve critical context during compaction ───
    "experimental.session.compacting": async (_input, output) => {
      const ctx = storedProjectContext
      if (!ctx) return

      const contextLines: string[] = []
      if (ctx.knowledgeFiles.length > 0) {
        contextLines.push(`Project knowledge files: ${ctx.knowledgeFiles.join(", ")}.`)
      }
      if (ctx.verifyCommands.length > 0) {
        contextLines.push(`Verify commands: ${ctx.verifyCommands.join("; ")}.`)
      }
      if (ctx.hasTypeScript) {
        contextLines.push("TypeScript project — type safety is mandatory.")
      }
      if (ctx.packageManager) {
        contextLines.push(`Package manager: ${ctx.packageManager}.`)
      }

      if (contextLines.length > 0) {
        output.context.push("[" + "opencode-resolve" + "] Project context (preserve): " + contextLines.join(" "))
      }
    },

    // ── Chat messages transform: replace generic summarize prompt ──────────
    "experimental.chat.messages.transform": async (_input, output) => {
      const GENERIC_SUMMARIZE = "Summarize the task tool output above and continue with your task."
      for (const msg of output.messages) {
        for (const part of msg.parts) {
          if (part.type === "text" && part.text === GENERIC_SUMMARIZE) {
            part.text = "Analyze the subtask result above. If it succeeded, continue. If it failed, diagnose and retry. Report completion only when verified."
          }
        }
      }
    },

    // ── Auto-continue after compaction ────────────────────────────────────
    "experimental.compaction.autocontinue": async (_input, output) => {
      // Always enable auto-continue — the resolver should keep driving
      output.enabled = true
    },

    // ── System prompt transform: inject project context ──────────────────
    "experimental.chat.system.transform": async (_input, output) => {
      const ctx = storedProjectContext
      if (!ctx) return

      const lines: string[] = []

      if (ctx.knowledgeFiles.length > 0) {
        lines.push(`[opencode-resolve] Project knowledge: ${ctx.knowledgeFiles.join(", ")}. Read before modifying code.`)
      }
      if (ctx.verifyCommands.length > 0) {
        lines.push(`[opencode-resolve] Verify commands: ${ctx.verifyCommands.join("; ")}. Run after changes.`)
      }
      if (ctx.hasTypeScript) {
        lines.push("[opencode-resolve] TypeScript project — type safety is mandatory. No `as any` or `@ts-ignore`.")
      }

      if (lines.length > 0) {
        output.system.push(lines.join("\n"))
      }
    },

    // ── Text complete: post-turn verification nudge ──────────────────────
    "experimental.text.complete": async (_input, output) => {
      // After each LLM turn, if the output looks like code changes were made,
      // append a verification reminder
      const text = output.text ?? ""
      const looksLikeEdit = text.includes("```") || text.includes("edit") || text.includes("wrote") || text.includes("changed")
      const alreadyVerified = text.includes("verified") || text.includes("pass") || text.includes("✅") || text.includes("tsc --noEmit")

      if (looksLikeEdit && !alreadyVerified) {
        output.text = text + "\n\n[opencode-resolve] Reminder: verify your changes before reporting completion."
      }
    },

    // ── Custom tools ──────────────────────────────────────────────────────
    tool: {
      "resolve-verify": tool({
        description: "Run project verification commands (typecheck, lint, test) and return results. Use after editing files to confirm correctness.",
        args: {
          command: tool.schema.string().optional().describe("Specific verify command to run. If omitted, runs the first detected verify command (e.g. typecheck or lint)."),
        },
        async execute(args, ctx) {
          const projCtx = storedProjectContext
          if (!projCtx || projCtx.verifyCommands.length === 0) {
            return "No verify commands detected for this project. Add typecheck/lint/test scripts to package.json."
          }
          const cmd = args.command ?? projCtx.verifyCommands[0]
          try {
            const result = await runCommand(cmd, ctx.directory, 30_000)
            ctx.metadata({ title: `verify: ${cmd}` })
            if (result.exitCode === 0) {
              return { output: `✅ ${cmd} passed.\n${truncateOutput(result.stdout, 500)}`, metadata: { exitCode: 0 } }
            }
            return { output: `❌ ${cmd} failed (exit ${result.exitCode}).\n${truncateOutput(result.stderr || result.stdout, 1000)}`, metadata: { exitCode: result.exitCode } }
          } catch (err) {
            return `⚠️ Failed to run '${cmd}': ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-diagnostics": tool({
        description: "Get current LSP diagnostics snapshot. Returns errors and warnings per file from the language server.",
        args: {
          path: tool.schema.string().optional().describe("Specific file path to check. If omitted, returns all files with active diagnostics."),
        },
        async execute(args) {
          if (recentDiagnostics.size === 0) {
            return "No active LSP diagnostics."
          }
          const now = Date.now()
          const entries: string[] = []
          for (const [filePath, diag] of recentDiagnostics) {
            if (now - diag.timestamp > DIAGNOSTICS_TTL_MS) continue
            if (args.path && filePath !== args.path) continue
            entries.push(`${filePath}: ${diag.errors} errors, ${diag.warnings} warnings`)
          }
          if (entries.length === 0) {
            return args.path ? `No active diagnostics for ${args.path}.` : "No active LSP diagnostics."
          }
          return entries.join("\n")
        },
      }),

      "resolve-context": tool({
        description: "Get detected project context: knowledge files, verify commands, package manager, TypeScript status.",
        args: {},
        async execute() {
          const ctx = storedProjectContext
          if (!ctx) return "No project context detected."
          const lines: string[] = []
          if (ctx.knowledgeFiles.length > 0) lines.push(`Knowledge files: ${ctx.knowledgeFiles.join(", ")}`)
          if (ctx.verifyCommands.length > 0) lines.push(`Verify commands: ${ctx.verifyCommands.join("; ")}`)
          if (ctx.packageManager) lines.push(`Package manager: ${ctx.packageManager}`)
          if (ctx.hasTypeScript) lines.push("TypeScript: yes")
          if (ctx.hasHarness) lines.push("HARNESS.md: present")
          if (ctx.hasAgents) lines.push("AGENTS.md: present")
          return lines.length > 0 ? lines.join("\n") : "Empty project — no context detected."
        },
      }),

      "resolve-git-status": tool({
        description: "Get git status summary: branch, staged/unstaged/untracked file counts, and short diff stat.",
        args: {},
        async execute(_args, ctx) {
          try {
            const branch = await runCommand("git rev-parse --abbrev-ref HEAD", ctx.directory, 5_000)
            const status = await runCommand("git status --porcelain", ctx.directory, 5_000)
            const diffStat = await runCommand("git diff --stat", ctx.directory, 5_000)
            const lines = [
              `Branch: ${branch.stdout.trim()}`,
              `Changed files: ${status.stdout.trim().split("\n").filter(Boolean).length}`,
            ]
            if (diffStat.stdout.trim()) {
              lines.push(`Diff:\n${truncateOutput(diffStat.stdout, 500)}`)
            }
            return lines.join("\n")
          } catch {
            return "Not a git repository or git unavailable."
          }
        },
      }),

      "resolve-deps": tool({
        description: "List dependencies and devDependencies from package.json with version info.",
        args: {
          dev: tool.schema.boolean().optional().describe("If true, show devDependencies only. If false/omitted, show dependencies."),
        },
        async execute(args, ctx) {
          try {
            const pkgRaw = await readFile(join(ctx.directory, "package.json"), "utf8")
            const pkg = JSON.parse(pkgRaw)
            const section = args.dev ? pkg.devDependencies : pkg.dependencies
            if (!section || Object.keys(section).length === 0) {
              return args.dev ? "No devDependencies found." : "No dependencies found."
            }
            return Object.entries(section as Record<string, string>).map(([name, ver]) => `${name}: ${ver}`).join("\n")
          } catch {
            return "No package.json found or unreadable."
          }
        },
      }),
    },
  }
}

// ── Command runner helper for custom tools ────────────────────────────────

function runCommand(command: string, cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("sh", ["-c", command], {
      cwd,
      env: { ...process.env, CI: "true", GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => { proc.kill("SIGKILL") }, timeoutMs)

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString() })
    proc.on("close", (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })
    proc.on("error", (err) => {
      clearTimeout(timer)
      resolve({ stdout: "", stderr: err.message, exitCode: 1 })
    })
  })
}

function truncateOutput(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + `\n... (${text.length - maxLen} more bytes truncated)`
}

async function maybeAutoUpdate(): Promise<void> {
  try {
    const previous = readUpdateCheckCache()
    if (previous && Date.now() - previous.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
      return
    }
  } catch {
    // ignore corrupt cache and re-check
  }

  let latest: string
  try {
    const response = await fetch("https://registry.npmjs.org/opencode-resolve/latest", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return
    const data = (await response.json()) as { version?: unknown }
    if (typeof data?.version !== "string") return
    latest = data.version
  } catch {
    return
  }

  try {
    mkdirSync(dirname(UPDATE_CHECK_FILE), { recursive: true })
    writeFileSync(UPDATE_CHECK_FILE, JSON.stringify({ checkedAt: Date.now(), latest }))
  } catch {
    // best-effort; don't block on cache write failure
  }

  if (!isNewerVersion(latest, PLUGIN_VERSION)) return

  console.log(
    `[opencode-resolve] new version v${latest} available (current: v${PLUGIN_VERSION}) — refreshing cache in background. Restart OpenCode to activate (current session stays on v${PLUGIN_VERSION}).`,
  )

  try {
    spawn(
      "sh",
      ["-c", `rm -rf "${PLUGIN_CACHE_DIR}" && opencode plugin opencode-resolve --global --force`],
      { detached: true, stdio: "ignore" },
    ).unref()
  } catch {
    // If spawn fails, the user already saw the notice and can run the command manually.
  }
}

function readUpdateCheckCache(): { checkedAt: number; latest: string } | undefined {
  try {
    const raw = readFileSync(UPDATE_CHECK_FILE, "utf8")
    const parsed = JSON.parse(raw)
    if (
      typeof parsed?.checkedAt === "number" &&
      typeof parsed?.latest === "string"
    ) {
      return { checkedAt: parsed.checkedAt, latest: parsed.latest }
    }
  } catch {
    // file missing or unparseable
  }
  return undefined
}

function isNewerVersion(candidate: string, baseline: string): boolean {
  const a = candidate.split(".").map((n) => Number.parseInt(n, 10))
  const b = baseline.split(".").map((n) => Number.parseInt(n, 10))
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = Number.isFinite(a[i]) ? (a[i] as number) : 0
    const bv = Number.isFinite(b[i]) ? (b[i] as number) : 0
    if (av > bv) return true
    if (av < bv) return false
  }
  return false
}

export default OpencodeResolve

async function loadResolveConfig(directory: string, opencodeConfig: Config, options: unknown): Promise<ResolveConfig> {
  const pluginOptions = normalizeResolveConfig(options ?? getPluginOptions(opencodeConfig), "plugin options")
  const configuredPath = typeof pluginOptions.config === "string" ? pluginOptions.config : undefined
  const configPaths = configuredPath
    ? [resolvePath(configuredPath, directory)]
    : [
        join(directory, ".opencode", "resolve.json"),
        join(directory, "opencode-resolve.json"),
        join(homedir(), ".config", "opencode", "resolve.json"),
        join(homedir(), ".config", "opencode", "opencode-resolve.json"),
      ]

  const fileConfig = await readFirstJson(configPaths)
  return mergeResolveConfig(defaultResolveConfig(), fileConfig, pluginOptions)
}

function applyResolveConfig(config: Config, resolveConfig: ResolveConfig, projectContext: ProjectContext) {
  const profile = resolveConfig.profile
  const isGLM = profile === "glm"
  const isGPT = profile === "gpt"

  const profileEnabled = isGLM ? GLM_ENABLED : isGPT ? GPT_ENABLED : undefined
  const tierEnabled = resolveConfig.tier ? TIER_ENABLED[resolveConfig.tier] : undefined
  const enabled = new Set(resolveConfig.enabled ?? tierEnabled ?? (profileEnabled ?? DEFAULT_ENABLED))
  const models = { ...DEFAULT_MODELS, ...resolveConfig.models }
  const defaultModel = typeof config.model === "string" ? config.model : undefined
  const maxParallelSubagents = resolveConfig.maxParallelSubagents ?? (isGLM ? GLM_MAX_PARALLEL_SUBAGENTS : undefined)

  // Build context injection strings from detected project info
  const contextInjection = buildContextInjection(projectContext)

  config.agent ??= {}

  for (const name of Object.keys(DEFAULT_AGENT_CONFIG) as ResolveAgentName[]) {
    const override = resolveConfig.agents?.[name]
    const isEnabled = override?.enabled ?? enabled.has(name)
    if (!isEnabled) continue

    const base = DEFAULT_AGENT_CONFIG[name]
    const profileOverride = isGLM ? GLM_AGENT_OVERRIDES[name] : isGPT ? GPT_AGENT_OVERRIDES[name] : undefined
    const { enabled: _enabled, model: requestedModel, permission: userPermission, ...agentOverride } = override ?? {}
    const model = resolveModel(requestedModel ?? models[name] ?? defaultModel, models)
    const permission = buildPermission(base.permission, userPermission)
    const agentConfig: ResolveAgentConfig = {
      ...base,
      ...profileOverride,
      ...agentOverride,
    }
    if (agentOverride.prompt === undefined) {
      if (isGLM) {
        if (name === "resolver") agentConfig.prompt = buildGLMResolverPrompt(undefined)
        else if (name === "coder") agentConfig.prompt = GLM_CODER_PROMPT
      } else if (isGPT) {
        if (name === "resolver") agentConfig.prompt = buildGPTResolverPrompt()
        else if (name === "coder") agentConfig.prompt = GPT_CODER_PROMPT
      } else {
        if (name === "resolver") agentConfig.prompt = buildResolverPrompt(maxParallelSubagents)
      }
      // Inject project context into all resolver-type agents
      if ((name === "resolver" || name === "glm") && contextInjection) {
        agentConfig.prompt = agentConfig.prompt + "\n\n" + contextInjection
      }
      // Inject verify commands into coder prompts
      if ((name === "coder") && projectContext.verifyCommands.length > 0) {
        agentConfig.prompt = agentConfig.prompt + "\n\nAvailable verify: " + projectContext.verifyCommands.join(", ") + "."
      }
    }
    if (permission) agentConfig.permission = permission
    if (model) agentConfig.model = model
    config.agent[name] = agentConfig
  }

  if (resolveConfig.context7 !== false) {
    config.mcp ??= {}
    config.mcp.context7 ??= {
      type: "remote",
      url: "https://mcp.context7.com/mcp",
    }
  }

  if (resolveConfig.commands) {
    config.command ??= {}
    config.command["resolve"] ??= {
      template: "Drive this task to a verified resolution end-to-end. Classify, explore when needed, dispatch focused subagents within the configured per-role limit, verify, and iterate. $ARGUMENTS",
      description: "Run the OpenCode Resolve resolver agent end-to-end",
      agent: "resolver",
      subtask: true,
    }
    config.command["resolve-review"] ??= {
      template: "Review the current implementation against the user's requirements. Focus on correctness, tests, security, and maintainability. Do not modify anything.",
      description: "Run the OpenCode Resolve reviewer agent (read-only)",
      agent: "reviewer",
      subtask: true,
    }
    config.command["resolve-code"] ??= {
      template: "Implement the requested change with the smallest correct patch, then verify it when practical. $ARGUMENTS",
      description: "Run the OpenCode Resolve coder agent",
      agent: "coder",
      subtask: true,
    }
  }
}

function buildContextInjection(ctx: ProjectContext): string {
  const lines: string[] = []

  if (ctx.knowledgeFiles.length > 0) {
    lines.push(`Project knowledge files detected: ${ctx.knowledgeFiles.join(", ")}.`)
    lines.push("Read these FIRST before inspecting code — they contain infra decisions, traps, and agent patterns.")
  }

  if (ctx.packageManager) {
    lines.push(`Package manager: ${ctx.packageManager}.`)
  }

  if (ctx.verifyCommands.length > 0) {
    lines.push(`Verify commands available: ${ctx.verifyCommands.join("; ")}.`)
    lines.push("Run the relevant one after every code change. Pass = evidence. Fail = fix before reporting.")
  }

  if (ctx.hasTypeScript) {
    lines.push("TypeScript project — type safety is mandatory.")
  }

  return lines.length > 0 ? lines.join("\n") : ""
}

function defaultResolveConfig(): ResolveConfig {
  return {
    models: {},
    agents: {},
    preserveNative: true,
    context7: true,
    commands: false,
    autoApprove: true,
    autoUpdate: true,
  }
}

function mergeResolveConfig(...configs: Array<ResolveConfig | undefined>): ResolveConfig {
  const result: ResolveConfig = {}
  for (const config of configs) {
    if (!config) continue
    result.profile = config.profile ?? result.profile
    result.tier = config.tier ?? result.tier
    result.enabled = config.enabled ?? result.enabled
    result.preserveNative = config.preserveNative ?? result.preserveNative
    result.context7 = config.context7 ?? result.context7
    result.commands = config.commands ?? result.commands
    result.autoApprove = config.autoApprove ?? result.autoApprove
    result.maxParallelSubagents = config.maxParallelSubagents ?? result.maxParallelSubagents
    result.autoUpdate = config.autoUpdate ?? result.autoUpdate
    result.models = { ...result.models, ...config.models }
    result.agents = mergeAgents(result.agents, config.agents)
  }
  return result
}

function mergeAgents(
  left: ResolveConfig["agents"],
  right: ResolveConfig["agents"],
): ResolveConfig["agents"] {
  const result: ResolveConfig["agents"] = { ...left }
  for (const name of Object.keys(right ?? {}) as ResolveAgentName[]) {
    result[name] = { ...result[name], ...right?.[name] }
  }
  return result
}

function resolveModel(model: string | undefined, models: Record<string, string | undefined>) {
  if (!model) return undefined
  return models[model] ?? model
}

function buildPermission(
  basePermission: ResolveAgentConfig["permission"],
  userPermission: ResolveAgentConfig["permission"],
): ResolveAgentConfig["permission"] {
  const merged: NonNullable<ResolveAgentConfig["permission"]> = {
    ...(basePermission ?? {}),
    ...(userPermission ?? {}),
  }
  if (Object.keys(merged).length === 0) return undefined
  return merged
}

function getPluginOptions(config: Config): unknown {
  for (const entry of config.plugin ?? []) {
    if (Array.isArray(entry) && isResolvePluginEntry(entry[0])) {
      return entry[1] ?? {}
    }
  }
  return {}
}

function isResolvePluginEntry(entry: string) {
  const name = basename(entry)
  return name === "opencode-resolve" || name.startsWith("opencode-resolve@")
}

async function readFirstJson(paths: string[]): Promise<ResolveConfig | undefined> {
  for (const path of paths) {
    try {
      await access(path)
      return normalizeResolveConfig(JSON.parse(await readFile(path, "utf8")), path)
    } catch (error) {
      if (isMissingFileError(error)) continue
      throw new Error(`Failed to read OpenCode Resolve config at ${path}: ${formatError(error)}`)
    }
  }
  return undefined
}

function resolvePath(path: string, directory: string) {
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  if (isAbsolute(path)) return path
  return resolve(directory, path)
}

function normalizeResolveConfig(value: unknown, source: string): ResolvePluginOptions {
  if (value === undefined) return {}
  const config = expectObject(value, source)

  for (const key of Object.keys(config)) {
    if (!VALID_TOP_LEVEL_KEYS.has(key)) {
      throw new Error(`Unknown top-level key "${key}" in ${source}`)
    }
  }

  const result: ResolvePluginOptions = {}

  if (config.enabled !== undefined) {
    result.enabled = expectStringArray(config.enabled, `${source}.enabled`).map((name) => expectAgentName(name, `${source}.enabled`))
  }

  if (config.models !== undefined) {
    const models = expectObject(config.models, `${source}.models`)
    result.models = {}
    for (const [key, model] of Object.entries(models)) {
      if (!VALID_MODEL_ALIAS_SET.has(key)) {
        throw new Error(`Unknown model alias "${key}" in ${source}.models`)
      }
      result.models[key as ModelAlias] = expectString(model, `${source}.models.${key}`)
    }
  }

  if (config.agents !== undefined) {
    const agents = expectObject(config.agents, `${source}.agents`)
    result.agents = {}
    for (const [name, agentConfig] of Object.entries(agents)) {
      const agentName = expectAgentName(name, `${source}.agents`)
      result.agents[agentName] = normalizeAgentConfig(agentConfig, `${source}.agents.${name}`)
    }
  }

  if (config.preserveNative !== undefined) result.preserveNative = expectBoolean(config.preserveNative, `${source}.preserveNative`)
  if (config.context7 !== undefined) result.context7 = expectBoolean(config.context7, `${source}.context7`)
  if (config.commands !== undefined) result.commands = expectBoolean(config.commands, `${source}.commands`)
  if (config.autoApprove !== undefined) result.autoApprove = expectBoolean(config.autoApprove, `${source}.autoApprove`)
  if (config.autoUpdate !== undefined) result.autoUpdate = expectBoolean(config.autoUpdate, `${source}.autoUpdate`)
  if (config.profile !== undefined) {
    const profile = expectString(config.profile, `${source}.profile`)
    if (!VALID_PROFILES.has(profile)) {
      throw new Error(`Unknown profile "${profile}" in ${source}.profile. Valid profiles: ${[...VALID_PROFILES].join(", ")}`)
    }
    result.profile = profile as ProfileName
  }
  if (config.tier !== undefined) {
    const tier = expectString(config.tier, `${source}.tier`)
    if (!VALID_TIERS.has(tier)) {
      throw new Error(`Unknown tier "${tier}" in ${source}.tier. Valid tiers: ${[...VALID_TIERS].join(", ")}`)
    }
    result.tier = tier as TierName
  }
  if (config.maxParallelSubagents !== undefined) {
    const limit = expectNumber(config.maxParallelSubagents, `${source}.maxParallelSubagents`)
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`${source}.maxParallelSubagents must be a positive integer`)
    }
    result.maxParallelSubagents = limit
  }
  if (config.config !== undefined) result.config = expectString(config.config, `${source}.config`)

  return result
}

function normalizeAgentConfig(value: unknown, source: string): ResolveAgentConfig {
  const config = expectObject(value, source)
  for (const key of Object.keys(config)) {
    if (!VALID_AGENT_KEYS.has(key)) {
      throw new Error(`Unknown agent key "${key}" in ${source}`)
    }
  }

  const result: ResolveAgentConfig = {}
  if (config.enabled !== undefined) result.enabled = expectBoolean(config.enabled, `${source}.enabled`)
  if (config.model !== undefined) result.model = expectString(config.model, `${source}.model`)
  if (config.mode !== undefined) {
    const mode = expectString(config.mode, `${source}.mode`)
    if (!VALID_MODES.has(mode)) throw new Error(`Invalid mode "${mode}" in ${source}.mode`)
    result.mode = mode as AgentMode
  }
  if (config.description !== undefined) result.description = expectString(config.description, `${source}.description`)
  if (config.prompt !== undefined) result.prompt = expectString(config.prompt, `${source}.prompt`)
  if (config.color !== undefined) result.color = expectString(config.color, `${source}.color`)
  if (config.maxSteps !== undefined) {
    const maxSteps = expectNumber(config.maxSteps, `${source}.maxSteps`)
    if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error(`${source}.maxSteps must be a positive integer`)
    result.maxSteps = maxSteps
  }
  if (config.tools !== undefined) result.tools = normalizeTools(config.tools, `${source}.tools`)
  if (config.permission !== undefined) result.permission = normalizePermission(config.permission, `${source}.permission`)
  return result
}

function normalizeTools(value: unknown, source: string): Record<string, boolean> {
  const tools = expectObject(value, source)
  const result: Record<string, boolean> = {}
  for (const [key, enabled] of Object.entries(tools)) {
    result[key] = expectBoolean(enabled, `${source}.${key}`)
  }
  return result
}

function normalizePermission(value: unknown, source: string): ResolveAgentConfig["permission"] {
  const permission = expectObject(value, source)
  const result: NonNullable<ResolveAgentConfig["permission"]> = {}
  for (const [key, entry] of Object.entries(permission)) {
    if (key === "bash" && isObject(entry)) {
      result.bash = {}
      for (const [command, commandPermission] of Object.entries(entry)) {
        result.bash[command] = expectPermissionValue(commandPermission, `${source}.bash.${command}`)
      }
      continue
    }

    const permissionValue = expectPermissionValue(entry, `${source}.${key}`)
    if (key === "edit" || key === "bash" || key === "webfetch" || key === "doom_loop" || key === "external_directory") {
      result[key] = permissionValue
      continue
    }
    throw new Error(`Unknown permission key "${key}" in ${source}`)
  }
  return result
}

function expectAgentName(value: string, source: string): ResolveAgentName {
  if (!VALID_AGENT_NAME_SET.has(value)) {
    throw new Error(`Unknown agent "${value}" in ${source}. Valid agents: ${VALID_AGENT_NAMES.join(", ")}`)
  }
  return value as ResolveAgentName
}

function expectPermissionValue(value: unknown, source: string): PermissionValue {
  const permission = expectString(value, source)
  if (!VALID_PERMISSION_VALUES.has(permission)) {
    throw new Error(`${source} must be one of: ask, allow, deny`)
  }
  return permission as PermissionValue
}

function expectStringArray(value: unknown, source: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${source} must be an array of strings`)
  }
  return value
}

function expectObject(value: unknown, source: string): UnknownRecord {
  if (!isObject(value)) throw new Error(`${source} must be an object`)
  return value
}

function expectString(value: unknown, source: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${source} must be a non-empty string`)
  return value
}

function expectBoolean(value: unknown, source: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${source} must be a boolean`)
  return value
}

function expectNumber(value: unknown, source: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) throw new Error(`${source} must be a number`)
  return value
}

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isMissingFileError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

// ── Bash command classification for permission.ask hook ─────────────────────

const BANNED_COMMANDS: ReadonlyArray<RegExp> = [
  /\b(vim?|nano|emacs|pico|ed)\b/,           // interactive editors
  /\b(less|more|most|pg)\b/,                   // pagers
  /\bman\s/,                                   // man pages
  /\b(python|python3|ipython)\b(\s*$)/,       // Python REPL
  /\b(node|bun|deno)\b(\s*$)/,                // JS REPL
  /\b(irb|ghci|scala|jshell)\b(\s*$)/,        // other REPLs
  /\b(bash|zsh|fish|sh)\s+-i\b/,              // interactive shells
  /\bgit\s+add\s+-p\b/,                        // interactive git add
  /\bgit\s+rebase\s+-i\b/,                     // interactive rebase
  /\bgit\s+commit\b(?!\s+-m)/,                 // commit without -m
]

const SAFE_BASH_PREFIXES: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ["npm",      ["test", "run", "start", "build", "lint", "typecheck", "check", "info", "list", "view", "outdated", "audit", "pack"]],
  ["npx",      []],
  ["node",     []],
  ["bun",      ["test", "run", "build", "install", "add", "remove"]],
  ["yarn",     ["test", "run", "build", "install", "add", "remove", "lint", "typecheck"]],
  ["pnpm",     ["test", "run", "build", "install", "add", "remove", "lint", "typecheck"]],
  ["git",      ["status", "log", "diff", "branch", "show", "remote", "stash", "tag", "describe"]],
  ["tsc",      []],
  ["eslint",   []],
  ["prettier", []],
  ["jest",     []],
  ["vitest",   []],
  ["pytest",   []],
  ["cargo",    ["test", "check", "build", "clippy", "fmt"]],
  ["make",     ["test", "check", "build", "lint", "clean"]],
]

const DANGEROUS_BASH_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\s+.*-[rR].*[fF].*\s+\//,          // rm -rf /... (absolute path)
  /\bgit\s+push\s+.*(--force|-f\b)/,       // force push
  /\bgit\s+reset\s+--hard/,                // hard reset
  /\bgit\s+clean\s+-fd/,                   // clean untracked files
  /\bsudo\s+rm\b/,                         // sudo rm
  /\bdd\s+.*of=\/dev\//,                   // dd to device
  /\bchmod\s+-R\s+777\s+\//,              // chmod everything
  /\b(DROP|TRUNCATE)\s/i,                  // SQL destructive
]

const ALWAYS_SAFE_COMMANDS: ReadonlyArray<string> = [
  "ls", "cat", "head", "tail", "wc", "which", "echo", "pwd", "env",
  "printenv", "whoami", "uname", "date", "df", "du", "free", "top",
  "ps", "grep", "find", "sort", "uniq", "diff", "file", "stat",
  "touch", "mkdir", "cp", "mv", "sed", "awk", "tr", "cut", "xargs",
  "curl", "wget", "dig", "nslookup", "ping",
]

function classifyBashCommand(pattern: string): "allow" | "deny" | "ask" {
  const cmd = pattern.trim()

  // Check banned interactive commands first (will hang in non-interactive shell)
  for (const re of BANNED_COMMANDS) {
    if (re.test(cmd)) return "deny"
  }

  // Check dangerous patterns
  for (const re of DANGEROUS_BASH_PATTERNS) {
    if (re.test(cmd)) return "deny"
  }

  // Simple always-safe commands
  const firstToken = cmd.split(/\s+/)[0]
  if (ALWAYS_SAFE_COMMANDS.includes(firstToken)) return "allow"

  // Prefixed commands (npm test, git status, etc.)
  for (const [prefix, subcommands] of SAFE_BASH_PREFIXES) {
    if (firstToken !== prefix) continue
    // If no subcommands listed, the prefix itself is safe (e.g. npx, node)
    if (subcommands.length === 0) return "allow"
    const secondToken = cmd.split(/\s+/)[1]
    if (secondToken && subcommands.includes(secondToken)) return "allow"
  }

  return "ask"
}
