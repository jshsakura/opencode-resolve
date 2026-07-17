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
| `tier` | `bronze`, `silver`, `gold` | unset | Enables the matching tier preset when configured. |
| `enabled` | array | default agents | Agents to inject. |
| `models` | object | `{}` | Model aliases and role pins. |
| `agents` | object | `{}` | Per-agent overrides. |
| `preserveNative` | boolean | `true` | Preserve native OpenCode agents. |
| `commands` | boolean | `false` | Add `/resolve`, `/resolve-code`, `/resolve-review`. |
| `autoApprove` | boolean | `true` | When `true`, unknown commands that pass the danger check are auto-allowed (no prompt). Dangerous commands are still denied. Set `false` to prompt for unknown commands. |
| `autoUpdate` | boolean | `true` | Allow additive installer migrations. |
| `language` | `auto`, `en`, `ko` | `auto` | Prompt language preference. |
| `maxParallelSubagents` | positive integer | unset | Prompt-level soft limit for concurrent coder dispatch. |
| `singleAgentMode` | boolean | `false` | When true, the resolver edits directly instead of dispatching a coder subagent — lower latency on simple tasks. |
| `permissions` | object | `{}` | Opt-in rollback permissions. See below. |
| `config` | string | unset | Custom config path when used inline. |

Unknown keys fail fast.

## Rollback Permissions

`git reset --hard` and `git clean -f` are denied by default. That protects uncommitted work, but it also means an agent that tangles the worktree mid-debug cannot get back to a clean state — it stalls. Two opt-in flags un-gate them, for resolve agents only:

```json
{
  "permissions": {
    "allowGitReset": true,
    "allowGitClean": true
  }
}
```

Before either command runs, the plugin snapshots the **entire worktree** — tracked edits and untracked files — into a git ref named `refs/resolve-checkpoint/<timestamp>-<reset|clean>`. The snapshot is written through a throwaway index, so your real index, working tree, branches, and `HEAD` are never touched. If the snapshot cannot be written, the destructive command is blocked instead of run unprotected.

Recover from a rollback you regret:

```sh
git for-each-ref refs/resolve-checkpoint    # list checkpoints
git restore --source=<ref> -- .             # bring everything back
```

`git clean -x` and `-X` stay denied regardless of these flags. They delete gitignored files, and the checkpoint snapshots via `git add -A`, which honours `.gitignore` — so a `-x` clean would destroy files (`.env`, local secrets) the checkpoint cannot bring back.

Checkpoints are taken whenever one of these commands executes under a resolve agent — including when you approve it yourself at the permission prompt with both flags left `false`. Native OpenCode agents (`build`/`plan`/chat) keep the unconditional deny.

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

Supported alias keys:

```text
fast, strong, mini, quick, deep,
bronze, silver, gold,
and every supported agent name
```

## Full Reference File

For a copy-and-edit config with comments, use:

```text
opencode-resolve.reference.jsonc
```
