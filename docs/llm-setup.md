# opencode-resolve — LLM Setup Guide

Use this document when an AI coding assistant is installing `opencode-resolve` for a user. Follow the steps exactly, preserve existing OpenCode configuration, and never invent model IDs.

## Goal

Install the OpenCode plugin, refresh OpenCode's plugin cache, create a minimal `resolve.json` if missing, and verify that the `resolver` agent is available after OpenCode restarts.

## Rules

- Do not overwrite existing OpenCode files.
- Do not remove existing plugins, providers, models, MCP servers, or agents.
- Do not guess provider or model IDs.
- If a model must be pinned, inspect the user's existing OpenCode provider registry first and ask which model to use.
- Keep `resolve.json` small. Put role/model configuration there, not inside the `opencode.json` plugin tuple.
- After changes, tell the user to restart OpenCode.

## Step 1 — Check prerequisites

Run:

```sh
opencode --version
node --version
```

Requirements:

- OpenCode must be installed.
- Node.js must be version 20 or newer.
- `~/.config/opencode/opencode.json` must contain at least one usable provider/model.

If OpenCode or Node.js is missing, stop and report the exact blocker.

## Step 2 — Install and refresh cache

Run:

```sh
npm install -g opencode-resolve
opencode plugin opencode-resolve --global --force
```

OpenCode loads plugins from its own cache under `~/.cache/opencode/packages/`, so the cache refresh is required after install and upgrade.

If OpenCode still loads an old plugin copy, refresh only this plugin cache entry:

```sh
export OPENCODE_CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/opencode"
rm -rf "$OPENCODE_CACHE_ROOT/packages/opencode-resolve@latest"
opencode plugin opencode-resolve@latest --global --force
```

## Step 3 — Register plugin

Open `~/.config/opencode/opencode.json`. Ensure the top-level `plugin` array contains `"opencode-resolve"`.

Preferred shape:

```json
{
  "plugin": ["opencode-resolve"]
}
```

If the file already contains plugins, append `"opencode-resolve"` without deleting anything else.

Avoid this unless the user explicitly needs inline overrides:

```json
{
  "plugin": [
    [
      "opencode-resolve",
      { "config": ".opencode/resolve.json" }
    ]
  ]
}
```

## Step 4 — Create resolve config

If `~/.config/opencode/resolve.json` already exists, do not replace it. Read it and report the current enabled agents.

If it does not exist, write:

```json
{
  "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer", "planner"],
  "preserveNative": true,
  "context7": true,
  "commands": false,
  "models": {},
  "agents": {
    "coder": { "enabled": true, "mode": "subagent" },
    "resolver": { "enabled": true },
    "explorer": { "enabled": true, "mode": "subagent" },
    "reviewer": { "enabled": true, "mode": "subagent" },
    "deep-reviewer": { "enabled": true, "mode": "subagent" },
    "planner": { "enabled": true, "mode": "subagent" }
  },
  "autoApprove": true,
  "autoUpdate": true
}
```

This intentionally leaves `models` empty so all resolve agents inherit OpenCode's default model.

## Step 5 — Optional model pinning

Only pin models if the user asks for it or wants a cost/speed/reasoning split.

Inspect configured providers and models from `opencode.json`, then ask the user which exact IDs to use.

Recommended three-tier mapping:

```json
{
  "models": {
    "bronze": "<provider>/<scout-model>",
    "silver": "<provider>/<coder-model>",
    "gold": "<provider>/<reasoning-model>",
    "explorer": "bronze",
    "coder": "silver",
    "resolver": "gold",
    "reviewer": "gold",
    "deep-reviewer": "gold",
    "planner": "gold"
  }
}
```

Use exact model IDs from the user's config. If an ID is unclear, ask again.

## Step 6 — Optional companion plugins

Ask before installing:

- `@tarquinen/opencode-dcp@latest`: trims obsolete tool output during long loops.
- `@slkiser/opencode-quota@latest`: shows token/quota usage in OpenCode without adding context noise.
- `awesome-opencode-skills`: installs a broad OpenCode Skills library for domain-specific work.

These are independent OpenCode plugins. They are useful but not required.

If the user wants the skills collection:

```sh
curl -sL https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.ps1 | iex
```

## Step 7 — Verify

Tell the user to restart OpenCode:

```sh
opencode
```

After restart, confirm:

- `resolver` is visible as a primary agent.
- `coder`, `explorer`, `reviewer`, `deep-reviewer`, and `planner` are available as subagents.
- Context7 MCP appears unless disabled with `"context7": false`.

If verification fails, report the exact config paths checked and the OpenCode/plugin cache refresh command that was run.
