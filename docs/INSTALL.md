# Installation Guide

This page is the operator-friendly install path for `opencode-resolve`.

## Before You Start

You need:

- OpenCode installed and runnable.
- Node.js 20 or newer.
- A working OpenCode provider/model in `~/.config/opencode/opencode.json`.

Check:

```sh
opencode --version
node --version
```

## Standard Install

```sh
npm install -g opencode-resolve
opencode plugin opencode-resolve --global --force
opencode
```

The second command matters. OpenCode caches plugins separately from npm, so a global npm install is not enough by itself.

## What Gets Written

The installer tries to update two OpenCode files:

| File | Purpose |
| --- | --- |
| `~/.config/opencode/opencode.json` | Adds `"opencode-resolve"` to the plugin list. |
| `~/.config/opencode/resolve.json` | Stores resolve-specific agents, models, and options. |

Existing config is preserved. If `resolve.json` already exists, the installer does not replace it without an explicit reinstall mode.

## Minimal Manual Config

Add the plugin:

```json
{
  "plugin": ["opencode-resolve"]
}
```

Create `~/.config/opencode/resolve.json`:

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

Refresh and restart:

```sh
opencode plugin opencode-resolve --global --force
opencode
```

## Fresh Reinstall

Use this when you want the installer to prompt for a fresh setup. This npm flag works the same in Windows PowerShell, macOS, and Linux shells:

```sh
npm install -g opencode-resolve --opencode-resolve-reinstall=fresh
```

Shell-specific environment variables are still supported:

```sh
OPENCODE_RESOLVE_REINSTALL=fresh npm install -g opencode-resolve
```

Use this when you want additive migration only:

```sh
npm install -g opencode-resolve --opencode-resolve-reinstall=update
OPENCODE_RESOLVE_REINSTALL=update npm install -g opencode-resolve
```

## Skip Automation

```sh
OPENCODE_RESOLVE_SKIP_POSTINSTALL=1 npm install -g opencode-resolve
```

## Companion Plugins

These are optional:

```json
{
  "plugin": [
    "@tarquinen/opencode-dcp@latest",
    "@slkiser/opencode-quota@latest",
    "opencode-resolve"
  ]
}
```

Use them only if you want their behavior:

- `opencode-dcp` reduces stale tool-output pressure during long sessions.
- `opencode-quota` adds usage/quota visibility in the TUI.

## Recommended Skills

For a richer OpenCode setup, try [awesome-opencode-skills](https://github.com/jshsakura/awesome-opencode-skills). It provides a large OpenCode Skills collection for specialized development, infrastructure, security, data, and documentation work.

macOS / Linux:

```sh
curl -sL https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.ps1 | iex
```

## Verify

After restarting OpenCode:

- `resolver` should be available as a primary agent.
- `coder` should be available as a subagent.
- Context7 should be registered unless disabled.

For a full reference, see [Configuration](CONFIGURATION.md).
