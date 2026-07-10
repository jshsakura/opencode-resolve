---
title: Configuration
description: Config files, options, and models.
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
| `singleAgentMode` | `false` | When `true`, the resolver edits directly instead of dispatching a `coder` subagent — lower latency and token cost on simple tasks. |
| `commands` | `false` | Add `/resolve`, `/resolve-code`, `/resolve-review`. |
| `autoApprove` | `true` | Compatibility flag. |
| `autoUpdate` | `true` | Allow additive installer migrations. |
| `language` | `auto` | Prompt language preference. |
| `maxParallelSubagents` | unset | Prompt-level soft limit for coder fan-out. |
| `permissions` | `{}` | Opt-in rollback permissions. See below. |

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
    "gold": "zai-coding-plan/glm-5.2",
    "explorer": "bronze",
    "coder": "silver",
    "resolver": "gold"
  }
}
```
