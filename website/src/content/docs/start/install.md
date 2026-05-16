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
npm install -g opencode-resolve
opencode plugin opencode-resolve --global --force
opencode
```

OpenCode loads plugins from its own cache under `~/.cache/opencode/packages/`. The cache refresh is required after installing or upgrading.

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

## Model Setup / Reinstall Modes

npm install scripts are not a reliable place for interactive prompts. Use the package CLI when you want visible model/setup choices:

```sh
opencode-resolve setup --models
opencode-resolve setup --fresh
opencode-resolve setup --update
```

Force the OpenCode plugin cache to reinstall without touching `resolve.json`:

```sh
opencode-resolve setup --force-cache
```

Skip postinstall automation:

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
