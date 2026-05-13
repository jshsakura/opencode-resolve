import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
const DEFAULT_MODELS = {};
const DEFAULT_ENABLED = ["coder", "reviewer", "resolver"];
const VALID_AGENT_NAMES = ["coder", "reviewer", "resolver", "architect", "gpt-coder", "debugger", "researcher"];
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
    "autoApprove",
    "maxParallelSubagents",
    "config",
]);
const DEFAULT_MAX_PARALLEL_SUBAGENTS = 2;
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
function buildResolverPrompt(maxParallelSubagents) {
    const limit = Math.max(1, Math.trunc(maxParallelSubagents));
    const parallelRule = limit === 1
        ? "CRITICAL: Dispatch at most ONE subagent of each role concurrently. Never run two coders in parallel, and never run two reviewers in parallel. A coder and a reviewer MAY run concurrently when they are doing genuinely independent work (e.g. coder is implementing the next change while reviewer audits the previous one). Wait for an in-flight subagent of a given role to finish before dispatching another of the same role."
        : `CRITICAL: Dispatch at most ${limit} subagents of the same role concurrently. Never exceed ${limit} coders in parallel, and never exceed ${limit} reviewers in parallel. Subagents of different roles may run concurrently when they are doing genuinely independent work. Wait for in-flight subagents of a given role to finish before dispatching more of that role.`;
    return [
        "You are Resolver, the primary orchestrator agent for OpenCode Resolve.",
        "Your job is to drive the user's task to a verified resolution end-to-end without unnecessary stops.",
        "Workflow:",
        "1. Understand the requirement. Inspect the relevant files briefly before planning.",
        "2. Plan the smallest correct change.",
        "3. Dispatch the coder subagent to implement the change. Pass a focused instruction with the exact files and behavior.",
        `4. ${parallelRule}`,
        "5. After implementation, verify when practical (run tests, type checks, or targeted checks).",
        "6. If issues remain, dispatch the coder again with a focused fix, or apply a small direct edit yourself when it is clearly trivial.",
        "7. Optionally consult the reviewer subagent for an independent read-only review on risky changes. The reviewer cannot modify anything; treat its output as advice and route any required fixes back through the coder. The same per-role parallel limit applies to the reviewer.",
        "8. Repeat until the task is resolved or clearly blocked.",
        "Return a concise summary of what changed, verification results, and any remaining blockers.",
        "Note: this parallel rule is enforced via prompt only — there is no runtime cap on subagent dispatches. Honor it strictly to avoid file conflicts and wasted work.",
    ].join("\n");
}
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
        description: "Read-only Oracle-style reviewer. Inspects code for requirements fit, correctness, security, tests, and maintainability risks. Never modifies anything.",
        prompt: [
            "You are Reviewer, a strictly read-only review subagent for OpenCode Resolve.",
            "You MUST NOT modify the project by any means: no file edits, no writes, no shell commands that change state, no git commits, no package installs.",
            "Use read-only tools (read, grep, glob, list, web fetch for documentation) to inspect the work against the user's requirements and the repository's existing patterns.",
            "Prioritize concrete bugs, behavioral regressions, security risks, missing tests, and maintainability issues.",
            "Return findings ordered by severity with file and line references when available. If there are no findings, say so and mention residual risks or verification gaps.",
            "If a fix is needed, describe it precisely and recommend dispatching the coder or resolver agent. Never apply fixes yourself.",
        ].join("\n"),
        permission: {
            edit: "deny",
            bash: "deny",
            webfetch: "ask",
        },
    },
    resolver: {
        mode: "all",
        color: "#FF7AC6",
        maxSteps: 30,
        description: "Primary orchestrator. Drives a task to completion by planning, dispatching subagents (one at a time by default), and verifying results. Iterates until the task is resolved or clearly blocked.",
        prompt: buildResolverPrompt(DEFAULT_MAX_PARALLEL_SUBAGENTS),
        permission: {
            edit: "ask",
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
    const autoApprove = resolveConfig.autoApprove !== false;
    const maxParallelSubagents = resolveConfig.maxParallelSubagents ?? DEFAULT_MAX_PARALLEL_SUBAGENTS;
    config.agent ??= {};
    for (const name of Object.keys(DEFAULT_AGENT_CONFIG)) {
        const override = resolveConfig.agents?.[name];
        const isEnabled = override?.enabled ?? enabled.has(name);
        if (!isEnabled)
            continue;
        const base = DEFAULT_AGENT_CONFIG[name];
        const { enabled: _enabled, model: requestedModel, permission: userPermission, ...agentOverride } = override ?? {};
        const model = resolveModel(requestedModel ?? models[name] ?? defaultModel, models);
        const permission = buildPermission(base.permission, userPermission, autoApprove);
        const agentConfig = {
            ...base,
            ...agentOverride,
        };
        if (name === "resolver" && agentOverride.prompt === undefined) {
            agentConfig.prompt = buildResolverPrompt(maxParallelSubagents);
        }
        if (permission)
            agentConfig.permission = permission;
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
        config.command["resolve"] ??= {
            template: "Drive this task to a verified resolution end-to-end. Plan, dispatch one coder at a time, verify, and iterate. $ARGUMENTS",
            description: "Run the OpenCode Resolve resolver agent end-to-end",
            agent: "resolver",
            subtask: true,
        };
        config.command["resolve-review"] ??= {
            template: "Review the current implementation against the user's requirements. Focus on correctness, tests, security, and maintainability. Do not modify anything.",
            description: "Run the OpenCode Resolve reviewer agent (read-only)",
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
        autoApprove: true,
        maxParallelSubagents: DEFAULT_MAX_PARALLEL_SUBAGENTS,
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
        result.autoApprove = config.autoApprove ?? result.autoApprove;
        result.maxParallelSubagents = config.maxParallelSubagents ?? result.maxParallelSubagents;
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
function buildPermission(basePermission, userPermission, autoApprove) {
    const merged = {
        ...(basePermission ?? {}),
        ...(userPermission ?? {}),
    };
    if (Object.keys(merged).length === 0)
        return undefined;
    if (!autoApprove)
        return merged;
    const userKeys = new Set(Object.keys(userPermission ?? {}));
    const result = { ...merged };
    for (const key of Object.keys(result)) {
        if (userKeys.has(key))
            continue;
        const value = result[key];
        if (value === "ask") {
            result[key] = "allow";
        }
    }
    return result;
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
    if (config.autoApprove !== undefined)
        result.autoApprove = expectBoolean(config.autoApprove, `${source}.autoApprove`);
    if (config.maxParallelSubagents !== undefined) {
        const limit = expectNumber(config.maxParallelSubagents, `${source}.maxParallelSubagents`);
        if (!Number.isInteger(limit) || limit < 1) {
            throw new Error(`${source}.maxParallelSubagents must be a positive integer`);
        }
        result.maxParallelSubagents = limit;
    }
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
