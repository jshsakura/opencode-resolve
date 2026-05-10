# opencode-resolve

[![npm version](https://img.shields.io/npm/v/opencode-resolve.svg)](https://www.npmjs.com/package/opencode-resolve)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Lightweight OpenCode plugin for focused task resolution with minimal agents and native `plan`/`build` preservation.

`opencode-resolve` keeps native OpenCode `plan` and `build` behavior intact. It only injects a small set of optional agents so you can keep the useful early Oh My OpenCode-style persistence without a heavy multi-agent swarm.

The package defines roles, not provider choices. Users decide which model, if any, is pinned to each role.

## Features

- Preserves native OpenCode `plan` and `build` behavior.
- Injects only `coder` and `reviewer` by default.
- Uses your OpenCode default model unless you explicitly pin agent models.
- Adds a Context7 MCP preset only when one is not already configured.
- Validates config strictly so typos fail fast.

## Install From npm

Install this where OpenCode resolves plugins from. For most users, a global install is the simplest option:

```sh
npm install -g opencode-resolve
```

The package automatically registers itself in `~/.config/opencode/opencode.json` during `postinstall` and creates `~/.config/opencode/resolve.json` when missing.

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

By default, resolve agents inherit your top-level OpenCode `model`. If no top-level model is configured, the plugin leaves agent models unset and lets OpenCode choose its normal fallback.

## Defaults

Enabled by default:

- `coder`: implementation agent for edits, tests, and iteration.
- `reviewer`: Oracle-style review agent for requirements fit, correctness, security, tests, and maintainability.

Available but disabled unless configured:

- `architect`: design and task decomposition.
- `gpt-coder`: difficult implementation fallback.
- `debugger`: failure reproduction and root-cause analysis.
- `researcher`: codebase and documentation research.

The plugin also adds a `context7` MCP preset when one is not already configured.

## Model Policy

`opencode-resolve` does not ship provider-specific role defaults. It will not force GLM, GPT, or any other provider for new users.

Model resolution order for each agent:

1. `agents.<name>.model`
2. `models.<name>` alias mapping
3. top-level OpenCode `model`
4. OpenCode's own fallback when no model is configured

Use the default config when every resolve role should follow your current OpenCode model. Pin models only when you intentionally want fixed role behavior, such as a cheaper coding model and a stronger review model.

## Develop Locally

From this repository:

```sh
npm install
npm test
npm run install:local
```

`install:local` builds the plugin, links it into the OpenCode global plugin directory, and creates `~/.config/opencode/resolve.json` if it does not exist.

Manual equivalent:

```sh
npm run build
mkdir -p ~/.config/opencode/plugins
ln -sf "$PWD/dist/index.js" ~/.config/opencode/plugins/opencode-resolve.js
```

Local plugin files are loaded automatically by OpenCode.

After publishing/installing from npm, add the package to your OpenCode config:

```json
{
  "plugin": ["opencode-resolve"]
}
```

## Configuration

The plugin reads the first config file it finds:

- `.opencode/resolve.json`
- `opencode-resolve.json`
- `~/.config/opencode/resolve.json`
- `~/.config/opencode/opencode-resolve.json`

Example:

```json
{
  "enabled": ["coder", "reviewer"],
  "preserveNative": true,
  "context7": true,
  "commands": false,
  "agents": {
    "architect": {
      "enabled": false
    },
    "gpt-coder": {
      "enabled": false
    }
  }
}
```

To pin role-specific models, define aliases yourself. This is user policy, not a package default:

```json
{
  "enabled": ["coder", "reviewer"],
  "models": {
    "glm": "zai-coding-plan/glm-5.1",
    "gpt": "openai/gpt-5",
    "coder": "glm",
    "reviewer": "gpt"
  }
}
```

You can also pin a single role directly without aliases:

```json
{
  "agents": {
    "reviewer": {
      "model": "openai/gpt-5"
    }
  }
}
```

You can also pass options directly from `opencode.json`:

```json
{
  "plugin": [
    [
      "opencode-resolve",
      {
        "enabled": ["coder", "reviewer", "debugger"],
        "config": "~/.config/opencode/resolve.json"
      }
    ]
  ]
}
```

Options in `opencode.json` override file config.

Config precedence is: built-in defaults, then the first config file found, then inline plugin options from `opencode.json`.

The config is validated on load. Unknown agent names, misspelled keys, invalid modes, invalid permission values, and wrong value types fail fast with a clear error instead of silently changing behavior.

Supported agents:

- `coder`
- `reviewer`
- `architect`
- `gpt-coder`
- `debugger`
- `researcher`

Supported model aliases:

- `glm`
- `gpt`
- every supported agent name

Aliases only resolve when you define them in `models`. Without a model override, agents use the top-level OpenCode `model`; without that, the plugin leaves `agent.<name>.model` unset.

Supported agent modes are `subagent`, `primary`, and `all`. Supported permission values are `ask`, `allow`, and `deny`.

`preserveNative` is accepted for readability, but native `plan` and `build` are always preserved. The plugin never iterates or rewrites those built-in agents.

`enabled` selects the default active agents. A per-agent `agents.<name>.enabled` value overrides that list.

Set `context7` to `false` to disable the Context7 MCP preset.

Set `commands` to `true` to add optional subtask commands:

- `resolve-code`: run the `coder` agent for focused implementation.
- `resolve-review`: run the `reviewer` agent for requirement/risk review.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

The test suite executes the built plugin and verifies default agent injection, model aliases, file config, plugin option overrides, optional commands, Context7 preservation, and native `plan`/`build` preservation.

Before publishing, run:

```sh
npm run typecheck
npm test
npm audit --audit-level=moderate
npm publish --dry-run
```

`npm pack` and `npm publish` run `npm test` first through the `prepack` script.

## Release

Releases are published by GitHub Actions when a version tag is pushed.

Required repository secret:

- `NPM_TOKEN`: npm automation token with publish access.

Tag release flow:

```sh
npm version patch
git push origin main --follow-tags
```

You can also run the `Publish to npm` workflow manually from GitHub Actions and choose `patch`, `minor`, `major`, or a specific version.

The release workflow runs `npm ci`, `npm run typecheck`, `npm test`, and `npm publish --access public --provenance`.

## Design Rules

- Do not overwrite native `plan` or `build` agents.
- Keep default subagent count small.
- Search and inspect before editing.
- Make the smallest correct change.
- Verify when practical.
- Use reviewer for final requirement/risk checks instead of running many agents by default.
