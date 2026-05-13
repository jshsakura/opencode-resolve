# opencode-resolve

[![npm version](https://img.shields.io/npm/v/opencode-resolve.svg)](https://www.npmjs.com/package/opencode-resolve)
[![CI](https://github.com/jshsakura/opencode-resolve/actions/workflows/publish.yml/badge.svg)](https://github.com/jshsakura/opencode-resolve/actions/workflows/publish.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Small OpenCode plugin that turns a single instruction into a finished, verified change.

`opencode-resolve` ships three roles by default — **resolver** (orchestrator), **coder** (implementer), and **reviewer** (read-only auditor) — and runs them with auto-approved permissions so a task drives to completion without prompting at every step. It defines roles, not model providers: agents inherit your OpenCode default model unless you pin them.

```
# Paste this into any AI coding assistant for fully guided setup
Install and configure opencode-resolve by following the instructions here:
https://github.com/jshsakura/opencode-resolve#drop-in-setup-give-to-an-llm
```

---

## Table of Contents

- [Features](#features)
- [AI-Powered Setup](#ai-powered-setup)
- [Prerequisites](#prerequisites)
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
- [Context7 Integration](#context7-integration)
- [Keeping Up to Date](#keeping-up-to-date)
- [Local Development](#local-development)
- [Verification](#verification)
- [Release](#release)
- [Design Rules](#design-rules)
- [License](#license)

---

## Features

- **3 default roles** — `resolver` (orchestrator), `coder` (implementer), `reviewer` (read-only auditor)
- **Auto-approved permissions** — coder and resolver work without per-action prompts; reviewer stays locked to deny
- **Context7 MCP** — auto-registers [Context7](https://context7.com) documentation lookup when `context7: true`
- **Model pinning** — pin different models per role (fast coding on one, deeper review on another)
- **Soft parallel cap** — `maxParallelSubagents` controls how many coders/reviewers the resolver fans out
- **Strict validation** — unknown keys, typos, invalid modes, and wrong types all fail fast at load time
- **Additive migration** — upgrades never overwrite your existing config
- **Zero dependencies beyond `@opencode-ai/plugin`** — nothing extra to install

---

## AI-Powered Setup

> **One line. Any AI coding assistant. Everything configured automatically.**

Paste this into Claude Code, Cursor, Codex, OpenCode, Windsurf, VS Code Copilot, or Gemini CLI:

```
Install and configure opencode-resolve by following the instructions here:
https://github.com/jshsakura/opencode-resolve#drop-in-setup-give-to-an-llm
```

Your AI will:

1. Install the plugin via `opencode plugin opencode-resolve --global --force`
2. Merge `opencode-resolve` into your `opencode.json` plugin array
3. Create `resolve.json` with a working configuration
4. Tell you to restart OpenCode

No manual config editing required. Works on macOS, Linux, and Windows.

> For manual setup, see [Prerequisites](#prerequisites) and [Quick Start](#quick-start) below.

---

## Prerequisites

### 1. OpenCode

opencode-resolve is an OpenCode plugin. You need [OpenCode](https://opencode.ai) installed and running.

Verify:

```sh
opencode --version
```

### 2. Node.js ≥ 20

The plugin and OpenCode itself require Node.js 20 or later.

Verify:

```sh
node --version   # should be v20.x or later
```

### 3. A configured model provider

OpenCode needs at least one model provider configured in `~/.config/opencode/opencode.json` with a valid API key. opencode-resolve agents inherit your default model unless you pin them.

Example minimal provider setup:

```json
{
  "model": "openai/gpt-4o",
  "provider": {
    "openai": {
      "name": "OpenAI"
    }
  }
}
```

> No additional API keys or MCP servers are required. Context7 is auto-registered by the plugin.

---

## Quick Start

### Install from npm

```sh
npm install -g opencode-resolve
```

The `postinstall` script automatically:

1. Adds `opencode-resolve` to `~/.config/opencode/opencode.json` `plugin` array (if not already present).
2. Creates `~/.config/opencode/resolve.json` from the shipped [`opencode-resolve.example.json`](./opencode-resolve.example.json) when the file does not exist.

To skip automatic registration:

```sh
OPENCODE_RESOLVE_SKIP_POSTINSTALL=1 npm install -g opencode-resolve
```

### Refresh the plugin cache

> **Important — OpenCode caches plugins itself.** OpenCode does NOT use globally-installed npm packages directly. It maintains its own cache at `~/.cache/opencode/packages/`. After the very first install (or any future upgrade), refresh the cache:

```sh
opencode plugin opencode-resolve --global --force
```

### Manual fallback

If `postinstall` didn't register the plugin, add it to `~/.config/opencode/opencode.json` yourself:

```json
{
  "plugin": ["opencode-resolve"]
}
```

### Restart OpenCode

```sh
opencode
```

You should now see `resolver`, `coder`, and `reviewer` agents available.

---

## Drop-in setup (give to an LLM)

Hand the block below to any reasonably capable LLM along with the instruction _"set up opencode-resolve on this machine"_ and it can finish the install end-to-end. Everything below is the entire required configuration — no other MCP servers, environment variables, or files are needed.

### Step 1 — Install and prime the cache

```sh
opencode plugin opencode-resolve --global --force
```

This downloads the plugin, installs it into OpenCode's package cache (`~/.cache/opencode/packages/`), and makes it available.

### Step 2 — Register the plugin in `~/.config/opencode/opencode.json`

Merge into the existing file; **do not replace it**:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "<your-default-model-id>",
  "plugin": ["opencode-resolve"]
}
```

> If you already have other plugins, add `"opencode-resolve"` to the existing `plugin` array.

### Step 3 — Create `~/.config/opencode/resolve.json`

This file is auto-created by `postinstall`. If it wasn't created, or you want the canonical recommended setup, copy the block below. Then swap the model IDs under `models` to match providers you actually have.

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

> **Don't have GLM or GPT-5.5?** Replace the model IDs with whatever your provider exposes. See [Model Setup](#model-setup) for details. The simplest config uses your OpenCode default model for all roles — just remove the `models` block entirely.

### Step 4 — Restart OpenCode

Close and reopen OpenCode. The three default agents (`resolver`, `coder`, `reviewer`) should now be available.

### Why this template

| Setting | Why |
|---|---|
| `enabled: ["coder", "reviewer", "resolver"]` | Activates the three default roles |
| `autoApprove: true` | Coder and resolver work without per-action prompts; reviewer stays locked |
| `maxParallelSubagents: 2` | Up to two coders and two reviewers may run concurrently per role |
| `agents.coder.mode = "all"` | Coder appears in the agent picker, not just as a subagent |
| `agents.reviewer.mode = "all"` | Reviewer appears in the agent picker too |
| `context7: true` | Plugin auto-registers Context7 MCP — no manual MCP config needed |
| `models` aliases | Fast/cheap model for coding (`glm`), stronger model for orchestration (`gpt`), cheapest for review (`gpt-4o-mini`) |
| Other agents disabled | `architect`, `gpt-coder`, `debugger`, `researcher` ship off. Flip `enabled: true` when needed |

### What happens when you call the resolver

1. **Understand** — Resolver reads the request and inspects relevant files.
2. **Plan** — Plans the smallest correct change.
3. **Implement** — Dispatches `coder` to implement within the configured per-role concurrency limit.
4. **Verify** — Runs tests, type checks, or targeted checks when practical.
5. **Fix** — If issues remain, dispatches `coder` again with a focused fix.
6. **Review** (optional) — For risky changes, consults `reviewer` for a read-only audit; routes fixes back through `coder`.
7. **Iterate** — Repeats until the task is resolved or clearly blocked.
8. **Report** — Returns a concise summary of changes, verification results, and remaining blockers.

---

## Default Behavior

| Item | Default |
|---|---|
| Enabled agents | `coder`, `reviewer`, `resolver` |
| Primary agent for new tasks | `resolver` (`mode: "all"`) |
| Agent model | Inherits top-level OpenCode `model` |
| Native `plan` / `build` | Preserved untouched |
| Context7 MCP preset | Added automatically when `context7: true` |
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
built-in defaults → first config file found → inline plugin options
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
| `maxParallelSubagents` | `positive integer` | `2` | Cap on simultaneous subagents the resolver dispatches per role. |
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

A fully-annotated reference config ships with the package as [`opencode-resolve.reference.jsonc`](./opencode-resolve.reference.jsonc) — copy the keys you need into your `resolve.json` (without the comments).

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

> **Trust note:** `autoApprove: true` assumes you trust the workspace and the model you have configured. Use a sandbox or VM for untrusted code, and keep `autoApprove: false` if you want to inspect every action.

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
{ "maxParallelSubagents": 1 }
{ "maxParallelSubagents": 2 }
{ "maxParallelSubagents": 4 }
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

### Use default model for everything

```json
{
  "enabled": ["coder", "reviewer", "resolver"],
  "models": {}
}
```

### Role-specific aliases

```json
{
  "enabled": ["coder", "reviewer", "resolver"],
  "models": {
    "glm": "zai-coding-plan/glm-5.1",
    "gpt": "openai/gpt-5.5",
    "coder": "glm",
    "resolver": "gpt",
    "reviewer": "openai/gpt-4o-mini"
  }
}
```

### Pin one role directly

```json
{
  "agents": {
    "reviewer": {
      "model": "openai/gpt-5.5"
    }
  }
}
```

### Mixed setup (OpenCode config + resolve models)

Native OpenCode agents such as `plan` and `build` are configured through the top-level OpenCode `agent`, not through `opencode-resolve`.

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
| `resolver` | Yes | `all` | ask → allow | ask → allow | ask → allow | Primary orchestrator. Plans, dispatches coders/reviewers within the configured per-role limit, verifies, iterates to completion. |
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
- Dispatch **only one `coder` subagent at a time** (when `maxParallelSubagents: 1`).
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

## Context7 Integration

When `context7: true` (the default), the plugin automatically registers the [Context7](https://context7.com) MCP server at startup:

```json
{
  "type": "remote",
  "url": "https://mcp.context7.com/mcp"
}
```

This gives all resolve agents access to up-to-date library and framework documentation through the `resolve-library-id` and `query-docs` tools — no manual MCP configuration needed.

To disable Context7 registration (e.g. you already have it configured, or you don't want it):

```json
{
  "context7": false
}
```

If `mcp.context7` is already present in your OpenCode config, the plugin does not overwrite it.

---

## Keeping Up to Date

> **OpenCode caches the last version it downloaded.** To get a new release you must explicitly refresh.

```sh
# Upgrade via npm
npm install -g opencode-resolve@latest

# Refresh the OpenCode cache
opencode plugin opencode-resolve --global --force

# Restart OpenCode
```

After upgrading, `postinstall` runs additive migration on your `resolve.json` — new keys are added, existing keys are never modified.

### Pinning a specific version

```sh
npm install -g opencode-resolve@0.1.3
opencode plugin opencode-resolve --global --force
```

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
- The resolver honors `maxParallelSubagents` as a per-role concurrency limit for coder/reviewer dispatch.
- Search and inspect before editing. Make the smallest correct change. Verify when practical.

---

## License

[MIT](./LICENSE)
