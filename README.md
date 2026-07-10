# opencode-resolve — Lightweight Resolver Plugin for OpenCode

**[English](./README.md) | [Korean](./README.ko.md) | [Documentation](https://jshsakura.github.io/opencode-resolve/)**

[![npm version](https://img.shields.io/npm/v/opencode-resolve.svg)](https://www.npmjs.com/package/opencode-resolve)
[![CI](https://github.com/jshsakura/opencode-resolve/actions/workflows/publish.yml/badge.svg)](https://github.com/jshsakura/opencode-resolve/actions/workflows/publish.yml)
[![GitHub Pages](https://img.shields.io/badge/docs-live-blue?logo=github)](https://jshsakura.github.io/opencode-resolve/)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

`opencode-resolve` is an [OpenCode](https://opencode.ai) plugin that adds a small, fixed-role resolve loop for coding tasks:

- `resolver` plans, dispatches, verifies, and iterates.
- `coder` makes focused edits and runs targeted checks.
- `explorer`, `reviewer`, `deep-reviewer`, and `planner` are available as internal subagents when the resolver needs them.

It is not a standalone app, model provider, API key manager, or replacement for `opencode.json`.

```sh
npm install -g opencode-resolve@latest
opencode-resolve setup
```

## Contents

- [What It Adds](#what-it-adds)
- [Install](#install)
- [Recommended Skills](#recommended-skills)
- [Configuration](#configuration)
- [Model Setup](#model-setup)
- [Agents](#agents)
- [Permissions](#permissions)
- [Project Context](#project-context)
- [Upgrade](#upgrade)
- [Development](#development)
- [Release](#release)

## What It Adds

- A verified `resolver -> coder` loop that favors small patches and evidence-backed completion.
- Read-only scout/review subagents for targeted discovery and verification gaps.
- Optional command aliases: `/resolve`, `/resolve-code`, `/resolve-review`.
- Strict config validation: unknown keys, bad modes, bad agent names, and invalid types fail early.
- Conservative migration: generated config is additive and existing values are not overwritten without consent.

Default enabled agents:

```json
["coder", "resolver", "explorer", "reviewer", "deep-reviewer", "planner"]
```

## Install

### One command (recommended)

```sh
npm install -g opencode-resolve@latest
opencode-resolve setup
```

`opencode-resolve setup` auto-detects your providers and models from `opencode.json`, walks you through a short Q&A with sensible defaults (press enter to accept each), writes `resolve.json`, and refreshes the OpenCode plugin cache. Re-run any time to reconfigure without losing your model pins.

### Requirements

- OpenCode installed and runnable: `opencode --version`
- Node.js 20 or newer: `node --version`
- At least one OpenCode model provider configured in `~/.config/opencode/opencode.json`

### Install

```sh
npm install -g opencode-resolve
opencode plugin opencode-resolve --global --force
opencode
```

The npm `postinstall` script registers the plugin in `~/.config/opencode/opencode.json`, creates `~/.config/opencode/resolve.json` if missing, preserves existing settings (unless you opt out with `--reset`), and refreshes the OpenCode plugin cache under `~/.cache/opencode/packages/`.

### Re-run setup

Re-run the installer any time with the `opencode-resolve setup` CLI:

| Command | When to use |
| --- | --- |
| `opencode-resolve setup --reset` | Back up and wipe `resolve.json` completely (model pins included) and regenerate it. Aliases: `--fresh`, `--reset-config`, `--nuke`. |
| `opencode-resolve setup --update` | Keep `resolve.json` and only add missing defaults. |
| `opencode-resolve setup --models` | Re-detect model pins only |
| `opencode-resolve setup --force-cache` | Refresh OpenCode plugin cache only |

Skip postinstall automation:

```sh
OPENCODE_RESOLVE_SKIP_POSTINSTALL=1 npm install -g opencode-resolve
```

### Manual setup

Add the plugin to `~/.config/opencode/opencode.json`:

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

Refresh the OpenCode cache and restart:

```sh
opencode plugin opencode-resolve --global --force
opencode
```

If OpenCode still loads an old plugin copy:

```sh
export OPENCODE_CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/opencode"
rm -rf "$OPENCODE_CACHE_ROOT/packages/opencode-resolve@latest"
opencode plugin opencode-resolve@latest --global --force
```

## Recommended Skills

For a broader OpenCode setup, try [awesome-opencode-skills](https://github.com/jshsakura/awesome-opencode-skills). It installs a large OpenCode Skills collection for specialized development, infrastructure, security, data, and documentation tasks.

macOS / Linux:

```sh
curl -sL https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.ps1 | iex
```

## Configuration

The plugin reads the first config file it finds:

1. `.opencode/resolve.json`
2. `opencode-resolve.json`
3. `~/.config/opencode/resolve.json`
4. `~/.config/opencode/opencode-resolve.json`

Inline plugin options in `opencode.json` override file config. You can also point at a custom file:

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

Precedence:

```text
built-in defaults -> first config file found -> inline plugin options
```

Full commented reference: [opencode-resolve.reference.jsonc](./opencode-resolve.reference.jsonc)

### Top-Level Options

| Key | Type | Default | Purpose |
| --- | --- | --- | --- |
| `tier` | `bronze` / `silver` / `gold` | unset | Enables the matching tier preset when configured. |
| `enabled` | agent name array | default agents | Which resolve agents to inject. |
| `models` | object | `{}` | Model aliases and per-role model pins. |
| `agents` | object | `{}` | Per-agent overrides. |
| `preserveNative` | boolean | `true` | Keep native OpenCode agents unless explicitly overridden. |
| `commands` | boolean | `false` | Add `/resolve`, `/resolve-code`, and `/resolve-review`. |
| `autoApprove` | boolean | `true` | Backward-compatible config flag; current permissions remain explicit. |
| `autoUpdate` | boolean | (no-op) | **Deprecated.** Field is accepted for backward compatibility but ignored. Auto-update spawned `opencode plugin` per `hooks.config()` call, which fanned out into hundreds of parallel installs when multiple OpenCode instances loaded the plugin at once. Update manually with `npm i -g opencode-resolve`. |
| `language` | `auto` / `en` / `ko` | `auto` | Prompt language preference. |
| `maxParallelSubagents` | positive integer | unset | Optional prompt-level soft limit for concurrent coder dispatch. |
| `singleAgentMode` | boolean | `false` | When `true`, the resolver makes all edits directly instead of dispatching a `coder` subagent — lower latency and token cost on simple tasks. Information/diagnostic subagents (explorer/debugger) are still available. |
| `permissions` | object | `{}` | Opt-in rollback permissions. See below. |

### Rollback Permissions

`git reset --hard` and `git clean -f` are denied by default. That protects your uncommitted work, but it also means an agent that tangles the worktree mid-debug cannot get back to a clean state — it stalls. Two opt-in flags un-gate them, for resolve agents only:

```json
{
  "permissions": {
    "allowGitReset": true,
    "allowGitClean": true
  }
}
```

Before either command runs, the plugin snapshots the **entire worktree** — tracked edits *and* untracked files — into a git ref named `refs/resolve-checkpoint/<timestamp>-<reset|clean>`. The snapshot is written through a throwaway index, so your real index, working tree, branches, and `HEAD` are never touched: nothing is staged, nothing is committed. If the snapshot cannot be written, the destructive command is blocked instead of run unprotected.

To recover from a rollback you regret:

```sh
git for-each-ref refs/resolve-checkpoint    # list checkpoints
git restore --source=<ref> -- .             # bring everything back
```

`git clean -x` and `-X` stay denied regardless of these flags. They delete gitignored files, and the checkpoint snapshots via `git add -A`, which honours `.gitignore` — so a `-x` clean would destroy files (`.env`, local secrets) the checkpoint cannot bring back.

Checkpoints are taken whenever one of these commands executes under a resolve agent — including when you approve it yourself at the permission prompt with both flags left `false`. Native OpenCode agents (`build`/`plan`/chat) keep the unconditional deny and are unaffected by these flags.

### Agent Overrides

Each `agents.<name>` entry can set:

| Key | Values |
| --- | --- |
| `enabled` | boolean |
| `model` | model id or alias |
| `mode` | `subagent`, `primary`, `all` |
| `description` | string |
| `prompt` | string |
| `color` | string |
| `maxSteps` | positive integer |
| `tools` | object of tool booleans |
| `permission` | `edit`, `bash`, `webfetch`, `doom_loop`, `external_directory` |

Permission values are `ask`, `allow`, or `deny`. `permission.bash` may also be a command-pattern map.

## Model Setup

By default, `models` is empty and resolve agents inherit OpenCode's top-level `model`. Pin role-specific models only when you have a reason to split cost, speed, or reasoning depth.

Model resolution order for each agent:

1. `agents.<name>.model`
2. `models.<name>`
3. OpenCode top-level `model`
4. OpenCode fallback behavior

Example three-tier setup:

```json
{
  "models": {
    "bronze": "zai-coding-plan/glm-5.2",
    "silver": "zai-coding-plan/glm-5.2",
    "gold": "zai-coding-plan/glm-5.2",
    "explorer": "bronze",
    "coder": "silver",
    "resolver": "gold",
    "reviewer": "gold",
    "deep-reviewer": "gold",
    "planner": "gold"
  }
}
```

Supported model alias keys:

```text
fast, strong, mini, quick, deep,
bronze, silver, gold,
and every supported agent name
```

## Agents

| Agent | Default | Mode | Edit | Bash | Web | Role |
| --- | --- | --- | --- | --- | --- | --- |
| `resolver` | yes | `all` | allow | ask | allow | Primary orchestrator. |
| `coder` | yes | `subagent` | allow | ask | allow | Focused implementation and verification. |
| `explorer` | yes | `subagent` | deny | deny | allow | Fast read-only codebase scout. |
| `reviewer` | yes | `subagent` | deny | deny | allow | Read-only verification-gap review. |
| `deep-reviewer` | yes | `subagent` | deny | deny | allow | Read-only review for risky/high-impact changes. |
| `planner` | yes | `subagent` | deny | deny | allow | Read-only planning when explicitly useful. |
| `architect` | no | `subagent` | deny | deny | allow | Design/decomposition helper. |
| `debugger` | no | `subagent` | allow | ask | allow | Failure reproduction/root-cause helper. |
| `researcher` | no | `subagent` | deny | deny | allow | Codebase/docs research helper. |

## Permissions

Resolve agents keep bash at `ask` by default. The plugin's permission hook auto-allows common safe read/test commands and denies obviously dangerous patterns such as force pushes, shell-eval injection, and remote script pipes. Unknown commands remain `ask`.

`autoApprove` is accepted for compatibility with older configs, but current behavior is controlled by explicit agent permissions and the command classifier.

`git reset --hard` and `git clean -f` are denied unless you opt in — see [Rollback Permissions](#rollback-permissions). When permitted, the plugin checkpoints the worktree first.

Use a sandbox or VM for untrusted repositories.

## Parallel Subagents

`maxParallelSubagents` is optional. When omitted, the resolver uses soft guidance: dispatch coder only for genuinely independent work, and back off when rate limits appear.

When set, the value is inserted into the resolver prompt. It is not a runtime semaphore. Restart OpenCode after changing it. A custom `agents.resolver.prompt` replaces the templated rule.

## Project Context

The plugin exposes committed project context without stuffing the entire repo into prompts. It detects:

- `HARNESS.md`
- `AGENTS.md`
- `.opencode/context`
- `.claude/context`
- `context/`
- `thoughts/`
- package manager and common verification commands
- TypeScript projects

Resolvers are instructed to read only relevant context documents.

## Upgrade

```sh
npm install -g opencode-resolve@latest
opencode plugin opencode-resolve@latest --global --force
```

Pin a specific version in `opencode.json` and refresh that exact version:

```json
{ "plugin": ["opencode-resolve@<version>"] }
```

```sh
opencode plugin opencode-resolve@<version> --global --force
```

## Development

```sh
npm install
npm run build
npm test
npm run coverage
```

Local install from this checkout:

```sh
npm run install:local
```

Git hooks:

```sh
npm run hooks:install
```

Verification covered by tests includes agent injection, config loading, model aliases, permissions, optional commands, native agent preservation, and postinstall behavior.

## Release

1. Update `package.json` version.
2. Run `npm run prepush`.
3. Commit and tag:

```sh
git add package.json package-lock.json README.md README.ko.md
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

The publish workflow runs tests and publishes to npm.

## Design Rules

- Do not replace OpenCode native agents; preserve them unless explicitly overridden.
- Keep the default config small.
- Keep bash permission conservative.
- Keep migrations additive.
- Do not add runtime dependencies unless the benefit is clear.

## License

MIT
