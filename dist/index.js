import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
const DEFAULT_MODELS = {};
const DEFAULT_ENABLED = ["coder", "reviewer"];
const VALID_AGENT_NAMES = ["coder", "reviewer", "architect", "gpt-coder", "debugger", "researcher"];
const VALID_AGENT_NAME_SET = new Set(VALID_AGENT_NAMES);
const VALID_MODEL_ALIASES = [...VALID_AGENT_NAMES, "glm", "gpt"];
const VALID_MODEL_ALIAS_SET = new Set(VALID_MODEL_ALIASES);
const VALID_MODES = new Set(["subagent", "primary", "all"]);
const VALID_PERMISSION_VALUES = new Set(["ask", "allow", "deny"]);
const VALID_TOP_LEVEL_KEYS = new Set([
    "enabled",
    "models",
    "agents",
    "preserveNative",
    "context7",
    "commands",
    "config",
]);
const VALID_AGENT_KEYS = new Set([
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
const DEFAULT_AGENT_CONFIG = {
    coder: {
        mode: "subagent",
        color: "#7CFC00",
        maxSteps: 20,
        description: "Use for focused implementation, file edits, test runs, and fixing issues until the task is resolved.",
        prompt: [
            "You are Coder, a focused implementation subagent for OpenCode Resolve.",
            "Preserve native OpenCode behavior and make the smallest correct change.",
            "Before editing, inspect the relevant files and existing patterns.",
            "Implement, run targeted verification when practical, and keep iterating on failures until the task is resolved or clearly blocked.",
            "Return a concise summary of changed files, verification results, and any remaining blockers.",
        ].join("\n"),
        permission: {
            edit: "ask",
            bash: "ask",
            webfetch: "ask",
        },
    },
    reviewer: {
        mode: "subagent",
        color: "#8A7CFF",
        maxSteps: 8,
        description: "Use for Oracle-style review of requirements fit, correctness, security, tests, and maintainability risks.",
        prompt: [
            "You are Reviewer, an Oracle-style review subagent for OpenCode Resolve.",
            "Review the work against the user's actual requirements and the repository's existing patterns.",
            "Prioritize concrete bugs, behavioral regressions, security risks, missing tests, and maintainability issues.",
            "Do not rewrite code unless explicitly asked; return findings ordered by severity with file and line references when available.",
            "If there are no findings, say so and mention residual risks or verification gaps.",
        ].join("\n"),
        permission: {
            edit: "deny",
            bash: "ask",
            webfetch: "ask",
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
            bash: "ask",
            webfetch: "ask",
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
            edit: "ask",
            bash: "ask",
            webfetch: "ask",
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
            edit: "ask",
            bash: "ask",
            webfetch: "ask",
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
            bash: "ask",
            webfetch: "ask",
        },
    },
};
export const OpencodeResolve = async ({ directory }, options) => {
    return {
        config: async (config) => {
            const resolveConfig = await loadResolveConfig(directory, config, options);
            applyResolveConfig(config, resolveConfig);
        },
    };
};
export default OpencodeResolve;
async function loadResolveConfig(directory, opencodeConfig, options) {
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
    return mergeResolveConfig(defaultResolveConfig(), fileConfig, pluginOptions);
}
function applyResolveConfig(config, resolveConfig) {
    const enabled = new Set(resolveConfig.enabled ?? DEFAULT_ENABLED);
    const models = { ...DEFAULT_MODELS, ...resolveConfig.models };
    const defaultModel = typeof config.model === "string" ? config.model : undefined;
    config.agent ??= {};
    for (const name of Object.keys(DEFAULT_AGENT_CONFIG)) {
        const override = resolveConfig.agents?.[name];
        const isEnabled = override?.enabled ?? enabled.has(name);
        if (!isEnabled)
            continue;
        const base = DEFAULT_AGENT_CONFIG[name];
        const { enabled: _enabled, model: requestedModel, ...agentOverride } = override ?? {};
        const model = resolveModel(requestedModel ?? models[name] ?? defaultModel, models);
        const agentConfig = {
            ...base,
            ...agentOverride,
        };
        if (model)
            agentConfig.model = model;
        config.agent[name] = agentConfig;
    }
    if (resolveConfig.context7 !== false) {
        config.mcp ??= {};
        config.mcp.context7 ??= {
            type: "remote",
            url: "https://mcp.context7.com/mcp",
        };
    }
    if (resolveConfig.commands) {
        config.command ??= {};
        config.command["resolve-review"] ??= {
            template: "Review the current implementation against the user's requirements. Focus on correctness, tests, security, and maintainability.",
            description: "Run the OpenCode Resolve reviewer agent",
            agent: "reviewer",
            subtask: true,
        };
        config.command["resolve-code"] ??= {
            template: "Implement the requested change with the smallest correct patch, then verify it when practical. $ARGUMENTS",
            description: "Run the OpenCode Resolve coder agent",
            agent: "coder",
            subtask: true,
        };
    }
}
function defaultResolveConfig() {
    return {
        enabled: DEFAULT_ENABLED,
        models: {},
        agents: {},
        preserveNative: true,
        context7: true,
        commands: false,
    };
}
function mergeResolveConfig(...configs) {
    const result = {};
    for (const config of configs) {
        if (!config)
            continue;
        result.enabled = config.enabled ?? result.enabled;
        result.preserveNative = config.preserveNative ?? result.preserveNative;
        result.context7 = config.context7 ?? result.context7;
        result.commands = config.commands ?? result.commands;
        result.models = { ...result.models, ...config.models };
        result.agents = mergeAgents(result.agents, config.agents);
    }
    return result;
}
function mergeAgents(left, right) {
    const result = { ...left };
    for (const name of Object.keys(right ?? {})) {
        result[name] = { ...result[name], ...right?.[name] };
    }
    return result;
}
function resolveModel(model, models) {
    if (!model)
        return undefined;
    return models[model] ?? model;
}
function getPluginOptions(config) {
    for (const entry of config.plugin ?? []) {
        if (Array.isArray(entry) && isResolvePluginEntry(entry[0])) {
            return entry[1] ?? {};
        }
    }
    return {};
}
function isResolvePluginEntry(entry) {
    const name = basename(entry);
    return name === "opencode-resolve" || name.startsWith("opencode-resolve@");
}
async function readFirstJson(paths) {
    for (const path of paths) {
        try {
            await access(path);
            return normalizeResolveConfig(JSON.parse(await readFile(path, "utf8")), path);
        }
        catch (error) {
            if (isMissingFileError(error))
                continue;
            throw new Error(`Failed to read OpenCode Resolve config at ${path}: ${formatError(error)}`);
        }
    }
    return undefined;
}
function resolvePath(path, directory) {
    if (path.startsWith("~/"))
        return join(homedir(), path.slice(2));
    if (isAbsolute(path))
        return path;
    return resolve(directory, path);
}
function normalizeResolveConfig(value, source) {
    if (value === undefined)
        return {};
    const config = expectObject(value, source);
    for (const key of Object.keys(config)) {
        if (!VALID_TOP_LEVEL_KEYS.has(key)) {
            throw new Error(`Unknown top-level key "${key}" in ${source}`);
        }
    }
    const result = {};
    if (config.enabled !== undefined) {
        result.enabled = expectStringArray(config.enabled, `${source}.enabled`).map((name) => expectAgentName(name, `${source}.enabled`));
    }
    if (config.models !== undefined) {
        const models = expectObject(config.models, `${source}.models`);
        result.models = {};
        for (const [key, model] of Object.entries(models)) {
            if (!VALID_MODEL_ALIAS_SET.has(key)) {
                throw new Error(`Unknown model alias "${key}" in ${source}.models`);
            }
            result.models[key] = expectString(model, `${source}.models.${key}`);
        }
    }
    if (config.agents !== undefined) {
        const agents = expectObject(config.agents, `${source}.agents`);
        result.agents = {};
        for (const [name, agentConfig] of Object.entries(agents)) {
            const agentName = expectAgentName(name, `${source}.agents`);
            result.agents[agentName] = normalizeAgentConfig(agentConfig, `${source}.agents.${name}`);
        }
    }
    if (config.preserveNative !== undefined)
        result.preserveNative = expectBoolean(config.preserveNative, `${source}.preserveNative`);
    if (config.context7 !== undefined)
        result.context7 = expectBoolean(config.context7, `${source}.context7`);
    if (config.commands !== undefined)
        result.commands = expectBoolean(config.commands, `${source}.commands`);
    if (config.config !== undefined)
        result.config = expectString(config.config, `${source}.config`);
    return result;
}
function normalizeAgentConfig(value, source) {
    const config = expectObject(value, source);
    for (const key of Object.keys(config)) {
        if (!VALID_AGENT_KEYS.has(key)) {
            throw new Error(`Unknown agent key "${key}" in ${source}`);
        }
    }
    const result = {};
    if (config.enabled !== undefined)
        result.enabled = expectBoolean(config.enabled, `${source}.enabled`);
    if (config.model !== undefined)
        result.model = expectString(config.model, `${source}.model`);
    if (config.mode !== undefined) {
        const mode = expectString(config.mode, `${source}.mode`);
        if (!VALID_MODES.has(mode))
            throw new Error(`Invalid mode "${mode}" in ${source}.mode`);
        result.mode = mode;
    }
    if (config.description !== undefined)
        result.description = expectString(config.description, `${source}.description`);
    if (config.prompt !== undefined)
        result.prompt = expectString(config.prompt, `${source}.prompt`);
    if (config.color !== undefined)
        result.color = expectString(config.color, `${source}.color`);
    if (config.maxSteps !== undefined) {
        const maxSteps = expectNumber(config.maxSteps, `${source}.maxSteps`);
        if (!Number.isInteger(maxSteps) || maxSteps < 1)
            throw new Error(`${source}.maxSteps must be a positive integer`);
        result.maxSteps = maxSteps;
    }
    if (config.tools !== undefined)
        result.tools = normalizeTools(config.tools, `${source}.tools`);
    if (config.permission !== undefined)
        result.permission = normalizePermission(config.permission, `${source}.permission`);
    return result;
}
function normalizeTools(value, source) {
    const tools = expectObject(value, source);
    const result = {};
    for (const [key, enabled] of Object.entries(tools)) {
        result[key] = expectBoolean(enabled, `${source}.${key}`);
    }
    return result;
}
function normalizePermission(value, source) {
    const permission = expectObject(value, source);
    const result = {};
    for (const [key, entry] of Object.entries(permission)) {
        if (key === "bash" && isObject(entry)) {
            result.bash = {};
            for (const [command, commandPermission] of Object.entries(entry)) {
                result.bash[command] = expectPermissionValue(commandPermission, `${source}.bash.${command}`);
            }
            continue;
        }
        const permissionValue = expectPermissionValue(entry, `${source}.${key}`);
        if (key === "edit" || key === "bash" || key === "webfetch" || key === "doom_loop" || key === "external_directory") {
            result[key] = permissionValue;
            continue;
        }
        throw new Error(`Unknown permission key "${key}" in ${source}`);
    }
    return result;
}
function expectAgentName(value, source) {
    if (!VALID_AGENT_NAME_SET.has(value)) {
        throw new Error(`Unknown agent "${value}" in ${source}. Valid agents: ${VALID_AGENT_NAMES.join(", ")}`);
    }
    return value;
}
function expectPermissionValue(value, source) {
    const permission = expectString(value, source);
    if (!VALID_PERMISSION_VALUES.has(permission)) {
        throw new Error(`${source} must be one of: ask, allow, deny`);
    }
    return permission;
}
function expectStringArray(value, source) {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        throw new Error(`${source} must be an array of strings`);
    }
    return value;
}
function expectObject(value, source) {
    if (!isObject(value))
        throw new Error(`${source} must be an object`);
    return value;
}
function expectString(value, source) {
    if (typeof value !== "string" || value.length === 0)
        throw new Error(`${source} must be a non-empty string`);
    return value;
}
function expectBoolean(value, source) {
    if (typeof value !== "boolean")
        throw new Error(`${source} must be a boolean`);
    return value;
}
function expectNumber(value, source) {
    if (typeof value !== "number" || Number.isNaN(value))
        throw new Error(`${source} must be a number`);
    return value;
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isMissingFileError(error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}
