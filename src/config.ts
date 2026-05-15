import { join, basename, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { access, readFile } from "node:fs/promises";
import { Config } from "@opencode-ai/plugin";
import { ResolveConfig, ProjectContext, ResolveAgentName, ProfileName, TierName, AgentMode, UnknownRecord, ResolvePluginOptions, ResolveAgentConfig, ModelAlias, PermissionValue } from "./types.js";
import { DEFAULT_AGENT_CONFIG, buildGLMResolverPrompt, GLM_CODER_PROMPT, buildGPTResolverPrompt, GPT_CODER_PROMPT, buildResolverPrompt, VALID_AGENT_NAME_SET, DEFAULT_MODELS, DEFAULT_ENABLED, VALID_AGENT_NAMES, GLM_ENABLED, GPT_ENABLED, TIER_ENABLED, GLM_AGENT_OVERRIDES, GPT_AGENT_OVERRIDES, VALID_MODEL_ALIAS_SET, VALID_PROFILES, VALID_TIERS } from "./agents.js";
import { readFirstJson } from "./utils.js";

export function applyResolveConfig(config: Config, resolveConfig: ResolveConfig, projectContext: ProjectContext) {
    const profile = resolveConfig.profile;
    const isGLM = profile === "glm";
    const isGPT = profile === "gpt";
    const profileEnabled = isGLM ? GLM_ENABLED : isGPT ? GPT_ENABLED : undefined;
    const tierEnabled = resolveConfig.tier ? TIER_ENABLED[resolveConfig.tier] : undefined;
    const enabled = new Set(resolveConfig.enabled ?? tierEnabled ?? (profileEnabled ?? DEFAULT_ENABLED));
    const models = { ...DEFAULT_MODELS, ...resolveConfig.models };
    const defaultModel = typeof config.model === "string" ? config.model : undefined;
    const maxParallelSubagents = resolveConfig.maxParallelSubagents;
    const contextInjection = buildContextInjection(projectContext);
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
        if (name === "resolver") agentConfig.prompt = buildGLMResolverPrompt(maxParallelSubagents)
        else if (name === "coder") agentConfig.prompt = GLM_CODER_PROMPT
      } else if (isGPT) {
        if (name === "resolver") agentConfig.prompt = buildGPTResolverPrompt()
        else if (name === "coder") agentConfig.prompt = GPT_CODER_PROMPT
      } else {
        if (name === "resolver") agentConfig.prompt = buildResolverPrompt(maxParallelSubagents)
      }
      // Inject project context into all resolver-type agents
      if ((name === "resolver" || name === "codex" || name === "glm") && contextInjection) {
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
    profile: "mix",
    models: {},
    agents: {},
    preserveNative: true,
    context7: true,
    commands: false,
    autoApprove: true,
    autoUpdate: true,
    }
}

export function mergeResolveConfig(...configs: Array<ResolveConfig | undefined>): ResolveConfig {
    const result: ResolveConfig = {};
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
      throw new Error(`Unknown top-level key "${key}" in ${source}`)
    }
    }

    const result: ResolvePluginOptions = {};
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

export function normalizeAgentConfig(value: unknown, source: string): ResolveAgentConfig {
    const config = expectObject(value, source);
    for (const key of Object.keys(config)) {
    if (!VALID_AGENT_KEYS.has(key)) {
      throw new Error(`Unknown agent key "${key}" in ${source}`)
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
    throw new Error(`Unknown permission key "${key}" in ${source}`)
    }

    return result
}

export function expectAgentName(value: string, source: string): ResolveAgentName {
    if (!VALID_AGENT_NAME_SET.has(value)) {
    throw new Error(`Unknown agent "${value}" in ${source}. Valid agents: ${VALID_AGENT_NAMES.join(", ")}`)
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
    ]);
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
