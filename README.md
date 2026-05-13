# opencode-resolve

[![npm version](https://img.shields.io/npm/v/opencode-resolve.svg)](https://www.npmjs.com/package/opencode-resolve)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Small OpenCode plugin that turns a single instruction into a finished, verified change.

`opencode-resolve` ships three roles by default — **resolver** (orchestrator), **coder** (implementer), and **reviewer** (read-only auditor) — and runs them with auto-approved permissions so a task drives to completion without prompting at every step. It defines roles, not model providers: agents inherit your OpenCode default model unless you pin them.

---

## Table of Contents

- [Roles at a glance](#roles-at-a-glance)
- [Quick Start](#quick-start)
- [Drop-in setup (give to an LLM)](#drop-in-setup-give-to-an-llm)
- [Default Behavior](#default-behavior)
- [Configuration](#configuration)
- [Configuration Reference](#configuration-reference)
- [Auto Approval](#auto-approval)
- [Parallel Subagent Limit](#parallel-subagent-limit)
- [Upgrade & Migration](#upgrade--migration)
- [Model Setup](#model-setup)
- [Agent Reference](#agent-reference)
- [Optional Commands](#optional-commands)
- [Local Development](#local-development)
- [Verification](#verification)
- [Release](#release)
- [Design Rules](#design-rules)

---

## Roles at a glance

| Role | Default | Can edit? | Can run shell? | Purpose |
|---|:---:|:---:|:---:|---|
| `resolver` | Yes | Yes (auto) | Yes (auto) | Primary orchestrator. Plans, dispatches `coder` (one at a time), verifies, iterates. |
| `coder` | Yes | Yes (auto) | Yes (auto) | Focused implementer. Makes the smallest correct change and verifies. |
| `reviewer` | Yes | **Never** | **Never** | Read-only auditor. Inspects only — recommends fixes for `coder` or `resolver` to apply. |

Hard rule: **the reviewer cannot modify the project by any means.** Both `edit` and `bash` are denied for the reviewer regardless of `autoApprove`. Any required fix is routed back through `coder` or `resolver`.

---

## Quick Start

Install from npm:

```sh
npm install -g opencode-resolve
```

The package `postinstall` step:

1. Adds `opencode-resolve` to `~/.config/opencode/opencode.json` `plugin` array.
2. Creates `~/.config/opencode/resolve.json` from [`opencode-resolve.example.json`](./opencode-resolve.example.json) when missing.

Restart OpenCode after installation.

To skip automatic registration:

```sh
OPENCODE_RESOLVE_SKIP_POSTINSTALL=1 npm install -g opencode-resolve
```

Manual fallback: add the plugin to `~/.config/opencode/opencode.json` yourself:

```json
{
  "plugin": ["opencode-resolve"]
}
```

---

## Drop-in setup (give to an LLM)

Hand the block below to any reasonably capable LLM along with the instruction _"set up opencode-resolve on this machine"_ and it can finish the install end-to-end. Everything below is the entire required configuration — no other MCP servers, environment variables, or files are needed.

> **Important — OpenCode caches plugins itself.** OpenCode does NOT use globally-installed npm packages. It maintains its own cache at `~/.cache/opencode/packages/`. After the very first install (or any future upgrade), refresh the cache with `opencode plugin opencode-resolve --global --force` and restart OpenCode. `npm install -g` alone is not enough.

**Step 1 — install via OpenCode (also primes the cache):**

```sh
opencode plugin opencode-resolve --global --force
```

**Step 2 — `~/.config/opencode/opencode.json`** (merge into the existing file; do not replace it):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "<your-default-model-id>",
  "plugin": ["opencode-resolve"]
}
```

**Step 3 — `~/.config/opencode/resolve.json`** (auto-created by `postinstall`; the block below is the recommended canonical setup — copy it verbatim then swap the model IDs under `models` to match models your provider actually exposes):

```json
{
  "enabled": ["coder", "reviewer", "resolver"],
  "models": {
    "glm": "zai-coding-plan/glm-5.1",
    "gpt": "openai/gpt-5.5",
    "coder": "glm",
    "reviewer": "openai/gpt-4o-mini",
    "resolver": "gpt",
    "architect": "gpt",
    "gpt-coder": "gpt",
    "debugger": "glm",
    "researcher": "glm"
  },
  "preserveNative": true,
  "context7": true,
  "commands": false,
  "agents": {
    "coder":    { "mode": "all" },
    "reviewer": { "mode": "all" },
    "architect":  { "enabled": false },
    "gpt-coder":  { "enabled": false },
    "debugger":   { "enabled": false },
    "researcher": { "enabled": false }
  },
  "autoApprove": true,
  "maxParallelSubagents": 2
}
```

**Step 4 — restart OpenCode.**

### Why this template

- **`enabled`** activates the three default roles: `coder` implements, `reviewer` audits read-only, `resolver` orchestrates.
- **`autoApprove: true`** lets `coder` and `resolver` work without per-action approval prompts. `reviewer` stays locked to deny — it cannot modify by any means.
- **`maxParallelSubagents: 2`** is a per-role cap: up to two coders and up to two reviewers may run concurrently when working on genuinely independent things. Drop to `1` for strict per-role serialization, raise above `2` for more aggressive fan-out.
- **`agents.coder.mode = "all"` and `agents.reviewer.mode = "all"`** make both visible in the primary agent picker, not just as subagents the resolver dispatches. You can still call them directly when you don't need orchestration.
- **`agents.resolver.enabled: true`** is explicit (default is also true); ships with `mode: "all"` so it appears as both a primary agent and a subagent.
- **`models`** uses two aliases (`glm` for fast/cheap implementation, `gpt` for stronger orchestration) and pins reviewer to `gpt-4o-mini` for cheap reads. Replace these with model IDs your provider actually exposes.
- **`context7`** is the only MCP this plugin auto-registers — no other MCP servers are required.
- All other resolve agents (`architect`, `gpt-coder`, `debugger`, `researcher`) ship disabled. Flip `enabled: true` only if you want to use them.

### Resolver workflow (what happens when you call it)

1. Resolver reads the request, inspects relevant files.
2. Plans the smallest correct change.
3. Dispatches `coder` to implement (one at a time).
4. Verifies (tests, type checks, targeted checks).
5. If issues remain, dispatches `coder` again with a focused fix.
6. For risky changes, optionally consults `reviewer` for a read-only audit; routes any required fixes back through `coder`.
7. Repeats until the task is resolved or clearly blocked, then returns a concise summary.

---

## Default Behavior

| Item | Default |
|---|---|
| Enabled agents | `coder`, `reviewer`, `resolver` |
| Primary agent for new tasks | `resolver` (`mode: "all"`) |
| Agent model | Inherits top-level OpenCode `model` |
| Native `plan` / `build` | Preserved untouched |
| Context7 MCP preset | Added if absent |
| Optional commands | Disabled |
| `autoApprove` | `true` (no per-action prompts on coder/resolver) |
| Reviewer modification | Denied (cannot be auto-approved) |

---

## Configuration

The plugin reads the first config file it finds:

| Priority | Path |
|---:|---|
| 1 | `.opencode/resolve.json` (project) |
| 2 | `opencode-resolve.json` (project) |
| 3 | `~/.config/opencode/resolve.json` |
| 4 | `~/.config/opencode/opencode-resolve.json` |

Inline plugin options in `opencode.json` override file config.

Config precedence:

```text
built-in defaults -> first config file found -> inline plugin options
```

Minimal config (matches defaults):

```json
{
  "enabled": ["coder", "reviewer", "resolver"],
  "autoApprove": true,
  "context7": true,
  "commands": false
}
```

Inline form inside `opencode.json`:

```json
{
  "plugin": [
    [
      "opencode-resolve",
      {
        "enabled": ["coder", "reviewer", "resolver"],
        "autoApprove": true,
        "context7": true,
        "commands": false
      }
    ]
  ]
}
```

Strict validation rejects unknown agent names, misspelled keys, invalid modes, invalid permission values, and wrong value types — typos fail fast.

---

## Configuration Reference

Every accepted top-level option:

| Key | Type | Default | Purpose |
|---|---|---|---|
| `enabled` | `string[]` | `["coder", "reviewer", "resolver"]` | Which resolve agents to inject. Per-agent `agents.<name>.enabled` overrides this. |
| `preserveNative` | `boolean` | `true` | Native `plan`/`build` are always preserved. Accepted for readability. |
| `context7` | `boolean` | `true` | When true, registers the Context7 MCP server unless already configured. |
| `commands` | `boolean` | `false` | When true, adds `resolve`, `resolve-code`, `resolve-review` commands. |
| `autoApprove` | `boolean` | `true` | Flips default `"ask"` permissions to `"allow"` on enabled agents. Never touches `"deny"` or user-set keys. |
| `maxParallelSubagents` | `positive integer` | `1` | Cap on simultaneous subagents the resolver dispatches across coder, reviewer, etc. |
| `models` | `object` | `{}` | Alias map. Keys are agent names or `glm`/`gpt`. Values are model ids or other aliases. |
| `agents` | `object` | `{}` | Per-agent overrides (see below). |
| `config` | `string` | _none_ | Custom path to a config file (relative to the project or absolute). |

Per-agent options inside `agents.<name>`:

| Key | Type | Notes |
|---|---|---|
| `enabled` | `boolean` | Force-enable or force-disable this agent regardless of top-level `enabled`. |
| `model` | `string` | Model id or alias. Resolved against the top-level `models` map. |
| `mode` | `"subagent" \| "primary" \| "all"` | OpenCode agent mode. |
| `description` | `string` | Override the default description shown to other agents. |
| `prompt` | `string` | Override the default system prompt. (For `resolver`, this also disables the templated parallel-rule prompt.) |
| `color` | `string` | UI color. |
| `maxSteps` | `positive integer` | Per-invocation step budget. |
| `tools` | `Record<string, boolean>` | Toggle individual OpenCode tools. |
| `permission` | `object` | Permission overrides — see below. |

Permission keys (each takes `"ask"`, `"allow"`, or `"deny"`):

`edit`, `bash`, `webfetch`, `doom_loop`, `external_directory`.

`permission.bash` may also be a per-command map:

```json
{
  "permission": {
    "bash": { "npm test": "allow", "rm -rf": "deny" }
  }
}
```

A fully-annotated reference config ships with the package as
[`opencode-resolve.reference.jsonc`](./opencode-resolve.reference.jsonc) — copy
the keys you need into your `resolve.json` (without the comments).

---

## Auto Approval

`autoApprove` (default `true`) flips every `"ask"` permission on the **enabled** agents to `"allow"`, so coder and resolver work continuously without per-action prompts. It never touches `"deny"` and never overrides a permission key the user explicitly set.

| Permission state | autoApprove: true | autoApprove: false |
|---|---|---|
| Default `"ask"` | becomes `"allow"` | stays `"ask"` |
| Default `"deny"` | stays `"deny"` | stays `"deny"` |
| User explicit `"ask"` | stays `"ask"` | stays `"ask"` |
| User explicit `"allow"` | stays `"allow"` | stays `"allow"` |
| User explicit `"deny"` | stays `"deny"` | stays `"deny"` |

Reviewer permissions for `edit` and `bash` are `"deny"` in the defaults, so `autoApprove` cannot grant the reviewer modification rights.

Turn it off when you want the conservative ask-every-time behavior:

```json
{
  "autoApprove": false
}
```

Trust note: `autoApprove: true` assumes you trust the workspace and the model you have configured. Use a sandbox or VM for untrusted code, and keep `autoApprove: false` if you want to inspect every action.

---

## Parallel Subagent Limit

`maxParallelSubagents` (default `2`) caps how many subagents the **resolver** may dispatch concurrently **per role**. The default of `2` lets up to two coders run in parallel AND up to two reviewers run in parallel — total up to four subagents in flight when both roles are active. Subagents of different roles may always run concurrently (e.g. coder implementing while reviewer audits the previous step).

| Value | Behavior |
|---|---|
| `1` | Strictly one of each role at a time. Coder may run while reviewer runs, but never two coders or two reviewers in parallel. |
| `2` (default) | Up to two of each role concurrently. Total in flight up to (per-role limit × number of active roles). |
| `N > 2` | Up to N of each role concurrently. Useful when fanning out genuinely independent work. |

Override per project or per user:

```json
{ "maxParallelSubagents": 1 }   // strictest
{ "maxParallelSubagents": 2 }   // default
{ "maxParallelSubagents": 4 }   // aggressive parallelism
```

> **Important — soft limit, not a hard cap.** The limit is woven into the resolver's system prompt only. There is no runtime interceptor that blocks excess dispatches. Modern models (GPT-5.x, GLM-5, Claude 4.x) generally respect the directive, but if a model misbehaves, dispatches above the limit will go through. Pair this with `maxSteps` to bound total iterations if you want a stricter ceiling.

The limit is templated into the prompt at config-load time, so restart OpenCode to pick up the new value. If you provide a custom `agents.resolver.prompt`, the templated rule is skipped and your prompt wins entirely.

---

## Upgrade & Migration

When you upgrade to a newer version of `opencode-resolve`, the `postinstall` script runs an **additive migration** on your existing `~/.config/opencode/resolve.json`:

- Adds new top-level keys (e.g. `autoApprove`, `maxParallelSubagents`) with their defaults if they are absent.
- **Never** modifies keys you have already set.
- **Never** rewrites your `enabled` list, `models` map, or `agents` overrides.
- If `enabled` is set and does not include `"resolver"`, prints a one-line tip suggesting you add it. Your file is left untouched.

Skip the migration entirely with:

```sh
OPENCODE_RESOLVE_SKIP_POSTINSTALL=1 npm install -g opencode-resolve
```

---

## Model Setup

`opencode-resolve` does not ship a provider-specific role default.

Model resolution order for each resolve agent:

1. `agents.<name>.model`
2. `models.<name>` alias mapping
3. top-level OpenCode `model`
4. OpenCode's own fallback when no model is configured

Use the default config when all resolve roles should follow your current OpenCode model.

Pin models only when you intentionally want fixed role behavior, such as fast coding on one model and deeper review on another.

Role-specific aliases:

```json
{
  "enabled": ["coder", "reviewer", "resolver"],
  "models": {
    "glm": "zai-coding-plan/glm-5.1",
    "gpt": "openai/gpt-5.5",
    "coder": "glm",
    "resolver": "gpt",
    "reviewer": "gpt"
  }
}
```

Pin one role directly:

```json
{
  "agents": {
    "reviewer": {
      "model": "openai/gpt-5.5"
    }
  }
}
```

Native OpenCode agents such as `plan` and `build` are configured through the top-level OpenCode `agent`, not through `opencode-resolve`.

Mixed setup example:

```json
{
  "model": "zai-coding-plan/glm-5.1",
  "agent": {
    "plan": {
      "model": "openai/gpt-5.5"
    }
  },
  "plugin": [
    [
      "opencode-resolve",
      {
        "enabled": ["coder", "reviewer", "resolver"],
        "models": {
          "glm": "zai-coding-plan/glm-5.1",
          "gpt": "openai/gpt-5.5",
          "coder": "glm",
          "resolver": "gpt",
          "reviewer": "gpt"
        }
      }
    ]
  ]
}
```

In this setup, `plan`, `resolver`, and `reviewer` use `openai/gpt-5.5`; native `build` and resolve `coder` use `zai-coding-plan/glm-5.1`.

---

## Agent Reference

| Agent | Default | Mode | Edit | Bash | WebFetch | Purpose |
|---|:---:|---|---|---|---|---|
| `resolver` | Yes | `all` | ask → allow | ask → allow | ask → allow | Primary orchestrator. Plans, dispatches `coder` (one at a time), verifies, iterates to completion. |
| `coder` | Yes | `subagent` | ask → allow | ask → allow | ask → allow | Focused implementer. Smallest correct change. |
| `reviewer` | Yes | `subagent` | **deny** | **deny** | ask → allow | Read-only auditor. Cannot modify by any means. |
| `architect` | No | `subagent` | deny | ask → allow | ask → allow | Design and task decomposition. |
| `gpt-coder` | No | `subagent` | ask → allow | ask → allow | ask → allow | Stronger-reasoning implementation fallback. |
| `debugger` | No | `subagent` | ask → allow | ask → allow | ask → allow | Reproduction and root-cause analysis. |
| `researcher` | No | `subagent` | deny | ask → allow | ask → allow | Codebase and documentation research. |

`ask → allow` means the default is `"ask"` and `autoApprove` (default on) flips it to `"allow"`. Set `autoApprove: false` to keep them as `"ask"`.

Supported modes:

| Mode | Meaning |
|---|---|
| `subagent` | Available only as a subagent |
| `primary` | Available as a primary agent |
| `all` | Available as both primary and subagent |

Supported permission values: `ask`, `allow`, `deny`.

Supported model alias keys: `glm`, `gpt`, and every supported agent name. Aliases only resolve when defined in `models`.

`preserveNative` is accepted for readability, but native `plan` and `build` are always preserved. The plugin never rewrites built-in OpenCode agents.

### Resolver orchestration rules

The resolver's prompt enforces the following behavior:

- Plan the smallest correct change before dispatching.
- Dispatch **only one `coder` subagent at a time**. Never call coders in parallel.
- After each coder run, verify (tests, type checks, targeted checks) when practical.
- Optionally consult `reviewer` for an independent read-only audit on risky changes; route any required fixes back through `coder`.
- Iterate until the task is resolved or clearly blocked, then return a concise summary.

---

## Optional Commands

Set `commands: true` to add helper subtask commands:

| Command | Description |
|---|---|
| `resolve` | Run the `resolver` agent end-to-end on the current task |
| `resolve-code` | Run the `coder` agent for focused implementation |
| `resolve-review` | Run the `reviewer` agent for a read-only audit |

---

## Local Development

From this repository:

```sh
npm install
npm test
npm run install:local
```

`install:local` builds the plugin, links it into the OpenCode global plugin directory, and creates `~/.config/opencode/resolve.json` if it does not exist.

Manual local install:

```sh
npm run build
mkdir -p ~/.config/opencode/plugins
ln -sf "$PWD/dist/index.js" ~/.config/opencode/plugins/opencode-resolve.js
```

Local plugin files are loaded automatically by OpenCode.

---

## Verification

Run the normal checks:

```sh
npm run typecheck
npm test
npm run build
```

The test suite executes the built plugin and verifies default agent injection, `autoApprove` behavior, model aliases, file config, plugin option overrides, optional commands, Context7 preservation, and native `plan`/`build` preservation.

Before publishing:

```sh
npm run typecheck
npm test
npm audit --audit-level=moderate
npm publish --dry-run
```

`npm pack` and `npm publish` run `npm test` first through the `prepack` script.

---

## Release

Releases are published by GitHub Actions when a version tag is pushed.

Required repository secret:

| Secret | Description |
|---|---|
| `NPM_TOKEN` | npm automation token with publish access |

Tag release flow:

```sh
npm version patch
git push origin main --follow-tags
```

You can also run the `Publish to npm` workflow manually from GitHub Actions and choose `patch`, `minor`, `major`, or a specific version.

The release workflow runs `npm ci`, `npm run typecheck`, `npm test`, and `npm publish --access public --provenance`.

---

## Design Rules

- Do not overwrite native `plan` or `build` agents.
- Keep the default agent set small and role-clear: `resolver` orchestrates, `coder` modifies, `reviewer` only reads.
- The reviewer never modifies anything — fixes always go through `coder` or `resolver`.
- The resolver dispatches at most one coder at a time.
- Search and inspect before editing. Make the smallest correct change. Verify when practical.
