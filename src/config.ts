import { join, basename, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { access, readFile } from "node:fs/promises";
import { Config } from "@opencode-ai/plugin";
import { ResolveConfig, ProjectContext, ResolveAgentName, TierName, AgentMode, UnknownRecord, ResolvePluginOptions, ResolveAgentConfig, ModelAlias, PermissionValue, LanguageSetting, ResolvePermissions } from "./types.js";
import { DEFAULT_AGENT_CONFIG, buildResolverPrompt, VALID_AGENT_NAME_SET, DEFAULT_MODELS, DEFAULT_ENABLED, VALID_AGENT_NAMES, TIER_ENABLED, VALID_MODEL_ALIAS_SET, VALID_TIERS } from "./agents.js";
import { readFirstJson } from "./utils.js";

/**
 * Emits a non-fatal config warning to stderr. Uses stderr (not stdout) because
 * stdout corrupts the opencode TUI. Suppressed when OPENCODE_RESOLVE_QUIET=1.
 */
function warnResolve(message: string): void {
    if (process.env.OPENCODE_RESOLVE_QUIET === "1") return
    process.stderr.write(`[opencode-resolve] config warning: ${message}\n`)
}

export function applyResolveConfig(config: Config, resolveConfig: ResolveConfig, projectContext: ProjectContext) {
    const tierEnabled = resolveConfig.tier ? TIER_ENABLED[resolveConfig.tier] : undefined;
    const enabled = new Set(resolveConfig.enabled ?? tierEnabled ?? DEFAULT_ENABLED);
    const models = { ...DEFAULT_MODELS, ...resolveConfig.models };
    const defaultModel = typeof config.model === "string" ? config.model : undefined;
    const maxParallelSubagents = resolveConfig.maxParallelSubagents;
    const singleAgentMode = resolveConfig.singleAgentMode === true;
    const contextInjection = buildContextInjection(projectContext);
    config.agent ??= {}

    for (const name of Object.keys(DEFAULT_AGENT_CONFIG) as ResolveAgentName[]) {
    const override = resolveConfig.agents?.[name]
    const isEnabled = override?.enabled ?? enabled.has(name)
    if (!isEnabled) continue

    const base = DEFAULT_AGENT_CONFIG[name]
    const { enabled: _enabled, model: requestedModel, permission: userPermission, ...agentOverride } = override ?? {}
    const model = resolveModel(requestedModel ?? models[name] ?? defaultModel, models)
    const permission = buildPermission(base.permission, userPermission)
    // singleAgentMode (direct mode): the resolver edits directly, so restore edit
    // access. In the default multi-agent mode the resolver's edit is DENIED (see
    // DEFAULT_AGENT_CONFIG in agents.ts) to physically force a coder dispatch —
    // a prompt-only request was too weak and the resolver kept editing itself.
    if (name === "resolver" && singleAgentMode && permission) {
      permission.edit = "allow"
    }
    const agentConfig: ResolveAgentConfig = {
      ...base,
      ...agentOverride,
    }
    if (agentOverride.prompt === undefined) {
      if (name === "resolver") {
        agentConfig.prompt = buildResolverPrompt(maxParallelSubagents, singleAgentMode)
      }
      if (name === "resolver" && contextInjection) {
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

export function buildContextInjection(ctx: ProjectContext): string {
    const lines: string[] = [];
    if (ctx.knowledgeFiles.length > 0) {
    lines.push(`Project knowledge sources detected: ${ctx.knowledgeFiles.join(", ")}.`)
    lines.push("Read these FIRST when relevant before inspecting code — they contain infra decisions, patterns, traps, and team context.")
    }
    if (ctx.contextFiles.length > 0) {
    lines.push(`Relevant context documents available: ${ctx.contextFiles.slice(0, 20).join(", ")}.`)
    lines.push("MVI rule: read only the context documents relevant to the current task, not the whole context tree.")
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

export function defaultResolveConfig(): ResolveConfig {
    return {
    models: {},
    agents: {},
    preserveNative: true,
    commands: false,
    autoApprove: true,
    autoUpdate: true,
    permissions: {},
    }
}

export function mergeResolveConfig(...configs: Array<ResolveConfig | undefined>): ResolveConfig {
    const result: ResolveConfig = {};
    for (const config of configs) {
    if (!config) continue
    result.tier = config.tier ?? result.tier
    result.enabled = config.enabled ?? result.enabled
    result.preserveNative = config.preserveNative ?? result.preserveNative
    result.commands = config.commands ?? result.commands
    result.autoApprove = config.autoApprove ?? result.autoApprove
    result.maxParallelSubagents = config.maxParallelSubagents ?? result.maxParallelSubagents
    result.autoUpdate = config.autoUpdate ?? result.autoUpdate
    result.language = config.language ?? result.language
    result.singleAgentMode = config.singleAgentMode ?? result.singleAgentMode
    result.permissions = { ...result.permissions, ...config.permissions }
    result.models = { ...result.models, ...config.models }
    result.agents = mergeAgents(result.agents, config.agents)
    }

    return result
}

export function mergeAgents(left: ResolveConfig["agents"], right: ResolveConfig["agents"]): ResolveConfig["agents"] {
    const result: ResolveConfig["agents"] = { ...left };
    for (const name of Object.keys(right ?? {}) as ResolveAgentName[]) {
    result[name] = { ...result[name], ...right?.[name] }
    }

    return result
}

export function resolveModel(model: string | undefined, models: Record<string, string | undefined>) {
    if (!model) return undefined
    let current = model
    const seen = new Set<string>()
    while (models[current] !== undefined && !seen.has(current)) {
      seen.add(current)
      current = models[current] ?? current
    }
    return current
}

export function buildPermission(basePermission: ResolveAgentConfig["permission"], userPermission: ResolveAgentConfig["permission"]): ResolveAgentConfig["permission"] {
    const merged: NonNullable<ResolveAgentConfig["permission"]> = {
            ...(basePermission ?? {}),
            ...(userPermission ?? {}),
          };
    if (Object.keys(merged).length === 0) return undefined
    return merged
}

export function getPluginOptions(config: Config): unknown {
    for (const entry of config.plugin ?? []) {
    if (Array.isArray(entry) && isResolvePluginEntry(entry[0])) {
      return entry[1] ?? {}
    }
    }

    return {}
}

export function isResolvePluginEntry(entry: string) {
    const name = basename(entry);
    return name === "opencode-resolve" || name.startsWith("opencode-resolve@")
}

export function resolvePath(path: string, directory: string) {
    if (path.startsWith("~/")) return join(homedir(), path.slice(2))
    if (isAbsolute(path)) return path
    return resolve(directory, path)
}

export function normalizeResolveConfig(value: unknown, source: string): ResolvePluginOptions {
    if (value === undefined) return {}

    const config = expectObject(value, source);
    for (const key of Object.keys(config)) {
    if (!VALID_TOP_LEVEL_KEYS.has(key)) {
      // Lenient: unknown top-level keys (e.g. "context7" from other tools,
      // or keys from a newer opencode-resolve version) are warned and skipped.
      // Throwing here would reject the ENTIRE config → no agents register →
      // the plugin appears dead. One stray key must not kill the plugin.
      warnResolve(`unknown top-level key "${key}" in ${source} — ignored.`)
    }
    }

    const result: ResolvePluginOptions = {};
    if (config.enabled !== undefined) {
    result.enabled = expectStringArray(config.enabled, `${source}.enabled`)
      .map((name) => acceptAgentName(name, `${source}.enabled`))
      .filter((name): name is ResolveAgentName => name !== undefined)
    }

    if (config.models !== undefined) {
    const models = expectObject(config.models, `${source}.models`)
    result.models = {}
    for (const [key, model] of Object.entries(models)) {
      if (!VALID_MODEL_ALIAS_SET.has(key)) {
        warnResolve(`unknown model alias "${key}" in ${source}.models — ignored.`)
        continue
      }
      result.models[key as ModelAlias] = expectString(model, `${source}.models.${key}`)
    }
    }

    if (config.agents !== undefined) {
    const agents = expectObject(config.agents, `${source}.agents`)
    result.agents = {}
    for (const [name, agentConfig] of Object.entries(agents)) {
      const agentName = acceptAgentName(name, `${source}.agents.${name}`)
      if (agentName === undefined) continue
      result.agents[agentName] = normalizeAgentConfig(agentConfig, `${source}.agents.${name}`)
    }
    }

    if (config.preserveNative !== undefined) result.preserveNative = expectBoolean(config.preserveNative, `${source}.preserveNative`)
    if (config.commands !== undefined) result.commands = expectBoolean(config.commands, `${source}.commands`)
    if (config.autoApprove !== undefined) result.autoApprove = expectBoolean(config.autoApprove, `${source}.autoApprove`)
    if (config.autoUpdate !== undefined) result.autoUpdate = expectBoolean(config.autoUpdate, `${source}.autoUpdate`)
    if (config.singleAgentMode !== undefined) result.singleAgentMode = expectBoolean(config.singleAgentMode, `${source}.singleAgentMode`)

    if (config.tier !== undefined) {
    const tier = expectString(config.tier, `${source}.tier`)
    if (!VALID_TIERS.has(tier)) {
      throw new Error(`Unknown tier "${tier}" in ${source}.tier. Valid tiers: ${[...VALID_TIERS].join(", ")}`)
    }
    result.tier = tier as TierName
    }

    if (config.language !== undefined) {
    const language = expectString(config.language, `${source}.language`)
    if (!VALID_LANGUAGES.has(language)) {
      throw new Error(`Unknown language "${language}" in ${source}.language. Valid: ${[...VALID_LANGUAGES].join(", ")}`)
    }
    result.language = language as LanguageSetting
    }

    if (config.maxParallelSubagents !== undefined) {
    const limit = expectNumber(config.maxParallelSubagents, `${source}.maxParallelSubagents`)
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`${source}.maxParallelSubagents must be a positive integer`)
    }
    result.maxParallelSubagents = limit
    }

    if (config.permissions !== undefined) result.permissions = normalizePermissions(config.permissions, `${source}.permissions`)

    if (config.config !== undefined) result.config = expectString(config.config, `${source}.config`)
    return result
}

export function normalizePermissions(value: unknown, source: string): ResolvePermissions {
    const permissions = expectObject(value, source);
    const result: ResolvePermissions = {};
    for (const key of Object.keys(permissions)) {
    if (!VALID_PERMISSIONS_KEYS.has(key)) {
      // Lenient: unknown permissions keys (e.g. from a newer plugin version
      // or another tool writing to resolve.json) are warned and skipped.
      warnResolve(`unknown permissions key "${key}" in ${source} — ignored.`)
    }
    }

    if (permissions.allowGitReset !== undefined) result.allowGitReset = expectBoolean(permissions.allowGitReset, `${source}.allowGitReset`)
    if (permissions.allowGitClean !== undefined) result.allowGitClean = expectBoolean(permissions.allowGitClean, `${source}.allowGitClean`)
    return result
}

export function normalizeAgentConfig(value: unknown, source: string): ResolveAgentConfig {
    const config = expectObject(value, source);
    for (const key of Object.keys(config)) {
    if (!VALID_AGENT_KEYS.has(key)) {
      // Lenient: unknown agent keys are warned and skipped.
      warnResolve(`unknown agent key "${key}" in ${source} — ignored.`)
    }
    }

    const result: ResolveAgentConfig = {};
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

export function normalizeTools(value: unknown, source: string): Record<string, boolean> {
    const tools = expectObject(value, source);
    const result: Record<string, boolean> = {};
    for (const [key, enabled] of Object.entries(tools)) {
    result[key] = expectBoolean(enabled, `${source}.${key}`)
    }

    return result
}

export function normalizePermission(value: unknown, source: string): ResolveAgentConfig["permission"] {
    const permission = expectObject(value, source);
    const result: NonNullable<ResolveAgentConfig["permission"]> = {};
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
    // Lenient: unknown permission keys are warned and skipped.
    warnResolve(`unknown permission key "${key}" in ${source} — ignored.`)
    }

    return result
}

export function expectAgentName(value: string, source: string): ResolveAgentName {
    if (!VALID_AGENT_NAME_SET.has(value)) {
    throw new Error(`Unknown agent "${value}" in ${source}. Valid agents: ${VALID_AGENT_NAMES.join(", ")}`)
    }

    return value as ResolveAgentName
}

/**
 * Lenient variant of expectAgentName: an unknown agent NAME is warned and
 * skipped (returns undefined) instead of throwing. This matches how every
 * other unknown key is handled (see normalizeResolveConfig) so a single stray
 * name — e.g. "gpt-coder" left over from a renamed/removed agent — cannot kill
 * the ENTIRE config load and disable every agent. The throw version lives on
 * for strict callers/tests; config normalization uses this lenient path.
 */
export function acceptAgentName(value: string, source: string): ResolveAgentName | undefined {
    if (!VALID_AGENT_NAME_SET.has(value)) {
    warnResolve(`unknown agent "${value}" in ${source} — ignored. Valid agents: ${VALID_AGENT_NAMES.join(", ")}`)
    return undefined
    }
    return value as ResolveAgentName
}

export function expectPermissionValue(value: unknown, source: string): PermissionValue {
    const permission = expectString(value, source);
    if (!VALID_PERMISSION_VALUES.has(permission)) {
    throw new Error(`${source} must be one of: ask, allow, deny`)
    }

    return permission as PermissionValue
}

export function expectStringArray(value: unknown, source: string): string[] {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${source} must be an array of strings`)
    }

    return value
}

export function expectObject(value: unknown, source: string): UnknownRecord {
    if (!isObject(value)) throw new Error(`${source} must be an object`)
    return value
}

export function expectString(value: unknown, source: string): string {
    if (typeof value !== "string" || value.length === 0) throw new Error(`${source} must be a non-empty string`)
    return value
}

export function expectBoolean(value: unknown, source: string): boolean {
    if (typeof value !== "boolean") throw new Error(`${source} must be a boolean`)
    return value
}

export function expectNumber(value: unknown, source: string): number {
    if (typeof value !== "number" || Number.isNaN(value)) throw new Error(`${source} must be a number`)
    return value
}

export function isObject(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function loadResolveConfig(directory: string, opencodeConfig: Config, options: unknown): Promise<ResolveConfig> {
    const pluginOptions = normalizeResolveConfig(options ?? getPluginOptions(opencodeConfig), "plugin options");
    const configuredPath = typeof pluginOptions.config === "string" ? pluginOptions.config : undefined;
    const configPaths = configuredPath
            ? [resolvePath(configuredPath, directory)]
            : [
                join(directory, ".opencode", "resolve.json"),
                join(directory, "opencode-resolve.json"),
                join(homedir(), ".config", "opencode", "resolve.json"),
                join(homedir(), ".config", "opencode", "opencode-resolve.json"),
              ];
    const fileConfig = await readFirstJson(configPaths);
    return mergeResolveConfig(defaultResolveConfig(), fileConfig, pluginOptions)
}

export const VALID_TOP_LEVEL_KEYS = new Set<string>([
      "tier",
      "enabled",
      "models",
      "agents",
      "preserveNative",
      "commands",
      "autoApprove",
      "maxParallelSubagents",
      "autoUpdate",
      "language",
      "singleAgentMode",
      "permissions",
      "config",
    ]);
export const VALID_PERMISSIONS_KEYS = new Set<string>(["allowGitReset", "allowGitClean"]);
export const VALID_AGENT_KEYS = new Set<string>([
      "enabled",
      "model",
      "mode",
      "description",
      "prompt",
      "color",
      "maxSteps",
      "tools",
      "permission",
    ]);
export const VALID_MODES = new Set<string>(["subagent", "primary", "all"]);
export const VALID_PERMISSION_VALUES = new Set<string>(["ask", "allow", "deny"]);
export const VALID_LANGUAGES = new Set<string>(["auto", "en", "ko"]);
