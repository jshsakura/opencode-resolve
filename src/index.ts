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
    "INTELLIGENT RECOVERY: On verify failure, dispatch debugger FIRST to diagnose root cause, THEN re-dispatch coder with precise fix. Do NOT blindly retry.",
    "Trivial fixes → apply yourself. No subagent needed.",
    "3 consecutive failures → STOP, REVERT, REPORT, ASK user.",
    "10+ failures on same task → call architect to rethink the approach before continuing.",
    "",
    "If piloci MCP available: piloci_recall before inspecting code, piloci_memory after learning something non-obvious.",
    "",
    "Verify: type check or lint MUST pass on changed files. NO EVIDENCE = NOT COMPLETE.",
    "After non-trivial work: ask user to capture lesson → HARNESS.md (infra) or AGENTS.md (agent behavior).",
    "",
    "NEVER: as any / @ts-ignore / leave code broken / delete failing tests / commit without request.",
    "",
    "Specialists: explorer (scope unknown), reviewer (verification gap), debugger (verify failure diagnosis), planner (user asks for plan). No deep-reviewer.",
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
    "INTELLIGENT RECOVERY: On verify failure, dispatch debugger FIRST to diagnose root cause, THEN re-dispatch coder with precise fix. Do NOT blindly retry.",
    "Trivial fixes → apply yourself. No subagent needed.",
    "3 consecutive failures → STOP, REVERT, REPORT, ASK user.",
    "10+ failures on same task → call architect to rethink the approach before continuing.",
    "",
    "If piloci MCP available: piloci_recall before inspecting code, piloci_memory after learning something non-obvious.",
    "",
    "Verify: type check or lint MUST pass on changed files. NO EVIDENCE = NOT COMPLETE.",
    "After non-trivial work: ask user to capture lesson → HARNESS.md (infra) or AGENTS.md (agent behavior).",
    "",
    "NEVER: as any / @ts-ignore / leave code broken / delete failing tests / commit without request.",
    "",
    "Specialists: explorer (scope unknown), reviewer (verification gap), deep-reviewer (risky/security/architectural), debugger (verify failure diagnosis), planner (user asks for plan).",
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
    "INTELLIGENT RECOVERY: On verify failure, dispatch debugger FIRST to diagnose root cause, THEN re-dispatch coder with precise fix. Do NOT blindly retry.",
    "Trivial fixes → apply yourself. No subagent needed.",
    "3 consecutive failures → STOP, REVERT, REPORT, ASK user.",
    "10+ failures on same task → call architect to rethink the approach before continuing.",
    "",
    "If piloci MCP available: piloci_recall before inspecting code, piloci_memory after learning something non-obvious.",
    "",
    "Verify: type check or lint MUST pass on changed files. Check LSP diagnostics when available. NO EVIDENCE = NOT COMPLETE.",
    "After non-trivial work: ask user to capture lesson → HARNESS.md (infra) or AGENTS.md (agent behavior).",
    "",
    "NEVER: as any / @ts-ignore / leave code broken / delete failing tests / commit without request.",
    "",
    "Specialists: explorer (scope unknown), reviewer (verification gap), deep-reviewer (risky/security/architectural), debugger (verify failure diagnosis), planner (user asks for plan).",
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

  // Track failure patterns for runtime warnings
  const failurePatterns = new Map<string, { count: number; lastMessage: string; timestamp: number }>()
  const FAILURE_PATTERN_TTL_MS = 120_000 // 2 minutes
  const FAILURE_THRESHOLD = 10 // warn after 10 same-command failures — Ralph Loop should keep going
  const STRATEGY_PIVOT_THRESHOLD = 20 // after 20 total failures, suggest architect intervention
  let failureWarnings: string[] = [] // injected into system prompt
  let totalFailures = 0 // cross-tool failure count for strategy pivot

  // ── Ralph Loop: edit hotspot + loop detection ───────────────────────────
  const editHotspots = new Map<string, { count: number; lastEditTime: number }>()
  const EDIT_HOTSPOT_THRESHOLD = 10 // same file edited ≥10 times before suggesting strategy change
  const EDIT_HOTSPOT_TTL_MS = 600_000 // 10 minutes window — give the loop room to work
  let totalEdits = 0
  let totalToolCalls = 0
  let sessionStartTime = Date.now()
  let loopWarnings: string[] = [] // injected alongside failure warnings
  let lastStrategyHint = "" // avoid repeating the same hint

  return {
    // ── Event: capture LSP diagnostics + track failure patterns ───────────
    event: async (input) => {
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
            recentDiagnostics.set(props.path, { errors, warnings, timestamp: Date.now() })
          } else {
            recentDiagnostics.delete(props.path)
          }
          const now = Date.now()
          for (const [key, value] of recentDiagnostics) {
            if (now - value.timestamp > DIAGNOSTICS_TTL_MS) recentDiagnostics.delete(key)
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
            const existing = failurePatterns.get(toolName)
            const msg = String(part?.output ?? part?.error ?? "").slice(0, 200)
            if (existing) {
              existing.count++
              existing.lastMessage = msg
              existing.timestamp = Date.now()
            } else {
              failurePatterns.set(toolName, { count: 1, lastMessage: msg, timestamp: Date.now() })
            }
            // Prune stale entries
            const now = Date.now()
            for (const [k, v] of failurePatterns) {
              if (now - v.timestamp > FAILURE_PATTERN_TTL_MS) failurePatterns.delete(k)
            }
            // Generate warnings for recurring failures
            totalFailures++
            failureWarnings = []
            for (const [, v] of failurePatterns) {
              if (v.count >= FAILURE_THRESHOLD) {
                failureWarnings.push(`Tool '${toolName}' failed ${v.count} times. Last: ${v.lastMessage}`)
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
          const existing = failurePatterns.get("session")
          if (existing) {
            existing.count++
            existing.lastMessage = msg
            existing.timestamp = Date.now()
          } else {
            failurePatterns.set("session", { count: 1, lastMessage: msg, timestamp: Date.now() })
          }
          failureWarnings = []
          totalFailures++
          for (const [, v] of failurePatterns) {
            if (v.count >= FAILURE_THRESHOLD) {
              failureWarnings.push(`Session error repeated ${v.count} times: ${v.lastMessage}`)
            }
          }
        }
      }

      // ── Ralph Loop: track edit tool calls for hotspot detection ────────
      if (evt.type === "message.part.updated") {
        const props = evt.properties as { part?: any }
        const part = props.part
        if (part?.type === "tool-invocation" || part?.type === "tool-use") {
          totalToolCalls++
          const toolName = part.tool ?? part.toolName ?? ""
          if (toolName === "edit" || toolName === "write") {
            totalEdits++
            const filePath = part.args?.filePath ?? part.args?.path ?? ""
            if (filePath) {
              const existing = editHotspots.get(filePath)
              if (existing) {
                existing.count++
                existing.lastEditTime = Date.now()
              } else {
                editHotspots.set(filePath, { count: 1, lastEditTime: Date.now() })
              }
              // Prune stale entries
              const now = Date.now()
              for (const [k, v] of editHotspots) {
                if (now - v.lastEditTime > EDIT_HOTSPOT_TTL_MS) editHotspots.delete(k)
              }
              // Generate loop warnings
              loopWarnings = []
              for (const [file, data] of editHotspots) {
                if (data.count >= EDIT_HOTSPOT_THRESHOLD) {
                  loopWarnings.push(
                    `File '${file}' edited ${data.count} times — consider a different approach. Keep iterating.`,
                  )
                }
              }
            }
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
        NODE_OPTIONS: process.env.NODE_OPTIONS ?? "", // preserve existing
        NO_COLOR: output.env?.NO_COLOR,              // preserve if set
        LANG: output.env?.LANG ?? "en_US.UTF-8",     // consistent locale
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

    // ── Chat params: per-profile temperature, token limits, topP, topK ──────
    "chat.params": async (input, output) => {
      const profile = storedConfig?.profile
      if (profile === "glm") {
        output.temperature = Math.min(output.temperature, 0.4)
        if (output.maxOutputTokens === undefined || output.maxOutputTokens > 16384) {
          output.maxOutputTokens = 16384
        }
        // GLM: tighter topP for deterministic output
        if (output.topP === undefined || output.topP > 0.9) {
          output.topP = 0.85
        }
      } else if (profile === "gpt") {
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
      // Write agents: slightly higher temperature for creative problem-solving
      const writeAgents = new Set(["coder", "resolver", "glm", "gpt-coder"])
      if (writeAgents.has(input.agent) && output.temperature === undefined) {
        output.temperature = 0.5
      }
    },

    // ── Tool definition: enrich tool descriptions with discipline hints ──
    "tool.definition": async (input, output) => {
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

    // ── Tool execute before: pre-process tool args + warn on risky patterns ──
    "tool.execute.before": async (input, output) => {
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

    // ── Chat headers: provider-specific optimizations ─────────────────────
    "chat.headers": async (input, output) => {
      const providerID = input.provider?.info?.id ?? ""
      // For GLM providers: add retry-after hint to avoid rate limiting
      if (providerID.includes("zai") || providerID.includes("glm") || providerID.includes("bigmodel")) {
        output.headers["X-Custom-Retry-Strategy"] = "exponential"
      }
    },

    // ── Tool execute after: inject verification hints + LSP diagnostics + failure extraction ──
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
          // Ralph Loop: track edit hotspot
          const existing = editHotspots.get(editedPath)
          if (existing) {
            existing.count++
            existing.lastEditTime = Date.now()
          } else {
            editHotspots.set(editedPath, { count: 1, lastEditTime: Date.now() })
          }
          // Ralph Loop: inject loop warning into metadata
          const hotspot = editHotspots.get(editedPath)
          if (hotspot && hotspot.count >= EDIT_HOTSPOT_THRESHOLD) {
            meta._resolve_loop_warning = `This file has been edited ${hotspot.count} times. Consider a different approach.`
          }
        }
        output.metadata = meta

        // Ralph Loop: update loopWarnings after every edit/write
        loopWarnings = []
        for (const [file, data] of editHotspots) {
          if (data.count >= EDIT_HOTSPOT_THRESHOLD) {
            loopWarnings.push(
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

    // ── Session compacting: preserve critical context during compaction ───
    "experimental.session.compacting": async (_input, output) => {
      const ctx = storedProjectContext
      const cfg = storedConfig
      if (!ctx && !cfg) return

      const contextLines: string[] = []
      // Profile and tier info
      if (cfg?.profile) contextLines.push(`Profile: ${cfg.profile}.`)
      if (cfg?.tier) contextLines.push(`Tier: ${cfg.tier}.`)
      // Project context
      if (ctx?.knowledgeFiles.length) {
        contextLines.push(`Project knowledge files: ${ctx.knowledgeFiles.join(", ")}.`)
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
      if (failureWarnings.length > 0) {
        contextLines.push(`Active warnings: ${failureWarnings.join("; ")}`)
      }
      // Ralph Loop: preserve loop state
      if (loopWarnings.length > 0) {
        contextLines.push(`Loop warnings: ${loopWarnings.join("; ")}`)
      }
      // Ralph Loop: preserve session stats
      if (totalEdits > 0) {
        contextLines.push(`Session stats: ${totalEdits} edits, ${totalToolCalls} tool calls.`)
      }

      if (contextLines.length > 0) {
        output.context.push("[" + "opencode-resolve" + "] Project context (preserve): " + contextLines.join(" "))
      }
    },

    // ── Chat messages transform: replace generic summarize prompts ──────────
    "experimental.chat.messages.transform": async (_input, output) => {
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

    // ── Auto-continue after compaction ────────────────────────────────────
    "experimental.compaction.autocontinue": async (_input, output) => {
      // Always enable auto-continue — the resolver should keep driving
      output.enabled = true
    },

    // ── System prompt transform: inject project context + failure + loop warnings ──
    "experimental.chat.system.transform": async (_input, output) => {
      const ctx = storedProjectContext
      const hasFailures = failureWarnings.length > 0
      const hasLoops = loopWarnings.length > 0
      if (!ctx && !hasFailures && !hasLoops) return

      const lines: string[] = []

      if (ctx?.knowledgeFiles.length) {
        lines.push(`[opencode-resolve] Project knowledge: ${ctx.knowledgeFiles.join(", ")}. Read before modifying code.`)
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
        for (const w of failureWarnings.slice(0, 3)) {
          lines.push(`  - ${w}`)
        }
        lines.push("Keep going — try a different approach for the same goal. The Ralph Loop should drive to completion.")
      }

      // Strategy Pivot: after many total failures, suggest architect intervention
      if (totalFailures >= STRATEGY_PIVOT_THRESHOLD) {
        lines.push(`[opencode-resolve] 🔀 STRATEGY PIVOT: ${totalFailures} total failures detected.`)
        lines.push("The current approach is not working. Dispatch ARCHITECT to analyze the problem from scratch and propose a fundamentally different strategy.")
        lines.push("Then apply the new strategy. Do NOT keep retrying the same approach.")
      }

      // Ralph Loop: inject strategy hints when same file edited many times
      if (hasLoops) {
        lines.push("[opencode-resolve] 🔄 Ralph Loop: heavy editing detected on same file(s):")
        for (const w of loopWarnings.slice(0, 3)) {
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
        if (hint !== lastStrategyHint) {
          lines.push(`Strategy suggestion: ${hint}`)
          lastStrategyHint = hint
        }
        lines.push("Keep driving — the Ralph Loop should keep iterating until verified resolution.")
      }

      // Ralph Loop: inject session context when significant work done
      if (totalEdits >= 20 && failureWarnings.length > 0) {
        lines.push(`[opencode-resolve] 📊 Session stats: ${totalEdits} edits, ${totalToolCalls} tool calls, ${Math.round((Date.now() - sessionStartTime) / 1000)}s elapsed.`)
        lines.push("Significant iteration with failures. Consider a fundamentally different approach — but keep going.")
      }

      if (lines.length > 0) {
        output.system.push(lines.join("\n"))
      }
    },

    // ── Text complete: post-turn verification nudge + loop detection ──────
    "experimental.text.complete": async (_input, output) => {
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
      if (looksLikeLoop && loopWarnings.length > 0) {
        output.text = (output.text ?? text) + "\n\n[opencode-resolve] 🔄 Ralph Loop: heavy iteration detected. Use resolve-diagnostics to check current state, then try a different approach. Keep driving to completion."
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

      "resolve-search": tool({
        description: "Search codebase with ripgrep. Returns matching file paths, line numbers, and content. Faster and more targeted than grep tool.",
        args: {
          query: tool.schema.string().describe("Search pattern (regex supported)."),
          glob: tool.schema.string().optional().describe("File glob filter (e.g. '*.ts', '*.{ts,tsx}')."),
          max_results: tool.schema.number().optional().describe("Max results to return (default 30)."),
        },
        async execute(args, ctx) {
          const maxResults = Math.min(args.max_results ?? 30, 100)
          let cmd = `rg --no-heading --line-number --max-count ${maxResults} --color never`
          if (args.glob) cmd += ` --glob '${sanitizeShellArg(args.glob)}'`
          cmd += ` '${sanitizeShellArg(args.query)}' .`
          try {
            const result = await runCommand(cmd, ctx.directory, 15_000)
            if (result.exitCode === 1) return "No matches found."
            if (result.exitCode !== 0) return `Search error: ${truncateOutput(result.stderr, 300)}`
            const lines = result.stdout.trim().split("\n").slice(0, maxResults)
            ctx.metadata({ title: `search: ${args.query} (${lines.length} results)` })
            return truncateOutput(lines.join("\n"), 3000)
          } catch (err) {
            return `Search failed: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-test": tool({
        description: "Run specific test file(s) or test pattern. Detects test runner from project context (npm/yarn/pnpm/bun).",
        args: {
          file: tool.schema.string().optional().describe("Test file path or glob pattern (e.g. 'test/plugin.test.mjs')."),
          pattern: tool.schema.string().optional().describe("Test name pattern to filter (e.g. 'GLM profile')."),
          runner: tool.schema.string().optional().describe("Override test runner command (e.g. 'vitest run', 'jest')."),
        },
        async execute(args, ctx) {
          const projCtx = storedProjectContext
          // Determine test command
          let testCmd = args.runner
          if (!testCmd) {
            // Find test runner from verify commands or package manager
            const testVerify = projCtx?.verifyCommands.find(c => /\btest\b/.test(c))
            if (testVerify) {
              testCmd = testVerify
            } else {
              const pm = projCtx?.packageManager ?? "npm"
              testCmd = `${pm} test`
            }
          }
          // Append file filter
          if (args.file) testCmd += ` '${sanitizeShellArg(args.file)}'`
          // Append pattern filter
          if (args.pattern) {
            const safePattern = sanitizeShellArg(args.pattern)
            if (testCmd.includes("vitest")) testCmd += ` -t '${safePattern}'`
            else if (testCmd.includes("jest")) testCmd += ` -t '${safePattern}'`
            else testCmd += ` --grep '${safePattern}'`
          }
          try {
            const result = await runCommand(testCmd, ctx.directory, 60_000)
            ctx.metadata({ title: `test: ${args.file ?? "all"}${args.pattern ? ` /${args.pattern}/` : ""}` })
            if (result.exitCode === 0) {
              return { output: `✅ Tests passed.\n${truncateOutput(result.stdout, 800)}`, metadata: { exitCode: 0 } }
            }
            return { output: `❌ Tests failed (exit ${result.exitCode}).\n${truncateOutput(result.stderr || result.stdout, 1500)}`, metadata: { exitCode: result.exitCode } }
          } catch (err) {
            return `⚠️ Test runner failed: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-pattern": tool({
        description: "Detect code anti-patterns in specified files. Scans for: 'as any', '@ts-ignore', '@ts-nocheck', empty catch blocks, console.log, TODO/FIXME, and large functions.",
        args: {
          paths: tool.schema.string().optional().describe("File or directory paths to scan (space-separated). Defaults to 'src/'."),
          checks: tool.schema.array(tool.schema.string()).optional().describe("Specific checks to run: 'as-any', 'ts-ignore', 'empty-catch', 'console-log', 'todo', 'large-functions'. Default: all."),
        },
        async execute(args, ctx) {
          const targets = args.paths ?? "src/"
          const safeTargets = targets.split(" ").map(t => `'${sanitizeShellArg(t)}'`).join(" ")
          const allChecks = ["as-any", "ts-ignore", "empty-catch", "console-log", "todo", "large-functions"] as const
          const checks = (args.checks?.length ? args.checks : allChecks) as string[]
          const patterns: Record<string, { regex: string; label: string }> = {
            "as-any": { regex: "\\bas\\s+any\\b", label: "as any" },
            "ts-ignore": { regex: "@ts-(?:ignore|nocheck|expect-error)", label: "@ts-ignore/@ts-nocheck" },
            "empty-catch": { regex: "catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}", label: "empty catch" },
            "console-log": { regex: "console\\.log\\(", label: "console.log" },
            "todo": { regex: "\\b(?:TODO|FIXME|HACK|XXX)\\b", label: "TODO/FIXME" },
          }
          const results: string[] = []
          for (const check of checks) {
            if (check === "large-functions") {
              // Find files over 300 lines
              try {
                const wc = await runCommand(`find ${safeTargets} -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' | head -50 | xargs wc -l 2>/dev/null | sort -rn | head -20`, ctx.directory, 10_000)
                if (wc.exitCode === 0) {
                  const bigFiles = wc.stdout.trim().split("\n").filter(l => {
                    const num = parseInt(l.trim())
                    return !isNaN(num) && num > 300
                  })
                  if (bigFiles.length > 0) results.push(`Large files (>300 lines):\n${bigFiles.join("\n")}`)
                }
              } catch { /* skip */ }
              continue
            }
            const p = patterns[check]
            if (!p) continue
            try {
              const rg = await runCommand(`rg --no-heading --line-number --color never '${p.regex}' ${safeTargets} 2>/dev/null | head -20`, ctx.directory, 10_000)
              if (rg.exitCode === 0 && rg.stdout.trim()) {
                const count = rg.stdout.trim().split("\n").length
                results.push(`${p.label} (${count} found):\n${truncateOutput(rg.stdout.trim(), 800)}`)
              }
            } catch { /* skip */ }
          }
          ctx.metadata({ title: `pattern scan: ${checks.join(", ")}${results.length > 0 ? ` (${results.length} issues)` : " (clean)"}` })
          return results.length > 0 ? results.join("\n\n") : "No anti-patterns detected. ✅"
        },
      }),

      "resolve-complexity": tool({
        description: "Analyze file complexity: line count, import count, export count, and function count. Helps identify files that may need refactoring.",
        args: {
          paths: tool.schema.string().optional().describe("File or directory paths to analyze (space-separated). Defaults to 'src/'."),
          threshold: tool.schema.number().optional().describe("Only show files with more than this many lines (default 50)."),
        },
        async execute(args, ctx) {
          const targets = args.paths ?? "src/"
          const safeTargets = targets.split(" ").map(t => `'${sanitizeShellArg(t)}'`).join(" ")
          const threshold = args.threshold ?? 50
          try {
            const result = await runCommand(`find ${safeTargets} -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' \\) | head -100 | xargs wc -l 2>/dev/null | sort -rn | head -30`, ctx.directory, 10_000)
            if (result.exitCode !== 0 || !result.stdout.trim()) return "No source files found."
            const lines = result.stdout.trim().split("\n").filter(l => {
              const num = parseInt(l.trim())
              return !isNaN(num) && num >= threshold
            })
            // Enrich with import/export/function counts for top files
            const enriched: string[] = []
            for (const line of lines.slice(0, 10)) {
              const parts = line.trim().split(/\s+/)
              const lineCount = parseInt(parts[0])
              const filePath = parts.slice(1).join(" ")
              if (!filePath || filePath === "total") { enriched.push(line); continue }
              try {
                const imports = await runCommand(`grep -c '\\bimport\\b\\|\\brequire(' '${filePath}' 2>/dev/null || echo 0`, ctx.directory, 5_000)
                const exports = await runCommand(`grep -c '\\bexport\\b' '${filePath}' 2>/dev/null || echo 0`, ctx.directory, 5_000)
                const fns = await runCommand(`grep -cE '\\bfunction\\b|=>\\s*[{(]|\\basync\\b' '${filePath}' 2>/dev/null || echo 0`, ctx.directory, 5_000)
                enriched.push(`${filePath}: ${lineCount} lines, ${imports.stdout.trim()} imports, ${exports.stdout.trim()} exports, ~${fns.stdout.trim()} functions`)
              } catch {
                enriched.push(`${filePath}: ${lineCount} lines`)
              }
            }
            ctx.metadata({ title: `complexity: ${enriched.length} files analyzed` })
            return enriched.length > 0 ? enriched.join("\n") : `All files under ${threshold} lines. ✅`
          } catch (err) {
            return `Analysis failed: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-file-info": tool({
        description: "Get file metadata quickly: size, last modified, line count, language, and whether it's tracked by git. Faster than reading full file contents.",
        args: {
          path: tool.schema.string().describe("File path to inspect."),
        },
        async execute(args, ctx) {
          const filePath = resolve(ctx.directory, args.path)
          try {
            const s = await stat(filePath)
            if (!s.isFile()) return `${args.path}: not a file.`
            const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
            const langMap: Record<string, string> = {
              ts: "TypeScript", tsx: "TypeScript (JSX)", js: "JavaScript", mjs: "JavaScript (ESM)",
              json: "JSON", md: "Markdown", yml: "YAML", yaml: "YAML", py: "Python",
              go: "Go", rs: "Rust", java: "Java", rb: "Ruby", sh: "Shell", css: "CSS", html: "HTML",
            }
            const lines: string[] = [
              `Path: ${args.path}`,
              `Size: ${s.size} bytes`,
              `Modified: ${s.mtime.toISOString()}`,
              `Language: ${langMap[ext] ?? ext.toUpperCase()}`,
            ]
            // Quick line count
            try {
              const wc = await runCommand(`wc -l '${filePath}'`, ctx.directory, 5_000)
              if (wc.exitCode === 0) lines.push(`Lines: ${wc.stdout.trim().split(/\s+/)[0]}`)
            } catch { /* skip */ }
            // Git tracked?
            try {
              const git = await runCommand(`git ls-files --error-unmatch '${filePath}' 2>/dev/null`, ctx.directory, 3_000)
              lines.push(`Git: ${git.exitCode === 0 ? "tracked" : "untracked"}`)
            } catch {
              lines.push("Git: not a git repo")
            }
            ctx.metadata({ title: `file-info: ${args.path}` })
            return lines.join("\n")
          } catch {
            return `File not found: ${args.path}`
          }
        },
      }),

      "resolve-outdated": tool({
        description: "Check which dependencies are outdated by comparing package.json versions against npm registry. Returns current vs latest for each package.",
        args: {
          dev: tool.schema.boolean().optional().describe("Check devDependencies instead of dependencies."),
          filter: tool.schema.string().optional().describe("Only check packages matching this prefix (e.g. '@opencode-ai')."),
        },
        async execute(args, ctx) {
          try {
            const pkgRaw = await readFile(join(ctx.directory, "package.json"), "utf8")
            const pkg = JSON.parse(pkgRaw)
            const section = args.dev ? pkg.devDependencies : pkg.dependencies
            if (!section || Object.keys(section).length === 0) {
              return args.dev ? "No devDependencies." : "No dependencies."
            }
            const entries = Object.entries(section as Record<string, string>)
              .filter(([name]) => !args.filter || name.startsWith(args.filter))
              .slice(0, 20) // limit checks to avoid flooding npm
            if (entries.length === 0) return "No matching packages."
            const results: string[] = []
            // Batch check with npm outdated (fast, single command)
            const pkgNames = entries.map(([name]) => `"${name}"`).join(" ")
            const outdated = await runCommand(
              `npm outdated ${pkgNames} --json --long 2>/dev/null || true`,
              ctx.directory, 30_000,
            )
            if (outdated.stdout.trim()) {
              try {
                const data = JSON.parse(outdated.stdout) as Record<string, { current?: string; latest?: string; wanted?: string }>
                for (const [name, info] of Object.entries(data)) {
                  results.push(`${name}: ${info.current ?? "?"} → ${info.latest ?? "?"}`)
                }
              } catch {
                // fallback: show raw
                results.push(truncateOutput(outdated.stdout, 500))
              }
            }
            ctx.metadata({ title: `outdated: ${results.length} packages checked` })
            return results.length > 0 ? `Outdated packages:\n${results.join("\n")}` : "All checked packages are up to date. ✅"
          } catch {
            return "No package.json found or npm unavailable."
          }
        },
      }),

      "resolve-readme": tool({
        description: "Extract key information from project README: description, setup instructions, dependencies, and architecture notes. Saves reading the full file.",
        args: {
          max_length: tool.schema.number().optional().describe("Max summary length (default 2000)."),
        },
        async execute(args, ctx) {
          const maxLen = args.max_length ?? 2000
          // Try common README locations
          for (const name of ["README.md", "readme.md", "README.MD", "README", "README.txt"]) {
            const filePath = join(ctx.directory, name)
            try {
              const content = await readFile(filePath, "utf8")
              if (!content.trim()) continue
              // Extract structured info: first heading, first paragraph, any ## sections
              const lines = content.split("\n")
              const heading = lines.find(l => l.startsWith("#"))
              const sections: string[] = []
              let currentSection: string[] = []
              for (const line of lines) {
                if (line.startsWith("## ")) {
                  if (currentSection.length > 0) {
                    sections.push(currentSection.join("\n").trim())
                  }
                  currentSection = [line]
                } else {
                  currentSection.push(line)
                }
              }
              if (currentSection.length > 0) sections.push(currentSection.join("\n").trim())
              // Build summary
              const summaryParts: string[] = []
              if (heading) summaryParts.push(heading)
              // Extract key sections
              for (const section of sections) {
                const sectionLines = section.split("\n")
                const title = sectionLines[0]
                const keySections = /install|setup|usage|architect|config|getting.start|require|depend/i
                if (keySections.test(title)) {
                  summaryParts.push(section.slice(0, 500).trim())
                }
              }
              const summary = summaryParts.join("\n\n")
              ctx.metadata({ title: `readme: ${name}` })
              return truncateOutput(summary, maxLen) || "README exists but is empty or unparseable."
            } catch { /* not found, try next */ }
          }
          return "No README found in project root."
        },
      }),

      "resolve-init": tool({
        description: "Initialize opencode-resolve config files for the project. Creates resolve.json with detected settings, and optionally HARNESS.md + AGENTS.md scaffolds.",
        args: {
          dry_run: tool.schema.boolean().optional().describe("If true, show what would be created without writing files."),
          harness: tool.schema.boolean().optional().describe("Also create HARNESS.md scaffold."),
          agents: tool.schema.boolean().optional().describe("Also create AGENTS.md scaffold."),
        },
        async execute(args, ctx) {
          const projCtx = storedProjectContext
          const results: string[] = []
          const dryRun = args.dry_run ?? false

          // Build resolve.json content
          const resolveConfig: Record<string, unknown> = {}
          if (storedConfig?.profile) resolveConfig.profile = storedConfig.profile
          if (storedConfig?.tier) resolveConfig.tier = storedConfig.tier
          if (projCtx?.verifyCommands.length) {
            results.push(`Detected verify: ${projCtx.verifyCommands.join(", ")}`)
          }
          if (projCtx?.packageManager) {
            results.push(`Package manager: ${projCtx.packageManager}`)
          }
          if (projCtx?.hasTypeScript) {
            results.push("TypeScript: yes")
          }

          if (!dryRun) {
            const configPath = join(ctx.directory, "opencode-resolve.json")
            try {
              await access(configPath)
              results.push("resolve.json: already exists, skipping")
            } catch {
              writeFileSync(configPath, JSON.stringify(resolveConfig, null, 2) + "\n")
              results.push("resolve.json: created")
            }
          } else {
            results.push(`[DRY RUN] Would create resolve.json: ${JSON.stringify(resolveConfig)}`)
          }

          // HARNESS.md scaffold
          if (args.harness) {
            const harnessContent = [
              "# Project Infrastructure",
              "",
              "## Build & Verify",
              ...(projCtx?.verifyCommands.map(c => `- \`${c}\``) ?? []),
              "",
              "## Architecture Decisions",
              "- _Add key decisions here_",
              "",
              "## Known Traps",
              "- _Add project-specific pitfalls here_",
            ].join("\n")
            if (!dryRun) {
              const harnessPath = join(ctx.directory, "HARNESS.md")
              try {
                await access(harnessPath)
                results.push("HARNESS.md: already exists, skipping")
              } catch {
                writeFileSync(harnessPath, harnessContent + "\n")
                results.push("HARNESS.md: created")
              }
            } else {
              results.push(`[DRY RUN] Would create HARNESS.md (${harnessContent.length} bytes)`)
            }
          }

          // AGENTS.md scaffold
          if (args.agents) {
            const agentsContent = [
              "# Agent Behavior Patterns",
              "",
              "## Delegation Strategy",
              "- _Document how tasks should be delegated here_",
              "",
              "## Verification Protocol",
              "- _Document verification expectations here_",
              "",
              "## Model-Specific Notes",
              "- _Add GLM/GPT specific patterns here_",
            ].join("\n")
            if (!dryRun) {
              const agentsPath = join(ctx.directory, "AGENTS.md")
              try {
                await access(agentsPath)
                results.push("AGENTS.md: already exists, skipping")
              } catch {
                writeFileSync(agentsPath, agentsContent + "\n")
                results.push("AGENTS.md: created")
              }
            } else {
              results.push(`[DRY RUN] Would create AGENTS.md (${agentsContent.length} bytes)`)
            }
          }

          ctx.metadata({ title: `init: ${results.length} items` })
          return results.join("\n")
        },
      }),

      "resolve-diff": tool({
        description: "Show focused git diff summary. Supports comparing against last commit, a specific commit, or between branches. Much faster than reading full diff.",
        args: {
          ref: tool.schema.string().optional().describe("Git ref to compare against (e.g. 'HEAD~1', 'main', 'v1.0.0'). Defaults to staged+unstaged changes."),
          file: tool.schema.string().optional().describe("Only show diff for this file path."),
          stat_only: tool.schema.boolean().optional().describe("If true, only show file-level stat (no line diffs)."),
        },
        async execute(args, ctx) {
          try {
            let cmd: string
            const fileFilter = args.file ? ` -- '${sanitizeShellArg(args.file)}'` : ""

            if (args.ref) {
              const safeRef = sanitizeShellArg(args.ref)
              if (args.stat_only) {
                cmd = `git diff --stat ${safeRef}${fileFilter}`
              } else {
                cmd = `git diff --stat --patch ${safeRef}${fileFilter}`
              }
            } else {
              if (args.stat_only) {
                cmd = `git diff --stat HEAD${fileFilter}`
              } else {
                cmd = `git diff --stat --patch HEAD${fileFilter}`
              }
            }

            const result = await runCommand(cmd, ctx.directory, 15_000)
            if (result.exitCode !== 0) return `Git diff failed: ${truncateOutput(result.stderr, 300)}`
            if (!result.stdout.trim()) return "No changes detected."
            ctx.metadata({ title: `diff: ${args.ref ?? "HEAD"}${args.file ? ` ${args.file}` : ""}` })
            return truncateOutput(result.stdout, 3000)
          } catch {
            return "Not a git repository or git unavailable."
          }
        },
      }),

      "resolve-scripts": tool({
        description: "List package.json scripts with their commands. Helps discover available build, test, lint, and dev commands.",
        args: {
          filter: tool.schema.string().optional().describe("Only show scripts matching this substring (e.g. 'test', 'build')."),
          verbose: tool.schema.boolean().optional().describe("If true, also show the full command for each script."),
        },
        async execute(args, ctx) {
          try {
            const pkgRaw = await readFile(join(ctx.directory, "package.json"), "utf8")
            const pkg = JSON.parse(pkgRaw)
            const scripts = pkg.scripts as Record<string, string> | undefined
            if (!scripts || Object.keys(scripts).length === 0) return "No scripts found in package.json."

            const entries = Object.entries(scripts)
              .filter(([name]) => !args.filter || name.includes(args.filter))
            if (entries.length === 0) return `No scripts matching '${args.filter}'.`

            const lines = entries.map(([name, cmd]) => {
              if (args.verbose) return `${name}: ${cmd}`
              return name
            })
            ctx.metadata({ title: `scripts: ${entries.length} found` })
            return `Available scripts:\n${lines.join("\n")}`
          } catch {
            return "No package.json found or unreadable."
          }
        },
      }),

      "resolve-env": tool({
        description: "Check environment configuration. Reads .env.example if present, lists required variables, and shows which ones are set in the current environment.",
        args: {
          show_values: tool.schema.boolean().optional().describe("If true, show actual values (WARNING: may expose secrets). Default: false (names only)."),
        },
        async execute(args, ctx) {
          const results: string[] = []
          // Check for .env.example
          for (const name of [".env.example", ".env.sample", ".env.template"]) {
            try {
              const content = await readFile(join(ctx.directory, name), "utf8")
              const vars = content.split("\n")
                .map(l => l.trim())
                .filter(l => l && !l.startsWith("#"))
                .map(l => l.split("=")[0].trim())
                .filter(Boolean)
              if (vars.length > 0) {
                results.push(`${name} variables: ${vars.join(", ")}`)
                // Check which are set
                const set: string[] = []
                const missing: string[] = []
                for (const v of vars) {
                  if (process.env[v]) {
                    set.push(args.show_values ? `${v}=${process.env[v]}` : v)
                  } else {
                    missing.push(v)
                  }
                }
                if (set.length > 0) results.push(`Set: ${set.join(", ")}`)
                if (missing.length > 0) results.push(`Missing: ${missing.join(", ")}`)
              }
              break // found one, stop looking
            } catch { /* not found, try next */ }
          }

          // Check for .env
          try {
            await access(join(ctx.directory, ".env"))
            results.push(".env: present (not reading for safety)")
          } catch { /* no .env */ }

          if (results.length === 0) return "No .env.example or .env files found."
          ctx.metadata({ title: `env: ${results.length} items` })
          return results.join("\n")
        },
      }),

      "resolve-coverage": tool({
        description: "Run test coverage analysis. Detects coverage command from package.json scripts or uses npx c8/vitest --coverage. Returns coverage summary.",
        args: {
          command: tool.schema.string().optional().describe("Override coverage command (e.g. 'npm run test:coverage')."),
          file: tool.schema.string().optional().describe("Only check coverage for this file or directory."),
        },
        async execute(args, ctx) {
          const projCtx = storedProjectContext
          let cmd = args.command
          if (!cmd) {
            // Try to find coverage script
            try {
              const pkgRaw = await readFile(join(ctx.directory, "package.json"), "utf8")
              const pkg = JSON.parse(pkgRaw)
              const scripts = pkg.scripts as Record<string, string> | undefined
              const covScript = scripts?.["test:coverage"] ?? scripts?.["coverage"] ?? scripts?.["test:cov"]
              if (covScript) {
                const pm = projCtx?.packageManager ?? "npm"
                const scriptName = Object.keys(scripts!).find(k => scripts![k] === covScript)!
                cmd = `${pm} run ${scriptName}`
              }
            } catch { /* no package.json */ }
            if (!cmd) {
              // Try common tools
              cmd = "npx vitest run --coverage 2>/dev/null || npx c8 npm test 2>/dev/null || echo 'No coverage tool found'"
            }
          }
          if (args.file) cmd += ` '${sanitizeShellArg(args.file)}'`

          try {
            const result = await runCommand(cmd, ctx.directory, 60_000)
            ctx.metadata({ title: `coverage: ${args.file ?? "all"}` })
            if (result.exitCode === 0) {
              return { output: truncateOutput(result.stdout, 2000), metadata: { exitCode: 0 } }
            }
            return { output: `Coverage failed (exit ${result.exitCode}).\n${truncateOutput(result.stderr || result.stdout, 1000)}`, metadata: { exitCode: result.exitCode } }
          } catch (err) {
            return `Coverage error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-todo": tool({
        description: "Extract TODO, FIXME, HACK, and XXX comments from source files. Shows file, line number, and comment text. Useful for finding incomplete work.",
        args: {
          paths: tool.schema.string().optional().describe("File or directory paths to scan (space-separated). Defaults to 'src/'."),
          author: tool.schema.string().optional().describe("Filter by author name in comment (e.g. 'john')."),
        },
        async execute(args, ctx) {
          const targets = args.paths ?? "src/"
          const safeTargets = targets.split(" ").map(t => `'${sanitizeShellArg(t)}'`).join(" ")
          const pattern = args.author
            ? `\\b(?:TODO|FIXME|HACK|XXX)\\b.*${sanitizeShellArg(args.author)}`
            : `\\b(?:TODO|FIXME|HACK|XXX)\\b`
          try {
            const result = await runCommand(
              `rg --no-heading --line-number --color never -i '${pattern}' ${safeTargets} 2>/dev/null | head -50`,
              ctx.directory, 10_000,
            )
            if (result.exitCode === 1) return "No TODO/FIXME comments found. ✅"
            if (result.exitCode !== 0) return `Search error: ${truncateOutput(result.stderr, 300)}`
            const lines = result.stdout.trim().split("\n")
            // Categorize
            const todos = lines.filter(l => /\bTODO\b/i.test(l)).length
            const fixmes = lines.filter(l => /\bFIXME\b/i.test(l)).length
            const hacks = lines.filter(l => /\bHACK\b/i.test(l)).length
            const summary = `Found: ${todos} TODO, ${fixmes} FIXME, ${hacks} HACK`
            ctx.metadata({ title: `todo: ${summary}` })
            return `${summary}\n${truncateOutput(result.stdout.trim(), 2000)}`
          } catch (err) {
            return `Search failed: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-tree": tool({
        description: "Show directory structure up to a given depth. Faster than running find or ls -R. Useful for understanding project layout.",
        args: {
          path: tool.schema.string().optional().describe("Directory path to tree. Defaults to '.' (project root)."),
          depth: tool.schema.number().optional().describe("Maximum depth to traverse (default 3)."),
          exclude: tool.schema.string().optional().describe("Comma-separated exclude patterns (default: 'node_modules,.git,dist,build,.next')."),
        },
        async execute(args, ctx) {
          const dir = args.path ?? "."
          const maxDepth = Math.min(args.depth ?? 3, 6)
          const excludes = (args.exclude ?? "node_modules,.git,dist,build,.next,.cache,target")
            .split(",")
            .map(e => `-I '${sanitizeShellArg(e.trim())}'`)
            .join(" ")
          try {
            // Try tree first, fall back to find
            const result = await runCommand(
              `tree -L ${maxDepth} ${excludes} '${sanitizeShellArg(dir)}' 2>/dev/null || find '${sanitizeShellArg(dir)}' -maxdepth ${maxDepth} -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' 2>/dev/null | head -100`,
              ctx.directory, 10_000,
            )
            if (result.exitCode !== 0 && !result.stdout.trim()) {
              return `Directory not found: ${dir}`
            }
            ctx.metadata({ title: `tree: ${dir} (depth ${maxDepth})` })
            return truncateOutput(result.stdout, 3000)
          } catch (err) {
            return `Tree failed: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-metrics": tool({
        description: "Quick project health overview: file counts, dependency counts, TODO/FIXME counts, test status, and git status. Aggregates data from multiple sources into a single summary.",
        args: {
          skip_test: tool.schema.boolean().optional().describe("Skip running tests (faster). Default: false."),
        },
        async execute(args, ctx) {
          const results: string[] = []
          const projCtx = storedProjectContext

          // 1. File counts by type
          try {
            const srcFiles = await runCommand("find src -type f 2>/dev/null | wc -l", ctx.directory, 5_000)
            const testFiles = await runCommand("find test tests -type f 2>/dev/null | wc -l", ctx.directory, 5_000)
            const totalFiles = await runCommand("find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' 2>/dev/null | wc -l", ctx.directory, 5_000)
            results.push(`Files: ${totalFiles.stdout.trim()} total, ${srcFiles.stdout.trim() || "0"} src, ${testFiles.stdout.trim() || "0"} test`)
          } catch { /* skip */ }

          // 2. Dependencies
          try {
            const pkgRaw = await readFile(join(ctx.directory, "package.json"), "utf8")
            const pkg = JSON.parse(pkgRaw)
            const deps = Object.keys(pkg.dependencies ?? {}).length
            const devDeps = Object.keys(pkg.devDependencies ?? {}).length
            results.push(`Dependencies: ${deps} prod, ${devDeps} dev`)
          } catch { /* skip */ }

          // 3. TODO/FIXME count
          try {
            const todoResult = await runCommand("rg -c '\\b(?:TODO|FIXME|HACK|XXX)\\b' src 2>/dev/null | wc -l", ctx.directory, 5_000)
            const todoCount = parseInt(todoResult.stdout.trim()) || 0
            if (todoCount > 0) results.push(`TODO/FIXME: ${todoCount} files with action items`)
            else results.push("TODO/FIXME: clean ✅")
          } catch { results.push("TODO/FIXME: not checked") }

          // 4. TypeScript check (if applicable)
          if (projCtx?.hasTypeScript && projCtx.verifyCommands.length > 0) {
            const tscCmd = projCtx.verifyCommands.find(c => /tsc|typecheck|type.check/i.test(c))
            if (tscCmd) {
              try {
                const tsc = await runCommand(tscCmd, ctx.directory, 30_000)
                results.push(`TypeCheck: ${tsc.exitCode === 0 ? "pass ✅" : "fail ❌"}`)
              } catch {
                results.push("TypeCheck: error running check")
              }
            }
          }

          // 5. Test status
          if (!args.skip_test && projCtx?.verifyCommands.some(c => /test/i.test(c))) {
            const testCmd = projCtx.verifyCommands.find(c => /test/i.test(c))!
            try {
              const test = await runCommand(testCmd, ctx.directory, 60_000)
              results.push(`Tests: ${test.exitCode === 0 ? "pass ✅" : "fail ❌"}`)
            } catch {
              results.push("Tests: error running tests")
            }
          } else if (args.skip_test) {
            results.push("Tests: skipped")
          }

          // 6. Git status
          try {
            const branch = await runCommand("git rev-parse --abbrev-ref HEAD 2>/dev/null", ctx.directory, 3_000)
            const dirty = await runCommand("git status --porcelain 2>/dev/null | wc -l", ctx.directory, 3_000)
            if (branch.exitCode === 0) {
              const dirtyCount = parseInt(dirty.stdout.trim()) || 0
              results.push(`Git: ${branch.stdout.trim()}, ${dirtyCount} dirty files`)
            }
          } catch { /* skip */ }

          // 7. Project context info
          if (projCtx) {
            const info: string[] = []
            if (projCtx.packageManager) info.push(`pm: ${projCtx.packageManager}`)
            if (projCtx.hasTypeScript) info.push("TS")
            if (projCtx.hasHarness) info.push("HARNESS.md")
            if (projCtx.hasAgents) info.push("AGENTS.md")
            if (info.length > 0) results.push(`Context: ${info.join(", ")}`)
          }

          ctx.metadata({ title: `metrics: ${results.length} items` })
          return results.join("\n")
        },
      }),

      // ── Ralph Loop tools ──────────────────────────────────────────────────

      "resolve-changelog": tool({
        description: "Show recent git changes. Useful for understanding what changed in the current session and detecting if edits are going in circles (Ralph Loop detection).",
        args: {
          count: tool.schema.number().optional().describe("Number of commits to show. Default: 10."),
          file: tool.schema.string().optional().describe("Show changes for a specific file only."),
          format: tool.schema.enum(["oneline", "stat", "full"]).optional().describe("Output format. Default: oneline."),
        },
        async execute(args, ctx) {
          const n = Math.min(args.count ?? 10, 50)
          const fmt = args.format ?? "oneline"
          try {
            let cmd: string
            if (args.file) {
              const safeFile = sanitizeShellArg(args.file)
              cmd = fmt === "stat"
                ? `git log --stat -${n} -- ${safeFile}`
                : fmt === "full"
                  ? `git log -${n} -- ${safeFile}`
                  : `git log --oneline -${n} -- ${safeFile}`
            } else {
              cmd = fmt === "stat"
                ? `git log --stat -${n}`
                : fmt === "full"
                  ? `git log -${n}`
                  : `git log --oneline -${n}`
            }
            const result = await runCommand(cmd, ctx.directory, 10_000)
            if (result.exitCode !== 0) return `Git log failed: ${result.stderr.trim()}`
            ctx.metadata({ title: `changelog: ${n} commits` })
            return truncateOutput(result.stdout, 4000)
          } catch (err) {
            return `Changelog failed: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-session": tool({
        description: "Show current Ralph Loop session state: profile, tier, edit count, tool call count, failure warnings, loop warnings, and elapsed time. Use when you suspect you're going in circles.",
        args: {},
        async execute(_args, ctx) {
          const lines: string[] = []
          const cfg = storedConfig
          const projCtx = storedProjectContext
          const elapsed = Math.round((Date.now() - sessionStartTime) / 1000)

          lines.push(`Session duration: ${elapsed}s`)
          lines.push(`Tool calls: ${totalToolCalls}`)
          lines.push(`Edits: ${totalEdits}`)
          if (cfg?.profile) lines.push(`Profile: ${cfg.profile}`)
          if (cfg?.tier) lines.push(`Tier: ${cfg.tier}`)
          if (projCtx?.hasTypeScript) lines.push("TypeScript: yes")
          if (projCtx?.packageManager) lines.push(`Package manager: ${projCtx.packageManager}`)
          if (projCtx?.verifyCommands.length) lines.push(`Verify commands: ${projCtx.verifyCommands.join(", ")}`)

          // Edit hotspots
          const hotspots = Array.from(editHotspots.entries())
            .filter(([, v]) => v.count >= 2)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5)
          if (hotspots.length > 0) {
            lines.push("Edit hotspots:")
            for (const [file, data] of hotspots) {
              lines.push(`  ${file}: ${data.count} edits`)
            }
          }

          // Failure warnings
          if (failureWarnings.length > 0) {
            lines.push("Failure warnings:")
            for (const w of failureWarnings) lines.push(`  ⚠️ ${w}`)
          }

          // Loop warnings
          if (loopWarnings.length > 0) {
            lines.push("Loop warnings:")
            for (const w of loopWarnings) lines.push(`  🔄 ${w}`)
          }

          ctx.metadata({ title: `session: ${totalEdits} edits, ${totalToolCalls} tools, ${elapsed}s` })
          return lines.join("\n")
        },
      }),

      "resolve-audit": tool({
        description: "Run a quick security audit: detect accidentally committed secrets, vulnerable dependency patterns, and common security issues in source files.",
        args: {
          paths: tool.schema.array(tool.schema.string()).optional().describe("Directories to scan. Default: ['src']."),
          check_deps: tool.schema.boolean().optional().describe("Also check npm audit. Default: false."),
        },
        async execute(args, ctx) {
          const dirs = args.paths ?? ["src"]
          const results: string[] = []
          const safeDirs = dirs.map(d => sanitizeShellArg(d)).join(" ")

          // 1. Secret detection
          const secretPatterns = [
            { name: "Private keys", regex: "-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----" },
            { name: "API keys (generic)", regex: "(api[_-]?key|apikey)\\s*[:=]\\s*['\"][a-zA-Z0-9]{20,}" },
            { name: "AWS keys", regex: "AKIA[0-9A-Z]{16}" },
            { name: "Generic secrets", regex: "(secret|password|token|credential)\\s*[:=]\\s*['\"][^'\"]{8,}" },
          ]
          for (const { name, regex } of secretPatterns) {
            try {
              const result = await runCommand(
                `rg -l '${regex}' ${safeDirs} 2>/dev/null`,
                ctx.directory, 5_000,
              )
              if (result.exitCode === 0 && result.stdout.trim()) {
                const files = result.stdout.trim().split("\n")
                results.push(`🔴 ${name}: found in ${files.length} file(s): ${files.slice(0, 5).join(", ")}`)
              }
            } catch { /* rg not found */ }
          }

          // 2. Vulnerable patterns
          const vulnPatterns = [
            { name: "eval() usage", regex: "\\beval\\s*\\(" },
            { name: "innerHTML usage", regex: "\\.innerHTML\\s*=" },
            { name: "exec() with string", regex: "\\bexec\\s*\\(.*\\$" },
            { name: "SQL string concat", regex: "(SELECT|INSERT|UPDATE|DELETE).*\\+" },
            { name: "HTTP (not HTTPS)", regex: "http://[^/]*[^s]\\b" },
          ]
          for (const { name, regex } of vulnPatterns) {
            try {
              const result = await runCommand(
                `rg -c '${regex}' ${safeDirs} 2>/dev/null`,
                ctx.directory, 5_000,
              )
              if (result.exitCode === 0 && result.stdout.trim()) {
                const count = result.stdout.trim().split("\n").length
                results.push(`🟡 ${name}: ${count} file(s)`)
              }
            } catch { /* skip */ }
          }

          // 3. npm audit
          if (args.check_deps) {
            try {
              const audit = await runCommand("npm audit --json 2>/dev/null", ctx.directory, 30_000)
              if (audit.exitCode !== 0 && audit.stdout.trim()) {
                const auditData = JSON.parse(audit.stdout)
                const vulns = auditData.metadata?.vulnerabilities
                if (vulns) {
                  results.push(`📦 npm audit: ${vulns.high ?? 0} high, ${vulns.critical ?? 0} critical, ${vulns.moderate ?? 0} moderate`)
                }
              } else {
                results.push("📦 npm audit: no vulnerabilities ✅")
              }
            } catch {
              results.push("📦 npm audit: not available")
            }
          }

          if (results.length === 0) {
            results.push("No security issues detected ✅")
          }

          ctx.metadata({ title: `audit: ${results.length} findings` })
          return results.join("\n")
        },
      }),

      "resolve-config-check": tool({
        description: "Validate the current opencode-resolve configuration. Checks resolve.json validity, missing agents, conflicting settings, and suggests fixes.",
        args: {},
        async execute(_args, ctx) {
          const results: string[] = []
          const cfg = storedConfig

          if (!cfg) {
            return "No resolve config loaded. Plugin may not be initialized."
          }

          // 1. Profile check
          if (cfg.profile) {
            if (VALID_PROFILES.has(cfg.profile)) {
              results.push(`✅ Profile: ${cfg.profile}`)
            } else {
              results.push(`🔴 Invalid profile: '${cfg.profile}'. Valid: ${[...VALID_PROFILES].join(", ")}`)
            }
          } else {
            results.push("ℹ️ No profile set (using defaults)")
          }

          // 2. Tier check
          if (cfg.tier) {
            if (VALID_TIERS.has(cfg.tier)) {
              results.push(`✅ Tier: ${cfg.tier}`)
            } else {
              results.push(`🔴 Invalid tier: '${cfg.tier}'. Valid: ${[...VALID_TIERS].join(", ")}`)
            }
          }

          // 3. Enabled agents check
          if (cfg.enabled) {
            for (const name of cfg.enabled) {
              if (VALID_AGENT_NAME_SET.has(name)) {
                results.push(`✅ Agent '${name}' enabled`)
              } else {
                results.push(`🔴 Unknown agent: '${name}'. Valid: ${VALID_AGENT_NAMES.join(", ")}`)
              }
            }
          }

          // 4. Model aliases check
          if (cfg.models) {
            for (const [key, value] of Object.entries(cfg.models)) {
              if (typeof value !== "string") {
                results.push(`🔴 Model alias '${key}' must be a string, got ${typeof value}`)
              } else {
                results.push(`✅ Model '${key}' → '${value}'`)
              }
            }
          }

          // 5. Agent overrides check
          if (cfg.agents) {
            for (const name of Object.keys(cfg.agents)) {
              if (!VALID_AGENT_NAME_SET.has(name)) {
                results.push(`🔴 Unknown agent override: '${name}'`)
              }
            }
          }

          // 6. Project context check
          const projCtx = storedProjectContext
          if (projCtx) {
            if (projCtx.verifyCommands.length === 0) {
              results.push("⚠️ No verify commands detected — add typecheck/lint/test scripts to package.json")
            } else {
              results.push(`✅ Verify commands: ${projCtx.verifyCommands.join(", ")}`)
            }
            if (!projCtx.hasTypeScript) {
              results.push("ℹ️ Not a TypeScript project")
            }
          }

          // 7. Resolve.json file check
          try {
            const { readFileSync: rf } = await import("node:fs")
            const paths = [
              join(ctx.directory, ".opencode", "resolve.json"),
              join(ctx.directory, "opencode-resolve.json"),
            ]
            let found = false
            for (const p of paths) {
              try {
                rf(p, "utf8")
                results.push(`✅ Config file: ${p}`)
                found = true
                break
              } catch { /* not found */ }
            }
            if (!found) results.push("ℹ️ No local resolve.json found (using defaults)")
          } catch { /* skip */ }

          ctx.metadata({ title: `config-check: ${results.length} items` })
          return results.join("\n")
        },
      }),

      "resolve-state": tool({
        description: "Read or write session state checkpoints to .opencode/resolve-state.json. Enables session resumption and cross-turn state persistence. Use 'save' to checkpoint current progress, 'load' to read last checkpoint.",
        args: {
          action: tool.schema.union([tool.schema.literal("save"), tool.schema.literal("load")]).describe("'save' to write current state, 'load' to read last checkpoint."),
          note: tool.schema.string().optional().describe("Optional note to attach to the checkpoint (e.g. 'finished auth module, starting API routes')."),
        },
        async execute(args, ctx) {
          const stateDir = join(ctx.directory, ".opencode")
          const statePath = join(stateDir, "resolve-state.json")

          if (args.action === "load") {
            try {
              const data = await readFile(statePath, "utf8")
              const state = JSON.parse(data)
              return { output: `📋 Last checkpoint loaded:\n${JSON.stringify(state, null, 2)}`, metadata: state }
            } catch {
              return "No previous checkpoint found. Use 'save' to create one."
            }
          }

          // save
          const state: Record<string, unknown> = {
            timestamp: new Date().toISOString(),
            sessionId: ctx.sessionID ?? "unknown",
            edits: totalEdits,
            toolCalls: totalToolCalls,
            failures: totalFailures,
            elapsedSeconds: Math.round((Date.now() - sessionStartTime) / 1000),
          }
          if (storedConfig?.profile) state.profile = storedConfig.profile
          if (storedConfig?.tier) state.tier = storedConfig.tier
          if (failureWarnings.length > 0) state.activeFailures = failureWarnings
          if (loopWarnings.length > 0) state.loopWarnings = loopWarnings
          if (args.note) state.note = args.note
          if (storedProjectContext) {
            state.knowledgeFiles = storedProjectContext.knowledgeFiles
            state.verifyCommands = storedProjectContext.verifyCommands
          }
          // Track hotspots
          const hotspots: string[] = []
          for (const [file, data] of editHotspots) {
            if (data.count >= 3) hotspots.push(`${file} (${data.count} edits)`)
          }
          if (hotspots.length > 0) state.hotspots = hotspots

          try {
            mkdirSync(stateDir, { recursive: true })
            writeFileSync(statePath, JSON.stringify(state, null, 2))
            ctx.metadata({ title: `state: checkpoint saved` })
            return `✅ Checkpoint saved to .opencode/resolve-state.json\n${JSON.stringify(state, null, 2)}`
          } catch (err) {
            return `⚠️ Failed to save checkpoint: ${err instanceof Error ? err.message : String(err)}`
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

/** Sanitize a string for safe use as a shell argument. Strips dangerous metacharacters. */
function sanitizeShellArg(input: string): string {
  return input
    .replace(/[;&|`$(){}[\]!#~<>\\]/g, "") // strip shell metacharacters
    .replace(/'/g, "'\\''")                  // escape single quotes for single-quoted context
    .slice(0, 500)                           // limit length
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
  /\bscreen\b/,                                 // screen multiplexer
  /\btmux\b(?!.*[|&;])/,                       // tmux without subcommand pipe
  /\bssh\b(?!\s.*-\w*[oN])/,                   // ssh without batch flags
  /\bsftp\b/,                                   // sftp interactive
  /\btelnet\b/,                                 // telnet interactive
  /\bnc\b(\s*$)/,                              // netcat interactive
  /\bsqlite3?\b(\s*$)/,                        // sqlite interactive
  /\bpsql\b(\s*$)/,                            // psql interactive
  /\bmysql\b(\s*$)/,                           // mysql interactive
  // Ralph Loop: dangerous patterns that waste tokens or cause damage
  /\bcurl\b.*\|\s*(ba)?sh\b/,                  // curl pipe to shell
  /\bwget\b.*\|\s*(ba)?sh\b/,                  // wget pipe to shell
  /\beval\s/,                                  // eval is dangerous
  /\bchmod\s+(-R\s+)?777\b/,                   // chmod 777
  /\bchown\s+-R\s+/,                           // recursive chown
  /\bsudo\s+(rm|chmod|chown|dd|mkfs)/,         // sudo + destructive
  /\bgit\s+push\s+--force/,                    // force push
  /\bgit\s+reset\s+--hard/,                    // hard reset
  /\brm\s+(-rf?|-fr?)\s+[^.]/,                // rm -rf (not dotfiles)
  /\bdd\s+if=/,                                 // dd can destroy disks
  /\b(mkfs|format)\b/,                          // filesystem format
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
