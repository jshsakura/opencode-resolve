# opencode-resolve — Lightweight Resolver Plugin for OpenCode

**[English](./README.md) | [한국어](./README.ko.md)**

[![npm version](https://img.shields.io/npm/v/opencode-resolve.svg)](https://www.npmjs.com/package/opencode-resolve)
[![CI](https://github.com/jshsakura/opencode-resolve/actions/workflows/publish.yml/badge.svg)](https://github.com/jshsakura/opencode-resolve/actions/workflows/publish.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> **opencode-resolve** is a **lightweight resolver plugin for [OpenCode](https://opencode.ai)**. It lives _inside_ your OpenCode session and turns a single instruction into a finished, verified change — that is what _resolving_ means here.
>
> It is **not** a standalone application, not a model provider, not a separate CLI you run daily, and not a replacement for your `opencode.json` configuration. It is an OpenCode plugin and nothing more.

It exposes a **fixed-role verified resolve loop** — **resolver** (context-efficient planner/judge) and **coder** (focused implementer) — with low-friction permissions for edits, verification, and safe shell commands. The resolver inspects only relevant files, plans the smallest patch, dispatches coder with exact instructions, verifies, and iterates through verified checkpoints. Repeated failures trigger debugger/architect recovery guidance and, after repeated consecutive failures, the resolver should stop and report the blocker instead of pretending the task is complete. Internal specialist subagents (**explorer**, **reviewer**, **deep-reviewer**) are injected by default as OpenCode-native subagents — available when the resolver judges them justified — but they are not part of the core path and are never user-facing primary roles. It defines roles, not model providers: agents inherit your OpenCode default model unless you pin them.

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
- [Project Context Sources](#project-context-sources)
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
- **Context-efficient by default** — minimal file reads, smallest patch, targeted verification, checkpointed execution, and explicit blocker reporting when repeated fixes fail
- **Committed team context discovery** — detects `HARNESS.md`, `AGENTS.md`, `.opencode/context`, `.claude/context`, `context/`, and Agentic-style `thoughts/`, then lists task-relevant pattern documents without stuffing the whole repo into the prompt
- **OpenCode-native internal specialist subagents** — `reviewer` (verification-gap audit), `explorer` (codebase scout), `deep-reviewer` (risky/security review) — injected as subagents by default but not part of the core path; resolver dispatches them only when justified
- **Low-friction permissions** — edit/webfetch are allowed for write agents; bash is classifier-routed so safe commands are allowed, dangerous commands denied, and unknown commands still ask
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

> No additional API keys are required for the plugin itself. Context7 is auto-registered by the plugin. For GLM/ZAI users, postinstall may add a local ZAI MCP server bootstrap, but it does **not** copy API keys into `opencode.json`; export `Z_AI_API_KEY` in your shell if that MCP server requires it.

---

## Quick Start

### Install from npm

```sh
npm install -g opencode-resolve
```

The `postinstall` script automatically:

1. Adds `opencode-resolve` to `~/.config/opencode/opencode.json` `plugin` array (if not already present).
2. Creates `~/.config/opencode/resolve.json` adapted to your current model provider when the file does not exist:
   - **GLM/ZAI model detected** → GLM-only alias preset (no GPT dependency) and a non-secret local ZAI MCP bootstrap.
   - **OpenAI/GPT model detected** → single-provider GPT preset using your current model for all roles.
   - **Other or no model** → model-neutral `models: {}` (all roles inherit OpenCode default).

   Existing `resolve.json` files are **never overwritten** — the adaptive preset only applies to first-time creation. To regenerate, delete `resolve.json` and reinstall.

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

You should now see `resolver` available as the user-facing resolve agent. `coder` is enabled as a subagent for resolver to dispatch, so it may not appear in the primary picker.

---

## Drop-in setup (give to an LLM)

Hand the block below to any reasonably capable LLM along with the instruction _"set up opencode-resolve on this machine"_ and it will finish the install end-to-end. The LLM **must run this interactively** — it discovers what providers and models are already configured, then asks the user which to pin per role. No guessing, no invented model IDs.

> **For LLMs reading this:** treat every "Ask the user" prompt below as a real question — wait for the user's answer before continuing. Never proceed with a default if the user hasn't responded. Never invent model IDs that aren't in the user's `opencode.json` (or in their declared `provider.*` registry).

### Step 1 — Install and prime the cache

```sh
opencode plugin opencode-resolve --global --force
```

This downloads the plugin, installs it into OpenCode's package cache (`~/.cache/opencode/packages/`), and makes it available.

### Step 2 — Register the plugin in `~/.config/opencode/opencode.json`

Add the string `"opencode-resolve"` to the `plugin` array. **Do not use the inline tuple form here** — keep the entry as a bare string so all role/model config lives in `resolve.json` (Step 3). This avoids split-brain configuration.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "<user-default-model-id>",
  "plugin": ["opencode-resolve"]
}
```

> If the user already has other plugins, append `"opencode-resolve"` to the existing array. **Never overwrite** their existing config.

#### 2b. Offer the recommended companion plugins

Before moving to model selection, ask the user about two **independent** companion plugins — one question each, recommended-by-default. Both are separate OpenCode plugins; opencode-resolve does not require them but pairs well with both.

**Companion 1 — `@tarquinen/opencode-dcp` (Dynamic Context Pruning)**

> _opencode-resolve pairs well with **`@tarquinen/opencode-dcp`** — it prunes obsolete tool outputs so long resolver loops cost fewer tokens. Want to install it? (recommended)_

**Companion 2 — `@slkiser/opencode-quota` (quota & usage tracking)**

> _And **`@slkiser/opencode-quota`** — shows your live token/quota usage without polluting the context window. Supports GLM coding-plan, OpenAI Plus/Pro, Qwen, and more. Useful for keeping an eye on your own usage / remaining quota. Install it? (recommended)_

For each **yes** answer:

1. Run `opencode plugin <package>@latest --global --force` (primes the cache).
2. Append `"<package>@latest"` to the `plugin` array in `~/.config/opencode/opencode.json`, only if it is not already present.

Where `<package>` is `@tarquinen/opencode-dcp` or `@slkiser/opencode-quota`.

For each **no**, skip — do not modify `opencode.json` for that entry. Proceed to Step 3 either way.

> `context7` MCP is registered automatically by opencode-resolve at runtime when `context7: true` (the default in `resolve.json`). No separate question is needed for that.

### Step 3 — Pick models interactively, then write `~/.config/opencode/resolve.json`

The LLM **drives a short Q&A** here. Goal: end with `resolve.json` containing model IDs the user explicitly chose from their own configuration.

#### 3a. Discover the user's installed providers and models

Read `~/.config/opencode/opencode.json` and build a candidate map:

| Source | What to collect |
|---|---|
| `provider.*` keys | Each configured provider (e.g. `zai`, `openai`, `anthropic`). |
| `provider.<key>.models.*` keys | The model keys the user has declared under that provider. |
| Top-level `model` | If the prefix before `/` is not already in `provider.*`, add it as an implicit candidate (e.g. `zai-coding-plan` from `zai-coding-plan/glm-5.1`). |
| `agent.*.model` | Any per-agent overrides — add their provider/model pairs as candidates. |

If the user has **no providers configured at all**, stop and tell them to add at least one provider with a valid API key to `opencode.json` first — opencode-resolve cannot pick a model that does not exist.

#### 3b. Ask the user: which provider?

Print the candidate list and ask. Example wording the LLM should use:

> _I found these providers in your OpenCode config. Which one should opencode-resolve roles use?_
>
> 1. `zai-coding-plan` — models: `glm-5.1`, `glm-4.7-flash`
> 2. `openai` — models: `gpt-4o`, `gpt-4o-mini`, `o1`, `o1-mini`, `o3-mini`, `gpt-5.5`
> 3. _Other (provide an explicit `provider/model` ID)_

If exactly one provider candidate exists, skip the question and use it.

#### 3c. Ask the user: single, two-tier, or three-tier split?

The default recommendation is **C (three-tier bronze/silver/gold)** — opencode-resolve has three qualitatively distinct workloads (read-only scout → write/patch → reason/judge) and three matching tiers cost about the same as two-tier but read role costs more accurately. Fall back to B if the user only has two models, A only when they have one.

> _Recommended: **three-tier** — a cheap scout model for `explorer`, a mid coder for `coder`, and a strong reasoner for `resolver`/`reviewer`/`deep-reviewer`/`planner`. Choose:_
>
> **C. Three-tier — bronze (scout) + silver (coder) + gold (reasoner) — recommended**
> B. Two-tier — fast + strong (when you only have two models)
> A. Single model for all roles (only if you have one model or want maximum simplicity)

Default to C if the user just hits enter or says "recommended". Only fall back if they don't have enough distinct models. Same-provider split is fully valid (e.g. `openai/gpt-4o-mini` / `openai/gpt-5.3-codex` / `openai/o4-mini`, or `zai/glm-4.7-flash` / `zai-coding-plan/glm-5.1` / `zai/glm-5`).

#### 3d. Ask the user: which model(s)?

Show only the models under the provider picked in 3b.

- For **single-tier (A)** — ask one question:
  > _Which model should every role use?_ → list models from the chosen provider.
- For **split (B)** — ask two questions, in order:
  > _Pick the **fast** model for `coder` and `explorer`:_ → list models.
  >
  > _Pick the **strong** model for `resolver`, `reviewer`, `deep-reviewer`:_ → list models.

Confirm each pick back to the user before writing the file. Example:

> _I'll pin `coder` and `explorer` to `zai-coding-plan/glm-5.1`, and `resolver`/`reviewer`/`deep-reviewer` to `openai/gpt-5.5`. Proceed?_

#### 3d-bis. Skip `maxParallelSubagents` unless the user explicitly wants a hard cap

The default flow does **not** write `maxParallelSubagents` to `resolve.json`. The resolver prompt ships with soft fan-out guidance — fan out coders when work is genuinely independent, back off on rate-limit errors, explorer is unrestricted, reviewer/deep-reviewer/planner are singletons by nature. This matches how oh-my-openagent (per-model semaphore, default no real cap) and OpenCode core (no built-in concurrency rule) handle the same concern, and avoids overconstraining a model that's already aware of rate limits.

Only ask about `maxParallelSubagents` if the user explicitly mentions wanting to cap fan-out. Common case: GLM coding-plan users who want to **guarantee** they never burst beyond 1 or 2 coder calls. Suggested wording:

> _(optional, ask only if relevant)_ _Your `coder` model is GLM — the coding-plan throttles under bursts. Pin `maxParallelSubagents: 1` for strict serial coder dispatch?_

Otherwise, omit the field entirely.

#### 3e. Write `~/.config/opencode/resolve.json`

**Three-tier (C, recommended)** — use the `bronze`/`silver`/`gold` aliases:

```json
{
  "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer", "planner"],
  "preserveNative": true,
  "context7": true,
  "commands": false,
  "models": {
    "bronze":        "<provider>/<scout-model>",
    "silver":        "<provider>/<coder-model>",
    "gold":          "<provider>/<reasoner-model>",
    "explorer":      "bronze",
    "coder":         "silver",
    "resolver":      "gold",
    "reviewer":      "gold",
    "deep-reviewer": "gold",
    "planner":       "gold"
  },
  "agents": {
    "coder":         { "enabled": true,  "mode": "subagent" },
    "resolver":      { "enabled": true },
    "explorer":      { "enabled": true,  "mode": "subagent" },
    "reviewer":      { "enabled": true,  "mode": "subagent" },
    "deep-reviewer": { "enabled": true,  "mode": "subagent" },
    "planner":       { "enabled": true,  "mode": "subagent" },
    "architect":     { "enabled": false },
    "gpt-coder":     { "enabled": false },
    "debugger":      { "enabled": false },
    "researcher":    { "enabled": false }
  },
  "autoApprove": true,
  "autoUpdate": true
}
```

**Two-tier (B)** — collapse bronze and silver if the user has only two models:

```json
"models": {
  "silver":        "<provider>/<coder-model>",
  "gold":          "<provider>/<reasoner-model>",
  "explorer":      "silver",
  "coder":         "silver",
  "resolver":      "gold",
  "reviewer":      "gold",
  "deep-reviewer": "gold",
  "planner":       "gold"
}
```

**Single-tier (A)** — every role on one model:

```json
"models": {
  "gold":          "<provider>/<single-model>",
  "explorer":      "gold",
  "coder":         "gold",
  "resolver":      "gold",
  "reviewer":      "gold",
  "deep-reviewer": "gold",
  "planner":       "gold"
}
```

Replace every `<provider>/<model>` placeholder with the **exact** ID strings the user picked. **Do not** add `maxParallelSubagents` unless the user explicitly asked for a hard cap (see 3d-bis).

Replace every `<provider>/<model>` placeholder with the **exact** ID strings the user picked in 3b/3d — no inventing, no autocompletion, no version drift. If you cannot map the picked model to a `provider/model` string, ask the user to clarify rather than guessing.

> Each enabled agent carries an explicit `enabled: true` so the file is self-documenting. The `enabled` array remains authoritative; the per-agent flag just removes ambiguity for humans reading the file.

> If `resolve.json` already exists, **do not overwrite it silently**. Show the user the existing content first, summarize what would change, and ask whether to overwrite, merge, or abort.

### Step 4 — Restart OpenCode and verify

Close and reopen OpenCode, then confirm the install worked:

```sh
opencode run "list available agents"
```

The output **must** include `resolver` and `coder` (and `reviewer` if enabled). Two failure modes to check explicitly:

| Symptom | Cause | Fix |
|---|---|---|
| Only OpenCode's built-in `explore` / `general` appear | Plugin didn't load | Re-run `opencode plugin opencode-resolve --global --force`; verify `"opencode-resolve"` is in `opencode.json` `plugin` array as a string. |
| Agents appear but fail when invoked with "model not found" | A pinned model ID in `models` doesn't exist | Re-open `resolve.json`, replace the offending ID with one the user actually has, restart. |
| The user said split but only one tier shows up | `models` block missing `fast` or `strong` | Re-run Step 3 from 3d. |

Internal specialist subagents (`coder`, `explorer`, `reviewer`, `deep-reviewer`, `planner`) are subagent-only and won't appear in the primary picker — `resolver` is the default user-facing resolve agent.

### Why this template

| Setting | Why |
|---|---|
| `enabled: ["coder", "resolver", "explorer", "reviewer", "deep-reviewer", "planner"]` | Fixed core path (resolver→coder) plus OpenCode-native internal specialist subagents injected by default |
| `autoApprove: true` | Compatibility/readability flag; actual low-friction behavior comes from base permissions plus the `permission.ask` bash classifier |
| no `maxParallelSubagents` by default | Keeps the resolver on soft fan-out guidance; GLM profile is token-efficient but does not impose a hard concurrency cap unless you set one |
| `agents.coder.mode = "subagent"` | Coder stays on the fixed resolver→coder path instead of becoming a user-facing primary role |
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
6. **Recover** — If issues remain, dispatches `debugger` or `coder` again with a focused fix. After repeated consecutive failures, stop and report the blocker instead of claiming completion.
7. **Report** — Returns a concise evidence summary: what changed, verification results, and any remaining blockers.
8. **Internal specialists** — When justified: dispatch `explorer` (scope genuinely unknown), `reviewer` (verification gap on non-trivial changes), or `deep-reviewer` (risky/security/high-impact only). These are available by default as subagents but are not the core path.

---

## Default Behavior

| Item | Default |
|---|---|
| Enabled agents | `coder`, `resolver`, `explorer`, `reviewer`, `deep-reviewer`, `planner` |
| Core path | `resolver` → `coder` (fixed-role verified loop) |
| Internal subagents | `explorer`, `reviewer`, `deep-reviewer` (subagent-only, dispatched when justified) |
| Primary agent for new tasks | `resolver` (`mode: "all"`) |
| Agent model | Inherits top-level OpenCode `model` |
| Native `plan` / `build` | Preserved untouched |
| Project context sources | `HARNESS.md`, `AGENTS.md`, `CLAUDE.md`, `CONVENTIONS.md`, `.opencode/context`, `.claude/context`, `context/`, `thoughts/` |
| Context7 MCP preset | Added automatically when `context7: true` |
| Optional commands | Disabled |
| `autoApprove` | `true` (compatibility/readability flag; bash routing is handled by the permission hook) |
| Repeated-failure behavior | Diagnose, retry with a different fix, pivot to architect after heavy failure, then report blockers instead of claiming completion |

---

## Project Context Sources

opencode-resolve can discover committed project knowledge without loading the whole repository into the prompt. The resolver sees the available sources and should read only the documents relevant to the current task.

Detected top-level knowledge files:

| Source | Purpose |
|---|---|
| `HARNESS.md` | Build, verification, infrastructure, deployment, and project traps |
| `AGENTS.md` | Agent behavior, delegation rules, review expectations, local workflow |
| `CLAUDE.md` | Existing AI coding guidance used by other tools |
| `CONVENTIONS.md` | Code style, naming, architecture, and repository conventions |

Detected context directories:

| Source | Behavior |
|---|---|
| `.opencode/context/` | OpenCode/OAC-style team pattern docs |
| `.claude/context/` | Claude-style shared context docs |
| `context/` | Generic project context docs |
| `thoughts/` | Agentic-style persistent knowledge: architecture, tickets, research, plans, reviews |

For context directories, the plugin lists `.md`, `.mdx`, `.txt`, `.json`, `.jsonc`, `.yaml`, and `.yml` files up to a bounded depth and count. `thoughts/archive/` is intentionally skipped because archived notes are often stale or misleading.

Local runtime state is intentionally ignored by git:

```text
.opencode/resolve-state.json
.opencode/*.local.json
```

Committed context such as `.opencode/context/` and `thoughts/` is not ignored.

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
  "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer", "planner"],
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
        "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer", "planner"],
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
| `profile` | `"mix" \| "gpt" \| "glm"` | `"mix"` | Top-level operating profile. `mix` is the explicit default; `gpt` and `glm` apply provider-specific prompts, enabled-agent defaults, and chat parameters. |
| `tier` | `"bronze" \| "silver" \| "gold"` | _none_ | Optional enabled-agent preset. `bronze` is minimal, `silver` is standard, `gold` enables the full specialist set. |
| `enabled` | `string[]` | `["coder", "resolver", "explorer", "reviewer", "deep-reviewer", "planner"]` | Which resolve agents to inject. Core path: resolver→coder. Internal specialists (coder, explorer, reviewer, deep-reviewer, planner) are subagent-only. Per-agent `agents.<name>.enabled` overrides this. |
| `preserveNative` | `boolean` | `true` | Native `plan`/`build` are always preserved. Accepted for readability. |
| `context7` | `boolean` | `true` | When true, registers the Context7 MCP server unless already configured. |
| `commands` | `boolean` | `false` | When true, adds `resolve`, `resolve-code`, `resolve-review` commands. |
| `autoApprove` | `boolean` | `true` | Compatibility/readability flag. Current behavior is controlled by built-in base permissions and the `permission.ask` bash classifier; the flag does not rewrite permissions. |
| `autoUpdate` | `boolean` | `true` | Best-effort npm version check and OpenCode plugin cache refresh notice. Set false to disable. |
| `maxParallelSubagents` | `positive integer` | _unset_ | Optional prompt-level cap on simultaneous coders. When unset, the resolver uses soft fan-out guidance and backs off on rate-limit errors. GLM profile does not impose a hard cap unless you set one. |
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

`autoApprove` (default `true`) is now a compatibility/readability flag. It is accepted in config so older `resolve.json` files continue to load, but the current harness does **not** rewrite permissions from `"ask"` to `"allow"`.

Low-friction autonomous behavior comes from two explicit defaults:

| Permission | Current default behavior |
|---|---|
| Write-agent `edit` / `webfetch` | `allow` |
| Write-agent `bash` | `ask`, routed through the plugin's `permission.ask` classifier |
| Safe bash commands | Auto-allowed by classifier |
| Dangerous bash commands | Auto-denied by classifier |
| Unknown bash commands | Left as `ask` for OpenCode/user handling |
| Read-only agent `edit` / `bash` | `deny`; write-capable plugin tools also block read-only agents |

You may leave the flag in config for intent clarity:

```json
{
  "autoApprove": false
}
```

> **Trust note:** low-friction write-agent permissions assume you trust the workspace and configured model. Use a sandbox or VM for untrusted code. Bash remains classifier-routed rather than blindly allowed.

---

## Parallel Subagent Limit

`maxParallelSubagents` is optional. When omitted, the **resolver** uses soft fan-out guidance: dispatch coders for genuinely independent work and back off on rate-limit errors. Set it only when you want the resolver prompt to carry an explicit per-role concurrency cap. GLM profile is token-efficient but uncapped by default.

| Value | Behavior |
|---|---|
| `1` | Strictly one coder at a time. |
| `2` | Up to two coders concurrently. Useful when fanning out genuinely independent work. |
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

- Adds new top-level keys (currently `autoApprove`) with their defaults if they are absent.
- **Never** modifies keys you have already set.
- **Never** rewrites your `enabled` list, `models` map, or `agents` overrides.
- If `enabled` is set and does not include `"resolver"`, prints a one-line tip suggesting you add it. Your file is left untouched.

### Adaptive first-install preset

When `resolve.json` does **not** exist, postinstall inspects your OpenCode model configuration and writes a provider-adapted `models` block:

| Detected provider | Preset |
|---|---|
| GLM/ZAI + OpenAI/GPT | Mixed: `profile: "mix"`, GLM for scout/coder aliases, GPT for resolver/reviewer/planner aliases |
| GLM / ZAI | GLM-only: all resolve agents use GLM aliases, avoiding GPT dependency |
| OpenAI / GPT | Single-provider: all roles use your current OpenAI model |
| Other or none | `profile: "mix"` with model-neutral `models: {}` (all roles inherit OpenCode default) |

To change presets at any time, edit `models` in `resolve.json` directly or delete the file and reinstall.

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
| `resolver` | Yes (core) | `all` | allow | ask (classifier-routed) | allow | Context-efficient orchestrator. Decomposes work into verified checkpoints, dispatches coder, verifies each, and reports blockers when repeated recovery fails. |
| `coder` | Yes (core) | `subagent` | allow | ask (classifier-routed) | allow | Focused implementer. Smallest correct patch. Reads only needed files. |
| `explorer` | Yes (subagent) | `subagent` | **deny** | **deny** | allow | Internal fast codebase scout. Resolver dispatches when scope is genuinely unknown; prefers local read/grep/glob for narrow scope. |
| `reviewer` | Yes (subagent) | `subagent` | **deny** | **deny** | allow | Internal verification-gap auditor. Resolver dispatches for post-change verification gaps on non-trivial changes. |
| `deep-reviewer` | Yes (subagent) | `subagent` | **deny** | **deny** | allow | Internal thorough review for risky/security/architecture changes. Resolver dispatches ONLY for high-impact work. |
| `planner` | Yes (subagent) | `subagent` | **deny** | **deny** | allow | Explicit-plan specialist. Resolver dispatches only when the user asks for a plan/decomposition/strategy. |
| `architect` | No | `subagent` | **deny** | **deny** | allow | Design and task decomposition. |
| `gpt-coder` | No | `subagent` | allow | ask (classifier-routed) | allow | Stronger-reasoning implementation fallback. |
| `debugger` | No | `subagent` | allow | ask (classifier-routed) | allow | Reproduction and root-cause analysis. |
| `researcher` | No | `subagent` | **deny** | **deny** | allow | Codebase and documentation research. |

`bash: ask` is intentional for write agents: the plugin's `permission.ask` hook auto-allows known safe commands, auto-denies dangerous commands, and leaves unknown commands for OpenCode/user handling.

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

The resolver uses a context-efficient approach with checkpointed execution and repeated-failure recovery:

- **Classify** the work as quick, normal, deep, or risky before planning.
- **Inspect only relevant files** using local tools — avoid broad exploration.
- For trivial work, apply edits directly — no subagent needed.
- Dispatch **coder** with focused file/behavior instructions.
- Run the **cheapest meaningful verification** first.
- Retry from verification logs if issues remain; on verification failure, diagnose root cause before re-dispatching a coder with a different fix.
- After repeated consecutive failures, stop and report the blocker instead of claiming completion; after heavy failure counts, pivot to `architect` for a different strategy.
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

This gives resolve agents access to Context7's documentation tools through OpenCode's MCP integration — no manual MCP configuration needed.

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
- Repeated verification failures trigger diagnosis, a different fix strategy, and blocker reporting instead of silent loop continuation. Large tasks are decomposed into verified checkpoints.
- The resolver honors `maxParallelSubagents` for context efficiency.
- Search and inspect before editing. Make the smallest correct change. Verify when practical.
- Read only needed files. Avoid broad exploration. Targeted verification, not full suites.

---

## License

[MIT](./LICENSE)
