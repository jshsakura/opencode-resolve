# Agent Guide

`opencode-resolve` injects a small set of OpenCode agents. The default path is intentionally simple: `resolver` orchestrates and `coder` implements.

## Default Agents

| Agent | Mode | Edit | Bash | Web | Purpose |
| --- | --- | --- | --- | --- | --- |
| `resolver` | `all` | allow | ask | allow | Primary orchestrator. |
| `coder` | `subagent` | allow | ask | allow | Focused implementation and verification. |
| `explorer` | `subagent` | deny | deny | allow | Fast read-only scout. |
| `reviewer` | `subagent` | deny | deny | allow | Read-only verification-gap review. |
| `deep-reviewer` | `subagent` | deny | deny | allow | Strong review for risky/high-impact changes. |
| `planner` | `subagent` | deny | deny | allow | Read-only implementation planning when explicitly useful. |

## Optional Agents

| Agent | Mode | Purpose |
| --- | --- | --- |
| `gpt` | `all` | GPT-optimized primary resolver. |
| `glm` | `all` | GLM/ZAI-optimized primary resolver. |
| `codex` | `all` | Legacy Codex-optimized primary resolver. |
| `architect` | `subagent` | Design/decomposition helper. |
| `gpt-coder` | `subagent` | Stronger implementation helper. |
| `debugger` | `subagent` | Failure reproduction and root-cause analysis. |
| `researcher` | `subagent` | Codebase and documentation research. |

Enable optional agents explicitly:

```json
{
  "agents": {
    "glm": { "enabled": true },
    "gpt": { "enabled": true },
    "debugger": { "enabled": true, "mode": "subagent" }
  }
}
```

## Resolver Loop

The resolver is prompted to:

1. Understand the request and inspect only relevant files.
2. Dispatch `explorer` only when discovery is the bottleneck.
3. Dispatch `coder` for focused patches.
4. Verify the changed path.
5. Dispatch `reviewer` or `deep-reviewer` only when risk justifies it.
6. Iterate until the task is resolved or a real blocker is found.

## Permissions

Bash defaults to `ask`. The plugin's classifier can auto-allow common safe commands and deny dangerous patterns, but unknown commands remain interactive.

Read-only agents deny edit and bash. They can still use web/documentation fetch when enabled.

## Parallelism

`maxParallelSubagents` is a prompt-level soft limit for `coder` fan-out. It is useful when a model/provider is sensitive to burst traffic.

Example:

```json
{
  "maxParallelSubagents": 1
}
```

This is not a runtime lock. It instructs the resolver to limit concurrent coder dispatch.
