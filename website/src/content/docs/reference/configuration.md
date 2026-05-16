---
title: Configuration
description: Config files, options, models, and Context7 behavior.
---

## Discovery

The first file found wins:

1. `.opencode/resolve.json`
2. `opencode-resolve.json`
3. `~/.config/opencode/resolve.json`
4. `~/.config/opencode/opencode-resolve.json`

Inline plugin options override file config.

## Options

| Key | Default | Purpose |
| --- | --- | --- |
| `enabled` | default agents | Agents to inject. |
| `models` | `{}` | Model aliases and role pins. |
| `agents` | `{}` | Per-agent overrides. |
| `preserveNative` | `true` | Preserve native OpenCode agents. |
| `context7` | `true` | Register Context7 MCP if missing. |
| `commands` | `false` | Add `/resolve`, `/resolve-code`, `/resolve-review`. |
| `autoApprove` | `true` | Compatibility flag. |
| `autoUpdate` | `true` | Allow additive installer migrations. |
| `language` | `auto` | Prompt language preference. |
| `maxParallelSubagents` | unset | Prompt-level soft limit for coder fan-out. |

Unknown keys fail fast.

## Models

By default, all resolve agents inherit OpenCode's top-level model.

Resolution order:

1. `agents.<name>.model`
2. `models.<name>`
3. OpenCode top-level `model`
4. OpenCode fallback

```json
{
  "models": {
    "bronze": "zai-coding-plan/glm-4.5",
    "silver": "zai-coding-plan/glm-5.1",
    "gold": "openai/gpt-5.5",
    "explorer": "bronze",
    "coder": "silver",
    "resolver": "gold"
  }
}
```

## Context7

With `"context7": true`, the plugin registers:

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
