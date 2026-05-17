---
title: Installation
description: Install opencode-resolve and register it with OpenCode.
---

## Requirements

- OpenCode is installed: `opencode --version`
- Node.js is 20 or newer: `node --version`
- `~/.config/opencode/opencode.json` has a working provider/model

## Standard Install

```sh
npm install -g opencode-resolve@latest
opencode-resolve setup
```

`opencode-resolve setup` registers the plugin in `opencode.json`, walks you through a short Q&A (press enter to accept defaults), writes `resolve.json`, and refreshes the OpenCode plugin cache under `~/.cache/opencode/packages/`. Restart OpenCode after setup completes.

## Files

| File | Purpose |
| --- | --- |
| `~/.config/opencode/opencode.json` | Add `"opencode-resolve"` to the `plugin` list. |
| `~/.config/opencode/resolve.json` | Store resolve agents, models, and options. |

## Minimal Manual Setup

```json
{
  "plugin": ["opencode-resolve"]
}
```

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
  }
}
```

> Prefer an LLM to do the install? See [LLM-driven Install (Auto)](/opencode-resolve/start/llm-setup/) — paste one block into your coding LLM and it auto-detects providers/models, applies the recommended three-tier setup, and writes `resolve.json` for you.

## Setup CLI options

`npm install` runs the postinstall script silently. For interactive choices or re-running setup, use the package CLI:

```sh
opencode-resolve setup [options]
```

| Option | What it does |
| --- | --- |
| `--fresh` | Back up existing `resolve.json` and run setup again. Preserves model pins. |
| `--update` | Keep existing `resolve.json` and add only missing defaults. |
| `--reset-config` | Back up existing `resolve.json` and regenerate everything, including model pins. |
| `--models` | Reconfigure model pins only. Leaves the rest of `resolve.json` alone. |
| `--auto-preset` | Non-interactive: pick a model preset from the OpenCode provider you have configured. |
| `--force-cache` | Force the OpenCode plugin cache to reinstall without touching `resolve.json`. |
| `--no-companions` | Skip the companion-plugin suggestions at the end of setup. |

## Environment variables

| Variable | Effect |
| --- | --- |
| `OPENCODE_RESOLVE_SKIP_POSTINSTALL=1` | Skip postinstall entirely (no config edits, no cache refresh). |
| `OPENCODE_RESOLVE_SKIP_CACHE_REFRESH=1` | Run postinstall but leave the OpenCode plugin cache as-is. |
| `OPENCODE_RESOLVE_SKIP_COMPANIONS=1` | Hide the optional companion-plugin suggestions. |
| `OPENCODE_RESOLVE_QUIET=1` | Silence the `[opencode-resolve] vX.Y.Z loaded` line printed on every plugin load. |

Example:

```sh
OPENCODE_RESOLVE_SKIP_POSTINSTALL=1 npm install -g opencode-resolve
```

## Verify

After restart:

- `resolver` appears as a primary agent.
- `coder` appears as a subagent.
- Context7 is registered unless disabled.

## Recommended Skills

`opencode-resolve` provides the resolve loop. For a broad set of task-specific OpenCode skills, try [awesome-opencode-skills](https://github.com/jshsakura/awesome-opencode-skills).

macOS / Linux:

```sh
curl -sL https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.ps1 | iex
```
