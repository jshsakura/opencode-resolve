# Configuration Reference

`opencode-resolve` keeps its settings separate from `opencode.json` so OpenCode provider and plugin configuration stays readable.

## Config Discovery

The first file found wins:

1. `.opencode/resolve.json`
2. `opencode-resolve.json`
3. `~/.config/opencode/resolve.json`
4. `~/.config/opencode/opencode-resolve.json`

Inline plugin options override file config:

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

## Recommended Baseline

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

## Top-Level Options

| Key | Type | Default | Purpose |
| --- | --- | --- | --- |
| `profile` | `mix`, `glm`, `gpt` | `mix` | Prompt/profile preset. |
| `tier` | `bronze`, `silver`, `gold` | unset | Enables the matching tier preset when configured. |
| `enabled` | array | default agents | Agents to inject. |
| `models` | object | `{}` | Model aliases and role pins. |
| `agents` | object | `{}` | Per-agent overrides. |
| `preserveNative` | boolean | `true` | Preserve native OpenCode agents. |
| `context7` | boolean | `true` | Register Context7 MCP if missing. |
| `commands` | boolean | `false` | Add `/resolve`, `/resolve-code`, `/resolve-review`. |
| `autoApprove` | boolean | `true` | Compatibility flag. Permission behavior is explicit. |
| `autoUpdate` | boolean | `true` | Allow additive installer migrations. |
| `language` | `auto`, `en`, `ko` | `auto` | Prompt language preference. |
| `maxParallelSubagents` | positive integer | unset | Prompt-level soft limit for concurrent coder dispatch. |
| `config` | string | unset | Custom config path when used inline. |

Unknown keys fail fast.

## Agent Options

Each `agents.<name>` supports:

| Key | Value |
| --- | --- |
| `enabled` | boolean |
| `model` | model id or alias |
| `mode` | `subagent`, `primary`, `all` |
| `description` | string |
| `prompt` | string |
| `color` | string |
| `maxSteps` | positive integer |
| `tools` | object of tool booleans |
| `permission` | permission object |

Permission keys:

- `edit`
- `bash`
- `webfetch`
- `doom_loop`
- `external_directory`

Permission values:

- `ask`
- `allow`
- `deny`

`permission.bash` may be a single value or a command-pattern map.

## Models

By default, `models` is empty and every resolve agent inherits OpenCode's top-level model.

Resolution order:

1. `agents.<name>.model`
2. `models.<name>`
3. OpenCode top-level `model`
4. OpenCode fallback

Three-tier example:

```json
{
  "models": {
    "bronze": "zai-coding-plan/glm-4.7-flash",
    "silver": "zai-coding-plan/glm-5.1",
    "gold": "openai/gpt-5.5",
    "explorer": "bronze",
    "coder": "silver",
    "resolver": "gold",
    "reviewer": "gold",
    "deep-reviewer": "gold",
    "planner": "gold"
  }
}
```

Supported alias keys:

```text
fast, strong, mini, codex, quick, deep, glm, gpt,
bronze, silver, gold,
gpt-bronze, gpt-silver, gpt-gold,
glm-bronze, glm-silver, glm-gold,
and every supported agent name
```

## Context7

Default:

```json
{ "context7": true }
```

The plugin adds:

```json
{
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

If `mcp.context7` already exists, it is preserved.

## Full Reference File

For a copy-and-edit config with comments, use:

```text
opencode-resolve.reference.jsonc
```
