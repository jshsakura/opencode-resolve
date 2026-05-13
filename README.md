# opencode-resolve — Lightweight Resolver Plugin for OpenCode

**[English](./README.md) | [한국어](./README.ko.md)**

[![npm version](https://img.shields.io/npm/v/opencode-resolve.svg)](https://www.npmjs.com/package/opencode-resolve)
[![CI](https://github.com/jshsakura/opencode-resolve/actions/workflows/publish.yml/badge.svg)](https://github.com/jshsakura/opencode-resolve/actions/workflows/publish.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> **opencode-resolve** is a **lightweight resolver plugin for [OpenCode](https://opencode.ai)**. It lives _inside_ your OpenCode session and turns a single instruction into a finished, verified change — that is what _resolving_ means here.
>
> It is **not** a standalone application, not a model provider, not a separate CLI you run daily, and not a replacement for your `opencode.json` configuration. It is an OpenCode plugin and nothing more.

It exposes a **fixed-role verified resolve loop** — **resolver** (context-efficient planner/judge) and **coder** (focused implementer) — running with auto-approved permissions so a task drives to completion without prompting at every step. The resolver inspects only relevant files, plans the smallest patch, dispatches coder with exact instructions, verifies, and iterates through verified checkpoints. Each checkpoint is retried up to 3 times on failure, then the resolver moves forward. Internal specialist subagents (**explorer**, **reviewer**, **deep-reviewer**) are injected by default as OpenCode-native subagents — available when the resolver judges them justified — but they are not part of the core path and are never user-facing primary roles. It defines roles, not model providers: agents inherit your OpenCode default model unless you pin them.

```
# Paste this into any AI coding assistant for fully guided setup
Install and configure opencode-resolve by following the instructions here:
https://github.com/jshsakura/opencode-resolve#drop-in-setup-give-to-an-llm
```

---

## What this is — and isn't

| ✅ What it is | ❌ What it isn't |
|---|---|
| A **lightweight resolver plugin for OpenCode** installed via `opencode plugin opencode-resolve` | A standalone app or separate CLI |
| A fixed-role verified loop (resolver + coder) injected into OpenCode | A model provider or API key manager |
| A Context7 MCP auto-registration hook | A replacement for your `opencode.json` config |
| A config file (`resolve.json`) that lives alongside OpenCode config | Something you invoke manually every time you code |
| Installed once, then runs automatically inside OpenCode | An alternative to OpenCode itself |

If OpenCode is not installed or not running, opencode-resolve does nothing.

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

- **Fixed-role verified resolve loop** — `resolver` (context-efficient planner/judge) + `coder` (focused implementer)
- **Context-efficient by default** — minimal file reads, smallest patch, targeted verification, checkpointed execution with max 3 retries per failing checkpoint
- **OpenCode-native internal specialist subagents** — `reviewer` (verification-gap audit), `explorer` (codebase scout), `deep-reviewer` (risky/security review) — injected as subagents by default but not part of the core path; resolver dispatches them only when justified
- **Auto-approved permissions** — coder and resolver work without per-action prompts
- **Context7 MCP** — auto-registers [Context7](https://context7.com) documentation lookup when `context7: true`
- **Model pinning** — pin different models per role when you have measured a benefit; by default all roles inherit your OpenCode default model
- **Soft parallel cap** — `maxParallelSubagents` controls how many coders the resolver fans out
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

You should now see `resolver` and `coder` agents available.

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

This file is auto-created by `postinstall`. If it wasn't created, or you want the canonical recommended setup, copy the block below. By default all roles inherit your OpenCode default model — no `models` block is needed.

```json
{
  "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"],
  "preserveNative": true,
  "context7": true,
  "commands": false,
  "models": {},
  "agents": {
    "coder":    { "mode": "all" },
    "resolver": { "enabled": true },
    "explorer":      { "mode": "subagent" },
    "reviewer":      { "mode": "subagent" },
    "deep-reviewer": { "mode": "subagent" },
    "architect":  { "enabled": false },
    "gpt-coder":  { "enabled": false },
    "debugger":   { "enabled": false },
    "researcher": { "enabled": false }
  },
  "autoApprove": true,
  "maxParallelSubagents": 2
}
```

> **Want role-specific models?** Add a `models` block pinning roles to your preferred model IDs. See [Model Setup](#model-setup) for details. The recommended default uses a single efficient model for all roles — just keep `models` empty.

### Step 4 — Restart OpenCode

Close and reopen OpenCode. The core agents are `resolver` and `coder`. Internal specialist subagents (`explorer`, `reviewer`, `deep-reviewer`) are available by default as subagents for the resolver to dispatch when justified — they are not user-facing primary roles.

### Why this template

| Setting | Why |
|---|---|
| `enabled: ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"]` | Fixed core path (resolver→coder) plus OpenCode-native internal specialist subagents injected by default |
| `autoApprove: true` | Coder and resolver work without per-action prompts |
| `maxParallelSubagents: 2` | Up to two coders may run in parallel for independent work |
| `agents.coder.mode = "all"` | Coder appears in the agent picker, not just as a subagent |
| `agents.{explorer,reviewer,deep-reviewer}.mode = "subagent"` | Internal specialists are subagent-only — never user-facing primary roles |
| `context7: true` | Plugin auto-registers Context7 MCP — no manual MCP config needed |
| `models` aliases | Empty by default — all roles inherit the OpenCode default model. Pin role-specific models only when you have measured a benefit |
| Other agents disabled | `architect`, `gpt-coder`, `debugger`, `researcher` off by default. Enable when needed |

### What happens when you call the resolver

1. **Classify** — Resolver classifies the work as quick, normal, deep, or risky.
2. **Inspect** — Reads only relevant files using local tools. No broad exploration.
3. **For trivial work** — Resolver applies the small edit directly. No subagent needed.
4. **Implement** — Dispatches `coder` with exact file paths and focused instructions.
5. **Verify** — Runs the cheapest meaningful check first (targeted test, type check, or lint).
6. **Retry** — If issues remain, dispatches `coder` again with a focused fix. Max 3 attempts per failing checkpoint. When verified, proceed to the next checkpoint.
7. **Report** — Returns a concise evidence summary: what changed, verification results, and any remaining blockers.
8. **Internal specialists** — When justified: dispatch `explorer` (scope genuinely unknown), `reviewer` (verification gap on non-trivial changes), or `deep-reviewer` (risky/security/high-impact only). These are available by default as subagents but are not the core path.

---

## Default Behavior

| Item | Default |
|---|---|
| Enabled agents | `coder`, `resolver`, `explorer`, `reviewer`, `deep-reviewer` |
| Core path | `resolver` → `coder` (fixed-role verified loop) |
| Internal subagents | `explorer`, `reviewer`, `deep-reviewer` (subagent-only, dispatched when justified) |
| Primary agent for new tasks | `resolver` (`mode: "all"`) |
| Agent model | Inherits top-level OpenCode `model` |
| Native `plan` / `build` | Preserved untouched |
| Context7 MCP preset | Added automatically when `context7: true` |
| Optional commands | Disabled |
| `autoApprove` | `true` (no per-action prompts on coder/resolver) |
| Max retries per checkpoint | 3 (via resolver prompt) |

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
  "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"],
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
        "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"],
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
| `enabled` | `string[]` | `["coder", "resolver", "explorer", "reviewer", "deep-reviewer"]` | Which resolve agents to inject. Core path: resolver→coder. Internal specialists (explorer, reviewer, deep-reviewer) are subagent-only. Per-agent `agents.<name>.enabled` overrides this. |
| `preserveNative` | `boolean` | `true` | Native `plan`/`build` are always preserved. Accepted for readability. |
| `context7` | `boolean` | `true` | When true, registers the Context7 MCP server unless already configured. |
| `commands` | `boolean` | `false` | When true, adds `resolve`, `resolve-code`, `resolve-review` commands. |
| `autoApprove` | `boolean` | `true` | Flips default `"ask"` permissions to `"allow"` on enabled agents. Never touches `"deny"` or user-set keys. |
| `maxParallelSubagents` | `positive integer` | `2` | Cap on simultaneous subagents the resolver dispatches per role. |
| `models` | `object` | `{}` | Alias map. Keys are agent names or `fast`/`strong`/`mini`/`codex`/`quick`/`deep`/`glm`/`gpt`. Values are model ids or other aliases. Empty by default — all roles inherit the OpenCode default model. |
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

Agents with `"deny"` defaults (e.g. reviewer's `edit` and `bash`) keep those denials even with `autoApprove: true`. Reviewer is enabled by default as an internal subagent — its deny permissions ensure it stays read-only.

Turn it off when you want the conservative ask-every-time behavior:

```json
{
  "autoApprove": false
}
```

> **Trust note:** `autoApprove: true` assumes you trust the workspace and the model you have configured. Use a sandbox or VM for untrusted code, and keep `autoApprove: false` if you want to inspect every action.

---

## Parallel Subagent Limit

`maxParallelSubagents` (default `2`) caps how many subagents the **resolver** may dispatch concurrently **per role** for context efficiency. The default of `2` lets up to two coders run in parallel for genuinely independent work.

| Value | Behavior |
|---|---|
| `1` | Strictly one coder at a time. |
| `2` (default) | Up to two coders concurrently. Useful when fanning out genuinely independent work. |
| `N > 2` | Up to N coders concurrently. Use sparingly to avoid context waste. |

Override per project or per user:

```json
{ "maxParallelSubagents": 1 }
{ "maxParallelSubagents": 2 }
{ "maxParallelSubagents": 4 }
```

> **Important — soft limit, not a hard cap.** The limit is woven into the resolver's system prompt only. There is no runtime interceptor that blocks excess dispatches. Capable instruction-following coding models generally respect the directive, but if a model misbehaves, dispatches above the limit will go through. Pair this with `maxSteps` to bound total iterations if you want a stricter ceiling.

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

`opencode-resolve` does not pin any provider-specific model by default. All resolve agents inherit your top-level OpenCode `model` — use a single efficient model if it gives the best token-per-result efficiency. Only pin role-specific models when you have measured a benefit.

Model resolution order for each resolve agent:

1. `agents.<name>.model`
2. `models.<name>` alias mapping
3. top-level OpenCode `model`
4. OpenCode's own fallback when no model is configured

### Use default model for everything (recommended)

```json
{
  "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"],
  "models": {}
}
```

### Role-specific aliases (when measured benefit exists)

```json
{
  "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"],
  "models": {
    "fast": "openai/gpt-5-mini",
    "strong": "openai/gpt-5.3-codex",
    "coder": "fast",
    "resolver": "strong"
  }
}
```

### Pin one role directly

```json
{
  "agents": {
    "resolver": {
      "model": "openai/gpt-5.3-codex"
    }
  }
}
```

### Mixed setup (OpenCode config + resolve models)

Native OpenCode agents such as `plan` and `build` are configured through the top-level OpenCode `agent`, not through `opencode-resolve`.

```json
{
  "model": "openai/gpt-5-mini",
  "agent": {
    "plan": {
      "model": "openai/gpt-5.3-codex"
    }
  },
  "plugin": [
    [
      "opencode-resolve",
      {
        "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"]
      }
    ]
  ]
}
```

In this setup, `plan` uses `openai/gpt-5.3-codex`; native `build`, resolve `coder`, and resolve `resolver` all use `openai/gpt-5-mini`.

### Supported model alias keys

| Alias | Purpose |
|---|---|
| `fast` | Provider-neutral alias for a fast/cheap model |
| `strong` | Provider-neutral alias for a strong/expensive model |
| `mini` | Provider-neutral alias for a mini/efficient model |
| `codex` | Provider-neutral alias for a codex-style coding model |
| `quick` | Legacy alias (equivalent to `fast`) |
| `deep` | Legacy alias (equivalent to `strong`) |
| `glm` | Legacy alias (backward compatibility) |
| `gpt` | Legacy alias (backward compatibility) |

Aliases only resolve when defined in `models`. Agent names (`coder`, `resolver`, etc.) are also valid alias keys.

---

## Agent Reference

| Agent | Default | Mode | Edit | Bash | WebFetch | Purpose |
|---|:---:|---|---|---|---|---|
| `resolver` | Yes (core) | `all` | ask → allow | ask → allow | ask → allow | Context-efficient orchestrator. Decomposes work into verified checkpoints, dispatches coder, verifies each, carries forward. Max 3 retries per failing checkpoint. |
| `coder` | Yes (core) | `subagent` | ask → allow | ask → allow | ask → allow | Focused implementer. Smallest correct patch. Reads only needed files. |
| `explorer` | Yes (subagent) | `subagent` | **deny** | ask → allow | ask → allow | Internal fast codebase scout. Resolver dispatches when scope is genuinely unknown; prefers local read/grep/glob for narrow scope. |
| `reviewer` | Yes (subagent) | `subagent` | **deny** | **deny** | ask → allow | Internal verification-gap auditor. Resolver dispatches for post-change verification gaps on non-trivial changes. |
| `deep-reviewer` | Yes (subagent) | `subagent` | **deny** | **deny** | ask → allow | Internal thorough review for risky/security/architecture changes. Resolver dispatches ONLY for high-impact work. |
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

Supported model alias keys: `fast`, `strong`, `mini`, `codex`, `quick`, `deep`, `glm`, `gpt`, and every supported agent name. Aliases only resolve when defined in `models`.

`preserveNative` is accepted for readability, but native `plan` and `build` are always preserved. The plugin never rewrites built-in OpenCode agents.

### Resolver orchestration rules

The resolver uses a context-efficient approach with checkpointed execution (max 3 retries per failing checkpoint):

- **Classify** the work as quick, normal, deep, or risky before planning.
- **Inspect only relevant files** using local tools — avoid broad exploration.
- For trivial work, apply edits directly — no subagent needed.
- Dispatch **coder** with focused file/behavior instructions.
- Run the **cheapest meaningful verification** first.
- Retry from verification logs if issues remain. Max 3 attempts per failing checkpoint; then move forward or report the blocker.
- Use **explorer** only when scope is genuinely unknown and local read/grep/glob are insufficient (internal subagent, not core path).
- Use **reviewer** only when a verification gap exists on non-trivial changes (internal subagent, not core path).
- Use **deep-reviewer** only for risky, security-sensitive, architectural, or high-impact changes (internal subagent, not core path).
- Return a concise evidence summary when resolved or blocked.
- Honor the `maxParallelSubagents` per-role limit for context efficiency.

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
- Core path is fixed: `resolver` (context-efficient planner/judge) → `coder` (implementer).
- Internal specialist subagents (`explorer`, `reviewer`, `deep-reviewer`) are injected by default as OpenCode-native subagents — they inherit OpenCode's composition philosophy — but are not the default execution path and are never user-facing primary roles.
- Resolver prefers local read/grep/glob for narrow scope; dispatches `explorer` only when scope is genuinely unknown.
- Resolver dispatches `reviewer` only for verification gaps on non-trivial changes.
- Resolver dispatches `deep-reviewer` only for risky, security-sensitive, architectural, or high-impact changes.
- Reviewer and deep-reviewer are read-only — fixes always go through `coder` or `resolver`.
- Max 3 retries per failing checkpoint to avoid wasted context. Large tasks are decomposed into verified checkpoints.
- The resolver honors `maxParallelSubagents` for context efficiency.
- Search and inspect before editing. Make the smallest correct change. Verify when practical.
- Read only needed files. Avoid broad exploration. Targeted verification, not full suites.

---

## License

[MIT](./LICENSE)
