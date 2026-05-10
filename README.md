# opencode-resolve

[![npm version](https://img.shields.io/npm/v/opencode-resolve.svg)](https://www.npmjs.com/package/opencode-resolve)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Small OpenCode plugin for focused task resolution.

`opencode-resolve` adds a compact set of optional agents while preserving native OpenCode `plan` and `build` behavior. It defines roles, not model providers: agents use your OpenCode default model unless you explicitly pin role-specific models.

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Model Setup](#model-setup)
- [Agent Reference](#agent-reference)
- [Local Development](#local-development)
- [Verification](#verification)
- [Release](#release)
- [Design Rules](#design-rules)

---

## Features

- Preserves native OpenCode `plan` and `build` agents.
- Enables only `coder` and `reviewer` by default.
- Uses the top-level OpenCode `model` unless a role is pinned.
- Adds a Context7 MCP preset only when Context7 is not already configured.
- Validates config strictly so typos fail fast.
- Keeps optional commands disabled unless requested.

---

## Quick Start

Install from npm:

```sh
npm install -g opencode-resolve
```

The package `postinstall` step registers the plugin in `~/.config/opencode/opencode.json` and creates `~/.config/opencode/resolve.json` when missing.

Restart OpenCode after installation.

To skip automatic registration:

```sh
OPENCODE_RESOLVE_SKIP_POSTINSTALL=1 npm install -g opencode-resolve
```

Manual config fallback:

```json
{
  "plugin": ["opencode-resolve"]
}
```

Default behavior:

| Item | Default |
|---|---|
| Enabled agents | `coder`, `reviewer` |
| Agent model | Inherit top-level OpenCode `model` |
| Native `plan` / `build` | Preserved |
| Context7 preset | Enabled when absent |
| Commands | Disabled |

---

## Configuration

The plugin reads the first config file it finds:

| Priority | Path |
|---:|---|
| 1 | `.opencode/resolve.json` |
| 2 | `opencode-resolve.json` |
| 3 | `~/.config/opencode/resolve.json` |
| 4 | `~/.config/opencode/opencode-resolve.json` |

Inline plugin options in `opencode.json` override file config.

Config precedence:

```text
built-in defaults -> first config file found -> inline plugin options
```

Minimal config:

```json
{
  "enabled": ["coder", "reviewer"],
  "context7": true,
  "commands": false
}
```

Inline config:

```json
{
  "plugin": [
    [
      "opencode-resolve",
      {
        "enabled": ["coder", "reviewer"],
        "context7": true,
        "commands": false
      }
    ]
  ]
}
```

Strict validation rejects unknown agent names, misspelled keys, invalid modes, invalid permission values, and wrong value types.

---

## Model Setup

`opencode-resolve` does not ship GLM, GPT, or any other provider-specific role default.

Model resolution order for each resolve agent:

1. `agents.<name>.model`
2. `models.<name>` alias mapping
3. top-level OpenCode `model`
4. OpenCode's own fallback when no model is configured

Use the default config when all resolve roles should follow your current OpenCode model.

Pin models only when you intentionally want fixed role behavior, such as coding on one model and review on another.

Role-specific aliases:

```json
{
  "enabled": ["coder", "reviewer"],
  "models": {
    "glm": "zai-coding-plan/glm-5.1",
    "gpt": "openai/gpt-5.5",
    "coder": "glm",
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

Native OpenCode agents such as `plan` and `build` are configured through top-level OpenCode `agent`, not through `opencode-resolve`.

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
        "enabled": ["coder", "reviewer"],
        "models": {
          "glm": "zai-coding-plan/glm-5.1",
          "gpt": "openai/gpt-5.5",
          "coder": "glm",
          "reviewer": "gpt"
        },
        "agents": {
          "coder": {
            "mode": "all"
          },
          "reviewer": {
            "mode": "all"
          }
        }
      }
    ]
  ]
}
```

In this setup, `plan` and `reviewer` use `openai/gpt-5.5`; native `build` and resolve `coder` use `zai-coding-plan/glm-5.1`.

---

## Agent Reference

| Agent | Default | Purpose |
|---|:---:|---|
| `coder` | Yes | Focused implementation, edits, tests, and iteration |
| `reviewer` | Yes | Requirements fit, correctness, security, tests, and maintainability review |
| `architect` | No | Design and task decomposition |
| `gpt-coder` | No | Difficult implementation fallback |
| `debugger` | No | Failure reproduction and root-cause analysis |
| `researcher` | No | Codebase and documentation research |

Supported modes:

| Mode | Meaning |
|---|---|
| `subagent` | Available only as a subagent |
| `primary` | Available as a primary agent |
| `all` | Available as both primary and subagent |

Supported permission values are `ask`, `allow`, and `deny`.

Supported model alias keys are `glm`, `gpt`, and every supported agent name. Aliases only resolve when you define them in `models`.

`preserveNative` is accepted for readability, but native `plan` and `build` are always preserved. The plugin never rewrites built-in OpenCode agents.

Set `commands` to `true` to add optional subtask commands:

| Command | Description |
|---|---|
| `resolve-code` | Run the `coder` agent for focused implementation |
| `resolve-review` | Run the `reviewer` agent for requirement and risk review |

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

The test suite executes the built plugin and verifies default agent injection, model aliases, file config, plugin option overrides, optional commands, Context7 preservation, and native `plan`/`build` preservation.

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
- Keep the default agent set small.
- Search and inspect before editing.
- Make the smallest correct change.
- Verify when practical.
- Use `reviewer` for final requirement and risk checks instead of running many agents by default.
